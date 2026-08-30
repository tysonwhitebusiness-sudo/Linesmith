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
import type { UnderstatShot } from './understatShots';
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

function toIndexEntry(p: RawLeaguePlayer): UnderstatSeasonStats & { name: string } {
  return {
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
  };
}

/**
 * `subjectName -> understatId`. Real regression (2026-08-23): `getLeagueData`'s
 * `players` list is scoped to players who've actually recorded a stat THIS
 * season — early in a new season (confirmed live: EPL 2026-27's opening
 * round wasn't even fully played yet, most teams' rosters had zero entries)
 * that's a small fraction of the real league, not "everyone." Merges the
 * prior season's real index underneath the current one (current season's
 * entry wins on a name collision, since it's the more relevant one once it
 * exists) so a player not yet featured this season still resolves via last
 * season's real roster — `fetchUnderstatPlayerMatches` already returns a
 * career-spanning `matches[]` regardless of which season's index found the
 * id, so once resolved, real history flows either way.
 */
export async function buildUnderstatNameIndex(season: string): Promise<Map<string, UnderstatSeasonStats & { name: string }>> {
  const priorSeason = String(Number(season) - 1);
  const [current, prior] = await Promise.all([fetchLeagueData(season), fetchLeagueData(priorSeason)]);
  const index = new Map<string, UnderstatSeasonStats & { name: string }>();
  for (const p of Object.values(prior?.players ?? {})) {
    index.set(normalizeName(p.player_name), toIndexEntry(p));
  }
  for (const p of Object.values(current?.players ?? {})) {
    index.set(normalizeName(p.player_name), toIndexEntry(p));
  }
  return index;
}

export interface UnderstatTeamDefense {
  teamTitle: string;
  gamesPlayed: number;
  goalsAgainstPerGame: number;
  xGAPerGame: number;
  goalsForPerGame: number;
  /** 1 = fewest goals allowed per game (best real defense) among the real teams in this index. */
  rank: number;
  /** 1 = most goals scored per game (best real attack) among the real teams in this index. */
  offenseRank: number;
  poolSize: number;
}

/**
 * Real per-team defensive rate, for the "vs opponent's defense" matchup
 * card — the soccer equivalent of NFL's rush-yards-allowed row, built from
 * the exact same real per-match team `history[]` Understat's league data
 * already carries (`scored`/`missed`/`xGA` per match). Same current+prior
 * season merge as `buildUnderstatNameIndex`, for the same reason: early in
 * a new season a team's current-season sample can be 0-1 games, too thin
 * to rank meaningfully — falls back to last season's real rate for a team
 * with fewer than `minGames` real matches so far this season.
 */
export async function buildUnderstatTeamDefenseIndex(season: string, minGames = 3): Promise<Map<string, UnderstatTeamDefense>> {
  const priorSeason = String(Number(season) - 1);
  const [current, prior] = await Promise.all([fetchLeagueData(season), fetchLeagueData(priorSeason)]);
  const currentTeams = current?.teams ?? {};
  const priorTeams = prior?.teams ?? {};

  const rates = new Map<string, { teamTitle: string; gamesPlayed: number; goalsAgainstPerGame: number; xGAPerGame: number; goalsForPerGame: number }>();
  for (const teamId of new Set([...Object.keys(currentTeams), ...Object.keys(priorTeams)])) {
    const useTeam = (currentTeams[teamId]?.history.length ?? 0) >= minGames ? currentTeams[teamId] : (priorTeams[teamId] ?? currentTeams[teamId]);
    if (!useTeam || useTeam.history.length === 0) continue;
    const n = useTeam.history.length;
    const goalsAgainstPerGame = useTeam.history.reduce((sum, m) => sum + m.missed, 0) / n;
    const xGAPerGame = useTeam.history.reduce((sum, m) => sum + m.xGA, 0) / n;
    const goalsForPerGame = useTeam.history.reduce((sum, m) => sum + m.scored, 0) / n;
    rates.set(useTeam.title, { teamTitle: useTeam.title, gamesPlayed: n, goalsAgainstPerGame, xGAPerGame, goalsForPerGame });
  }

  const rankedByDefense = [...rates.values()].sort((a, b) => a.goalsAgainstPerGame - b.goalsAgainstPerGame);
  const offenseRankByTeam = new Map<string, number>();
  [...rates.values()]
    .sort((a, b) => b.goalsForPerGame - a.goalsForPerGame)
    .forEach((r, i) => offenseRankByTeam.set(r.teamTitle, i + 1));

  const index = new Map<string, UnderstatTeamDefense>();
  rankedByDefense.forEach((r, i) => {
    index.set(normalizeName(r.teamTitle), { ...r, rank: i + 1, offenseRank: offenseRankByTeam.get(r.teamTitle) ?? i + 1, poolSize: rankedByDefense.length });
  });
  return index;
}

