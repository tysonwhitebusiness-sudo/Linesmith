/**
 * The compare control's shapes and its "what a team gives up" spec — R10.
 *
 * WHAT COMPARE IS. The player page answers "how has he done"; compare answers
 * "against THIS opponent". The control picks a team (defaulting to the one he
 * plays next, else the one he played last) and the page gains two cards: his
 * own games against them, and what that team gives up to players like him.
 *
 * THE SPEC BELOW IS G2'S `ALLOW` MAP (`docs/design/phase-g2/src/sports/
 * compare.js`), ported key for key, because the rollup it reads is the same one
 * G2's `matchup-*.json` carries. Three things are worth knowing before editing
 * it:
 *
 *   1. `side` says WHICH half of the rollup answers the question.
 *      `allowedPos:<group>` is what a team gives up to that position group;
 *      `allowed` is what it gives up to everyone; `for` is the team's OWN
 *      production, which is the right side for a goalkeeper or a pitcher —
 *      what he will face is the opponent's attack, not what it concedes.
 *   2. **MLB and CFB hold no position groups** (R10 Step 0, measured): their
 *      rollups are `all` only, which is why their entries use `allowed`/`for`.
 *      Asking for `allowedPos:` there returns nothing, not a wrong number.
 *   3. A stat where LESS helps the player still ranks 1st for MOST given up.
 *      The label says so ("Strikeouts (lower helps the hitter)") rather than
 *      flipping the rank, because the card's one rule is "1st = gives up the
 *      most".
 *
 * Database-free: the server half is `compareServer.ts`.
 */

import type { TeamProductionSport } from './teamProductionShapes';

/** Which half of the rollup a card reads. */
export type AllowSide = `allowedPos:${string}` | 'allowed' | 'for';

export interface AllowSpec {
  /** Completes "What BUF gives up …". */
  title: string;
  side: AllowSide;
  /** Rollup stat key → row label. */
  stats: Array<[string, string]>;
}

/**
 * Per sport, the player kinds a compare card knows, keyed by the position group
 * `athlete_positions` holds (plus MLB's two roles, which come from his own
 * stats). `null` where a sport has no group for him: the card is left out
 * rather than guessed.
 */
