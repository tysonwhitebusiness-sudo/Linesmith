/**
 * Phase 3's fitting pass (extended in Phase B/C to span 2010-2025 real
 * history instead of just the current season) — walks seasons
 * chronologically (same no-lookahead discipline as gameModelBackfill.ts /
 * eloModel.ts's backfill), builds a training feature vector per game from
 * signals honestly available across the full historical window, fits a
 * small stacking logistic regression on top of them, and only activates the
 * result if it actually beats the current hand-coded formula on a holdout
 * slice (whole seasons, never trained on) it never trained on.
 *
 * Elo here is a SEPARATE, self-contained walk from eloModel.ts's own
 * DB-persisted backfill — same math (season-reversion via regressToMean,
 * updateElo per game), but recomputed locally across the full season list
 * in one pass so it stays correct regardless of what's currently in
 * team_elo_history. Seasons must be walked in ascending order in a single
 * call for this to carry forward correctly — see buildTrainingSet.
 *
 * Market probability (added in Phase B) comes from historical_odds,
 * populated by lib/sports/mlb/historicalOddsIngest.ts from real de-vigged
 * sportsbook closing lines (2010-2020 SBR spreadsheets, 2021-2025 multi-book
 * CSV). Coverage isn't 100% (a handful of games per season have no matching
 * odds row — postponements, doubleheader scheduling quirks, or genuine gaps
 * in the source files) — missing rows get a neutral 0 (no signal) for this
 * feature rather than being dropped, and buildTrainingSet reports the real
 * found/missing counts so that gap stays visible rather than silently
 * assumed away.
 *
 * Still NOT a feature, a real disclosed scoping gap rather than an
 * oversight: starter ERA blending. Same reason gameModelBackfill.ts already
 * excludes it — no cheap historical per-game starter data at scale.
 * rawLog5 here is the team-only Pythagorean number, not the starter-blended
 * one the live model uses — a real, small train/live definitional gap, same
 * shape of signal either way. Park factor is also neutral (1.0) for any
 * season whose park_factors table hasn't been backfilled (only recent
 * seasons have been, as of this writing) — same graceful-default behavior
 * the live path already relies on.
 */

import { getScheduleRange, easternDate, getTeamBullpenEra } from './statsapi';
import { pythagoreanWinPct, log5, splitEdge, poissonOverProbability, type TeamRecordSplit } from './gameModel';
import { STARTING_ELO, MIN_GAMES_FOR_ELO_TRUST, SEASON_REGRESSION_FACTOR, regressToMean, updateElo, eloExpectedHomeWinProb } from './eloModel';
import { fitLogisticRegression, predictProb, brierScore } from '../../core/logisticRegression';
import { readParkFactors, writeModelWeights, getHistoricalOdds, type ModelWeightsRow } from '../../db/client';
import { computeLeagueOutcomeRates, computeTeamBattingVector, computeTeamPitchingVector } from './simRates';
import { simulateTeamMatchup } from './simGame';
import type { OutcomeVector } from './simEngine';

const WARMUP_GAMES = 15;
const HOME_FIELD_EDGE = 0.04; // gameModel.ts's own constant, used here only to compute the baseline's holdout Brier for comparison
const MIN_SPLIT_SAMPLE = 8;
const MIN_RECENT_SAMPLE = 6;
const MAX_SPLIT_EDGE = 0.08;
const MAX_RECENT_EDGE = 0.1;
const RECENT_FORM_WEIGHT = 0.4;

export const MONEYLINE_FEATURE_NAMES = ['rawLog5', 'venueDiff', 'formDiff', 'parkFactorCentered', 'eloProb', 'marketProbCentered', 'simWinProb'] as const;

/**
 * Total (O/U) market's own feature set — deliberately not a 1:1 copy of
 * moneyline's. `venueDiff` is dropped: a team's home/away split is a WIN-rate
 * signal, not a scoring-pace one, so it has no honest place here.
 * `rawPoissonOverProb` (the hand-coded formula's own output against the
 * game's real total line) plays rawLog5's role as the dominant raw signal.
 * `eloProb` is kept even though Elo is a win-probability rating, not a
 * scoring-environment one — same "feed what's honestly available, let the
 * regression decide the weight" philosophy as park factor's ~0 expected
 * weight on the moneyline side; if it's genuinely irrelevant to totals the
 * fit will learn that itself rather than a human guessing it away.
 */
