/**
 * Unified game lines — merges the-odds-api.com with OddsHarvester.
 *
 * GET /api/odds/lines?sport=mlb
 * GET /api/odds/lines?sport=mlb&force=1   (bypass cache)
 *
 * The-odds-api provides best-line summaries with an SLA. OddsHarvester adds
 * per-bookmaker detail and live in-play data from OddsPortal.com. When
 * OddsHarvester output is missing or stale the endpoint degrades gracefully —
 * it never fails because the sidecar isn't running.
 */

import { NextResponse } from 'next/server';
import { getMlbGameLines } from '@/lib/odds/oddsApi';
import { readHarvesterOutput } from '@/lib/odds/oddsHarvester';
import { mergeLines } from '@/lib/odds/merge';
import { getNflGameLines } from '@/lib/odds/nflGameLines';
import { logGameOddsHistory } from '@/lib/odds/gameOddsLog';
import { readSnapshotCache } from '@/lib/db/client';
import { teamKey } from '@/lib/odds/matching';
import { computeTotalModel } from '@/lib/sports/mlb/gameModel';
import { logGameTotalPredictions, type GameTotalPrediction } from '@/lib/odds/props/pickHistoryLog';
import { runTotalLockCycle, runMoneylineLockCycle, type MoneylineDiagnostics } from '@/lib/core/gamePickLock';
import { getGamePick, attachMoneylinePrice, attachTotalPrice, getActiveModelWeights, getEarliestObservedTotalPoint, logSystemEvent } from '@/lib/db/client';
import { devigTwoWay } from '@/lib/odds/devig';
import { americanToDecimal } from '@/lib/odds/display';
import { predictHomeWinProb, MIN_GAMES_FOR_ELO_TRUST } from '@/lib/sports/mlb/eloModel';
import { getTeamBullpenEra, easternDate } from '@/lib/sports/mlb/statsapi';
import { applyFittedMoneylineWeights, computeMoneylineConfidenceInterval, applyFittedTotalWeights, computeTotalConfidenceInterval, poissonOverProbability } from '@/lib/sports/mlb/gameModel';
import { loadGameSim } from '@/lib/sports/mlb/gameSimCache';
import type { UnifiedGameLine } from '@/lib/odds/types';

/** Shared by both lock passes below — Elo only gets a say once both teams have enough rated games this season to mean something (see eloModel.ts). */
function eloProbForGame(elo: {
  home: { elo: number; gamesPlayed: number };
  away: { elo: number; gamesPlayed: number };
  homeRestDays: number;
  awayRestDays: number;
  homeTravelMiles: number;
  awayTravelMiles: number;
  homePitcherAdj: number;
  awayPitcherAdj: number;
} | null): number | null {
  if (!elo || elo.home.gamesPlayed < MIN_GAMES_FOR_ELO_TRUST || elo.away.gamesPlayed < MIN_GAMES_FOR_ELO_TRUST) return null;
  return predictHomeWinProb(elo.home.elo, elo.away.elo, {
    homeRestDays: elo.homeRestDays,
    awayRestDays: elo.awayRestDays,
    homeTravelMiles: elo.homeTravelMiles,
    awayTravelMiles: elo.awayTravelMiles,
    homePitcherAdj: elo.homePitcherAdj,
    awayPitcherAdj: elo.awayPitcherAdj,
  });
}

export const dynamic = 'force-dynamic';

/**
 * The one shape all four snapshot-reading functions below need, unioned
 * together — each only reads the subset of fields relevant to it. Read and
 * parsed once per request (see `readGamesFromSnapshot`) instead of each
 * function independently re-reading and re-parsing the same
 * `snapshot_cache['mlb:snapshot']` payload.
 */
interface SnapshotGame {
  gamePk: number | string;
  homeTeamId: number;
  awayTeamId: number;
  awayTeamName?: string;
  homeTeamName?: string;
  matchup: string;
  firstPitch?: string | null;
  status: 'pre' | 'live' | 'done';
  gameModel?: {
    homeExpectedRuns: number;
    awayExpectedRuns: number;
    homeWinProb: number;
    awayWinProb: number;
    diagnostics: MoneylineDiagnostics;
  } | null;
  elo?: {
    home: { elo: number; gamesPlayed: number };
    away: { elo: number; gamesPlayed: number };
    homeRestDays: number;
    awayRestDays: number;
    homeTravelMiles: number;
    awayTravelMiles: number;
    homePitcherAdj: number;
    awayPitcherAdj: number;
  } | null;
}

