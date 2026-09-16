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

import { seasonForDate } from '@/lib/sports/shared/season';
import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';

const BASE = 'https://api-web.nhle.com/v1';
const STATS_BASE = 'https://api.nhle.com/stats/rest/en';

/** NHL season id format: concatenated start+end years ("20252026" for the 2025-26 season). Season runs Oct-June; before October, the just-completed season is still the most current real data available (same "between seasons" state as NBA/CFB this session). */
export function currentNhlSeason(now: Date = new Date()): string {
  // NHL's API wants the two years concatenated ("20252026"), which is a
  // FORMAT this function still owns — but WHICH season it is now comes from
  // the one convention. R2: delegates to the one season convention (`lib/sports/shared/season.ts`) rather than re-deriving it. Same value; the boundary is now read on the Eastern date rather than UTC, which is the same rule R1d applied to ESPN's date ranges.
  const startYear = seasonForDate('nhl', now);
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
  // v2 (R7.3): the v1 map sent Utah to its old id, so the stored map is not reused.
  const cacheKey = 'nhl:team-ids:v2';
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 60 * 60_000) {
    return new Map(JSON.parse(cached.payload) as Array<[string, number]>);
  }
  const data = await fetchJson<{ data: RawStatsTeam[] }>(`${STATS_BASE}/team`);
  const rows = data?.data ?? [];
  if (rows.length === 0) {
    return cached ? new Map(JSON.parse(cached.payload) as Array<[string, number]>) : new Map();
  }
  // A tricode can name two franchises: `UTA` is 59 (Utah Hockey Club, 2024-25)
  // and 68 (Utah Mammoth, 2025-26 on). Whichever the API listed last used to
  // win, and it was 59 — while every 2025-26 table (`player_game_history`,
  // `team_game_production`) stores the Mammoth as 68, so its team page read
  // the wrong franchise (R7.3). The newest id is the current club.
  const map = new Map([...rows].sort((a, b) => a.id - b.id).map((t) => [t.triCode, t.id] as [string, number]));
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

// Declared in `gameStates.ts` so client-reachable code can ask the same
// question without pulling this module's `pg` into the browser bundle (R6.5).
export { isNhlGameCompleted, isNhlGameLive } from './gameStates';

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

// ---------------------------------------------------------------------------
// R4 step 4 — two endpoints new to this app. Raw JSON; the pure parsers are in
// `apiWebParsers.ts`. Uncached here: routes that serve them cache the PARSED
// result (a season line changes nightly; a live game's play-by-play changes
// every event), the same split as the MLB live feed.
// ---------------------------------------------------------------------------

/** Official season and career totals for one skater or goalie (`parsePlayerLanding`). */
export async function fetchPlayerLanding(playerId: string | number): Promise<unknown | null> {
  return fetchJson<unknown>(`${BASE}/player/${encodeURIComponent(String(playerId))}/landing`);
}

/** Every event with rink coordinates, shooter, goalie and situation (`parsePlayByPlay`). */
export async function fetchPlayByPlay(gameId: string | number): Promise<unknown | null> {
  return fetchJson<unknown>(`${BASE}/gamecenter/${encodeURIComponent(String(gameId))}/play-by-play`);
}

// ---------------------------------------------------------------------------
// Team page (R7.3)
// ---------------------------------------------------------------------------

export interface NhlClubGame {
  id: string;
  start: string;
  /** api-web's own date for the game (Eastern), never the UTC one. */
  date: string;
  postseason: boolean;
  home: { id: string; abbr: string; name: string; logoUrl: string | null; score: number | null };
  away: { id: string; abbr: string; name: string; logoUrl: string | null; score: number | null };
  state: 'final' | 'live' | 'scheduled' | 'postponed';
  /** "OT" or "SO" from `gameOutcome.lastPeriodType`; null in regulation. */
  extra: string | null;
  label: string | null;
  venue: string | null;
  neutral: boolean;
}

