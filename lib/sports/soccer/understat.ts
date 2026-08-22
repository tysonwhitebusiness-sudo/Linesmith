/**
 * Understat — EPL's real per-match player history source, per
 * docs/soccer-gameplan-2026-08-22.md §11. `getPlayerData/{id}` returns a
 * genuine match-by-match array (goals/shots/xG/assists/xA/key_passes),
 * distinct from `getLeagueData`'s season-aggregate `players` object (which
 * this file also uses, but only to resolve a real name to an Understat
 * player id — Understat has no id crosswalk to ESPN's athlete ids, so
 * matching is by normalized name, same as `screenshotImport.ts`'s existing
 * fuzzy matcher).
 *
 * No cookie-priming needed, contrary to earlier assumption — confirmed
 * live this session: a plain request with `X-Requested-With: XMLHttpRequest`
 * against the real data endpoints (not the HTML page, which does need a
 * browser) returns real JSON directly.
 *
 * Understat is big-5-leagues only (EPL, La Liga, Serie A, Bundesliga,
 * Ligue 1) — this file is EPL-specific; MLS's equivalent is
 * `americanSocceranalysis.ts`.
 */

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { normalizeName, scoreNameMatch } from '@/lib/odds/screenshotImport';

const BASE = 'https://understat.com';
const HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };

/** Understat's season param is the year the season *starts* in (e.g. "2026" for the 2026-27 season) — season runs Aug-May, so before August still belongs to the previous year's season. */
export function currentUnderstatSeason(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed, 7 = August
  return String(month >= 7 ? year : year - 1);
}

async function fetchJson<T>(path: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { headers: HEADERS, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
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

interface RawLeagueTeam {
  id: string;
  title: string;
  history: Array<{
    h_a: 'h' | 'a';
    xG: number;
    xGA: number;
    result: 'w' | 'd' | 'l';
    date: string;
    scored: number;
    missed: number;
  }>;
}

interface RawLeaguePlayer {
  id: string;
  player_name: string;
  team_title: string;
  games: string;
  goals: string;
  xG: string;
  assists: string;
  xA: string;
  shots: string;
  key_passes: string;
  position: string;
}

interface RawLeagueData {
  teams: Record<string, RawLeagueTeam>;
  players: Record<string, RawLeaguePlayer>;
}

async function fetchLeagueData(season: string): Promise<RawLeagueData | null> {
  const cacheKey = `soccer:understat:league:${season}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 6 * 60 * 60_000) {
    return JSON.parse(cached.payload) as RawLeagueData;
  }
  const data = await fetchJson<RawLeagueData>(`/getLeagueData/EPL/${season}`);
  if (!data) return cached ? (JSON.parse(cached.payload) as RawLeagueData) : null;
  await writeSnapshotCache(cacheKey, JSON.stringify(data));
  return data;
}

export interface UnderstatSeasonStats {
  understatId: string;
  teamTitle: string;
  games: number;
  goals: number;
  xG: number;
  assists: number;
  xA: number;
  shots: number;
  keyPasses: number;
  position: string;
}

/** `subjectName -> understatId`, built fresh from the current season's real player list each call (the underlying `fetchLeagueData` is itself cached, so this is cheap after the first call in a given cache window). */
export async function buildUnderstatNameIndex(season: string): Promise<Map<string, UnderstatSeasonStats & { name: string }>> {
  const data = await fetchLeagueData(season);
  const index = new Map<string, UnderstatSeasonStats & { name: string }>();
  if (!data) return index;
  for (const p of Object.values(data.players)) {
    index.set(normalizeName(p.player_name), {
      understatId: p.id,
      teamTitle: p.team_title,
      name: p.player_name,
      games: Number(p.games),
      goals: Number(p.goals),
      xG: Number(p.xG),
      assists: Number(p.assists),
      xA: Number(p.xA),
      shots: Number(p.shots),
      keyPasses: Number(p.key_passes),
      position: p.position,
    });
  }
  return index;
}

/** Best real match for an ESPN roster name against an already-loaded Understat name index, or null below a real confidence bar — same threshold discipline `matchLegsToSubjects` already uses (0.85), not a looser one just because this is a background join instead of a user-facing screenshot match. Pure — no I/O — so a caller resolving many subjects against the same season loads the index once (`buildUnderstatNameIndex`) and calls this per subject instead of re-fetching. */
export function matchUnderstatIndex(
  index: Map<string, UnderstatSeasonStats & { name: string }>,
  espnName: string,
): (UnderstatSeasonStats & { name: string }) | null {
  let best: (UnderstatSeasonStats & { name: string }) | null = null;
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

/** Convenience wrapper for a one-off lookup — fetches the index itself. Prefer `buildUnderstatNameIndex` + `matchUnderstatIndex` when resolving many subjects against the same season in one request. */
export async function resolveUnderstatPlayer(
  espnName: string,
  season: string,
): Promise<(UnderstatSeasonStats & { name: string }) | null> {
  const index = await buildUnderstatNameIndex(season);
  return matchUnderstatIndex(index, espnName);
}

export interface UnderstatMatch {
  matchId: string;
  date: string;
  season: string;
  opponent: string;
  isHome: boolean;
  goals: number;
  shots: number;
  xG: number;
  assists: number;
  xA: number;
  keyPasses: number;
  minutes: number;
}

interface RawPlayerMatch {
  id: string;
  date: string;
  season: string;
  h_team: string;
  a_team: string;
  h_goals: string;
  a_goals: string;
  goals: string;
  shots: string;
  xG: string;
  assists: string;
  xA: string;
  key_passes: string;
  time: string;
}

/**
 * Real per-match history for one Understat player — the actual answer to
 * soccer's "no history source" problem for EPL. `understatTeamTitle` (from
 * the same season-index entry `resolveUnderstatPlayer` already returned,
 * e.g. "Arsenal") is required to correctly split each match row into
 * "this player's team" vs "opponent" — Understat's raw rows only carry
 * `h_team`/`a_team`, not a pre-resolved home/away flag from the player's
 * own perspective, and matching against ESPN's own team name instead would
 * risk a real mismatch (Understat says "Manchester City", ESPN sometimes
 * says "Man City").
 *
 * Cached 6h (fresher than season data — a match that just finished should
 * show up reasonably soon).
 */
export async function fetchUnderstatPlayerMatches(understatId: string, understatTeamTitle: string): Promise<UnderstatMatch[]> {
  const cacheKey = `soccer:understat:player:${understatId}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 6 * 60 * 60_000) {
    return JSON.parse(cached.payload) as UnderstatMatch[];
  }

  const json = await fetchJson<{ matches: RawPlayerMatch[] }>(`/getPlayerData/${understatId}`);
  if (!json) return cached ? (JSON.parse(cached.payload) as UnderstatMatch[]) : [];

  const matches: UnderstatMatch[] = json.matches.map((m) => {
    const isHome = m.h_team === understatTeamTitle;
    return {
      matchId: m.id,
      date: m.date,
      season: m.season,
      opponent: isHome ? m.a_team : m.h_team,
      isHome,
      goals: Number(m.goals),
      shots: Number(m.shots),
      xG: Number(m.xG),
      assists: Number(m.assists),
      xA: Number(m.xA),
      keyPasses: Number(m.key_passes),
      minutes: Number(m.time),
    };
  });

  await writeSnapshotCache(cacheKey, JSON.stringify(matches));
  return matches;
}
