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
}

export interface GameLineHistoryResult {
  eventId: string;
  market: string;
  side: string;
  /** Handicap the series is for, or `null` for a market with none (moneyline). */
  resolvedPoint: number | null;
  bucketSeconds: number;
  buckets: string[];
  series: LineHistorySeries[];
  /** Sides actually present for this event and market, so a caller can offer the other one. */
  availableSides: string[];
}

export async function readGameLineHistory(q: GameLineHistoryQuery): Promise<GameLineHistoryResult> {
  const bucketSeconds = bucketSecondsFor(q.hours);

  // Both are interpolated into an interval literal and a divisor, so both must
  // be numbers THIS module chose rather than caller text — the same guard the
  // prop reader carries, for the same reason: a `?` placeholder cannot stand in
  // for an interval and the compiler cannot help here.
  if (!Number.isInteger(bucketSeconds) || bucketSeconds <= 0) throw new Error('bucketSeconds must be a positive integer');
  if (!Number.isFinite(q.hours) || q.hours <= 0) throw new Error('hours must be a positive number');
  const hours = Math.round(q.hours);

  const sideRows = await pgAll<{ side: string; n: string }>(
    `SELECT side, count(*) AS n
       FROM game_odds_history
      WHERE event_id = ? AND market = ?
        AND observed_at >= now() - interval '${hours} hours'
      GROUP BY side
      ORDER BY count(*) DESC`,
    [q.eventId, q.market],
  );
  const availableSides = sideRows.map((r) => r.side);

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
        AND observed_at >= now() - interval '${hours} hours'
      -- DESC on observed_at makes DISTINCT ON take the LAST real observation in
      -- each bucket rather than the first, so a bucket reads as "where the
      -- price ended up" rather than "where it happened to start".
      ORDER BY bookmaker, bucket, observed_at DESC`,
    [q.eventId, q.market, q.side],
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

  // The most-quoted handicap, for the caption. NOT a filter: unlike a prop's
  // alternate lines, a game total genuinely MOVING from 8.5 to 9 is the story
  // this card exists to tell, so every observation stays in the series and this
  // only names where the market mostly sat.
  const resolvedPoint =
    [...pointCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;

  const buckets = [...bucketSet].sort();
  const series: LineHistorySeries[] = [...byBook.entries()]
    .map(([bookmaker, points]) => ({ bookmaker, points: points.sort((a, b) => a.t.localeCompare(b.t)) }))
    // Most-observed book first: a book with two points in a week is not a
    // movement story, and a caller showing only a few series should get the
    // ones that have something to show.
    .sort((a, b) => b.points.length - a.points.length || a.bookmaker.localeCompare(b.bookmaker));

  return { eventId: q.eventId, market: q.market, side: q.side, resolvedPoint, bucketSeconds, buckets, series, availableSides };
}
