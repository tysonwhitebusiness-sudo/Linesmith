/**
 * The compare control's server half — R10.
 *
 * WHAT IT READS AND WHAT IT DOES NOT. Only the two things the page cannot work
 * out for itself: the league's team list, and what a chosen team gives up to
 * players of this one's kind. The player's own games against that team are
 * already in the history the page holds (R10 Step 0), so they are NOT fetched
 * again here — a compare that re-downloaded the player's career to filter it by
 * opponent would be the same mistake the audit found in the old pages.
 *
 * SEASON CHOICE. The rollup's newest season can be a handful of games old in
 * March; a card built on two games is noise with a rank attached. So the newest
 * season where the team has at least `MIN_GAMES` is used, and the card says
 * which season and how many games it is reading, exactly as the G2 control did.
 *
 * Server-only: reads Postgres through `readLeagueProduction`.
 */

import { pgAll } from '@/lib/db/pgClient';
import { readLeagueProduction } from './teamProduction';
import type { LeagueProduction, TeamProductionSport, TeamTotals } from './teamProductionShapes';
import { allowSpecFor, type AllowRow, type AllowSide, type ComparePeer, type CompareTeam } from './compareShapes';
import { loadTeamDirectory } from './playerHistoryServer';

/** Below this a team's rollup season is too thin to rank. */
const MIN_GAMES = 3;

/** A league's seasons, newest first — the rollup holds two (R5b). */
async function rollupSeasons(sport: TeamProductionSport): Promise<number[]> {
  const rows = await pgAll<{ season: number }>(
    `SELECT DISTINCT season FROM team_game_production WHERE sport = ? ORDER BY season DESC`,
    [sport],
  );
  return rows.map((r) => Number(r.season));
}

/**
 * The player's kind, as the rollup groups him. NBA/NFL/NHL/soccer come from
 * `athlete_positions`; MLB has no position rows and splits by stat group
 * instead, so a pitcher is a player whose history holds pitching outs.
 */
export async function playerGroup(sport: TeamProductionSport, athleteId: string): Promise<string | null> {
  if (sport === 'mlb') {
    const rows = await pgAll<{ pit: number }>(
      `SELECT count(*)::int AS pit FROM player_game_history
        WHERE sport = 'mlb' AND athlete_id = ? AND (stats->>'pit_inningsPitched') IS NOT NULL`,
      [athleteId],
    );
    return Number(rows[0]?.pit ?? 0) > 0 ? 'pitcher' : 'hitter';
  }
  if (sport === 'cfb') return 'all';
  const rows = await pgAll<{ position_group: string | null }>(
    `SELECT position_group FROM athlete_positions WHERE sport = ? AND athlete_id = ? LIMIT 1`,
    [sport, athleteId],
  );
  return rows[0]?.position_group ?? null;
}

function sideRows(prod: LeagueProduction, side: AllowSide): Record<string, TeamTotals> {
  if (side === 'for') return prod.for;
  if (side === 'allowed') return prod.allowed;
  return prod.allowedPos[side.slice('allowedPos:'.length)] ?? {};
}

/**
 * Rank one per-game value across the league, 1 = the most. Teams far below the
 * busiest team's game count are left out of the pool rather than ranked against
 * it: a side with two games played is not 1st in anything.
 */
function rankOne(rows: Record<string, TeamTotals>, teamId: string, key: string): AllowRow | null {
  const most = Math.max(0, ...Object.values(rows).map((r) => r.g));
  const floor = Math.max(MIN_GAMES, most * 0.3);
  const pool = Object.entries(rows)
    .filter(([, r]) => r.g >= floor)
    .map(([id, r]) => [id, (r.s[key] ?? 0) / r.g] as const)
    .filter(([, v]) => Number.isFinite(v));
  if (!pool.length) return null;
  const sorted = [...pool].sort((a, b) => b[1] - a[1]);
  const i = sorted.findIndex(([id]) => id === teamId);
  return {
    key,
    label: key,
    value: i >= 0 ? sorted[i][1] : null,
    rank: i + 1,
    of: sorted.length,
    league: pool.map(([, v]) => v).sort((a, b) => a - b),
  };
}

