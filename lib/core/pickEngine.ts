/**
 * The scan engine. Entirely sport-agnostic — it only ever reads the fields
 * declared in `PickCandidate`. There is deliberately no `sport` branch in this
 * file, and adding one is the wrong fix for any future requirement.
 */

import type { InsightKind, PickCandidate, SplitEvidence } from './types';
import { fixedWindow, openWindow, subsetWindow, currentStreak, isOk } from './windowedStat';
import type { WindowedStat } from './windowedStat';

// ---------------------------------------------------------------------------
// Split evidence
//
// These are thin, named wrappers over `windowedStat` — the measurement itself
// lives there and only there. Adapters call these so that every split arrives
// carrying both its semantic `kind` (which picks the icon) and a `WindowedStat`
// (which may honestly be `insufficient`).
// ---------------------------------------------------------------------------

/** A trailing fixed window — "hit in 8 of the last 10". */
export function windowSplit(
  history: PickCandidate['history'],
  category: string,
  window: number,
  label: string,
  kind: InsightKind = 'recent-form',
): SplitEvidence {
  return { kind, label, stat: fixedWindow(history, category, window) };
}

/** An arbitrary subset — used for opponent and home/away angles. */
export function subsetSplit(
  history: PickCandidate['history'],
  category: string,
  predicate: (entry: PickCandidate['history'][number]) => boolean,
  label: string,
  kind: InsightKind,
  minimum = 2,
): SplitEvidence {
  return { kind, label, stat: subsetWindow(history, category, predicate, { minimum }) };
}

/** Season-to-date over whatever history exists. */
export function seasonSplit(
  history: PickCandidate['history'],
  category: string,
  label = 'This season',
): SplitEvidence {
  return { kind: 'recent-form', label, stat: openWindow(history, category, { minimum: 1 }) };
}

/**
 * The standard trailing windows.
 *
 * Every requested window is returned, including the ones that came back
 * insufficient — dropping them here is what let a thin sample masquerade as a
 * complete one further downstream. Consumers that only want the usable ones can
 * filter on `stat.status`, and in doing so they make that choice explicitly.
 */
export function standardWindows(
  history: PickCandidate['history'],
  category: string,
  windows: number[] = [5, 10, 15],
): SplitEvidence[] {
  return windows.map((w) => windowSplit(history, category, w, `Last ${w}`));
}

/** Splits worth putting on screen: the ones that actually resolved. */
export function usableSplits(splits: SplitEvidence[] | undefined): SplitEvidence[] {
  return (splits ?? []).filter((s) => isOk(s.stat));
}

// ---------------------------------------------------------------------------
// Consistency
// ---------------------------------------------------------------------------

export interface ConsistencyOptions {
  /** Minimum periods of evidence before a pattern is worth showing. */
  minSampleSize?: number;
}

/**
 * Candidates whose every observed period landed in the same bucket — the
 * "same score on this hole all week" / "hit in every game" case.
 *
 * `minSampleSize` used to default to 3 — enough for a rookie call-up's first
 * three starts to read as a "100% consistent" pattern next to a real
 * 15-game one, no visual distinction between them. Raised to 5 (the
 * smallest of the app's own L5/L10/L15 windows) so "consistent" means the
 * same thing a person already reads it as elsewhere in the app: a real
 * trailing window, not a coin-flip-sized handful of games. Rare-positive
 * markets (home runs, triples, stolen bases) don't need category-aware
 * handling *here* — `lib/sports/mlb/adapter.ts`'s `interestSide` gate
 * already stops an Under-only streak on those markets from ever becoming a
 * candidate in the first place, upstream of this filter.
 */
export function scanConsistent(
  candidates: PickCandidate[],
  { minSampleSize = 5 }: ConsistencyOptions = {},
): PickCandidate[] {
  return candidates.filter((c) => c.consistent && c.sampleSize >= minSampleSize);
}

