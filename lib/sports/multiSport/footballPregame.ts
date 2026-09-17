/**
 * The NFL and CFB game page's before-start research — R8.2b. As of kickoff
 * wherever the source allows it:
 *
 * - strength vs strength: `team_game_production` cut at the game date
 *   (`readGameStrength`); last season below four games. MEASURED 2026-09-17:
 *   NFL 2026 holds week 1 only, so week 2's pages read 2025.
 * - form coming in and head to head: ESPN team schedules (R7-C1), regular
 *   season and postseason finals before this game, by event id. Form reaches
 *   into last season: a week-2 game has one game this season (DET, BUF on
 *   2026-09-17), and G2 carried the last ten across the break.
 * - passing matchup (NFL): `team_target_profile` (R5d). It is a SEASON
 *   aggregate with no per-game rows, so it cannot be cut at kickoff: a past
 *   game's page shows the season as held now, and the card says so.
 * - prop history: `player_game_history`, keyed by ESPN athlete id.
 *
 * Server-only: reads Postgres.
 */

import { fetchTeamSeasonGames, type EspnSeasonGame } from './teamSportEspn';
import { readGameStrength, readLatestTeams, readPropHistory, type StrengthDef } from '@/lib/sports/shared/gamePregameServer';
import { readNflTeamTargets } from '@/lib/sports/nfl/teamTargets';
import type { NflTeamTargets } from '@/lib/sports/nfl/teamTargetShapes';
import type { FormGame, GamePregameCommon } from '@/lib/sports/shared/gameResearchShapes';
import { SEASON_MIN_GAMES } from '@/lib/sports/shared/season';
import type { FootballLeague } from './footballGameResearch';

export interface FootballPregame extends GamePregameCommon {
  /** NFL only; `null` for CFB, which has no target rows. */
  passing: {
    season: number;
    note: string | null;
    /** True when the game is over: the season aggregate includes games after it. */
    includesLaterGames: boolean;
    teams: Record<string, NflTeamTargets | null>;
  } | null;
  /** Each prop player's team in his latest game before this one: his side before there is a box score. */
  teamOf: Record<string, string>;
}

const ESPN_LEAGUE: Record<FootballLeague, string> = { nfl: 'nfl', cfb: 'college-football' };

const per = (key: string) => (s: Record<string, number>, g: number) => (g ? (s[key] ?? 0) / g : null);
const FOOTBALL_STRENGTH: StrengthDef[] = [
  { key: 'yards', label: 'Yards / game', decimals: 1, higherIsBetter: true, of: (s, g) => (g ? ((s['passing.passingYards'] ?? 0) + (s['rushing.rushingYards'] ?? 0)) / g : null) },
  { key: 'pass', label: 'Passing yards / game', decimals: 1, higherIsBetter: true, of: per('passing.passingYards') },
  { key: 'rush', label: 'Rushing yards / game', decimals: 1, higherIsBetter: true, of: per('rushing.rushingYards') },
  { key: 'ypa', label: 'Yards / pass attempt', decimals: 2, higherIsBetter: true, of: (s) => (s['passing.passingAttempts'] ? (s['passing.passingYards'] ?? 0) / s['passing.passingAttempts'] : null) },
  { key: 'ypc', label: 'Yards / carry', decimals: 2, higherIsBetter: true, of: (s) => (s['rushing.rushingAttempts'] ? (s['rushing.rushingYards'] ?? 0) / s['rushing.rushingAttempts'] : null) },
  { key: 'td', label: 'Offensive TDs / game', decimals: 2, higherIsBetter: true, of: (s, g) => (g ? ((s['passing.passingTouchdowns'] ?? 0) + (s['rushing.rushingTouchdowns'] ?? 0)) / g : null) },
  { key: 'sacks', label: 'Sacks taken / game', decimals: 2, higherIsBetter: false, of: per('passing.sacks') },
  { key: 'int', label: 'Interceptions thrown / game', decimals: 2, higherIsBetter: false, of: per('passing.interceptions') },
  { key: 'fum', label: 'Fumbles lost / game', decimals: 2, higherIsBetter: false, of: per('fumbles.fumblesLost') },
];

/** A market's number from one `player_game_history` row; groups a player had no stats in are simply absent, so they count zero. */
export function footballLogValue(market: string, s: Record<string, unknown>): number | null {
  const z = (k: string) => (s[k] == null || !Number.isFinite(Number(s[k])) ? 0 : Number(s[k]));
  switch (market) {
    case 'passing-yards': return z('passing.passingYards');
    case 'passing-tds': return z('passing.passingTouchdowns');
    case 'completions': return z('passing.completions');
    case 'pass-attempts':
    case 'passing-attempts': return z('passing.passingAttempts');
    case 'interceptions': return z('passing.interceptions');
    case 'rushing-yards': return z('rushing.rushingYards');
    case 'rushing-attempts': return z('rushing.rushingAttempts');
    case 'receiving-yards': return z('receiving.receivingYards');
    case 'receptions': return z('receiving.receptions');
    case 'longest-reception': return z('receiving.longReception');
    case 'rush-rec-yards': return z('rushing.rushingYards') + z('receiving.receivingYards');
    case 'pass-rush-yards': return z('passing.passingYards') + z('rushing.rushingYards');
    // Solo, as `footballMarketResult` settles it (DraftKings' "tackles").
    case 'tackles': return z('defensive.soloTackles');
    case 'assists': return z('defensive.totalTackles') - z('defensive.soloTackles');
    case 'sacks': return z('defensive.sacks');
    case 'anytime-td': return z('rushing.rushingTouchdowns') + z('receiving.receivingTouchdowns') > 0 ? 1 : 0;
    default: return null;
  }
}

