/**
 * The Slate's market reads: Movers (MV1–MV2) and the two market-shape cards
 * (S2).
 *
 * Three questions, all answered in POSTGRES rather than in Node, because the
 * tables are large and the answers are small: `prop_odds_history` holds 1.8
 * million rows over three days and 120,495 prop lines that have moved in the
 * last 36 hours, and `prop_odds` holds 591,923 current quotes. Pulling any of
 * that over the wire to reduce it here is how this app already got a 2.26
 * GB/day egress line on its bill (`db.py`'s own note). Each reader below
 * returns tens of rows.
 *
 * "SINCE FIRST SEEN", NEVER "SINCE OPEN. The opener is not held —
 * `odds_archive.open_line` / `open_price` were null on every live row when it
 * was measured (0 of 21,476 since 2026-09-08). What these read is the FIRST
 * OBSERVATION we made of that book's price, which is a different and weaker
 * claim, and every caption says so. A guard test asserts the phrase "since
 * open" never appears in Slate copy.
 *
 * MOVEMENT IS MARKET INFORMATION, NOT A PREDICTION. Nothing here computes an
 * edge, and nothing compares a move to a model.
 */

import { pgAll } from '../db/pgClient';

/** Implied probability from American odds, as a SQL expression over `col`. */
const IMPLIED = (col: string) => `(CASE WHEN ${col} > 0 THEN 100.0 / (${col} + 100) ELSE (-${col})::numeric / ((-${col}) + 100) END)`;

/**
 * The same sanity bounds the Slate's line reading uses (SL-1): a quote under
 * ±100 is not a price, and a game line beyond ±5000 is a mis-keyed row. Applied
 * in SQL so a junk quote never becomes the biggest "mover" on the page.
 */
const SANE = (col: string) => `${col} IS NOT NULL AND abs(${col}) >= 100 AND abs(${col}) <= 5000`;

/**
 * A PROP price beyond this is not an offer anyone can take.
 *
 * Tighter than the game-line bound on purpose. Measured on the first real run:
 * DraftKings at +4800 against a +487 median, and Kalshi swinging -4900 to
 * +4900. A real prop price lives inside ±2000 and nearly all of them inside
 * ±600.
 */
const SANE_PROP = (col: string) => `${col} IS NOT NULL AND abs(${col}) >= 100 AND abs(${col}) <= 2000`;


/**
 * Pick'em apps never count as a price (R2, `mainLine.ts`): their fixed
 * +100-style payout is not a market view, so a "move" in one is noise.
 */
const PICKEM = ['prizepicks', 'underdog', 'sleeper', 'dabble', 'parlayplay', 'betr', 'chalkboard', 'pick6'];

/* ------------------------------------------------------------------ Movers */

/**
 * MOVERS (MV1–MV2, `docs/design/movers-and-spotlights-gameplan.md`).
 *
 * S2 left Movers out because the largest "moves" were a few books swinging 25
 * points on an unchanged line (SL-18). Re-measured, that was mostly LIVE
 * pricing: the history tables keep logging after first pitch and the old
 * readers never cut there. MLB props moved more than 10 points on 0.3% of
 * pre-game changes and 18.1% of live ones (SL-29). What remains pre-game is
 * FLICKER — Fanatics undoes up to half its changes on the very next quote.
 * So these readers are built on five rules, each pinned in
 * `tests/slate-shell.test.ts`:
 *
 *   1. PRE-GAME ONLY. An observation at or after the game's start never
 *      counts, and only games that have not started are read at all.
 *   2. NET, NOT SUMMED. Each book contributes its first pre-game price and
 *      its latest, so an A→B→A flicker nets to nothing.
 *   3. THE CONSENSUS IS THE MOVE. The headline is the median implied
 *      probability across books, first seen vs now, over at least
 *      `MIN_CONSENSUS_BOOKS` books. One book re-pricing alone never makes a
 *      row (D-M3): at least `MIN_BOOKS_MOVED` must have moved.
 *   4. NOT EVERY QUOTE IS A PRICE. Pick'em apps and exchanges are left out of
 *      the consensus (D-M1): PrizePicks sat ≥4 points off the cross-book
 *      median on 88% of quotes, ProphetX on 40%.
 *   5. THE S2 SANITY BOUNDS STAND. ±100 and beyond ±2000 (props) / ±5000
 *      (game lines) are not prices.
 *
 * Movement is market information, not a prediction. Nothing here compares a
 * move to a model.
 */

