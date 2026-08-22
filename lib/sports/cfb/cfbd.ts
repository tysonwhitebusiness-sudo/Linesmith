/**
 * CollegeFootballData.com — CFB's real per-game player history source, per
 * docs/multi-sport-expansion-audit-2026-08-22.md §1. Free, registered API
 * key required (`CFBD_API_KEY`, verified live 2026-08-22).
 *
 * Real per-game box scores (`/games/players?gameId=X`) return BOTH teams'
 * full stat lines in one call — richer than Understat/ASA's per-player
 * fetch, so this file resolves a subject's history by first finding their
 * team's real games (`/games?year=Y&team=X`), then fetching each game's box
 * score (cached per `gameId`, shared across every player in that game,
 * same sharing logic ASA's game-shots cache used before the split-by-games
 * discovery made it unnecessary there — CFBD has no equivalent season-wide
 * per-player-per-game endpoint, so per-game fetching is the real approach
 * here).
 *
 * No cross-source id — CFBD's own `playerId` has no crosswalk to ESPN's
 * athlete id, so resolution is by normalized name within the subject's own
 * real team (not a league-wide index — CFB has ~130 FBS teams, so scoping
 * the name search to one team's roster is both correct, given `team` query
 * param, and far cheaper than indexing the whole league for every subject).
 */

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { normalizeName, scoreNameMatch } from '@/lib/odds/screenshotImport';

const BASE = 'https://api.collegefootballdata.com';
const API_KEY = process.env.CFBD_API_KEY;

/** CFB season year is the fall the season starts in — season runs Aug-Jan, so Jan-Jun still belongs to the previous fall's season for roster/stats purposes. */
export function currentCfbdSeason(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed, 6 = July
  return String(month >= 6 ? year : year - 1);
}

async function fetchJson<T>(path: string, timeoutMs = 15_000): Promise<T | null> {
  if (!API_KEY) return null;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
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

interface RawFbsTeam {
  school: string;
}

/** Real FBS school list — the filter `cfb/espn.ts` uses to trim ESPN's unfiltered ~300-team list down to the ~130 schools real props actually exist for. Cached 24h. */
export async function fetchFbsTeamNames(): Promise<string[]> {
  const cacheKey = 'cfb:cfbd:fbs-teams';
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 60 * 60_000) {
    return JSON.parse(cached.payload) as string[];
  }
  const data = await fetchJson<RawFbsTeam[]>(`/teams/fbs?year=${currentCfbdSeason()}`);
  if (!data) return cached ? (JSON.parse(cached.payload) as string[]) : [];
  const names = data.map((t) => t.school);
  await writeSnapshotCache(cacheKey, JSON.stringify(names));
  return names;
}

/**
 * Team-name matcher, deliberately NOT `scoreNameMatch` (built for person
 * names) and deliberately NOT a prefix/substring check on the full display
 * name — a first attempt at that badly over-matched: "Alabama" (CFBD) is a
 * literal word-prefix of "Alabama A&M Bulldogs", "Alabama State Hornets",
 * "South Alabama Jaguars", etc., none of which are the school "Alabama"
 * actually means. Real fix: ESPN's team object carries `location` (the bare
 * school name, e.g. "Alabama") separately from `name` (the mascot, e.g.
 * "Crimson Tide") — `location` is CFBD's own `school` field almost
 * verbatim, so this compares those two directly (exact after light
 * normalization) instead of trying to strip a mascot back out of the
 * combined display name.
 */
function isTeamNameMatch(espnLocation: string, cfbdSchool: string): boolean {
  const a = normalizeName(espnLocation);
  const b = normalizeName(cfbdSchool);
  return a !== '' && a === b;
}

