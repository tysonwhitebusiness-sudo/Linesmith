/**
 * The NBA game page read — R8.4a. One `GameResearchPayload` for any game by
 * ESPN event id, past, live or scheduled.
 *
 * - status, teams, every play (with court coordinates), win probability, box
 *   score, team stats, season series, injuries and DraftKings' open and close
 *   (pickcenter): ESPN's summary (`fetchEspnSummary`, R4 parsers).
 * - shot positions: MEASURED 2026-09-17 on OKC @ LAL (401811010), ESPN's summary
 *   coordinates put the rim at (25, 0) with y in feet out from it, the same
 *   system `CourtScatter` draws: all 124 shots whose text states a distance sit
 *   within 2 ft of it (mean 0.69 ft), and the closest three is 22.6 ft. Free
 *   throws carry ESPN's -2^31 sentinel, which `parseCourtPlays` drops.
 * - lines and props: `game_odds_history` and `prop_odds` by the same event id
 *   (none held for the offseason as measured; the sections say so).
 * - before the start: strength vs strength (`team_game_production`), form and
 *   head to head (ESPN schedules), prop history (`player_game_history`).
 *
 * Server-only: reads Postgres.
 */

import { fetchEspnSummary } from '@/lib/sports/espn/summary';
import { leadTracker, parseCourtPlays, parseGameLines, parseInjuries, parseSeasonSeries, parseWinProbability, scoringRuns, type CourtPlay, type GameLines, type InjuryReport, type LeadPoint, type ScoringRun, type SeasonSeries, type WinProbabilityPoint } from '@/lib/sports/espn/summaryParsers';
import { parseEspnBox, type EspnBoxTeam } from '@/lib/sports/espn/boxscore';
import { readPreGamePropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import { readInGameLines, readPreGameOpenClose, type GameLineOpenClose, type InGameLines } from '@/lib/odds/gameLineHistory';
import { gameMainLines } from '@/lib/odds/props/gameProps';
import type { GamePregameCommon, GameResearchPayload, GameSide, GameState } from '@/lib/sports/shared/gameResearchShapes';
import { readGameStrength, readLatestTeams, readPropHistory, type StrengthDef } from '@/lib/sports/shared/gamePregameServer';
import { easternDate, readEspnForm } from '@/lib/sports/multiSport/gameFormEspn';
import { seasonForDate } from '@/lib/sports/shared/season';

export interface NbaPropResult {
  athleteId: string;
  name: string;
  market: string;
  line: number | null;
  over: { price: number; book: string };
  under: { price: number; book: string } | null;
  books: number;
  side: 'away' | 'home' | null;
  result: number | null;
}

export interface NbaPregame extends GamePregameCommon {
  teamOf: Record<string, string>;
}

export interface NbaGameResearchPayload extends GameResearchPayload {
  nba: {
    plays: CourtPlay[];
    winProbability: WinProbabilityPoint[];
    lead: LeadPoint[];
    runs: ScoringRun[];
    box: EspnBoxTeam[];
    teamStats: Array<{ key: string; label: string; away: string; home: string }>;
    seasonSeries: SeasonSeries[];
    lines: GameLines | null;
    storedLines: GameLineOpenClose[];
    props: NbaPropResult[];
    propsAltOnly: number;
    injuries: InjuryReport;
    pregame: NbaPregame;
    live: { period: number | null; clock: string | null; inGame: InGameLines } | null;
  };
}

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function nbaGameState(summary: J): GameState | null {
  const type = summary?.header?.competitions?.[0]?.status?.type;
  if (!type) return null;
  if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED/.test(String(type.name ?? ''))) return 'postponed';
  if (type.state === 'post' || type.completed === true) return 'final';
  if (type.state === 'in') return 'live';
  return 'pre';
}

export async function nbaStateOf(eventId: string): Promise<GameState | null> {
  return nbaGameState(await fetchEspnSummary('basketball/nba', eventId));
}

