/**
 * The odds section's reads (odds build P8, 2026-09-25) — SERVER-ONLY: it pulls
 * `pg` in, so no client component may import it (the `flagsRead.ts` split;
 * `tests/client-bundle-boundary.test.ts`). The shapes it returns live in
 * `lib/odds/section/types.ts`, which the browser can import.
 *
 * CLAUDE.md pattern 2: direct reads of tables that are kept fresh out of band
 * — by the P6 scraper bridge and the worker's provider jobs. No trigger, no
 * write.
 *
 * Times (P6 §6, D23): a row's CHECKED time is `max(fetched_at,
 * scraper_checks.last_ok_at)` for a `scraper:*` source (the scraper re-confirms
 * a price on every poll without rewriting it); its SINCE time is
 * `changed_at ?? fetched_at`. History comes only through `lib/db/priceHistory.ts`.
 */
import { pgAll } from './pgClient';
import { gameLineChangesForGame, gameLineClosesForGames, propChangesForSubject } from './priceHistory';
import { bookGroup } from '@/lib/odds/books/registry';
import type {
  GameOddsPayload, HistPoint, MarketSpec, OddsMarket, OddsQuote, OpenerRow, PlayerOddsPayload, PullRow, SourceLatencyRow,
} from '@/lib/odds/section/types';
import { marketSpec } from '@/lib/odds/section/types';

const HISTORY_DAYS = 10;
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const implied = (a: number) => (a > 0 ? 100 / (a + 100) : -a / (-a + 100));

/** The generic sport key the tables store (soccer_epl -> soccer, tennis_atp -> tennis). */
export function genericSport(sport: string): string {
  return sport.startsWith('soccer') ? 'soccer' : sport.startsWith('tennis') ? 'tennis' : sport;
}

