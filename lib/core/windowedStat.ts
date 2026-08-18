/**
 * Windowed statistics — the one place in Linesmith that turns a history into a
 * rate.
 *
 * The rule this file exists to enforce: **a fixed window asks for exactly that
 * many games, and resolves to `insufficient` when they aren't there.** It never
 * quietly measures a shorter window and labels it with the longer one's name.
 * That is what produced "7 of 15" on a player with 7 games behind him — a
 * number that reads as a real 47% rate when the honest answer is "we don't know
 * yet".
 *
 * `insufficient` is a first-class result, not an error and not a zero. Consumers
 * branch on `status`; nothing may reach into a window's internals without
 * checking it first. There is deliberately no `rate` field on the insufficient
 * variant, so a consumer that forgets to branch fails to compile rather than
 * rendering a plausible-looking lie.
 *
 * Windows are evaluated independently of one another: a player with 8 games has
 * a real L5 and an insufficient L15 at the same time, and both statements are
 * true.
 */

import type { HistoryEntry } from './types';

// ---------------------------------------------------------------------------
// The result type
// ---------------------------------------------------------------------------

export type WindowedStat =
  | {
      status: 'ok';
      /** Periods in the window matching the category being measured. */
      hits: number;
      /** Periods in the window. For a fixed window this equals what was asked. */
      total: number;
      /** hits / total, in [0,1]. */
      rate: number;
      /** Mean numeric magnitude across the window (0 when nothing parsed). */
      average: number;
    }
  | {
      status: 'insufficient';
      /** How many periods we actually have. */
      available: number;
      /** How many the window asked for. */
      required: number;
    };

export function isOk(stat: WindowedStat): stat is Extract<WindowedStat, { status: 'ok' }> {
  return stat.status === 'ok';
}

/** Rate for sorting/filtering. Insufficient sorts below every real rate. */
export function rateOrNull(stat: WindowedStat): number | null {
  return stat.status === 'ok' ? stat.rate : null;
}

/** Average for sorting/filtering. Insufficient sorts below every real average. */
export function averageOrNull(stat: WindowedStat): number | null {
  return stat.status === 'ok' ? stat.average : null;
}

// ---------------------------------------------------------------------------
// Reading a magnitude out of a result token
// ---------------------------------------------------------------------------

/**
 * Numeric magnitude of one period's result token.
 *
 * The engine stores results as sport-authored strings ('-1', 'E', '2-4', '3 R')
 * because that's what a human wants to read. Averages and bar charts need a
 * number, so this reads one back by the *shape* of the token, never by
 * branching on sport. A token this can't parse returns null and is excluded
 * from the average rather than being counted as a zero — a game we couldn't
 * parse is not a game in which the player recorded nothing.
 */
export function entryValue(entry: HistoryEntry): number | null {
  const token = entry.result.trim();
  if (token === '') return null;
  // Golf: level par.
  if (/^e$/i.test(token)) return 0;
  // Golf: '-1' | '+2' | '3'.
  if (/^[+-]?\d+$/.test(token)) return Number(token);
  // MLB batting: '2-4' → 2 hits.
  const ratio = token.match(/^(\d+)\s*-\s*\d+$/);
  if (ratio) return Number(ratio[1]);
  // MLB pitching: '3 R'.
  const leading = token.match(/^(\d+)/);
  if (leading) return Number(leading[1]);
  return null;
}

/** Mean magnitude across a slice, ignoring periods whose token didn't parse. */
function meanValue(slice: HistoryEntry[]): number {
  let sum = 0;
  let counted = 0;
  for (const entry of slice) {
    const value = entryValue(entry);
    if (value === null) continue;
    sum += value;
    counted += 1;
  }
  return counted === 0 ? 0 : sum / counted;
}

function summarise(slice: HistoryEntry[], category: string): Extract<WindowedStat, { status: 'ok' }> {
  const hits = slice.filter((entry) => entry.category === category).length;
  return {
    status: 'ok',
    hits,
    total: slice.length,
    rate: slice.length === 0 ? 0 : hits / slice.length,
    average: meanValue(slice),
  };
}

// ---------------------------------------------------------------------------
// Window constructors
// ---------------------------------------------------------------------------

/**
 * A fixed trailing window — L5, L10, L15.
 *
 * `history` is assumed ascending (oldest first) and already filtered to
 * qualifying periods by the adapter, so "the last 10 games" is literally the
 * last 10 entries. Anything short of `required` is insufficient; there is no
 * partial credit.
 */
