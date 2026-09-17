/**
 * The before-start reads every team sport's game page shares — R8.1b built
 * them for MLB, R8.2b made them sport-neutral for football:
 *
 * - strength vs strength: `team_game_production` (R5b) with a date cutoff, each
 *   side's production against what the other allows, ranked league-wide; last
 *   season while either team is under `SEASON_MIN_GAMES` (R2);
 * - prop history: `player_game_history`, the player's recent games and every
 *   earlier one against either team in this game.
 *
 * A sport supplies the stat definitions and how a game-log row settles a
 * market. Server-only: reads Postgres.
 */

import { readLeagueProduction } from './teamProduction';
import type { TeamProductionSport } from './teamProductionShapes';
import { SEASON_MIN_GAMES, realTeams } from './season';
import { pgAll } from '@/lib/db/pgClient';
import type { StrengthRow } from './gameResearchShapes';

export interface StrengthDef {
  key: string;
  label: string;
  decimals: number;
  percent?: boolean;
  higherIsBetter: boolean;
  /** The per-game number from a team's summed stats over `g` games; `null` where there is nothing to divide. */
  of: (s: Record<string, number>, g: number) => number | null;
}

/** 1 = best: the most of a stat where more is better, the fewest where less is. Ties share the better rank. */
export function rankOf(value: number, pool: number[], betterHigh: boolean) {
  return { value, rank: pool.filter((v) => (betterHigh ? v > value : v < value)).length + 1, of: pool.length };
}

export async function readGameStrength(
  sport: TeamProductionSport,
  season: number,
  date: string,
  teamIds: string[],
  defs: StrengthDef[],
): Promise<{ season: number; note: string | null; rows: StrengthRow[] }> {
  let used = season;
  let prod = await readLeagueProduction(sport, season, date);
  const played = Math.min(...teamIds.map((id) => prod.for[id]?.g ?? 0));
  let note: string | null = null;
  if (played < (SEASON_MIN_GAMES[sport] ?? 0)) {
    used = season - 1;
    prod = await readLeagueProduction(sport, used, null);
    note = `${season} had ${played} ${played === 1 ? 'game' : 'games'} before this one for at least one side, so these are ${used}'s numbers.`;
  }
  const pool = realTeams(Object.entries(prod.for).map(([teamId, t]) => ({ teamId, games: t.g }))).map((t) => t.teamId);
  const rows = defs.map((def) => {
    const produced = new Map(pool.map((id) => [id, def.of(prod.for[id]?.s ?? {}, prod.for[id]?.g ?? 0)]));
    const allowed = new Map(pool.map((id) => [id, def.of(prod.allowed[id]?.s ?? {}, prod.allowed[id]?.g ?? 0)]));
    const prodPool = [...produced.values()].filter((v): v is number => v != null);
    const allowPool = [...allowed.values()].filter((v): v is number => v != null);
    const teams: StrengthRow['teams'] = {};
    for (const id of teamIds) {
      const p = produced.get(id);
      const a = allowed.get(id);
      // Allowing a stat is good in the opposite direction to producing it.
      teams[id] = { produced: p == null ? null : rankOf(p, prodPool, def.higherIsBetter), allowed: a == null ? null : rankOf(a, allowPool, !def.higherIsBetter) };
    }
    return { key: def.key, label: def.label, decimals: def.decimals, percent: def.percent, higherIsBetter: def.higherIsBetter, teams };
  });
  return { season: used, note, rows };
}

/** Each player's team in his latest game before `date`: a prop player's side before there is a box score. */
export async function readLatestTeams(sport: string, athleteIds: string[], date: string): Promise<Record<string, string>> {
  if (!athleteIds.length) return {};
  const rows = await pgAll<{ athlete_id: string; team_id: string | null }>(
    `SELECT DISTINCT ON (athlete_id) athlete_id, team_id FROM player_game_history
      WHERE sport = ? AND athlete_id = ANY(?) AND game_date < ?
      ORDER BY athlete_id, game_date DESC`,
    [sport, athleteIds, date],
  );
  return Object.fromEntries(rows.filter((r) => r.team_id).map((r) => [String(r.athlete_id), String(r.team_id)]));
}

const HISTORY_RECENT = 20;

/**
 * Each prop player's number in its market, game by game, before `date`: the
 * last 20 plus every earlier game against either team here. `athleteId` is the
 * id `player_game_history` keys the player by; the result is keyed by `key`.
 */
export async function readPropHistory(
  sport: string,
  props: Array<{ key: string; athleteId: string; market: string }>,
  seasons: number[],
  date: string,
  teamIds: string[],
  valueOf: (market: string, stats: Record<string, unknown>) => number | null,
): Promise<Record<string, Array<[string, number, string]>>> {
  const ids = [...new Set(props.map((p) => p.athleteId))];
  if (!ids.length) return {};
  const rows = await pgAll<{ athlete_id: string; game_date: Date | string; opponent_id: string | null; stats: unknown }>(
    `SELECT athlete_id, game_date, opponent_id, stats FROM player_game_history
      WHERE sport = ? AND athlete_id = ANY(?) AND season = ANY(?) AND game_date < ?
      ORDER BY game_date`,
    [sport, ids, seasons, date],
  );
  const out: Record<string, Array<[string, number, string]>> = {};
  for (const p of props) out[p.key] = [];
  for (const r of rows) {
    const stats = (typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats) as Record<string, unknown>;
    const d = (r.game_date instanceof Date ? r.game_date.toISOString() : String(r.game_date)).slice(0, 10);
    for (const p of props) {
      if (p.athleteId !== String(r.athlete_id)) continue;
      const v = valueOf(p.market, stats);
      if (v != null) out[p.key].push([d, v, String(r.opponent_id ?? '')]);
    }
  }
  for (const [k, games] of Object.entries(out)) out[k] = games.filter((g, i) => i >= games.length - HISTORY_RECENT || teamIds.includes(g[2]));
  return out;
}
