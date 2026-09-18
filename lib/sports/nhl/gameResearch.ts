/**
 * The NHL game page read — R8.4b. One `GameResearchPayload` for any game by
 * NHL game id (2025021270), the id the page, the game logs and the rollups use.
 *
 * - status, teams, every event with rink coordinates, goalies and penalties:
 *   api-web's play-by-play (`parsePlayByPlay`) and boxscore; team stats, the
 *   line score, shots by period and the season series: api-web's right rail.
 *   The NHL publishes no win probability, so the flow is shot attempts.
 * - lines: `game_odds_history` by the NHL id, and DraftKings' open and close
 *   from ESPN's pickcenter. ESPN keys the same game by its own event id
 *   (401803621 for 2025021270), found on ESPN's scoreboard for the game's date
 *   by the two teams' full names.
 * - player props: `prop_odds` (subjects `nhl:{playerId}`), resolved against the
 *   boxscore.
 * - before the start: strength vs strength (`team_game_production`, NHL season
 *   numbering: 2025 is 2025-26), form and head to head (api-web club
 *   schedules), prop history (`player_game_history`).
 *
 * Server-only: reads Postgres.
 */

import { fetchBoxscore, fetchClubSeasonGames, fetchPlayByPlay, type NhlBoxscore, type NhlClubGame } from './nhle';
import { parsePlayByPlay, type NhlEvent, type NhlPlayByPlay } from './apiWebParsers';
import { fetchEspnSummary } from '@/lib/sports/espn/summary';
import { parseGameLines, parseInjuries, type GameLines, type InjuryReport } from '@/lib/sports/espn/summaryParsers';
import { readPreGamePropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import { readInGameLines, readPreGameOpenClose, type GameLineOpenClose, type InGameLines } from '@/lib/odds/gameLineHistory';
import { gameMainLines } from '@/lib/odds/props/gameProps';
import type { FormGame, GamePregameCommon, GameResearchPayload, GameSide, GameState } from '@/lib/sports/shared/gameResearchShapes';
import { readGameStrength, readLatestTeams, readPropHistory, type StrengthDef } from '@/lib/sports/shared/gamePregameServer';
import { easternDate } from '@/lib/sports/multiSport/gameFormEspn';
import { seasonForDate } from '@/lib/sports/shared/season';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const API = 'https://api-web.nhle.com/v1';

export interface NhlPropResult {
  playerId: string;
  name: string;
  market: string;
  line: number | null;
  over: { price: number; book: string };
  under: { price: number; book: string } | null;
  books: number;
  side: 'away' | 'home' | null;
  result: number | null;
}

export interface NhlPregame extends GamePregameCommon {
  teamOf: Record<string, string>;
}

export interface NhlSeriesGame {
  id: string;
  date: string;
  away: { id: string; abbr: string; score: number | null };
  home: { id: string; abbr: string; score: number | null };
  state: string;
}

export interface NhlGameResearchPayload extends GameResearchPayload {
  nhl: {
    events: NhlEvent[];
    roster: NhlPlayByPlay['roster'];
    box: NhlBoxscore | null;
    teamStats: Array<{ key: string; away: string; home: string }>;
    shotsByPeriod: Array<{ period: string; away: number; home: number }>;
    seasonSeries: { games: NhlSeriesGame[]; awayWins: number | null; homeWins: number | null };
    lines: GameLines | null;
    storedLines: GameLineOpenClose[];
    props: NhlPropResult[];
    propsAltOnly: number;
    injuries: InjuryReport | null;
    pregame: NhlPregame;
    live: { period: string | null; clock: string | null; intermission: boolean; inGame: InGameLines } | null;
  };
}

export function nhlGameState(pbp: J): GameState | null {
  if (!pbp?.gameState) return null;
  if (/PPD|CNCL|SUSP/.test(String(pbp.gameScheduleState ?? ''))) return 'postponed';
  if (pbp.gameState === 'OFF' || pbp.gameState === 'FINAL') return 'final';
  if (pbp.gameState === 'LIVE' || pbp.gameState === 'CRIT') return 'live';
  return 'pre';
}

const stateCache = new Map<string, { at: number; state: GameState | null }>();
export async function nhlStateOf(gameId: string): Promise<GameState | null> {
  const hit = stateCache.get(gameId);
  if (hit && Date.now() - hit.at < 15_000) return hit.state;
  const res = await fetch(`${API}/gamecenter/${encodeURIComponent(gameId)}/landing`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const state = res?.ok ? nhlGameState(await res.json()) : null;
  stateCache.set(gameId, { at: Date.now(), state });
  return state;
}

export const periodName = (n: number | null, type: string | null) => (n == null ? '' : type === 'SO' ? 'SO' : type === 'OT' || n > 3 ? (n === 4 ? 'OT' : `${n - 3}OT`) : `P${n}`);

/** A prop market's number from the boxscore (skaters and goalies), or a game-log row with the same keys. `null` when the player did not dress. */
export function nhlMarketValue(market: string, s: Record<string, number | null | undefined> | null): number | null {
  if (!s) return null;
  const z = (k: string) => Number(s[k] ?? 0) || 0;
  switch (market) {
    case 'goals': return z('goals');
    case 'assists': return z('assists');
    case 'points': return z('goals') + z('assists');
    case 'shots-on-goal': return z('sog');
    case 'hits': return z('hits');
    case 'blocked-shots': return z('blockedShots');
    case 'saves': return s.saves == null ? null : z('saves');
    case 'goals-against': return s.goalsAgainst == null ? null : z('goalsAgainst');
    case 'anytime-goalscorer': return z('goals') > 0 ? 1 : 0;
    default: return null;
  }
}

/** Each dressed player's box line by id, in the game-log key names. */
function boxLines(box: NhlBoxscore | null): Map<string, { teamId: string; s: Record<string, number | null> }> {
  const out = new Map<string, { teamId: string; s: Record<string, number | null> }>();
  if (!box) return out;
  const teamOf = (abbr: string) => (abbr === box.homeAbbr ? box.homeTeamId : box.awayTeamId);
  for (const [abbr, skaters] of Object.entries(box.skatersByTeam)) {
    for (const p of skaters) out.set(String(p.playerId), { teamId: teamOf(abbr), s: { goals: p.goals, assists: p.assists, points: p.points, sog: p.shots, hits: p.hits, blockedShots: p.blockedShots } });
  }
  for (const [abbr, goalies] of Object.entries(box.goaliesByTeam)) {
    for (const g of goalies) out.set(String(g.playerId), { teamId: teamOf(abbr), s: { saves: g.saves, goalsAgainst: g.goalsAgainst } });
  }
  return out;
}

const NHL_STRENGTH: StrengthDef[] = [
  { key: 'goals', label: 'Goals / game', decimals: 2, higherIsBetter: true, of: (s, g) => (g ? (s.goals ?? 0) / g : null) },
  { key: 'sog', label: 'Shots on goal / game', decimals: 1, higherIsBetter: true, of: (s, g) => (g ? (s.sog ?? 0) / g : null) },
  { key: 'shooting', label: 'Shooting %', decimals: 1, percent: true, higherIsBetter: true, of: (s) => (s.sog ? (100 * (s.goals ?? 0)) / s.sog : null) },
  { key: 'ppg', label: 'Power-play goals / game', decimals: 2, higherIsBetter: true, of: (s, g) => (g ? (s.powerPlayGoals ?? 0) / g : null) },
  { key: 'hits', label: 'Hits / game', decimals: 1, higherIsBetter: true, of: (s, g) => (g ? (s.hits ?? 0) / g : null) },
  { key: 'blocks', label: 'Blocked shots / game', decimals: 1, higherIsBetter: true, of: (s, g) => (g ? (s.blockedShots ?? 0) / g : null) },
  { key: 'take', label: 'Takeaways / game', decimals: 1, higherIsBetter: true, of: (s, g) => (g ? (s.takeaways ?? 0) / g : null) },
  { key: 'give', label: 'Giveaways / game', decimals: 1, higherIsBetter: false, of: (s, g) => (g ? (s.giveaways ?? 0) / g : null) },
  { key: 'pim', label: 'Penalty minutes / game', decimals: 1, higherIsBetter: false, of: (s, g) => (g ? (s.pim ?? 0) / g : null) },
];

/** ESPN's event id for this game: its scoreboard on the game's date, matched by both teams' full names. */
async function espnEventIdFor(date: string, awayName: string, homeName: string): Promise<string | null> {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${date.replace(/-/g, '')}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) return null;
  const json = (await res.json()) as J;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  for (const e of json.events ?? []) {
    const names = (e.competitions?.[0]?.competitors ?? []).map((c: J) => norm(String(c.team?.displayName ?? '')));
    if (names.includes(norm(awayName)) && names.includes(norm(homeName))) return String(e.id);
  }
  return null;
}

function formFrom(teamId: string, g: NhlClubGame): FormGame | null {
  const home = g.home.id === teamId;
  const us = home ? g.home : g.away;
  const them = home ? g.away : g.home;
  if (us.score == null || them.score == null) return null;
  return { pk: g.id, date: g.date, home, opponentId: them.id, opponentAbbr: them.abbr, opponentLogoUrl: them.logoUrl, us: us.score, them: them.score, postseason: g.postseason };
}

const memo = new Map<string, { value: NhlPregame; expiresAt: number }>();

async function readNhlPregame(input: { gameId: string; start: string; date: string; season: number; away: { id: string; abbr: string }; home: { id: string; abbr: string }; props: Array<{ playerId: string; market: string }>; memoize: boolean }): Promise<NhlPregame> {
  if (input.memoize) {
    const hit = memo.get(input.gameId);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }
  const { gameId, start, date, season, away, home } = input;
  const key = (y: number) => `${y}${y + 1}`;
  const current = seasonForDate('nhl', new Date());
  const club = (abbr: string, y: number) => fetchClubSeasonGames(abbr, key(y), y < current).catch((): NhlClubGame[] => []);
  const teamIds = [away.id, home.id];
  const [str, awayThis, homeThis, awayLast, homeLast, history, teamOf] = await Promise.all([
    readGameStrength('nhl', season, date, teamIds, NHL_STRENGTH).catch(() => ({ season, note: null, rows: [] })),
    club(away.abbr, season),
    club(home.abbr, season),
    club(away.abbr, season - 1),
    club(home.abbr, season - 1),
    readPropHistory('nhl', input.props.map((p) => ({ key: `${p.playerId}|${p.market}`, athleteId: p.playerId, market: p.market })), [season - 1, season], date, teamIds, (market, s) => nhlMarketValue(market, s as Record<string, number>)).catch(() => ({})),
    readLatestTeams('nhl', [...new Set(input.props.map((p) => p.playerId))], date).catch(() => ({})),
  ]);
  const before = (g: NhlClubGame) => g.state === 'final' && g.id !== gameId && Date.parse(g.start) < Date.parse(start);
  const formOf = (teamId: string, games: NhlClubGame[]) => games.filter(before).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).map((g) => formFrom(teamId, g)).filter((g): g is FormGame => g != null);
  const value: NhlPregame = {
    strengthSeason: str.season,
    strengthNote: str.note,
    strength: str.rows,
    form: { [away.id]: { games: formOf(away.id, [...awayLast, ...awayThis]) }, [home.id]: { games: formOf(home.id, [...homeLast, ...homeThis]) } },
    h2h: formOf(away.id, [...awayLast, ...awayThis].filter((g) => g.home.id === home.id || g.away.id === home.id)),
    propHistory: history,
    teamOf,
  };
  if (input.memoize) memo.set(gameId, { value, expiresAt: Date.now() + 30 * 60_000 });
  return value;
}

