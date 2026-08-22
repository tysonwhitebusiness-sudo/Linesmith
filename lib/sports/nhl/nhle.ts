/**
 * NHL's real, official, modern public API (`api-web.nhle.com` + the
 * secondary `api.nhle.com/stats/rest` REST API) — per
 * docs/multi-sport-expansion-audit-2026-08-22.md §3, the strongest source
 * of the four new sports: no ESPN, no third party, the league's own data.
 *
 * Genuinely different shape from every other sport built this session:
 * NHL's API is keyed by team ABBREVIATION (`/roster/COL/current`), not a
 * numeric ESPN-style id — `/standings/now` never exposes a numeric team
 * id at all. Real numeric ids (matching the well-known NHL franchise id
 * scheme, e.g. Colorado=21) live in the separate `/stats/rest/en/team`
 * endpoint, joined here by triCode against the 32 real current teams
 * `/standings/now` lists (that stats endpoint includes ~30 defunct/
 * historical franchises too — filtered out by only keeping ids whose
 * triCode is a real current team).
 *
 * No pregame betting line source: unlike ESPN's summary endpoint (used
 * for soccer/CFB/NBA), NHL's own API carries no odds at all, and cross-
 * referencing to ESPN's own event-id space (a different id entirely from
 * NHL's own gameId) to borrow just its odds would be a fragile, error-
 * prone join for one field — skipped. NHL's real hero/score/status data
 * comes entirely from this API on its own, which is genuinely richer for
 * everything except pregame odds; `pregameLine` stays a real, honest
 * `null` throughout this sport rather than attempting that join.
 */

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';

const BASE = 'https://api-web.nhle.com/v1';
const STATS_BASE = 'https://api.nhle.com/stats/rest/en';

/** NHL season id format: concatenated start+end years ("20252026" for the 2025-26 season). Season runs Oct-June; before October, the just-completed season is still the most current real data available (same "between seasons" state as NBA/CFB this session). */
export function currentNhlSeason(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed, 9 = October
  const startYear = month >= 9 ? year : year - 1;
  return `${startYear}${startYear + 1}`;
}

async function fetchJson<T>(url: string, timeoutMs = 15_000): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface RawStatsTeam {
  id: number;
  triCode: string;
}

async function fetchTeamIdMap(): Promise<Map<string, number>> {
  const cacheKey = 'nhl:team-ids';
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 60 * 60_000) {
    return new Map(JSON.parse(cached.payload) as Array<[string, number]>);
  }
  const data = await fetchJson<{ data: RawStatsTeam[] }>(`${STATS_BASE}/team`);
  const rows = data?.data ?? [];
  if (rows.length === 0) {
    return cached ? new Map(JSON.parse(cached.payload) as Array<[string, number]>) : new Map();
  }
  const map = new Map(rows.map((t) => [t.triCode, t.id] as [string, number]));
  await writeSnapshotCache(cacheKey, JSON.stringify([...map.entries()]));
  return map;
}

export interface NhlTeam {
  teamId: string;
  abbreviation: string;
  name: string;
  logoUrl: string | null;
  conference: string | null;
}

export interface NhlStanding {
  teamId: string;
  abbreviation: string;
  wins: number;
  losses: number;
  otLosses: number;
  points: number;
  groupName: string | null;
}

interface RawStandingsTeam {
  teamAbbrev: { default: string };
  teamName: { default: string };
  teamLogo: string;
  wins: number;
  losses: number;
  otLosses: number;
  points: number;
  conferenceName: string;
}

async function fetchStandingsRaw(): Promise<RawStandingsTeam[]> {
  const cacheKey = 'nhl:standings';
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 30 * 60_000) {
    return JSON.parse(cached.payload) as RawStandingsTeam[];
  }
  const data = await fetchJson<{ standings: RawStandingsTeam[] }>(`${BASE}/standings/now`);
  if (!data) return cached ? (JSON.parse(cached.payload) as RawStandingsTeam[]) : [];
  await writeSnapshotCache(cacheKey, JSON.stringify(data.standings));
  return data.standings;
}

/** Real current 32 teams, joined with real numeric franchise ids (see file header). */
export async function fetchAllTeams(): Promise<NhlTeam[]> {
  const [standings, idMap] = await Promise.all([fetchStandingsRaw(), fetchTeamIdMap()]);
  return standings.map((t) => ({
    teamId: String(idMap.get(t.teamAbbrev.default) ?? t.teamAbbrev.default),
    abbreviation: t.teamAbbrev.default,
    name: t.teamName.default,
    logoUrl: t.teamLogo ?? null,
    conference: t.conferenceName ?? null,
  }));
}

export async function fetchStandings(): Promise<NhlStanding[]> {
  const [standings, idMap] = await Promise.all([fetchStandingsRaw(), fetchTeamIdMap()]);
  return standings.map((t) => ({
    teamId: String(idMap.get(t.teamAbbrev.default) ?? t.teamAbbrev.default),
    abbreviation: t.teamAbbrev.default,
    wins: t.wins,
    losses: t.losses,
    otLosses: t.otLosses,
    points: t.points,
    groupName: t.conferenceName ?? null,
  }));
}