/**
 * ESPN's team names are full official names ("Brighton & Hove Albion");
 * Understat's are its own shorter convention ("Brighton") — confirmed live,
 * a plain `normalizeName` equality check misses every real match. Real
 * team-name matching (same problem CFB's `cfbd.ts` solved for its own
 * ESPN-vs-CFBD name gap), deliberately substring-based rather than fuzzy
 * Levenshtein: a small, known set of ~20 real EPL club names has no real
 * collision risk the way person-name fuzzy matching does, and one real
 * name is reliably a substring/superset of the other here.
 */
export function matchUnderstatTeamName<T extends { teamTitle: string }>(index: Map<string, T>, espnName: string): T | null {
  const normalizedEspn = normalizeName(espnName);
  const exact = index.get(normalizedEspn);
  if (exact) return exact;
  for (const entry of index.values()) {
    const normalizedUnderstat = normalizeName(entry.teamTitle);
    if (normalizedEspn.includes(normalizedUnderstat) || normalizedUnderstat.includes(normalizedEspn)) return entry;
  }
  return null;
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
  /** `null` when the player's club that season could not be resolved — see `fetchUnderstatPlayerMatches`. */
  opponent: string | null;
  /** `null` means NOT DETERMINABLE, and is not the same as away. */
  isHome: boolean | null;
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

/** One payload, two accessors — see `fetchUnderstatPlayerShots`. */
interface CachedPlayerPayload {
  matches: UnderstatMatch[];
  shots: UnderstatShot[];
}

/** `:v3:` — the cached shape gained `shots`; a v2 entry holds a bare array. */
function playerCacheKey(understatId: string): string {
  return `soccer:understat:player:v3:${understatId}`;
}

async function readPlayerPayload(
  understatId: string,
  { ignoreAge = false }: { ignoreAge?: boolean } = {},
): Promise<CachedPlayerPayload | null> {
  const cached = await readSnapshotCache(playerCacheKey(understatId));
  if (!cached) return null;
  // 6h, fresher than season data — a match that just finished should show up
  // reasonably soon. `ignoreAge` is the stale-is-better-than-nothing path used
  // when the fetch itself failed.
  if (!ignoreAge && Date.now() - Date.parse(cached.fetchedAt) >= 6 * 60 * 60_000) return null;
  try {
    const parsed = JSON.parse(cached.payload) as Partial<CachedPlayerPayload>;
    if (!Array.isArray(parsed?.matches)) return null;
    return { matches: parsed.matches, shots: Array.isArray(parsed.shots) ? parsed.shots : [] };
  } catch {
    return null;
  }
}

/**
 * Which side of a fixture this player was on, and therefore who the opponent
 * was — the whole of the defect described below, in one pure function.
 *
 * EXPORTED AND PURE ON PURPOSE. It was inline, and the test that "covered" it
 * re-implemented the same rule alongside it. Reverting the real code did not
 * fail that test, because the test was never calling it — the mirror agreed
 * with the bug. `tests/understat-venue.test.ts` now calls this.
 *
 * `teamsBySeason` is a SET per season: a mid-season transfer lists two clubs
 * (Salah's 2014 is Fiorentina and Chelsea), and taking a single value left 16
 * of his 399 matches unresolved.
 *
 * `fallbackTitle` applies ONLY when the response carried no season groups at
 * all — never as a per-season default, which is precisely the old bug.
 */
export function resolveMatchVenue(
  match: { season: string; h_team: string; a_team: string },
  teamsBySeason: Map<string, Set<string>>,
  fallbackTitle: string,
): { isHome: boolean | null; opponent: string | null } {
  const teams =
    teamsBySeason.get(match.season) ?? (teamsBySeason.size === 0 ? new Set([fallbackTitle]) : undefined);
  const isHome = teams?.has(match.h_team) ? true : teams?.has(match.a_team) ? false : null;
  return { isHome, opponent: isHome == null ? null : isHome ? match.a_team : match.h_team };
}

/**
 * Real per-match history for one Understat player — the actual answer to
 * soccer's "no history source" problem for EPL.
 *
 * ================== THE BUG THIS FUNCTION USED TO HAVE ======================
 *
 * `/getPlayerData/{id}` returns a player's WHOLE CAREER, across every club they
 * have played for. The old code resolved home/away as
 * `m.h_team === understatTeamTitle`, comparing every historical fixture against
 * the player's CURRENT club — so every match before their latest transfer was
 * recorded as **away**, and `opponent` resolved to the player's own former
 * club. Both wrong, both well-formed, neither detectable downstream.
 *
 * Measured against Understat directly:
 *
 * | player          | matches | marked home, old | marked home, now |
 * |-----------------|---------|------------------|------------------|
 * | Harry Wilson    | 157     | **2**            | 77 (49%)         |
 * | Raheem Sterling | 336     | **18**           | 166 (49%)        |
 * | Mohamed Salah   | 399     | 161              | 203 (51%)        |
 * | Erling Haaland  | 201     | —                | 101 (50%)        |
 *
 * Teams play a balanced schedule, so ~50% is the answer that had to come out.
 *
 * THE FIX COSTS NO EXTRA REQUEST: the same response carries `groups.season`,
 * one entry per season with that season's `team`. A season can list TWO teams
 * (Salah 2014: Fiorentina and Chelsea), which is a mid-season transfer, so the
 * lookup is a SET per season rather than one string — using a single value
 * left 16 of Salah's matches unresolved.
 *
 * A match whose season resolves to neither side gets `isHome: null` and
 * `opponent: null`. **`null` is not `false`** — `venueSplit.ts` and the gamelog
 * both treat it as "unknown", because filing an unknown under "away" is the
 * same mistake this function just stopped making.
 * ===========================================================================
 *
 * `understatTeamTitle` remains the fallback for the case where `groups.season`
 * is absent entirely, which did not occur in any player sampled.
 *
 * Cached 6h. **The cache key carries `:v2:`** — the payload shape changed and
 * every stored entry holds the old, wrong values.
 */
export async function fetchUnderstatPlayerMatches(understatId: string, understatTeamTitle: string): Promise<UnderstatMatch[]> {
  const cached = await readPlayerPayload(understatId);
  if (cached) return cached.matches;

  const json = await fetchJson<{
    matches: RawPlayerMatch[];
    shots?: UnderstatShot[];
    groups?: { season?: Array<{ season: string; team: string }> };
  }>(`/getPlayerData/${understatId}`);
  if (!json) {
    const stale = await readPlayerPayload(understatId, { ignoreAge: true });
    return stale?.matches ?? [];
  }

  // Which club(s) this player turned out for, per season. A set, not a string:
  // a mid-season transfer lists two.
  const teamsBySeason = new Map<string, Set<string>>();
  for (const g of json.groups?.season ?? []) {
    if (!teamsBySeason.has(g.season)) teamsBySeason.set(g.season, new Set());
    teamsBySeason.get(g.season)!.add(g.team);
  }

  const matches: UnderstatMatch[] = json.matches.map((m) => {
    const { isHome, opponent } = resolveMatchVenue(m, teamsBySeason, understatTeamTitle);
    return {
      matchId: m.id,
      date: m.date,
      season: m.season,
      opponent,
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

  // BOTH HALVES OF ONE RESPONSE ARE CACHED TOGETHER. `shots` arrives in the
  // same payload as `matches` (6.9), and fetching `/getPlayerData/{id}` twice —
  // once per accessor — would double the request rate against a site we do not
  // own for data we already had in hand.
  await writeSnapshotCache(playerCacheKey(understatId), JSON.stringify({ matches, shots: json.shots ?? [] }));
  return matches;
}

/**
 * Every shot this player has taken, as Understat records it — the source for
 * soccer's `spatialGrid` (6.9).
 *
 * Reads the SAME cached payload `fetchUnderstatPlayerMatches` writes, and
 * populates it by calling that function when the cache is cold. No second
 * network call exists for this: the shots were always in the response.
 *
 * Empty for a player Understat does not cover — which is every MLS player, and
 * is why soccer's shot map is EPL-only.
 */
export async function fetchUnderstatPlayerShots(understatId: string, understatTeamTitle: string): Promise<UnderstatShot[]> {
  const cached = await readPlayerPayload(understatId);
  if (cached) return cached.shots;
  // Populates the cache as a side effect; the shots land with the matches.
  await fetchUnderstatPlayerMatches(understatId, understatTeamTitle);
  return (await readPlayerPayload(understatId, { ignoreAge: true }))?.shots ?? [];
}