type RawClubTeam = { id: number; abbrev: string; commonName?: { default: string }; placeName?: { default: string }; logo?: string; score?: number };
type RawClubGame = {
  id: number;
  gameDate: string;
  gameType: number;
  gameState: string;
  gameScheduleState?: string;
  startTimeUTC: string;
  neutralSite?: boolean;
  venue?: { default?: string };
  gameOutcome?: { lastPeriodType?: string };
  seriesStatus?: { round?: number; seriesTitle?: string; gameNumberOfSeries?: number };
  awayTeam: RawClubTeam;
  homeTeam: RawClubTeam;
};

const clubSeasonCache = new Map<string, { at: number; games: NhlClubGame[] }>();

/**
 * One club's season from api-web's `club-schedule-season`, regular season
 * (`gameType` 2) and playoffs (3) kept apart and preseason (1) dropped —
 * R7-C1. A loss past regulation carries `lastPeriodType` OT or SO, which is
 * what makes a record W-L-OTL: the Maple Leafs' 2025-26 is 59 regulation, 18
 * overtime and 5 shootout games, 32-36-14 (measured 2026-09-16), where
 * `game_result` read 84 games and 32-52.
 *
 * `fetchTeamSeasonSchedule` above keeps its own shape for its existing callers.
 */
export async function fetchClubSeasonGames(abbrev: string, seasonKey: string, finished: boolean): Promise<NhlClubGame[]> {
  const key = `${abbrev}:${seasonKey}`;
  const hit = clubSeasonCache.get(key);
  if (hit && Date.now() - hit.at < (finished ? 7 * 24 * 60 * 60_000 : 30 * 60_000)) return hit.games;
  const data = await fetchJson<{ games: RawClubGame[] }>(`${BASE}/club-schedule-season/${abbrev}/${seasonKey}`);
  if (!data) return hit?.games ?? [];
  const side = (t: RawClubTeam) => ({ id: String(t.id), abbr: t.abbrev, name: teamDisplayName(t), logoUrl: t.logo ?? null, score: t.score ?? null });
  const games = data.games
    .filter((g) => g.gameType === 2 || g.gameType === 3)
    .map((g): NhlClubGame => {
      const st = g.gameState;
      const state: NhlClubGame['state'] = /PPD|CNCL|SUSP/.test(g.gameScheduleState ?? '') ? 'postponed' : st === 'OFF' || st === 'FINAL' ? 'final' : st === 'LIVE' || st === 'CRIT' ? 'live' : 'scheduled';
      const period = g.gameOutcome?.lastPeriodType;
      return {
        id: String(g.id),
        start: g.startTimeUTC,
        date: g.gameDate,
        postseason: g.gameType === 3,
        home: side(g.homeTeam),
        away: side(g.awayTeam),
        state,
        extra: state === 'final' && (period === 'OT' || period === 'SO') ? period : null,
        label: g.gameType === 3 ? (g.seriesStatus?.round ? `Round ${g.seriesStatus.round}${g.seriesStatus.gameNumberOfSeries ? ` G${g.seriesStatus.gameNumberOfSeries}` : ''}` : 'Playoffs') : null,
        venue: g.venue?.default ?? null,
        neutral: g.neutralSite === true,
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));
  clubSeasonCache.set(key, { at: Date.now(), games });
  return games;
}

export interface NhlStandingRow {
  teamId: string;
  abbr: string;
  name: string;
  logoUrl: string | null;
  division: string;
  conference: string;
  divisionSequence: number;
  conferenceSequence: number;
  gp: number;
  w: number;
  l: number;
  otl: number;
  pts: number;
  pointPctg: number;
  rw: number;
  gf: number;
  ga: number;
  home: string;
  road: string;
  l10: string;
  streak: string;
}

const nhlStandingsCache = new Map<string, { at: number; rows: NhlStandingRow[] }>();

/**
 * A season's standings. api-web's `standings/now` only ever answers the
 * current table, so a finished season is read at its own `standingsEnd`
 * (from `standings-season`: 2026-04-17 for 2025-26). A season that has not
 * started returns nothing rather than last season's table under its name.
 */
export async function fetchNhlSeasonStandings(seasonKey: string): Promise<NhlStandingRow[]> {
  const hit = nhlStandingsCache.get(seasonKey);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.rows;
  const seasons = await fetchJson<{ seasons: Array<{ id: number; standingsStart: string; standingsEnd: string }> }>(`${BASE}/standings-season`);
  const s = seasons?.seasons.find((x) => String(x.id) === seasonKey);
  if (!s) return hit?.rows ?? [];
  const today = new Date().toISOString().slice(0, 10);
  if (today < s.standingsStart) return [];
  const date = today > s.standingsEnd ? s.standingsEnd : 'now';
  const [data, idMap] = await Promise.all([
    fetchJson<{ standings: Array<Record<string, unknown> & { teamAbbrev: { default: string }; teamName: { default: string } }> }>(`${BASE}/standings/${date}`),
    fetchTeamIdMap(),
  ]);
  if (!data) return hit?.rows ?? [];
  const n = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0));
  const rows = data.standings.map((t) => ({
    teamId: String(idMap.get(t.teamAbbrev.default) ?? t.teamAbbrev.default),
    abbr: t.teamAbbrev.default,
    name: t.teamName.default,
    logoUrl: (t.teamLogo as string) ?? null,
    division: String(t.divisionName ?? ''),
    conference: String(t.conferenceName ?? ''),
    divisionSequence: n(t.divisionSequence),
    conferenceSequence: n(t.conferenceSequence),
    gp: n(t.gamesPlayed),
    w: n(t.wins),
    l: n(t.losses),
    otl: n(t.otLosses),
    pts: n(t.points),
    pointPctg: n(t.pointPctg),
    rw: n(t.regulationWins),
    gf: n(t.goalFor),
    ga: n(t.goalAgainst),
    home: `${n(t.homeWins)}-${n(t.homeLosses)}-${n(t.homeOtLosses)}`,
    road: `${n(t.roadWins)}-${n(t.roadLosses)}-${n(t.roadOtLosses)}`,
    l10: `${n(t.l10Wins)}-${n(t.l10Losses)}-${n(t.l10OtLosses)}`,
    streak: `${String(t.streakCode ?? '')}${t.streakCount ?? ''}`,
  }));
  nhlStandingsCache.set(seasonKey, { at: Date.now(), rows });
  return rows;
}

