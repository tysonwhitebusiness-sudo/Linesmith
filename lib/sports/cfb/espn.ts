/**
 * CFB data beyond teamSportEspn.ts's schedule/roster (today's/upcoming
 * games only): the full FBS team list (for a real Teams page + team-logo
 * URLs), conference standings, and per-game summary (pregame line + live
 * state + per-player box score). Mirrors lib/sports/soccer/espn.ts's shape.
 *
 * ESPN's own `/college-football/teams` endpoint has no real FBS/FCS
 * classification field on the team object (every group/groups query param
 * tried returned the same unfiltered ~759-team list across every
 * division), so the team list is filtered down to CFBD's own `/teams/fbs`
 * list (real, ~136 schools) via `matchCfbdTeamName`, matched on ESPN's
 * `team.location` (the bare school name, "Alabama") against CFBD's
 * `school` field — see cfbd.ts's `matchCfbdTeamName` for why the full
 * `displayName` ("Alabama Crimson Tide") badly over-matches instead.
 */

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { fetchFbsTeamNames, matchCfbdTeamName } from './cfbd';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';

export interface CfbTeam {
  teamId: string;
  name: string;
  abbreviation: string;
  logoUrl: string | null;
  /** ESPN's bare school name ("Alabama") — CFBD's `/games?team=` query param wants this exact convention, not the full "{school} {mascot}" display name. */
  location: string;
  conference: string | null;
}

interface RawTeamsResponse {
  sports?: Array<{ leagues?: Array<{ teams?: Array<{ team: { id: string; location: string; displayName: string; abbreviation: string; logos?: Array<{ href: string; rel: string[] }> } }> }> }>;
}

export async function fetchAllTeams(): Promise<CfbTeam[]> {
  const cacheKey = 'cfb:teams';
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 60 * 60_000) {
    return JSON.parse(cached.payload) as CfbTeam[];
  }

  let res: Response;
  try {
    // Real total across every NCAA football division is ~759 (confirmed
    // live) — a lower limit silently truncated the list and dropped real
    // major programs (TCU, Navy, Purdue, Tennessee...) rather than erroring,
    // which the FBS-name filter below would have masked as "not FBS"
    // instead of "not fetched".
    res = await fetch(`${ESPN_BASE}/teams?limit=1000`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  } catch {
    return cached ? (JSON.parse(cached.payload) as CfbTeam[]) : [];
  }
  if (!res.ok) return cached ? (JSON.parse(cached.payload) as CfbTeam[]) : [];

  const json = (await res.json()) as RawTeamsResponse;
  const raw = json.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const fbsNames = await fetchFbsTeamNames();

  const teams: CfbTeam[] = raw
    .filter((t) => matchCfbdTeamName(t.team.location, fbsNames) != null)
    .map((t) => ({
      teamId: t.team.id,
      name: t.team.displayName,
      abbreviation: t.team.abbreviation,
      logoUrl: t.team.logos?.find((l) => l.rel.includes('default'))?.href ?? t.team.logos?.[0]?.href ?? null,
      location: t.team.location,
      conference: null,
    }));

  await writeSnapshotCache(cacheKey, JSON.stringify(teams));
  return teams;
}

export async function cfbTeamLogoByAbbr(): Promise<Map<string, string>> {
  const teams = await fetchAllTeams();
  return new Map(teams.filter((t) => t.logoUrl).map((t) => [t.abbreviation, t.logoUrl as string]));
}

/**
 * Real logo keyed by CFBD's own school name (e.g. "Alabama") rather than
 * ESPN's abbreviation — `teamDefenseAllowed.ts`'s league-wide index is
 * itself keyed this way (CFBD box scores have no ESPN abbreviation
 * anywhere in them), so this is the lookup the matchup card actually
 * needs (2026-08-24 — CFB's matchup card never had real logos at all
 * before this, unlike every other team sport).
 */
export async function cfbTeamLogoByCfbdName(): Promise<Map<string, string>> {
  const [teams, fbsNames] = await Promise.all([fetchAllTeams(), fetchFbsTeamNames()]);
  const map = new Map<string, string>();
  for (const t of teams) {
    if (!t.logoUrl) continue;
    const cfbdName = matchCfbdTeamName(t.location, fbsNames);
    if (cfbdName) map.set(cfbdName, t.logoUrl);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Standings — real conference groups, flattened the same way soccer's MLS
// (2 conferences) taught this codebase to: don't assume one `children[0]`,
// flatten however many groups come back. CFB has ~10+ conference groups.
// ---------------------------------------------------------------------------

export interface CfbStanding {
  teamId: string;
  wins: number;
  losses: number;
  conferenceWins: number;
  conferenceLosses: number;
  rank: number;
  groupName: string | null;
}

interface RawStandingsResponse {
  children?: Array<{ name?: string; standings?: { entries?: Array<{ team: { id: string }; stats?: Array<{ name: string; value: number }> }> } }>;
}

function statValue(stats: Array<{ name: string; value: number }> | undefined, name: string): number {
  return stats?.find((s) => s.name === name)?.value ?? 0;
}

export async function fetchStandings(): Promise<CfbStanding[]> {
  const cacheKey = 'cfb:standings';
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 30 * 60_000) {
    return JSON.parse(cached.payload) as CfbStanding[];
  }

  let res: Response;
  try {
    res = await fetch('https://site.api.espn.com/apis/v2/sports/football/college-football/standings', {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return cached ? (JSON.parse(cached.payload) as CfbStanding[]) : [];
  }
  if (!res.ok) return cached ? (JSON.parse(cached.payload) as CfbStanding[]) : [];

  const json = (await res.json()) as RawStandingsResponse;
  const standings: CfbStanding[] = [];
  for (const group of json.children ?? []) {
    for (const entry of group.standings?.entries ?? []) {
      standings.push({
        teamId: entry.team.id,
        wins: statValue(entry.stats, 'wins'),
        losses: statValue(entry.stats, 'losses'),
        conferenceWins: statValue(entry.stats, 'vsConf_wins'),
        conferenceLosses: statValue(entry.stats, 'vsConf_losses'),
        rank: statValue(entry.stats, 'rank'),
        groupName: group.name ?? null,
      });
    }
  }

  await writeSnapshotCache(cacheKey, JSON.stringify(standings));
  return standings;
}

// ---------------------------------------------------------------------------
// Game summary — pregame line + live state + per-player match stats, same
// role as soccer's fetchGameSummary.
// ---------------------------------------------------------------------------

export interface CfbPregameLine {
  book: string;
  moneylineHome: number | null;
  moneylineAway: number | null;
  spread: number | null;
  overUnder: number | null;
  overOdds: number | null;
  underOdds: number | null;
}

export interface CfbGameMeta {
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

export interface CfbGameSummary {
  game: CfbGameMeta | null;
  pregameLine: CfbPregameLine | null;
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

export async function fetchGameSummary(eventId: string): Promise<CfbGameSummary> {
  const empty: CfbGameSummary = { game: null, pregameLine: null };
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
  const game: CfbGameMeta | null =
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
  const pregameLine: CfbPregameLine | null = rawOdds
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
