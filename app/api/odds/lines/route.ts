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
import { readSnapshotCache, readGameOddsBookLinesForSport, logSystemEvent } from '@/lib/db/client';
import type { UnifiedGameLine } from '@/lib/odds/types';

export const dynamic = 'force-dynamic';

/**
 * The subset of the MLB snapshot's game shape this route reads. Only the
 * team names and commence time are actually used now — to fill in the
 * fields `game_odds_book_lines` doesn't carry.
 *
 * Was wider, and the comment here described "both snapshot-reading
 * functions", because the deleted write passes read `gameModel` and the
 * team ids too. Trimmed with them (task 2.3) rather than left as a type
 * asserting this route still cares about a model it no longer touches.
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
}

/** Reads and parses `snapshot_cache['mlb:snapshot']` once; `[]` on a missing cache or a parse failure, which the single caller treats as "no team names to fill in" rather than an error — the bookmaker grid itself comes from `game_odds_book_lines` and does not depend on this. */
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

    // This handler is a pure read. It used to run three write passes here
    // — logGameOddsHistory, logTotalPredictionsFromLines and
    // attachPricesFromLines — on an unauthenticated GET (finding P4 H1).
    // All three now run in the Python worker's mlbOddsLinesCycleJob, every
    // 5 minutes, on a schedule instead of on whoever happens to load the
    // page. See predict/odds_lines_cycle.py: write_game_odds_history +
    // log_history_from_book_lines, run_total_lock_from_lines (which calls
    // log_game_total_predictions), and attach_prices_from_lines.
    //
    // Two of the three were already ported and running when this deletion
    // was made; only the archiving of propline/sharpapi book lines needed
    // building, and it is log_history_from_book_lines. Verified by
    // observation, not by reading the registry — see task 2.3 in §11.

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
