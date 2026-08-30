/**
 * `careerH2H` (role 6) — this subject's record against this specific opponent.
 *
 * ============ WHY THIS IS NOT A SECOND COPY OF THE H2H WINDOW BOX ==========
 *
 * Every sport's adapter already computes `windows.h2h`, and the window-box row
 * already renders it. Building a card that repeats that one number would be
 * the duplicate-card mistake this phase caught once already with
 * `opponentUnit` for NFL/NBA/NHL/CFB.
 *
 * What this adds is `meetings` — the game-by-game results, oldest first. "3 of
 * 5" and "3 of 5, all three in 2019" are different facts, and the window box
 * cannot tell them apart. The role's own doc comment says sample size is
 * usually the headline here; the meetings are what let a reader judge it.
 *
 * If a sport can only supply the rate and not the meetings, it should keep
 * rendering the window box and leave this role null rather than ship a card
 * that says the same thing twice.
 * ===========================================================================
 *
 * The opponent predicate is passed in, not derived, because how a sport
 * identifies an opponent genuinely differs — MLB matches a numeric team id, NFL
 * an abbreviation, soccer a full team name (and comparing across those
 * namespaces is a bug this codebase has already shipped twice, in soccer and
 * CFB). Each adapter already owns the right predicate for its own `h2h` window;
 * this takes the same one.
 */

import { entryValue, isOk, subsetWindow } from '@/lib/core/windowedStat';
import type { HistoryEntry } from '@/lib/core/types';
import type { CareerH2HRole, RoleStat } from '@/lib/sports/shared/playerRoles';

export interface CareerH2HInput {
  /** History ALREADY categorised against the active line (`categoriseByLine`). */
  measured: HistoryEntry[];
  /** `OVER` or `UNDER` — whichever side is being read. */
  wanted: string;
  /** The same predicate the sport's own `windows.h2h` uses. */
  isVsOpponent: (entry: HistoryEntry) => boolean;
  /** "vs NYY", "vs Gerrit Cole", "at Augusta National". */
  opponentLabel: string;
  /** What the per-meeting value measures, for the stat row's label. */
  statLabel: string;
  decimals?: number;
  /** Fewest meetings worth showing. Below this the card is not built. */
  minimum?: number;
}

/**
 * `null` when there is no opponent, or too few meetings to be worth a card.
 *
 * ONE MEETING IS NOT A RECORD. The default minimum is 2 rather than 1 because a
 * single prior game rendered under a "vs NYY" heading reads as a trend, and the
 * window box already reports it as a rate.
 */
export function toCareerH2H(input: CareerH2HInput): CareerH2HRole | null {
  const { measured, wanted, isVsOpponent, opponentLabel, statLabel, decimals = 1, minimum = 2 } = input;

  const meetingsRaw = measured.filter(isVsOpponent);
  if (meetingsRaw.length < minimum) return null;

  const window = subsetWindow(measured, wanted, isVsOpponent, { minimum });
  if (!isOk(window)) return null;

  const stats: RoleStat[] = [
    {
      key: 'hitRate',
      label: 'Cleared the line',
      value: window.rate * 100,
      decimals: 0,
      sub: `${window.hits} of ${window.total}`,
    },
    { key: 'average', label: statLabel, value: window.average, decimals },
  ];

  return {
    title: 'Head to head',
    opponentLabel,
    sampleSize: window.total,
    sampleLabel: window.total === 1 ? 'meeting' : 'meetings',
    stats,
    // Oldest first, matching the "ascending = older -> newer" convention every
    // sport's `HistoryEntry.period` already follows, so a strip reads
    // left-to-right as time. A meeting whose value cannot be parsed keeps its
    // place with a null value rather than being dropped — removing it would
    // silently shorten the history and misdate everything after it.
    meetings: meetingsRaw
      .slice()
      .sort((a, b) => a.period - b.period)
      .map((e) => ({
        key: `${e.period}`,
        date: e.periodLabel ?? String(e.period),
        value: entryValue(e),
        title: e.periodLabel,
      })),
  };
}
