/**
 * The Slate's market-movement reads (S2).
 *
 * Four questions, all answered in POSTGRES rather than in Node, because the
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
 * A MOVE beyond this many implied-probability points is not a move.
 *
 * Measured on the first real run of these reads: the top ten prop "movers"
 * were all Kalshi going -4900 -> +4900, which is 96 points — from near
 * certain to near impossible — and the top game-line movers were Fanatics
 * swinging a spread price from +1000 to -2500. Neither is a market changing
 * its mind; both are an exchange quote or a mis-keyed row, and left in they
 * are the only thing anyone would ever see, because they sort to the top by
 * construction. Real steam is one to eight points.
 *
 * This is a blunt instrument and it is deliberately blunt: a cap is honest
 * about being a cap, where a cleverer filter would quietly decide which books
 * are allowed to move.
 */
const MAX_MOVE_PTS = 25;

/**
 * Pick'em apps never count as a price (R2, `mainLine.ts`): their fixed
 * +100-style payout is not a market view, so a "move" in one is noise.
 */
const PICKEM = ['prizepicks', 'underdog', 'sleeper', 'dabble', 'parlayplay', 'betr', 'chalkboard', 'pick6'];

export interface MoverRow {
  /** The game this belongs to, so the card can name the matchup. */
  gameId: string;
  /** Null for a game line: the subject IS the game. */
  subjectId: string | null;
  subjectName: string | null;
  market: string;
  line: number | null;
  side: string;
  bookmaker: string;
  firstOdds: number;
  lastOdds: number;
  firstAt: string;
  lastAt: string;
  /** How many observations there are behind this move. */
  observations: number;
  /** Implied-probability POINTS, last minus first. The sort key. */
  movePts: number;
}

/** Rows come back as strings from `numeric`; the wire shape is numbers. */
function toMover(r: Record<string, unknown>): MoverRow {
  return {
    gameId: String(r.game_id ?? ''),
    subjectId: r.subject_id == null ? null : String(r.subject_id),
    subjectName: r.subject_name == null ? null : String(r.subject_name),
    market: String(r.market ?? ''),
    line: r.line == null ? null : Number(r.line),
    side: String(r.side ?? ''),
    bookmaker: String(r.bookmaker ?? ''),
    firstOdds: Number(r.first_odds),
    lastOdds: Number(r.last_odds),
    firstAt: new Date(String(r.first_at)).toISOString(),
    lastAt: new Date(String(r.last_at)).toISOString(),
    observations: Number(r.n),
    movePts: Number(r.move_pts),
  };
}

/**
 * Game-line movers for one slate.
 *
 * `game_odds_history` HAS NO `sport` COLUMN — it is keyed by `event_id` alone,
 * which is why this takes the slate's own ids rather than a sport name. Passing
 * a sport here would silently read nothing.
 */
export async function readGameLineMovers(eventIds: string[], hours: number, limit = 40): Promise<MoverRow[]> {
  if (eventIds.length === 0) return [];
  const rows = await pgAll<Record<string, unknown>>(
    `WITH g AS (
       -- GROUPED BY point, not just by market and side. Without it a total
       -- moving from 8.5 to 9.5 reads as the PRICE swinging from +200 to
       -- +1100 — and those fake swings were every one of the top ten movers
       -- on the first real run. A line change is a different line, not a
       -- price move.
       SELECT event_id AS game_id, market, side, bookmaker, point,
              (array_agg(american_odds ORDER BY observed_at))[1] AS first_odds,
              (array_agg(american_odds ORDER BY observed_at DESC))[1] AS last_odds,
              min(observed_at) AS first_at,
              max(observed_at) AS last_at,
              count(*) AS n
       FROM game_odds_history
       WHERE event_id = ANY(?)
         AND observed_at > now() - (? || ' hours')::interval
         AND ${SANE('american_odds')}
       GROUP BY event_id, market, side, bookmaker, point
       HAVING count(*) > 1
     )
     SELECT game_id, NULL::text AS subject_id, NULL::text AS subject_name, market, point AS line,
            side, bookmaker, first_odds, last_odds, first_at, last_at, n,
            (${IMPLIED('last_odds')} - ${IMPLIED('first_odds')}) * 100 AS move_pts
     FROM g
     WHERE first_odds <> last_odds
       AND abs((${IMPLIED('last_odds')} - ${IMPLIED('first_odds')})) * 100 <= ${MAX_MOVE_PTS}
     ORDER BY abs((${IMPLIED('last_odds')} - ${IMPLIED('first_odds')})) DESC
     LIMIT ?`,
    [eventIds, hours, limit],
  );
  return rows.map(toMover);
}

/** Prop movers for one slate, same shape and the same rules. */
export async function readPropMovers(gameIds: string[], hours: number, limit = 40): Promise<MoverRow[]> {
  if (gameIds.length === 0) return [];
  const rows = await pgAll<Record<string, unknown>>(
    `WITH g AS (
       SELECT game_id, subject_id, market_key AS market, line, side, bookmaker,
              (array_agg(american_odds ORDER BY observed_at))[1] AS first_odds,
              (array_agg(american_odds ORDER BY observed_at DESC))[1] AS last_odds,
              min(observed_at) AS first_at,
              max(observed_at) AS last_at,
              count(*) AS n
       FROM prop_odds_history
       WHERE game_id = ANY(?)
         AND observed_at > now() - (? || ' hours')::interval
         AND ${SANE_PROP('american_odds')}
         AND lower(bookmaker) <> ALL(?)
       GROUP BY 1, 2, 3, 4, 5, 6
       HAVING count(*) > 1
     )
     SELECT g.game_id, g.subject_id,
            -- prop_odds_history has no subject name; the current table does.
            (SELECT p.subject_name FROM prop_odds p WHERE p.subject_id = g.subject_id AND p.subject_name IS NOT NULL LIMIT 1) AS subject_name,
            g.market, g.line, g.side, g.bookmaker, g.first_odds, g.last_odds, g.first_at, g.last_at, g.n,
            (${IMPLIED('g.last_odds')} - ${IMPLIED('g.first_odds')}) * 100 AS move_pts
     FROM g
     WHERE g.first_odds <> g.last_odds
       AND abs((${IMPLIED('g.last_odds')} - ${IMPLIED('g.first_odds')})) * 100 <= ${MAX_MOVE_PTS}
     ORDER BY abs((${IMPLIED('g.last_odds')} - ${IMPLIED('g.first_odds')})) DESC
     LIMIT ?`,
    [gameIds, hours, PICKEM, limit],
  );
  return rows.map(toMover);
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
