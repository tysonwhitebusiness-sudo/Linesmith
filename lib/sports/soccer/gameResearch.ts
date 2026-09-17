/**
 * The soccer game page read — R8.3a, EPL and MLS. One `GameResearchPayload` for
 * any match by ESPN event id, past, live or scheduled.
 *
 * - status, teams, key events (goals, cards, substitutions), commentary with
 *   pitch positions, lineups, team stats and each player's match stats: ESPN's
 *   summary (`fetchEspnSummary`, R4 parsers). ESPN publishes no win probability
 *   for soccer.
 * - shot positions: commentary `fieldPositionX/Y`. MEASURED on MUN v MCI
 *   (401879278): 91 of 116 commentary events located, every one normalised to
 *   the team in possession attacking x = 100 (United's and City's shots both
 *   sit at x 72-86; Haaland's goal at 97.5). The page mirrors the away side.
 * - lines: pickcenter, DraftKings' three-way open and close. `game_odds_history`
 *   holds soccer MONEYLINES ONLY and no draw side (4 books, away and home), so
 *   the draw and the spread and total come from pickcenter.
 * - player props: main lines and yes/no markets (anytime and first scorer,
 *   two or more goals), resolved against each player's match stats in the
 *   summary's rosters, by ESPN athlete id (`espn:soccer:{id}`).
 * - before the start: strength vs strength (`team_game_production`), form and
 *   head to head (ESPN schedules), prop history (`player_game_history`).
 *
 * Server-only: reads Postgres.
 */

import { fetchEspnSummary, type EspnLeaguePath } from '@/lib/sports/espn/summary';
import { parseCommentary, parseGameLines, parseInjuries, parseLineups, type CommentaryEvent, type GameLines, type InjuryReport, type Lineup } from '@/lib/sports/espn/summaryParsers';
import { readPreGamePropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import { readInGameLines, readPreGameOpenClose, type GameLineOpenClose, type InGameLines } from '@/lib/odds/gameLineHistory';
import { gameMainLines, type GameMainLine, type GameYesNo } from '@/lib/odds/props/gameProps';
import type { GamePregameCommon, GameResearchPayload, GameSide, GameState } from '@/lib/sports/shared/gameResearchShapes';
import { readGameStrength, readLatestTeams, readPropHistory, type StrengthDef } from '@/lib/sports/shared/gamePregameServer';
import { easternDate, readEspnForm } from '@/lib/sports/multiSport/gameFormEspn';
import { seasonForDate } from '@/lib/sports/shared/season';

export type SoccerGameSport = 'soccer_epl' | 'soccer_mls';

const ESPN_LEAGUE: Record<SoccerGameSport, string> = { soccer_epl: 'eng.1', soccer_mls: 'usa.1' };
const ROUTE_LEAGUE: Record<SoccerGameSport, string> = { soccer_epl: 'epl', soccer_mls: 'mls' };

export interface SoccerKeyEvent {
  id: string;
  type: string;
  teamId: string | null;
  /** "60'", "45'+2'". */
  minute: string | null;
  /** Seconds of match time, for ordering and the timeline. */
  seconds: number | null;
  text: string | null;
  athleteIds: string[];
}

export interface SoccerPropResult {
  athleteId: string;
  name: string;
  market: string;
  /** `null` for a yes/no market (anytime scorer), which is settled as over 0.5 or 1.5. */
  line: number | null;
  over: { price: number; book: string };
  under: { price: number; book: string } | null;
  books: number;
  side: 'away' | 'home' | null;
  /** The player's number from the match; `null` before the start or when he was not in the squad. */
  result: number | null;
}

export interface SoccerPregame extends GamePregameCommon {
  teamOf: Record<string, string>;
}

export interface SoccerGameResearchPayload extends GameResearchPayload {
  soccer: {
    sport: SoccerGameSport;
    /** The route's league segment: `/soccer/{league}/...`. */
    league: string;
    keyEvents: SoccerKeyEvent[];
    commentary: CommentaryEvent[];
    lineups: Lineup[];
    teamStats: Array<{ key: string; label: string; away: string; home: string }>;
    lines: GameLines | null;
    storedLines: GameLineOpenClose[];
    props: SoccerPropResult[];
    propsAltOnly: number;
    injuries: InjuryReport;
    pregame: SoccerPregame;
    live: { minute: string | null; inGame: InGameLines } | null;
  };
}

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function soccerGameState(summary: J): GameState | null {
  const type = summary?.header?.competitions?.[0]?.status?.type;
  if (!type) return null;
  if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED|ABANDONED/.test(String(type.name ?? ''))) return 'postponed';
  if (type.state === 'post' || type.completed === true) return 'final';
  if (type.state === 'in') return 'live';
  return 'pre';
}

