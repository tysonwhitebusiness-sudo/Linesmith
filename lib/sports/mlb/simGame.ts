/**
 * Phase 6 — the real-game orchestrator: takes an actual matchup (lineups,
 * starters, teams, venue) and runs N full simulated games, composing every
 * piece built in Phases 1-5. Data-fetching half of simEngine.ts's pure/fetch
 * split (mirrors homeRunModel.ts / homeRunModelFit.ts).
 *
 * "Runs alongside the existing formulas, doesn't replace them yet" — see
 * docs/mlb-sim-engine-plan.md. This file does not touch gameModel.ts,
 * modelFit.ts, or MONEYLINE_FEATURE_NAMES/TOTAL_FEATURE_NAMES. Wiring
 * simWinProb/simOverProb into the fitted stacking regression as an actual
 * feature is Phase 7's job, done together with the historical backfill fit
 * so training and live feature construction can never drift apart —
 * splicing a new feature into gameModel.ts's already-live, already-active
 * fitted models before there's a fit that actually uses it would just add
 * risk to real predictions for zero benefit this phase.
 */

import { readParkFactors } from '../../db/client';
import {
  computeLeagueOutcomeRates,
  computeLineupOutcomeVectors,
  computePitcherOutcomeVectors,
  computeBullpenOutcomeVector,
  getStarterInningsPerStart,
} from './simRates';
import {
  simulateGame as simulatePlayedGame,
  precomputeLineupVsPitching,
  makeLineupVsPitchingStream,
  simulateGames,
  blendBatterPitcherVector,
  applyParkFactor,
  type OutcomeVector,
  type Rng,
} from './simEngine';

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
 * Runs `n` full simulated games for a real matchup and aggregates the game-
 * level markets this engine is scoped to (win probability, expected total —
 * see the plan's explicit "player props out of scope" decision). Every
 * expensive data pull (league rates, both lineups, both pitchers, both
 * bullpens, park factors) happens once, in parallel, before any simulation
 * runs — the N game replays themselves are pure in-memory math.
 */
export async function simulateGameForContext(context: SimGameContext, n = 4000, rng: Rng = defaultRng): Promise<SimGameResult> {
  const { vector: leagueRates } = await computeLeagueOutcomeRates(context.season);

  const [homeLineup, awayLineup, pitcherVectors, homeBullpen, awayBullpen, homeInningsPerStart, awayInningsPerStart, parkFactorRows] = await Promise.all([
    computeLineupOutcomeVectors(context.homeLineupIds, context.season, leagueRates),
    computeLineupOutcomeVectors(context.awayLineupIds, context.season, leagueRates),
    computePitcherOutcomeVectors([context.homeStarterId, context.awayStarterId], context.season, leagueRates),
    computeBullpenOutcomeVector(context.homeTeamId, context.season, leagueRates),
    computeBullpenOutcomeVector(context.awayTeamId, context.season, leagueRates),
    getStarterInningsPerStart(context.homeStarterId, context.season),
    getStarterInningsPerStart(context.awayStarterId, context.season),
    readParkFactors(context.season),
  ]);

  const parkFactor = context.venueId != null ? (parkFactorRows.find((r) => r.venueId === context.venueId)?.factor ?? 1) : 1;

  const homeStarterVector = pitcherVectors.get(context.homeStarterId)!;
  const awayStarterVector = pitcherVectors.get(context.awayStarterId)!;

  const homeLineupVectors = context.homeLineupIds.map((id) => homeLineup.byBatter.get(id)!);
  const awayLineupVectors = context.awayLineupIds.map((id) => awayLineup.byBatter.get(id)!);

  // Home batters face the AWAY team's starter/bullpen; away batters face HOME
  // pitching. Precomputed ONCE for this matchup, reused across all n games —
  // only the lightweight per-game stream (makeLineupVsPitchingStream) gets
  // recreated in the loop below.
  const homePrecomputed = precomputeLineupVsPitching(homeLineupVectors, awayStarterVector, awayBullpen, leagueRates, awayInningsPerStart, parkFactor);
  const awayPrecomputed = precomputeLineupVsPitching(awayLineupVectors, homeStarterVector, homeBullpen, leagueRates, homeInningsPerStart, parkFactor);

  let homeWins = 0;
  let totalHomeRuns = 0;
  let totalAwayRuns = 0;
  for (let i = 0; i < n; i++) {
    const homeStream = makeLineupVsPitchingStream(homePrecomputed, homeLineupVectors.length);
    const awayStream = makeLineupVsPitchingStream(awayPrecomputed, awayLineupVectors.length);
    const result = simulatePlayedGame(homeStream, awayStream, rng);
    if (result.homeRuns > result.awayRuns) homeWins += 1;
    totalHomeRuns += result.homeRuns;
    totalAwayRuns += result.awayRuns;
  }

  const homeWinProb = homeWins / n;
  return {
    n,
    homeWinProb,
    awayWinProb: 1 - homeWinProb,
    homeExpectedRuns: totalHomeRuns / n,
    awayExpectedRuns: totalAwayRuns / n,
    expectedTotal: (totalHomeRuns + totalAwayRuns) / n,
  };
}

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