export async function abbrevForTeamId(teamId: string): Promise<string | null> {
  const teams = await fetchAllTeams();
  return teams.find((t) => t.teamId === teamId)?.abbreviation ?? null;
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export interface NhlRosterPlayer {
  subjectId: string;
  fullName: string;
  position: string | null;
  headshotUrl: string | null;
}

interface RawRosterPlayer {
  id: number;
  firstName: { default: string };
  lastName: { default: string };
  positionCode: string;
  headshot: string;
}

export async function fetchTeamRoster(abbrev: string): Promise<NhlRosterPlayer[]> {
  const cacheKey = `nhl:roster:${abbrev}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 60 * 60_000) {
    return JSON.parse(cached.payload) as NhlRosterPlayer[];
  }
  const data = await fetchJson<{ forwards: RawRosterPlayer[]; defensemen: RawRosterPlayer[]; goalies: RawRosterPlayer[] }>(
    `${BASE}/roster/${abbrev}/current`,
  );
  if (!data) return cached ? (JSON.parse(cached.payload) as NhlRosterPlayer[]) : [];
  const all = [...data.forwards, ...data.defensemen, ...data.goalies];
  const roster: NhlRosterPlayer[] = all.map((p) => ({
    subjectId: `nhl:${p.id}`,
    fullName: `${p.firstName.default} ${p.lastName.default}`,
    position: p.positionCode ?? null,
    headshotUrl: p.headshot ?? null,
  }));
  await writeSnapshotCache(cacheKey, JSON.stringify(roster));
  return roster;
}

// ---------------------------------------------------------------------------
// Schedule + games
// ---------------------------------------------------------------------------

export interface NhlGame {
  gameId: string;
  date: string;
  homeAbbr: string;
  homeTeamName: string;
  homeTeamId: string;
  homeScore: number | null;
  awayAbbr: string;
  awayTeamName: string;
  awayTeamId: string;
  awayScore: number | null;
  gameState: string;
}

interface RawScheduleGame {
  id: number;
  gameDate: string;
  gameType: number;
  gameState: string;
  startTimeUTC: string;
  awayTeam: { id: number; abbrev: string; commonName?: { default: string }; placeName?: { default: string }; score?: number };
  homeTeam: { id: number; abbrev: string; commonName?: { default: string }; placeName?: { default: string }; score?: number };
}

function teamDisplayName(t: RawScheduleGame['awayTeam']): string {
  return [t.placeName?.default, t.commonName?.default].filter(Boolean).join(' ') || t.abbrev;
}

/** Every real regular-season game (gameType 2) for one team's season, both past and future. */
export async function fetchTeamSeasonSchedule(abbrev: string, season: string): Promise<NhlGame[]> {
  const cacheKey = `nhl:schedule:${season}:${abbrev}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 6 * 60 * 60_000) {
    return JSON.parse(cached.payload) as NhlGame[];
  }
  const data = await fetchJson<{ games: RawScheduleGame[] }>(`${BASE}/club-schedule-season/${abbrev}/${season}`);
  if (!data) return cached ? (JSON.parse(cached.payload) as NhlGame[]) : [];
  const games: NhlGame[] = data.games
    .filter((g) => g.gameType === 2)
    .map((g) => ({
      gameId: String(g.id),
      date: g.startTimeUTC,
      homeAbbr: g.homeTeam.abbrev,
      homeTeamName: teamDisplayName(g.homeTeam),
      homeTeamId: String(g.homeTeam.id),
      homeScore: g.homeTeam.score ?? null,
      awayAbbr: g.awayTeam.abbrev,
      awayTeamName: teamDisplayName(g.awayTeam),
      awayTeamId: String(g.awayTeam.id),
      awayScore: g.awayTeam.score ?? null,
      gameState: g.gameState,
    }));
  await writeSnapshotCache(cacheKey, JSON.stringify(games));
  return games;
}

interface RawWeekSchedule {
  gameWeek: Array<{ date: string; games: RawScheduleGame[] }>;
}

/**
 * Real slate-wide schedule for the 7-day window starting `fromDate`
 * (defaults to today) — NHL's `/v1/schedule/{date}` endpoint returns a
 * whole week per call, unlike the per-team `/club-schedule-season`
 * endpoint above; this is the real "which games exist right now" source
 * (odds/game-context resolution), the per-team one is for real per-game
 * history (adapter.ts).
 */