/** One stat from basketball's single box group: plain or joined keys ("fieldGoalsMade-fieldGoalsAttempted"). `null` when the player is not in the box. */
export function nbaBoxStat(box: EspnBoxTeam[], athleteId: string, key: string): number | null {
  for (const team of box) {
    for (const g of team.groups) {
      const a = g.athletes.find((x) => x.id === athleteId);
      if (!a) continue;
      const i = g.keys.indexOf(key);
      if (i >= 0) return num(a.stats[i]);
      const j = g.keys.findIndex((k) => k.split(/[/-]/).includes(key));
      if (j >= 0) return num(String(a.stats[j]).split(/[/-]/)[g.keys[j].split(/[/-]/).indexOf(key)]);
    }
  }
  return null;
}

const COMBOS: Record<string, string[]> = {
  points: ['points'],
  rebounds: ['rebounds'],
  assists: ['assists'],
  steals: ['steals'],
  blocks: ['blocks'],
  turnovers: ['turnovers'],
  threes: ['threePointFieldGoalsMade'],
  'three-pointers': ['threePointFieldGoalsMade'],
  'points-rebounds-assists': ['points', 'rebounds', 'assists'],
  'points-rebounds': ['points', 'rebounds'],
  'points-assists': ['points', 'assists'],
  'rebounds-assists': ['rebounds', 'assists'],
  'steals-blocks': ['steals', 'blocks'],
};

/**
 * A prop market's number, from the box (by athlete id) or a game-log row (same
 * key names). A player who did not play — no row, or "DNP" minutes — is `null`.
 */
export function nbaMarketValue(market: string, stat: (key: string) => number | null): number | null {
  const keys = COMBOS[market];
  if (!keys) return null;
  const minutes = stat('minutes');
  if (minutes == null) return null;
  return keys.reduce((a, k) => a + (stat(k) ?? 0), 0);
}

const per = (key: string) => (s: Record<string, number>, g: number) => (g ? (s[key] ?? 0) / g : null);
const NBA_STRENGTH: StrengthDef[] = [
  { key: 'points', label: 'Points / game', decimals: 1, higherIsBetter: true, of: per('points') },
  { key: 'fg', label: 'Field goal %', decimals: 1, percent: true, higherIsBetter: true, of: (s) => (s.fieldGoalsAttempted ? (100 * (s.fieldGoalsMade ?? 0)) / s.fieldGoalsAttempted : null) },
  { key: 'three', label: 'Three-point %', decimals: 1, percent: true, higherIsBetter: true, of: (s) => (s.threePointFieldGoalsAttempted ? (100 * (s.threePointFieldGoalsMade ?? 0)) / s.threePointFieldGoalsAttempted : null) },
  { key: 'threes', label: 'Threes made / game', decimals: 1, higherIsBetter: true, of: per('threePointFieldGoalsMade') },
  { key: 'rebounds', label: 'Rebounds / game', decimals: 1, higherIsBetter: true, of: per('rebounds') },
  { key: 'oreb', label: 'Offensive rebounds / game', decimals: 1, higherIsBetter: true, of: per('offensiveRebounds') },
  { key: 'assists', label: 'Assists / game', decimals: 1, higherIsBetter: true, of: per('assists') },
  { key: 'turnovers', label: 'Turnovers / game', decimals: 1, higherIsBetter: false, of: per('turnovers') },
  { key: 'ft', label: 'Free throws attempted / game', decimals: 1, higherIsBetter: true, of: per('freeThrowsAttempted') },
];

function side(comp: J | undefined, state: GameState): GameSide {
  const t = comp?.team ?? {};
  const rec = (comp?.record ?? []).find((r: J) => r.type === 'total')?.summary ?? null;
  return {
    id: String(t.id ?? ''),
    name: String(t.displayName ?? t.name ?? ''),
    abbr: String(t.abbreviation ?? ''),
    logoUrl: t.logos?.[0]?.href ?? t.logo ?? null,
    href: t.id != null ? `/nba/team/${t.id}` : null,
    score: state === 'pre' || comp?.score == null ? null : num(comp.score),
    record: rec,
  };
}