/** Reads and parses `snapshot_cache['mlb:snapshot']` once; `[]` on a missing cache or a parse failure — every caller below already treats an empty `games` array as its own no-op, matching each function's original independent early-return. */
function readGamesFromSnapshot(): SnapshotGame[] {
  const cached = readSnapshotCache('mlb:snapshot');
  if (!cached) return [];
  try {
    const snapshot = JSON.parse(cached.payload);
    return (snapshot?.context?.other?.games ?? []) as SnapshotGame[];
  } catch {
    return [];
  }
}

/**
 * P1-1 — joins each line's posted total against the matching game's model
 * (matched by team name, same convention buildSlate uses) to log a real,
 * gradeable total-market prediction. `games` comes from the snapshot's own
 * SQLite cache (read once by the caller) rather than this route paying for
 * a fresh MLB API pull just to find a gamePk.
 */
function logTotalPredictionsFromLines(lines: UnifiedGameLine[], games: SnapshotGame[]): void {
  if (lines.length === 0) return;

  const predictions: GameTotalPrediction[] = [];
  for (const line of lines) {
    if (line.total?.point == null) continue;
    const game = games.find(
      (g) => teamKey(g.awayTeamName ?? '') === teamKey(line.awayTeam) && teamKey(g.homeTeamName ?? '') === teamKey(line.homeTeam),
    );
    if (!game?.gameModel) continue;
    const model = computeTotalModel({
      homeExpectedRuns: game.gameModel.homeExpectedRuns,
      awayExpectedRuns: game.gameModel.awayExpectedRuns,
      line: line.total.point,
    });
    predictions.push({ gamePk: game.gamePk, totalLine: line.total.point, overProb: model.overProb });
  }
  if (predictions.length > 0) logGameTotalPredictions('mlb', predictions);
}

/**
 * Linesmith Pick lock system — total (O/U) half. Needs the same
 * line-to-game match as `logTotalPredictionsFromLines` above (this is the
 * only route that has both the model's runs projection and the sportsbook's
 * actual posted total line), so it re-reads the same cached snapshot rather
 * than threading the match through two functions.
 */
