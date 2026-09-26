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
import { gameLineChangesForGame, gameLineChangesForGames, gameLineClosesForGames, propChangesForSubject } from './priceHistory';
import { bookGroup } from '@/lib/odds/books/registry';
import type {
  GameOddsPayload, HistPoint, MarketSpec, OddsMarket, OddsQuote, OpenerRow, PlayerOddsPayload, PullRow, SourceLatencyRow,
  MarketEdge,
  EdgeCandidate,
  EdgeView,
  EdgeRanking,
  EdgeRankRow,
} from '@/lib/odds/section/types';
import { marketSpec } from '@/lib/odds/section/types';
import { detectSteam, lineMoves } from '@/lib/odds/section/steam';
import { slateGame, type SlateOddsPayload, type SplitRow } from '@/lib/odds/section/slate';
import { scanKey, type ScanExtras } from '@/lib/odds/section/scanCells';
import type { ExchangeObs, MoneyPayload, SplitHistPoint, SplitObs } from '@/lib/odds/section/money';

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
// Where the money is (P10): splits, DraftKings' split history, exchange rows
// ---------------------------------------------------------------------------
const n = (v: unknown) => (v == null ? null : Number(v));

/**
 * One game's (or, with `subjectId`, one player's) "Where the money is" rows:
 * the newest `market_splits` observation per source, book, kind, market, side
 * and line; DraftKings Network's side-A history per full-game market (the
 * money trend); and `exchange_books` for the game's or player's contracts.
 * Three small queries; the tables are written by the P6 bridge only.
 */
export async function readMoney(gameId: string, subjectId = ''): Promise<MoneyPayload> {
  const since = new Date(Date.now() - HISTORY_DAYS * 86400e3).toISOString();
  const [splits, hist, ex] = await Promise.all([
    pgAll<{ source: string; kind: string; book: string | null; market: string; side: string; line: number | null; pct_bets: number | null;
      pct_money: number | null; count: number | null; count_total: number | null; observed_at: unknown }>(
      `SELECT DISTINCT ON (source, book, kind, market, side, line) source, kind, book, market, side, line, pct_bets, pct_money, count, count_total, observed_at
         FROM market_splits WHERE game_id = ? AND subject_id = ? AND period = 'fg'
        ORDER BY source, book, kind, market, side, line, observed_at DESC`, [gameId, subjectId]),
    subjectId ? Promise.resolve([]) : pgAll<{ market: string; line: number | null; pct_bets: number | null; pct_money: number | null; observed_at: unknown }>(
      `SELECT market, line, pct_bets, pct_money, observed_at FROM market_splits
        WHERE game_id = ? AND subject_id = '' AND period = 'fg' AND source = 'dknetwork' AND book = 'draftkings' AND kind = 'bets_money'
          AND ((market IN ('ml', 'sp') AND side = 'home') OR (market = 'tot' AND side = 'over')) AND observed_at >= ?::timestamptz
        ORDER BY observed_at`, [gameId, since]),
    pgAll<{ exchange: string; market: string; side: string; point: number | null; best_bid: number | null; best_ask: number | null;
      volume_24h: number | null; open_interest: number | null; liquidity: number | null; fetched_at: unknown }>(
      `SELECT exchange, market, side, point, best_bid, best_ask, volume_24h, open_interest, liquidity, fetched_at
         FROM exchange_books WHERE game_id = ? AND coalesce(subject_id, '') = ? AND period = 'fg'`, [gameId, subjectId]),
  ]);
  const splitHist: Record<string, SplitHistPoint[]> = {};
  for (const h of hist) (splitHist[`dknetwork|draftkings|${h.market}`] ??= []).push([iso(h.observed_at), n(h.line), n(h.pct_bets), n(h.pct_money)]);
  return {
    splits: splits.map((r): SplitObs => ({ at: iso(r.observed_at), source: r.source, kind: r.kind, book: r.book, market: r.market, side: r.side,
      line: n(r.line), pctBets: n(r.pct_bets), pctMoney: n(r.pct_money), count: n(r.count), countTotal: n(r.count_total) })),
    splitHist,
    exchanges: ex.map((r): ExchangeObs => ({ exchange: r.exchange, market: r.market, side: r.side, point: n(r.point), bestBid: n(r.best_bid),
      bestAsk: n(r.best_ask), volume24h: n(r.volume_24h), openInterest: n(r.open_interest), liquidity: n(r.liquidity), at: iso(r.fetched_at) })),
  };
}

