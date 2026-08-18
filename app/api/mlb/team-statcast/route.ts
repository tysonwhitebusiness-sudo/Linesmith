/**
 * Team-level Statcast quality-of-contact rollup for one team.
 *
 * GET /api/mlb/team-statcast?teamId=147
 *
 * Split out of the slate snapshot for the same reason /api/mlb/bullpen is:
 * Scan never shows this, only Team Detail does, and only for the one team on
 * screen — no reason to cost the critical path of every scan refresh.
 */

import { NextResponse } from 'next/server';
import { getTeamStatcastRollup, type TeamStatcastRollup } from '@/lib/sports/mlb/teamStatcast';
import { easternDate } from '@/lib/sports/mlb/statsapi';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

// getTeamStatcastRollup(season) computes ALL 30 teams in one call — it takes
// no teamId — so this is cached by season, not by team, matching what the
// computation actually depends on. Keying per-team (as /api/mlb/team and
// /api/mlb/team-form do) would mean 30 near-duplicate cache rows, each still
// triggering a full league recompute on its own first miss. Its inputs' own
// in-process TTLs (statsapi.ts league batter/pitcher rows: 1h each; Savant's
// season aggregate: freshness defined as "through yesterday", much slower-
// moving) put 1h as the fastest-changing constituent, so that's the TTL here.
const CACHE_TTL_MS = 60 * 60 * 1000;

interface StatcastCachePayload {
  computedAt: string;
  season: number;
  hitting: Record<number, TeamStatcastRollup['hittingByTeam'] extends Map<number, infer V> ? V : never>;
  pitching: Record<number, TeamStatcastRollup['pitchingByTeam'] extends Map<number, infer V> ? V : never>;
}

function mapToRecord<V>(map: Map<number, V>): Record<number, V> {
  const out: Record<number, V> = {};
  for (const [k, v] of map) out[k] = v;
  return out;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamId = Number(url.searchParams.get('teamId'));

  if (!Number.isFinite(teamId) || teamId <= 0) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 });
  }

  const season = Number(easternDate().slice(0, 4));

  return cachedRoute({
    cacheKey: `mlb:team-statcast:${season}`,
    ttlMs: CACHE_TTL_MS,
    build: async (): Promise<StatcastCachePayload> => {
      const rollup = await getTeamStatcastRollup(season);
      return {
        computedAt: rollup.computedAt,
        season,
        hitting: mapToRecord(rollup.hittingByTeam),
        pitching: mapToRecord(rollup.pitchingByTeam),
      };
    },
    transform: (payload) => ({
      hitting: payload.hitting[teamId] ?? [],
      pitching: payload.pitching[teamId] ?? [],
      computedAt: payload.computedAt,
      season,
    }),
    errorMessage: 'Team Statcast lookup failed',
  });
}
