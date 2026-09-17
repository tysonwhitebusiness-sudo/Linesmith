/**
 * MLB's game page read — R8.1. One `GameResearchPayload` for any game by pk,
 * past, live or scheduled.
 *
 * - status, teams, line score, box score, every plate appearance and pitch:
 *   StatsAPI's live feed by pk (R4 parsers). Past games resolve (R6-F6): the old
 *   page looked the pk up in today's slate and nothing else;
 * - win probability: StatsAPI's `winProbability` by pk (R4);
 * - lines: `game_odds_history`, open and close before the start (R2 split);
 * - player props: the main line from pre-start quotes (R2), resolved against
 *   the box once the game has a box.
 *
 * Server-only: reads Postgres.
 */

import { getLiveFeed, getWinProbability, type MlbLiveFeed } from './statsapi';
import { mlbMarketResult, parseAtBats, parseMlbBox, parseMlbWinProbability, type AtBat, type MlbBoxTeam, type MlbWinProbabilityPoint } from './liveFeedParsers';
import { readPreGamePropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import { gameMainLines } from '@/lib/odds/props/gameProps';
import { readInGameLines, readPreGameOpenClose, type GameLineOpenClose, type InGameLines } from '@/lib/odds/gameLineHistory';
import { buildLiveGameDetail, type LiveBatter, type LivePitcherLine } from './liveGame';
import type { GameResearchPayload, GameSide, GameState } from '@/lib/sports/shared/gameResearchShapes';
import { readMlbPregame, type MlbPregame } from './gamePregame';
import { easternDate } from './statsapi';

export interface MlbPropResult {
  playerId: string;
  name: string;
  /** The player's side in this game's box, when he appears in it. */
  side: 'away' | 'home' | null;
  market: string;
  line: number;
  over: { price: number; book: string } | null;
  under: { price: number; book: string } | null;
  books: number;
  /** His number in this market from the box; `null` before the game or when he did not play. */
  result: number | null;
}

export interface MlbGameResearchPayload extends GameResearchPayload {
  mlb: {
    atBats: AtBat[];
    winProbability: MlbWinProbabilityPoint[];
    box: { away: MlbBoxTeam; home: MlbBoxTeam } | null;
    lines: GameLineOpenClose[];
    props: MlbPropResult[];
    /** Player markets with only alternate lines quoted, left out of `props`. */
    propsAltOnly: number;
    /** Whether the pitch-level feed reached this game (every pitch located). */
    pitchDataHeld: boolean;
    /** The research as of the start (R8.1b). */
    pregame: MlbPregame;
    /** While the game is on (R8.1c): where it stands and what the books say now. `null` otherwise. */
    live: MlbLiveNow | null;
  };
}

export interface MlbLiveNow {
  inning: { number: number; half: 'top' | 'bottom'; ordinal: string };
  outs: number;
  count: { balls: number; strikes: number };
  bases: { first: boolean; second: boolean; third: boolean };
  batter: LiveBatter | null;
  onDeck: LiveBatter | null;
  pitcher: LivePitcherLine | null;
  inGame: InGameLines;
}

const logo = (id: number | string) => `https://www.mlbstatic.com/team-logos/${id}.svg`;

export function mlbGameState(abstract: string, detailed: string): GameState {
  if (/postponed|cancel|suspended/i.test(detailed)) return 'postponed';
  if (abstract === 'Final') return 'final';
  if (abstract === 'Live') return 'live';
  return 'pre';
}

/** The feed's reshaped parts back in the raw nesting R4's parsers read. */
const raw = (feed: MlbLiveFeed) => ({ liveData: { plays: feed.plays, boxscore: feed.boxscore, linescore: feed.linescore, decisions: feed.decisions } });

function side(feed: MlbLiveFeed, which: 'away' | 'home', state: GameState): GameSide {
  const t = feed.gameData?.teams?.[which] ?? {};
  const rec = t.record;
  const runs = feed.linescore?.teams?.[which]?.runs;
  return {
    id: String(t.id ?? ''),
    name: t.name ?? '',
    abbr: t.abbreviation ?? '',
    logoUrl: t.id ? logo(t.id) : null,
    href: t.id ? `/mlb/team/${t.id}` : null,
    score: state === 'pre' || runs == null ? null : Number(runs),
    record: rec && rec.wins != null ? `${rec.wins}-${rec.losses}` : null,
  };
}

function liveNow(feed: MlbLiveFeed, inGame: InGameLines): MlbLiveNow | null {
  const d = buildLiveGameDetail(feed);
  if (!d) return null;
  return { inning: d.inning, outs: d.outs, count: d.count, bases: d.bases, batter: d.batter, onDeck: d.onDeck, pitcher: d.currentPitcher, inGame };
}

function statusText(feed: MlbLiveFeed, state: GameState): string {
  const detailed: string = feed.gameData?.status?.detailedState ?? '';
  const inning = feed.linescore?.currentInning;
  if (state === 'final') return inning && inning > (feed.linescore?.scheduledInnings ?? 9) ? `Final/${inning}` : 'Final';
  if (state === 'live' && inning) return `${feed.linescore?.isTopInning ? 'Top' : 'Bot'} ${feed.linescore?.currentInningOrdinal ?? inning}`;
  return detailed || 'Scheduled';
}

function propResults(rows: PropOddsRow[], start: string, box: MlbGameResearchPayload['mlb']['box']): { props: MlbPropResult[]; altOnly: number } {
  const findBatter = (id: number) => box && (box.away.batting.find((b) => b.id === id) ?? box.home.batting.find((b) => b.id === id));
  const findPitcher = (id: number) => box && (box.away.pitching.find((p) => p.id === id) ?? box.home.pitching.find((p) => p.id === id));
  const sideOf = (id: number): 'away' | 'home' | null =>
    !box ? null : box.away.batting.some((b) => b.id === id) || box.away.pitching.some((p) => p.id === id) ? 'away' : box.home.batting.some((b) => b.id === id) || box.home.pitching.some((p) => p.id === id) ? 'home' : null;
  const { lines, altOnly } = gameMainLines(rows, start);
  const props = lines.map((l): MlbPropResult => {
    const id = Number(l.playerId);
    return { ...l, side: sideOf(id), result: box ? mlbMarketResult(l.market, findBatter(id) ?? undefined, findPitcher(id) ?? undefined) : null };
  });
  return { props, altOnly };
}

export async function readMlbGameResearch(gamePk: number, now: Date = new Date()): Promise<MlbGameResearchPayload | null> {
  const feed = await getLiveFeed(gamePk);
  if (!feed?.gameData?.game?.pk && !feed?.gameData?.teams) return null;
  const state = mlbGameState(feed.gameData?.status?.abstractGameState ?? '', feed.gameData?.status?.detailedState ?? '');
  const start: string = feed.gameData?.datetime?.dateTime ?? '';
  const started = state === 'live' || state === 'final';

  const [wpRaw, lines, propRows, inGame] = await Promise.all([
    started ? getWinProbability(gamePk).catch(() => null) : Promise.resolve(null),
    readPreGameOpenClose(String(gamePk), start).catch(() => []),
    readPreGamePropOddsForGame(String(gamePk), start).catch(() => [] as PropOddsRow[]),
    state === 'live' ? readInGameLines(String(gamePk), start, now).catch((): InGameLines => ({ now: [], moneyline: [] })) : Promise.resolve(null),
  ]);
  const r = raw(feed);
  const atBats = started ? parseAtBats(r) : [];
  const box = started ? { away: parseMlbBox(r, 'away'), home: parseMlbBox(r, 'home') } : null;
  const { props, altOnly } = propResults(propRows, start, box);
  const gameDate = feed.gameData?.datetime?.officialDate ?? easternDate(new Date(start || now));
  const pregame = await readMlbPregame({
    // Once the game is on, nothing in the research can change; a live page polls every 15 seconds.
    memoize: started,
    gamePk,
    date: gameDate,
    season: Number(String(feed.gameData?.game?.season ?? gameDate.slice(0, 4))),
    awayId: Number(feed.gameData?.teams?.away?.id),
    homeId: Number(feed.gameData?.teams?.home?.id),
    props: props.filter((p) => p.books >= 2).map((p) => ({ playerId: p.playerId, market: p.market })),
  });

  const away = side(feed, 'away', state);
  const home = side(feed, 'home', state);
  const innings: Array<{ num: number; away?: { runs?: number }; home?: { runs?: number } }> = Array.isArray(feed.linescore?.innings) ? feed.linescore.innings : [];
  const periodCount = Math.max(innings.length, started ? 9 : 0);
  const lineScore =
    started && box
      ? {
          periods: Array.from({ length: periodCount }, (_, i) => String(i + 1)),
          totals: ['R', 'H', 'E', 'LOB'],
          away: [...Array.from({ length: periodCount }, (_, i) => innings[i]?.away?.runs ?? null), box.away.totals.r, box.away.totals.h, box.away.totals.e, box.away.totals.lob],
          home: [...Array.from({ length: periodCount }, (_, i) => innings[i]?.home?.runs ?? (innings[i] && state === 'final' ? 'x' : null)), box.home.totals.r, box.home.totals.h, box.home.totals.e, box.home.totals.lob],
        }
      : null;

  const lastName = (p: { fullName?: string } | undefined) => p?.fullName?.split(' ').slice(-1)[0];
  const d = feed.decisions ?? {};
  const probable = feed.gameData?.probablePitchers ?? {};
  const notes = [
    ...(state === 'final' ? [d.winner ? `W ${lastName(d.winner)}` : null, d.loser ? `L ${lastName(d.loser)}` : null, d.save ? `SV ${lastName(d.save)}` : null] : []),
    ...(state === 'pre' && (probable.away || probable.home) ? [`Probable: ${probable.away?.fullName ?? 'TBD'} vs ${probable.home?.fullName ?? 'TBD'}`] : []),
  ].filter((x): x is string => Boolean(x));
  const w = feed.gameData?.weather;
  // A closed roof reports "0 mph, None"; wind is left out when there is none.
  const wind = typeof w?.wind === 'string' && !/^0 mph/.test(w.wind) ? w.wind : null;
  const conditions = w?.temp ? [`${w.temp}°F${w.condition ? ` ${w.condition}` : ''}`, wind ? `wind ${wind}` : null].filter(Boolean).join(', ') : null;
  const fetchedAt = now.toISOString();

  return {
    sport: 'mlb',
    gameId: String(gamePk),
    state,
    statusText: statusText(feed, state),
    start,
    venue: feed.gameData?.venue?.name ?? null,
    conditions,
    away,
    home,
    lineScore,
    notes,
    mlb: {
      atBats,
      winProbability: parseMlbWinProbability(wpRaw),
      box,
      lines,
      props,
      propsAltOnly: altOnly,
      pitchDataHeld: atBats.some((a) => a.pitches.some((p) => p.pX != null)),
      pregame,
      live: state === 'live' && inGame ? liveNow(feed, inGame) : null,
    },
    sources: [
      { label: 'Game, box score and every pitch', detail: 'MLB Stats API live feed by game pk', asOf: fetchedAt },
      ...(started ? [{ label: 'Win probability', detail: 'MLB Stats API win probability after each plate appearance', asOf: fetchedAt }] : []),
      { label: 'Game lines', detail: 'game_odds_history: each book’s first and last quote before the start, median across books', asOf: fetchedAt },
      ...(state === 'live' ? [{ label: 'In-game odds', detail: 'game_odds_history after the first pitch: the main line from the latest capture, and the moneyline with the vig removed per book', asOf: inGame?.now[0]?.asOf ?? null }] : []),
      { label: 'Player props', detail: 'prop_odds as they stood at the start: the main line quoted on both sides by the most books', asOf: fetchedAt },
      { label: 'Strength vs strength', detail: 'team_game_production before this game’s date, ranked across the league', asOf: fetchedAt },
      { label: 'Form and head-to-head', detail: 'MLB Stats API team schedules, regular season, games before this one', asOf: fetchedAt },
      { label: 'Starters and lineups', detail: 'mlb_statcast_game_pregame: the Statcast corpus through the day before, kept from the morning of the game (from 2026-09-11, with days missing)', asOf: pregame.starters?.computedAt ?? null },
      { label: 'Prop history', detail: 'player_game_history, this season and last, games before this one', asOf: fetchedAt },
      // Rosters as they read now: shown before the start only.
      ...(state === 'pre' || state === 'postponed' ? [{ label: 'Injuries', detail: 'MLB Stats API rosters: players on the injured list or day-to-day, as the roster reads now', asOf: fetchedAt }] : []),
    ],
    fetchedAt,
  };
}
