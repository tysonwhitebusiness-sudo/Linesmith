/**
 * `/api/props/calibration`'s payload, pulled out of the route handler so it
 * can be cached. Unlike `/api/mlb` or `/api/props/lines`, this route has no
 * external fetch to defer — it is a set of aggregate scans over
 * `pick_history` (now ~366k rows), and before caching it ran fresh on every
 * request. The fix here isn't "stop blocking on a rebuild", it's "stop
 * recomputing on every request" — the same stale-serve pattern as the other
 * two routes, applied to database aggregation rather than a remote fetch.
 *
 * CORRECTED 2026-08-29 (task 2.8, finding P2 M6.4). This used to say "six
 * separate SQLite aggregate scans" and then reason at length about the work
 * being synchronous, blocking Node's single event loop for its duration. All
 * of that described a database this app stopped using on 2026-08-22: it is
 * Postgres now, the queries are async and run on the server rather than in
 * this process, and there are nine of them, not six. Nothing about the
 * caching decision changes — the payload is still worth caching — but the
 * stated reason was wrong for a week and would have sent the next person
 * looking for a blocked event loop that cannot happen.
 *
 * The remaining honest caveat is different from the old one: these aggregate
 * over a table that only grows, so the cost is a function of `pick_history`'s
 * size rather than of request volume. Phase 4's calibration work (4.2/4.3)
 * owns this code next, and per standing decision Q18 also owns moving it to
 * Python — it is deliberately NOT ported in Phase 2.
 */

import {
  calibrationCounts,
  calibrationBuckets,
  calibrationByMarket,
  overallBrierScore,
  goodBetsRecord,
  calibrationCountsForDimension,
  calibrationBucketsForDimension,
  liveMarketSkill,
  scoreRecord,
  type CalibrationScope,
} from '@/lib/db/client';
import { isMarketTrusted, GAME_LEVEL_DIMENSIONS } from '@/lib/odds/goodBets';
import { trustTierFromLiveBSS } from './marketTrust';
import { easternDate } from '@/lib/sports/mlb/statsapi';

export const CALIBRATION_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * `sport` is now part of the cache key (Phase 2 of docs/scan-playerdetail-
 * parity-gameplan-2026-08-27.md) — before this, every sport's request read
 * and wrote the exact same cache entry, so whichever sport happened to
 * populate it first silently served its numbers to every other sport for
 * up to CALIBRATION_TTL_MS. Same real cache-key-collision class CLAUDE.md's
 * golf/schedule postmortem already documents; this is that bug's second
 * real occurrence, not a hypothetical one.
 */
export function calibrationCacheKey(sport: string, scope: CalibrationScope, dimension: string | null): string {
  return `props:calibration:${sport}:${scope}:${dimension ?? 'none'}`;
}

/** When the Good Bets record was rescoped to game picks only, excluding the historical player-prop backfill — see goodBetsRecord's own comment. */
const RECORD_START_DATE = easternDate();

/**
 * `sport` used to be a hardcoded `'mlb'` literal here — not a default,
 * every one of these six queries always read MLB's own pick_history rows
 * regardless of which sport's page asked (Phase 2 of docs/scan-
 * playerdetail-parity-gameplan-2026-08-27.md). Real, confirmed-live bug:
 * NFL/CFB/NBA/NHL/Soccer's Market Trust badges never populated and their
 * Good Bets tabs had zero qualifying markets, not because those sports
 * lacked real graded pick_history rows (Phase 7's grading job is sport-
 * generic), but because this function never looked at them.
 */
export async function computeCalibrationPayload(sport: string, scope: CalibrationScope, dimension: string | null) {
  const byMarket = await calibrationByMarket(sport);
  const trustedDimensions = byMarket.filter((m) => isMarketTrusted(m.brierScore, m.n)).map((m) => m.dimension);
  // The record itself only ever covers moneyline/total, and only once
  // they're trusted — narrower than `trustedDimensions`, which still
  // governs the live Scan/Good Bets gating for player props.
  const recordDimensions = trustedDimensions.filter((d) => GAME_LEVEL_DIMENSIONS.includes(d));

  // Prop Score v1 — Market Trust badge (separate from `trustedDimensions`
  // above, which is raw-Brier-based and drives Good Bets gating). Sent as a
  // plain object, not a Map — JSON has no Map type, and useMarketCalibration
  // rebuilds the Map client-side.
  const liveSkill = await liveMarketSkill(sport);
  const trustTiers = Object.fromEntries(liveSkill.map((m) => [m.dimension, trustTierFromLiveBSS(m.bss, m.n)]));

  return {
    counts: dimension ? await calibrationCountsForDimension(sport, dimension) : await calibrationCounts(sport, scope),
    buckets: dimension ? await calibrationBucketsForDimension(sport, dimension) : await calibrationBuckets(sport, scope),
    byMarket,
    overallBrierScore: dimension ? (byMarket.find((m) => m.dimension === dimension)?.brierScore ?? null) : await overallBrierScore(sport, scope),
    goodBets: await goodBetsRecord(sport, recordDimensions, `${RECORD_START_DATE} 00:00:00`),
    trustTiers,
    scoreRecord: await scoreRecord(sport),
  };
}