const PERIOD = (i: number) => (i < 4 ? `Q${i + 1}` : i === 4 ? 'OT' : `${i - 3}OT`);
const MEMO_MS = 30 * 60_000;
const memo = new Map<string, { value: NbaPregame; expiresAt: number }>();

export async function readNbaGameResearch(eventId: string, now: Date = new Date()): Promise<NbaGameResearchPayload | null> {
  const summary: J = await fetchEspnSummary('basketball/nba', eventId);
  const comp = summary?.header?.competitions?.[0];
  const state = nbaGameState(summary);
  if (!comp || !state) return null;
  const awayComp = (comp.competitors ?? []).find((c: J) => c.homeAway === 'away');
  const homeComp = (comp.competitors ?? []).find((c: J) => c.homeAway === 'home');
  const away = side(awayComp, state);
  const home = side(homeComp, state);
  const start: string = comp.date ?? '';
  const started = state === 'live' || state === 'final';
  const fetchedAt = now.toISOString();

  const [storedLines, propRows, inGame] = await Promise.all([
    readPreGameOpenClose(eventId, start).catch((): GameLineOpenClose[] => []),
    readPreGamePropOddsForGame(eventId, start).catch((): PropOddsRow[] => []),
    state === 'live' ? readInGameLines(eventId, start, now).catch((): InGameLines => ({ now: [], moneyline: [] })) : Promise.resolve(null),
  ]);
  const plays = started ? parseCourtPlays(summary) : [];
  const box = started ? parseEspnBox(summary) : [];
  const { lines, yesNo, altOnly } = gameMainLines(propRows, start, now.getTime());
  const teamOfBox = (athleteId: string) => box.find((t) => t.groups.some((g) => g.athletes.some((a) => a.id === athleteId)))?.teamId ?? null;
  const props: NbaPropResult[] = [
    ...lines.map((l) => ({ athleteId: l.playerId.split(':').pop() ?? l.playerId, name: l.name, market: l.market, line: l.line as number | null, over: l.over, under: l.under, books: l.books })),
    ...yesNo.map((y) => ({ athleteId: y.playerId.split(':').pop() ?? y.playerId, name: y.name, market: y.market, line: null, over: y.yes, under: null, books: y.books })),
  ].map((p) => {
    const t = teamOfBox(p.athleteId);
    return { ...p, side: t === away.id ? 'away' : t === home.id ? 'home' : null, result: started ? nbaMarketValue(p.market, (k) => nbaBoxStat(box, p.athleteId, k)) : null };
  });

  const season = Number(summary?.header?.season?.year ?? seasonForDate('nba', new Date(start || now)));
  const pregame = await readNbaPregame({ eventId, start, season, awayId: away.id, homeId: home.id, props: props.filter((p) => p.books >= 2).map((p) => ({ athleteId: p.athleteId, market: p.market })), memoize: started });
  for (const p of props) {
    if (p.side) continue;
    const t = pregame.teamOf[p.athleteId];
    p.side = t === away.id ? 'away' : t === home.id ? 'home' : null;
  }

  const teams: J[] = summary?.boxscore?.teams ?? [];
  const statsOf = (id: string) => (teams.find((t) => String(t.team?.id) === id)?.statistics ?? []) as J[];
  const teamStats = started
    ? statsOf(away.id).map((s) => ({ key: String(s.name), label: String(s.label ?? s.name), away: String(s.displayValue ?? ''), home: String(statsOf(home.id).find((x) => x.name === s.name)?.displayValue ?? '') }))
    : [];
  const periods = Math.max(awayComp?.linescores?.length ?? 0, homeComp?.linescores?.length ?? 0, started ? 4 : 0);
  const scoreRow = (c: J) => [...Array.from({ length: periods }, (_, i) => num(c?.linescores?.[i]?.displayValue)), num(c?.score)];
  const lineScore = started ? { periods: Array.from({ length: periods }, (_, i) => PERIOD(i)), totals: ['T'], away: scoreRow(awayComp), home: scoreRow(homeComp) } : null;
  const gameLines = parseGameLines(summary);

  return {
    sport: 'nba',
    gameId: eventId,
    state,
    statusText: String((state === 'pre' ? comp.status?.type?.description : comp.status?.type?.shortDetail) ?? comp.status?.type?.description ?? ''),
    start,
    venue: summary?.gameInfo?.venue?.fullName ?? null,
    conditions: null,
    away,
    home,
    lineScore,
    notes: [],
    nba: {
      plays,
      winProbability: started ? parseWinProbability(summary) : [],
      lead: started ? leadTracker(plays) : [],
      runs: started ? scoringRuns(plays) : [],
      box,
      teamStats,
      seasonSeries: parseSeasonSeries(summary),
      lines: gameLines,
      storedLines,
      props,
      propsAltOnly: altOnly,
      injuries: parseInjuries(summary, fetchedAt),
      pregame,
      live: state === 'live' && inGame ? { period: num(comp.status?.period), clock: comp.status?.displayClock ?? null, inGame } : null,
    },
    sources: [
      { label: 'Game, plays, shots, box score and win probability', detail: `ESPN NBA summary, event ${eventId}`, asOf: fetchedAt },
      { label: 'Game lines', detail: `ESPN pickcenter (${gameLines?.provider ?? 'DraftKings'}): open and close${storedLines.length ? '; game_odds_history, median across books' : ''}`, asOf: fetchedAt },
      { label: 'Player props', detail: 'prop_odds as they stood at the start: the main line quoted on both sides by the most books', asOf: fetchedAt },
      ...(state === 'live' ? [{ label: 'In-game odds', detail: 'game_odds_history after the tip, vig removed per book', asOf: inGame?.now[0]?.asOf ?? null }] : []),
      { label: 'Strength vs strength', detail: 'team_game_production before this game’s date, ranked across the league', asOf: fetchedAt },
      { label: 'Form and head-to-head', detail: 'ESPN team schedules, regular season and playoffs, games before this one', asOf: fetchedAt },
      { label: 'Prop history', detail: 'player_game_history, this season and last, games before this one', asOf: fetchedAt },
    ],
    fetchedAt,
  };
}

