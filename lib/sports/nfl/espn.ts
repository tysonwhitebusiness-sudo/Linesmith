/**
 * NFL data sources beyond teamSportEspn.ts's schedule/roster (which cover
 * "today's/upcoming games" only): standings and league-wide injuries.
 *
 * Team schedule-with-results, per-player weekly history, and team stats
 * used to live here as ESPN scrapes — moved to nflverse.ts this session
 * (real, current, free CSV data, verified fresher and richer than the ESPN
 * equivalents). Standings and injuries stay on ESPN: nflverse doesn't have
 * a clean standings feed, and its `injuries` release hasn't posted 2026 data
 * yet (no games played), while ESPN's live injury endpoint already has real
 * current preseason data.
 */

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

async function cachedJson<T>(cacheKey: string, url: string, ttlMs: number): Promise<T | null> {
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < ttlMs) {
    return JSON.parse(cached.payload) as T;
  }
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  } catch {
    return cached ? (JSON.parse(cached.payload) as T) : null;
  }
  if (!res.ok) return cached ? (JSON.parse(cached.payload) as T) : null;
  const json = (await res.json()) as T;
  await writeSnapshotCache(cacheKey, JSON.stringify(json));
  return json;
}

// ---------------------------------------------------------------------------
// Standings — AFC/NFC, all divisions.
//
// Live-verified this session: the correct path is `apis/v2/...` (no `/site`)
// — `${BASE}/standings` (this file's usual `apis/site/v2` prefix) silently
// returns `{ fullViewLink }` with no data at all, a real bug that was
// shipping an empty standings table without ever throwing. The response
// also has no division-name field on each entry (only conference-level
// grouping) — divisions are fixed and don't change season to season, so a
// static table is more reliable here than parsing one out of the response.
// ---------------------------------------------------------------------------

const DIVISIONS: Record<string, { conference: string; division: string }> = {
  BUF: { conference: 'AFC', division: 'East' }, MIA: { conference: 'AFC', division: 'East' },
  NE: { conference: 'AFC', division: 'East' }, NYJ: { conference: 'AFC', division: 'East' },
  BAL: { conference: 'AFC', division: 'North' }, CIN: { conference: 'AFC', division: 'North' },
  CLE: { conference: 'AFC', division: 'North' }, PIT: { conference: 'AFC', division: 'North' },
  HOU: { conference: 'AFC', division: 'South' }, IND: { conference: 'AFC', division: 'South' },
  JAX: { conference: 'AFC', division: 'South' }, TEN: { conference: 'AFC', division: 'South' },
  DEN: { conference: 'AFC', division: 'West' }, KC: { conference: 'AFC', division: 'West' },
  LAC: { conference: 'AFC', division: 'West' }, LV: { conference: 'AFC', division: 'West' },
  DAL: { conference: 'NFC', division: 'East' }, NYG: { conference: 'NFC', division: 'East' },
  PHI: { conference: 'NFC', division: 'East' }, WSH: { conference: 'NFC', division: 'East' },
  CHI: { conference: 'NFC', division: 'North' }, DET: { conference: 'NFC', division: 'North' },
  GB: { conference: 'NFC', division: 'North' }, MIN: { conference: 'NFC', division: 'North' },
  ATL: { conference: 'NFC', division: 'South' }, CAR: { conference: 'NFC', division: 'South' },
  NO: { conference: 'NFC', division: 'South' }, TB: { conference: 'NFC', division: 'South' },
  ARI: { conference: 'NFC', division: 'West' }, LAR: { conference: 'NFC', division: 'West' },
  SF: { conference: 'NFC', division: 'West' }, SEA: { conference: 'NFC', division: 'West' },
};

export interface NflStandingsTeam {
  teamId: string;
  abbreviation: string;
  displayName: string;
  logoUrl: string | null;
  wins: number;
  losses: number;
  conference: string;
  division: string;
}

export async function getStandings(): Promise<NflStandingsTeam[]> {
  const json = await cachedJson<{
    children?: Array<{
      abbreviation: string;
      standings?: {
        entries?: Array<{
          team: { id: string; abbreviation: string; displayName: string; logos?: Array<{ href: string }> };
          stats?: Array<{ name: string; value: number }>;
        }>;
      };
    }>;
  }>('espn-nfl-standings', 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings', 30 * 60_000);

  const teams: NflStandingsTeam[] = [];
  for (const conf of json?.children ?? []) {
    for (const entry of conf.standings?.entries ?? []) {
      const wins = entry.stats?.find((s) => s.name === 'wins')?.value ?? 0;
      const losses = entry.stats?.find((s) => s.name === 'losses')?.value ?? 0;
      const grouping = DIVISIONS[entry.team.abbreviation];
      teams.push({
        teamId: entry.team.id,
        abbreviation: entry.team.abbreviation,
        displayName: entry.team.displayName,
        logoUrl: entry.team.logos?.[0]?.href ?? null,
        wins,
        losses,
        conference: grouping?.conference ?? conf.abbreviation,
        division: grouping?.division ?? 'Other',
      });
    }
  }
  return teams;
}

// ---------------------------------------------------------------------------
// Injuries — one league-wide call, matched to a roster by normalized name
// (same pattern lib/odds/props/entityResolution.ts already uses elsewhere).
// ---------------------------------------------------------------------------

export interface NflInjuryEntry {
  playerName: string;
  teamName: string;
  status: string; // e.g. "Questionable", "Out", "Doubtful"
}

export async function getLeagueInjuries(): Promise<NflInjuryEntry[]> {
  const json = await cachedJson<{
    injuries?: Array<{
      displayName: string;
      injuries?: Array<{ athlete?: { displayName?: string }; status?: string }>;
    }>;
  }>('espn-nfl-injuries', 'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/injuries', 30 * 60_000);

  const entries: NflInjuryEntry[] = [];
  for (const team of json?.injuries ?? []) {
    for (const injury of team.injuries ?? []) {
      if (!injury.athlete?.displayName || !injury.status) continue;
      entries.push({ playerName: injury.athlete.displayName, teamName: team.displayName, status: injury.status });
    }
  }
  return entries;
}