const leaguePath = (sport: SoccerGameSport): EspnLeaguePath => `soccer/${ESPN_LEAGUE[sport]}`;

export async function soccerStateOf(sport: SoccerGameSport, eventId: string): Promise<GameState | null> {
  return soccerGameState(await fetchEspnSummary(leaguePath(sport), eventId));
}

/** Each player's match stats from the summary's rosters, by athlete id. */
export function soccerPlayerStats(summary: J): Record<string, { teamId: string; stats: Record<string, number> }> {
  const out: Record<string, { teamId: string; stats: Record<string, number> }> = {};
  for (const r of summary?.rosters ?? []) {
    for (const p of r.roster ?? []) {
      const id = p.athlete?.id;
      if (id == null) continue;
      out[String(id)] = { teamId: String(r.team?.id ?? ''), stats: Object.fromEntries((p.stats ?? []).map((s: J) => [String(s.name), Number(s.value) || 0])) };
    }
  }
  return out;
}

/** The athlete who scored the first goal, from the key events; `null` before one. Own goals count for nobody. */
export function firstScorer(events: SoccerKeyEvent[]): string | null {
  const goal = [...events].sort((a, b) => (a.seconds ?? 0) - (b.seconds ?? 0)).find((e) => /goal/i.test(e.type) && !/own goal/i.test(e.type) && !/disallowed/i.test(e.type));
  return goal?.athleteIds[0] ?? null;
}

/**
 * A soccer market's number: goals, assists, shots, shots on target, and the
 * yes/no markets as 1 or 0 (anytime scorer is at least one goal, two-plus is at
 * least two, first scorer scored the first goal). Keys match both the summary's
 * roster stats and `player_game_history.stats`.
 */
export function soccerMarketValue(market: string, s: Record<string, unknown>, isFirstScorer = false): number | null {
  const z = (k: string) => (s[k] == null || !Number.isFinite(Number(s[k])) ? 0 : Number(s[k]));
  switch (market) {
    case 'goals': return z('totalGoals');
    case 'assists': return z('goalAssists');
    case 'shots': return z('totalShots');
    case 'shots-on-target': return z('shotsOnTarget');
    case 'goals-assists': return z('totalGoals') + z('goalAssists');
    case 'anytime-goalscorer': return z('totalGoals') >= 1 ? 1 : 0;
    case 'two-plus-goals': return z('totalGoals') >= 2 ? 1 : 0;
    case 'first-goalscorer': return isFirstScorer ? 1 : 0;
    default: return null;
  }
}

/**
 * Goals are `goals`, the team's real score, not the summed `totalGoals`: ESPN
 * credits an own goal to the defender, so the players' sum fell short of the
 * table (R8.3-F1: EPL 2025-26 City 74 against ESPN's 77). The Python rollup
 * adds the opponent's own goals; City 77/35 and United 69/50 now match ESPN.
 * Goals per shot keeps `totalGoals`, since an own goal comes from no shot.
 */
const SOCCER_STRENGTH: StrengthDef[] = [
  { key: 'goals', label: 'Goals / match', decimals: 2, higherIsBetter: true, of: (s, g) => (g ? (s.goals ?? 0) / g : null) },
  { key: 'shots', label: 'Shots / match', decimals: 1, higherIsBetter: true, of: (s, g) => (g ? (s.totalShots ?? 0) / g : null) },
  { key: 'sot', label: 'Shots on target / match', decimals: 1, higherIsBetter: true, of: (s, g) => (g ? (s.shotsOnTarget ?? 0) / g : null) },
  { key: 'conv', label: 'Goals per shot', decimals: 1, percent: true, higherIsBetter: true, of: (s) => (s.totalShots ? (100 * (s.totalGoals ?? 0)) / s.totalShots : null) },
  { key: 'onTarget', label: 'Shots on target %', decimals: 1, percent: true, higherIsBetter: true, of: (s) => (s.totalShots ? (100 * (s.shotsOnTarget ?? 0)) / s.totalShots : null) },
  { key: 'fouls', label: 'Fouls won / match', decimals: 1, higherIsBetter: true, of: (s, g) => (g ? (s.foulsSuffered ?? 0) / g : null) },
  { key: 'cards', label: 'Yellow cards / match', decimals: 2, higherIsBetter: false, of: (s, g) => (g ? (s.yellowCards ?? 0) / g : null) },
];