export const TOTAL_FEATURE_NAMES = ['rawPoissonOverProb', 'formDiff', 'parkFactorCentered', 'eloProb', 'marketProbCentered', 'lineMovement', 'bullpenEraCentered', 'simOverProb'] as const;

/** Sim-engine training pass — cheap N (not the live daily 10,000): the regression only needs the feature to be informative, not noise-free, and thousands of historical games at 10,000 sims each would make a full backfill impractically slow. See docs/mlb-sim-engine-plan.md's Sim Count Strategy. */
const SIM_TRAINING_N = 300;

/** Round reference point for bullpen ERA, same role as gameModel.ts's NEUTRAL_TEMP_F — not a precisely computed per-season league average (that would mean an extra league-wide aggregation pass), just a reasonable modern-era center to keep the feature roughly zero-centered. */
const NEUTRAL_BULLPEN_ERA = 4.3;

interface TeamState {
  runsFor: number;
  runsAgainst: number;
  games: number;
  season: TeamRecordSplit;
  home: TeamRecordSplit;
  away: TeamRecordSplit;
  recentResults: number[]; // 1=win, 0=loss, chronological
}

function newTeamState(): TeamState {
  return {
    runsFor: 0,
    runsAgainst: 0,
    games: 0,
    season: { wins: 0, losses: 0 },
    home: { wins: 0, losses: 0 },
    away: { wins: 0, losses: 0 },
    recentResults: [],
  };
}

function last10(results: number[]): TeamRecordSplit {
  const last = results.slice(-10);
  const wins = last.reduce((s, r) => s + r, 0);
  return { wins, losses: last.length - wins };
}

interface TrainingRow {
  features: number[];
  actual: number;
  date: string;
  season: number;
  baselineProb: number;
}

interface MarketCoverage {
  found: number;
  missing: number;
}

/**
 * Total rows are strictly fewer than moneyline rows: the training LABEL
 * itself (over/under) needs a real historical total line, not just a
 * feature, so a game with no historical_odds total_line row (or an exact
 * push) can't produce a total row at all — unlike moneyline, where a missing
 * market price just gets neutrally imputed. `lineCoverage` tracks how many
 * warmed-up games actually had a usable line vs. didn't, separate from
 * `marketCoverage` (which tracks the market-PROBABILITY feature specifically,
 * conditional on a line already existing).
 */
interface TotalTrainingRow {
  features: number[];
  actual: number;
  date: string;
  season: number;
  baselineProb: number;
}

interface LineCoverage {
  found: number;
  missingOrPush: number;
}

interface TrainingSetResult {
  moneylineRows: TrainingRow[];
  marketCoverage: MarketCoverage;
  totalRows: TotalTrainingRow[];
  totalMarketCoverage: MarketCoverage;
  totalLineCoverage: LineCoverage;
  /** How many total rows had a real opening line to compute lineMovement from, vs. got the neutral 0 impute. */
  lineMovementCoverage: MarketCoverage;
  /** How many total rows had a real bullpen ERA for BOTH teams vs. at least one missing (neutral-imputed individually). */
  bullpenCoverage: MarketCoverage;
}

/**
 * Walks every season in `seasons` in order, in one continuous pass, so Elo
 * carries forward across season boundaries (with regression-to-mean applied
 * at each team's own first game of a new season — see eloModel.ts's
 * backfillElo, mirrored here independently). Team win/loss/form state and
 * park factors reset each season (standings genuinely do reset); Elo does
 * not. Caller must pass seasons already sorted ascending.
 */
