/**
 * Generic "how far away is this bet window" maths.
 *
 * The governing principle for the whole app: an EXACT count (holes completed,
 * batters due) always outranks an ESTIMATED time. We publish minutes only when
 * we can say where the number came from, and we return `null` — not a guess —
 * when we cannot.
 */

import type { DistanceUnit, EtaConfidence, LiveState } from './types';
import { DISTANCE_UNIT_LABEL } from './types';

export interface PaceSample {
  /** Units completed (holes played, batters faced...). */
  unitsCompleted: number;
  /** Wall-clock minutes those units took. */
  elapsedMinutes: number;
}

export interface PaceGuard {
  /** Reject samples built on fewer completed units than this. */
  minUnits: number;
  /** Reject implausibly fast pace. */
  minMinutesPerUnit: number;
  /** Reject implausibly slow pace (stoppage, weather delay, bad clock). */
  maxMinutesPerUnit: number;
}

/**
 * Turn one observed sample into minutes-per-unit, or `null` if the sample
 * fails the sanity guard. A rejected sample is not softened into a weaker
 * number — it is discarded so a caller falls through to the next source.
 */
export function paceFromSample(sample: PaceSample, guard: PaceGuard): number | null {
  if (!Number.isFinite(sample.unitsCompleted) || !Number.isFinite(sample.elapsedMinutes)) return null;
  if (sample.unitsCompleted < guard.minUnits) return null;
  if (sample.elapsedMinutes <= 0) return null;

  const perUnit = sample.elapsedMinutes / sample.unitsCompleted;
  if (perUnit < guard.minMinutesPerUnit || perUnit > guard.maxMinutesPerUnit) return null;
  return perUnit;
}

export function median(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 0 ? (clean[mid - 1] + clean[mid]) / 2 : clean[mid];
}

export interface EtaResolution {
  etaMinutes: number | null;
  etaConfidence: EtaConfidence;
  note?: string;
}

/**
 * Resolve an ETA from a prioritised chain of pace sources.
 *
 * `ownPace` (measured from the subject itself) wins. `peerPace` (field median)
 * is a fallback. `constantPace` is a last-resort league average and is still
 * labelled `fallback` — it never gets to claim `measured`.
 */
export function resolveEta(
  distance: number | null,
  sources: { ownPace: number | null; peerPace: number | null; constantPace?: number | null },
): EtaResolution {
  if (distance === null || !Number.isFinite(distance)) {
    return { etaMinutes: null, etaConfidence: null, note: 'Position unknown — no ETA.' };
  }
  if (distance <= 0) {
    return { etaMinutes: 0, etaConfidence: 'measured', note: 'Up now.' };
  }

  if (sources.ownPace !== null) {
    return {
      etaMinutes: Math.round(distance * sources.ownPace),
      etaConfidence: 'measured',
      note: `Measured from this subject's own pace (${sources.ownPace.toFixed(1)} min/unit).`,
    };
  }
  if (sources.peerPace !== null) {
    return {
      etaMinutes: Math.round(distance * sources.peerPace),
      etaConfidence: 'fallback',
      note: `Estimated from field median pace (${sources.peerPace.toFixed(1)} min/unit).`,
    };
  }
  if (sources.constantPace != null) {
    return {
      etaMinutes: Math.round(distance * sources.constantPace),
      etaConfidence: 'fallback',
      note: `Rough estimate from a league-average pace (${sources.constantPace.toFixed(1)} min/unit).`,
    };
  }
  return { etaMinutes: null, etaConfidence: null, note: 'No usable pace data — no ETA.' };
}

/**
 * A timestamp claiming to be a forward-looking schedule is only trustworthy if
 * it is not meaningfully in the past. Feeds have been caught serving a
 * "last updated" stamp in a field that looks like a schedule; showing that as a
 * tee time invents precision that was never there.
 *
 * @returns the ISO string when usable, otherwise `null`.
 */
export function validateScheduledTime(
  iso: string | null | undefined,
  now: Date = new Date(),
  toleranceMinutes = 20,
): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;

  const minutesInPast = (now.getTime() - t) / 60000;
  if (minutesInPast > toleranceMinutes) return null;
  return new Date(t).toISOString();
}

/** Human label for an exact distance, or an honest "unknown". */
export function formatDistance(distance: number | null, unit: DistanceUnit): string {
  if (distance === null) return 'position unknown';
  if (distance <= 0) return 'up now';
  const [singular, plural] = DISTANCE_UNIT_LABEL[unit];
  return `${distance} ${distance === 1 ? singular : plural} away`;
}

/** Human label for an ETA. Returns `null` when we should show nothing at all. */
export function formatEta(state: Pick<LiveState, 'etaMinutes' | 'etaConfidence'>): string | null {
  if (state.etaMinutes === null || state.etaConfidence === null) return null;
  const mins = state.etaMinutes;
  const body = mins < 1 ? 'now' : mins < 60 ? `~${mins}m` : `~${Math.floor(mins / 60)}h ${mins % 60}m`;
  return state.etaConfidence === 'measured' ? body : `${body} (est.)`;
}