async function runTotalLockFromLines(lines: UnifiedGameLine[], games: SnapshotGame[]): Promise<void> {
  if (lines.length === 0) return;

  // Phase 0 — same "read once per request, fold in instead of double-
  // blending" pattern as the moneyline pass below.
  const fittedTotal = getActiveModelWeights('mlb', 'total');

  const inputs = [];
  for (const line of lines) {
    if (line.total?.point == null) continue;
    const game = games.find(
      (g) => teamKey(g.awayTeamName ?? '') === teamKey(line.awayTeam) && teamKey(g.homeTeamName ?? '') === teamKey(line.homeTeam),
    );
    if (!game?.gameModel) continue;
    const model = computeTotalModel({
      homeExpectedRuns: game.gameModel.homeExpectedRuns,
      awayExpectedRuns: game.gameModel.awayExpectedRuns,
      line: line.total.point,
    });
    let marketOverProb: number | null = null;
    if (line.total.overPrice != null && line.total.underPrice != null) {
      const devigged = devigTwoWay(americanToDecimal(line.total.overPrice), americanToDecimal(line.total.underPrice));
      marketOverProb = devigged?.a ?? null;
    }

    const eloRawProb = eloProbForGame(game.elo ?? null);

    let overProb = model.overProb;
    let marketOverProbForBlend: number | null = marketOverProb;
    let probLowerOver: number | null = null;
    let probUpperOver: number | null = null;

    if (fittedTotal) {
      const eloForFit = eloRawProb ?? 0.5;
      const marketForFit = marketOverProb ?? 0.5;
      // How far today's line has moved since this app first observed it —
      // 0 (no signal) if this is the first time we've seen this event's
      // total, matching training's neutral-impute convention for a missing
      // opening reference.
      const openingPoint = getEarliestObservedTotalPoint(line.eventId);
      const lineMovement = openingPoint != null ? line.total.point - openingPoint : 0;

      const season = Number(easternDate().slice(0, 4));
      const [homeBullpenEra, awayBullpenEra] = await Promise.all([
        getTeamBullpenEra(game.homeTeamId, season),
        getTeamBullpenEra(game.awayTeamId, season),
      ]);

      // simOverProb — real per-game simulation once gameSimCache.ts has one
      // cached for this matchup (see its own header for the refresh
      // cadence); falls back to model.overProb, the honest neutral point,
      // for a game with no cached sim yet (no resolvable lineup/starter,
      // or the very first snapshot rebuild of the day hasn't reached it).
      const simCache = loadGameSim(game.gamePk);
      const simOverProbForFit = simCache ? poissonOverProbability(simCache.expectedTotal, line.total.point) : model.overProb;
      overProb = applyFittedTotalWeights(model.overProb, game.gameModel.diagnostics, eloForFit, marketForFit, lineMovement, homeBullpenEra, awayBullpenEra, simOverProbForFit, fittedTotal);
      marketOverProbForBlend = null; // already folded into overProb above — don't blend it in again

      const interval = computeTotalConfidenceInterval(model.overProb, game.gameModel.diagnostics, eloForFit, marketForFit, lineMovement, homeBullpenEra, awayBullpenEra, simOverProbForFit, fittedTotal);
      if (interval) {
        probLowerOver = interval.lowerOver;
        probUpperOver = interval.upperOver;
      }
    }

    inputs.push({
      gameId: String(game.gamePk),
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homeTeamName: game.homeTeamName ?? line.homeTeam,
      awayTeamName: game.awayTeamName ?? line.awayTeam,
      matchup: game.matchup,
      commenceTime: game.firstPitch ?? null,
      isPreGame: game.status === 'pre',
      line: line.total.point,
      overProb,
      marketOverProb: marketOverProbForBlend,
      probLowerOver,
      probUpperOver,
    });
  }
  if (inputs.length > 0) runTotalLockCycle('mlb', inputs);
}

/**
 * Linesmith Pick lock system — moneyline half. Unlike the total lock (which
 * only ever considers games with a posted total line), this runs for EVERY
 * game in the snapshot regardless of whether a market price exists yet —
 * every game still gets a pick (idea #10), just without a market blend when
 * there's nothing to blend against. Market probability is attached
 * opportunistically when a matching two-sided price is found.
 */
