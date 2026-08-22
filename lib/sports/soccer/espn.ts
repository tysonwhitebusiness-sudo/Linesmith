/**
 * Soccer data beyond teamSportEspn.ts's schedule/roster (today's/upcoming
 * games only): the full league team list, needed for a real Teams page and
 * for real team-logo URLs — neither the schedule nor the game-context
 * roster carries every club in the league, only whoever's playing in the
 * current date window.
 */

import type { SoccerLeague } from '@/lib/core/types';
import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';

const ESPN_LEAGUE_SLUG: Record<SoccerLeague, string> = { epl: 'eng.1', mls: 'usa.1' };

export interface SoccerTeam {
  teamId: string;
  name: string;
  abbreviation: string;
  logoUrl: string | null;
}

interface RawTeamsResponse {
  sports?: Array<{
    leagues?: Array<{
      teams?: Array<{
        team: {
          id: string;
          displayName: string;
          abbreviation: string;
          logos?: Array<{ href: string; rel: string[] }>;
        };
      }>;
    }>;
  }>;
}

export async function fetchAllTeams(league: SoccerLeague): Promise<SoccerTeam[]> {
  const cacheKey = `soccer:teams:${league}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 60 * 60_000) {
    return JSON.parse(cached.payload) as SoccerTeam[];
  }

  const slug = ESPN_LEAGUE_SLUG[league];
  let res: Response;
  try {
    res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/teams?limit=50`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return cached ? (JSON.parse(cached.payload) as SoccerTeam[]) : [];
  }
  if (!res.ok) return cached ? (JSON.parse(cached.payload) as SoccerTeam[]) : [];

  const json = (await res.json()) as RawTeamsResponse;
  const raw = json.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const teams: SoccerTeam[] = raw.map((t) => ({
    teamId: t.team.id,
    name: t.team.displayName,
    abbreviation: t.team.abbreviation,
    logoUrl: t.team.logos?.find((l) => l.rel.includes('default'))?.href ?? t.team.logos?.[0]?.href ?? null,
  }));

  await writeSnapshotCache(cacheKey, JSON.stringify(teams));
  return teams;
}

/** Cheap `abbr -> logoUrl` lookup for anywhere that only has a team abbreviation on hand (candidates, roster entries) — cached the same 24h as `fetchAllTeams` itself. */
export async function soccerTeamLogoByAbbr(league: SoccerLeague): Promise<Map<string, string>> {
  const teams = await fetchAllTeams(league);
  return new Map(teams.filter((t) => t.logoUrl).map((t) => [t.abbreviation, t.logoUrl as string]));
}

// ---------------------------------------------------------------------------
// Standings — real gap closed per docs/soccer-gameplan-2026-08-22.md §11.
//
// EPL and MLS have genuinely different response shapes: EPL's standings
// response has one `children[0]` (a single table), MLS has two — Eastern
// and Western conference — confirmed live both ways this session. Don't
// assume `children[0]` covers every league; flatten however many groups
// come back.
// ---------------------------------------------------------------------------

export interface SoccerStanding {
  teamId: string;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  goalDifferential: number;
  gamesPlayed: number;
  rank: number;
  groupName: string | null;
}

interface RawStandingsResponse {
  children?: Array<{
    name?: string;
    standings?: {
      entries?: Array<{
        team: { id: string };
        stats?: Array<{ name: string; value: number }>;
      }>;
    };
  }>;
}

function statValue(stats: Array<{ name: string; value: number }> | undefined, name: string): number {
  return stats?.find((s) => s.name === name)?.value ?? 0;
}

export async function fetchStandings(league: SoccerLeague): Promise<SoccerStanding[]> {
  const cacheKey = `soccer:standings:${league}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 30 * 60_000) {
    return JSON.parse(cached.payload) as SoccerStanding[];
  }

  const slug = ESPN_LEAGUE_SLUG[league];
  let res: Response;
  try {
    res = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${slug}/standings`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return cached ? (JSON.parse(cached.payload) as SoccerStanding[]) : [];
  }
  if (!res.ok) return cached ? (JSON.parse(cached.payload) as SoccerStanding[]) : [];

  const json = (await res.json()) as RawStandingsResponse;
  const standings: SoccerStanding[] = [];
  for (const group of json.children ?? []) {
    for (const entry of group.standings?.entries ?? []) {
      standings.push({
        teamId: entry.team.id,
        wins: statValue(entry.stats, 'wins'),
        losses: statValue(entry.stats, 'losses'),
        draws: statValue(entry.stats, 'ties'),
        points: statValue(entry.stats, 'points'),
        goalDifferential: statValue(entry.stats, 'pointDifferential'),
        gamesPlayed: statValue(entry.stats, 'gamesPlayed'),
        rank: statValue(entry.stats, 'rank'),
        groupName: group.name ?? null,
      });
    }
  }

  await writeSnapshotCache(cacheKey, JSON.stringify(standings));
  return standings;
}

