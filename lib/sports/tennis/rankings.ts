/**
 * ATP/WTA world rankings — `GET .../tennis/{tour}/rankings`, confirmed live:
 * a real, structured, official feed (current #1 was Jannik Sinner, 12,800
 * points, with `current`/`previous`/`trend` per player) that ESPN's tennis
 * API carries but nothing in this app reads yet. This is what a golf
 * schedule page's Top 5/Top 10 leaderboard-position card becomes for
 * tennis — genuinely better than golf's version, which is explicitly "not a
 * priced market" since no free source exists; this one is the sport's real,
 * official standing.
 */

import { readSnapshotCache, writeSnapshotCache } from '../../db/client';
import type { TennisTour } from '../../core/types';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
// Rankings move at most weekly in reality — this just avoids re-hitting ESPN more than a few times a day.
const TTL_MS = 6 * 60 * 60 * 1000;

export interface RankingRow {
  rank: number;
  previousRank: number | null;
  points: number | null;
  trend: string;
  athleteId: string;
  name: string;
}

interface RawRankingsResponse {
  rankings?: Array<{
    ranks?: Array<{
      current: number;
      previous?: number;
      points?: number;
      trend?: string;
      athlete: { id: string; displayName: string };
    }>;
  }>;
}

async function fetchRankingsFromEspn(tour: TennisTour): Promise<RankingRow[] | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${tour}/rankings`, { cache: 'no-store', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = (await res.json()) as RawRankingsResponse;
  const ranks = json.rankings?.[0]?.ranks ?? [];
  return ranks.map((r) => ({
    rank: r.current,
    previousRank: r.previous ?? null,
    points: r.points ?? null,
    trend: r.trend ?? '-',
    athleteId: `espn:tennis:${r.athlete.id}`,
    name: r.athlete.displayName,
  }));
}

export async function getTennisRankings(tour: TennisTour): Promise<{ rankings: RankingRow[]; fetchedAt: string; fromCache: boolean; warnings: string[] }> {
  const cacheKey = `tennis:rankings:${tour}`;
  const cached = await readSnapshotCache(cacheKey);
  const ageMs = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;

  if (cached && ageMs < TTL_MS) {
    return { rankings: JSON.parse(cached.payload), fetchedAt: cached.fetchedAt, fromCache: true, warnings: [] };
  }

  const rankings = await fetchRankingsFromEspn(tour);
  if (!rankings) {
    if (cached) {
      return { rankings: JSON.parse(cached.payload), fetchedAt: cached.fetchedAt, fromCache: true, warnings: ['ESPN rankings request failed — showing the last successful fetch.'] };
    }
    return { rankings: [], fetchedAt: new Date().toISOString(), fromCache: false, warnings: ['ESPN rankings request failed and there is no cached copy yet.'] };
  }

  await writeSnapshotCache(cacheKey, JSON.stringify(rankings));
  return { rankings, fetchedAt: new Date().toISOString(), fromCache: false, warnings: [] };
}