async function buildTrainingSet(seasons: number[]): Promise<TrainingSetResult> {
  const rows: TrainingRow[] = [];
  const totalRows: TotalTrainingRow[] = [];
  const eloRating = new Map<number, number>();
  const eloGames = new Map<number, number>();
  const eloLastSeason = new Map<number, number>();
  const marketCoverage: MarketCoverage = { found: 0, missing: 0 };
  const totalMarketCoverage: MarketCoverage = { found: 0, missing: 0 };
  const totalLineCoverage: LineCoverage = { found: 0, missingOrPush: 0 };
  const lineMovementCoverage: MarketCoverage = { found: 0, missing: 0 };
  const bullpenCoverage: MarketCoverage = { found: 0, missing: 0 };
  // One fetch per (team, season) no matter how many of that team's games get
  // walked — 480 calls for the full 2010-2025 span instead of tens of
  // thousands.
  const bullpenEraCache = new Map<string, number | null>();
  async function bullpenEraFor(teamId: number, season: number): Promise<number | null> {
    const key = `${teamId}:${season}`;
    if (bullpenEraCache.has(key)) return bullpenEraCache.get(key)!;
    const era = await getTeamBullpenEra(teamId, season);
    bullpenEraCache.set(key, era);
    return era;
  }

  // Sim engine plan, Phase 7 — same one-fetch-per-(team,season) shape as
  // bullpenEraFor above, for the team-level batting/pitching vectors
  // simulateTeamMatchup needs (see simRates.ts's computeTeamBattingVector/
  // computeTeamPitchingVector for the disclosed team-only, season-aggregate
  // simplification this shares with bullpenEraFor's own scope).
  const leagueRatesCache = new Map<number, OutcomeVector>();
  async function leagueRatesFor(season: number): Promise<OutcomeVector> {
    const cached = leagueRatesCache.get(season);
    if (cached) return cached;
    const { vector } = await computeLeagueOutcomeRates(season);
    leagueRatesCache.set(season, vector);
    return vector;
  }
  const teamVectorCache = new Map<string, { batting: OutcomeVector; pitching: OutcomeVector }>();
  async function teamVectorsFor(teamId: number, season: number): Promise<{ batting: OutcomeVector; pitching: OutcomeVector }> {
    const key = `${teamId}:${season}`;
    const cached = teamVectorCache.get(key);
    if (cached) return cached;
    const leagueRates = await leagueRatesFor(season);
    const [batting, pitching] = await Promise.all([
      computeTeamBattingVector(teamId, season, leagueRates),
      computeTeamPitchingVector(teamId, season, leagueRates),
    ]);
    const result = { batting, pitching };
    teamVectorCache.set(key, result);
    return result;
  }

  const currentSeason = Number(easternDate().slice(0, 4));

  for (const season of seasons) {
    const rangeEnd = season >= currentSeason ? easternDate() : `${season}-11-30`;
    const games = await getScheduleRange(`${season}-03-01`, rangeEnd);
    const finals = games
      .filter((g) => g.abstractState === 'Final' && g.teams.home.score != null && g.teams.away.score != null)
      .sort((a, b) => (a.gameDate < b.gameDate ? -1 : 1));

    const parkFactorByVenue = new Map(readParkFactors(season).map((r) => [r.venueId, r.factor]));
    const teamState = new Map<number, TeamState>(); // reset per season — standings reset

    for (const g of finals) {
      const homeId = g.teams.home.team.id;
      const awayId = g.teams.away.team.id;
      const homeRuns = g.teams.home.score as number;
      const awayRuns = g.teams.away.score as number;
      const home = teamState.get(homeId);
      const away = teamState.get(awayId);

      for (const teamId of [homeId, awayId]) {
        const lastSeason = eloLastSeason.get(teamId);
        if (lastSeason !== undefined && lastSeason !== season) {
          eloRating.set(teamId, regressToMean(eloRating.get(teamId) ?? STARTING_ELO, SEASON_REGRESSION_FACTOR));
        }
        eloLastSeason.set(teamId, season);
      }

      const homeElo = eloRating.get(homeId) ?? STARTING_ELO;
      const awayElo = eloRating.get(awayId) ?? STARTING_ELO;
      const homeEloGames = eloGames.get(homeId) ?? 0;
      const awayEloGames = eloGames.get(awayId) ?? 0;
      const homeWon = homeRuns > awayRuns ? 1 : 0;

      if (home && away && home.games >= WARMUP_GAMES && away.games >= WARMUP_GAMES) {
        const hRS = home.runsFor / home.games;
        const hRA = home.runsAgainst / home.games;
        const aRS = away.runsFor / away.games;
        const aRA = away.runsAgainst / away.games;
        const rawLog5 = log5(pythagoreanWinPct(hRS, hRA), pythagoreanWinPct(aRS, aRA));

        const homeVenueEdge = splitEdge(home.season, home.home, MIN_SPLIT_SAMPLE, MAX_SPLIT_EDGE);
        const awayVenueEdge = splitEdge(away.season, away.away, MIN_SPLIT_SAMPLE, MAX_SPLIT_EDGE);
        const homeFormEdge = splitEdge(home.season, last10(home.recentResults), MIN_RECENT_SAMPLE, MAX_RECENT_EDGE);
        const awayFormEdge = splitEdge(away.season, last10(away.recentResults), MIN_RECENT_SAMPLE, MAX_RECENT_EDGE);

        const venueDiff = homeVenueEdge - awayVenueEdge;
        const formDiff = homeFormEdge - awayFormEdge; // raw, unweighted — the regression decides the weight instead of the hard-coded ×0.4

        const pf = g.venue?.id != null ? (parkFactorByVenue.get(g.venue.id) ?? 1) : 1;

        // Sim engine plan, Phase 7 — one team-matchup simulation per game
        // yields both simWinProb (moneyline) and expectedTotal (total)
        // together, so it only needs to run once here rather than once per
        // market. SIM_TRAINING_N (300), not the live 10,000 — see its own
        // comment above.
        const [homeVectors, awayVectors] = await Promise.all([teamVectorsFor(homeId, season), teamVectorsFor(awayId, season)]);
        const leagueRatesForSeason = await leagueRatesFor(season);
        const simResult = simulateTeamMatchup(
          homeVectors.batting,
          homeVectors.pitching,
          awayVectors.batting,
          awayVectors.pitching,
          leagueRatesForSeason,
          pf,
          SIM_TRAINING_N,
        );

        const eloProb =
          homeEloGames >= MIN_GAMES_FOR_ELO_TRUST && awayEloGames >= MIN_GAMES_FOR_ELO_TRUST
            ? eloExpectedHomeWinProb(homeElo, awayElo)
            : 0.5;

        const gameDateEastern = easternDate(new Date(g.gameDate));
        const odds = getHistoricalOdds(season, gameDateEastern, homeId, awayId);
        let marketProbCentered = 0;
        if (odds?.mlHomeConsensusProb != null) {
          marketProbCentered = odds.mlHomeConsensusProb - 0.5;
          marketCoverage.found += 1;
        } else {
          marketCoverage.missing += 1;
        }

        // The current hand-coded formula, same inputs, for a fair holdout comparison.
        const baselineAdj = HOME_FIELD_EDGE + venueDiff + homeFormEdge * RECENT_FORM_WEIGHT - awayFormEdge * RECENT_FORM_WEIGHT;
        const baselineProb = Math.min(0.97, Math.max(0.03, rawLog5 + baselineAdj));

        rows.push({
          features: [rawLog5, venueDiff, formDiff, pf - 1, eloProb, marketProbCentered, simResult.homeWinProb],
          actual: homeWon,
          date: gameDateEastern,
          season,
          baselineProb,
        });

        // Total (O/U) row — unlike moneyline, the training LABEL itself needs
        // a real historical total line (not just a feature), so games with
        // no ingested line, or an exact push (total === line, no
        // over/under decision), simply can't produce a gradeable row here.
        const actualTotal = homeRuns + awayRuns;
        if (odds?.totalLine != null && actualTotal !== odds.totalLine) {
          totalLineCoverage.found += 1;
          const expectedTotalRaw = (hRS + aRS) * pf;
          const rawPoissonOverProb = poissonOverProbability(expectedTotalRaw, odds.totalLine);
          let totalMarketProbCentered = 0;
          if (odds.totalOverConsensusProb != null) {
            totalMarketProbCentered = odds.totalOverConsensusProb - 0.5;
            totalMarketCoverage.found += 1;
          } else {
            totalMarketCoverage.missing += 1;
          }
          // How far the total moved from open to close — 0 (no signal) when
          // the source file had no opening line for this game, same neutral-
          // impute convention as every other optional feature here.
          let lineMovement = 0;
          if (odds.totalOpenLine != null) {
            lineMovement = odds.totalLine - odds.totalOpenLine;
            lineMovementCoverage.found += 1;
          } else {
            lineMovementCoverage.missing += 1;
          }

          // Combined bullpen quality — worse (higher) combined ERA than the
          // neutral reference nudges the feature positive, expecting more
          // runs. Each side imputes to the neutral reference independently
          // so one missing team doesn't zero out the whole signal.
          const [homeBullpenEra, awayBullpenEra] = await Promise.all([bullpenEraFor(homeId, season), bullpenEraFor(awayId, season)]);
          const bullpenEraCentered = (homeBullpenEra ?? NEUTRAL_BULLPEN_ERA) / 2 + (awayBullpenEra ?? NEUTRAL_BULLPEN_ERA) / 2 - NEUTRAL_BULLPEN_ERA;
          if (homeBullpenEra != null && awayBullpenEra != null) {
            bullpenCoverage.found += 1;
          } else {
            bullpenCoverage.missing += 1;
          }

          // Same team-matchup simulation run above (once per game, not once
          // per market) already produced expectedTotal — reuse it against
          // THIS game's real total line for the over-probability feature.
          const simOverProb = poissonOverProbability(simResult.expectedTotal, odds.totalLine);

          totalRows.push({
            features: [rawPoissonOverProb, formDiff, pf - 1, eloProb, totalMarketProbCentered, lineMovement, bullpenEraCentered, simOverProb],
            actual: actualTotal > odds.totalLine ? 1 : 0,
            date: gameDateEastern,
            season,
            baselineProb: rawPoissonOverProb,
          });
        } else {
          totalLineCoverage.missingOrPush += 1;
        }
      }

      // Update every accumulator AFTER building this game's row — no lookahead.
      const homeState = home ?? newTeamState();
      homeState.runsFor += homeRuns;
      homeState.runsAgainst += awayRuns;
      homeState.games += 1;
      if (homeWon) { homeState.season.wins += 1; homeState.home.wins += 1; } else { homeState.season.losses += 1; homeState.home.losses += 1; }
      homeState.recentResults.push(homeWon);
      teamState.set(homeId, homeState);

      const awayState = away ?? newTeamState();
      awayState.runsFor += awayRuns;
      awayState.runsAgainst += homeRuns;
      awayState.games += 1;
      if (!homeWon) { awayState.season.wins += 1; awayState.away.wins += 1; } else { awayState.season.losses += 1; awayState.away.losses += 1; }
      awayState.recentResults.push(homeWon ? 0 : 1);
      teamState.set(awayId, awayState);

      const eloResult = updateElo(homeElo, awayElo, homeRuns, awayRuns);
      eloRating.set(homeId, eloResult.newHomeElo);
      eloRating.set(awayId, eloResult.newAwayElo);
      eloGames.set(homeId, homeEloGames + 1);
      eloGames.set(awayId, awayEloGames + 1);
    }
  }

  return { moneylineRows: rows, marketCoverage, totalRows, totalMarketCoverage, totalLineCoverage, lineMovementCoverage, bullpenCoverage };
}

