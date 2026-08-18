/**
 * Home Run model's live pitcher-matchup lookup — closes the gap flagged in
 * docs/hr-predictor-plan.md's live wiring: the active model was fit using a
 * real team-level HR-rate-allowed signal, but adapter.ts's live path fed it
 * a hardcoded neutral 0 because this lookup didn't exist yet.
 *
 * Same shape as parkFactors.ts: an expensive `refresh*` computation (pulls
 * every qualified batter's current-season game log — the same pull
 * homeRunModelFit.ts's training builder does), persisted to SQLite, and a
 * cheap `load*Cache` read for the live request path. Never recomputed
 * per-request — that would mean re-running the full qualified-batter pull
 * on every snapshot build.
 */

import { computeLeagueAndTeamHrRates } from './homeRunModelFit';
import { readTeamHrRateAllowed, writeTeamHrRateAllowed } from '../../db/client';

/** Same thin-sample guard as the training builder's teamHrRateAllowed (aggregateLeagueAndTeamHrRates) — must match exactly, since this cache is read against a fitted weight learned under that exact guard. */
const MIN_GAMES_FACED_FOR_TEAM_RATE = 10;

/** Recomputes this season's team HR-rate-allowed from live MLB data and persists it. Expensive — pulls the full qualified-batter pool's game logs, same cost as a training-row build for one season. Call this periodically (e.g. once a day), not per-request. */
export async function refreshTeamHrRateAllowed(season: number): Promise<void> {
  const { leagueHrRate, teamGamesFaced, teamGamesWithHrAllowed } = await computeLeagueAndTeamHrRates(season);
  const teamIds = new Set([...teamGamesFaced.keys(), ...teamGamesWithHrAllowed.keys()]);
  const rows = [...teamIds].map((teamId) => ({
    teamId,
    gamesFaced: teamGamesFaced.get(teamId) ?? 0,
    gamesWithHrAllowed: teamGamesWithHrAllowed.get(teamId) ?? 0,
  }));
  writeTeamHrRateAllowed(season, leagueHrRate, rows);
}

export interface TeamHrRateAllowedCache {
  leagueHrRate: number;
  /** Already resolved to the fallback league rate for any team below the trust floor, or missing entirely (e.g. cache not refreshed yet this season) — a caller just calls this, no guard logic needed at the call site. */
  rateFor: (teamId: number | undefined) => number;
}

const FALLBACK_LEAGUE_HR_RATE = 0.11;

/** Live-path lookup, read once per snapshot build rather than per candidate — same pattern as parkFactors.ts's loadParkFactorCache. Falls back to a fixed neutral league rate (not 0 — see homeRunModel.ts's pitcherMatchupSignal, whose log-odds baseline is the league rate, not zero) when the cache has never been refreshed for this season yet. */
export function loadTeamHrRateAllowedCache(season: number): TeamHrRateAllowedCache {
  const rows = readTeamHrRateAllowed(season);
  if (rows.length === 0) {
    return { leagueHrRate: FALLBACK_LEAGUE_HR_RATE, rateFor: () => FALLBACK_LEAGUE_HR_RATE };
  }
  const leagueHrRate = rows[0].leagueHrRate;
  const byTeam = new Map(rows.map((r) => [r.teamId, r]));
  const rateFor = (teamId: number | undefined): number => {
    if (teamId == null) return leagueHrRate;
    const row = byTeam.get(teamId);
    if (!row || row.gamesFaced < MIN_GAMES_FACED_FOR_TEAM_RATE) return leagueHrRate;
    return row.gamesWithHrAllowed / row.gamesFaced;
  };
  return { leagueHrRate, rateFor };
}
