/**
 * NHL's real team-defense-allowed leaderboard — the position-group data
 * source the matchup-card rebuild needs (see
 * docs/matchup-card-rebuild-gameplan-2026-08-23.md §6/§8).
 *
 * Feasible entirely from what `nhle.ts` already fetches and parses:
 * `fetchBoxscore()` already returns each game's skaters per team, already
 * split by forwards/defense at the source (`playerByGameStats.{team}.
 * forwards`/`.defense`) before being flattened into `skatersByTeam`. For
 * team X's game, the OTHER team's skaters are what X's defense allowed —
 * summing their real points, grouped by forward/defenseman, across a
 * rolling window of X's own games, is a real "allowed to forwards" /
 * "allowed to defensemen" rate.
 *
 * Rolling window (last 15 games, not a full season): a full 82-game season
 * would mean ~1,300 real per-game boxscore fetches to rebuild from cold —
 * too slow/expensive to be a page-load-adjacent job, and a season-long
 * average goes stale fast anyway. 15 games matches the "L15" rolling
 * window convention every other sport's recent-form logic already uses in
 * this codebase (see `cfbd.ts`'s `loadCfbdTeamContext`, same `minGames`
 * default and same prior-season fallback for the same reason: early in a
 * new season there aren't 15 real completed games yet).
 */

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { currentNhlSeason, fetchAllTeams, fetchBoxscore, fetchTeamSeasonSchedule, isNhlGameCompleted, type NhlGame } from './nhle';
import { isForwardCode } from './positionGroup';

export { isForwardCode } from './positionGroup';

export interface NhlTeamDefenseAllowed {
  abbr: string;
  gamesPlayed: number;
  forwardPtsAllowedPerGame: number;
  forwardRank: number;
  defensePtsAllowedPerGame: number;
  defenseRank: number;
  poolSize: number;
  /** Real, from `fetchAllTeams()`'s own team object — added 2026-08-24 so the matchup card's custom-opponent picker can show a real logo for every team, not just today's matched opponent. */
  logoUrl?: string;
}

async function lastNCompletedGames(abbr: string, season: string, n: number): Promise<NhlGame[]> {
  const schedule = await fetchTeamSeasonSchedule(abbr, season);
  let completed = schedule.filter((g) => isNhlGameCompleted(g.gameState));
  if (completed.length < n) {
    const priorSeasonStart = Number(season.slice(0, 4)) - 1;
    const priorSeason = `${priorSeasonStart}${priorSeasonStart + 1}`;
    const priorSchedule = await fetchTeamSeasonSchedule(abbr, priorSeason);
    const priorCompleted = priorSchedule.filter((g) => isNhlGameCompleted(g.gameState));
    completed = [...priorCompleted, ...completed];
  }
  completed.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return completed.slice(0, n);
}

async function aggregateAllowed(abbr: string, games: NhlGame[]): Promise<{ games: number; forwardPts: number; defensePts: number }> {
  let played = 0;
  let forwardPts = 0;
  let defensePts = 0;
  for (const game of games) {
    const box = await fetchBoxscore(game.gameId);
    if (!box) continue;
    const opponentAbbr = box.homeAbbr === abbr ? box.awayAbbr : box.awayAbbr === abbr ? box.homeAbbr : null;
    if (!opponentAbbr) continue;
    const opponentSkaters = box.skatersByTeam[opponentAbbr] ?? [];
    played += 1;
    for (const s of opponentSkaters) {
      if (isForwardCode(s.position)) forwardPts += s.points;
      else defensePts += s.points;
    }
  }
  return { games: played, forwardPts, defensePts };
}

/**
 * League-wide leaderboard, every current NHL team ranked. Cached 24h — the
 * same TTL grounding as CFB's leaderboard (§6/§7 of the gameplan): this
 * changes at the pace of completed games, not page loads. A cold rebuild
 * means one `fetchTeamSeasonSchedule` + up to 15 `fetchBoxscore` calls per
 * team (each individually cached 6h, so a warm run is cheap; a cold run is
 * a real ~32-team, ~200-unique-game rebuild).
 */
export async function buildNhlTeamDefenseAllowedIndex(season: string = currentNhlSeason(), windowSize = 15): Promise<Map<string, NhlTeamDefenseAllowed>> {
  // v2: added real logoUrl — bumped so a stale v1-shaped cache entry never gets read back missing it.
  const cacheKey = `nhl:defenseAllowed:leaderboard:v2:${season}:${windowSize}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 60 * 60_000) {
    return new Map(JSON.parse(cached.payload) as Array<[string, NhlTeamDefenseAllowed]>);
  }

  const teams = await fetchAllTeams();
  const logoByAbbr = new Map(teams.filter((t) => t.logoUrl).map((t) => [t.abbreviation, t.logoUrl as string]));
  const rows: Array<{ abbr: string; gamesPlayed: number; forwardPtsAllowedPerGame: number; defensePtsAllowedPerGame: number }> = [];

  for (const team of teams) {
    const games = await lastNCompletedGames(team.abbreviation, season, windowSize);
    if (games.length === 0) continue;
    const agg = await aggregateAllowed(team.abbreviation, games);
    if (agg.games === 0) continue;
    rows.push({
      abbr: team.abbreviation,
      gamesPlayed: agg.games,
      forwardPtsAllowedPerGame: agg.forwardPts / agg.games,
      defensePtsAllowedPerGame: agg.defensePts / agg.games,
    });
  }

  const rankOf = (key: 'forwardPtsAllowedPerGame' | 'defensePtsAllowedPerGame') => {
    const sorted = [...rows].sort((a, b) => a[key] - b[key]);
    const rankByAbbr = new Map<string, number>();
    sorted.forEach((r, i) => rankByAbbr.set(r.abbr, i + 1));
    return rankByAbbr;
  };
  const forwardRanks = rankOf('forwardPtsAllowedPerGame');
  const defenseRanks = rankOf('defensePtsAllowedPerGame');

  const index = new Map<string, NhlTeamDefenseAllowed>();
  for (const r of rows) {
    index.set(r.abbr, {
      abbr: r.abbr,
      gamesPlayed: r.gamesPlayed,
      forwardPtsAllowedPerGame: r.forwardPtsAllowedPerGame,
      forwardRank: forwardRanks.get(r.abbr) ?? rows.length,
      defensePtsAllowedPerGame: r.defensePtsAllowedPerGame,
      defenseRank: defenseRanks.get(r.abbr) ?? rows.length,
      poolSize: rows.length,
      logoUrl: logoByAbbr.get(r.abbr),
    });
  }

  await writeSnapshotCache(cacheKey, JSON.stringify([...index.entries()]));
  return index;
}

export function lookupNhlTeamDefenseAllowed(index: Map<string, NhlTeamDefenseAllowed>, abbr: string): NhlTeamDefenseAllowed | null {
  return index.get(abbr) ?? null;
}
