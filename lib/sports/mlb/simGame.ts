
import { simulateGames, blendBatterPitcherVector, applyParkFactor, type OutcomeVector, type Rng } from './simEngine';

export interface SimGameContext {
  season: number;
  /** Real personIds, batting order 1-9. */
  homeLineupIds: number[];
  awayLineupIds: number[];
  homeStarterId: number;
  awayStarterId: number;
  homeTeamId: number;
  awayTeamId: number;
  /** Null when the venue is unknown — applyParkFactor treats a missing/neutral factor as 1 (no adjustment). */
  venueId: number | null;
}

export interface SimGameResult {
  n: number;
  homeWinProb: number;
  awayWinProb: number;
  homeExpectedRuns: number;
  awayExpectedRuns: number;
  expectedTotal: number;
}

const defaultRng: Rng = () => Math.random();

/**
 * Team-vs-team only — no per-batter lineup, no starter/bullpen handoff.
 * This is Phase 7's historical-backfill counterpart to
 * simulateGameForContext above: real per-game historical lineups/starters
 * aren't cheaply available at scale (see computeTeamBattingVector's own
 * comment), so the backfill uses each team's whole-roster season-aggregate
 * batting vs. the opponent's whole-roster season-aggregate pitching instead
 * — the same team-only simplification modelFit.ts already discloses and
 * accepts for its own training features. Callers already holding
 * precomputed team vectors (modelFit.ts's per-team-season cache, avoiding
 * redundant fetches across a team's ~162 games) pass them in directly rather
 * than this function re-fetching per call.
 */
export function simulateTeamMatchup(
  homeBatting: OutcomeVector,
  homePitching: OutcomeVector,
  awayBatting: OutcomeVector,
  awayPitching: OutcomeVector,
  leagueRates: OutcomeVector,
  parkFactor: number,
  n: number,
  rng: Rng = defaultRng,
): { homeWinProb: number; expectedTotal: number } {
  const homeVector = applyParkFactor(blendBatterPitcherVector(homeBatting, awayPitching, leagueRates), parkFactor);
  const awayVector = applyParkFactor(blendBatterPitcherVector(awayBatting, homePitching, leagueRates), parkFactor);
  const results = simulateGames(homeVector, awayVector, n, rng);
  const homeWins = results.filter((r) => r.homeRuns > r.awayRuns).length;
  const totalRuns = results.reduce((s, r) => s + r.homeRuns + r.awayRuns, 0);
  return { homeWinProb: homeWins / n, expectedTotal: totalRuns / n };
}