/** Out of the consensus (D-M1). Pick'em payouts are fixed; exchanges quote thin books. */
export const CONSENSUS_EXCLUDED = [...PICKEM, 'prophetx', 'novig', 'kalshi', 'polymarket', 'smarkets', 'matchbook'] as const;

/** A consensus needs this many books quoting the same line and side. */
export const MIN_CONSENSUS_BOOKS = 3;

/** And this many of them must have moved: one book alone is not the market (D-M3). */
export const MIN_BOOKS_MOVED = 2;

/** A consensus move smaller than this is inside the measured pre-game noise (~1 pt). */
export const MIN_MOVE_PTS = 1.5;

/** Steam: this many consensus books moving the same way within `STEAM_WINDOW_S`, each by ≥ `STEAM_STEP`. */
export const STEAM_BOOKS = 3;
export const STEAM_WINDOW_S = 30 * 60;
const STEAM_STEP = 0.02;

export type MoverKind = 'props' | 'lines';
export type MoverWindow = 'first' | 'h3' | 'h1';

/** One game on the slate that has not started yet. */
export interface MoverGame {
  id: string;
  startsAt: string;
  matchup?: string | null;
}

export interface ConsensusMover {
  kind: MoverKind;
  gameId: string;
  matchup: string | null;
  /** Null for a game line: the subject is the game. */
  subjectId: string | null;
  subjectName: string | null;
  market: string;
  side: string;
  /** The main line now, and where the main line was when we first saw it. */
  line: number | null;
  lineFirst: number | null;
  /** The consensus price (from the median implied probability), first seen and now. */
  priceFirst: number;
  priceNow: number;
  /** Consensus move in implied-probability POINTS, per window. The sort key. */
  moves: Record<MoverWindow, number>;
  booksMoved: number;
  booksQuoting: number;
  firstMoveAt: string | null;
  /** Other lines of the same market and side that moved too. */
  otherLinesMoved: number;
  steam: boolean;
  split: boolean;
  /** Hourly consensus implied probability, in POINTS (0–100), oldest first. */
  trend: number[];
}

/** American odds from an implied probability. */
export function americanFromImplied(p: number): number {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.round(q >= 0.5 ? (-100 * q) / (1 - q) : (100 * (1 - q)) / q);
}

/**
 * Steam, from each moving book's single largest pre-game step: are there
 * `STEAM_BOOKS` distinct books, all moving the same way, inside one
 * `STEAM_WINDOW_S` window? Books whose largest step went against their own
 * net move (a flicker) were already left out in SQL.
 */
export function isSteam(steps: Array<{ t: number; sign: number }>): boolean {
  for (const sign of [1, -1]) {
    const ts = steps.filter((s) => s.sign === sign).map((s) => s.t).sort((a, b) => a - b);
    for (let i = 0; i + STEAM_BOOKS - 1 < ts.length; i++) if (ts[i + STEAM_BOOKS - 1] - ts[i] <= STEAM_WINDOW_S) return true;
  }
  return false;
}

/**
 * Split: the line moved one way and the price at the main line the other.
 * For the over (or the home spread) a higher line leans over; if the over has
 * got LESS likely at the same time, the two signals disagree. A home SPREAD
 * leans home when it goes DOWN (-3.5 → -4.5), so it passes `leans = -1`.
 */
export function isSplit(lineFirst: number | null, line: number | null, movePts: number, leans: 1 | -1 = 1): boolean {
  if (lineFirst == null || line == null || lineFirst === line || movePts === 0) return false;
  return Math.sign((line - lineFirst) * leans) !== Math.sign(movePts);
}

interface MoverSource {
  table: string;
  id: string;
  subject: string;
  market: string;
  line: string;
  bound: number;
}

const SOURCES: Record<MoverKind, MoverSource> = {
  props: { table: 'prop_odds_history', id: 'game_id', subject: 't.subject_id', market: 'market_key', line: 'line', bound: 2000 },
  lines: { table: 'game_odds_history', id: 'event_id', subject: 'NULL::text', market: 'market', line: 'point', bound: 5000 },
};

