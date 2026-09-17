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
import { allowSpecFor, type AllowRow, type AllowSide, type CompareTeam } from './compareShapes';
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