export function fixedWindow(history: HistoryEntry[], category: string, required: number): WindowedStat {
  if (required <= 0) return { status: 'insufficient', available: history.length, required };
  if (history.length < required) {
    return { status: 'insufficient', available: history.length, required };
  }
  return summarise(history.slice(-required), category);
}

/**
 * An open-ended window — season to date, or a full career log.
 *
 * Its denominator is whatever history exists rather than a number we asked for,
 * so it can't be "short". It still reports insufficient below `minimum`,
 * because a rate computed from one game is noise wearing a percentage sign.
 *
 * Because the denominator varies, callers must disclose it (the supporting
 * fraction) — see `HitRateCell`'s `showFraction`.
 */
export function openWindow(
  history: HistoryEntry[],
  category: string,
  { minimum = 1 }: { minimum?: number } = {},
): WindowedStat {
  if (history.length < minimum) {
    return { status: 'insufficient', available: history.length, required: minimum };
  }
  return summarise(history, category);
}

/**
 * An open-ended window over an arbitrary subset — versus one opponent, home
 * games only, versus a handedness.
 *
 * Same variable-denominator contract as `openWindow`: disclose the count.
 */
export function subsetWindow(
  history: HistoryEntry[],
  category: string,
  predicate: (entry: HistoryEntry) => boolean,
  { minimum = 1 }: { minimum?: number } = {},
): WindowedStat {
  return openWindow(history.filter(predicate), category, { minimum });
}

/**
 * Consecutive most-recent periods matching the category, signed.
 *
 * Positive counts a run of hits; negative counts a run of misses, so a cold
 * streak is as legible as a hot one. Zero means the history is empty.
 */
export function currentStreak(history: HistoryEntry[], category: string): number {
  if (history.length === 0) return 0;
  const matching = history[history.length - 1].category === category;
  let run = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if ((history[i].category === category) !== matching) break;
    run += 1;
  }
  return matching ? run : -run;
}

// ---------------------------------------------------------------------------
// Standard window set
// ---------------------------------------------------------------------------

export const STANDARD_WINDOWS = [5, 10, 15] as const;

export interface WindowSet {
  l5: WindowedStat;
  l10: WindowedStat;
  l15: WindowedStat;
  /** Season / all available history. */
  szn: WindowedStat;
  /** Signed run length. */
  streak: number;
}

/**
 * The window set every dense surface needs, computed once per candidate.
 *
 * Computing these together rather than per-cell is what keeps the Scan table's
 * sort and its render reading identical numbers.
 */
export function windowSet(history: HistoryEntry[], category: string): WindowSet {
  return {
    l5: fixedWindow(history, category, 5),
    l10: fixedWindow(history, category, 10),
    l15: fixedWindow(history, category, 15),
    szn: openWindow(history, category, { minimum: 1 }),
    streak: currentStreak(history, category),
  };
}

// ---------------------------------------------------------------------------
// Re-measuring a history against a different threshold
// ---------------------------------------------------------------------------

export const OVER = 'over';
export const UNDER = 'under';

/**
 * Re-bucket a history against an arbitrary line.
 *
 * This is what makes the detail page's line stepper real rather than
 * decorative: moving 0.5 → 1.5 doesn't re-fetch anything, it re-reads the same
 * games and asks a different question of them. A period whose token wouldn't
 * parse keeps a distinct `unknown` bucket so it can't be silently counted as a
 * miss — it isn't one, we just can't tell.
 */
export function categoriseByLine(history: HistoryEntry[], line: number): HistoryEntry[] {
  return history.map((entry) => {
    const value = entryValue(entry);
    return {
      ...entry,
      category: value === null ? 'unknown' : value > line ? OVER : UNDER,
    };
  });
}

// ---------------------------------------------------------------------------
// Delta against a threshold
// ---------------------------------------------------------------------------

export interface Delta {
  /** average − line. */
  absolute: number;
  /** (average − line) / line, as a fraction. Null when the line is zero. */
  percent: number | null;
}

/**
 * How far an average sits from the line it is being measured against.
 *
 * Returns null when the window is insufficient — a delta computed from a
 * number we refused to show would smuggle that number back onto the screen.
 */
export function deltaFromLine(stat: WindowedStat, line: number): Delta | null {
  if (stat.status !== 'ok') return null;
  const absolute = stat.average - line;
  return {
    absolute,
    percent: line === 0 ? null : absolute / Math.abs(line),
  };
}
