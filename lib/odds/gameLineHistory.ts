/**
 * Price movement for a GAME market — Phase 6.22.
 *
 * The prop twin of this (`lib/odds/props/lineHistory.ts`) has shipped on Player
 * Detail since 6.16. This is the same card for the moneyline, spread and total
 * a game page is actually about, and the same card the design board draws on
 * the Team tab for a team's next game.
 *
 * ============== WHY A SEPARATE READER, NOT A SHARED ONE ==============
 *
 * The two logs are not the same table and not the same key.
 * `prop_odds_history` is keyed `(game_id, subject_id, market_key, line, side)`;
 * `game_odds_history` is keyed `(event_id, market, side)` and has no subject at
 * all. A single reader over both would take a union of two key shapes and a
 * branch on which one it got, which is more code than two readers and hides
 * which table a caller is actually hitting.
 *
 * What IS shared is the bucketing contract — the ladder, the cap, and
 * last-value-wins — imported from the prop module rather than re-derived, so
 * the two cards cannot disagree about what a point on the x-axis means.
 *
 * ============== THERE IS NO `sport` COLUMN, AND THAT IS FINE ==============
 *
 * `game_odds_history` carries `event_id`, `market`, `side`, `bookmaker`,
 * `american_odds`, `point`, `observed_at`, `source`. Every caller already
 * knows its own event id, so this keys on that and invents no join. Measured
 * 2026-08-31: 59,097 rows over 559 events and 20 days, and **1,225
 * (event, market, side) groups carry three or more distinct timestamps** —
 * which is the real question, since a series with one point is not movement.
 *
 * ============== `point` IS THE HANDICAP, AND IT MOVES ==============
 *
 * A total of 8.5 becoming 9 is the most important thing this card can show,
 * so `point` travels on every observation exactly as `line` does on the prop
 * side. It is null on a moneyline, which has no handicap — the same "null
 * means none, never mixed" rule the prop reader documents.
 */

import { pgAll } from '@/lib/db/pgClient';
import { bucketSecondsFor } from '@/lib/odds/props/lineHistory';
import type { LineHistoryPoint, LineHistorySeries } from '@/lib/odds/props/lineHistory';

/** The three markets `game_odds_history` actually holds. Measured: moneyline 558 events, total 277, spread 68. */
export const GAME_HISTORY_MARKETS = ['moneyline', 'total', 'spread'] as const;
export type GameHistoryMarket = (typeof GAME_HISTORY_MARKETS)[number];

export interface GameLineHistoryQuery {
  eventId: string;
  market: GameHistoryMarket;
  /** 'home' | 'away' | 'over' | 'under' | 'draw' — whatever the writer recorded for this market. */
  side: string;
  hours: number;
  /**
   * The game's start, ISO with a time. With it, pre-game history is the `hours`
   * ending AT the start and in-game history comes back separately (R2). Without
   * it the window ends now and nothing is split, which is only right for a game
   * that has not started.
   */
  startsAt?: string | null;
}

export interface GameLineSeriesBlock {
  bucketSeconds: number;
  buckets: string[];
  series: LineHistorySeries[];
}

export interface GameLineHistoryResult extends GameLineSeriesBlock {
  eventId: string;
  market: string;
  side: string;
  /** Handicap the series is for, or `null` for a market with none (moneyline). */
  resolvedPoint: number | null;
  /** Sides actually present for this event and market, so a caller can offer the other one. */
  availableSides: string[];
  /** Echo of the start the split used; `null` when none was given. */
  startsAt: string | null;
  /** Prices observed after the start. `null` when no start was given or the game has not started. */
  inGame: GameLineSeriesBlock | null;
}

/**
 * An in-game block runs at most this long past the start. `game_odds_history`
 * keeps capturing after the final whistle, and a price quoted the next morning
 * is neither pre-game nor in-game.
 */
export const IN_GAME_HOURS = 8;

export interface HistoryWindows {
  pre: { from: Date; to: Date };
  inGame: { from: Date; to: Date } | null;
}

/**
 * R2's pre-start split, as plain time windows — pure so the rule is tested
 * directly. Measured on the G2 fixture (MLB KC @ BOS, pk 824711): 1,790 of the
 * 2,782 `game_odds_history` rows were observed after first pitch, so a window
 * that ends "now" draws a game's in-play swings as if they were the pre-game
 * market.
 *
 * `from` is exclusive and `to` inclusive, so a quote stamped exactly at the
 * start counts as pre-game.
 */