/**
 * ESPN's `team.location` ("Alabama") -> CFBD's own school-name convention
 * ("Alabama"), needed because CFBD's `/games?team=` param expects its own
 * naming, not ESPN's full display name. Resolved once per rebuild by the
 * caller (cfb/adapter.ts builds this map once, not per subject) — exposed
 * here as a pure matcher over an already-fetched name list so it doesn't
 * refetch `fetchFbsTeamNames()` per call.
 */
export function matchCfbdTeamName(espnLocation: string, fbsNames: string[]): string | null {
  return fbsNames.find((name) => isTeamNameMatch(espnLocation, name)) ?? null;
}

interface RawCfbdGame {
  id: number;
  homeTeam: string;
  awayTeam: string;
  startDate: string;
  completed: boolean;
}

async function fetchTeamGames(team: string, season: string): Promise<RawCfbdGame[]> {
  const cacheKey = `cfb:cfbd:games:${season}:${team}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 6 * 60 * 60_000) {
    return JSON.parse(cached.payload) as RawCfbdGame[];
  }
  const data = await fetchJson<RawCfbdGame[]>(`/games?year=${season}&team=${encodeURIComponent(team)}`);
  if (!data) return cached ? (JSON.parse(cached.payload) as RawCfbdGame[]) : [];
  await writeSnapshotCache(cacheKey, JSON.stringify(data));
  return data;
}

interface RawGamePlayerAthleteStat {
  id: string;
  name: string;
  stat: string;
}
interface RawGamePlayerType {
  name: string;
  athletes: RawGamePlayerAthleteStat[];
}
interface RawGamePlayerCategory {
  name: string;
  types: RawGamePlayerType[];
}
interface RawGamePlayersTeam {
  team: string;
  homeAway: 'home' | 'away';
  categories: RawGamePlayerCategory[];
}
interface RawGamePlayersResponse {
  id: number;
  teams: RawGamePlayersTeam[];
}

/**
 * Every one of a team's real games this season, each with its own full box
 * score, in ONE call. `gameId` alone is NOT a valid filter for this
 * endpoint — confirmed live: CFBD requires `year` plus one of `week`/
 * `team`/`conference`, and rejects a bare `gameId` (even with `year`) with
 * a 400 validation error. `year`+`team` turns out to return the whole
 * season at once (every completed game's full box score included), which
 * is both the only way to make this endpoint work *and* far more efficient
 * than the per-game-fetch design this file started with — one request per
 * team per season, not one per game.
 */
async function fetchTeamSeasonBoxScores(cfbdTeamName: string, season: string): Promise<RawGamePlayersResponse[]> {
  const cacheKey = `cfb:cfbd:boxscores:${season}:${cfbdTeamName}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 6 * 60 * 60_000) {
    return JSON.parse(cached.payload) as RawGamePlayersResponse[];
  }
  const data = await fetchJson<RawGamePlayersResponse[]>(`/games/players?year=${season}&team=${encodeURIComponent(cfbdTeamName)}`);
  if (!data) return cached ? (JSON.parse(cached.payload) as RawGamePlayersResponse[]) : [];
  await writeSnapshotCache(cacheKey, JSON.stringify(data));
  return data;
}

/** category.name/type.name -> field. Only the real box-score fields the app's actual tracked markets need — see cfb/adapter.ts's HISTORY_FIELD for the market-key side of this mapping. */
const STAT_LOOKUP: Array<{ category: string; type: string; field: 'passingYards' | 'rushingYards' | 'receivingYards' | 'receptions' | 'longestRush' | 'longestReception' | 'kickingPoints' }> = [
  { category: 'passing', type: 'YDS', field: 'passingYards' },
  { category: 'rushing', type: 'YDS', field: 'rushingYards' },
  { category: 'receiving', type: 'YDS', field: 'receivingYards' },
  { category: 'receiving', type: 'REC', field: 'receptions' },
  { category: 'rushing', type: 'LONG', field: 'longestRush' },
  { category: 'receiving', type: 'LONG', field: 'longestReception' },
  { category: 'kicking', type: 'PTS', field: 'kickingPoints' },
];