/** Pre-game observations for upcoming games, sane prices, consensus books only. */
function preGameCte(src: MoverSource): string {
  return `s AS (SELECT unnest(?::text[]) AS gid, unnest(?::timestamptz[]) AS starts_at),
     h AS (
       SELECT t.${src.id}::text AS game_id, ${src.subject} AS subject_id, t.${src.market} AS market, t.${src.line} AS line,
              t.side, t.bookmaker, t.observed_at, ${IMPLIED('t.american_odds')} AS p
       FROM ${src.table} t JOIN s ON s.gid = t.${src.id}::text
       WHERE t.observed_at < s.starts_at
         AND s.starts_at > now()
         AND t.observed_at > now() - interval '7 days'
         AND abs(t.american_odds) BETWEEN 100 AND ${src.bound}
         AND lower(t.bookmaker) <> ALL(?)
     )`;
}

/**
 * Every consensus key (game · subject · market · line · side) that moved, with
 * its medians at first seen, 3h ago, 1h ago and now, how many books quote and
 * moved, and each moving book's largest step for the Steam check.
 */
function consensusSql(src: MoverSource): string {
  const at = (interval: string) =>
    `coalesce((array_agg(p ORDER BY observed_at DESC) FILTER (WHERE observed_at <= now() - interval '${interval}'))[1], (array_agg(p ORDER BY observed_at))[1])`;
  return `WITH ${preGameCte(src)},
     w AS (
       SELECT *, first_value(p) OVER k AS p0, lag(p) OVER k AS prev_p
       FROM h WINDOW k AS (PARTITION BY game_id, subject_id, market, line, side, bookmaker ORDER BY observed_at)
     ),
     b AS (
       SELECT game_id, subject_id, market, line, side, bookmaker,
              (array_agg(p ORDER BY observed_at))[1] AS p_first,
              ${at('3 hours')} AS p_3h,
              ${at('1 hour')} AS p_1h,
              (array_agg(p ORDER BY observed_at DESC))[1] AS p_last,
              min(observed_at) FILTER (WHERE abs(p - p0) > 0.005) AS first_move_at,
              (array_agg(extract(epoch FROM observed_at) ORDER BY abs(p - prev_p) DESC) FILTER (WHERE abs(p - prev_p) >= ${STEAM_STEP}))[1] AS big_t,
              (array_agg(sign(p - prev_p) ORDER BY abs(p - prev_p) DESC) FILTER (WHERE abs(p - prev_p) >= ${STEAM_STEP}))[1] AS big_sign
       FROM w GROUP BY 1, 2, 3, 4, 5, 6
     ),
     k AS (
       SELECT game_id, subject_id, market, line, side, count(*) AS books,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY p_first) AS m_first,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY p_3h) AS m_3h,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY p_1h) AS m_1h,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY p_last) AS m_last,
              sum(CASE WHEN abs(p_last - p_first) > 0.005 THEN 1 ELSE 0 END) AS moved,
              min(first_move_at) AS first_move_at,
              array_agg(big_t) FILTER (WHERE big_t IS NOT NULL AND sign(p_last - p_first) = big_sign) AS steam_t,
              array_agg(big_sign) FILTER (WHERE big_t IS NOT NULL AND sign(p_last - p_first) = big_sign) AS steam_sign
       FROM b GROUP BY 1, 2, 3, 4, 5
       HAVING count(*) >= ${MIN_CONSENSUS_BOOKS}
     )
     SELECT * FROM k
     WHERE moved >= ${MIN_BOOKS_MOVED}
       AND greatest(abs(m_last - m_first), abs(m_last - m_3h), abs(m_last - m_1h)) * 100 >= ${MIN_MOVE_PTS}
     ORDER BY abs(m_last - m_first) DESC
     LIMIT 1500`;
}

/**
 * Where each (game · subject · market)'s MAIN line was first and is now. The
 * main line is the one priced nearest even money (the over, or the home
 * spread, closest to 50%), not the most common one: books post alternate lines
 * first, so "the line a book first quoted" read Davante Adams' receptions as
 * moving 1.5 → 5.5 when 5.5 was the main line throughout (MV1 run).
 */
