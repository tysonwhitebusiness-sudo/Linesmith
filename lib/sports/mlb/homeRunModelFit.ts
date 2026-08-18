/**
 * Home Run model, Phases 3-5 — historical training-row builder + walk-
 * forward fit, mirroring modelFit.ts's shape exactly (buildTrainingSet ->
 * fitMoneylineWeights) but for the `home-run` market instead of moneyline/
 * total. See docs/hr-predictor-plan.md.
 *
 * Unlike modelFit.ts's team-level rows, this walks individual BATTER game
 * logs — one row per (batter, real past game), features + whether that
 * batter hit >=1 HR that game. All data comes from statsapi.ts functions
 * already used elsewhere in this app (getLeagueBatterSeasonRows,
 * getPeopleWithGameLogs, getScheduleRange) — no new endpoints.
 *
 * Two disclosed simplifications, both the same "train broad(er), predict
 * specific" shape modelFit.ts already accepts for rawLog5 (team-only in
 * training vs. starter-blended live) and getTeamBullpenEra (season-total,
 * not point-in-time):
 *
 * 1. League HR rate and each opponent's HR-rate-allowed are season
 *    aggregates, not walked point-in-time across the season. Computing a
 *    true as-of-this-date league/opponent rate would need every qualified
 *    batter's ENTIRE game log pre-sorted into one global date-ordered
 *    stream — a real v2 upgrade, not required to validate whether these
 *    features carry signal at all.
 * 2. The opponent (pitcher-matchup) signal here is team-level — "rate of
 *    batter-games where a batter went deep against this team's pitching
 *    staff" — not the specific starting pitcher faced that day. Getting the
 *    exact opposing starter per historical batter-game isn't cheaply
 *    available from the endpoints already used elsewhere in this app. Live
 *    prediction (homeRunModel's live wiring) CAN use the actual probable
 *    starter's own rate, since that's known live — same definitional gap
 *    already disclosed for starter ERA blending.
 */

import { getScheduleRange, getLeagueBatterSeasonRows, getPeopleWithGameLogs, easternDate, type GameLogSplit } from './statsapi';
import { readParkFactors, writeModelWeights, type ModelWeightsRow } from '../../db/client';
import { computeModelProbability, priorStrength } from '../../odds/props/edgeModel';
import { fitLogisticRegression, predictProb, brierScore } from '../../core/logisticRegression';
import {
  HOME_RUN_FEATURE_NAMES,
  parkHrFactorCentered,
  pitcherMatchupSignal,
  expectedPaCenteredFromTrailingAverage,
  NEUTRAL_EXPECTED_PA,
} from './homeRunModel';

/** Same shape as modelFit.ts's TrainingRow — features already in HOME_RUN_FEATURE_NAMES order, plus what's needed for the walk-forward split and holdout comparison. */
export interface HomeRunTrainingRow {
  features: number[];
  actual: number;
  date: string;
  season: number;
  /** The current live baseline's own prediction (betaBinomialHrProb alone) on this row — what the fitted model has to beat on holdout. */
  baselineProb: number;
  batterId: number;
}

