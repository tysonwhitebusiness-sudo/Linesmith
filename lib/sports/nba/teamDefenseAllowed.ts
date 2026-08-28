/**
 * NBA's real team-defense-allowed leaderboard — the position-group data
 * source the matchup-card rebuild needs (see
 * docs/matchup-card-rebuild-gameplan-2026-08-23.md §6/§8).
 *
 * Same rolling-window shape as `nhl/teamDefenseAllowed.ts` (last 15 real
 * completed games per team, falling back toward the prior season when the
 * current one doesn't have 15 yet — same reasoning as CFB's/NHL's own
 * fallback, this codebase's established "L15" convention).
 *
 * UNVERIFIED against a live response, same caveat as `nba/boxscore.ts`:
 * this sandbox's network blocks `site.api.espn.com` outright, so the
 * per-team schedule endpoint below (`/teams/{id}/schedule`) — a standard,
 * widely-used ESPN site-API pattern, but not one already proven live
 * anywhere else in this codebase the way NHL's/CFB's equivalents are —
 * could not be checked against a real payload tonight. Parses defensively
 * (empty result rather than a throw on any shape mismatch), but needs a
 * real check against a live team before its output should be trusted.
 */

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { fetchAllTeams } from './espn';
import { fetchNbaBoxscore } from './boxscore';
import { nbaPositionGroup } from './positionGroup';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

interface NbaScheduleGame {
  gameId: string;
  date: string;
  completed: boolean;
}

interface RawScheduleResponse {
  events?: Array<{ id: string; date: string; competitions?: Array<{ status?: { type?: { completed?: boolean } } }> }>;
}

async function fetchNbaTeamSchedule(teamId: string, season: string): Promise<NbaScheduleGame[]> {
  const cacheKey = `nba:schedule:${season}:${teamId}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 6 * 60 * 60_000) {
    return JSON.parse(cached.payload) as NbaScheduleGame[];
  }
  let res: Response;
  try {
    res = await fetch(`${ESPN_BASE}/teams/${teamId}/schedule?season=${season}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  } catch {
    return cached ? (JSON.parse(cached.payload) as NbaScheduleGame[]) : [];
  }
  if (!res.ok) return cached ? (JSON.parse(cached.payload) as NbaScheduleGame[]) : [];
  let json: RawScheduleResponse;
  try {
    json = (await res.json()) as RawScheduleResponse;
  } catch {
    return cached ? (JSON.parse(cached.payload) as NbaScheduleGame[]) : [];
  }
  const games: NbaScheduleGame[] = (json.events ?? []).map((e) => ({
    gameId: String(e.id),
    date: e.date,
    completed: e.competitions?.[0]?.status?.type?.completed === true,
  }));
  await writeSnapshotCache(cacheKey, JSON.stringify(games));
  return games;
}

/** NBA season label convention: ESPN's `season` param is the year the season ENDS in (e.g. 2026 for the 2025-26 season). Season runs Oct-June. */
export function currentNbaSeasonYear(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed, 9 = October
  return month >= 9 ? year + 1 : year;
}

async function lastNCompletedGames(teamId: string, seasonYear: number, n: number): Promise<NbaScheduleGame[]> {
  let games = (await fetchNbaTeamSchedule(teamId, String(seasonYear))).filter((g) => g.completed);
  if (games.length < n) {
    const prior = (await fetchNbaTeamSchedule(teamId, String(seasonYear - 1))).filter((g) => g.completed);
    games = [...prior, ...games];
  }
  games.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return games.slice(0, n);
}

export interface NbaTeamDefenseAllowed {
  abbr: string;
  gamesPlayed: number;
  guardPtsAllowedPerGame: number;
  guardRank: number;
  forwardPtsAllowedPerGame: number;
  forwardRank: number;
  centerPtsAllowedPerGame: number;
  centerRank: number;
  poolSize: number;
}

async function aggregateAllowed(abbr: string, games: NbaScheduleGame[]): Promise<{ games: number; guardPts: number; forwardPts: number; centerPts: number }> {
  let played = 0;
  let guardPts = 0;
  let forwardPts = 0;
  let centerPts = 0;
  for (const game of games) {
    const box = await fetchNbaBoxscore(game.gameId);
    if (!box) continue;
    const opponentAbbr = box.homeAbbr === abbr ? box.awayAbbr : box.awayAbbr === abbr ? box.homeAbbr : null;
    if (!opponentAbbr) continue;
    const opponentPlayers = box.playersByAbbr[opponentAbbr] ?? [];
    if (opponentPlayers.length === 0) continue;
    played += 1;
    for (const p of opponentPlayers) {
      const group = nbaPositionGroup(p.position);
      if (group === 'Guards') guardPts += p.points;
      else if (group === 'Forwards') forwardPts += p.points;
      else if (group === 'Centers') centerPts += p.points;
    }
  }
  return { games: played, guardPts, forwardPts, centerPts };
}