function lineShiftSql(src: MoverSource): string {
  return `WITH ${preGameCte(src)},
     f AS (
       SELECT game_id, subject_id, market, line, bookmaker,
              (array_agg(p ORDER BY observed_at))[1] AS p_first,
              (array_agg(p ORDER BY observed_at DESC))[1] AS p_last
       FROM h WHERE side IN ('over', 'home') AND line IS NOT NULL
       GROUP BY 1, 2, 3, 4, 5
     ),
     l AS (
       SELECT game_id, subject_id, market, line, count(*) AS books,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY p_first) AS m_first,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY p_last) AS m_last
       FROM f GROUP BY 1, 2, 3, 4 HAVING count(*) >= ${MIN_CONSENSUS_BOOKS}
     ),
     a AS (SELECT DISTINCT ON (game_id, subject_id, market) game_id, subject_id, market, line AS line_first
           FROM l ORDER BY game_id, subject_id, market, abs(m_first - 0.5), books DESC),
     z AS (SELECT DISTINCT ON (game_id, subject_id, market) game_id, subject_id, market, line AS line_now
           FROM l ORDER BY game_id, subject_id, market, abs(m_last - 0.5), books DESC)
     SELECT a.game_id, a.subject_id, a.market, a.line_first, z.line_now
     FROM a JOIN z ON z.game_id = a.game_id AND z.subject_id IS NOT DISTINCT FROM a.subject_id AND z.market = a.market`;
}

/** Hourly consensus (median of that hour's quotes) for the chosen keys, over the 48 hours to now (or to the start). */
function trendSql(src: MoverSource): string {
  return `WITH s AS (SELECT unnest(?::text[]) AS gid, unnest(?::timestamptz[]) AS starts_at),
     k AS (SELECT * FROM unnest(?::text[], ?::text[], ?::text[], ?::float8[], ?::text[]) WITH ORDINALITY AS k(game_id, subject_id, market, line, side, idx))
     SELECT k.idx, date_trunc('hour', t.observed_at) AS hr,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY ${IMPLIED('t.american_odds')}) AS m
     FROM k
     JOIN ${src.table} t ON t.${src.id}::text = k.game_id
                        AND ${src.subject} IS NOT DISTINCT FROM k.subject_id
                        AND t.${src.market} = k.market
                        AND t.${src.line} IS NOT DISTINCT FROM k.line
                        AND t.side = k.side
     JOIN s ON s.gid = t.${src.id}::text
     WHERE t.observed_at < s.starts_at
       AND t.observed_at > least(now(), s.starts_at) - interval '48 hours'
       AND abs(t.american_odds) BETWEEN 100 AND ${src.bound}
       AND lower(t.bookmaker) <> ALL(?)
     GROUP BY 1, 2 ORDER BY 1, 2`;
}

export interface ConsensusKeyRow {
  gameId: string;
  subjectId: string | null;
  market: string;
  line: number | null;
  side: string;
  books: number;
  moved: number;
  mFirst: number;
  m3h: number;
  m1h: number;
  mLast: number;
  firstMoveAt: string | null;
  steps: Array<{ t: number; sign: number }>;
}

function toKey(r: Record<string, unknown>): ConsensusKeyRow {
  const ts = (r.steam_t as unknown[] | null) ?? [];
  const signs = (r.steam_sign as unknown[] | null) ?? [];
  return {
    gameId: String(r.game_id),
    subjectId: r.subject_id == null ? null : String(r.subject_id),
    market: String(r.market),
    line: r.line == null ? null : Number(r.line),
    side: String(r.side),
    books: Number(r.books),
    moved: Number(r.moved),
    mFirst: Number(r.m_first),
    m3h: Number(r.m_3h),
    m1h: Number(r.m_1h),
    mLast: Number(r.m_last),
    firstMoveAt: r.first_move_at == null ? null : new Date(String(r.first_move_at)).toISOString(),
    steps: ts.map((t, i) => ({ t: Number(t), sign: Number(signs[i]) })),
  };
}