// PULLS (audit 2026-09-26): a pull is recorded per SOURCE (D14 keeps every
// one), but a book is only "pulled" while NO source still quotes it at that
// line and side. Relays re-list alternates constantly — in one day 415k of
// 622k game-line pulls were actionnetwork's, 97% back within ~15 min — and a
// relay dropping its copy while the book's own site still shows the price is
// not the book taking the line down. So every read below keeps an OPEN pull
// only when the book has no current row there; returned pulls stay (history).
// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
export async function readPlayerOdds(sport: string, gameId: string, subjectId: string): Promise<PlayerOddsPayload> {
  const now = new Date();
  const since = new Date(now.getTime() - HISTORY_DAYS * 86400e3).toISOString();
  const [rows, checks, changes, openers, pulls, lat, money, edges, edgeView, linkRows] = await Promise.all([
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
         FROM prop_odds_pulls p WHERE game_id = ? AND subject_id = ? AND pulled_at >= ?::timestamptz
          AND (returned_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM prop_odds c WHERE c.game_id = p.game_id AND c.subject_id = p.subject_id AND c.market_key = p.market_key AND c.side = p.side AND c.bookmaker = p.bookmaker AND c.line IS NOT DISTINCT FROM p.line))`,
      [gameId, subjectId, since]),
    latency(sport),
    readMoney(gameId, subjectId),
    readEdges({ gameIds: [gameId], subjectId }),
    readEdgeView({ gameIds: [gameId], subjectId }),
    pgAll<{ subject: string; data: Record<string, unknown> }>(
      `SELECT subject, data FROM game_reference WHERE game_id = ? AND kind = 'book_link'`, [gameId]),
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
  const links: Record<string, string> = {};
  for (const l of linkRows) {
    const d = typeof l.data === 'string' ? JSON.parse(l.data) : l.data;
    if (typeof d?.url === 'string') links[l.subject] = d.url;
  }
  return { sport, gameId, subjectId, asOf: now.toISOString(), markets: [...byMarket.values()], latency: lat, money,
    ...(edges ? { edges } : {}), edgeView, links };
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

type LineRow = { period: string; market: string; side: string; point: number | null; is_main: boolean; bookmaker: string;
  source: string; american_odds: number; fetched_at: unknown; changed_at: unknown; extra: Record<string, unknown> | null };
type LegacyRow = { market: string; side: string; bookmaker: string; source: string; point: number | null; american_odds: number | null; fetched_at: unknown };
type OpenerDbRow = { period: string; market: string; side: string; bookmaker: string; point: number | null; american_odds: number | null;
  opened_at: unknown; opener_source: string; check_flag: boolean; check_reason: string | null };
type PullDbRow = { period: string; market: string; side: string; bookmaker: string; point: number | null;
  last_american_odds: number | null; pulled_at: unknown; returned_at: unknown };

/** One game's markets, keyed `${period}_${market}`, from its rows (shared by the game page and the Slate). */
function assembleGameMarkets(lines: LineRow[], legacy: LegacyRow[], checks: Map<string, string>,
                             changes: Awaited<ReturnType<typeof gameLineChangesForGame>>, openers: OpenerDbRow[], pulls: PullDbRow[]): Map<string, OddsMarket> {
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
    const spec = gameMarketSpec(key.split('_').slice(1).join('_'));
    const m = market(key);
    m.hist = histFromChanges(cs.map(c => ({ at: iso(c.observedAt), book: c.bookmaker, side: c.side,
      line: c.point, price: c.americanOdds })), spec);
    // Steam and every move with its first mover (F12: computed at read time).
    if (!spec.noLine) { m.moves = lineMoves(m.hist); m.steam = detectSteam(m.hist); }
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
  return byMarket;
}

/**
 * `live: true` is the game page's 30 s refresh (P9 §4): current prices, pulls
 * that are open or returned in the last hour, and the splits — no history,
 * openers, power ratings or latency, which the first full read already gave
 * the page (`lib/odds/section/liveMerge.ts` merges the two). The history read
 * alone measured 2.2–2.5 s per game; the light read is the rest.
 */
export async function readGameOdds(sport: string, gameId: string, opts?: { live?: boolean }): Promise<GameOddsPayload> {
  const now = new Date();
  const live = !!opts?.live;
  const since = new Date(now.getTime() - HISTORY_DAYS * 86400e3).toISOString();
  const pullsSince = live ? new Date(now.getTime() - 3600e3).toISOString() : since;
  const none = Promise.resolve([] as never[]);
  const g = genericSport(sport);
  const [lines, legacy, checks, changes, openers, pulls, power, lat, money, edges, edgeView] = await Promise.all([
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
    live ? none : gameLineChangesForGame(gameId, since),
    live ? none : pgAll<{ period: string; market: string; side: string; bookmaker: string; point: number | null; american_odds: number | null;
      opened_at: unknown; opener_source: string; check_flag: boolean; check_reason: string | null }>(
      `SELECT period, market, side, bookmaker, point, american_odds, opened_at, opener_source, check_flag, check_reason
         FROM market_openers WHERE kind = 'game' AND game_id = ?`, [gameId]),
    pgAll<{ period: string; market: string; side: string; bookmaker: string; point: number | null;
      last_american_odds: number | null; pulled_at: unknown; returned_at: unknown }>(
      live
        ? `SELECT period, market, side, bookmaker, point, last_american_odds, pulled_at, returned_at
             FROM game_line_pulls p WHERE sport = ? AND game_id = ? AND (returned_at IS NULL OR returned_at >= ?::timestamptz)
              AND (returned_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM game_lines c WHERE c.sport = p.sport AND c.game_id = p.game_id AND c.period = p.period AND c.market = p.market AND c.side = p.side AND c.bookmaker = p.bookmaker AND c.point IS NOT DISTINCT FROM p.point))`
        : `SELECT period, market, side, bookmaker, point, last_american_odds, pulled_at, returned_at
             FROM game_line_pulls p WHERE sport = ? AND game_id = ? AND pulled_at >= ?::timestamptz
              AND (returned_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM game_lines c WHERE c.sport = p.sport AND c.game_id = p.game_id AND c.period = p.period AND c.market = p.market AND c.side = p.side AND c.bookmaker = p.bookmaker AND c.point IS NOT DISTINCT FROM p.point))`, [g, gameId, pullsSince]),
    live ? none : pgAll<{ subject: string; data: Record<string, unknown> }>(
      `SELECT subject, data FROM game_reference WHERE sport = ? AND game_id = ? AND kind = 'power_rating'`, [g, gameId]),
    live ? none : latency(sport),
    readMoney(gameId),
    readEdges({ gameIds: [gameId], kind: 'game' }),
    readEdgeView({ gameIds: [gameId], kind: 'game' }),
  ]);
  const byMarket = assembleGameMarkets(lines, legacy, checks, changes, openers, pulls);
  return { sport, gameId, asOf: now.toISOString(), markets: [...byMarket.values()], latency: lat,
    powerRatings: power.map(p => ({ subject: p.subject, data: p.data })), money, ...(edges ? { edges } : {}), edgeView };
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
 * has not changed since the start; else the paid feeds' last pre-start line;
 * for a total, else `game_odds_history`'s),
 * then the line most books closed at.
 */
export async function readGameCloses(sport: string, games: { gameId: string; start: string }[]): Promise<Record<string, GameClose>> {
  if (!games.length) return {};
  const g = genericSport(sport);
  const [hist, cur, paid, older] = await Promise.all([
    gameLineClosesForGames(games),
    pgAll<{ game_id: string; market: string; side: string; point: number | null; bookmaker: string; since: unknown }>(
      `SELECT game_id, market, side, point, bookmaker, coalesce(changed_at, fetched_at) AS since
         FROM game_lines WHERE sport = ? AND game_id = ANY(?) AND period = 'fg' AND market IN ('sp', 'tot') AND is_main`,
      [g, games.map(x => x.gameId)]),
    // The paid feeds' per-book lines (append-only per fetch): each book's last
    // spread and total fetched at or before the start. Before the bridge (Sep 25)
    // this is the only per-book close held for a game (D14).
    pgAll<{ game_id: string; market: string; point: number | null; bookmaker: string }>(
      `SELECT DISTINCT ON (l.game_id, l.bookmaker, l.market) l.game_id, l.market, l.point, l.bookmaker
         FROM game_odds_book_lines l
         JOIN unnest(?::text[], ?::timestamptz[]) AS q(game_id, start) ON q.game_id = l.game_id
        WHERE l.sport = ? AND l.market IN ('spread', 'total') AND l.side IN ('home', 'over') AND l.fetched_at <= q.start
        ORDER BY l.game_id, l.bookmaker, l.market, l.fetched_at DESC`,
      [games.map(x => x.gameId), games.map(x => x.start), g]),
    // The oldest store, totals only (moneyline + total since 2026-08): each book's
    // last total observed at or before the start.
    pgAll<{ game_id: string; point: number | null; bookmaker: string }>(
      `SELECT DISTINCT ON (h.event_id, h.bookmaker) h.event_id AS game_id, h.point, h.bookmaker
         FROM game_odds_history h
         JOIN unnest(?::text[], ?::timestamptz[]) AS q(game_id, start) ON q.game_id = h.event_id
        WHERE h.market = 'total' AND h.side = 'over' AND h.observed_at <= q.start
        ORDER BY h.event_id, h.bookmaker, h.observed_at DESC`,
      [games.map(x => x.gameId), games.map(x => x.start)]),
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
  for (const r of paid) {
    const mk = r.market === 'spread' ? 'sp' : 'tot';
    const k = `${r.game_id}|${mk}|${r.bookmaker}`;
    if (!close.has(k) && r.point != null && bookGroup(r.bookmaker) !== 'pickem') close.set(k, r.point);
  }
  for (const r of older) {
    const k = `${r.game_id}|tot|${r.bookmaker}`;
    if (!close.has(k) && r.point != null && bookGroup(r.bookmaker) !== 'pickem') close.set(k, r.point);
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

// ---------------------------------------------------------------------------
// Slate (P8 O4): every game's full-game markets in one pass, summarised
// ---------------------------------------------------------------------------
const SLATE_HISTORY_H = 36;

/**
 * The Slate's odds for a set of games (`lib/odds/section/slate.ts` does the
 * work): full-game moneyline, spread and total per book, openers, open pulls,
 * DraftKings splits, and 36 hours of main-line history for steam. Six queries
 * for the whole slate, not six per game.
 */
export async function readSlateOdds(sport: string, date: string, gameIds: string[]): Promise<SlateOddsPayload> {
  const t0 = Date.now();
  const now = new Date();
  const g = genericSport(sport);
  const since = new Date(now.getTime() - SLATE_HISTORY_H * 3600e3).toISOString();
  const [lines, legacy, checks, changes, openers, pulls, splits] = await Promise.all([
    pgAll<LineRow & { game_id: string }>(
      `SELECT game_id, period, market, side, point, is_main, bookmaker, source, american_odds, fetched_at, changed_at, extra
         FROM game_lines WHERE sport = ? AND game_id = ANY(?) AND period = 'fg' AND market IN ('ml', 'sp', 'tot')`, [g, gameIds]),
    pgAll<LegacyRow & { game_id: string }>(
      `SELECT game_id, market, side, bookmaker, source, point, american_odds, fetched_at
         FROM game_odds_book_lines WHERE sport = ? AND game_id = ANY(?) AND source NOT LIKE 'scraper:%'`, [g, gameIds]),
    pgAll<{ game_id: string; source: string; last_ok_at: unknown }>(
      `SELECT game_id, source, last_ok_at FROM scraper_checks WHERE game_id = ANY(?)`, [gameIds]),
    gameLineChangesForGames(gameIds, since),
    pgAll<OpenerDbRow & { game_id: string }>(
      `SELECT game_id, period, market, side, bookmaker, point, american_odds, opened_at, opener_source, check_flag, check_reason
         FROM market_openers WHERE kind = 'game' AND game_id = ANY(?) AND period = 'fg' AND market IN ('ml', 'sp', 'tot')`, [gameIds]),
    pgAll<PullDbRow & { game_id: string }>(
      `SELECT game_id, period, market, side, bookmaker, point, last_american_odds, pulled_at, returned_at
         FROM game_line_pulls p WHERE sport = ? AND game_id = ANY(?) AND period = 'fg' AND returned_at IS NULL AND pulled_at >= ?::timestamptz
          AND NOT EXISTS (SELECT 1 FROM game_lines c WHERE c.sport = p.sport AND c.game_id = p.game_id AND c.period = p.period AND c.market = p.market AND c.side = p.side AND c.bookmaker = p.bookmaker AND c.point IS NOT DISTINCT FROM p.point)`,
      [g, gameIds, since]),
    pgAll<{ game_id: string; market: string; side: string; source: string; book: string | null; pct_money: number | null; pct_bets: number | null }>(
      `SELECT DISTINCT ON (game_id, market, side, source, book) game_id, market, side, source, book, pct_money, pct_bets
         FROM market_splits WHERE game_id = ANY(?) AND subject_id = '' AND kind = 'bets_money' AND market = 'ml'
        ORDER BY game_id, market, side, source, book, observed_at DESC`, [gameIds]),
  ]);
  const queryMs = Date.now() - t0;
  const by = <T extends { game_id?: string; gameId?: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) { const k = (r.game_id ?? r.gameId)!; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    return m;
  };
  const L = by(lines), LG = by(legacy), C = by(checks), H = by(changes), O = by(openers), P = by(pulls), S = by(splits);
  const games = gameIds.map(id => {
    const chk = new Map((C.get(id) ?? []).map(r => [r.source, iso(r.last_ok_at)]));
    const markets = assembleGameMarkets(L.get(id) ?? [], LG.get(id) ?? [], chk, H.get(id) ?? [], O.get(id) ?? [], P.get(id) ?? []);
    const sp: SplitRow[] = (S.get(id) ?? []).map(r => ({ market: r.market, side: r.side, source: r.source, book: r.book, pctMoney: r.pct_money, pctBets: r.pct_bets }));
    return slateGame(id, markets, sp);
  });
  return { sport, date, asOf: now.toISOString(), games, buildMs: Date.now() - t0, queryMs };
}

// ---------------------------------------------------------------------------
// Scan extras (P8 O4, D22): the opening line per player-market, and pulls
// ---------------------------------------------------------------------------
export async function readScanExtras(gameIds: string[]): Promise<ScanExtras> {
  if (!gameIds.length) return { open: {}, pulled: {} };
  const [openers, pulls, edgeRows] = await Promise.all([
    pgAll<{ subject_id: string; market: string; point: number | null; n: string }>(
      `SELECT subject_id, market, point, count(DISTINCT bookmaker) AS n
         FROM market_openers
        WHERE kind = 'prop' AND game_id = ANY(?) AND side = 'over' AND NOT check_flag AND point IS NOT NULL
        GROUP BY subject_id, market, point`, [gameIds]),
    pgAll<{ subject_id: string; market_key: string; line: number | null; n: string }>(
      `SELECT subject_id, market_key, line, count(DISTINCT bookmaker) AS n
         FROM prop_odds_pulls p WHERE game_id = ANY(?) AND returned_at IS NULL AND NOT EXISTS (SELECT 1 FROM prop_odds c WHERE c.game_id = p.game_id AND c.subject_id = p.subject_id AND c.market_key = p.market_key AND c.side = p.side AND c.bookmaker = p.bookmaker AND c.line IS NOT DISTINCT FROM p.line)
        GROUP BY subject_id, market_key, line`, [gameIds]),
    readEdges({ gameIds, kind: 'prop' }),
  ]);
  // The opening line is the one most books opened at (ties: the lower line).
  const best = new Map<string, { line: number; n: number }>();
  for (const r of openers) {
    const k = scanKey(r.subject_id, r.market);
    const n = Number(r.n);
    const cur = best.get(k);
    if (!cur || n > cur.n || (n === cur.n && r.point! < cur.line)) best.set(k, { line: r.point!, n });
  }
  const open: Record<string, number> = {};
  for (const [k, v] of best) open[k] = v.line;
  const pulled: Record<string, number> = {};
  for (const r of pulls) pulled[scanKey(r.subject_id, r.market_key, r.line)] = Number(r.n);
  if (!edgeRows) return { open, pulled };
  // P11: the best edge per row (readEdges orders by EV, so the first seen wins).
  const edges: NonNullable<ScanExtras['edges']> = {};
  for (const e of edgeRows) {
    const k = scanKey(e.subjectId, e.marketKey, e.line);
    if (!edges[k]) edges[k] = { book: e.book, side: e.side, price: e.price, ev: e.ev };
  }
  return { open, pulled, edges };
}

// ---------------------------------------------------------------------------
// Edges (P11, E1 + O6): read only. Python's marketEdgeJob computes every gate
// and writes `market_edges`; nothing here computes an edge.
// ---------------------------------------------------------------------------
const FLAG_TTL_MS = 30_000;
let flagCache: { at: number; flags: Record<string, Record<string, unknown>> } | null = null;

/** `app_flags`, cached 30 s in-process: the kill switch reaches every page within that. */
export async function readFlags(): Promise<Record<string, Record<string, unknown>>> {
  if (flagCache && Date.now() - flagCache.at < FLAG_TTL_MS) return flagCache.flags;
  const rows = await pgAll<{ key: string; value: Record<string, unknown> }>(
    `SELECT key, value FROM app_flags WHERE key IN ('edge_display', 'edge_auto_off')`);
  const flags = Object.fromEntries(rows.map(r => [r.key, typeof r.value === 'string' ? JSON.parse(r.value) : r.value]));
  flagCache = { at: Date.now(), flags };
  return flags;
}

/** Edges may show only while the operator's switch is on and the gate-9 self-check is not. */
export async function edgesVisible(): Promise<boolean> {
  const f = await readFlags();
  return f.edge_display?.enabled !== false && f.edge_auto_off?.on !== true;
}

/** American price of a probability — restating the stored fair probability, not computing an edge. */
function americanOf(p: number): number {
  return p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

/**
 * The passing edges for some games (and one player), or `null` while edges are
 * hidden — callers then leave `edges` off the payload entirely.
 */
export async function readEdges(scope: { gameIds: string[]; subjectId?: string; kind?: 'prop' | 'game' }): Promise<MarketEdge[] | null> {
  if (!scope.gameIds.length || !(await edgesVisible())) return null;
  const rows = await pgAll<{ kind: 'prop' | 'game'; sport: string; game_id: string; subject_id: string; period: string;
    market: string; side: string; line: number | null; bookmaker: string; provider: string; soft_american: number;
    fair_prob: number; edge_pts: number; ev: number; reference: Record<string, any>; soft_checked_at: unknown;
    soft_since: unknown; sharp_checked_at: unknown; passing_since: unknown; single_source: boolean }>(
    `SELECT kind, sport, game_id, subject_id, period, market, side, line, bookmaker, provider, soft_american, fair_prob,
            edge_pts, ev, reference, soft_checked_at, soft_since, sharp_checked_at, passing_since, single_source
       FROM market_edges
      WHERE game_id = ANY(?) AND (?::text IS NULL OR subject_id = ?) AND (?::text IS NULL OR kind = ?)
        -- Fail safe: marketEdgeJob rewrites this table every 2-5 minutes (the
        -- worker runs one job at a time, so "every 2 min" is a floor). If it
        -- stops, its last edges must not stay on the pages as if current.
        AND computed_at > now() - interval '10 minutes'
      ORDER BY ev DESC`,
    [scope.gameIds, scope.subjectId ?? null, scope.subjectId ?? null, scope.kind ?? null, scope.kind ?? null]);
  return rows.map(r => {
    const ref = typeof r.reference === 'string' ? JSON.parse(r.reference) : r.reference ?? {};
    return {
      kind: r.kind, sport: r.sport, gameId: r.game_id, subjectId: r.subject_id, subjectName: ref.subject_name ?? null,
      marketKey: r.kind === 'game' ? `${r.period}_${r.market}` : r.market,
      side: r.side, line: r.line, book: r.bookmaker, source: r.provider, price: r.soft_american,
      fair: r.fair_prob, fairPrice: americanOf(r.fair_prob), implied: r.fair_prob - r.edge_pts, edgePts: r.edge_pts, ev: r.ev,
      softCheckedAt: iso(r.soft_checked_at), softSince: iso(r.soft_since), sharpCheckedAt: iso(r.sharp_checked_at),
      passingSince: iso(r.passing_since), singleSource: r.single_source,
      reference: {
        book: ref.book ?? 'pinnacle', prices: ref.prices ?? {}, limit: ref.limit ?? null, priceTime: ref.price_time ?? null,
        second: ref.second ? { book: ref.second.book, fair: ref.second.fair } : null,
      },
    } satisfies MarketEdge;
  });
}

/** The job's own breadcrumb: when marketEdgeJob last finished. */
async function edgeJobAge(): Promise<number | null> {
  const [row] = await pgAll<{ at: unknown }>(
    `SELECT fetched_at AS at FROM snapshot_cache WHERE cache_key = 'python-harness:job-run:marketEdgeJob'`);
  return row ? (Date.now() - Date.parse(iso(row.at))) / 1000 : null;
}

/**
 * Why edges show or not, and Python's evaluation of every market line for the
 * Edge card (P11 follow-up, operator 2026-09-26: the card is never blank).
 * `off` = the operator's kill switch; `paused` = the gate-9 self-check (the
 * card shows the held numbers, marked NO EDGE, with the self-check failing);
 * `stale` = the job has not run for 5 minutes (nothing is current, so no
 * numbers). Read only: every number here is Python's.
 */
export async function readEdgeView(scope: { gameIds: string[]; subjectId?: string; kind?: 'prop' | 'game' }): Promise<EdgeView> {
  const f = await readFlags();
  if (f.edge_display?.enabled === false) return { status: 'off', reason: 'Edges are switched off.' };
  const age = await edgeJobAge();
  // The worker's queue runs this job every 2-5 min; 15 min without a run means it stopped.
  if (age == null || age > 900) {
    return { status: 'stale', reason: age == null ? 'The edge check has not run yet.' : `The edge check last ran ${Math.round(age / 60)} min ago.` };
  }
  const paused = f.edge_auto_off?.on === true;
  const rows = await pgAll<{ kind: string; subject_id: string; period: string; market: string; line: number | null;
    best: Record<string, any> | string | null; reason: string | null; sharp: Record<string, any> | string | null }>(
    `SELECT kind, subject_id, period, market, line, best, reason, sharp FROM market_edge_candidates
      WHERE game_id = ANY(?) AND (?::text IS NULL OR subject_id = ?) AND (?::text IS NULL OR kind = ?)`,
    [scope.gameIds, scope.subjectId ?? null, scope.subjectId ?? null, scope.kind ?? null, scope.kind ?? null]);
  const obj = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, any> | null;
  const candidates: EdgeCandidate[] = rows.map(r => {
    const b = obj(r.best);
    const sh = obj(r.sharp);
    return {
      marketKey: r.kind === 'game' ? `${r.period}_${r.market}` : r.market,
      subjectId: r.subject_id, line: r.line, reason: r.reason,
      sharp: sh ? { book: sh.book ?? 'pinnacle', prices: sh.prices ?? {}, limit: sh.limit ?? null } : null,
      best: b ? {
        side: b.side, book: b.book, price: b.price, fair: b.fair, fairPrice: americanOf(b.fair), implied: b.implied,
        edgePts: b.edge_pts, ev: b.ev, passed: !!b.passed, firstFailure: b.first_failure ?? null,
        gates: (b.gates ?? []).map((g: [string, boolean, string]) => ({ gate: g[0], ok: g[1], detail: g[2] ?? '' })),
      } : null,
    };
  });
  return { status: paused ? 'paused' : 'on', reason: paused ? String(f.edge_auto_off?.reason ?? 'The self-check is holding edges back.') : null,
    asOf: new Date(Date.now() - age * 1000).toISOString(), candidates };
}

/**
 * The Slate's Edge / EV ranking (slate-polish D): the best soft price on each
 * market line of these games against Pinnacle's no-vig price, as
 * marketEdgeJob stored it in `market_edge_candidates` — real edges first
 * (passing every gate, or held only by the self-check), then the highest EV.
 *
 * WHAT IS LEFT OUT, and why: a line whose first failure is gate 1 (no sharp
 * reference to trust) or gate 8 (over the 8% cap or a lone outlier — a
 * probable data error, not an offer), and any EV above that same cap. The
 * rest is shown with its status, so a night with no edge still says what the
 * best prices were and why none passed — the card is never blank.
 *
 * It honours the operator's switch and a stopped job the same way
 * `readEdgeView` does; the self-check does NOT hide it — its rows show as
 * held, which is the honest reading of that state.
 */
export async function readEdgeRanking(scope: { gameIds: string[]; limit?: number }): Promise<EdgeRanking> {
  const f = await readFlags();
  if (f.edge_display?.enabled === false) return { status: 'off', reason: 'Edges are switched off.' };
  const age = await edgeJobAge();
  if (age == null || age > 900) {
    return { status: 'stale', reason: age == null ? 'The edge check has not run yet.' : `The edge check last ran ${Math.round(age / 60)} min ago.` };
  }
  const paused = f.edge_auto_off?.on === true;
  const rows = await pgAll<{ kind: 'prop' | 'game'; game_id: string; subject_id: string; period: string; market: string;
    line: number | null; best: Record<string, any> | string }>(
    `SELECT kind, game_id, subject_id, period, market, line, best FROM market_edge_candidates
      WHERE game_id = ANY(?) AND best IS NOT NULL
        AND coalesce(best->>'first_failure', '') NOT IN ('g1_reference', 'g8_cap_outlier')
        AND (best->>'ev')::float <= 0.08
      ORDER BY (coalesce(best->>'first_failure', '') IN ('', 'g9_self_check')) DESC, (best->>'ev')::float DESC
      LIMIT ?`,
    [scope.gameIds, scope.limit ?? 10]);
  const out: EdgeRankRow[] = rows.map(r => {
    const b = (typeof r.best === 'string' ? JSON.parse(r.best) : r.best) as Record<string, any>;
    const first: string | null = b.first_failure ?? null;
    const failed = first ? (b.gates ?? []).find((g: [string, boolean, string]) => g[0] === first) : null;
    return {
      kind: r.kind, gameId: r.game_id, subjectId: r.subject_id,
      marketKey: r.kind === 'game' ? `${r.period}_${r.market}` : r.market,
      line: r.line == null ? null : Number(r.line), side: b.side, book: b.book, price: b.price,
      fair: b.fair, fairPrice: americanOf(b.fair), ev: b.ev,
      status: first == null ? 'edge' : first === 'g9_self_check' ? 'held' : 'unverified',
      gate: first, detail: failed ? String(failed[2] ?? '') : null,
    };
  });
  return { status: paused ? 'paused' : 'on', reason: paused ? String(f.edge_auto_off?.reason ?? 'The self-check is holding edges back.') : null,
    asOf: new Date(Date.now() - age * 1000).toISOString(), rows: out };
}