/** Group candidates by their dimension, preserving input order within a group. */
export function groupByDimension(candidates: PickCandidate[]): Map<string, PickCandidate[]> {
  const out = new Map<string, PickCandidate[]>();
  for (const c of candidates) {
    const bucket = out.get(c.dimension);
    if (bucket) bucket.push(c);
    else out.set(c.dimension, [c]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Streak / form
// ---------------------------------------------------------------------------

export interface FormReading {
  /**
   * Consecutive most-recent periods, signed: positive is a run of the
   * candidate's category, negative a run against it.
   */
  streak: number;
  /** The trailing window. `insufficient` when the games aren't there. */
  recent: WindowedStat;
  /** All available history. */
  baseline: WindowedStat;
  /**
   * recent.rate − baseline.rate. Positive = heating up.
   *
   * Null whenever either side is insufficient — a trend measured against a
   * window we declined to report is not a trend we can report either.
   */
  delta: number | null;
  windowSize: number;
}

export interface FormOptions {
  /** How many recent periods count as "recent". */
  window?: number;
}

/**
 * Rolling-window form for one candidate. History is assumed ascending by
 * period; the window is taken from the tail.
 *
 * The window is fixed: a candidate with 3 games has no 5-game form, and this
 * says so rather than reporting a 3-game rate under a 5-game label.
 */
export function readForm(candidate: PickCandidate, { window = 5 }: FormOptions = {}): FormReading {
  const recent = fixedWindow(candidate.history, candidate.category, window);
  const baseline = openWindow(candidate.history, candidate.category, { minimum: 1 });

  return {
    streak: currentStreak(candidate.history, candidate.category),
    recent,
    baseline,
    delta: isOk(recent) && isOk(baseline) ? recent.rate - baseline.rate : null,
    windowSize: window,
  };
}

export interface StreakHit {
  candidate: PickCandidate;
  form: FormReading;
}

export interface StreakOptions extends FormOptions {
  /** Minimum consecutive matching periods to qualify. */
  minStreak?: number;
}

/** Candidates riding a live streak, longest first. */
export function scanStreaks(
  candidates: PickCandidate[],
  { minStreak = 3, window = 5 }: StreakOptions = {},
): StreakHit[] {
  const rateOf = (hit: StreakHit) => (isOk(hit.form.recent) ? hit.form.recent.rate : -1);

  return candidates
    .map((candidate) => ({ candidate, form: readForm(candidate, { window }) }))
    .filter((hit) => hit.form.streak >= minStreak)
    .sort((a, b) => b.form.streak - a.form.streak || rateOf(b) - rateOf(a));
}

/**
 * Hot and cold movers: dimensions trending away from their own baseline.
 * `minDelta` is expressed as a rate difference (0.2 = 20 percentage points).
 */
export function scanMovers(
  candidates: PickCandidate[],
  { window = 5, minDelta = 0.2, minSampleSize = 4 }: FormOptions & { minDelta?: number; minSampleSize?: number } = {},
): { hot: StreakHit[]; cold: StreakHit[] } {
  // A mover needs both a filled window and a baseline to move against, so
  // readings whose delta is null are simply not movers — in either direction.
  const readings = candidates
    .filter((c) => c.sampleSize >= minSampleSize)
    .map((candidate) => ({ candidate, form: readForm(candidate, { window }) }))
    .filter((r): r is StreakHit & { form: FormReading & { delta: number } } => r.form.delta !== null);

  const hot = readings
    .filter((r) => r.form.delta >= minDelta)
    .sort((a, b) => b.form.delta - a.form.delta);
  const cold = readings
    .filter((r) => r.form.delta <= -minDelta)
    .sort((a, b) => a.form.delta - b.form.delta);

  return { hot, cold };
}

// ---------------------------------------------------------------------------
// "Coming up" ordering
// ---------------------------------------------------------------------------

/**
 * Sort by how soon the bet window closes.
 *
 * Exact distance is the primary key and an estimated ETA is only ever a
 * tiebreaker between equal distances — an estimate must never reorder two
 * subjects whose true positions we actually know.
 *
 * Ordering: live-with-known-distance → live-without-distance → pre → unknown → done.
 */
export function sortByComingUp(candidates: PickCandidate[]): PickCandidate[] {
  const statusRank = (c: PickCandidate) => {
    switch (c.liveState.status) {
      case 'live':
        return c.liveState.distanceToSubject !== null ? 0 : 1;
      case 'pre':
        return 2;
      case 'unknown':
        return 3;
      case 'done':
        return 4;
      default:
        return 3;
    }
  };

  return [...candidates].sort((a, b) => {
    const rank = statusRank(a) - statusRank(b);
    if (rank !== 0) return rank;

    const da = a.liveState.distanceToSubject;
    const db = b.liveState.distanceToSubject;
    if (da !== null && db !== null && da !== db) return da - db;
    if (da !== null && db === null) return -1;
    if (da === null && db !== null) return 1;

    const ea = a.liveState.etaMinutes;
    const eb = b.liveState.etaMinutes;
    if (ea !== null && eb !== null && ea !== eb) return ea - eb;
    if (ea !== null && eb === null) return -1;
    if (ea === null && eb !== null) return 1;

    return a.subjectName.localeCompare(b.subjectName);
  });
}

export interface ComingUpOptions extends ConsistencyOptions {
  /** Only include candidates at most this many units away. */
  maxDistance?: number;
  /** Require the pattern to be consistent as well as imminent. */
  consistentOnly?: boolean;
}

/** Imminent, high-evidence candidates, nearest first. */
export function scanComingUp(
  candidates: PickCandidate[],
  { maxDistance = 6, minSampleSize = 2, consistentOnly = true }: ComingUpOptions = {},
): PickCandidate[] {
  const pool = candidates.filter((c) => {
    if (c.sampleSize < minSampleSize) return false;
    if (consistentOnly && !c.consistent) return false;
    if (c.liveState.status !== 'live') return false;
    const d = c.liveState.distanceToSubject;
    // Unknown distance is kept: the UI labels it honestly rather than dropping it.
    return d === null || d <= maxDistance;
  });
  return sortByComingUp(pool);
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export function scanWatchlist(candidates: PickCandidate[], watchedSubjectIds: Iterable<string>): PickCandidate[] {
  const watched = new Set(watchedSubjectIds);
  return sortByComingUp(candidates.filter((c) => watched.has(c.subjectId)));
}