/** The side a group's row is shown from: the over, the home spread, or the moneyline side the money moved toward. */
function preferredSide(kind: MoverKind, market: string, keys: ConsensusKeyRow[]): string {
  if (kind === 'props') return keys.some((k) => k.side === 'over') ? 'over' : keys[0].side;
  if (market === 'total') return 'over';
  if (market === 'spread') return 'home';
  const up = [...keys].sort((a, b) => b.mLast - b.mFirst - (a.mLast - a.mFirst))[0];
  return up.side;
}

/**
 * Pure: one row per (game · subject · market). Over and under mirror each
 * other, and a player's alternate lines all move together (MV0: one player
 * took six rows), so the group is shown once, at its main line, with a count
 * of the other lines that moved.
 */
export function collapseMovers(
  kind: MoverKind,
  keys: ConsensusKeyRow[],
  lineShift: Map<string, { first: number | null; now: number | null }>,
): Array<Omit<ConsensusMover, 'subjectName' | 'matchup' | 'trend'> & { key: ConsensusKeyRow }> {
  const groups = new Map<string, ConsensusKeyRow[]>();
  for (const k of keys) {
    const g = `${k.gameId}|${k.subjectId ?? ''}|${k.market}`;
    groups.set(g, [...(groups.get(g) ?? []), k]);
  }
  const out: Array<Omit<ConsensusMover, 'subjectName' | 'matchup' | 'trend'> & { key: ConsensusKeyRow }> = [];
  for (const [g, all] of groups) {
    const side = preferredSide(kind, all[0].market, all);
    const onSide = all.filter((k) => k.side === side);
    if (onSide.length === 0) continue;
    const shift = lineShift.get(g);
    const main = onSide.find((k) => shift?.now != null && k.line === shift.now) ?? [...onSide].sort((a, b) => b.books - a.books)[0];
    // The line history (first → now) and Split describe the MAIN line. When
    // the row is shown at another line (the main one did not move enough to
    // list), neither claim is made about it: a Split flag on a row whose own
    // line never changed was the first render's bug (DJ Herz, MV3).
    const atMain = shift?.now != null && main.line === shift.now;
    const moves: Record<MoverWindow, number> = {
      first: (main.mLast - main.mFirst) * 100,
      h3: (main.mLast - main.m3h) * 100,
      h1: (main.mLast - main.m1h) * 100,
    };
    out.push({
      kind,
      gameId: main.gameId,
      subjectId: main.subjectId,
      market: main.market,
      side,
      line: main.line,
      lineFirst: atMain ? (shift?.first ?? main.line) : main.line,
      priceFirst: americanFromImplied(main.mFirst),
      priceNow: americanFromImplied(main.mLast),
      moves,
      booksMoved: main.moved,
      booksQuoting: main.books,
      firstMoveAt: main.firstMoveAt,
      otherLinesMoved: onSide.length - 1,
      steam: isSteam(main.steps),
      split: atMain && !(kind === 'lines' && main.market === 'moneyline') && isSplit(shift?.first ?? null, shift?.now ?? null, moves.first, main.market === 'spread' ? -1 : 1),
      key: main,
    });
  }
  return out;
}

/** How many rows each window keeps. The card pages 20 at a time. */
const PER_WINDOW = 40;

/**
 * The Slate's Movers for one kind: consensus movement on upcoming games,
 * collapsed to one row per player-market (or game-market), carrying the top
 * rows of EVERY window so the card's window toggle is a client-side re-sort.
 */