export const ALLOW: Record<string, Record<string, AllowSpec>> = {
  nfl: {
    QB: {
      title: 'to quarterbacks',
      side: 'allowedPos:QB',
      stats: [
        ['passing.passingYards', 'Passing yards'],
        ['passing.passingTouchdowns', 'Passing TDs'],
        ['passing.completions', 'Completions'],
        ['passing.interceptions', 'Interceptions (lower helps the QB)'],
        ['passing.sacks', 'Sacks taken (lower helps the QB)'],
      ],
    },
    RB: {
      title: 'to running backs',
      side: 'allowedPos:RB',
      stats: [
        ['rushing.rushingYards', 'Rushing yards'],
        ['rushing.rushingAttempts', 'Carries'],
        ['rushing.rushingTouchdowns', 'Rushing TDs'],
        ['receiving.receptions', 'Receptions'],
        ['receiving.receivingYards', 'Receiving yards'],
      ],
    },
    WR: {
      title: 'to wide receivers',
      side: 'allowedPos:WR',
      stats: [
        ['receiving.receivingTargets', 'Targets'],
        ['receiving.receptions', 'Receptions'],
        ['receiving.receivingYards', 'Receiving yards'],
        ['receiving.receivingTouchdowns', 'Receiving TDs'],
      ],
    },
    TE: {
      title: 'to tight ends',
      side: 'allowedPos:TE',
      stats: [
        ['receiving.receivingTargets', 'Targets'],
        ['receiving.receptions', 'Receptions'],
        ['receiving.receivingYards', 'Receiving yards'],
        ['receiving.receivingTouchdowns', 'Receiving TDs'],
      ],
    },
  },
  cfb: {
    // No position source for college (R5b), so the card is the whole defence.
    all: {
      title: 'through the air (all passers)',
      side: 'allowed',
      stats: [
        ['passing.passingYards', 'Passing yards'],
        ['passing.passingTouchdowns', 'Passing TDs'],
        ['passing.interceptions', 'Interceptions'],
        ['rushing.rushingYards', 'Rushing yards'],
      ],
    },
  },
  nba: {
    G: {
      title: 'to guards',
      side: 'allowedPos:G',
      stats: [
        ['points', 'Points'],
        ['assists', 'Assists'],
        ['threePointFieldGoalsMade', '3-pointers made'],
        ['rebounds', 'Rebounds'],
        ['freeThrowsAttempted', 'Free throw attempts'],
      ],
    },
    F: {
      title: 'to forwards',
      side: 'allowedPos:F',
      stats: [
        ['points', 'Points'],
        ['rebounds', 'Rebounds'],
        ['assists', 'Assists'],
        ['threePointFieldGoalsMade', '3-pointers made'],
        ['freeThrowsAttempted', 'Free throw attempts'],
      ],
    },
    C: {
      title: 'to centers',
      side: 'allowedPos:C',
      stats: [
        ['points', 'Points'],
        ['rebounds', 'Rebounds'],
        ['blocks', 'Blocks'],
        ['assists', 'Assists'],
        ['freeThrowsAttempted', 'Free throw attempts'],
      ],
    },
  },
  nhl: {
    F: {
      title: 'to skaters',
      side: 'allowed',
      stats: [
        ['goals', 'Goals'],
        ['assists', 'Assists'],
        ['sog', 'Shots on goal'],
        ['powerPlayGoals', 'Power-play goals'],
      ],
    },
    D: {
      title: 'to skaters',
      side: 'allowed',
      stats: [
        ['goals', 'Goals'],
        ['assists', 'Assists'],
        ['sog', 'Shots on goal'],
        ['blockedShots', 'Blocked shots'],
      ],
    },
    G: {
      // A goalie faces the opponent's attack, so this is their own production.
      title: 'on offence (what the goalie will face)',
      side: 'for',
      stats: [
        ['sog', 'Shots on goal'],
        ['goals', 'Goals'],
        ['powerPlayGoals', 'Power-play goals'],
      ],
    },
  },
  mlb: {
    hitter: {
      title: 'from its pitching staff',
      side: 'allowed',
      stats: [
        ['bat_runs', 'Runs'],
        ['bat_hits', 'Hits'],
        ['bat_homeRuns', 'Home runs'],
        ['bat_baseOnBalls', 'Walks'],
        ['bat_strikeOuts', 'Strikeouts (lower helps the hitter)'],
      ],
    },
    pitcher: {
      title: 'on offence (the lineup the pitcher will face)',
      side: 'for',
      stats: [
        ['bat_runs', 'Runs'],
        ['bat_hits', 'Hits'],
        ['bat_homeRuns', 'Home runs'],
        ['bat_strikeOuts', 'Strikeouts (higher helps the pitcher)'],
        ['bat_baseOnBalls', 'Walks'],
      ],
    },
  },
  soccer_epl: {
    FWD: {
      title: 'to forwards',
      side: 'allowedPos:FWD',
      stats: [
        ['totalGoals', 'Goals'],
        ['totalShots', 'Shots'],
        ['shotsOnTarget', 'Shots on target'],
      ],
    },
    MID: {
      title: 'to midfielders',
      side: 'allowedPos:MID',
      stats: [
        ['totalGoals', 'Goals'],
        ['goalAssists', 'Assists'],
        ['totalShots', 'Shots'],
      ],
    },
    DEF: {
      title: 'to defenders',
      side: 'allowedPos:DEF',
      stats: [
        ['totalGoals', 'Goals'],
        ['totalShots', 'Shots'],
        ['yellowCards', 'Yellow cards'],
      ],
    },
    GK: {
      title: 'on attack (what the keeper will face)',
      side: 'for',
      stats: [
        ['totalShots', 'Shots'],
        ['shotsOnTarget', 'Shots on target'],
        ['totalGoals', 'Goals'],
      ],
    },
  },
};
ALLOW.soccer_mls = ALLOW.soccer_epl;

export function allowSpecFor(sport: string, group: string | null): AllowSpec | null {
  if (!group) return null;
  return ALLOW[sport]?.[group] ?? null;
}

/** One team in the compare picker. */
export interface CompareTeam {
  id: string;
  name: string;
  abbr: string;
  logoUrl: string | null;
}

/** One stat's line on the "what they give up" card: the value, and where it sits in the league. */
export interface AllowRow {
  key: string;
  label: string;
  value: number | null;
  rank: number;
  of: number;
  /** Every team's value, for the rank rail. */
  league: number[];
}

export interface PlayerComparePayload {
  sport: TeamProductionSport;
  athleteId: string;
  /** Teams with rollup rows this season, for the picker. */
  teams: CompareTeam[];
  /** The team the page opens on: the next opponent where the schedule knows one, else the last played. */
  defaultTeamId: string | null;
  /** The chosen team, echoed. */
  teamId: string | null;
  /** The player's kind, as the rollup groups him ("WR", "C", "hitter"). */
  group: string | null;
  /** `null` when the sport has no card for his group, or the rollup holds no season with enough games. */
  allow: { title: string; season: number; games: number; rows: AllowRow[]; note: string | null } | null;
  fetchedAt: string;
}