function side(comp: J | undefined, sport: SoccerGameSport, state: GameState): GameSide {
  const t = comp?.team ?? {};
  const rec = (comp?.record ?? []).find((r: J) => r.type === 'total')?.summary ?? null;
  return {
    id: String(t.id ?? ''),
    name: String(t.displayName ?? t.name ?? ''),
    abbr: String(t.abbreviation ?? ''),
    logoUrl: t.logos?.[0]?.href ?? t.logo ?? null,
    href: t.id != null ? `/soccer/${ROUTE_LEAGUE[sport]}/team/${t.id}` : null,
    score: state === 'pre' || comp?.score == null ? null : num(comp.score),
    record: rec,
  };
}

const MEMO_MS = 30 * 60_000;
const memo = new Map<string, { value: SoccerPregame; expiresAt: number }>();

export async function readSoccerGameResearch(sport: SoccerGameSport, eventId: string, now: Date = new Date()): Promise<SoccerGameResearchPayload | null> {
  const summary: J = await fetchEspnSummary(leaguePath(sport), eventId);
  const comp = summary?.header?.competitions?.[0];
  const state = soccerGameState(summary);
  if (!comp || !state) return null;
  const awayComp = (comp.competitors ?? []).find((c: J) => c.homeAway === 'away');
  const homeComp = (comp.competitors ?? []).find((c: J) => c.homeAway === 'home');
  const away = side(awayComp, sport, state);
  const home = side(homeComp, sport, state);
  const start: string = comp.date ?? '';
  const started = state === 'live' || state === 'final';
  const fetchedAt = now.toISOString();

  const [storedLines, propRows, inGame] = await Promise.all([
    readPreGameOpenClose(eventId, start).catch((): GameLineOpenClose[] => []),
    readPreGamePropOddsForGame(eventId, start).catch((): PropOddsRow[] => []),
    state === 'live' ? readInGameLines(eventId, start, now).catch((): InGameLines => ({ now: [], moneyline: [] })) : Promise.resolve(null),
  ]);

  const keyEvents: SoccerKeyEvent[] = (summary?.keyEvents ?? []).map((k: J) => ({
    id: String(k.id),
    type: String(k.type?.text ?? ''),
    teamId: k.team?.id != null ? String(k.team.id) : null,
    minute: k.clock?.displayValue || null,
    seconds: num(k.clock?.value),
    text: k.text ?? null,
    athleteIds: (k.participants ?? []).map((p: J) => String(p.athlete?.id ?? '')).filter(Boolean),
  }));
  const players = started ? soccerPlayerStats(summary) : {};
  const first = firstScorer(keyEvents);
  const { lines, yesNo, altOnly } = gameMainLines(propRows, start, now.getTime());
  const athleteOf = (subjectId: string) => subjectId.split(':').pop() ?? subjectId;
  const resolve = (athleteId: string, market: string) => {
    const p = players[athleteId];
    return started && p && (p.stats.appearances ?? 0) > 0 ? soccerMarketValue(market, p.stats, first === athleteId) : null;
  };
  const sideOf = (athleteId: string): 'away' | 'home' | null => (players[athleteId]?.teamId === away.id ? 'away' : players[athleteId]?.teamId === home.id ? 'home' : null);
  const props: SoccerPropResult[] = [
    ...lines.map((l: GameMainLine) => ({ athleteId: athleteOf(l.playerId), name: l.name, market: l.market, line: l.line, over: l.over, under: l.under, books: l.books })),
    ...yesNo.map((y: GameYesNo) => ({ athleteId: athleteOf(y.playerId), name: y.name, market: y.market, line: null, over: y.yes, under: null, books: y.books })),
  ].map((p) => ({ ...p, side: sideOf(p.athleteId), result: resolve(p.athleteId, p.market) }));

  const season = Number(summary?.header?.season?.year ?? seasonForDate(sport, new Date(start || now)));
  const pregame = await readSoccerPregame({ sport, eventId, start, season, awayId: away.id, homeId: home.id, props: props.filter((p) => p.books >= 2).map((p) => ({ athleteId: p.athleteId, market: p.market })), memoize: started });
  for (const p of props) {
    if (p.side) continue;
    const teamId = pregame.teamOf[p.athleteId];
    p.side = teamId === away.id ? 'away' : teamId === home.id ? 'home' : null;
  }

  const teams: J[] = summary?.boxscore?.teams ?? [];
  const statsOf = (id: string) => (teams.find((t) => String(t.team?.id) === id)?.statistics ?? []) as J[];
  const teamStats = started
    ? statsOf(away.id).map((s) => ({ key: String(s.name), label: String(s.label ?? s.name), away: String(s.displayValue ?? ''), home: String(statsOf(home.id).find((x) => x.name === s.name)?.displayValue ?? '') }))
    : [];

  const periods = Math.max(awayComp?.linescores?.length ?? 0, homeComp?.linescores?.length ?? 0);
  const lineScore =
    started && periods
      ? {
          periods: Array.from({ length: periods }, (_, i) => (i === 0 ? '1H' : i === 1 ? '2H' : i === 2 ? 'ET' : i === 3 ? 'ET2' : 'PK')),
          totals: ['T'],
          away: [...Array.from({ length: periods }, (_, i) => num(awayComp?.linescores?.[i]?.displayValue)), away.score],
          home: [...Array.from({ length: periods }, (_, i) => num(homeComp?.linescores?.[i]?.displayValue)), home.score],
        }
      : null;
  const venue = summary?.gameInfo?.venue;
  const leagueName = sport === 'soccer_epl' ? 'Premier League' : 'MLS';

  return {
    sport,
    gameId: eventId,
    state,
    statusText: String((state === 'pre' ? comp.status?.type?.description : comp.status?.type?.shortDetail) ?? comp.status?.type?.description ?? ''),
    start,
    venue: venue?.fullName ?? null,
    conditions: null,
    away,
    home,
    lineScore,
    notes: [],
    soccer: {
      sport,
      league: ROUTE_LEAGUE[sport],
      keyEvents,
      commentary: started ? parseCommentary(summary) : [],
      lineups: parseLineups(summary),
      teamStats,
      lines: parseGameLines(summary),
      storedLines,
      props,
      propsAltOnly: altOnly,
      injuries: parseInjuries(summary, fetchedAt),
      pregame,
      live: state === 'live' && inGame ? { minute: comp.status?.displayClock ?? comp.status?.type?.shortDetail ?? null, inGame } : null,
    },
    sources: [
      { label: 'Match, events, commentary, lineups and team stats', detail: `ESPN ${leagueName} summary, event ${eventId}`, asOf: fetchedAt },
      { label: 'Shot positions', detail: 'ESPN commentary field positions, a curated subset of events (not every shot is located)', asOf: fetchedAt },
      { label: 'Game lines', detail: `ESPN pickcenter (${parseGameLines(summary)?.provider ?? 'DraftKings'}): three-way moneyline, spread and total, open and close${storedLines.length ? '; game_odds_history moneyline, median across books (no draw stored)' : ''}`, asOf: fetchedAt },
      { label: 'Player props', detail: 'prop_odds as they stood at the start: main lines, and yes/no scorer markets at their best price', asOf: fetchedAt },
      ...(state === 'live' ? [{ label: 'In-game odds', detail: 'game_odds_history after kickoff (moneylines only), vig removed per book', asOf: inGame?.now[0]?.asOf ?? null }] : []),
      { label: 'Strength vs strength', detail: 'team_game_production before this match’s date, ranked across the league', asOf: fetchedAt },
      { label: 'Form and head-to-head', detail: 'ESPN team schedules, all matches this season and last before this one', asOf: fetchedAt },
      { label: 'Prop history', detail: 'player_game_history, this season and last, matches before this one', asOf: fetchedAt },
    ],
    fetchedAt,
  };
}