export async function readConsensusMovers(kind: MoverKind, games: MoverGame[]): Promise<ConsensusMover[]> {
  const upcoming = games.filter((g) => g.startsAt && Date.parse(g.startsAt) > Date.now());
  if (upcoming.length === 0) return [];
  const src = SOURCES[kind];
  const ids = upcoming.map((g) => g.id);
  const starts = upcoming.map((g) => g.startsAt);
  const excluded = [...CONSENSUS_EXCLUDED];

  const [keyRows, shiftRows] = await Promise.all([
    pgAll<Record<string, unknown>>(consensusSql(src), [ids, starts, excluded]),
    pgAll<Record<string, unknown>>(lineShiftSql(src), [ids, starts, excluded]),
  ]);
  const shift = new Map<string, { first: number | null; now: number | null }>();
  for (const r of shiftRows) {
    shift.set(`${r.game_id}|${r.subject_id ?? ''}|${r.market}`, {
      first: r.line_first == null ? null : Number(r.line_first),
      now: r.line_now == null ? null : Number(r.line_now),
    });
  }

  const collapsed = collapseMovers(kind, keyRows.map(toKey), shift).filter(
    (m) => Math.max(Math.abs(m.moves.first), Math.abs(m.moves.h3), Math.abs(m.moves.h1)) >= MIN_MOVE_PTS,
  );
  // Keep the top rows of every window, so each toggle position has its own list.
  const keep = new Set<(typeof collapsed)[number]>();
  for (const w of ['first', 'h3', 'h1'] as const) {
    for (const m of [...collapsed].sort((a, b) => Math.abs(b.moves[w]) - Math.abs(a.moves[w])).slice(0, PER_WINDOW)) {
      if (Math.abs(m.moves[w]) >= MIN_MOVE_PTS) keep.add(m);
    }
  }
  const rows = [...keep];
  if (rows.length === 0) return [];

  const [trendRows, nameRows] = await Promise.all([
    pgAll<Record<string, unknown>>(trendSql(src), [
      ids,
      starts,
      rows.map((r) => r.key.gameId),
      rows.map((r) => r.key.subjectId),
      rows.map((r) => r.key.market),
      rows.map((r) => r.key.line),
      rows.map((r) => r.key.side),
      excluded,
    ]),
    kind === 'props'
      ? pgAll<Record<string, unknown>>(
          `SELECT DISTINCT ON (subject_id) subject_id, subject_name FROM prop_odds WHERE subject_id = ANY(?) AND subject_name IS NOT NULL`,
          [[...new Set(rows.map((r) => r.subjectId).filter((s): s is string => s != null))]],
        )
      : Promise.resolve([] as Record<string, unknown>[]),
  ]);
  const trend = new Map<number, number[]>();
  for (const t of trendRows) {
    const i = Number(t.idx) - 1;
    trend.set(i, [...(trend.get(i) ?? []), Number(t.m) * 100]);
  }
  const names = new Map(nameRows.map((n) => [String(n.subject_id), String(n.subject_name)]));
  const matchup = new Map(upcoming.map((g) => [g.id, g.matchup ?? null]));

  return rows.map((r, i) => {
    const { key: _key, ...rest } = r;
    return {
      ...rest,
      subjectName: r.subjectId ? (names.get(r.subjectId) ?? null) : null,
      matchup: matchup.get(r.gameId) ?? null,
      trend: trend.get(i) ?? [],
    };
  });
}


export interface OutlierRow {
  gameId: string;
  subjectId: string;
  subjectName: string | null;
  market: string;
  line: number;
  side: string;
  bookmaker: string;
  odds: number;
  /** The median of every OTHER book on the same line. */
  medianOdds: number;
  /** Implied-probability points between the two. */
  gapPts: number;
  books: number;
}

/**
 * One book well off the median of the rest, same prop and same line.
 *
 * THE BOUNDS ARE THE POINT. Fewer than five books quoting and there is no
 * "rest" to be off; a gap under 4 points is ordinary spread between books; and
 * a gap over 15 points is a stale or exchange quote, not a bargain — measured,
 * Kalshi at +9900 against a −156 median on 2026-09-19. A gap this reports is a
 * PRICE GAP BETWEEN BOOKS, not a model edge.
 */