function runMoneylineLockFromSnapshot(lines: UnifiedGameLine[], games: SnapshotGame[]): void {
  // Phase 3's fitted weights, if a fit has ever cleared its holdout guardrail
  // — read once per request, not per game. When active, Elo is already one
  // of the fit's own features (see modelFit.ts), so it's folded in here
  // instead of also being blended a second time as a separate stage below —
  // double-counting the same signal would just be a worse-calibrated guess.
  const fitted = getActiveModelWeights('mlb', 'moneyline');

  const inputs = [];
  for (const g of games) {
    if (!g.gameModel) continue;
    const line = lines.find(
      (l) => teamKey(l.awayTeam) === teamKey(g.awayTeamName ?? '') && teamKey(l.homeTeam) === teamKey(g.homeTeamName ?? ''),
    );
    let marketHomeProb: number | null = null;
    if (line?.moneyline?.home != null && line.moneyline.away != null) {
      const devigged = devigTwoWay(americanToDecimal(line.moneyline.away), americanToDecimal(line.moneyline.home));
      marketHomeProb = devigged?.b ?? null; // devigTwoWay(a=away, b=home) — see lib/odds/gameEdge.ts's own usage
    }

    // Elo only gets a say once both teams have enough rated games this
    // season to mean something — early on it's mostly still the flat 1500
    // starting value, which would just be noise blended into a real pick.
    // predictHomeWinProb folds rest, travel, and the starting-pitcher
    // adjustment in on top of the raw ratings — none of which touch the
    // STORED rating (see eloModel.ts), only this one prediction.
    const eloTrusted = !!g.elo && g.elo.home.gamesPlayed >= MIN_GAMES_FOR_ELO_TRUST && g.elo.away.gamesPlayed >= MIN_GAMES_FOR_ELO_TRUST;
    const eloRawProb = eloTrusted
      ? predictHomeWinProb(g.elo!.home.elo, g.elo!.away.elo, {
          homeRestDays: g.elo!.homeRestDays,
          awayRestDays: g.elo!.awayRestDays,
          homeTravelMiles: g.elo!.homeTravelMiles,
          awayTravelMiles: g.elo!.awayTravelMiles,
          homePitcherAdj: g.elo!.homePitcherAdj,
          awayPitcherAdj: g.elo!.awayPitcherAdj,
        })
      : null;

    let homeWinProb = g.gameModel.homeWinProb;
    let eloHomeProb: number | null = eloRawProb; // used as a separate blend stage only when NOT already folded into a fit
    let marketHomeProbForBlend: number | null = marketHomeProb; // same — folded into the fit instead of blended again when a fit is active
    let probLowerHome: number | null = null;
    let probUpperHome: number | null = null;

    if (fitted) {
      // modelFit.ts imputes 0.5 (neutral) for Elo and market prob when
      // untrusted/unavailable during training — matching that exactly here,
      // rather than skipping the term, since the fitted coefficients were
      // validated against that specific imputation.
      const eloForFit = eloRawProb ?? 0.5;
      const marketForFit = marketHomeProb ?? 0.5;
      // simWinProb — real per-game simulation once gameSimCache.ts has one
      // cached for this matchup; falls back to the neutral 0.5 (same
      // convention as eloProb/marketProb above) for a game with no cached
      // sim yet.
      const simCache = loadGameSim(g.gamePk);
      const simWinProbForFit = simCache?.homeWinProb ?? 0.5;
      homeWinProb = applyFittedMoneylineWeights(g.gameModel.diagnostics, eloForFit, marketForFit, simWinProbForFit, fitted);
      eloHomeProb = null; // already folded into homeWinProb above — don't blend it in again
      marketHomeProbForBlend = null; // same

      const interval = computeMoneylineConfidenceInterval(g.gameModel.diagnostics, eloForFit, marketForFit, simWinProbForFit, fitted);
      if (interval) {
        probLowerHome = interval.lowerHome;
        probUpperHome = interval.upperHome;
      }
    }

    inputs.push({
      gameId: String(g.gamePk),
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homeTeamName: g.homeTeamName ?? line?.homeTeam ?? '',
      awayTeamName: g.awayTeamName ?? line?.awayTeam ?? '',
      matchup: g.matchup,
      commenceTime: g.firstPitch ?? null,
      isPreGame: g.status === 'pre',
      homeWinProb,
      awayWinProb: 1 - homeWinProb,
      diagnostics: g.gameModel.diagnostics,
      marketHomeProb: marketHomeProbForBlend,
      eloHomeProb,
      probLowerHome,
      probUpperHome,
    });
  }
  if (inputs.length > 0) runMoneylineLockCycle('mlb', inputs);
}

/**
 * Best-effort odds attachment for whichever game_picks slots are already
 * locked — matched the same way as the lock cycle itself. Never influences
 * which side gets picked (that's decided from the model alone); this only
 * fills in the reference price shown next to an already-decided pick.
 */
