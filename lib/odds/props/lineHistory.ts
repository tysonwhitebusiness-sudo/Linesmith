/**
 * Line movement for one prop, per bookmaker — the read behind `/api/props/line-history`.
 *
 * Phase 6.16. `prop_odds_history` holds 670,478 observations across 2,294
 * subjects and 26 books and was displayed nowhere; `SeriesChart` and
 * `Sparkline` have been sitting ready for it since 6.4.
 *
 * =================== WHY THERE IS NO "CONSENSUS" SERIES ====================
 *
 * The obvious move is to average the books into one line and plot that. This
 * deliberately does not, because `SeriesChart` already takes a subject series
 * plus background series (`values` + `context`): the caller plots the user's
 * own sportsbook as the subject and every other book behind it, which answers
 * "is my book moving with the market or against it" without this module
 * inventing a number to answer it with.
 *
 * A median across books is a defensible aggregate, but nothing consumes one
 * yet, and an average of prices from books with different vigs is not a price
 * anyone can bet. If a consensus is wanted later it should be built where the
 * comparison it serves lives, and labelled as a median rather than as "the
 * line".
 * ===========================================================================
 *
 * ============ A SERIES IS PINNED TO ONE LINE, AND THAT IS NOT OPTIONAL =====
 *
 * The first cut of this keyed a series on (game, subject, market, side) and
 * rendered beautifully meaningless charts. Books post ALTERNATE LINES
 * simultaneously — for one real strikeouts prop, fanatics carried 9 distinct
 * lines from 1.5 to 9.5 and prizepicks 10 from 3.5 to 11.5 — so sampling "the
 * latest row" walked between alternates and drew a line jumping 2.5 to 10.5.
 * Every point was a real quoted price and the chart was nonsense.
 *
 * So a series is pinned: `line` is chosen (or supplied), echoed back as
 * `resolvedLine`, and every point in the response is that same line. What the
 * chart then shows is the PRICE of one specific bet moving, which is the thing
 * a person means by line movement.
 *
 * `availableLines` comes back too, so a caller can offer the alternates rather
 * than pretending the pinned one is all there is.
 *
 * NULL LINES ARE A THIRD CASE, not a missing value to skip past. Two different
 * things produce one:
 *
 *  - A market with no handicap at all (anytime-goalscorer, two-plus-goals).
 *    Null IS the line; the series tracks price and `resolvedLine` is null.
 *  - **A book that failed to record one.** Measured: 53% of
 *    `pitcher-strikeouts` rows carry no line — 52,024 of 98,434 — overwhelmingly
 *    from fanduel (37,714), fanatics (13,882) and draftkings (3,027). Those rows
 *    are uninterpretable ("over" what?) and are EXCLUDED from a pinned series
 *    rather than folded in beside a real line. That is an ingest defect in the
 *    Python write path, not something this read can repair; see the handoff.
 *
 * The two are told apart by whether the market carries a line ANYWHERE in the
 * window, which is why `availableLines` is computed before the series is.
 * ===========================================================================
 *
 * BUCKETING IS LAST-VALUE-WINS, NOT AN AVERAGE. One busy series carries ~1,550
 * raw observations a week across 12 books, which is both too many points to
 * draw and too jagged to read. Each bucket therefore reports the LAST real
 * observation in it — an actual quoted price that existed at that moment.
 * Averaging within a bucket would produce prices no book ever posted, which is
 * exactly the class of number this codebase keeps getting bitten by.
 *
 * A bucket with no observation for a book is simply absent from that book's
 * series rather than carried forward. `SeriesChart` breaks its line on a
 * non-finite entry instead of interpolating, so a gap in the data reads as a
 * gap; inventing a flat segment across an outage would claim the price held
 * steady when in truth nobody was looking.
 */

import { pgAll } from '@/lib/db/pgClient';

export interface LineHistoryPoint {
  /** Bucket start, ISO. Aligned across every book in the response. */
  t: string;
  /** The handicap (5.5 strikeouts). `null` for a market that has none. */
  line: number | null;
  americanOdds: number | null;
}

export interface LineHistorySeries {
  bookmaker: string;
  points: LineHistoryPoint[];
}

export interface LineHistoryResult {
  gameId: string;
  subjectId: string;
  marketKey: string;
  side: string;
  /**
   * The line every point in `series` is for. `null` means this market has no
   * handicap at all — see the header; it never means "mixed".
   */
  resolvedLine: number | null;
  /** Every line offered in the window, ascending, so a caller can offer alternates. */
  availableLines: number[];
  /** Bucket width actually used, seconds — echoed so a caption can say it. */
  bucketSeconds: number;
  /** Bucket starts covered by the response, ascending. The shared x domain. */
  buckets: string[];
  series: LineHistorySeries[];
}

/** Bucket widths, smallest first. Chosen so a window yields at most `MAX_BUCKETS` points. */
const BUCKET_LADDER_SECONDS = [300, 900, 1800, 3600, 7200, 14400, 43200, 86400];
const MAX_BUCKETS = 160;

/**
 * Coarsest-necessary bucket for the requested window.
 *
 * Picked from the window rather than taken as a parameter: a caller asking for
 * 5-minute buckets over 30 days would ask Postgres for 8,640 buckets per book
 * and hand the browser a chart nobody can read. The ladder tops out, and the
 * count is clamped after, so the point budget holds for any window.
 */
export function bucketSecondsFor(hours: number): number {
  const windowSeconds = hours * 3600;
  for (const b of BUCKET_LADDER_SECONDS) {
    if (windowSeconds / b <= MAX_BUCKETS) return b;
  }
  return BUCKET_LADDER_SECONDS[BUCKET_LADDER_SECONDS.length - 1];
}