async function readSoccerPregame(input: {
  sport: SoccerGameSport;
  eventId: string;
  start: string;
  season: number;
  awayId: string;
  homeId: string;
  props: Array<{ athleteId: string; market: string }>;
  memoize: boolean;
}): Promise<SoccerPregame> {
  const k = `${input.sport}:${input.eventId}`;
  if (input.memoize) {
    const hit = memo.get(k);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }
  const { sport, eventId, start, season, awayId, homeId } = input;
  const date = easternDate(start);
  const teamIds = [awayId, homeId];
  const [str, form, history, teamOf] = await Promise.all([
    readGameStrength(sport, season, date, teamIds, SOCCER_STRENGTH).catch(() => ({ season, note: null, rows: [] })),
    readEspnForm({ espnSport: 'soccer', espnLeague: ESPN_LEAGUE[sport], eventId, start, season, currentSeason: seasonForDate(sport, new Date()), awayId, homeId }),
    readPropHistory(sport, input.props.map((p) => ({ key: `${p.athleteId}|${p.market}`, athleteId: p.athleteId, market: p.market })), [season - 1, season], date, teamIds, (market, stats) => soccerMarketValue(market, stats)).catch(() => ({})),
    readLatestTeams(sport, [...new Set(input.props.map((p) => p.athleteId))], date).catch(() => ({})),
  ]);
  const value: SoccerPregame = { strengthSeason: str.season, strengthNote: str.note, strength: str.rows, form: form.form, h2h: form.h2h, propHistory: history, teamOf };
  if (input.memoize) memo.set(k, { value, expiresAt: Date.now() + MEMO_MS });
  return value;
}
