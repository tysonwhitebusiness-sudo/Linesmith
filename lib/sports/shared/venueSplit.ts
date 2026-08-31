/**
 * Home/away as a `binarySplit` role — Phase 6.13.
 *
 * One shared builder rather than four near-identical blocks, for the same
 * reason `run_provider_specs` exists on the Python side: the guard below is the
 * whole value of this file, and four hand-written copies is four chances to
 * forget it.
 *
 * ============ WHY BOTH SIDES MUST BE NON-EMPTY, AND IT IS NOT FUSSINESS ======
 *
 * `raw.isHome` is a BOOLEAN derived from a team-name comparison, so a failed
 * comparison does not error — it returns `false`, and every one of that
 * player's matches becomes "away". Understat's is a bare string equality
 * (`lib/sports/soccer/understat.ts:306`, `m.h_team === understatTeamTitle`),
 * the same shape as the `_team_match` equality task 5.8 had to fix.
 *
 * Measured on the live EPL slate: 278 of 303 subjects split plausibly, but
 * **13 had zero home entries across every match** — Harvey Elliott, Frank
 * Onyeka and Lucas Gourna-Douath among them. Those few skew the whole board:
 * the aggregate reads 3,228 home against 13,013 away, which is not what a
 * season of fixtures looks like.
 *
 * A card rendering "away 0.42 (n=331) / home — (n=0)" for those players states
 * something false with total confidence. Requiring both sides suppresses it,
 * and costs nothing real: a split with an empty side is not a split. This does
 * NOT fix the underlying resolution — see the handoff — it stops the defect
 * reaching a page.
 * ===========================================================================
 *
 * Sports whose history genuinely has no home and away (tennis: every match is
 * at a neutral venue; golf: same) simply never call this.
 */

import { isOk, subsetWindow, type WindowedStat } from '@/lib/core/windowedStat';
import type { HistoryEntry } from '@/lib/core/types';
import type { BinarySplitRole } from '@/lib/sports/shared/playerRoles';

/** Reads `raw` off an entry the same way every sport adapter already does. */
function rawOf(entry: HistoryEntry): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

export interface VenueSplitInput {
  /** History ALREADY categorised against the active line (`categoriseByLine`). */
  measured: HistoryEntry[];
  /** `OVER` or `UNDER` — whichever side the candidate is being read for. */
  wanted: string;
  /** What the average is measuring, e.g. "Receiving yards". */
  statLabel: string;
  /** Decimals for the average row. Hit rate is always a whole percent. */
  decimals?: number;
  /**
   * Fewest entries a side needs before it counts. One is enough to be
   * non-empty but not enough to be worth reading; three is the smallest number
   * that is not obviously noise, and the sample travels with the row anyway so
   * a reader can discount it themselves.
   */
  minimum?: number;
  /**
   * Smallest share of the total the SMALLER side may hold, 0-1.
   *
   * This is a statement about fixtures, not a fudge factor: league teams play a
   * balanced schedule, so a real home/away split sits near 0.5 and the worst
   * honest mid-season case is perhaps 0.3. The default of 0.25 tolerates a 1:3
   * imbalance and still rejects the failure this exists for.
   */
  minShare?: number;
}

/**
 * `null` whenever either side is missing — see this file's header. That is the
 * common case early in a season and the correct one, not a gap being hidden.
 */
export function toVenueBinarySplit(input: VenueSplitInput): BinarySplitRole | null {
  const { measured, wanted, statLabel, decimals = 1, minimum = 3, minShare = 0.25 } = input;

  const home: WindowedStat = subsetWindow(measured, wanted, (e) => rawOf(e).isHome === true, { minimum });
  const away: WindowedStat = subsetWindow(measured, wanted, (e) => rawOf(e).isHome === false, { minimum });
  if (!isOk(home) || !isOk(away)) return null;

  // A NON-EMPTY SIDE IS NOT THE SAME AS A BALANCED ONE, and requiring only
  // `minimum` on each side is not enough. Callum Wilson's live EPL page
  // rendered "Home 0 (n=5) vs Away 28 (n=267)" straight through that check.
  //
  // The mechanism is worth knowing, because it is not simply a bad join:
  // Understat's `isHome` compares each historical fixture's home team against
  // the player's CURRENT team title, so every match played at a previous club
  // is recorded as away. The longer the career, the more lopsided it gets — and
  // the numbers on the card stay individually well-formed the whole time.
  //
  // Teams play a balanced schedule, so a real split is near 50/50. 5 of 272 is
  // 1:53, which is not a venue effect under any circumstances.
  const total = home.total + away.total;
  if (total === 0 || Math.min(home.total, away.total) / total < minShare) return null;

  return {
    title: 'Home / away',
    aLabel: 'Home',
    bLabel: 'Away',
    rows: [
      {
        key: 'hitRate',
        label: `Cleared the line`,
        a: home.rate * 100,
        b: away.rate * 100,
        decimals: 0,
        aSample: home.total,
        bSample: away.total,
        suffix: '%',
      },
      {
        key: 'average',
        label: statLabel,
        a: home.average,
        b: away.average,
        decimals,
        aSample: home.total,
        bSample: away.total,
      },
    ],
    emptyMessage: 'Not enough games at both venues yet.',
  };
}
