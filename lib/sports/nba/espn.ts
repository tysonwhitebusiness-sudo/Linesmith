/**
 * NBA data beyond teamSportEspn.ts's schedule/roster: the full 30-team
 * list, conference standings, and per-game summary (pregame line + live
 * state). Mirrors lib/sports/soccer/espn.ts's shape. Much simpler than
 * CFB's version — ESPN's `basketball/nba/teams` returns exactly the real
 * 30 teams with no FBS/FCS-style noise to filter.
 */

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

export interface NbaTeam {
  teamId: string;
  name: string;
  abbreviation: string;
  logoUrl: string | null;
  conference: string | null;
}

interface RawTeamsResponse {
  sports?: Array<{ leagues?: Array<{ teams?: Array<{ team: { id: string; displayName: string; abbreviation: string; logos?: Array<{ href: string; rel: string[] }> } }> }> }>;
}

export async function fetchAllTeams(): Promise<NbaTeam[]> {
  const cacheKey = 'nba:teams';
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 60 * 60_000) {
    return JSON.parse(cached.payload) as NbaTeam[];
  }

  let res: Response;
  try {
    res = await fetch(`${ESPN_BASE}/teams?limit=50`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  } catch {
    return cached ? (JSON.parse(cached.payload) as NbaTeam[]) : [];
  }
  if (!res.ok) return cached ? (JSON.parse(cached.payload) as NbaTeam[]) : [];

  const json = (await res.json()) as RawTeamsResponse;
  const raw = json.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const teams: NbaTeam[] = raw.map((t) => ({
    teamId: t.team.id,
    name: t.team.displayName,
    abbreviation: t.team.abbreviation,
    logoUrl: t.team.logos?.find((l) => l.rel.includes('default'))?.href ?? t.team.logos?.[0]?.href ?? null,
    conference: null,
  }));

  await writeSnapshotCache(cacheKey, JSON.stringify(teams));
  return teams;
}

export async function nbaTeamLogoByAbbr(): Promise<Map<string, string>> {
  const teams = await fetchAllTeams();
  return new Map(teams.filter((t) => t.logoUrl).map((t) => [t.abbreviation, t.logoUrl as string]));
}

// ---------------------------------------------------------------------------
// Standings — Eastern/Western conference, same 2-group flatten pattern
// soccer's MLS taught this codebase.
// ---------------------------------------------------------------------------

export interface NbaStanding {
  teamId: string;
  wins: number;
  losses: number;
  rank: number;
  groupName: string | null;
}

interface RawStandingsResponse {
  children?: Array<{ name?: string; standings?: { entries?: Array<{ team: { id: string }; stats?: Array<{ name: string; value: number }> }> } }>;
}

function statValue(stats: Array<{ name: string; value: number }> | undefined, name: string): number {
  return stats?.find((s) => s.name === name)?.value ?? 0;
}

export async function fetchStandings(): Promise<NbaStanding[]> {
  const cacheKey = 'nba:standings';
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 30 * 60_000) {
    return JSON.parse(cached.payload) as NbaStanding[];
  }

  let res: Response;
  try {
    res = await fetch('https://site.api.espn.com/apis/v2/sports/basketball/nba/standings', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  } catch {
    return cached ? (JSON.parse(cached.payload) as NbaStanding[]) : [];
  }
  if (!res.ok) return cached ? (JSON.parse(cached.payload) as NbaStanding[]) : [];

  const json = (await res.json()) as RawStandingsResponse;
  const standings: NbaStanding[] = [];
  for (const group of json.children ?? []) {
    for (const entry of group.standings?.entries ?? []) {
      standings.push({
        teamId: entry.team.id,
        wins: statValue(entry.stats, 'wins'),
        losses: statValue(entry.stats, 'losses'),
        rank: statValue(entry.stats, 'playoffSeed'),
        groupName: group.name ?? null,
      });
    }
  }

  await writeSnapshotCache(cacheKey, JSON.stringify(standings));
  return standings;
}