export async function readPriceOutliers(gameIds: string[], limit = 12): Promise<OutlierRow[]> {
  if (gameIds.length === 0) return [];
  const rows = await pgAll<Record<string, unknown>>(
    `WITH q AS (
       SELECT game_id, subject_id, subject_name, market_key AS market, line, side, bookmaker, american_odds
       FROM prop_odds
       WHERE game_id = ANY(?) AND ${SANE_PROP('american_odds')} AND lower(bookmaker) <> ALL(?)
     ), agg AS (
       SELECT game_id, subject_id, market, line, side,
              count(DISTINCT bookmaker) AS books,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY ${IMPLIED('american_odds')}) AS median_imp
       FROM q GROUP BY 1, 2, 3, 4, 5
       HAVING count(DISTINCT bookmaker) >= 5
     )
     SELECT q.game_id, q.subject_id, q.subject_name, q.market, q.line, q.side, q.bookmaker,
            q.american_odds AS odds, agg.books,
            agg.median_imp,
            (agg.median_imp - ${IMPLIED('q.american_odds')}) * 100 AS gap_pts
     FROM q JOIN agg USING (game_id, subject_id, market, line, side)
     WHERE (agg.median_imp - ${IMPLIED('q.american_odds')}) * 100 BETWEEN 4 AND 15
     -- Books first: the same gap means more on twelve books than on five, and
     -- sorting by gap alone puts whatever sits at the 15-point ceiling on top
     -- every time.
     ORDER BY agg.books DESC, (agg.median_imp - ${IMPLIED('q.american_odds')}) DESC
     LIMIT ?`,
    [gameIds, PICKEM, limit],
  );
  return rows.map((r) => {
    const medianImp = Number(r.median_imp);
    return {
      gameId: String(r.game_id ?? ''),
      subjectId: String(r.subject_id ?? ''),
      subjectName: r.subject_name == null ? null : String(r.subject_name),
      market: String(r.market ?? ''),
      line: Number(r.line),
      side: String(r.side ?? ''),
      bookmaker: String(r.bookmaker ?? ''),
      odds: Number(r.odds),
      // Back to a price, so the card can print what the rest of the market is
      // actually offering rather than a probability nobody quotes.
      medianOdds: medianImp > 0.5 ? -Math.round((medianImp / (1 - medianImp)) * 100) : Math.round(((1 - medianImp) / medianImp) * 100),
      gapPts: Number(r.gap_pts),
      books: Number(r.books),
    };
  });
}

export interface DisagreementRow {
  gameId: string;
  subjectId: string;
  subjectName: string | null;
  market: string;
  /** The line the most books are hanging, and how many. */
  mainLine: number;
  mainBooks: number;
  /** The other line, and how many. */
  otherLine: number;
  otherBooks: number;
  /** Who is at the other line. */
  otherBookmakers: string[];
}

/**
 * Books split on the LINE itself — 0.5 at one, 1.5 at the rest.
 *
 * A different question from a price gap, and a more interesting one: two books
 * pricing different numbers are not disagreeing about the odds, they are
 * disagreeing about the event. Still market information, not a model edge.
 */
export async function readLineDisagreements(gameIds: string[], limit = 12): Promise<DisagreementRow[]> {
  if (gameIds.length === 0) return [];
  const rows = await pgAll<Record<string, unknown>>(
    `WITH per_line AS (
       SELECT game_id, subject_id, max(subject_name) AS subject_name, market_key AS market, line,
              count(DISTINCT bookmaker) AS books,
              array_agg(DISTINCT bookmaker) AS bookmakers
       FROM prop_odds
       WHERE game_id = ANY(?) AND ${SANE_PROP('american_odds')} AND lower(bookmaker) <> ALL(?)
       GROUP BY 1, 2, 4, 5
     ), ranked AS (
       SELECT *, row_number() OVER (PARTITION BY game_id, subject_id, market ORDER BY books DESC, line ASC) AS rn,
              count(*) OVER (PARTITION BY game_id, subject_id, market) AS distinct_lines
       FROM per_line
     )
     SELECT a.game_id, a.subject_id, a.subject_name, a.market,
            a.line AS main_line, a.books AS main_books,
            b.line AS other_line, b.books AS other_books, b.bookmakers AS other_bookmakers
     FROM ranked a JOIN ranked b USING (game_id, subject_id, market)
     WHERE a.rn = 1 AND b.rn = 2 AND a.distinct_lines > 1
     ORDER BY (a.books + b.books) DESC, abs(a.line - b.line) DESC
     LIMIT ?`,
    [gameIds, PICKEM, limit],
  );
  return rows.map((r) => ({
    gameId: String(r.game_id ?? ''),
    subjectId: String(r.subject_id ?? ''),
    subjectName: r.subject_name == null ? null : String(r.subject_name),
    market: String(r.market ?? ''),
    mainLine: Number(r.main_line),
    mainBooks: Number(r.main_books),
    otherLine: Number(r.other_line),
    otherBooks: Number(r.other_books),
    otherBookmakers: (r.other_bookmakers as string[] | null) ?? [],
  }));
}