async function readNbaPregame(input: { eventId: string; start: string; season: number; awayId: string; homeId: string; props: Array<{ athleteId: string; market: string }>; memoize: boolean }): Promise<NbaPregame> {
  if (input.memoize) {
    const hit = memo.get(input.eventId);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }
  const { eventId, start, season, awayId, homeId } = input;
  const date = easternDate(start);
  const teamIds = [awayId, homeId];
  const [str, form, history, teamOf] = await Promise.all([
    readGameStrength('nba', season, date, teamIds, NBA_STRENGTH).catch(() => ({ season, note: null, rows: [] })),
    readEspnForm({ espnSport: 'basketball', espnLeague: 'nba', eventId, start, season, currentSeason: seasonForDate('nba', new Date()), awayId, homeId }),
    readPropHistory('nba', input.props.map((p) => ({ key: `${p.athleteId}|${p.market}`, athleteId: p.athleteId, market: p.market })), [season - 1, season], date, teamIds, (market, s) =>
      nbaMarketValue(market, (k) => (s[k] == null || !Number.isFinite(Number(s[k])) ? (k === 'minutes' ? null : 0) : Number(s[k]))),
    ).catch(() => ({})),
    readLatestTeams('nba', [...new Set(input.props.map((p) => p.athleteId))], date).catch(() => ({})),
  ]);
  const value: NbaPregame = { strengthSeason: str.season, strengthNote: str.note, strength: str.rows, form: form.form, h2h: form.h2h, propHistory: history, teamOf };
  if (input.memoize) memo.set(input.eventId, { value, expiresAt: Date.now() + MEMO_MS });
  return value;
}
