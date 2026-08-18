/**
 * Golf-specific position and pace maths.
 *
 * Position is derived from COMPLETED HOLES ONLY, so it is exact. Minutes are
 * always secondary and always carry their provenance.
 */

import { paceFromSample, median, resolveEta, validateScheduledTime } from '../../core/timing';
import type { EtaResolution } from '../../core/timing';
import type { EspnGolfer } from './espn';

/** A threesome that is genuinely crawling still shouldn't blow past 40 min/hole. */
export const GOLF_PACE_GUARD = {
  minUnits: 3,
  minMinutesPerUnit: 8,
  maxMinutesPerUnit: 40,
};

/** Last-resort tour average, used only when nothing better exists. */
export const GOLF_FALLBACK_MIN_PER_HOLE = 15;

/**
 * Playing order for a round given the starting hole, handling split tees:
 * a 10th-tee start plays 10..18 then 1..9.
 */
export function playingOrder(startHole: number): number[] {
  const start = Number.isFinite(startHole) && startHole >= 1 && startHole <= 18 ? startHole : 1;
  return Array.from({ length: 18 }, (_, i) => ((start - 1 + i) % 18) + 1);
}

/**
 * How many holes until this golfer plays `targetHole` in the current round.
 *
 *  0        → they are standing on it now
 *  positive → that many holes to go
 *  null     → already played this round, or we can't place them
 */
export function holesUntil(
  targetHole: number,
  opts: { startHole: number; thru: number | null },
): number | null {
  if (opts.thru === null || !Number.isFinite(opts.thru)) return null;
  if (!Number.isFinite(targetHole) || targetHole < 1 || targetHole > 18) return null;

  const order = playingOrder(opts.startHole);
  const targetIndex = order.indexOf(targetHole);
  if (targetIndex === -1) return null;

  const distance = targetIndex - opts.thru;
  return distance < 0 ? null : distance;
}

/**
 * Minutes-per-hole measured from this golfer's own round: tee time to now,
 * divided by holes completed. Returns `null` when the sample fails the guard,
 * so the caller falls through to the field median rather than publishing a
 * number built on three minutes of play.
 *
 * Note the asymmetry with `teeTimeForDisplay` below: here a tee time in the
 * past is exactly what we expect, because the group has started.
 */
export function measuredPace(golfer: EspnGolfer, now: Date = new Date()): number | null {
  const thru = golfer.status?.thru;
  const teeTime = golfer.status?.teeTime;
  if (!teeTime || thru == null) return null;

  const started = Date.parse(teeTime);
  if (!Number.isFinite(started)) return null;

  const elapsedMinutes = (now.getTime() - started) / 60000;
  if (elapsedMinutes <= 0) return null;

  return paceFromSample({ unitsCompleted: Number(thru), elapsedMinutes }, GOLF_PACE_GUARD);
}

/** Field-wide median pace across everyone currently out on the course. */
export function fieldMedianPace(golfers: EspnGolfer[], now: Date = new Date()): number | null {
  const samples = golfers
    .map((g) => measuredPace(g, now))
    .filter((p): p is number => p !== null);
  return median(samples);
}

/**
 * A tee time we are willing to DISPLAY as a forward-looking schedule.
 *
 * ESPN has previously served a "last updated" stamp in a field that reads like
 * a schedule, and rendering that as a tee time invents a fact. A time well in
 * the past for a player who has not started is treated as unusable.
 */
export function teeTimeForDisplay(golfer: EspnGolfer, now: Date = new Date()): string | null {
  const thru = golfer.status?.thru ?? 0;
  // Once a player is underway, a past tee time is legitimate history.
  if (thru > 0) return golfer.status?.teeTime ?? null;
  return validateScheduledTime(golfer.status?.teeTime, now);
}

/** Resolve an ETA for a golfer, preferring their own pace over the field's. */
export function golfEta(
  distance: number | null,
  golfer: EspnGolfer,
  fieldPace: number | null,
  now: Date = new Date(),
): EtaResolution {
  return resolveEta(distance, {
    ownPace: measuredPace(golfer, now),
    peerPace: fieldPace,
    constantPace: GOLF_FALLBACK_MIN_PER_HOLE,
  });
}
