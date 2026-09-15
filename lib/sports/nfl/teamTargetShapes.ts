/**
 * Shapes of the R5d NFL team target maps — the database-free half of
 * `teamTargets.ts`. Cells are nflverse's `pass_length|pass_location`
 * ("short|left", "deep|middle"), each [targets, completions, air yards].
 */

export type TargetCell = [number, number, number];

export interface TeamTargetSide {
  games: number;
  cells: Record<string, TargetCell>;
}

export interface NflTeamTargets {
  season: number;
  teamId: string;
  /** Where this offense throws. */
  offense: TeamTargetSide | null;
  /** Where this defense is thrown at. */
  defense: TeamTargetSide | null;
  /** The defense, by the targeted receiver's position (WR, TE, RB). */
  defenseByPosition: Record<string, TeamTargetSide>;
  /** Every team's throws together, for the league baseline. */
  league: TeamTargetSide | null;
}
