/**
 * MLB's before-start research for the game page — R8.1b. Everything here is
 * AS OF THE START: rollups are cut at the game date, schedules and game logs
 * keep only earlier games, and the Statcast starters card is the one the
 * rollup kept from kickoff. A final game's page shows this below its recap.
 *
 * - strength vs strength: `team_game_production` (R5b) with a date cutoff, each
 *   side's production against what the other allows, ranked across the league;
 *   last season while this one is under MIN_GAMES (R2);
 * - form coming in and head-to-head: StatsAPI team schedules, regular season,
 *   by game pk (R6-F5: never `game_result` by date);
 * - starters and lineups: `mlb_statcast_game_pregame` (R5a). It began with
 *   games on 2026-09-11, with days missing since; a game without one says so;
 * - prop history: `player_game_history` for the players with a main line;
 * - injuries: StatsAPI rosters.
 *
 * Server-only: reads Postgres.
 */

import { getInjuries, getTeamSeasonSchedule, type InjuryEntry, type MlbTeamScheduleGame } from './statsapi';
import { readGamePregameStatcast } from './statcastRollups';
import type { GamePregameStatcast } from './statcastRollupShapes';
import { readLeagueProduction } from '@/lib/sports/shared/teamProduction';
import { SEASON_MIN_GAMES, realTeams } from '@/lib/sports/shared/season';
import { pgAll } from '@/lib/db/pgClient';

export interface StrengthRow {
  key: string;
  label: string;
  decimals: number;
  percent?: boolean;
  /** Which way is better for the side producing it (a batter's K% is better lower). */
  higherIsBetter: boolean;
  /** Per team id: what it produced, and what opponents produced against it, with league ranks (1 = best for that team). */
  teams: Record<string, { produced: { value: number; rank: number; of: number } | null; allowed: { value: number; rank: number; of: number } | null }>;
}

export interface FormGame {
  pk: number;
  date: string;
  home: boolean;
  opponentId: string;
  opponentAbbr: string;
  us: number;
  them: number;
}

export interface MlbPregame {
  /** The season the strength rows read (last season early in this one). */
  strengthSeason: number;
  strengthNote: string | null;
  strength: StrengthRow[];
  /** Per team id: every regular-season final before this game this season, oldest first. */
  form: Record<string, { games: FormGame[] }>;
  /** Meetings this season and last, before this game, oldest first, from the away team's side. */
  h2h: FormGame[];
  starters: GamePregameStatcast | null;
  /** `${playerId}|${market}`: the player's last 20 games before this one, plus every earlier game against either team here, oldest first: [date, value, opponent id]. */
  propHistory: Record<string, Array<[string, number, string]>>;
  injuries: Record<string, InjuryEntry[]>;
}

const STRENGTH: Array<{ key: string; label: string; decimals: number; percent?: boolean; higherIsBetter: boolean; of: (s: Record<string, number>, g: number) => number | null }> = [
  { key: 'runs', label: 'Runs / game', decimals: 2, higherIsBetter: true, of: (s, g) => (g ? (s.bat_runs ?? 0) / g : null) },
  { key: 'hits', label: 'Hits / game', decimals: 2, higherIsBetter: true, of: (s, g) => (g ? (s.bat_hits ?? 0) / g : null) },
  { key: 'hr', label: 'Home runs / game', decimals: 2, higherIsBetter: true, of: (s, g) => (g ? (s.bat_homeRuns ?? 0) / g : null) },
  { key: 'tb', label: 'Total bases / game', decimals: 2, higherIsBetter: true, of: (s, g) => (g ? (s.bat_totalBases ?? 0) / g : null) },
  { key: 'bb', label: 'Walk %', decimals: 1, percent: true, higherIsBetter: true, of: (s) => (s.bat_plateAppearances ? (100 * (s.bat_baseOnBalls ?? 0)) / s.bat_plateAppearances : null) },
  { key: 'k', label: 'Strikeout %', decimals: 1, percent: true, higherIsBetter: false, of: (s) => (s.bat_plateAppearances ? (100 * (s.bat_strikeOuts ?? 0)) / s.bat_plateAppearances : null) },
  { key: 'sb', label: 'Stolen bases / game', decimals: 2, higherIsBetter: true, of: (s, g) => (g ? (s.bat_stolenBases ?? 0) / g : null) },
];

/** 1 = best: the most of a stat where more is better, the fewest where less is. Ties share the better rank. */
export function rankOf(value: number, pool: number[], betterHigh: boolean) {
  return { value, rank: pool.filter((v) => (betterHigh ? v > value : v < value)).length + 1, of: pool.length };
}

