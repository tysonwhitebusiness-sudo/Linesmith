/**
 * Diagnostics / health-check endpoint.
 *
 * GET /api/diagnostics       — full health report
 * GET /api/diagnostics?force=1 — force a fresh API fetch (respects reserve)
 */

import { NextResponse } from 'next/server';
import { getMlbGameLines } from '@/lib/odds/oddsApi';
import { readOddsCache, logSystemEvent, readGameOddsBookLinesHealth, readCacheFailureSummary, type GameOddsBookLinesHealthRow } from '@/lib/db/client';
import { recentFetchErrors } from '@/lib/sports/mlb/statsapi';

/**
 * Every sport odds-architecture-rebuild-2026-08-25.md covers except golf
 * (no game-line concept at all). Same list, same reasoning, as python-odds-
 * service/src/health_check.py's GAME_ODDS_BOOK_LINES_SPORTS — kept as two
 * short hardcoded lists rather than one shared file because TS and Python
 * don't share a module boundary here; if this list and health_check.py's
 * ever needs to change, change both.
 */
const GAME_ODDS_BOOK_LINES_SPORTS = ['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer', 'tennis'];
const STALE_HOURS = 24;

interface SportOddsHealth {
  sport: string;
  healthy: boolean;
  status: string;
  sources: { source: string; count: number; latestFetchedAt: string; ageHours: number }[];
}

/**
 * Real "is data actually reaching game_odds_book_lines" check — the blind
 * spot this whole rebuild plan called out (Phase 7): every check before
 * this verified a background job ran, never that its output reached the
 * shared table every sport's Game Detail/Scan page actually reads. Ported
 * from health_check.py's check_game_odds_book_lines_freshness so a human
 * looking at this page in the browser sees the same real signal a human
 * running the Python CLI does. Per-sport, not per-(sport,source): see that
 * function's own docstring for why a hardcoded expected-source list per
 * sport isn't the right call here.
 */
function summarizeGameOddsBookLinesHealth(rows: GameOddsBookLinesHealthRow[]): SportOddsHealth[] {
  const bySport = new Map<string, GameOddsBookLinesHealthRow[]>();
  for (const r of rows) {
    const list = bySport.get(r.sport);
    if (list) list.push(r);
    else bySport.set(r.sport, [r]);
  }

  const now = Date.now();
  return GAME_ODDS_BOOK_LINES_SPORTS.map((sport) => {
    const sportRows = bySport.get(sport) ?? [];
    const sources = sportRows.map((r) => ({
      source: r.source,
      count: r.count,
      latestFetchedAt: r.latestFetchedAt,
      ageHours: (now - new Date(r.latestFetchedAt).getTime()) / 3_600_000,
    }));

    if (sources.length === 0) {
      return { sport, healthy: true, status: 'no rows in the last 7 days (not failed — could be a real off-season gap)', sources };
    }

    const freshestAgeHours = Math.min(...sources.map((s) => s.ageHours));
    const healthy = freshestAgeHours <= STALE_HOURS;
    const sourcesDesc = sources.map((s) => `${s.source}=${s.count}`).join(', ');
    return {
      sport,
      healthy,
      status: healthy
        ? `healthy — freshest row ${freshestAgeHours.toFixed(1)}h ago (last 7d by source: ${sourcesDesc})`
        : `STALE — freshest row ${freshestAgeHours.toFixed(0)}h old, past the ${STALE_HOURS}h threshold (last 7d by source: ${sourcesDesc})`,
      sources,
    };
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const force = url.searchParams.get('force') !== null;

  try {
    // Run all health checks in parallel
    const [oddsApiResult, cacheRow, gameOddsBookLinesRows, cacheFailures] = await Promise.all([
      getMlbGameLines(force),
      readOddsCache('baseball_mlb:h2h,spreads,totals:us'),
      readGameOddsBookLinesHealth(),
      // Task 3.2 — the spike panel. Cheap: one indexed scan over 24h of
      // system_events, a table that holds ~100 rows.
      readCacheFailureSummary(),
    ]);

    // Per-source line details
    const oddsApiLineDetail = oddsApiResult.lines.map((l) => ({
      eventId: l.eventId,
      matchup: `${l.awayTeam} @ ${l.homeTeam}`,
      commenceTime: l.commenceTime,
      moneyline: l.moneyline ?? null,
      total: l.total?.point ?? null,
      bookCount: l.bookCount,
    }));

    const gameOddsBookLinesHealth = summarizeGameOddsBookLinesHealth(gameOddsBookLinesRows);

    return NextResponse.json(
      {
        timestamp: new Date().toISOString(),

        // Task 3.2 (finding P5 E3), scoped by Q19 to no external error
        // tracking. A non-zero `last24h` here means cachedRoute writes are
        // failing and the app is serving correct data while caching none of
        // it — the exact condition that went unnoticed during the free-tier
        // read-only window, and which task 3.1 made visible.
        cacheFailures,

        // Why recent MLB Stats API calls failed. `getJson` returns null on any
        // failure, so without this a whole slate can go missing behind a 200.
        statsApiErrors: recentFetchErrors(),

        oddsApi: {
          enabled: oddsApiResult.enabled,
          status: oddsApiResult.enabled ? (oddsApiResult.fromCache ? 'cached' : 'live') : 'disabled',
          linesReturned: oddsApiResult.lines.length,
          fetchedAt: oddsApiResult.fetchedAt,
          fromCache: oddsApiResult.fromCache,
          nextRefreshAt: oddsApiResult.nextRefreshAt,
          requestsRemaining: oddsApiResult.requestsRemaining,
          requestsUsed: oddsApiResult.requestsUsed,
          warnings: oddsApiResult.warnings,
          cache: cacheRow
            ? {
                fetchedAt: cacheRow.fetchedAt,
                requestsRemaining: cacheRow.requestsRemaining,
                requestsUsed: cacheRow.requestsUsed,
                payloadBytes: cacheRow.payload.length,
              }
            : null,
          lines: oddsApiLineDetail,
        },

        // Real "is data actually reaching game_odds_book_lines" check
        // (odds-architecture rebuild Phase 7) — every sport's Game Detail/
        // Scan page reads through this one shared table; this is the
        // signal that would have caught NHL sitting at zero real rows
        // before Phase 4/5 shipped it real OddsHarvester coverage,
        // automatically, instead of a manual audit finding it.
        gameOddsBookLines: {
          allHealthy: gameOddsBookLinesHealth.every((s) => s.healthy),
          bySport: gameOddsBookLinesHealth,
        },

        env: {
          oddsApiKeyConfigured: Boolean(process.env.ODDS_API_KEY?.trim()),
          oddsApiTtlMinutes: Number(process.env.ODDS_API_TTL_MINUTES) || 360,
          oddsApiReserve: Number(process.env.ODDS_API_RESERVE) || 25,
          nodeEnv: process.env.NODE_ENV ?? 'development',
        },
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[api/diagnostics]', error);
    await logSystemEvent({ level: 'error', source: 'api/diagnostics', message: error instanceof Error ? error.message : 'Diagnostics failed.' });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Diagnostics failed.' },
      { status: 502 },
    );
  }
}