/**
 * League-wide leaderboard, every current NBA team ranked. Cached 24h, same
 * grounding as CFB's/NHL's own leaderboards (§7 of the gameplan).
 */
export async function buildNbaTeamDefenseAllowedIndex(seasonYear: number = currentNbaSeasonYear(), windowSize = 15): Promise<Map<string, NbaTeamDefenseAllowed>> {
  const cacheKey = `nba:defenseAllowed:leaderboard:${seasonYear}:${windowSize}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 60 * 60_000) {
    return new Map(JSON.parse(cached.payload) as Array<[string, NbaTeamDefenseAllowed]>);
  }

  const teams = await fetchAllTeams();
  const staleFallback = cached ? new Map(JSON.parse(cached.payload) as Array<[string, NbaTeamDefenseAllowed]>) : null;
  const rows: Array<{ abbr: string; gamesPlayed: number; guardPtsAllowedPerGame: number; forwardPtsAllowedPerGame: number; centerPtsAllowedPerGame: number }> = [];

  for (const team of teams) {
    const games = await lastNCompletedGames(team.teamId, seasonYear, windowSize);
    if (games.length === 0) continue;
    const agg = await aggregateAllowed(team.abbreviation, games);
    if (agg.games === 0) continue;
    rows.push({
      abbr: team.abbreviation,
      gamesPlayed: agg.games,
      guardPtsAllowedPerGame: agg.guardPts / agg.games,
      forwardPtsAllowedPerGame: agg.forwardPts / agg.games,
      centerPtsAllowedPerGame: agg.centerPts / agg.games,
    });
  }

  const rankOf = (key: 'guardPtsAllowedPerGame' | 'forwardPtsAllowedPerGame' | 'centerPtsAllowedPerGame') => {
    const sorted = [...rows].sort((a, b) => a[key] - b[key]);
    const rankByAbbr = new Map<string, number>();
    sorted.forEach((r, i) => rankByAbbr.set(r.abbr, i + 1));
    return rankByAbbr;
  };
  // Real, live-observed failure mode (2026-08-27, building Phase D of docs/
  // x-signal-remaining-sports-gameplan-2026-08-27.md): a transient ESPN
  // hiccup across this ~30-team, sequential, unthrottled rebuild can leave
  // `rows` entirely empty even though a rebuild minutes earlier succeeded
  // with real, sane data — every per-game fetcher already falls back to its
  // own last-good cache on failure rather than overwriting with empty
  // (fetchNbaTeamSchedule/fetchNbaBoxscore, both above), but this leaderboard
  // itself didn't apply that same rule to its overall result. Deliberately
  // does NOT re-write the cache here (which would reset `fetchedAt` and let
  // stale data linger for a fresh 24h if ESPN stays flaky) — just serves the
  // last-good data for this one response and leaves the existing cache
  // entry's age alone, so the next request past its real TTL tries again.
  if (rows.length === 0 && staleFallback) {
    return staleFallback;
  }

  const guardRanks = rankOf('guardPtsAllowedPerGame');
  const forwardRanks = rankOf('forwardPtsAllowedPerGame');
  const centerRanks = rankOf('centerPtsAllowedPerGame');

  const index = new Map<string, NbaTeamDefenseAllowed>();
  for (const r of rows) {
    index.set(r.abbr, {
      abbr: r.abbr,
      gamesPlayed: r.gamesPlayed,
      guardPtsAllowedPerGame: r.guardPtsAllowedPerGame,
      guardRank: guardRanks.get(r.abbr) ?? rows.length,
      forwardPtsAllowedPerGame: r.forwardPtsAllowedPerGame,
      forwardRank: forwardRanks.get(r.abbr) ?? rows.length,
      centerPtsAllowedPerGame: r.centerPtsAllowedPerGame,
      centerRank: centerRanks.get(r.abbr) ?? rows.length,
      poolSize: rows.length,
    });
  }

  await writeSnapshotCache(cacheKey, JSON.stringify([...index.entries()]));
  return index;
}

export function lookupNbaTeamDefenseAllowed(index: Map<string, NbaTeamDefenseAllowed>, abbr: string): NbaTeamDefenseAllowed | null {
  return index.get(abbr) ?? null;
}
