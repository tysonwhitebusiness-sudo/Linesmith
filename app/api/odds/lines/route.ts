/**
 * Unified game lines, for every sport — reads game_odds_book_lines
 * directly (odds-architecture rebuild Phase 6), the shared table every
 * real source (the-odds-api, OddsHarvester, SportsGameOdds, SharpAPI,
 * Propline, ESPN) writes into.
 *
 * GET /api/odds/lines?sport=mlb
 * GET /api/odds/lines?sport=cfb
 *
 * NFL used to keep its own separate path (getNflGameLines, SharpAPI +
 * TheRundown) but that pipeline hardcoded `bookmakers: []` on every line —
 * it never actually fed the per-book comparison grid, only ever a single
 * aggregate number. NFL now reads through the same shared-table branch as
 * every other non-MLB sport below: real per-book rows already land there
 * from SportsGameOdds (`_sgo_game_line_rows`, sport-agnostic) and
 * OddsHarvester (`dynamic_lines=True` for NFL, harvester_scrape.py) —
 * genuinely richer than the old empty-bookmakers pipeline it replaces.
 * `getNflGameLines`/`nflGameLines.ts` has no other callers left after this
 * (confirmed via grep) and is dead code as of this change. MLB keeps its
 * own real side effects below (odds-history logging, total-prediction
 * logging, price attachment) — real production pick-lock plumbing, not
 * something this change removes, just re-sourced from the shared table
 * instead of the old the-odds-api + OddsHarvester-flat-file merge
 * (mergeLines/readHarvesterOutput, both now retired — the flat file was
 * already dead, nothing wrote to it in a deployed context).
 *
 * No `force`/cache-bypass param anymore: there's no cache layer left to
 * bypass — this is a direct table read every request, same as
 * `/api/props/lines`'s own reasoning (CLAUDE.md pattern 2).
 */

import { NextResponse } from 'next/server';
import { logGameOddsHistory } from '@/lib/odds/gameOddsLog';
import { readSnapshotCache, readGameOddsBookLinesForSport } from '@/lib/db/client';
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

/**
 * The newest real `fetched_at` across the lines being returned, or null.
 *
 * Phase 1.2 (audit finding P3 C4). Both response branches below used to stamp
 * `fetchedAt: new Date().toISOString()` unconditionally, so a response assembled
 * from prices that were 17.5 hours old asserted it had just been fetched — the
 * audit caught exactly that during a worker outage. A bettor acting on a stale
 * price loses real money, which is why the plan calls this the single most
 * user-protective change in it.
 *
 * Null when no line carries a timestamp. An absent value is honest; `now()` is
 * a claim, and it was false.
 */
function newestFetchedAt(lines: UnifiedGameLine[]): string | null {
  let newest: string | null = null;
  for (const l of lines) {
    if (l.lastFetchedAt && (!newest || l.lastFetchedAt > newest)) newest = l.lastFetchedAt;
  }
  return newest;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? 'mlb';

  // Every sport other than MLB: no model/pick-lock machinery, no
  // real side effects — just the real per-game bookmaker grid for the
  // whole slate, straight from game_odds_book_lines (odds-architecture
  // rebuild Phase 6). `force` doesn't apply here (there's no live
  // upstream fetch to bypass a cache for — the table is populated by
  // background jobs on their own schedule).
  if (sport !== 'mlb') {
    try {
      const lines = await readGameOddsBookLinesForSport(sport);
      return NextResponse.json(
        {
          enabled: lines.length > 0,
          lines,
          fetchedAt: newestFetchedAt(lines),
          fromCache: false,
          sources: {
            oddsApi: { enabled: false, fetchedAt: null, requestsRemaining: null },
            oddsHarvester: { enabled: lines.length > 0, fetchedAt: newestFetchedAt(lines), matches: lines.length },
          },
          nextRefreshAt: null,
          warnings: [],
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    } catch (error) {
      console.error(`[api/odds/lines] ${sport}`, error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Odds lookup failed.' },
        { status: 502 },
      );
    }
  }

  try {
    // Read once, needed both to build real lines below (real team names/
    // commence time — game_odds_book_lines doesn't store either, see
    // readGameOddsBookLines's own comment) and by the side-effect passes
    // further down, which independently re-reading and re-parsing the same
    // snapshot_cache['mlb:snapshot'] payload would cost real time on every
    // request (this is a multi-MB blob).
    const games = await readGamesFromSnapshot();

    // Real per-game bookmaker grid, every real source merged (odds-
    // architecture rebuild Phase 2/6) — replaces the old the-odds-api +
    // OddsHarvester-flat-file merge (mergeLines/readHarvesterOutput, both
    // now retired): the-odds-api's own rows are still in this same
    // game_odds_book_lines table (source='the-odds-api', written by
    // odds_lines_cycle.py), just one source among several instead of the
    // sole input. One query for the whole slate (readGameOddsBookLinesForSport)
    // rather than one query per game — a real, measured regression caught
    // live before this shipped: the per-game version took 62s for a real
    // 15-game slate (sequential round-trips through the Supavisor pooler),
    // against ~200ms for one batched query. Real team names/commence time
    // filled in per game afterward (in memory, matched by the real game
    // id readGameOddsBookLinesForSport already sets as `eventId`) since
    // the shared table itself doesn't carry them.
    const gamesById = new Map(games.map((g) => [String(g.gamePk), g]));
    const lines: UnifiedGameLine[] = [];
    for (const line of await readGameOddsBookLinesForSport('mlb')) {
      const game = gamesById.get(line.eventId);
      if (!game) continue;
      lines.push({
        ...line,
        eventId: line.eventId,
        homeTeam: game.homeTeamName ?? '',
        awayTeam: game.awayTeamName ?? '',
        commenceTime: game.firstPitch ?? '',
      });
    }

    const warnings: string[] = [];
    const enabled = lines.length > 0;

    try {
      await logGameOddsHistory(lines);
    } catch (error) {
      console.error('[api/odds/lines] logGameOddsHistory failed', error);
    }

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
        fetchedAt: newestFetchedAt(lines),
        fromCache: false,
        sources: {
          // Legacy shape (UnifiedLinesResult.sources) predates this
          // multi-source table and doesn't cleanly represent "up to 6 real
          // sources merged" — approximated here rather than redesigning
          // that type in this same pass. `oddsApi.enabled` reflects
          // whether the-odds-api itself is still configured, not whether
          // any single response used its data specifically.
          oddsApi: { enabled: true, fetchedAt: newestFetchedAt(lines), requestsRemaining: null },
          oddsHarvester: { enabled, fetchedAt: newestFetchedAt(lines), matches: lines.length },
        },
        nextRefreshAt: null,
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