const nhlNameCache = new Map<string, { name: string; position: string | null; headshotUrl: string | null }>();

/**
 * Names, positions and headshots for NHL player ids: the club's roster for
 * that season first, then each player's landing for anyone it lacks. A
 * season roster is the end-of-season one — the Maple Leafs' 2025-26 lists 18
 * of the 38 players who appear in its game logs (measured 2026-09-16).
 */
export async function nhlPlayerNames(abbrev: string, seasonKey: string, ids: string[]): Promise<Map<string, { name: string; position: string | null; headshotUrl: string | null }>> {
  if (ids.some((id) => !nhlNameCache.has(id))) {
    const roster = await fetchJson<{ forwards?: RawRosterPlayer[]; defensemen?: RawRosterPlayer[]; goalies?: RawRosterPlayer[] }>(`${BASE}/roster/${abbrev}/${seasonKey}`);
    for (const p of [...(roster?.forwards ?? []), ...(roster?.defensemen ?? []), ...(roster?.goalies ?? [])]) {
      nhlNameCache.set(String(p.id), { name: `${p.firstName.default} ${p.lastName.default}`, position: p.positionCode ?? null, headshotUrl: p.headshot ?? null });
    }
  }
  const missing = ids.filter((id) => !nhlNameCache.has(id));
  for (let i = 0; i < missing.length; i += 8) {
    await Promise.all(
      missing.slice(i, i + 8).map(async (id) => {
        const l = (await fetchPlayerLanding(id)) as { firstName?: { default?: string }; lastName?: { default?: string }; position?: string; headshot?: string } | null;
        if (l?.firstName?.default) nhlNameCache.set(id, { name: `${l.firstName.default} ${l.lastName?.default ?? ''}`.trim(), position: l.position ?? null, headshotUrl: l.headshot ?? null });
      }),
    );
  }
  const out = new Map<string, { name: string; position: string | null; headshotUrl: string | null }>();
  for (const id of ids) {
    const v = nhlNameCache.get(id);
    if (v) out.set(id, v);
  }
  return out;
}