/** gamePk -> venueId for one season, built from the same schedule endpoint modelFit.ts already uses for this exact purpose. */
async function buildGamePkVenueMap(season: number): Promise<Map<number, number>> {
  const games = await getScheduleRange(`${season}-03-01`, `${season}-11-30`);
  const map = new Map<number, number>();
  for (const g of games) {
    if (g.venue?.id != null) map.set(g.gamePk, g.venue.id);
  }
  return map;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface LeagueAndTeamHrRates {
  leagueHrRate: number;
  /** teamId -> games faced / games with an opponent HR, both real counts (not just the rate) so a caller can see sample size before trusting a thin one. */
  teamGamesFaced: Map<number, number>;
  teamGamesWithHrAllowed: Map<number, number>;
  teamHrRateAllowed: (teamId: number | undefined) => number;
}

/**
 * Season-aggregate league HR rate and each team's opponent-batter-games HR
 * rate — "rate of batter-games where a batter went deep against this team's
 * pitching staff" (the disclosed team-level, season-aggregate matchup proxy;
 * see file header). Pure aggregation over already-fetched game logs — pulled
 * out as its own function so the training builder below and the LIVE lookup
 * (homeRunLiveMatchup.ts) share identical math on their own independently-
 * fetched log pools — a fitted feature is only meaningful live if it's
 * computed the same way it was during training.
 */
export function aggregateLeagueAndTeamHrRates(logsById: Map<number, { gameLog: GameLogSplit[] }>): LeagueAndTeamHrRates {
  // Every game row across the whole pool, no chronology needed here (that's
  // what makes this the disclosed simplification: an early-April row and a
  // late-September row see the same season-wide number).
  let leagueGames = 0;
  let leagueGamesWithHr = 0;
  const teamGamesFaced = new Map<number, number>();
  const teamGamesWithHrAllowed = new Map<number, number>();
  for (const [, person] of logsById) {
    for (const g of person.gameLog) {
      const pa = num(g.stat.plateAppearances);
      if (pa <= 0) continue; // no real plate appearance this game (e.g. pinch-run only) — nothing to grade
      const hadHr = num(g.stat.homeRuns) >= 1 ? 1 : 0;
      leagueGames += 1;
      leagueGamesWithHr += hadHr;
      if (g.opponentId != null) {
        teamGamesFaced.set(g.opponentId, (teamGamesFaced.get(g.opponentId) ?? 0) + 1);
        if (hadHr) teamGamesWithHrAllowed.set(g.opponentId, (teamGamesWithHrAllowed.get(g.opponentId) ?? 0) + 1);
      }
    }
  }
  // Fallback matches homeRunModel.ts's own neutral-rate spirit — only hit if a
  // season somehow returns zero usable rows (e.g. an unplayed/future season).
  const leagueHrRate = leagueGames > 0 ? leagueGamesWithHr / leagueGames : 0.11;
  const teamHrRateAllowed = (teamId: number | undefined): number => {
    if (teamId == null) return leagueHrRate;
    const faced = teamGamesFaced.get(teamId) ?? 0;
    if (faced < 10) return leagueHrRate; // thin sample against one team this season — neutral rather than noisy
    return (teamGamesWithHrAllowed.get(teamId) ?? 0) / faced;
  };

  return { leagueHrRate, teamGamesFaced, teamGamesWithHrAllowed, teamHrRateAllowed };
}

/** Fetches the current qualified-batter pool and their game logs, then aggregates — the standalone entry point for anything that just wants this season's rates without also needing full per-batter training rows (see homeRunLiveCache.ts). */
export async function computeLeagueAndTeamHrRates(season: number): Promise<LeagueAndTeamHrRates> {
  const batterPool = await getLeagueBatterSeasonRows(season);
  const batterIds = batterPool.map((b) => b.personId);
  const logsById = await getPeopleWithGameLogs(batterIds, 'hitting', season);
  return aggregateLeagueAndTeamHrRates(logsById);
}

/**
 * Builds one season's training rows. Pass 1 (aggregateLeagueAndTeamHrRates)
 * computes season-aggregate league/opponent HR rates (the disclosed
 * simplification above), pass 2 walks each batter chronologically, using
 * ONLY that batter's own prior games for their personal Beta-Binomial
 * baseline and trailing-PA figure — the actual no-lookahead discipline this
 * plan requires, even though the league/opponent rates it's blended against
 * are season-constant.
 */
export async function buildHomeRunSeasonRows(season: number): Promise<HomeRunTrainingRow[]> {
  const batterPool = await getLeagueBatterSeasonRows(season);
  const batterIds = batterPool.map((b) => b.personId);
  const logsById = await getPeopleWithGameLogs(batterIds, 'hitting', season);
  const venueByGame = await buildGamePkVenueMap(season);
  const parkFactorByVenue = new Map(readParkFactors(season).map((r) => [r.venueId, r.factor]));

  // Pass 1 — same season-aggregate rates the live lookup will later share,
  // computed here from the batter logs this call already fetched for pass 2
  // rather than re-fetching them a second time.
  const { leagueHrRate, teamHrRateAllowed } = aggregateLeagueAndTeamHrRates(logsById);

  // Pass 2 — per-batter chronological walk, no lookahead on the batter's own state.
  const rows: HomeRunTrainingRow[] = [];
  for (const [batterId, person] of logsById) {
    const sorted = [...person.gameLog].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let priorGames = 0;
    let priorGamesWithHr = 0;
    let priorTotalPa = 0;

    for (const g of sorted) {
      const pa = num(g.stat.plateAppearances);
      if (pa <= 0) continue;
      const hadHr = num(g.stat.homeRuns) >= 1 ? 1 : 0;

      const baseline = computeModelProbability({
        dimension: 'home-runs',
        leagueRate: leagueHrRate,
        overCount: priorGamesWithHr,
        totalCount: priorGames,
        matchupFavorable: null, // no historical barrelPct replication here — disclosed, see file header
      });

      const venueId = g.gamePk != null ? venueByGame.get(g.gamePk) : undefined;
      const parkFactor = venueId != null ? (parkFactorByVenue.get(venueId) ?? 1) : 1;
      const trailingAvgPa = priorGames > 0 ? priorTotalPa / priorGames : NEUTRAL_EXPECTED_PA;

      const features = [
        baseline.prob,
        parkHrFactorCentered(parkFactor),
        pitcherMatchupSignal(teamHrRateAllowed(g.opponentId), leagueHrRate),
        expectedPaCenteredFromTrailingAverage(trailingAvgPa),
      ];

      rows.push({
        features,
        actual: hadHr,
        date: g.date,
        season,
        baselineProb: baseline.prob,
        batterId,
      });

      priorGames += 1;
      priorGamesWithHr += hadHr;
      priorTotalPa += pa;
    }
  }

  return rows;
}

/** Multi-season convenience wrapper — sequential (not Promise.all) so a rate-limited/slow season doesn't pile up concurrent multi-hundred-batter pulls against MLB's API at once. */
export async function buildHomeRunTrainingSet(seasons: number[]): Promise<HomeRunTrainingRow[]> {
  const all: HomeRunTrainingRow[] = [];
  for (const season of seasons) {
    all.push(...(await buildHomeRunSeasonRows(season)));
  }
  return all;
}

// ---------------------------------------------------------------------------
// Phase 4/5 — walk-forward fit + activation gate
// ---------------------------------------------------------------------------

export interface HomeRunFitSummary {
  trainSeasons: number[];
  holdoutSeasons: number[];
  trainRows: number;
  holdoutRows: number;
  trainBrier: number;
  holdoutBrier: number;
  baselineHoldoutBrier: number;
  activated: boolean;
  featureNames: readonly string[];
  weights: number[];
  intercept: number;
  savedRow: ModelWeightsRow;
}

/**
 * Same shape as modelFit.ts's fitMoneylineWeights: fit on trainSeasons,
 * score on holdoutSeasons the fit never touched, activate only if the fit's
 * holdout Brier beats the existing Beta-Binomial baseline's own holdout
 * Brier (baselineProb — betaBinomialHrProb alone, no park/matchup/PA).
 */
export async function fitHomeRunWeights(trainSeasons: number[], holdoutSeasons: number[]): Promise<HomeRunFitSummary> {
  const allSeasons = [...new Set([...trainSeasons, ...holdoutSeasons])].sort((a, b) => a - b);
  const bySeasonRows = await Promise.all(allSeasons.map((s) => buildHomeRunSeasonRows(s)));
  const rows = bySeasonRows.flat();

  const holdoutSet = new Set(holdoutSeasons);
  const trainRows = rows.filter((r) => !holdoutSet.has(r.season));
  const holdoutRows = rows.filter((r) => holdoutSet.has(r.season));

  if (trainRows.length === 0 || holdoutRows.length === 0) {
    throw new Error(
      `No home-run training data for the requested seasons (train=${trainRows.length} rows, holdout=${holdoutRows.length} rows).`,
    );
  }

  const X = trainRows.map((r) => r.features);
  const y = trainRows.map((r) => r.actual);
  const fit = fitLogisticRegression(X, y);

  const trainPreds = trainRows.map((r) => ({ prob: predictProb(r.features, fit.weights, fit.intercept), actual: r.actual }));
  const holdoutPreds = holdoutRows.map((r) => ({ prob: predictProb(r.features, fit.weights, fit.intercept), actual: r.actual }));
  const holdoutBaseline = holdoutRows.map((r) => ({ prob: r.baselineProb, actual: r.actual }));

  const trainBrier = brierScore(trainPreds);
  const holdoutBrier = brierScore(holdoutPreds);
  const baselineHoldoutBrier = brierScore(holdoutBaseline);

  // The guardrail: only activates if it beats the current live Beta-Binomial
  // baseline on seasons it never trained on — same gate as Moneyline/Totals.
  const activated = holdoutBrier < baselineHoldoutBrier;

  const savedRow = writeModelWeights(
    {
      sport: 'mlb',
      market: 'home-run',
      featureNames: [...HOME_RUN_FEATURE_NAMES],
      weights: fit.weights,
      intercept: fit.intercept,
      trainGames: trainRows.length,
      trainBrier,
      holdoutGames: holdoutRows.length,
      holdoutBrier,
      baselineHoldoutBrier,
      covariance: fit.covariance,
      trainSeasons,
      holdoutSeasons,
    },
    activated,
  );

  return {
    trainSeasons,
    holdoutSeasons,
    trainRows: trainRows.length,
    holdoutRows: holdoutRows.length,
    trainBrier,
    holdoutBrier,
    baselineHoldoutBrier,
    activated,
    featureNames: HOME_RUN_FEATURE_NAMES,
    weights: fit.weights,
    intercept: fit.intercept,
    savedRow,
  };
}

/** Current season, Eastern-date convention — same helper the moneyline backfill route uses. */
export function currentSeason(): number {
  return Number(easternDate().slice(0, 4));
}
