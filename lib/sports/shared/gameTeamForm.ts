/**
 * The game page's team-form cards, built once for every sport — Phase 6.21.
 *
 * ============== THE UNIFORM INPUT WAS ALREADY THERE ==============
 *
 * The board draws a cover-form card, a situational grid and a key-numbers rail
 * on every game tab, all about ONE team's record against tonight's number. The
 * obvious way in is each sport's own team-candidate builder — NFL's team
 * response carries `candidates.moneyline`, while CFB, NBA, NHL and soccer
 * build theirs from `recentGames` through five differently-named functions and
 * MLB's game adapter never sees a team response at all. Going that way means
 * five bespoke wirings and a card MLB cannot have.
 *
 * It is not needed. Every game adapter ALREADY converts its sport's recent
 * results into `RecentResultRow` for the last-five block, and that row is
 * sport-agnostic by construction:
 *
 *     { gameId, date, win, opponentAbbr, isHome, scoreFor, scoreAgainst }
 *
 * That is enough for all of it. `isHome` gives the venue split, `opponentAbbr`
 * gives head-to-head, and the two scores give both a margin and a result. So
 * this converts those rows into `HistoryEntry[]` and hands them to
 * `buildAnalyticsRoles` — the same builder the player and team pages use, with
 * the same guards and the same tests behind it.
 *
 * ============== WHICH NUMBER THE FORM IS ABOUT ==============
 *
 * The board's MLB tab reads "NYY run line · cover form", so the question is
 * covering, not winning. When a spread is priced this grades MARGIN against
 * it; when none is, it falls back to the result itself. Both are "did they
 * cover" questions and the title says which one is being asked.
 *
 * A home favourite at -1.5 covers when its margin EXCEEDS 1.5, so the
 * threshold is `-spreadPoint` — and the same expression is correct for the
 * away side at +1.5, where it becomes -1.5 and a one-run loss still covers.
 * One line of arithmetic, both sides, no branch on which team this is.
 *
 * ============== ORDER IS NORMALISED HERE, NOT BY CALLERS ==============
 *
 * Adapters hand these rows over in whichever order their sport's API returned
 * them, and several slice a newest-first list for the last-five block. A
 * rolling mean and a recency window both read the sequence as time, so this
 * sorts by date ascending itself rather than trusting seven call sites to
 * agree about it.
 */

import type { HistoryEntry } from '@/lib/core/types';
import type { RecentResultRow } from '@/lib/sports/mlb/adapters/gameDetailAdapter';
import { categoriseByLine, OVER } from '@/lib/core/windowedStat';
import { buildAnalyticsRoles } from './analyticsRoles';
import { toCareerH2H } from './careerH2H';
import { toVenueBinarySplit } from './venueSplit';
import type { TeamRoles } from './teamRoles';

export interface GameTeamFormInput {
  /** One team's real results. Any order; sorted here. */
  rows: readonly RecentResultRow[];
  /** Whose form this is, for the card titles. */
  teamAbbr: string;
  /** Tonight's opponent, for the head-to-head record. */
  opponentAbbr?: string | null;
  /**
   * This team's spread, signed as a book writes it: `-1.5` for a favourite,
   * `+1.5` for a dog. `null` grades the result instead of the margin.
   */
  spreadPoint?: number | null;
}

/** A row becomes an entry; the caller's sport never enters into it. */
function toEntries(rows: readonly RecentResultRow[], useMargin: boolean): HistoryEntry[] {
  return [...rows]
    .filter((r) => Number.isFinite(r.scoreFor) && Number.isFinite(r.scoreAgainst))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .map((r, i) => ({
      period: i + 1,
      // Margin can be negative and `entryValue` reads a leading sign, so a
      // three-point loss is "-3" and not dropped.
      result: String(useMargin ? r.scoreFor - r.scoreAgainst : r.win ? 1 : 0),
      category: '',
      periodLabel: `${r.date} ${r.isHome ? 'vs' : '@'} ${r.opponentAbbr}`,
      raw: {
        isHome: r.isHome,
        opponentAbbr: r.opponentAbbr,
        scoreFor: r.scoreFor,
        scoreAgainst: r.scoreAgainst,
        win: r.win,
      },
    }));
}

/**
 * `{}` when there is nothing real to build from — fewer than four results
 * makes every card below either null or a claim off three games, and the
 * page's own records block already says what the record is.
 */
export function toGameTeamForm(input: GameTeamFormInput): TeamRoles {
  const { rows, teamAbbr, opponentAbbr, spreadPoint } = input;
  if (rows.length < 4) return {};

  const useMargin = spreadPoint != null && Number.isFinite(spreadPoint);
  const history = toEntries(rows, useMargin);
  if (history.length < 4) return {};

  // A favourite at -1.5 covers when the margin exceeds 1.5; the dog at +1.5
  // covers above -1.5. `-spreadPoint` is both, with no branch on side.
  const line = useMargin ? -(spreadPoint as number) : 0.5;
  const statLabel = useMargin ? `${teamAbbr} margin` : `${teamAbbr} result`;

  const analytics = buildAnalyticsRoles({ history, line, wantOver: true, statLabel });
  const measured = categoriseByLine(history, line);

  const careerH2H = opponentAbbr
    ? toCareerH2H({
        measured,
        wanted: OVER,
        isVsOpponent: (e) => (e.raw as { opponentAbbr?: string })?.opponentAbbr === opponentAbbr,
        opponentLabel: `vs ${opponentAbbr}`,
        statLabel,
      })
    : null;

  // Home/away, with `toVenueBinarySplit`'s 25% share floor kept: a league team
  // really does play a balanced schedule, so a lopsided split here is a broken
  // join rather than a tendency worth drawing.
  const binarySplit = toVenueBinarySplit({ measured, wanted: OVER, statLabel });

  return { ...analytics, careerH2H, binarySplit };
}
