/**
 * American Soccer Analysis — MLS's real per-match player history source,
 * per docs/soccer-gameplan-2026-08-22.md §11. Mirrors `understat.ts`'s
 * shape (`currentAsaSeason`/`resolveAsaPlayer`/`fetchAsaPlayerMatches`) but
 * ASA has no single "player match log" endpoint like Understat's
 * `getPlayerData/{id}` — real per-match goals/shots/assists have to be
 * aggregated ourselves from `games/shots`, which returns every shot event
 * in one match (shooter, assist, goal flag) for both teams. That per-game
 * shots response is cached per `game_id`, so it's naturally shared across
 * every player on both teams in that match, not refetched per subject.
 *
 * No auth, no cookie-priming — confirmed live this session, same as
 * Understat: `app.americansocceranalysis.com/api/v1/mls/*` returns real
 * JSON to a plain unauthenticated request.
 */

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { normalizeName, scoreNameMatch } from '@/lib/odds/screenshotImport';

const BASE = 'https://app.americansocceranalysis.com/api/v1';

/** ASA's season_name is the real calendar year the MLS season is played in (no split-year convention, unlike Understat's EPL). */
export function currentAsaSeason(now: Date = new Date()): string {
  return String(now.getUTCFullYear());
}

async function fetchJson<T>(path: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
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

interface RawAsaTeam {
  team_id: string;
  team_name: string;
  team_short_name: string;
  team_abbreviation: string;
}

async function fetchTeams(): Promise<RawAsaTeam[]> {
  const cacheKey = 'soccer:asa:teams';
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 60 * 60_000) {
    return JSON.parse(cached.payload) as RawAsaTeam[];
  }
  const data = await fetchJson<RawAsaTeam[]>('/mls/teams');
  if (!data) return cached ? (JSON.parse(cached.payload) as RawAsaTeam[]) : [];
  await writeSnapshotCache(cacheKey, JSON.stringify(data));
  return data;
}

interface RawAsaPlayer {
  player_id: string;
  player_name: string;
  season_name?: string[] | Record<string, never>;
}

/** All-time roster list — no season filter (that endpoint 500s), so this is fetched once and cached long, then narrowed by each player's own `season_name` array. */
async function fetchAllPlayers(): Promise<RawAsaPlayer[]> {
  const cacheKey = 'soccer:asa:players:all';
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 60 * 60_000) {
    return JSON.parse(cached.payload) as RawAsaPlayer[];
  }
  const data = await fetchJson<RawAsaPlayer[]>('/mls/players');
  if (!data) return cached ? (JSON.parse(cached.payload) as RawAsaPlayer[]) : [];
  await writeSnapshotCache(cacheKey, JSON.stringify(data));
  return data;
}

interface RawAsaPlayerXgoals {
  player_id: string;
  team_id: string | string[];
  general_position?: string;
  minutes_played: number;
  shots: number;
  shots_on_target: number;
  goals: number;
  xgoals: number;
  key_passes: number;
  primary_assists: number;
  xassists: number;
}

async function fetchSeasonXgoals(season: string): Promise<RawAsaPlayerXgoals[]> {
  const cacheKey = `soccer:asa:xgoals:${season}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 6 * 60 * 60_000) {
    return JSON.parse(cached.payload) as RawAsaPlayerXgoals[];
  }
  const data = await fetchJson<RawAsaPlayerXgoals[]>(`/mls/players/xgoals?season_name=${season}`);
  if (!data) return cached ? (JSON.parse(cached.payload) as RawAsaPlayerXgoals[]) : [];
  await writeSnapshotCache(cacheKey, JSON.stringify(data));
  return data;
}

export interface AsaSeasonStats {
  asaPlayerId: string;
  teamId: string;
  minutesPlayed: number;
  goals: number;
  xgoals: number;
  shots: number;
  shotsOnTarget: number;
  assists: number;
  xassists: number;
  keyPasses: number;
  position: string;
}

/** `subjectName -> ASA season stats`, joining the all-time name list with this season's real per-player aggregate (which is the only place team_id lives). A player traded mid-season carries an array `team_id` from ASA — that case takes the first (most recent-listed) team rather than guessing further; real trades are rare enough this doesn't need to be exact. */
function buildAsaNameIndex(players: RawAsaPlayer[], xgoals: RawAsaPlayerXgoals[]): Map<string, AsaSeasonStats & { name: string }> {
  const xgoalsByPlayerId = new Map(xgoals.map((x) => [x.player_id, x]));
  const index = new Map<string, AsaSeasonStats & { name: string }>();
  for (const p of players) {
    const stats = xgoalsByPlayerId.get(p.player_id);
    if (!stats) continue;
    const teamId = Array.isArray(stats.team_id) ? stats.team_id[0] : stats.team_id;
    index.set(normalizeName(p.player_name), {
      asaPlayerId: p.player_id,
      teamId,
      name: p.player_name,
      minutesPlayed: stats.minutes_played,
      goals: stats.goals,
      xgoals: stats.xgoals,
      shots: stats.shots,
      shotsOnTarget: stats.shots_on_target,
      assists: stats.primary_assists,
      xassists: stats.xassists,
      keyPasses: stats.key_passes,
      position: stats.general_position ?? '',
    });
  }
  return index;
}

/** Same 0.85 confidence bar as `matchUnderstatIndex` and `matchLegsToSubjects` — pure, in-memory, no I/O, so callers can run it per-subject without hitting the cache/network again. */
export function matchAsaIndex(index: Map<string, AsaSeasonStats & { name: string }>, espnName: string): (AsaSeasonStats & { name: string }) | null {
  let best: (AsaSeasonStats & { name: string }) | null = null;
  let bestScore = 0;
  for (const entry of index.values()) {
    const score = scoreNameMatch(espnName, entry.name);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return bestScore >= 0.85 ? best : null;
}

interface RawAsaGame {
  game_id: string;
  date_time_utc: string;
  home_team_id: string;
  away_team_id: string;
  season_name: string;
  status: string;
}

async function fetchSeasonGames(season: string): Promise<RawAsaGame[]> {
  const cacheKey = `soccer:asa:games:${season}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 6 * 60 * 60_000) {
    return JSON.parse(cached.payload) as RawAsaGame[];
  }
  const data = await fetchJson<RawAsaGame[]>(`/mls/games?season_name=${season}`);
  if (!data) return cached ? (JSON.parse(cached.payload) as RawAsaGame[]) : [];
  await writeSnapshotCache(cacheKey, JSON.stringify(data));
  return data;
}