export interface MoneylineFitSummary {
  trainSeasons: number[];
  holdoutSeasons: number[];
  trainGames: number;
  holdoutGames: number;
  trainBrier: number;
  holdoutBrier: number;
  baselineHoldoutBrier: number;
  marketCoverage: MarketCoverage;
  activated: boolean;
  featureNames: readonly string[];
  weights: number[];
  intercept: number;
  savedRow: ModelWeightsRow;
}

/**
 * `holdoutSeasons` are held out entirely — never touch the fit, only score
 * it — and the guardrail below (activate only if the fit beats the
 * hand-coded baseline on that same held-out slice) is what decides whether
 * the result actually goes live. `trainSeasons` and `holdoutSeasons` are
 * walked together in one continuous pass (ascending) so Elo stays
 * continuous across the whole span, then split by season afterward.
 */
export async function fitMoneylineWeights(trainSeasons: number[], holdoutSeasons: number[]): Promise<MoneylineFitSummary> {
  const allSeasons = [...new Set([...trainSeasons, ...holdoutSeasons])].sort((a, b) => a - b);
  const { moneylineRows: rows, marketCoverage } = await buildTrainingSet(allSeasons);

  const holdoutSet = new Set(holdoutSeasons);
  const trainRows = rows.filter((r) => !holdoutSet.has(r.season));
  const holdoutRows = rows.filter((r) => holdoutSet.has(r.season));

  const X = trainRows.map((r) => r.features);
  const y = trainRows.map((r) => r.actual);
  const fit = fitLogisticRegression(X, y);

  const trainPreds = trainRows.map((r) => ({ prob: predictProb(r.features, fit.weights, fit.intercept), actual: r.actual }));
  const holdoutPreds = holdoutRows.map((r) => ({ prob: predictProb(r.features, fit.weights, fit.intercept), actual: r.actual }));
  const holdoutBaseline = holdoutRows.map((r) => ({ prob: r.baselineProb, actual: r.actual }));

  const trainBrier = brierScore(trainPreds);
  const holdoutBrier = brierScore(holdoutPreds);
  const baselineHoldoutBrier = brierScore(holdoutBaseline);

  // The guardrail: a new fit only ever goes live if it actually beats the
  // currently-active formula on data it never trained on.
  const activated = holdoutBrier < baselineHoldoutBrier;

  const savedRow = writeModelWeights(
    {
      sport: 'mlb',
      market: 'moneyline',
      featureNames: [...MONEYLINE_FEATURE_NAMES],
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
    trainGames: trainRows.length,
    holdoutGames: holdoutRows.length,
    trainBrier,
    holdoutBrier,
    baselineHoldoutBrier,
    marketCoverage,
    activated,
    featureNames: MONEYLINE_FEATURE_NAMES,
    weights: fit.weights,
    intercept: fit.intercept,
    savedRow,
  };
}

export interface TotalHoldoutBaselines {
  holdoutGames: number;
  /** The current hand-coded Poisson formula alone, no market, no Elo. */
  formulaBrier: number;
  /** The de-vigged market's own implied over-probability, used AS the prediction with no model involved at all — only over rows that actually had a market price (the honest "is the market alone already this good" test). */
  marketOnlyBrier: number;
  marketOnlyGames: number;
  /** What the live app actually did before Phase 0: blendProbability(formula, market, 0.5) — formula alone when no market price was available. */
  preFittedBlendBrier: number;
  /** For reference — same number fitTotalWeights would report as holdoutBrier, recomputed here so all four numbers come from one consistent run. */
  fittedBrier: number;
}

/**
 * Read-only diagnostic — answers "how much of the fitted model's edge is
 * actually new, versus just inheriting the market's own accuracy." Fits the
 * regression the same way fitTotalWeights does but never writes to
 * model_weights (no `activate`, no version bump) — this is purely for
 * comparing formula-alone vs market-alone vs the old pre-fit blend vs the
 * fitted model on the identical holdout rows.
 */
export async function evaluateTotalHoldoutBaselines(trainSeasons: number[], holdoutSeasons: number[]): Promise<TotalHoldoutBaselines> {
  const allSeasons = [...new Set([...trainSeasons, ...holdoutSeasons])].sort((a, b) => a - b);
  const { totalRows } = await buildTrainingSet(allSeasons);

  const holdoutSet = new Set(holdoutSeasons);
  const trainRows = totalRows.filter((r) => !holdoutSet.has(r.season));
  const holdoutRows = totalRows.filter((r) => holdoutSet.has(r.season));

  const X = trainRows.map((r) => r.features);
  const y = trainRows.map((r) => r.actual);
  const fit = fitLogisticRegression(X, y);

  const formulaBrier = brierScore(holdoutRows.map((r) => ({ prob: r.baselineProb, actual: r.actual })));

  const withMarket = holdoutRows.filter((r) => r.features[4] !== 0); // marketProbCentered — 0 means "no market data", same imputation convention as training
  const marketOnlyBrier = brierScore(withMarket.map((r) => ({ prob: r.features[4] + 0.5, actual: r.actual })));

  const preFittedBlendBrier = brierScore(
    holdoutRows.map((r) => {
      const hasMarket = r.features[4] !== 0;
      const marketProb = r.features[4] + 0.5;
      const blended = hasMarket ? 0.5 * r.baselineProb + 0.5 * marketProb : r.baselineProb;
      return { prob: blended, actual: r.actual };
    }),
  );

  const fittedBrier = brierScore(holdoutRows.map((r) => ({ prob: predictProb(r.features, fit.weights, fit.intercept), actual: r.actual })));

  return {
    holdoutGames: holdoutRows.length,
    formulaBrier,
    marketOnlyBrier,
    marketOnlyGames: withMarket.length,
    preFittedBlendBrier,
    fittedBrier,
  };
}

export interface TotalFitSummary {
  trainSeasons: number[];
  holdoutSeasons: number[];
  trainGames: number;
  holdoutGames: number;
  trainBrier: number;
  holdoutBrier: number;
  baselineHoldoutBrier: number;
  marketCoverage: MarketCoverage;
  /** How many warmed-up games in the requested seasons actually had a usable historical total line to train/grade against, vs. didn't (no ingested line, or an exact push). */
  lineCoverage: LineCoverage;
  lineMovementCoverage: MarketCoverage;
  bullpenCoverage: MarketCoverage;
  activated: boolean;
  featureNames: readonly string[];
  weights: number[];
  intercept: number;
  savedRow: ModelWeightsRow;
}

/**
 * Total-market counterpart to fitMoneylineWeights — same walk-forward,
 * same holdout-only guardrail, but the baseline it has to beat is the raw
 * Poisson formula's own output (there's no separate hand-tuned constant like
 * moneyline's HOME_FIELD_EDGE layered on top of the totals formula, so the
 * formula's raw prediction against the real line IS the current live
 * behavior). Requires `historical_odds` to actually have total-line coverage
 * for the requested seasons (see historicalOddsIngest.ts) — throws a clear
 * error rather than fitting garbage from zero rows if it doesn't.
 */
export async function fitTotalWeights(trainSeasons: number[], holdoutSeasons: number[]): Promise<TotalFitSummary> {
  const allSeasons = [...new Set([...trainSeasons, ...holdoutSeasons])].sort((a, b) => a - b);
  const { totalRows, totalMarketCoverage, totalLineCoverage, lineMovementCoverage, bullpenCoverage } = await buildTrainingSet(allSeasons);

  const holdoutSet = new Set(holdoutSeasons);
  const trainRows = totalRows.filter((r) => !holdoutSet.has(r.season));
  const holdoutRows = totalRows.filter((r) => holdoutSet.has(r.season));

  if (trainRows.length === 0 || holdoutRows.length === 0) {
    throw new Error(
      `No historical total-line data for the requested seasons (train=${trainRows.length} rows, holdout=${holdoutRows.length} rows) — ` +
        `run historical odds ingestion first (see lib/sports/mlb/historicalOddsIngest.ts).`,
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

  // Same guardrail as moneyline: only activates if it beats the current live
  // formula on seasons it never trained on.
  const activated = holdoutBrier < baselineHoldoutBrier;

  const savedRow = writeModelWeights(
    {
      sport: 'mlb',
      market: 'total',
      featureNames: [...TOTAL_FEATURE_NAMES],
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
    trainGames: trainRows.length,
    holdoutGames: holdoutRows.length,
    trainBrier,
    holdoutBrier,
    baselineHoldoutBrier,
    marketCoverage: totalMarketCoverage,
    lineCoverage: totalLineCoverage,
    lineMovementCoverage,
    bullpenCoverage,
    activated,
    featureNames: TOTAL_FEATURE_NAMES,
    weights: fit.weights,
    intercept: fit.intercept,
    savedRow,
  };
}