export function historyWindows(startsAt: string | null | undefined, hours: number, now: Date = new Date()): HistoryWindows {
  const start = startsAt && startsAt.includes('T') ? new Date(startsAt) : null;
  if (!start || !Number.isFinite(start.getTime()) || start > now) {
    return { pre: { from: new Date(now.getTime() - hours * 3600_000), to: now }, inGame: null };
  }
  const inGameEnd = new Date(Math.min(now.getTime(), start.getTime() + IN_GAME_HOURS * 3600_000));
  return {
    pre: { from: new Date(start.getTime() - hours * 3600_000), to: start },
    inGame: { from: start, to: inGameEnd },
  };
}

async function readBlock(q: GameLineHistoryQuery, from: Date, to: Date, bucketSeconds: number) {
  if (!Number.isInteger(bucketSeconds) || bucketSeconds <= 0) throw new Error('bucketSeconds must be a positive integer');
  const rows = await pgAll<{
    bookmaker: string;
    bucket: Date | string;
    point: number | null;
    american_odds: number | null;
  }>(
    `SELECT DISTINCT ON (bookmaker, bucket)
            bookmaker,
            to_timestamp(floor(extract(epoch FROM observed_at) / ${bucketSeconds}) * ${bucketSeconds}) AS bucket,
            point,
            american_odds
       FROM game_odds_history
      WHERE event_id = ? AND market = ? AND side = ?
        AND observed_at > ? AND observed_at <= ?
      -- DESC on observed_at makes DISTINCT ON take the LAST real observation in
      -- each bucket rather than the first, so a bucket reads as "where the
      -- price ended up" rather than "where it happened to start".
      ORDER BY bookmaker, bucket, observed_at DESC`,
    [q.eventId, q.market, q.side, from.toISOString(), to.toISOString()],
  );

  const byBook = new Map<string, LineHistoryPoint[]>();
  const bucketSet = new Set<string>();
  const pointCounts = new Map<number, number>();
  for (const r of rows) {
    const t = (r.bucket instanceof Date ? r.bucket : new Date(r.bucket)).toISOString();
    bucketSet.add(t);
    const point = r.point == null ? null : Number(r.point);
    if (point != null && Number.isFinite(point)) pointCounts.set(point, (pointCounts.get(point) ?? 0) + 1);
    const points = byBook.get(r.bookmaker) ?? [];
    points.push({ t, line: point, americanOdds: r.american_odds == null ? null : Number(r.american_odds) });
    byBook.set(r.bookmaker, points);
  }

  const series: LineHistorySeries[] = [...byBook.entries()]
    .map(([bookmaker, points]) => ({ bookmaker, points: points.sort((a, b) => a.t.localeCompare(b.t)) }))
    // Most-observed book first: a book with two points in a week is not a
    // movement story, and a caller showing only a few series should get the
    // ones that have something to show.
    .sort((a, b) => b.points.length - a.points.length || a.bookmaker.localeCompare(b.bookmaker));

  return { block: { bucketSeconds, buckets: [...bucketSet].sort(), series }, pointCounts };
}