function attachPricesFromLines(lines: UnifiedGameLine[], games: SnapshotGame[]): void {
  if (lines.length === 0) return;

  for (const line of lines) {
    const game = games.find(
      (g) => teamKey(g.awayTeamName ?? '') === teamKey(line.awayTeam) && teamKey(g.homeTeamName ?? '') === teamKey(line.homeTeam),
    );
    if (!game) continue;
    const gameId = String(game.gamePk);
    const pick = getGamePick('mlb', gameId);
    if (!pick) continue;

    if (line.moneyline?.home != null && pick.mlInitialSide === 'home') attachMoneylinePrice('mlb', gameId, 'initial', 'home', line.moneyline.home);
    if (line.moneyline?.away != null && pick.mlInitialSide === 'away') attachMoneylinePrice('mlb', gameId, 'initial', 'away', line.moneyline.away);
    if (line.moneyline?.home != null && pick.mlFinalSide === 'home') attachMoneylinePrice('mlb', gameId, 'final', 'home', line.moneyline.home);
    if (line.moneyline?.away != null && pick.mlFinalSide === 'away') attachMoneylinePrice('mlb', gameId, 'final', 'away', line.moneyline.away);

    if (line.total?.overPrice != null && pick.totalInitialSide === 'over') attachTotalPrice('mlb', gameId, 'initial', 'over', line.total.overPrice);
    if (line.total?.underPrice != null && pick.totalInitialSide === 'under') attachTotalPrice('mlb', gameId, 'initial', 'under', line.total.underPrice);
    if (line.total?.overPrice != null && pick.totalFinalSide === 'over') attachTotalPrice('mlb', gameId, 'final', 'over', line.total.overPrice);
    if (line.total?.underPrice != null && pick.totalFinalSide === 'under') attachTotalPrice('mlb', gameId, 'final', 'under', line.total.underPrice);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? 'mlb';
  const force = url.searchParams.get('force') !== null;

  // NFL has none of MLB's model/pick-lock machinery below (Elo, gameModel,
  // devig blending) — it returns as soon as its own merged lines are ready,
  // additive only, never touching the MLB path underneath.
  if (sport === 'nfl') {
    try {
      const result = await getNflGameLines();
      return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
    } catch (error) {
      console.error('[api/odds/lines] nfl', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'NFL odds lookup failed.' },
        { status: 502 },
      );
    }
  }

  try {
    // Fire both in parallel — the-odds-api is a network call, OddsHarvester
    // is a local file read. Neither blocks the other.
    const [oddsApiResult, harvesterResult] = await Promise.all([
      getMlbGameLines(force),
      // OddsHarvester uses "baseball" as the sport key, not "mlb".
      Promise.resolve(readHarvesterOutput('baseball', 'live')),
    ]);

    const lines = mergeLines(oddsApiResult.lines, harvesterResult.matches);

    const warnings = [...oddsApiResult.warnings];
    if (harvesterResult.error) {
      warnings.push(`OddsHarvester: ${harvesterResult.error}`);
    }

    const enabled = oddsApiResult.enabled || harvesterResult.matches.length > 0;

    try {
      logGameOddsHistory(lines);
    } catch (error) {
      console.error('[api/odds/lines] logGameOddsHistory failed', error);
    }

    // Read once, shared by all four passes below — each independently
    // re-reading and re-parsing the same snapshot_cache['mlb:snapshot']
    // payload cost real time on every request (this is a multi-MB blob).
    const games = readGamesFromSnapshot();

    try {
      logTotalPredictionsFromLines(lines, games);
    } catch (error) {
      console.error('[api/odds/lines] logTotalPredictionsFromLines failed', error);
    }

    try {
      await runTotalLockFromLines(lines, games);
    } catch (error) {
      console.error('[api/odds/lines] runTotalLockFromLines failed', error);
    }

    try {
      runMoneylineLockFromSnapshot(lines, games);
    } catch (error) {
      console.error('[api/odds/lines] runMoneylineLockFromSnapshot failed', error);
    }

    try {
      attachPricesFromLines(lines, games);
    } catch (error) {
      console.error('[api/odds/lines] attachPricesFromLines failed', error);
    }

    return NextResponse.json(
      {
        enabled,
        lines,
        fetchedAt: oddsApiResult.fetchedAt ?? harvesterResult.fetchedAt,
        fromCache: oddsApiResult.fromCache,
        sources: {
          oddsApi: {
            enabled: oddsApiResult.enabled,
            fetchedAt: oddsApiResult.fetchedAt,
            requestsRemaining: oddsApiResult.requestsRemaining,
          },
          oddsHarvester: {
            enabled: harvesterResult.matches.length > 0,
            fetchedAt: harvesterResult.fetchedAt,
            matches: harvesterResult.matches.length,
          },
        },
        nextRefreshAt: oddsApiResult.nextRefreshAt,
        warnings,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[api/odds/lines]', error);
    logSystemEvent({ level: 'error', source: 'api/odds/lines', message: error instanceof Error ? error.message : 'Odds lookup failed.' });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Odds lookup failed.' },
      { status: 502 },
    );
  }
}