export interface AllowCard {
  title: string;
  season: number;
  games: number;
  rows: AllowRow[];
  note: string | null;
}

/** What one team gives up to this player's kind, with each stat's league rank. */
export async function readAllowCard(
  sport: TeamProductionSport,
  group: string | null,
  teamId: string,
): Promise<AllowCard | null> {
  const spec = allowSpecFor(sport, group);
  if (!spec) return null;
  const seasons = await rollupSeasons(sport);
  for (const season of seasons) {
    const prod = await readLeagueProduction(sport, season, null);
    const rows = sideRows(prod, spec.side);
    const mine = rows[teamId];
    if (!mine || mine.g < MIN_GAMES) continue;
    const built = spec.stats
      .map(([key, label]) => {
        const r = rankOne(rows, teamId, key);
        return r ? { ...r, label } : null;
      })
      .filter((r): r is AllowRow => r !== null);
    if (!built.length) continue;
    return {
      title: spec.title,
      season,
      games: mine.g,
      rows: built,
      note:
        spec.side === 'for'
          ? 'Rank 1st = the most productive attack, so the most this player will face.'
          : 'Rank 1st = gives up the most.',
    };
  }
  return null;
}

/**
 * A peer for the player-against-player compare — R10.2.
 *
 * NAMES ARE THE HARD PART, and the reason this is a server read at all. The
 * rollup knows who produced what, but `player_game_history` holds no names:
 * measured 2026-09-17, `athlete_crosswalk` names 1,629 of MLB's 1,657 producers
 * and 947 of the NHL's 1,123, and **nothing at all** for NBA, NFL, CFB or
 * soccer, whose ids are ESPN's. So the crosswalk answers where it can, and the
 * rest are named from each league's own team rosters — the same call the team
 * page already makes, one per team rather than one per player.
 */
/** ESPN's sport/league path per rollup sport, for the roster name lookup. */
export const ESPN_PATH: Partial<Record<TeamProductionSport, [string, string]>> = {
  nfl: ['football', 'nfl'],
  cfb: ['football', 'college-football'],
  nba: ['basketball', 'nba'],
  nhl: ['hockey', 'nhl'],
  soccer_epl: ['soccer', 'eng.1'],
  soccer_mls: ['soccer', 'usa.1'],
};

/** How many peers a picker offers. Beyond this the list is a scroll, not a choice. */
const PEER_LIMIT = 120;

/**
 * Names for a list of athletes — the crosswalk where it has them, each league's
 * team rosters for the rest. Shared by the peer picker (R10.2) and the Players
 * index (R10.5), which have the same problem: `player_game_history` holds ids,
 * not names.
 */
export async function resolveAthleteNames(
  sport: TeamProductionSport,
  rows: ReadonlyArray<{ athlete_id: string; team_id: string | null }>,
): Promise<Map<string, string>> {
  const named = new Map<string, string>();
  if (!rows.length) return named;
  const ids = rows.map((r) => String(r.athlete_id));
  for (const r of await pgAll<{ athlete_id: string; athlete_name: string }>(
    `SELECT athlete_id, athlete_name FROM athlete_crosswalk WHERE sport = ? AND athlete_id = ANY(?) AND athlete_name IS NOT NULL`,
    [sport, ids],
  )) {
    named.set(String(r.athlete_id), r.athlete_name);
  }
  const path = ESPN_PATH[sport];
  const missingTeams = [...new Set(rows.filter((r) => !named.has(String(r.athlete_id)) && r.team_id).map((r) => String(r.team_id)))];
  if (path && missingTeams.length) {
    const { espnAthleteNames } = await import('@/lib/sports/multiSport/teamSportEspn');
    // One roster call per team, and only for teams with someone still unnamed.
    // The helper caches per athlete, so a second call costs nothing.
    const perTeam = await Promise.all(
      missingTeams.map(async (teamId) => {
        const wanted = rows.filter((r) => String(r.team_id) === teamId).map((r) => String(r.athlete_id));
        try {
          return await espnAthleteNames(path[0], path[1], teamId, wanted);
        } catch {
          return new Map<string, { name: string; position: string | null }>();
        }
      }),
    );
    for (const map of perTeam) for (const [id, v] of map) if (!named.has(id)) named.set(id, v.name);
  }
  return named;
}