// ---------------------------------------------------------------------------
// Game summary — single-book pregame line + live in-game state, both
// confirmed live per docs/soccer-gameplan-2026-08-22.md §11 (real DraftKings
// moneyline/spread/total on both a completed and an upcoming EPL match).
// ---------------------------------------------------------------------------

export interface SoccerPregameLine {
  book: string;
  moneylineHome: number | null;
  moneylineAway: number | null;
  moneylineDraw: number | null;
  spread: number | null;
  overUnder: number | null;
  overOdds: number | null;
  underOdds: number | null;
}

export interface SoccerLiveEvent {
  clock: string | null;
  text: string;
  type: string | null;
}

export interface SoccerGameMeta {
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

export interface SoccerGameSummary {
  game: SoccerGameMeta | null;
  pregameLine: SoccerPregameLine | null;
  keyEvents: SoccerLiveEvent[];
  /** Per-player match stats, keyed by ESPN athlete id — e.g. `{"284199": [{name: "totalGoals", value: 1}, ...]}`. Real per-match history source for a completed match (see adapter.ts's history-building, §11.2 item 7). */
  playerStatsByAthleteId: Record<string, Array<{ name: string; value: number }>>;
}

interface RawSummaryResponse {
  header?: {
    competitions?: Array<{
      date?: string;
      status?: { type?: { completed?: boolean; state?: string; shortDetail?: string } };
      competitors?: Array<{
        homeAway: 'home' | 'away';
        score?: string;
        team: { id: string; displayName: string; abbreviation: string; logos?: Array<{ href: string }> };
      }>;
    }>;
  };
  odds?: Array<{
    provider?: { name?: string };
    homeTeamOdds?: { moneyLine?: number };
    awayTeamOdds?: { moneyLine?: number };
    drawOdds?: { moneyLine?: number };
    spread?: number;
    overUnder?: number;
    overOdds?: number;
    underOdds?: number;
  }>;
  keyEvents?: Array<{ clock?: { displayValue?: string }; text?: string; type?: { text?: string } }>;
  rosters?: Array<{
    roster?: Array<{
      athlete: { id: string };
      stats?: Array<{ name: string; value: number }>;
    }>;
  }>;
}

export async function fetchGameSummary(league: SoccerLeague, eventId: string): Promise<SoccerGameSummary> {
  const slug = ESPN_LEAGUE_SLUG[league];
  const empty: SoccerGameSummary = { game: null, pregameLine: null, keyEvents: [], playerStatsByAthleteId: {} };
  let res: Response;
  try {
    res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${eventId}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return empty;
  }
  if (!res.ok) return empty;

  const json = (await res.json()) as RawSummaryResponse;

  const comp = json.header?.competitions?.[0];
  const homeC = comp?.competitors?.find((c) => c.homeAway === 'home');
  const awayC = comp?.competitors?.find((c) => c.homeAway === 'away');
  const statusType = comp?.status?.type;
  const game: SoccerGameMeta | null =
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
  const pregameLine: SoccerPregameLine | null = rawOdds
    ? {
        book: rawOdds.provider?.name ?? 'Unknown',
        moneylineHome: rawOdds.homeTeamOdds?.moneyLine ?? null,
        moneylineAway: rawOdds.awayTeamOdds?.moneyLine ?? null,
        moneylineDraw: rawOdds.drawOdds?.moneyLine ?? null,
        spread: rawOdds.spread ?? null,
        overUnder: rawOdds.overUnder ?? null,
        overOdds: rawOdds.overOdds ?? null,
        underOdds: rawOdds.underOdds ?? null,
      }
    : null;

  const keyEvents: SoccerLiveEvent[] = (json.keyEvents ?? []).map((e) => ({
    clock: e.clock?.displayValue ?? null,
    text: e.text ?? '',
    type: e.type?.text ?? null,
  }));

  const playerStatsByAthleteId: Record<string, Array<{ name: string; value: number }>> = {};
  for (const teamRoster of json.rosters ?? []) {
    for (const p of teamRoster.roster ?? []) {
      if (p.stats) playerStatsByAthleteId[p.athlete.id] = p.stats;
    }
  }

  return { game, pregameLine, keyEvents, playerStatsByAthleteId };
}