export async function readGameLineHistory(q: GameLineHistoryQuery): Promise<GameLineHistoryResult> {
  const bucketSeconds = bucketSecondsFor(q.hours);

  // `hours` sizes the window and `bucketSeconds` reaches a divisor in the SQL,
  // so both must be numbers THIS module chose rather than caller text. The
  // window bounds themselves are passed as parameters.
  if (!Number.isInteger(bucketSeconds) || bucketSeconds <= 0) throw new Error('bucketSeconds must be a positive integer');
  if (!Number.isFinite(q.hours) || q.hours <= 0) throw new Error('hours must be a positive number');
  const hours = Math.round(q.hours);
  const windows = historyWindows(q.startsAt, hours);

  const sideRows = await pgAll<{ side: string; n: string }>(
    `SELECT side, count(*) AS n
       FROM game_odds_history
      WHERE event_id = ? AND market = ?
        AND observed_at > ? AND observed_at <= ?
      GROUP BY side
      ORDER BY count(*) DESC`,
    [q.eventId, q.market, windows.pre.from.toISOString(), (windows.inGame?.to ?? windows.pre.to).toISOString()],
  );
  const availableSides = sideRows.map((r) => r.side);

  const pre = await readBlock(q, windows.pre.from, windows.pre.to, bucketSeconds);
  const inGame = windows.inGame ? (await readBlock(q, windows.inGame.from, windows.inGame.to, bucketSecondsFor(IN_GAME_HOURS))).block : null;

  // The most-quoted handicap, for the caption. NOT a filter: unlike a prop's
  // alternate lines, a game total genuinely MOVING from 8.5 to 9 is the story
  // this card exists to tell, so every observation stays in the series and this
  // only names where the market mostly sat. Pre-game only: an in-play total is
  // a different market.
  const resolvedPoint =
    [...pre.pointCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;

  return {
    eventId: q.eventId,
    market: q.market,
    side: q.side,
    resolvedPoint,
    availableSides,
    startsAt: q.startsAt ?? null,
    inGame,
    ...pre.block,
  };
}

// ---------------------------------------------------------------------------
// Open and close (R8)
// ---------------------------------------------------------------------------

export interface GameQuote {
  market: string;
  side: string;
  bookmaker: string;
  point: number | null;
  americanOdds: number;
  observedAt: string;
}

export interface MainGameLine {
  market: GameHistoryMarket;
  /** Per side: the point (a spread's sign is the side's own) and the median price there. */
  sides: Array<{ side: string; point: number | null; americanOdds: number | null }>;
  /** Books quoting both sides at the main line. */
  books: number;
}

export interface GameLineOpenClose {
  market: GameHistoryMarket;
  open: MainGameLine | null;
  close: MainGameLine | null;
}

const implied = (american: number) => (american > 0 ? 100 / (american + 100) : -american / (-american + 100));
const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
};
/** How far from the nearest-even line another line may sit and still count as main (implied probability). */
export const MAIN_LINE_EVEN_TOLERANCE = 0.03;

const PAIRS: Record<GameHistoryMarket, [string, string]> = { moneyline: ['away', 'home'], spread: ['away', 'home'], total: ['over', 'under'] };

/**
 * The main game line from a set of quotes (one per book, side and point) — R8,
 * the prop rule of R2 applied to game markets.
 *
 * NEAREST EVEN, NOT MOST BOOKS. Measured on SF @ STL (pk 823004): eight books
 * closed the total at 8 (-115/-105), and thirteen exchanges and offshore books
 * carried 9.5 at +150 to +170 over -175 to -215 under — an alternate line.
 * "Most books quoting both sides" picked 9.5. The main line is the point whose
 * two sides are nearest a coin flip, among points at least two books quote on
 * both sides.
 *
 * SUPERSEDED QUOTES ARE DROPPED first: `game_odds_history` keeps every point a
 * book ever hung, so DraftKings' 8.5 from 05:39 sat beside its 8 from 16:00. A
 * quote older than its book's newest in the market by more than 30 minutes does
 * not count (`SUPERSEDED_AFTER_MS`'s reasoning for props). Pass `dropSuperseded:
 * false` for opening quotes, which are old by definition.
 *
 * A spread's two sides carry opposite signs, so points are paired on |point|.
 */