export async function readPeers(sport: TeamProductionSport, group: string | null, season: number): Promise<ComparePeer[]> {
  // MLB has no position rows, so its two kinds are told apart by whether the
  // player has pitched — the same rule `playerGroup` uses.
  const mlbRole = sport === 'mlb' ? (group === 'pitcher' ? 'pitcher' : 'hitter') : null;
  // The rollup holds one row per player PER TEAM, so a player traded mid-season
  // was offered once per stint (measured 2026-09-19: James Harden and CJ
  // McCollum twice among NBA guards), and the repeated id left stale options in
  // the dropdown. One row per player, as the Players index does (R10.5): games
  // and score summed across stints, his team the one he played for last.
  const rows = await pgAll<{ athlete_id: string; team_id: string | null; games: number; score: number; position: string | null }>(
    sport === 'mlb'
      ? `SELECT athlete_id, team_id, games, score, position FROM (
           SELECT DISTINCT ON (p.athlete_id) p.athlete_id, p.team_id, p.position,
                  sum(p.games) OVER (PARTITION BY p.athlete_id) AS games,
                  sum(p.score) OVER (PARTITION BY p.athlete_id) AS score
             FROM player_season_production p
            WHERE p.sport = 'mlb' AND p.season = ?
              AND (EXISTS (SELECT 1 FROM player_game_history h
                            WHERE h.sport = 'mlb' AND h.athlete_id = p.athlete_id AND h.season = p.season
                              AND (h.stats->>'pit_inningsPitched') IS NOT NULL)) = ?
            ORDER BY p.athlete_id, p.last_game_date DESC NULLS LAST
         ) one
         WHERE games >= 5
         ORDER BY score DESC LIMIT ${PEER_LIMIT}`
      : `SELECT athlete_id, team_id, games, score, position FROM (
           SELECT DISTINCT ON (athlete_id) athlete_id, team_id, position,
                  sum(games) OVER (PARTITION BY athlete_id) AS games,
                  sum(score) OVER (PARTITION BY athlete_id) AS score
             FROM player_season_production
            WHERE sport = ? AND season = ? AND position_group = ?
            ORDER BY athlete_id, last_game_date DESC NULLS LAST
         ) one
         WHERE games >= 3
         ORDER BY score DESC LIMIT ${PEER_LIMIT}`,
    sport === 'mlb' ? [season, mlbRole === 'pitcher'] : [sport, season, group ?? ''],
  );
  if (!rows.length) return [];

  const named = await resolveAthleteNames(sport, rows);

  return rows
    .map((r) => ({
      athleteId: String(r.athlete_id),
      name: named.get(String(r.athlete_id)) ?? '',
      teamId: r.team_id ? String(r.team_id) : null,
      games: Number(r.games),
      score: Number(r.score),
      position: r.position,
    }))
    // A peer nobody can name is a row of ids: left out rather than shown.
    .filter((p) => p.name);
}

/**
 * The picker's teams: the league's directory, kept to the ids the rollup
 * actually holds, so a team the app has no games for cannot be chosen and then
 * show an empty card.
 */
export async function readCompareTeams(sport: TeamProductionSport): Promise<CompareTeam[]> {
  const [directory, ids] = await Promise.all([
    loadTeamDirectory(sport),
    pgAll<{ team_id: string }>(`SELECT DISTINCT team_id FROM team_game_production WHERE sport = ?`, [sport]),
  ]);
  const held = new Set(ids.map((r) => String(r.team_id)));
  const out: CompareTeam[] = [];
  for (const id of held) {
    const t = directory.get(id);
    // A team the directory cannot name is still a real opponent; its id is a
    // worse label than its name but better than dropping it from the picker.
    out.push({ id, name: t?.name ?? `Team ${id}`, abbr: t?.abbr ?? id, logoUrl: t?.logoUrl ?? null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