export async function readNhlGameResearch(gameId: string, now: Date = new Date()): Promise<NhlGameResearchPayload | null> {
  const [raw, rail] = await Promise.all([fetchPlayByPlay(gameId) as Promise<J>, fetch(`${API}/gamecenter/${encodeURIComponent(gameId)}/right-rail`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<J>]);
  if (!raw) {
    // `fetchJson` folds a 404 and a timeout into one null. Only api-web's own
    // 404 means the game does not exist; anything else is api-web not answering,
    // which must read "couldn't load" (an error), not "not found". Found in the
    // R11 render: COL @ CGY said "not found" while five pages loaded at once.
    // The team page made the same distinction in the R7.4 sweep.
    const probe = await fetch(`${API}/gamecenter/${encodeURIComponent(gameId)}/play-by-play`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (probe?.status === 404) return null;
    throw new Error(`NHL play-by-play unavailable for ${gameId}`);
  }
  const state = nhlGameState(raw);
  if (!state) return null;
  const started = state === 'live' || state === 'final';
  const side = (t: J): GameSide => ({
    id: String(t?.id ?? ''),
    name: [t?.placeName?.default, t?.commonName?.default].filter(Boolean).join(' ') || String(t?.abbrev ?? ''),
    abbr: String(t?.abbrev ?? ''),
    logoUrl: t?.logo ?? null,
    href: t?.id != null ? `/nhl/team/${t.id}` : null,
    score: state === 'pre' ? null : num(t?.score),
    record: null,
  });
  const away = side(raw.awayTeam);
  const home = side(raw.homeTeam);
  const start: string = raw.startTimeUTC ?? '';
  const date: string = raw.gameDate ?? easternDate(start);
  const fetchedAt = now.toISOString();
  const pbp = parsePlayByPlay(raw);

  const espnId = await espnEventIdFor(date, away.name, home.name).catch(() => null);
  const [espn, storedLines, propRows, inGame, box] = await Promise.all([
    espnId ? fetchEspnSummary<J>('hockey/nhl', espnId) : Promise.resolve(null),
    readPreGameOpenClose(gameId, start).catch((): GameLineOpenClose[] => []),
    readPreGamePropOddsForGame(gameId, start).catch((): PropOddsRow[] => []),
    state === 'live' ? readInGameLines(gameId, start, now).catch((): InGameLines => ({ now: [], moneyline: [] })) : Promise.resolve(null),
    started ? fetchBoxscore(gameId).catch(() => null) : Promise.resolve(null),
  ]);

  const lines = boxLines(box);
  const { lines: mains, yesNo, altOnly } = gameMainLines(propRows, start, now.getTime());
  const props: NhlPropResult[] = [
    ...mains.map((l) => ({ playerId: l.playerId.split(':').pop() ?? l.playerId, name: l.name, market: l.market, line: l.line as number | null, over: l.over, under: l.under, books: l.books })),
    ...yesNo.map((y) => ({ playerId: y.playerId.split(':').pop() ?? y.playerId, name: y.name, market: y.market, line: null, over: y.yes, under: null, books: y.books })),
  ].map((p) => {
    const b = lines.get(p.playerId);
    return { ...p, side: b ? (b.teamId === away.id ? 'away' : b.teamId === home.id ? 'home' : null) : null, result: started ? nhlMarketValue(p.market, b?.s ?? null) : null };
  });

  const seasonKey = Number(raw.season ?? 0);
  const season = seasonKey ? Math.floor(seasonKey / 10000) : seasonForDate('nhl', new Date(start || now));
  const pregame = await readNhlPregame({ gameId, start, date, season, away, home, props: props.filter((p) => p.books >= 2).map((p) => ({ playerId: p.playerId, market: p.market })), memoize: started });
  for (const p of props) {
    if (p.side) continue;
    const t = pregame.teamOf[p.playerId];
    p.side = t === away.id ? 'away' : t === home.id ? 'home' : null;
  }

  const byPeriod: J[] = rail?.linescore?.byPeriod ?? [];
  const sogByPeriod: J[] = rail?.shotsByPeriod ?? [];
  const lineScore =
    started && byPeriod.length
      ? {
          periods: byPeriod.map((p) => periodName(num(p.periodDescriptor?.number), p.periodDescriptor?.periodType ?? null)),
          totals: ['T', 'SOG'],
          away: [...byPeriod.map((p) => num(p.away)), away.score, num(raw.awayTeam?.sog)],
          home: [...byPeriod.map((p) => num(p.home)), home.score, num(raw.homeTeam?.sog)],
        }
      : null;
  const outcome = raw.gameOutcome?.lastPeriodType;
  const periodNow = periodName(num(raw.periodDescriptor?.number), raw.periodDescriptor?.periodType ?? null);
  const statusText =
    state === 'final'
      ? outcome && outcome !== 'REG'
        ? `Final/${outcome}`
        : 'Final'
      : state === 'live'
        ? raw.clock?.inIntermission
          ? `${periodNow} intermission`
          : `${periodNow} ${raw.clock?.timeRemaining ?? ''}`.trim()
        : state === 'postponed'
          ? 'Postponed'
          : 'Scheduled';

  return {
    sport: 'nhl',
    gameId,
    state,
    statusText,
    start,
    venue: raw.venue?.default ?? null,
    conditions: null,
    away,
    home,
    lineScore,
    notes: [],
    nhl: {
      events: started ? pbp?.events ?? [] : [],
      roster: pbp?.roster ?? {},
      box,
      teamStats: (rail?.teamGameStats ?? []).map((s: J) => ({ key: String(s.category), away: String(s.awayValue ?? ''), home: String(s.homeValue ?? '') })),
      shotsByPeriod: sogByPeriod.map((p) => ({ period: periodName(num(p.periodDescriptor?.number), p.periodDescriptor?.periodType ?? null), away: num(p.away) ?? 0, home: num(p.home) ?? 0 })),
      seasonSeries: {
        games: (rail?.seasonSeries ?? []).map((g: J) => ({ id: String(g.id), date: String(g.gameDate ?? ''), away: { id: String(g.awayTeam?.id ?? ''), abbr: String(g.awayTeam?.abbrev ?? ''), score: num(g.awayTeam?.score) }, home: { id: String(g.homeTeam?.id ?? ''), abbr: String(g.homeTeam?.abbrev ?? ''), score: num(g.homeTeam?.score) }, state: String(g.gameState ?? '') })),
        awayWins: num(rail?.seasonSeriesWins?.awayTeamWins),
        homeWins: num(rail?.seasonSeriesWins?.homeTeamWins),
      },
      lines: espn ? parseGameLines(espn) : null,
      storedLines,
      props,
      propsAltOnly: altOnly,
      injuries: espn ? parseInjuries(espn, fetchedAt) : null,
      pregame,
      live: state === 'live' && inGame ? { period: periodNow || null, clock: raw.clock?.timeRemaining ?? null, intermission: raw.clock?.inIntermission === true, inGame } : null,
    },
    sources: [
      { label: 'Game, every event with rink coordinates, goalies and penalties', detail: `NHL api-web play-by-play and boxscore, game ${gameId}`, asOf: fetchedAt },
      { label: 'Team stats, line score, shots by period, season series', detail: 'NHL api-web right rail', asOf: fetchedAt },
      { label: 'Game lines', detail: `${espnId ? `ESPN pickcenter (event ${espnId}): open and close` : 'ESPN pickcenter: the game was not found on ESPN’s scoreboard'}${storedLines.length ? '; game_odds_history, median across books' : ''}`, asOf: fetchedAt },
      { label: 'Player props', detail: 'prop_odds as they stood at the start: the main line quoted on both sides by the most books', asOf: fetchedAt },
      ...(state === 'live' ? [{ label: 'In-game odds', detail: 'game_odds_history after the opening faceoff, vig removed per book', asOf: inGame?.now[0]?.asOf ?? null }] : []),
      { label: 'Strength vs strength', detail: 'team_game_production before this game’s date, ranked across the league', asOf: fetchedAt },
      { label: 'Form and head-to-head', detail: 'NHL api-web club schedules, regular season and playoffs, games before this one', asOf: fetchedAt },
      { label: 'Prop history', detail: 'player_game_history, this season and last, games before this one', asOf: fetchedAt },
    ],
    fetchedAt,
  };
}