// ---------------------------------------------------------------------------
// Game summary — pregame line + live state, same role as soccer's/CFB's
// fetchGameSummary.
// ---------------------------------------------------------------------------

export interface NbaPregameLine {
  book: string;
  moneylineHome: number | null;
  moneylineAway: number | null;
  spread: number | null;
  overUnder: number | null;
  overOdds: number | null;
  underOdds: number | null;
}

export interface NbaGameMeta {
  gameId: string;
  date: string;
  homeTeamId: string;
  homeTeamName: string;
  homeAbbr: string;
  homeLogoUrl?: string;
  homeScore: number | null;
  awayTeamId: string;
  awayTeamName: string;
  awayAbbr: string;
  awayLogoUrl?: string;
  awayScore: number | null;
  status: { completed: boolean; state: 'pre' | 'in' | 'post'; shortDetail: string } | null;
}

export interface NbaGameSummary {
  game: NbaGameMeta | null;
  pregameLine: NbaPregameLine | null;
}

interface RawSummaryResponse {
  header?: {
    competitions?: Array<{
      date?: string;
      status?: { type?: { completed?: boolean; state?: string; shortDetail?: string } };
      competitors?: Array<{ homeAway: 'home' | 'away'; score?: string; team: { id: string; displayName: string; abbreviation: string; logos?: Array<{ href: string }> } }>;
    }>;
  };
  odds?: Array<{
    provider?: { name?: string };
    homeTeamOdds?: { moneyLine?: number };
    awayTeamOdds?: { moneyLine?: number };
    spread?: number;
    overUnder?: number;
    overOdds?: number;
    underOdds?: number;
  }>;
}

export async function fetchGameSummary(eventId: string): Promise<NbaGameSummary> {
  const empty: NbaGameSummary = { game: null, pregameLine: null };
  let res: Response;
  try {
    res = await fetch(`${ESPN_BASE}/summary?event=${eventId}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  } catch {
    return empty;
  }
  if (!res.ok) return empty;

  const json = (await res.json()) as RawSummaryResponse;
  const comp = json.header?.competitions?.[0];
  const homeC = comp?.competitors?.find((c) => c.homeAway === 'home');
  const awayC = comp?.competitors?.find((c) => c.homeAway === 'away');
  const statusType = comp?.status?.type;
  const game: NbaGameMeta | null =
    homeC && awayC
      ? {
          gameId: eventId,
          date: comp?.date ?? '',
          homeTeamId: homeC.team.id,
          homeTeamName: homeC.team.displayName,
          homeAbbr: homeC.team.abbreviation,
          homeLogoUrl: homeC.team.logos?.[0]?.href,
          homeScore: homeC.score != null ? Number(homeC.score) : null,
          awayTeamId: awayC.team.id,
          awayTeamName: awayC.team.displayName,
          awayAbbr: awayC.team.abbreviation,
          awayLogoUrl: awayC.team.logos?.[0]?.href,
          awayScore: awayC.score != null ? Number(awayC.score) : null,
          status:
            statusType?.state != null
              ? { completed: statusType.completed === true, state: statusType.state as 'pre' | 'in' | 'post', shortDetail: statusType.shortDetail ?? '' }
              : null,
        }
      : null;

  const rawOdds = json.odds?.[0];
  const pregameLine: NbaPregameLine | null = rawOdds
    ? {
        book: rawOdds.provider?.name ?? 'Unknown',
        moneylineHome: rawOdds.homeTeamOdds?.moneyLine ?? null,
        moneylineAway: rawOdds.awayTeamOdds?.moneyLine ?? null,
        spread: rawOdds.spread ?? null,
        overUnder: rawOdds.overUnder ?? null,
        overOdds: rawOdds.overOdds ?? null,
        underOdds: rawOdds.underOdds ?? null,
      }
    : null;

  return { game, pregameLine };
}
