/**
 * MLB position and pace maths — the counterpart to golf's "holes away".
 *
 * The exact unit here is BATTERS until a hitter's next plate appearance, read
 * off the live batting order. Where the feed can't support an exact count (the
 * subject's team is in the field, or no lineup is posted yet) we return `null`
 * and let the UI say so, rather than inventing a number.
 */

import { paceFromSample, resolveEta } from '../../core/timing';
import type { EtaResolution } from '../../core/timing';

export const MLB_PACE_GUARD = {
  minUnits: 6,
  minMinutesPerUnit: 1.2,
  maxMinutesPerUnit: 8,
};

/** Rough league average, last resort only. */
export const MLB_FALLBACK_MIN_PER_BATTER = 3.5;

/**
 * Batters until `targetId` comes to the plate, given the batting team's order
 * and who is at bat right now.
 *
 *  0        → at the plate now
 *  1..8     → that many batters away
 *  null     → not in this lineup, or we can't place the current batter
 */
export function battersUntil(
  battingOrder: number[],
  currentBatterId: number | null,
  targetId: number,
): number | null {
  if (!Array.isArray(battingOrder) || battingOrder.length === 0) return null;
  if (currentBatterId == null) return null;

  const currentIndex = battingOrder.indexOf(currentBatterId);
  const targetIndex = battingOrder.indexOf(targetId);
  if (currentIndex === -1 || targetIndex === -1) return null;

  const size = battingOrder.length;
  return ((targetIndex - currentIndex) % size + size) % size;
}

/**
 * Half-innings until the subject's team bats again. Used when the subject is
 * in the field: we know the inning exactly even though the batter count isn't
 * meaningful yet.
 */
export function halfInningsUntilTeamBats(opts: {
  isTopInning: boolean;
  subjectIsHome: boolean;
}): number {
  // Home bats in the bottom half. If the top is in progress and the subject is
  // on the home team, their half is the very next one.
  const teamIsBattingNow = opts.isTopInning !== opts.subjectIsHome;
  return teamIsBattingNow ? 0 : 1;
}

/**
 * Minutes per plate appearance measured from this game's own elapsed time.
 * Returns `null` when the sample is too thin or implausible.
 */
export function measuredGamePace(opts: {
  firstPitch: string | undefined;
  plateAppearances: number;
  now?: Date;
}): number | null {
  if (!opts.firstPitch) return null;
  const started = Date.parse(opts.firstPitch);
  if (!Number.isFinite(started)) return null;

  const elapsedMinutes = ((opts.now ?? new Date()).getTime() - started) / 60000;
  if (elapsedMinutes <= 0) return null;

  return paceFromSample({ unitsCompleted: opts.plateAppearances, elapsedMinutes }, MLB_PACE_GUARD);
}

export function mlbEta(
  distance: number | null,
  gamePace: number | null,
  leaguePace: number | null = MLB_FALLBACK_MIN_PER_BATTER,
): EtaResolution {
  return resolveEta(distance, {
    ownPace: gamePace,
    peerPace: null,
    constantPace: leaguePace,
  });
}