export function mainGameLine(market: GameHistoryMarket, quotes: GameQuote[], options: { dropSuperseded: boolean }): MainGameLine | null {
  let qs = quotes.filter((q) => q.market === market && Number.isFinite(q.americanOdds));
  if (options.dropSuperseded) {
    const newest = new Map<string, number>();
    for (const q of qs) newest.set(q.bookmaker, Math.max(newest.get(q.bookmaker) ?? 0, Date.parse(q.observedAt)));
    qs = qs.filter((q) => Date.parse(q.observedAt) >= newest.get(q.bookmaker)! - 30 * 60_000);
  }
  const [aSide, bSide] = PAIRS[market];
  const key = (q: GameQuote) => (q.point == null ? 'null' : String(Math.abs(q.point)));
  const byPoint = new Map<string, { a: Map<string, GameQuote>; b: Map<string, GameQuote> }>();
  for (const q of qs) {
    if (q.side !== aSide && q.side !== bSide) continue;
    const g = byPoint.get(key(q)) ?? { a: new Map(), b: new Map() };
    (q.side === aSide ? g.a : g.b).set(q.bookmaker, q);
    byPoint.set(key(q), g);
  }
  const candidates: Array<{ k: string; books: string[]; imbalance: number }> = [];
  for (const [k, g] of byPoint) {
    const books = [...g.a.keys()].filter((b) => g.b.has(b));
    if (books.length < 2) continue;
    const imbalance = books.reduce((sum, b) => sum + Math.abs(implied(g.a.get(b)!.americanOdds) - implied(g.b.get(b)!.americanOdds)), 0) / books.length;
    candidates.push({ k, books, imbalance });
  }
  if (!candidates.length) return null;
  // Among the lines within 3 points of the nearest-even one, the one most books
  // quote: KC @ BOS closed 8.5 at -105/-115 across 11 books and 8 at -125/-115
  // across 2, and 8 sat 0.002 nearer even. Nearest even rules out an alternate;
  // book count then picks between genuinely near-even lines.
  //
  // A SPREAD IS NOT PRICED NEAR EVEN: MLB's run line is +-1.5 at around
  // -160/+140, and 824382 opened with two books at +-1 near -110 each, an
  // alternate that nearest-even would pick. For spreads, most books wins.
  const nearest = Math.min(...candidates.map((c) => c.imbalance));
  const best =
    market === 'spread'
      ? [...candidates].sort((x, y) => y.books.length - x.books.length || x.imbalance - y.imbalance)[0]
      : candidates.filter((c) => c.imbalance <= nearest + MAIN_LINE_EVEN_TOLERANCE).sort((x, y) => y.books.length - x.books.length || x.imbalance - y.imbalance)[0];
  const g = byPoint.get(best.k)!;
  const sideOf = (m: Map<string, GameQuote>, side: string) => {
    const at = best.books.map((b) => m.get(b)!);
    return { side, point: at[0].point, americanOdds: median(at.map((q) => q.americanOdds)) };
  };
  return { market, sides: [sideOf(g.a, aSide), sideOf(g.b, bSide)], books: best.books.length };
}

/**
 * Where each game market opened and closed BEFORE the start (R2's split), at
 * its main line (`mainGameLine`). The game page's lines card and result-vs-line
 * chips read this (R8). A start in the future means the game has not begun, and
 * "close" is the latest so far.
 */
export async function readPreGameOpenClose(eventId: string, startsAt: string): Promise<GameLineOpenClose[]> {
  const start = new Date(startsAt);
  const to = Number.isFinite(start.getTime()) && start < new Date() ? start : new Date();
  const rows = await pgAll<{ which: 'open' | 'close'; market: string; side: string; bookmaker: string; point: number | null; american_odds: number; observed_at: Date | string }>(
    `SELECT * FROM (
       SELECT DISTINCT ON (market, side, bookmaker, point) 'open' AS which, market, side, bookmaker, point, american_odds, observed_at
         FROM game_odds_history WHERE event_id = ? AND observed_at <= ? AND american_odds IS NOT NULL
        ORDER BY market, side, bookmaker, point, observed_at ASC
     ) o
     UNION ALL
     SELECT * FROM (
       SELECT DISTINCT ON (market, side, bookmaker, point) 'close' AS which, market, side, bookmaker, point, american_odds, observed_at
         FROM game_odds_history WHERE event_id = ? AND observed_at <= ? AND american_odds IS NOT NULL
        ORDER BY market, side, bookmaker, point, observed_at DESC
     ) c`,
    [eventId, to.toISOString(), eventId, to.toISOString()],
  );
  const toQuote = (r: (typeof rows)[number]): GameQuote => ({
    market: r.market,
    side: r.side,
    bookmaker: r.bookmaker,
    point: r.point == null ? null : Number(r.point),
    americanOdds: Number(r.american_odds),
    observedAt: (r.observed_at instanceof Date ? r.observed_at : new Date(r.observed_at)).toISOString(),
  });
  const open = rows.filter((r) => r.which === 'open').map(toQuote);
  const close = rows.filter((r) => r.which === 'close').map(toQuote);
  // Opening quotes: each book's FIRST quote at a point. The earliest of those per
  // book is its opening board; later points it added are moves, not the open.
  const firstPerBook = (() => {
    const earliest = new Map<string, number>();
    for (const q of open) earliest.set(`${q.market}|${q.bookmaker}`, Math.min(earliest.get(`${q.market}|${q.bookmaker}`) ?? Infinity, Date.parse(q.observedAt)));
    return open.filter((q) => Date.parse(q.observedAt) <= earliest.get(`${q.market}|${q.bookmaker}`)! + 30 * 60_000);
  })();
  return GAME_HISTORY_MARKETS.map((market) => ({
    market,
    open: mainGameLine(market, firstPerBook, { dropSuperseded: false }),
    close: mainGameLine(market, close, { dropSuperseded: true }),
  })).filter((x) => x.open || x.close);
}