export interface CfbdMatchStat {
  gameId: string;
  date: string;
  opponent: string;
  isHome: boolean;
  passingYards: number;
  rushingYards: number;
  receivingYards: number;
  receptions: number;
  longestRush: number;
  longestReception: number;
  kickingPoints: number;
}

export interface CfbdTeamContext {
  cfbdTeamName: string;
  games: RawCfbdGame[];
  boxByGameId: Map<number, RawGamePlayersResponse>;
}

/**
 * Everything needed to resolve every player on one real team's real box
 * scores for a season, fetched once regardless of how many of that team's
 * players are being resolved against it — two real calls total
 * (`/games` for date/opponent metadata, `/games/players` for the actual
 * per-game stats), not two calls per player. A snapshot rebuild routinely
 * touches 15-25 skill-position players per team, so this matters the same
 * way ASA's `loadAsaSeasonContext` refactor did for soccer (see that
 * file's comment on the DB-pool-pressure reason, not just raw speed).
 */
export async function loadCfbdTeamContext(cfbdTeamName: string, season: string): Promise<CfbdTeamContext> {
  const [allGames, boxScores] = await Promise.all([fetchTeamGames(cfbdTeamName, season), fetchTeamSeasonBoxScores(cfbdTeamName, season)]);
  const games = allGames.filter((g) => g.completed).sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));
  const boxByGameId = new Map(boxScores.map((b) => [b.id, b]));
  return { cfbdTeamName, games, boxByGameId };
}

/**
 * Real per-match history for one player, resolved by real name within an
 * already-loaded team context — pure, no I/O. `espnName` is matched
 * against whatever names actually appear in that team's own box scores
 * (CFBD's own real roster, not a separate roster call), same 0.85
 * confidence bar every other cross-source name join in this codebase uses.
 * Matched independently per game (not once for the season) since CFBD box
 * scores are the only real signal of which name-spelling a given game
 * used — cheap, since each game only has a few dozen real stat lines.
 */
export function cfbdPlayerMatchesFromContext(context: CfbdTeamContext, espnName: string): CfbdMatchStat[] {
  const matches: CfbdMatchStat[] = [];
  for (const game of context.games) {
    const box = context.boxByGameId.get(game.id);
    if (!box) continue;
    const teamBox = box.teams.find((t) => t.team === context.cfbdTeamName);
    if (!teamBox) continue;

    let bestName: string | null = null;
    let bestScore = 0;
    for (const cat of teamBox.categories) {
      for (const type of cat.types) {
        for (const athlete of type.athletes) {
          const score = scoreNameMatch(espnName, athlete.name);
          if (score > bestScore) {
            bestScore = score;
            bestName = athlete.name;
          }
        }
      }
    }
    if (bestScore < 0.85 || !bestName) continue;

    const stat: Record<string, number> = { passingYards: 0, rushingYards: 0, receivingYards: 0, receptions: 0, longestRush: 0, longestReception: 0, kickingPoints: 0 };
    for (const { category, type, field } of STAT_LOOKUP) {
      const cat = teamBox.categories.find((c) => c.name === category);
      const t = cat?.types.find((ty) => ty.name === type);
      const athlete = t?.athletes.find((a) => a.name === bestName);
      if (athlete) {
        const v = Number(athlete.stat);
        if (!Number.isNaN(v)) stat[field] = v;
      }
    }

    const isHome = game.homeTeam === context.cfbdTeamName;
    matches.push({
      gameId: String(game.id),
      date: game.startDate,
      opponent: isHome ? game.awayTeam : game.homeTeam,
      isHome,
      passingYards: stat.passingYards,
      rushingYards: stat.rushingYards,
      receivingYards: stat.receivingYards,
      receptions: stat.receptions,
      longestRush: stat.longestRush,
      longestReception: stat.longestReception,
      kickingPoints: stat.kickingPoints,
    });
  }
  return matches;
}