export async function fetchWeekSchedule(fromDate?: string): Promise<NhlGame[]> {
  const dateParam = fromDate ?? new Date().toISOString().slice(0, 10);
  const cacheKey = `nhl:week-schedule:${dateParam}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 30 * 60_000) {
    return JSON.parse(cached.payload) as NhlGame[];
  }
  const data = await fetchJson<RawWeekSchedule>(`${BASE}/schedule/${dateParam}`);
  if (!data) return cached ? (JSON.parse(cached.payload) as NhlGame[]) : [];
  const games: NhlGame[] = data.gameWeek
    .flatMap((day) => day.games)
    .filter((g) => g.gameType === 2)
    .map((g) => ({
      gameId: String(g.id),
      date: g.startTimeUTC,
      homeAbbr: g.homeTeam.abbrev,
      homeTeamName: teamDisplayName(g.homeTeam),
      homeTeamId: String(g.homeTeam.id),
      homeScore: g.homeTeam.score ?? null,
      awayAbbr: g.awayTeam.abbrev,
      awayTeamName: teamDisplayName(g.awayTeam),
      awayTeamId: String(g.awayTeam.id),
      awayScore: g.awayTeam.score ?? null,
      gameState: g.gameState,
    }));
  await writeSnapshotCache(cacheKey, JSON.stringify(games));
  return games;
}

export function isNhlGameCompleted(gameState: string): boolean {
  return gameState === 'OFF' || gameState === 'FINAL';
}
export function isNhlGameLive(gameState: string): boolean {
  return gameState === 'LIVE' || gameState === 'CRIT';
}

// ---------------------------------------------------------------------------
// Boxscore — real per-player game stats
// ---------------------------------------------------------------------------

export interface NhlSkaterGameStat {
  playerId: number;
  name: string;
  position: string;
  goals: number;
  assists: number;
  points: number;
  shots: number;
  hits: number;
  blockedShots: number;
}
export interface NhlGoalieGameStat {
  playerId: number;
  name: string;
  saves: number;
  goalsAgainst: number;
}
export interface NhlBoxscore {
  gameId: string;
  gameDate: string;
  gameState: string;
  homeTeamId: string;
  homeAbbr: string;
  homeScore: number | null;
  awayTeamId: string;
  awayAbbr: string;
  awayScore: number | null;
  skatersByTeam: Record<string, NhlSkaterGameStat[]>;
  goaliesByTeam: Record<string, NhlGoalieGameStat[]>;
}

interface RawBoxscoreSkater {
  playerId: number;
  name: { default: string };
  position: string;
  goals: number;
  assists: number;
  points: number;
  sog: number;
  hits: number;
  blockedShots: number;
}
interface RawBoxscoreGoalie {
  playerId: number;
  name: { default: string };
  saves?: number;
  goalsAgainst?: number;
}
interface RawBoxscoreTeamStats {
  forwards?: RawBoxscoreSkater[];
  defense?: RawBoxscoreSkater[];
  goalies?: RawBoxscoreGoalie[];
}
interface RawBoxscore {
  id: number;
  gameDate: string;
  gameState: string;
  awayTeam: { id: number; abbrev: string; score?: number };
  homeTeam: { id: number; abbrev: string; score?: number };
  playerByGameStats?: { awayTeam: RawBoxscoreTeamStats; homeTeam: RawBoxscoreTeamStats };
}

export async function fetchBoxscore(gameId: string): Promise<NhlBoxscore | null> {
  const cacheKey = `nhl:boxscore:${gameId}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 6 * 60 * 60_000) {
    return JSON.parse(cached.payload) as NhlBoxscore;
  }
  const data = await fetchJson<RawBoxscore>(`${BASE}/gamecenter/${gameId}/boxscore`);
  if (!data) return cached ? (JSON.parse(cached.payload) as NhlBoxscore) : null;

  const toSkaters = (t: RawBoxscoreTeamStats | undefined): NhlSkaterGameStat[] =>
    [...(t?.forwards ?? []), ...(t?.defense ?? [])].map((p) => ({
      playerId: p.playerId,
      name: p.name.default,
      position: p.position,
      goals: p.goals ?? 0,
      assists: p.assists ?? 0,
      points: p.points ?? 0,
      shots: p.sog ?? 0,
      hits: p.hits ?? 0,
      blockedShots: p.blockedShots ?? 0,
    }));
  const toGoalies = (t: RawBoxscoreTeamStats | undefined): NhlGoalieGameStat[] =>
    (t?.goalies ?? []).map((p) => ({
      playerId: p.playerId,
      name: p.name.default,
      saves: p.saves ?? 0,
      goalsAgainst: p.goalsAgainst ?? 0,
    }));

  const box: NhlBoxscore = {
    gameId: String(data.id),
    gameDate: data.gameDate,
    gameState: data.gameState,
    homeTeamId: String(data.homeTeam.id),
    homeAbbr: data.homeTeam.abbrev,
    homeScore: data.homeTeam.score ?? null,
    awayTeamId: String(data.awayTeam.id),
    awayAbbr: data.awayTeam.abbrev,
    awayScore: data.awayTeam.score ?? null,
    skatersByTeam: {
      [data.homeTeam.abbrev]: toSkaters(data.playerByGameStats?.homeTeam),
      [data.awayTeam.abbrev]: toSkaters(data.playerByGameStats?.awayTeam),
    },
    goaliesByTeam: {
      [data.homeTeam.abbrev]: toGoalies(data.playerByGameStats?.homeTeam),
      [data.awayTeam.abbrev]: toGoalies(data.playerByGameStats?.awayTeam),
    },
  };
  await writeSnapshotCache(cacheKey, JSON.stringify(box));
  return box;
}
