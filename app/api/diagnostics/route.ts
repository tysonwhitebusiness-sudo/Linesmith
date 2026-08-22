/**
 * Diagnostics / health-check endpoint.
 *
 * GET /api/diagnostics       — full health report
 * GET /api/diagnostics?force=1 — force a fresh API fetch (respects reserve)
 */

import { NextResponse } from 'next/server';
import { getMlbGameLines } from '@/lib/odds/oddsApi';
import { readHarvesterOutput } from '@/lib/odds/oddsHarvester';
import { mergeLines } from '@/lib/odds/merge';
import { readOddsCache, logSystemEvent } from '@/lib/db/client';
import { recentFetchErrors } from '@/lib/sports/mlb/statsapi';
import fs from 'node:fs';
import path from 'node:path';
import type { GameLine } from '@/lib/odds/oddsApi';

const DATA_DIR = path.join(process.cwd(), 'data');

interface HarvesterFileInfo {
  filename: string;
  exists: boolean;
  sizeBytes: number | null;
  modifiedAt: string | null;
  matchCount: number | null;
  error: string | null;
}

function inspectHarvesterFile(sport: string, mode: 'live' | 'upcoming'): HarvesterFileInfo {
  const filename = `${sport}_${mode}.json`;
  const filePath = path.join(DATA_DIR, filename);

  try {
    const stat = fs.statSync(filePath);
    const result = readHarvesterOutput(sport, mode);
    return {
      filename,
      exists: true,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      matchCount: result.matches.length,
      error: result.error ?? null,
    };
  } catch {
    return {
      filename,
      exists: false,
      sizeBytes: null,
      modifiedAt: null,
      matchCount: null,
      error: 'File not found',
    };
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const force = url.searchParams.get('force') !== null;
  const sport = url.searchParams.get('sport') ?? 'mlb';
  // OddsHarvester uses "baseball" as the sport key, not "mlb".
  const harvesterSport = sport === 'mlb' ? 'baseball' : sport;

  try {
    // Run all health checks in parallel
    const [oddsApiResult, liveFile, upcomingFile, cacheRow] = await Promise.all([
      getMlbGameLines(force),
      Promise.resolve(inspectHarvesterFile(harvesterSport, 'live')),
      Promise.resolve(inspectHarvesterFile(harvesterSport, 'upcoming')),
      Promise.resolve(readOddsCache('baseball_mlb:h2h,spreads,totals:us')),
    ]);

    // Merge to see the combined view
    const harvesterResult = readHarvesterOutput(harvesterSport, 'live');
    const merged = mergeLines(oddsApiResult.lines, harvesterResult.matches);

    // Per-source line details
    const oddsApiLineDetail = oddsApiResult.lines.map((l) => ({
      eventId: l.eventId,
      matchup: `${l.awayTeam} @ ${l.homeTeam}`,
      commenceTime: l.commenceTime,
      moneyline: l.moneyline ?? null,
      total: l.total?.point ?? null,
      bookCount: l.bookCount,
    }));

    const harvesterLineDetail = harvesterResult.matches.map((m) => ({
      matchUrl: m.matchUrl,
      matchup: `${m.awayTeam} @ ${m.homeTeam}`,
      matchDate: m.matchDate,
      bookmakers: m.bookmakers.map((b) => ({
        name: b.bookmaker,
        homeOdds: b.homeOdds ?? null,
        awayOdds: b.awayOdds ?? null,
        totalPoint: b.point ?? null,
        overPrice: b.overPrice ?? null,
        underPrice: b.underPrice ?? null,
      })),
      livePeriod: m.livePeriod ?? null,
      liveScore: m.liveScore ?? null,
    }));

    const mergedLineDetail = merged.map((l) => ({
      eventId: l.eventId,
      matchup: `${l.awayTeam} @ ${l.homeTeam}`,
      source: l.source,
      moneyline: l.moneyline ?? null,
      total: l.total?.point ?? null,
      bookCount: l.bookCount,
      bookmakers: l.bookmakers.map((b) => ({
        name: b.bookmaker,
        homeOdds: b.homeOdds ?? null,
        awayOdds: b.awayOdds ?? null,
      })),
      hasLiveData: Boolean(l.liveScore || l.livePeriod),
    }));

    return NextResponse.json(
      {
        timestamp: new Date().toISOString(),

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

        oddsHarvester: {
          live: liveFile,
          upcoming: upcomingFile,
          lines: harvesterLineDetail,
        },

        merged: {
          totalLines: merged.length,
          bySource: {
            'odds-api': merged.filter((l) => l.source === 'odds-api').length,
            oddsharvester: merged.filter((l) => l.source === 'oddsharvester').length,
            both: merged.filter((l) => l.source === 'both').length,
          },
          withLiveData: merged.filter((l) => l.liveScore || l.livePeriod).length,
          lines: mergedLineDetail,
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
