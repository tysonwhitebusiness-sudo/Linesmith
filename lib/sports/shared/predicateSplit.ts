/**
 * `binarySplit` from any two named predicates — the general sibling of
 * `venueSplit.ts`.
 *
 * ============ WHY THIS IS NOT JUST `toVenueBinarySplit` WITH ARGS ===========
 *
 * `toVenueBinarySplit` enforces a `minShare` of 0.25: a real home/away split
 * sits near 50/50 because **league teams play a balanced schedule**, so a 1:53
 * ratio is a broken join rather than a venue effect. That guard exists because
 * a real page rendered "Home 0 (n=5) vs Away 28 (n=267)" straight through a
 * presence check.
 *
 * **That reasoning does not transfer, and applying it here would be a bug.**
 * The splits this builder serves are genuinely lopsided by construction:
 *
 *   - A golfer plays roughly ten par 4s and four par 5s per round. 10:4 is the
 *     CORRECT ratio, and a 0.25 floor would reject a perfectly good split on a
 *     course with three par 5s.
 *   - A tennis season is mostly hard court. A clay specialist and a hard-court
 *     specialist have opposite, equally real imbalances.
 *
 * So there is no share guard here — only a per-side `minimum`, which travels
 * with the row as its own sample so a reader can discount a thin side
 * themselves. **Importing the venue rule into a non-schedule split would
 * suppress the true answer**, which is the mirror image of the defect that rule
 * was written for. Both are "a guard that fires on the wrong shape of data".
 * ===========================================================================
 */

import { subsetWindow, type WindowedStat } from '@/lib/core/windowedStat';
import type { HistoryEntry } from '@/lib/core/types';
import type { BinarySplitRole } from '@/lib/sports/shared/playerRoles';

function isOk(stat: WindowedStat): stat is Extract<WindowedStat, { status: 'ok' }> {
  return stat.status === 'ok';
}

export interface PredicateSplitInput {
  /** History ALREADY categorised against the active line (`categoriseByLine`). */
  measured: HistoryEntry[];
  /** `OVER` or `UNDER` — whichever side the candidate is read for. */
  wanted: string;
  title: string;
  aLabel: string;
  bLabel: string;
  isA: (entry: HistoryEntry) => boolean;
  isB: (entry: HistoryEntry) => boolean;
  /** What the average measures, e.g. "Aces" or "Strokes to par". */
  statLabel: string;
  decimals?: number;
  /** Fewest entries a side needs before it counts at all. */
  minimum?: number;
  /** Fewer is better — flips the heat, never the number. */
  lowerIsBetter?: boolean;
}

/**
 * `null` unless BOTH sides clear `minimum`. One populated side under a
 * two-sided heading reads as a comparison, and there is nothing to compare it
 * to — the same rule every other split builder here enforces.
 */
export function toPredicateBinarySplit(input: PredicateSplitInput): BinarySplitRole | null {
  const { measured, wanted, title, aLabel, bLabel, isA, isB, statLabel, decimals = 1, minimum = 3, lowerIsBetter } = input;

  const a = subsetWindow(measured, wanted, isA, { minimum });
  const b = subsetWindow(measured, wanted, isB, { minimum });
  if (!isOk(a) || !isOk(b)) return null;

  return {
    title,
    aLabel,
    bLabel,
    rows: [
      {
        key: 'hitRate',
        label: 'Cleared the line',
        a: a.rate * 100,
        b: b.rate * 100,
        decimals: 0,
        aSample: a.total,
        bSample: b.total,
      },
      {
        key: 'average',
        label: statLabel,
        a: a.average,
        b: b.average,
        decimals,
        aSample: a.total,
        bSample: b.total,
        lowerIsBetter,
      },
    ],
  };
}