async function strength(season: number, date: string, teamIds: string[]): Promise<{ season: number; note: string | null; rows: StrengthRow[] }> {
  let used = season;
  let before: string | null = date;
  let prod = await readLeagueProduction('mlb', season, before);
  const played = Math.min(...teamIds.map((id) => prod.for[id]?.g ?? 0));
  let note: string | null = null;
  if (played < SEASON_MIN_GAMES.mlb) {
    used = season - 1;
    before = null;
    prod = await readLeagueProduction('mlb', used, null);
    note = `${season} had ${played} ${played === 1 ? 'game' : 'games'} before this one, so these are ${used}'s numbers.`;
  }
  const pool = realTeams(Object.entries(prod.for).map(([teamId, t]) => ({ teamId, games: t.g }))).map((t) => t.teamId);
  const rows = STRENGTH.map((def) => {
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

const REGULAR = (g: MlbTeamScheduleGame) => g.gameType === 'R' && g.state === 'final' && g.homeScore != null && g.awayScore != null;

function asForm(teamId: number, g: MlbTeamScheduleGame): FormGame {
  const home = g.homeId === teamId;
  return {
    pk: g.gamePk,
    date: g.officialDate,
    home,
    opponentId: String(home ? g.awayId : g.homeId),
    opponentAbbr: home ? g.awayAbbr : g.homeAbbr,
    us: (home ? g.homeScore : g.awayScore) ?? 0,
    them: (home ? g.awayScore : g.homeScore) ?? 0,
  };
}

/** A market's number from one game-log row, or null where the row has no such stat. */
export function marketValue(market: string, s: Record<string, unknown>): number | null {
  const n = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : Number.isFinite(Number(s[k])) && s[k] != null ? Number(s[k]) : null);
  const bat = n('bat_plateAppearances') != null;
  const pit = s.pit_inningsPitched != null;
  switch (market) {
    case 'hits': return bat ? n('bat_hits') : null;
    case 'total-bases': return bat ? n('bat_totalBases') : null;
    case 'home-runs': return bat ? n('bat_homeRuns') : null;
    case 'rbis': return bat ? n('bat_rbi') : null;
    case 'runs': return bat ? n('bat_runs') : null;
    case 'walks': return bat ? n('bat_baseOnBalls') : null;
    case 'batter-strikeouts': return bat ? n('bat_strikeOuts') : null;
    case 'doubles': return bat ? n('bat_doubles') : null;
    case 'triples': return bat ? n('bat_triples') : null;
    case 'stolen-bases': return bat ? n('bat_stolenBases') : null;
    case 'singles': return bat ? (n('bat_hits') ?? 0) - (n('bat_doubles') ?? 0) - (n('bat_triples') ?? 0) - (n('bat_homeRuns') ?? 0) : null;
    case 'hits-runs-rbis': return bat ? (n('bat_hits') ?? 0) + (n('bat_runs') ?? 0) + (n('bat_rbi') ?? 0) : null;
    case 'pitcher-strikeouts': return pit ? n('pit_strikeOuts') : null;
    case 'pitcher-outs': {
      if (!pit) return null;
      const ip = Number(s.pit_inningsPitched);
      return Number.isFinite(ip) ? Math.floor(ip) * 3 + Math.round((ip - Math.floor(ip)) * 10) : null;
    }
    case 'earned-runs': return pit ? n('pit_earnedRuns') : null;
    case 'pitcher-hits-allowed': return pit ? n('pit_hits') : null;
    case 'pitcher-walks': return pit ? n('pit_baseOnBalls') : null;
    default: return null;
  }
}

const HISTORY_RECENT = 20;

async function propHistory(props: Array<{ playerId: string; market: string }>, season: number, date: string, teamIds: string[]): Promise<MlbPregame['propHistory']> {
  const ids = [...new Set(props.map((p) => p.playerId))];
  if (!ids.length) return {};
  const rows = await pgAll<{ athlete_id: string; game_date: Date | string; opponent_id: string | null; stats: unknown }>(
    `SELECT athlete_id, game_date, opponent_id, stats FROM player_game_history
      WHERE sport = 'mlb' AND athlete_id = ANY(?) AND season IN (?, ?) AND game_date < ?
      ORDER BY game_date`,
    [ids, season - 1, season, date],
  );
  const out: MlbPregame['propHistory'] = {};
  for (const p of props) out[`${p.playerId}|${p.market}`] = [];
  for (const r of rows) {
    const stats = (typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats) as Record<string, unknown>;
    const d = (r.game_date instanceof Date ? r.game_date.toISOString() : String(r.game_date)).slice(0, 10);
    for (const p of props) {
      if (p.playerId !== String(r.athlete_id)) continue;
      const v = marketValue(p.market, stats);
      if (v != null) out[`${p.playerId}|${p.market}`].push([d, v, String(r.opponent_id ?? '')]);
    }
  }
  for (const [k, games] of Object.entries(out)) {
    out[k] = games.filter((g, i) => i >= games.length - HISTORY_RECENT || teamIds.includes(g[2]));
  }
  return out;
}

export async function readMlbPregame(input: { gamePk: number; date: string; season: number; awayId: number; homeId: number; props: Array<{ playerId: string; market: string }> }): Promise<MlbPregame> {
  const { gamePk, date, season, awayId, homeId } = input;
  const [str, awaySched, homeSched, awayLast, starters, history, awayInj, homeInj] = await Promise.all([
    strength(season, date, [String(awayId), String(homeId)]).catch(() => ({ season, note: null, rows: [] })),
    getTeamSeasonSchedule(awayId, season).catch(() => []),
    getTeamSeasonSchedule(homeId, season).catch(() => []),
    getTeamSeasonSchedule(awayId, season - 1).catch(() => []),
    readGamePregameStatcast(gamePk).catch(() => null),
    propHistory(input.props, season, date, [String(awayId), String(homeId)]).catch(() => ({})),
    getInjuries(awayId, season).catch(() => []),
    getInjuries(homeId, season).catch(() => []),
  ]);
  const before = (g: MlbTeamScheduleGame) => REGULAR(g) && g.officialDate < date && g.gamePk !== gamePk;
  const h2h = [...awayLast, ...awaySched]
    .filter((g) => before(g) && (g.homeId === homeId || g.awayId === homeId))
    .map((g) => asForm(awayId, g));
  return {
    strengthSeason: str.season,
    strengthNote: str.note,
    strength: str.rows,
    form: {
      [String(awayId)]: { games: awaySched.filter(before).map((g) => asForm(awayId, g)) },
      [String(homeId)]: { games: homeSched.filter(before).map((g) => asForm(homeId, g)) },
    },
    h2h,
    starters,
    propHistory: history,
    injuries: { [String(awayId)]: awayInj, [String(homeId)]: homeInj },
  };
}