/** The pair closest to even money is a book's main line when the source does not say (the BetMGM rule). */
function markMainLines(quotes: OddsQuote[], sp: MarketSpec): void {
  const groups = new Map<string, OddsQuote[]>();
  for (const q of quotes) {
    const k = `${q.book}|${q.source}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(q);
  }
  for (const qs of groups.values()) {
    if (qs.some(q => q.main)) continue;
    const byLine = new Map<string, OddsQuote[]>();
    for (const q of qs) {
      const id = q.line == null ? 'null' : String(sp.signed && q.side !== sp.sides[0] ? -q.line : q.line);
      (byLine.get(id) ?? byLine.set(id, []).get(id)!).push(q);
    }
    let best: string | null = null, score = Infinity;
    for (const [id, pair] of byLine) {
      const s = (pair.length >= 2 ? 0 : 1) * 10 + pair.reduce((a, q) => a + Math.abs(implied(q.price) - 0.5), 0);
      if (s < score) { score = s; best = id; }
    }
    for (const q of byLine.get(best!) ?? []) q.main = true;
  }
}

/**
 * A book's main-line history from its change rows: after each change, the
 * main line (the pair closest to even among the lines it quotes at that
 * moment) with both prices — the mockup's `hist` shape.
 */
function histFromChanges(rows: { at: string; book: string; side: string; line: number | null; price: number }[],
                         sp: MarketSpec): Record<string, HistPoint[]> {
  const out: Record<string, HistPoint[]> = {};
  const state = new Map<string, Map<string, { a?: number; b?: number }>>();
  for (const r of rows) {
    const lid = r.line == null ? 'null' : String(sp.signed && r.side !== sp.sides[0] ? -r.line : r.line);
    const st = state.get(r.book) ?? state.set(r.book, new Map()).get(r.book)!;
    const cur = st.get(lid) ?? {};
    if (r.side === sp.sides[0]) cur.a = r.price; else if (r.side === sp.sides[1]) cur.b = r.price; else continue;
    st.set(lid, cur);
    let best: string | null = null, score = Infinity;
    for (const [id, p] of st) {
      const s = (p.a != null && p.b != null ? 0 : 10) + (p.a != null ? Math.abs(implied(p.a) - 0.5) : 1) + (p.b != null ? Math.abs(implied(p.b) - 0.5) : 1);
      if (s < score) { score = s; best = id; }
    }
    const main = st.get(best!)!;
    const line = best === 'null' ? null : Number(best);
    const series = out[r.book] ?? (out[r.book] = []);
    const last = series[series.length - 1];
    const point: HistPoint = [r.at, line, main.a ?? null, main.b ?? null];
    if (!last || last[1] !== point[1] || last[2] !== point[2] || last[3] !== point[3]) series.push(point);
  }
  return out;
}

async function latency(sport: string): Promise<SourceLatencyRow[]> {
  const rows = await pgAll<{ sport: string; measure: SourceLatencyRow['measure']; source: string; book: string; n: number;
    hit_rate: number | null; median_s: number | null; proven_fast: boolean }>(
    `SELECT sport, measure, source, book, n, hit_rate, median_s, proven_fast FROM source_latency WHERE sport = ?`,
    [genericSport(sport)]);
  return rows.map(r => ({ sport: r.sport, measure: r.measure, source: r.source, book: r.book, n: r.n,
    hitRate: r.hit_rate, medianS: r.median_s, provenFast: r.proven_fast }));
}

async function checkedBySource(gameId: string): Promise<Map<string, string>> {
  const rows = await pgAll<{ source: string; last_ok_at: unknown }>(
    `SELECT source, last_ok_at FROM scraper_checks WHERE game_id = ?`, [gameId]);
  return new Map(rows.map(r => [r.source, iso(r.last_ok_at)]));
}

const later = (a: string | null, b: string | null | undefined) => (!a ? b ?? null : !b ? a : a > b ? a : b);

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
export async function readPlayerOdds(sport: string, gameId: string, subjectId: string): Promise<PlayerOddsPayload> {
  const now = new Date();
  const since = new Date(now.getTime() - HISTORY_DAYS * 86400e3).toISOString();
  const [rows, checks, changes, openers, pulls, lat] = await Promise.all([
    pgAll<{ provider_id: string; market_key: string; line: number | null; side: string; bookmaker: string;
      american_odds: number; fetched_at: unknown; changed_at: unknown; extra: Record<string, unknown> | null }>(
      `SELECT provider_id, market_key, line, side, bookmaker, american_odds, fetched_at, changed_at, extra
         FROM prop_odds WHERE game_id = ? AND subject_id = ?`, [gameId, subjectId]),
    checkedBySource(gameId),
    propChangesForSubject(gameId, subjectId, since),
    pgAll<{ market: string; side: string; bookmaker: string; point: number | null; american_odds: number | null;
      opened_at: unknown; opener_source: string; check_flag: boolean; check_reason: string | null }>(
      `SELECT market, side, bookmaker, point, american_odds, opened_at, opener_source, check_flag, check_reason
         FROM market_openers WHERE kind = 'prop' AND game_id = ? AND subject_id = ?`, [gameId, subjectId]),
    pgAll<{ market_key: string; side: string; bookmaker: string; line: number | null; last_american_odds: number | null;
      pulled_at: unknown; returned_at: unknown }>(
      `SELECT market_key, side, bookmaker, line, last_american_odds, pulled_at, returned_at
         FROM prop_odds_pulls WHERE game_id = ? AND subject_id = ? AND pulled_at >= ?::timestamptz`,
      [gameId, subjectId, since]),
    latency(sport),
  ]);
  const sp = marketSpec('prop');
  const byMarket = new Map<string, OddsMarket>();
  const market = (key: string) => byMarket.get(key) ?? byMarket.set(key, { key, cur: [], hist: {}, open: {}, pulls: [] }).get(key)!;
  for (const r of rows) {
    const m = market(r.market_key);
    const fetched = iso(r.fetched_at);
    m.cur.push({
      book: r.bookmaker, side: r.side, line: r.line, price: r.american_odds,
      since: r.changed_at ? iso(r.changed_at) : fetched,
      checkedAt: later(fetched, checks.get(r.provider_id)),
      source: r.provider_id, main: false, extra: r.extra ?? null,
    });
  }
  for (const m of byMarket.values()) markMainLines(m.cur, sp);
  const changesByMarket = new Map<string, typeof changes>();
  for (const c of changes) (changesByMarket.get(c.marketKey) ?? changesByMarket.set(c.marketKey, []).get(c.marketKey)!).push(c);
  for (const [key, cs] of changesByMarket) {
    market(key).hist = histFromChanges(cs.map(c => ({ at: iso(c.observedAt), book: c.bookmaker, side: c.side,
      line: c.line, price: c.americanOdds })), sp);
  }
  for (const o of openers) {
    const m = market(o.market);
    const cur: OpenerRow = m.open[o.bookmaker] ?? { at: iso(o.opened_at), line: null, priceA: null, priceB: null };
    if (o.side === sp.sides[0]) { cur.line = o.point; cur.priceA = o.american_odds; } else { cur.priceB = o.american_odds; }
    cur.source = o.opener_source;
    cur.flagged = cur.flagged || o.check_flag;
    cur.reason = cur.reason ?? o.check_reason;
    m.open[o.bookmaker] = cur;
  }
  for (const p of pulls) {
    market(p.market_key).pulls!.push({ book: p.bookmaker, side: p.side, line: p.line, lastPrice: p.last_american_odds,
      pulledAt: iso(p.pulled_at), returnedAt: p.returned_at ? iso(p.returned_at) : null } satisfies PullRow);
  }
  return { sport, gameId, subjectId, asOf: now.toISOString(), markets: [...byMarket.values()], latency: lat };
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------
const BOOK_LINES_MARKET: Record<string, string> = { moneyline: 'ml', spread: 'sp', total: 'tot' };

export function gameMarketSpec(market: string): MarketSpec {
  if (market === 'sp') return marketSpec('sp');
  if (market === 'ml' || market === 'ml3') return marketSpec('ml');
  return marketSpec('tot');
}

export async function readGameOdds(sport: string, gameId: string): Promise<GameOddsPayload> {
  const now = new Date();
  const since = new Date(now.getTime() - HISTORY_DAYS * 86400e3).toISOString();
  const g = genericSport(sport);
  const [lines, legacy, checks, changes, openers, pulls, power, lat] = await Promise.all([
    pgAll<{ period: string; market: string; side: string; point: number | null; is_main: boolean; bookmaker: string;
      source: string; american_odds: number; fetched_at: unknown; changed_at: unknown; extra: Record<string, unknown> | null }>(
      `SELECT period, market, side, point, is_main, bookmaker, source, american_odds, fetched_at, changed_at, extra
         FROM game_lines WHERE sport = ? AND game_id = ?`, [g, gameId]),
    // Sources not yet on game_lines (the paid feeds' full-game lines).
    pgAll<{ market: string; side: string; bookmaker: string; source: string; point: number | null;
      american_odds: number | null; fetched_at: unknown }>(
      `SELECT market, side, bookmaker, source, point, american_odds, fetched_at
         FROM game_odds_book_lines WHERE sport = ? AND game_id = ? AND source NOT LIKE 'scraper:%'`, [g, gameId]),
    checkedBySource(gameId),
    gameLineChangesForGame(gameId, since),
    pgAll<{ period: string; market: string; side: string; bookmaker: string; point: number | null; american_odds: number | null;
      opened_at: unknown; opener_source: string; check_flag: boolean; check_reason: string | null }>(
      `SELECT period, market, side, bookmaker, point, american_odds, opened_at, opener_source, check_flag, check_reason
         FROM market_openers WHERE kind = 'game' AND game_id = ?`, [gameId]),
    pgAll<{ period: string; market: string; side: string; bookmaker: string; point: number | null;
      last_american_odds: number | null; pulled_at: unknown; returned_at: unknown }>(
      `SELECT period, market, side, bookmaker, point, last_american_odds, pulled_at, returned_at
         FROM game_line_pulls WHERE sport = ? AND game_id = ? AND pulled_at >= ?::timestamptz`, [g, gameId, since]),
    pgAll<{ subject: string; data: Record<string, unknown> }>(
      `SELECT subject, data FROM game_reference WHERE sport = ? AND game_id = ? AND kind = 'power_rating'`, [g, gameId]),
    latency(sport),
  ]);
  const byMarket = new Map<string, OddsMarket>();
  const market = (key: string) => byMarket.get(key) ?? byMarket.set(key, { key, cur: [], hist: {}, open: {}, pulls: [] }).get(key)!;
  const seen = new Set<string>();
  for (const r of lines) {
    if (r.market === 'live' || r.period === 'live') continue;
    const key = `${r.period}_${r.market}`;
    const fetched = iso(r.fetched_at);
    seen.add(`${key}|${r.bookmaker}`);
    market(key).cur.push({
      book: r.bookmaker, side: r.side, line: r.point, price: r.american_odds,
      since: r.changed_at ? iso(r.changed_at) : fetched, checkedAt: later(fetched, checks.get(r.source)),
      source: r.source, main: r.is_main, extra: r.extra ?? null,
    });
  }
  for (const r of legacy) {
    const mk = BOOK_LINES_MARKET[r.market];
    if (!mk || r.american_odds == null || seen.has(`fg_${mk}|${r.bookmaker}`)) continue;
    const fetched = iso(r.fetched_at);
    market(`fg_${mk}`).cur.push({ book: r.bookmaker, side: r.side, line: r.point, price: r.american_odds, since: fetched,
      checkedAt: fetched, source: r.source, main: true, extra: null });
  }
  const changesByMarket = new Map<string, typeof changes>();
  for (const c of changes) {
    if (!c.isMain) continue;
    const key = `${c.period}_${c.market}`;
    (changesByMarket.get(key) ?? changesByMarket.set(key, []).get(key)!).push(c);
  }
  for (const [key, cs] of changesByMarket) {
    market(key).hist = histFromChanges(cs.map(c => ({ at: iso(c.observedAt), book: c.bookmaker, side: c.side,
      line: c.point, price: c.americanOdds })), gameMarketSpec(key.split('_').slice(1).join('_')));
  }
  for (const o of openers) {
    const key = `${o.period}_${o.market}`;
    const sp = gameMarketSpec(o.market);
    const m = market(key);
    const cur: OpenerRow = m.open[o.bookmaker] ?? { at: iso(o.opened_at), line: null, priceA: null, priceB: null };
    if (o.side === sp.sides[0]) { cur.line = o.point; cur.priceA = o.american_odds; }
    else if (o.side === sp.sides[1]) { cur.priceB = o.american_odds; if (cur.line == null && o.point != null && sp.signed) cur.line = -o.point; }
    cur.source = o.opener_source;
    cur.flagged = cur.flagged || o.check_flag;
    cur.reason = cur.reason ?? o.check_reason;
    m.open[o.bookmaker] = cur;
  }
  for (const p of pulls) {
    market(`${p.period}_${p.market}`).pulls!.push({ book: p.bookmaker, side: p.side, line: p.point,
      lastPrice: p.last_american_odds, pulledAt: iso(p.pulled_at), returnedAt: p.returned_at ? iso(p.returned_at) : null });
  }
  // Pick'em books never price a game line; drop any stray row so "best" stays honest.
  for (const m of byMarket.values()) m.cur = m.cur.filter(q => bookGroup(q.book) !== 'pickem');
  return { sport, gameId, asOf: now.toISOString(), markets: [...byMarket.values()], latency: lat,
    powerRatings: power.map(p => ({ subject: p.subject, data: p.data })) };
}

// ---------------------------------------------------------------------------
// Closes (the team page's "Against the closing number", P8 O3)
// ---------------------------------------------------------------------------
export interface GameClose {
  /** The consensus close: the full-game main line most books closed at (spread on the home side). */
  spread: number | null;
  total: number | null;
  books: number;
}

/**
 * Each game's consensus closing spread and total: per book, the last main
 * price at or before the start (history first; else the current row when it
 * has not changed since the start), then the line most books closed at.
 */
export async function readGameCloses(sport: string, games: { gameId: string; start: string }[]): Promise<Record<string, GameClose>> {
  if (!games.length) return {};
  const g = genericSport(sport);
  const [hist, cur] = await Promise.all([
    gameLineClosesForGames(games),
    pgAll<{ game_id: string; market: string; side: string; point: number | null; bookmaker: string; since: unknown }>(
      `SELECT game_id, market, side, point, bookmaker, coalesce(changed_at, fetched_at) AS since
         FROM game_lines WHERE sport = ? AND game_id = ANY(?) AND period = 'fg' AND market IN ('sp', 'tot') AND is_main`,
      [g, games.map(x => x.gameId)]),
  ]);
  const startOf = new Map(games.map(x => [x.gameId, Date.parse(x.start)]));
  // (game, market, book) -> side A's closing line
  const close = new Map<string, number>();
  const sideA = (market: string) => (market === 'sp' ? 'home' : 'over');
  for (const r of hist) {
    if (r.side === sideA(r.market) && r.point != null && bookGroup(r.bookmaker) !== 'pickem') close.set(`${r.gameId}|${r.market}|${r.bookmaker}`, r.point);
  }
  for (const r of cur) {
    const k = `${r.game_id}|${r.market}|${r.bookmaker}`;
    if (close.has(k) || r.side !== sideA(r.market) || r.point == null || bookGroup(r.bookmaker) === 'pickem') continue;
    if (Date.parse(iso(r.since)) <= (startOf.get(r.game_id) ?? -Infinity)) close.set(k, r.point);
  }
  const out: Record<string, GameClose> = {};
  for (const { gameId } of games) {
    const modal = (market: string) => {
      const cnt = new Map<number, number>();
      for (const [k, v] of close) if (k.startsWith(`${gameId}|${market}|`)) cnt.set(v, (cnt.get(v) ?? 0) + 1);
      const e = [...cnt].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]));
      return { line: e.length ? e[0][0] : null, n: [...cnt.values()].reduce((a, b) => a + b, 0) };
    };
    const sp = modal('sp'), tot = modal('tot');
    out[gameId] = { spread: sp.line, total: tot.line, books: Math.max(sp.n, tot.n) };
  }
  return out;
}
