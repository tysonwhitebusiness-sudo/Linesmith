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
import { readGameStrength, readPropHistory, type StrengthDef } from '@/lib/sports/shared/gamePregameServer';
import type { FormGame, GamePregameCommon } from '@/lib/sports/shared/gameResearchShapes';

export { rankOf } from '@/lib/sports/shared/gamePregameServer';
export type { FormGame, StrengthRow } from '@/lib/sports/shared/gameResearchShapes';

export interface MlbPregame extends GamePregameCommon {
  starters: GamePregameStatcast | null;
  injuries: Record<string, InjuryEntry[]>;
}

const STRENGTH: StrengthDef[] = [
  { key: 'runs', label: 'Runs / game', decimals: 2, higherIsBetter: true, of: (s, g) => (g ? (s.bat_runs ?? 0) / g : null) },
  { key: 'hits', label: 'Hits / game', decimals: 2, higherIsBetter: true, of: (s, g) => (g ? (s.bat_hits ?? 0) / g : null) },
  { key: 'hr', label: 'Home runs / game', decimals: 2, higherIsBetter: true, of: (s, g) => (g ? (s.bat_homeRuns ?? 0) / g : null) },
  { key: 'tb', label: 'Total bases / game', decimals: 2, higherIsBetter: true, of: (s, g) => (g ? (s.bat_totalBases ?? 0) / g : null) },
  { key: 'bb', label: 'Walk %', decimals: 1, percent: true, higherIsBetter: true, of: (s) => (s.bat_plateAppearances ? (100 * (s.bat_baseOnBalls ?? 0)) / s.bat_plateAppearances : null) },
  { key: 'k', label: 'Strikeout %', decimals: 1, percent: true, higherIsBetter: false, of: (s) => (s.bat_plateAppearances ? (100 * (s.bat_strikeOuts ?? 0)) / s.bat_plateAppearances : null) },
  { key: 'sb', label: 'Stolen bases / game', decimals: 2, higherIsBetter: true, of: (s, g) => (g ? (s.bat_stolenBases ?? 0) / g : null) },
];

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

const MEMO_MS = 30 * 60_000;
const memo = new Map<number, { value: MlbPregame; expiresAt: number }>();

type PregameInput = { gamePk: number; date: string; season: number; awayId: number; homeId: number; props: Array<{ playerId: string; market: string }>; memoize?: boolean };

/**
 * `memoize` is for a game already under way: every read is cut before it, so
 * the answer cannot change, and the live page's 15-second refresh should not
 * re-sum a league's production each time. Process memory, like the StatsAPI
 * reads it sits beside; a restart reads it again.
 */
export async function readMlbPregame(input: PregameInput): Promise<MlbPregame> {
  if (!input.memoize) return readPregame(input);
  const hit = memo.get(input.gamePk);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await readPregame(input);
  memo.set(input.gamePk, { value, expiresAt: Date.now() + MEMO_MS });
  return value;
}

async function readPregame(input: PregameInput): Promise<MlbPregame> {
  const { gamePk, date, season, awayId, homeId } = input;
  const [str, awaySched, homeSched, awayLast, starters, history, awayInj, homeInj] = await Promise.all([
    readGameStrength('mlb', season, date, [String(awayId), String(homeId)], STRENGTH).catch(() => ({ season, note: null, rows: [] })),
    getTeamSeasonSchedule(awayId, season).catch(() => []),
    getTeamSeasonSchedule(homeId, season).catch(() => []),
    getTeamSeasonSchedule(awayId, season - 1).catch(() => []),
    readGamePregameStatcast(gamePk).catch(() => null),
    readPropHistory('mlb', input.props.map((p) => ({ key: `${p.playerId}|${p.market}`, athleteId: p.playerId, market: p.market })), [season - 1, season], date, [String(awayId), String(homeId)], marketValue).catch(() => ({})),
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
