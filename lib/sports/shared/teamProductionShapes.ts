/**
 * Shapes of the R5b strength rollups — the database-free half of
 * `teamProduction.ts`. Written daily by `teamProductionJob`
 * (`python-odds-service/src/team_production.py`); the stat keys, position
 * groups and production score are the G2 tools', and the league shape below is
 * G2's `matchup-*.json` `rollup[season]`, so the rebuilt cards read one shape.
 */

/** `player_game_history.sport` values the rollups cover. */
export const TEAM_PRODUCTION_SPORTS = ['nfl', 'cfb', 'mlb', 'nba', 'nhl', 'soccer_epl', 'soccer_mls'] as const;
export type TeamProductionSport = (typeof TEAM_PRODUCTION_SPORTS)[number];

export function isTeamProductionSport(v: string): v is TeamProductionSport {
  return (TEAM_PRODUCTION_SPORTS as readonly string[]).includes(v);
}

/** Summed stat keys over `g` games. Divide by `g` for per game. */
export interface TeamTotals {
  g: number;
  s: Record<string, number>;
}

export interface LeagueProduction {
  sport: TeamProductionSport;
  season: number;
  /** Games strictly before this date only; `null` = the whole season so far. */
  before: string | null;
  /** What each team's players produced. */
  for: Record<string, TeamTotals>;
  /** What each team's opponents produced against it. */
  allowed: Record<string, TeamTotals>;
  /**
   * Allowed, split by the producing player's position group: NFL QB/RB/WR/TE,
   * NBA G/F/C, NHL F/D/G, soccer GK/DEF/MID/FWD, plus `other` (a position in no
   * group) and `unknown` (no position on record). Empty for MLB and CFB.
   * `g` is the team's games, as on `allowed`.
   */
  allowedPos: Record<string, Record<string, TeamTotals>>;
}

export interface KeyPlayer {
  athleteId: string;
  teamId: string;
  games: number;
  /** Production score: a weighted sum of what the player produced (never games played). */
  score: number;
  scorePerGame: number;
  /** 0-1 of the team's summed score: roster production. */
  teamShare: number | null;
  position: string | null;
  positionGroup: string | null;
  stats: Record<string, number>;
  lastGameDate: string;
}
