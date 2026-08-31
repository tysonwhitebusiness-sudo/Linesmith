/**
 * The Team Detail cards the design board draws and the page did not have —
 * Phase 6.19, the Team Detail pass.
 *
 * ================== WHAT THIS IS, AND WHY IT IS ONE CALL ==================
 *
 * The board-vs-build audit put Team Detail at 7 of the board's 22 cards, the
 * furthest behind of the three pages. Five of the missing eleven are the same
 * shapes Player Detail already fills, from data a team candidate already
 * carries: a situational grid, a density curve, a context rail, a head-to-head
 * record and a home/away split.
 *
 * So this composes `buildAnalyticsRoles` (shared with Player Detail) and adds
 * the two roles that need a team's own opponent and venue, and every one of
 * the six team adapters makes ONE call. That is the same argument
 * `analyticsRoles.ts` makes for itself: a card that does not differ by sport
 * must not be re-implemented per sport, or five of six sports quietly end up
 * with four of five cards.
 *
 * ============ WHAT EACH SPORT CAN ACTUALLY FILL, MEASURED ============
 *
 * A team candidate's `history[].raw` is NOT uniform, and the difference decides
 * which cards appear:
 *
 *  - **NFL and the other ESPN-shaped team APIs** carry `isHome`,
 *    `opponentAbbr`, `pointsFor`, `pointsAgainst` and `win` on every entry.
 *    Measured on a live NFL team: 25 games, `isHome` genuinely both true and
 *    false, five distinct opponents. Every card below fills.
 *  - **MLB's team candidates come from the SNAPSHOT, not its team route**
 *    (`/api/mlb/team/{id}` returns none), and those entries carry no `raw` at
 *    all. So MLB gets the cards that need only a value and a line -- the
 *    context rail and the density curve -- and not the ones that need to know
 *    where the game was played or who it was against.
 *
 * That asymmetry is real and is left visible rather than papered over. A card
 * whose inputs are absent returns `null` and does not render, which is the
 * sport-adapter rule doing its job.
 */

import type { HistoryEntry, PickCandidate } from '@/lib/core/types';
import { categoriseByLine, OVER, UNDER, type WindowedStat } from '@/lib/core/windowedStat';
import { buildAnalyticsRoles, type AnalyticsRoles } from './analyticsRoles';
import { toCareerH2H } from './careerH2H';
import { toVenueBinarySplit } from './venueSplit';
import type { BinarySplitRole, CareerH2HRole } from './playerRoles';

export interface TeamRoles extends AnalyticsRoles {
  /** This team's record against its next opponent. `null` without an opponent on the history. */
  careerH2H?: CareerH2HRole | null;
  /** Home vs away, the team-page instance of `binarySplit`. `null` where `raw.isHome` is absent. */
  binarySplit?: BinarySplitRole | null;
}

function rawOf(entry: HistoryEntry): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

export interface TeamRolesInput {
  /** The market the page is showing — the same `active` every team adapter already resolves. */
  active: PickCandidate | null;
  /** The line after the page's own offset stepper, not the candidate's base line. */
  line: number;
  wantOver: boolean;
  /** How the market reads in a sentence: "Runs", "Points", "Moneyline". */
  statLabel: string;
  /** Next opponent's abbreviation, for the head-to-head record. */
  opponentAbbr?: string | null;
  /**
   * Other TEAMS on the same market, for the density curve.
   *
   * MLB is the only sport that can supply this today: its team candidates live
   * on the league snapshot (24 of them on `team-total-runs`), so a pool exists.
   * The ESPN-shaped team routes return one team's candidates and nothing else,
   * so they pass nothing and the curve stays null rather than being drawn
   * against a pool of one.
   */
  peers?: ReadonlyArray<{ history: readonly HistoryEntry[] }>;
}

export function buildTeamRoles(input: TeamRolesInput): TeamRoles {
  const { active, line, wantOver, statLabel, opponentAbbr, peers } = input;
  if (!active) return {};

  const analytics = buildAnalyticsRoles({
    history: active.history,
    line,
    wantOver,
    statLabel,
    ...(peers ? { peers } : {}),
  });

  const measured: WindowedStat[] | ReturnType<typeof categoriseByLine> = categoriseByLine(active.history, line);
  const wanted = wantOver ? OVER : UNDER;

  // HEAD TO HEAD needs an opponent ON THE HISTORY, not just a next opponent.
  // NFL's entries carry `opponentAbbr`; MLB's snapshot-sourced team entries
  // carry no raw at all, so the predicate can never match and the builder's
  // own minimum returns null -- which is the honest outcome, not a bug.
  const careerH2H =
    opponentAbbr
      ? toCareerH2H({
          measured,
          wanted,
          isVsOpponent: (e) => (rawOf(e).opponentAbbr as string | undefined) === opponentAbbr,
          opponentLabel: `vs ${opponentAbbr}`,
          statLabel,
        })
      : null;

  // HOME / AWAY is the team page's instance of `binarySplit`. It keeps
  // `toVenueBinarySplit`'s 25% share floor, which is correct HERE and is
  // exactly what `predicateSplit` exists to avoid elsewhere: a league team
  // really does play a roughly balanced schedule, so a 5%/95% split is a
  // broken join rather than a real tendency. That floor was added because a
  // live EPL page rendered "Home 0 (n=5) vs Away 28 (n=267)" straight through
  // a weaker check.
  const binarySplit = toVenueBinarySplit({ measured, wanted, statLabel });

  return { ...analytics, careerH2H, binarySplit };
}