/** The US Eastern date of a start, which `player_game_history.game_date` and the rollups use. */
export const easternDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export function formGameFrom(teamId: string, g: EspnSeasonGame): FormGame | null {
  const home = g.home.id === teamId;
  const us = home ? g.home : g.away;
  const them = home ? g.away : g.home;
  if (us.score == null || them.score == null) return null;
  return { pk: g.id, date: easternDate(g.start), home, opponentId: them.id, opponentAbbr: them.abbr, us: us.score, them: them.score, postseason: g.postseason };
}

const MEMO_MS = 30 * 60_000;
const memo = new Map<string, { value: FootballPregame; expiresAt: number }>();

export interface FootballPregameInput {
  league: FootballLeague;
  eventId: string;
  start: string;
  season: number;
  awayId: string;
  homeId: string;
  /** Props with a main line: `key` is `${athleteId}|${market}`. */
  props: Array<{ athleteId: string; market: string }>;
  /** Kickoff has passed: nothing here can change, and a live page polls. */
  memoize: boolean;
  /** The game is over, so a season aggregate includes games after it. */
  final: boolean;
}

export async function readFootballPregame(input: FootballPregameInput): Promise<FootballPregame> {
  const k = `${input.league}:${input.eventId}`;
  if (input.memoize) {
    const hit = memo.get(k);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }
  const value = await read(input);
  if (input.memoize) memo.set(k, { value, expiresAt: Date.now() + MEMO_MS });
  return value;
}

async function read(input: FootballPregameInput): Promise<FootballPregame> {
  const { league, eventId, start, season, awayId, homeId } = input;
  const date = easternDate(start);
  const teamIds = [awayId, homeId];
  const current = new Date().getUTCFullYear();
  const schedule = (teamId: string, s: number) => fetchTeamSeasonGames('football', ESPN_LEAGUE[league], teamId, s, s < current).catch((): EspnSeasonGame[] => []);
  const [str, awaySched, homeSched, awayLast, homeLast, history, teamOf] = await Promise.all([
    readGameStrength(league, season, date, teamIds, FOOTBALL_STRENGTH).catch(() => ({ season, note: null, rows: [] })),
    schedule(awayId, season),
    schedule(homeId, season),
    schedule(awayId, season - 1),
    schedule(homeId, season - 1),
    readPropHistory(league, input.props.map((p) => ({ key: `${p.athleteId}|${p.market}`, athleteId: p.athleteId, market: p.market })), [season - 1, season], date, teamIds, footballLogValue).catch(() => ({})),
    readLatestTeams(league, [...new Set(input.props.map((p) => p.athleteId))], date).catch(() => ({})),
  ]);
  const before = (g: EspnSeasonGame) => g.state === 'final' && g.id !== eventId && Date.parse(g.start) < Date.parse(start);
  const formOf = (teamId: string, games: EspnSeasonGame[]) => games.filter(before).map((g) => formGameFrom(teamId, g)).filter((g): g is FormGame => g != null);
  const h2h = formOf(awayId, [...awayLast, ...awaySched].filter((g) => g.home.id === homeId || g.away.id === homeId));

  let passing: FootballPregame['passing'] = null;
  if (league === 'nfl') {
    const [a, h] = await Promise.all([readNflTeamTargets(season, awayId).catch(() => null), readNflTeamTargets(season, homeId).catch(() => null)]);
    const thin = Math.min(a?.offense?.games ?? 0, h?.offense?.games ?? 0) < SEASON_MIN_GAMES.nfl;
    if (thin) {
      const [a1, h1] = await Promise.all([readNflTeamTargets(season - 1, awayId).catch(() => null), readNflTeamTargets(season - 1, homeId).catch(() => null)]);
      passing = { season: season - 1, note: `${season} has fewer than ${SEASON_MIN_GAMES.nfl} games of targets for at least one side, so these are ${season - 1}'s.`, includesLaterGames: false, teams: { [awayId]: a1, [homeId]: h1 } };
    } else {
      passing = { season, note: null, includesLaterGames: input.final, teams: { [awayId]: a, [homeId]: h } };
    }
  }

  return {
    strengthSeason: str.season,
    strengthNote: str.note,
    strength: str.rows,
    form: { [awayId]: { games: formOf(awayId, [...awayLast, ...awaySched]) }, [homeId]: { games: formOf(homeId, [...homeLast, ...homeSched]) } },
    h2h,
    propHistory: history,
    passing,
    teamOf,
  };
}