/**
 * Which line a series is pinned to, and what else was on offer.
 *
 * Exported and pure so `tests/line-history.test.ts` can CALL it. An earlier
 * test in this codebase re-implemented the rule it was checking beside the
 * code, and reverting the real function failed nothing — the mirror agreed
 * with the bug.
 *
 * `rows` must be ordered by observation count DESCENDING, which is what makes
 * the first non-null entry the modal line. The modal, not the mean or the
 * midpoint: the most-quoted line is the market's de-facto main one, whereas a
 * mean of alternates is a line no book ever posted.
 *
 * An explicitly requested line is honoured only if it was actually offered.
 * Silently returning an empty series for a line nobody quoted would look
 * exactly like "this prop stopped moving".
 */
export function pinLine(
  rows: ReadonlyArray<{ line: number | null }>,
  requested?: number,
): { availableLines: number[]; resolvedLine: number | null } {
  const availableLines = rows
    .map((r) => r.line)
    .filter((v): v is number => v != null)
    .map(Number)
    .sort((a, b) => a - b);

  const modal = rows.find((r) => r.line != null);
  const resolvedLine =
    requested != null && availableLines.includes(requested)
      ? requested
      : modal != null
        ? Number(modal.line)
        : null;

  return { availableLines, resolvedLine };
}

export interface LineHistoryQuery {
  gameId: string;
  subjectId: string;
  marketKey: string;
  side: string;
  hours: number;
  /** Pin a specific alternate. Omitted picks the most-observed line in the window. */
  line?: number;
}

export async function readLineHistory(q: LineHistoryQuery): Promise<LineHistoryResult> {
  const bucketSeconds = bucketSecondsFor(q.hours);

  // `bucketSeconds` and `hours` are interpolated, so both MUST be numbers this
  // module chose — never caller text. `bucketSecondsFor` returns one of eight
  // constants and the route clamps `hours` before it gets here; the guard below
  // is the belt to that braces, because an interpolated string here is a SQL
  // injection and the `?` compiler cannot help with an interval literal.
  if (!Number.isInteger(bucketSeconds) || bucketSeconds <= 0) throw new Error('bucketSeconds must be a positive integer');
  if (!Number.isFinite(q.hours) || q.hours <= 0) throw new Error('hours must be a positive number');
  const hours = Math.round(q.hours);

  // Which lines exist at all, and how heavily each is quoted. Computed FIRST
  // because it is what distinguishes "this market has no handicap" from "these
  // books dropped one" — see the header.
  const lineRows = await pgAll<{ line: number | null; n: string }>(
    `SELECT line, count(*) AS n
       FROM prop_odds_history
      WHERE game_id = ? AND subject_id = ? AND market_key = ? AND side = ?
        AND observed_at >= now() - interval '${hours} hours'
      GROUP BY line
      ORDER BY count(*) DESC`,
    [q.gameId, q.subjectId, q.marketKey, q.side],
  );

  const { availableLines, resolvedLine } = pinLine(lineRows, q.line);

  const rows = await pgAll<{
    bookmaker: string;
    bucket: Date | string;
    line: number | null;
    american_odds: number | null;
  }>(
    `SELECT DISTINCT ON (bookmaker, bucket)
            bookmaker,
            to_timestamp(floor(extract(epoch FROM observed_at) / ${bucketSeconds}) * ${bucketSeconds}) AS bucket,
            line,
            american_odds
       FROM prop_odds_history
      WHERE game_id = ? AND subject_id = ? AND market_key = ? AND side = ?
        AND observed_at >= now() - interval '${hours} hours'
        -- IS NOT DISTINCT FROM, not '=': it matches NULL to NULL, which is what
        -- pins a genuinely line-less market to its own rows instead of
        -- returning nothing. With a real line it also excludes the null-line
        -- rows a book failed to record, which is the intent either way.
        AND line IS NOT DISTINCT FROM ?
      -- DESC on observed_at is what makes DISTINCT ON take the LAST real
      -- observation in each bucket rather than the first. See the header.
      ORDER BY bookmaker, bucket, observed_at DESC`,
    [q.gameId, q.subjectId, q.marketKey, q.side, resolvedLine],
  );

  const byBook = new Map<string, LineHistoryPoint[]>();
  const bucketSet = new Set<string>();
  for (const r of rows) {
    const t = (r.bucket instanceof Date ? r.bucket : new Date(r.bucket)).toISOString();
    bucketSet.add(t);
    const points = byBook.get(r.bookmaker) ?? [];
    points.push({
      t,
      line: r.line == null ? null : Number(r.line),
      americanOdds: r.american_odds == null ? null : Number(r.american_odds),
    });
    byBook.set(r.bookmaker, points);
  }

  const buckets = [...bucketSet].sort();
  const series: LineHistorySeries[] = [...byBook.entries()]
    .map(([bookmaker, points]) => ({ bookmaker, points: points.sort((a, b) => a.t.localeCompare(b.t)) }))
    // Most-observed book first: a caller that shows only a few series should
    // get the ones with something to show, and a book with two points in a
    // week is not a movement story.
    .sort((a, b) => b.points.length - a.points.length || a.bookmaker.localeCompare(b.bookmaker));

  return {
    gameId: q.gameId,
    subjectId: q.subjectId,
    marketKey: q.marketKey,
    side: q.side,
    resolvedLine,
    availableLines,
    bucketSeconds,
    buckets,
    series,
  };
}
