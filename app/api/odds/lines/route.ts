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
import type { MoneylineDiagnostics } from '@/lib/core/gamePickLock';
import { getGamePick, attachMoneylinePrice, attachTotalPrice, logSystemEvent } from '@/lib/db/client';
import type { UnifiedGameLine } from '@/lib/odds/types';

export const dynamic = 'force-dynamic';

/**
 * The one shape both snapshot-reading functions below need, unioned
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
}

/** Reads and parses `snapshot_cache['mlb:snapshot']` once; `[]` on a missing cache or a parse failure — every caller below already treats an empty `games` array as its own no-op, matching each function's original independent early-return. */
async function readGamesFromSnapshot(): Promise<SnapshotGame[]> {
  const cached = await readSnapshotCache('mlb:snapshot');
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
async function logTotalPredictionsFromLines(lines: UnifiedGameLine[], games: SnapshotGame[]): Promise<void> {
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
  if (predictions.length > 0) await logGameTotalPredictions('mlb', predictions);
}

/**
 * Best-effort odds attachment for whichever game_picks slots are already
 * locked — matched the same way as the lock cycle itself. Never influences
 * which side gets picked (that's decided from the model alone); this only
 * fills in the reference price shown next to an already-decided pick.
 */
async function attachPricesFromLines(lines: UnifiedGameLine[], games: SnapshotGame[]): Promise<void> {
  if (lines.length === 0) return;

  for (const line of lines) {
    const game = games.find(
      (g) => teamKey(g.awayTeamName ?? '') === teamKey(line.awayTeam) && teamKey(g.homeTeamName ?? '') === teamKey(line.homeTeam),
    );
    if (!game) continue;
    const gameId = String(game.gamePk);
    const pick = await getGamePick('mlb', gameId);
    if (!pick) continue;

    if (line.moneyline?.home != null && pick.mlInitialSide === 'home') await attachMoneylinePrice('mlb', gameId, 'initial', 'home', line.moneyline.home);
    if (line.moneyline?.away != null && pick.mlInitialSide === 'away') await attachMoneylinePrice('mlb', gameId, 'initial', 'away', line.moneyline.away);
    if (line.moneyline?.home != null && pick.mlFinalSide === 'home') await attachMoneylinePrice('mlb', gameId, 'final', 'home', line.moneyline.home);
    if (line.moneyline?.away != null && pick.mlFinalSide === 'away') await attachMoneylinePrice('mlb', gameId, 'final', 'away', line.moneyline.away);

    if (line.total?.overPrice != null && pick.totalInitialSide === 'over') await attachTotalPrice('mlb', gameId, 'initial', 'over', line.total.overPrice);
    if (line.total?.underPrice != null && pick.totalInitialSide === 'under') await attachTotalPrice('mlb', gameId, 'initial', 'under', line.total.underPrice);
    if (line.total?.overPrice != null && pick.totalFinalSide === 'over') await attachTotalPrice('mlb', gameId, 'final', 'over', line.total.overPrice);
    if (line.total?.underPrice != null && pick.totalFinalSide === 'under') await attachTotalPrice('mlb', gameId, 'final', 'under', line.total.underPrice);
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
      await logGameOddsHistory(lines);
    } catch (error) {
      console.error('[api/odds/lines] logGameOddsHistory failed', error);
    }

    // Read once, shared by both passes below — each independently
    // re-reading and re-parsing the same snapshot_cache['mlb:snapshot']
    // payload cost real time on every request (this is a multi-MB blob).
    const games = await readGamesFromSnapshot();

    try {
      await logTotalPredictionsFromLines(lines, games);
    } catch (error) {
      console.error('[api/odds/lines] logTotalPredictionsFromLines failed', error);
    }

    // Both lock passes (moneyline + total) used to run here — moved to the
    // Python worker's mlbOddsLinesCycleJob (Phase P of docs/mlb-prediction-
    // engine-ts-cutover-gameplan-2026-08-22.md, 2026-08-22, deployed to
    // Render and confirmed live via health_check.py's eloFreshness check
    // against real finished games). That job reads the same shared
    // snapshot_cache['mlb:snapshot'] this route reads and writes through
    // the same idempotent `_captured_at IS NULL` guard on game_picks, so
    // removing this duplicate path doesn't change what the table contains
    // — it just stops writing it twice, on a real 5-minute SequentialQueue
    // cadence instead of "whichever page load happens to land near
    // 6am/3-hours-before". See health_check.py's check_game_picks_freshness
    // (covers both the initial and final moneyline capture windows) for the
    // ongoing verification this removal is safe. attachPricesFromLines
    // below is NOT yet ported to Python (see odds_lines_cycle.py's own
    // docstring) — stays here for now.

    try {
      await attachPricesFromLines(lines, games);
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
    await logSystemEvent({ level: 'error', source: 'api/odds/lines', message: error instanceof Error ? error.message : 'Odds lookup failed.' });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Odds lookup failed.' },
      { status: 502 },
    );
  }
}