interface RawAsaPlayerGameRow {
  player_id: string;
  game_id: string;
  team_id: string;
  minutes_played: number;
  shots: number;
  goals: number;
  primary_assists: number;
}

/**
 * Real per-appearance rows for every MLS player this season, one fetch
 * (~3.5MB, cached 6h like every other season-wide snapshot this codebase
 * caches). `split_by_games=true` is the one ASA param that actually gives
 * a per-match row per player — the plain season endpoint only has
 * aggregates, and there's no reliable "did this player appear in this
 * match" signal from `games/shots` alone (a 0-shot, 0-assist appearance
 * looks identical to not playing at all if you only scan shot events).
 * One fetch shared by every subject rather than a fetch per player.
 */
async function fetchSeasonPlayerGameRows(season: string): Promise<RawAsaPlayerGameRow[]> {
  const cacheKey = `soccer:asa:xgoals:bygame:${season}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 6 * 60 * 60_000) {
    return JSON.parse(cached.payload) as RawAsaPlayerGameRow[];
  }
  const data = await fetchJson<RawAsaPlayerGameRow[]>(`/mls/players/xgoals?season_name=${season}&split_by_games=true`);
  if (!data) return cached ? (JSON.parse(cached.payload) as RawAsaPlayerGameRow[]) : [];
  await writeSnapshotCache(cacheKey, JSON.stringify(data));
  return data;
}

export interface AsaMatchStat {
  gameId: string;
  date: string;
  opponent: string;
  isHome: boolean;
  goals: number;
  shots: number;
  assists: number;
}

export interface AsaSeasonContext {
  nameIndex: Map<string, AsaSeasonStats & { name: string }>;
  playerGameRows: RawAsaPlayerGameRow[];
  gamesById: Map<string, RawAsaGame>;
  teamAbbr: Map<string, string>;
}

/**
 * Everything `matchAsaIndex`/`asaPlayerMatches` need for one season, fetched
 * exactly once regardless of how many subjects are being resolved against
 * it — each underlying fetch is already DB-cached, but a snapshot rebuild
 * touching hundreds of MLS subjects still means hundreds of redundant cache
 * round-trips if every subject re-fetches this same season-wide data
 * itself. Callers (namely `adapter.ts`'s `attachRealHistory`) load this
 * once per rebuild and reuse it for every subject.
 */
export async function loadAsaSeasonContext(season: string): Promise<AsaSeasonContext> {
  const [players, xgoals, rows, games, teams] = await Promise.all([
    fetchAllPlayers(),
    fetchSeasonXgoals(season),
    fetchSeasonPlayerGameRows(season),
    fetchSeasonGames(season),
    fetchTeams(),
  ]);
  return {
    nameIndex: buildAsaNameIndex(players, xgoals),
    playerGameRows: rows,
    gamesById: new Map(games.map((g) => [g.game_id, g])),
    teamAbbr: new Map(teams.map((t) => [t.team_id, t.team_abbreviation])),
  };
}

/**
 * Real per-match history for one ASA player: every real appearance row for
 * this player id in `context.playerGameRows`, joined against the season's
 * real game list for date/opponent/home-away. Includes 0-shot appearances
 * (a real "under" data point), unlike a naive shot-event scan would. Pure —
 * no I/O — since `context` already carries everything needed.
 */
export function asaPlayerMatches(context: AsaSeasonContext, playerId: string, teamId: string): AsaMatchStat[] {
  const playerRows = context.playerGameRows.filter((r) => r.player_id === playerId);
  const matches: AsaMatchStat[] = [];
  for (const row of playerRows) {
    const game = context.gamesById.get(row.game_id);
    if (!game || game.status !== 'FullTime') continue;
    const isHome = game.home_team_id === teamId;
    const opponentTeamId = isHome ? game.away_team_id : game.home_team_id;
    matches.push({
      gameId: game.game_id,
      date: game.date_time_utc,
      opponent: context.teamAbbr.get(opponentTeamId) ?? opponentTeamId,
      isHome,
      goals: row.goals,
      shots: row.shots,
      assists: row.primary_assists,
    });
  }
  return matches.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}
