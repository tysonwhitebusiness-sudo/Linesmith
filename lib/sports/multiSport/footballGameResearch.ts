/**
 * NFL and CFB game page read — R8.2. One reader for both leagues: ESPN serves
 * the same summary document for each (`footballLiveGame.ts`'s header).
 *
 * - status, teams, line score, drives with every play, win probability, box
 *   score, team stats, scoring plays and injuries: ESPN's summary by event id
 *   (`fetchEspnSummary`, R4 parsers). Past games resolve: the summary carries
 *   any event, where the old NFL page looked the id up in this week's slate.
 * - lines: ESPN `pickcenter`, DraftKings' open and close for the moneyline,
 *   spread and total. MEASURED 2026-09-17: `game_odds_history` holds football
 *   MONEYLINES ONLY (oddsharvester; 4 books on DAL @ NYG, 3 on OSU @ TEX), and
 *   `game_odds_book_lines` keeps only the current board, so pickcenter is the
 *   only open-to-close spread and total there is. The stored moneyline's
 *   median across books is shown beside it where held.
 * - player props: the main line at the start (`gameMainLines`), resolved
 *   against the box score by ESPN athlete id (prop subjects are
 *   `espn:football:{id}`).
 *
 * Server-only: reads Postgres.
 */

import { fetchEspnSummary, type EspnLeaguePath } from '@/lib/sports/espn/summary';
import { parseDrives, parseGameLines, parseInjuries, parseWinProbability, type Drive, type GameLines, type InjuryReport, type WinProbabilityPoint } from '@/lib/sports/espn/summaryParsers';
import { readPreGamePropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import { readInGameLines, readPreGameOpenClose, type GameLineOpenClose, type InGameLines } from '@/lib/odds/gameLineHistory';
import { gameMainLines, type GameMainLine } from '@/lib/odds/props/gameProps';
import type { GameResearchPayload, GameSide, GameState } from '@/lib/sports/shared/gameResearchShapes';
import { boxStat, boxTeamOf, parseEspnBox, type EspnBoxGroup, type EspnBoxTeam } from '@/lib/sports/espn/boxscore';

/** The box shapes are ESPN's, shared since R8.4 (NBA's box is the same document). Football names kept for its callers. */
export type FootballBoxGroup = EspnBoxGroup;
export type FootballBoxTeam = EspnBoxTeam;
export { boxStat, boxTeamOf };
export const parseFootballBox = parseEspnBox;
import { readFootballPregame, type FootballPregame } from './footballPregame';

export type FootballLeague = 'nfl' | 'cfb';

const LEAGUE_PATH: Record<FootballLeague, EspnLeaguePath> = { nfl: 'football/nfl', cfb: 'football/college-football' };

export interface FootballTeamStat {
  key: string;
  label: string;
  away: string;
  home: string;
}

export interface FootballScoringPlay {
  id: string;
  teamId: string | null;
  type: string | null;
  text: string | null;
  period: number | null;
  clock: string | null;
  awayScore: number | null;
  homeScore: number | null;
}

export interface FootballPropResult extends GameMainLine {
  /** The ESPN athlete id, without the `espn:football:` prefix. */
  athleteId: string;
  side: 'away' | 'home' | null;
  /** The player's number in this market from the box; `null` before the game, when he did not play, or for a market the box cannot settle. */
  result: number | null;
}

export interface FootballGameResearchPayload extends GameResearchPayload {
  football: {
    league: FootballLeague;
    drives: Drive[];
    winProbability: WinProbabilityPoint[];
    box: FootballBoxTeam[];
    teamStats: FootballTeamStat[];
    scoring: FootballScoringPlay[];
    /** ESPN pickcenter: DraftKings' open and close. */
    lines: GameLines | null;
    /** `game_odds_history` open and close, median across books. Football holds moneylines only. */
    storedLines: GameLineOpenClose[];
    props: FootballPropResult[];
    propsAltOnly: number;
    injuries: InjuryReport;
    /** The research as of kickoff (R8.2b). */
    pregame: FootballPregame;
    /** While the game is on (R8.2c); `null` otherwise. */
    live: FootballLiveNow | null;
  };
}

export interface FootballLiveNow {
  period: number | null;
  clock: string | null;
  /** The team with the ball and the next snap: "2nd & 5 at NYG 22". `null` between possessions. */
  possessionTeamId: string | null;
  downText: string | null;
  redZone: boolean;
  lastPlay: string | null;
  inGame: InGameLines;
}

/**
 * Where a live game stands. ESPN's header `situation` is used when it is there
 * (`footballLiveGame.ts` notes it as seen but unverified); otherwise the last
 * play's own after-the-snap record, which every play carries.
 */
export function footballLiveNow(summary: J, drives: Drive[], inGame: InGameLines): FootballLiveNow {
  const comp = summary?.header?.competitions?.[0];
  const sit = comp?.situation ?? summary?.situation ?? null;
  const drive = drives.find((d) => d.current) ?? drives[drives.length - 1];
  const last = drive?.plays[drive.plays.length - 1];
  return {
    period: num(comp?.status?.period),
    clock: comp?.status?.displayClock ?? null,
    possessionTeamId: sit?.possession != null ? String(sit.possession) : drive?.current ? drive.teamId : null,
    downText: sit?.downDistanceText ?? last?.nextDownText ?? null,
    redZone: sit?.isRedZone === true,
    lastPlay: sit?.lastPlay?.text ?? last?.text ?? null,
    inGame,
  };
}

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function footballGameState(summary: J): GameState | null {
  const type = summary?.header?.competitions?.[0]?.status?.type;
  if (!type) return null;
  if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED/.test(String(type.name ?? ''))) return 'postponed';
  if (type.state === 'post' || type.completed === true) return 'final';
  if (type.state === 'in') return 'live';
  return 'pre';
}

export async function footballStateOf(league: FootballLeague, eventId: string): Promise<GameState | null> {
  return footballGameState(await fetchEspnSummary(LEAGUE_PATH[league], eventId));
}

/**
 * A prop market's number from the box score. A player in the box with nothing
 * in a group counts zero there (a receiver with no carries ran for 0 yards); a
 * player not in the box, or a market this does not know, returns `null`. MEASURED market keys on 2026-09-17 across four games:
 * rushing-yards, passing-yards, receptions, sacks, pass-attempts, tackles,
 * receiving-yards, assists.
 */
export function footballMarketResult(box: FootballBoxTeam[], athleteId: string, market: string): number | null {
  if (!boxTeamOf(box, athleteId)) return null;
  const z = (group: string, key: string) => boxStat(box, athleteId, group, key) ?? 0;
  switch (market) {
    case 'passing-yards': return z('passing', 'passingYards');
    case 'passing-tds': return z('passing', 'passingTouchdowns');
    case 'completions': return z('passing', 'completions');
    case 'pass-attempts':
    case 'passing-attempts': return z('passing', 'passingAttempts');
    case 'interceptions': return z('passing', 'interceptions');
    case 'rushing-yards': return z('rushing', 'rushingYards');
    case 'rushing-attempts': return z('rushing', 'rushingAttempts');
    case 'receiving-yards': return z('receiving', 'receivingYards');
    case 'receptions': return z('receiving', 'receptions');
    case 'longest-reception': return z('receiving', 'longReception');
    case 'rush-rec-yards': return z('rushing', 'rushingYards') + z('receiving', 'receivingYards');
    case 'pass-rush-yards': return z('passing', 'passingYards') + z('rushing', 'rushingYards');
    // SOLO tackles, not total. MEASURED on DAL @ NYG (401872930): DraftKings hung
    // "tackles" at 2.5-4.5 for every defender, linebackers included (Overshown
    // 4.5, Edmunds 3.5), who made 7 and 8 total; their solo counts sit around
    // the lines. G2's mock read total tackles, which would settle nearly every
    // over.
    case 'tackles': return z('defensive', 'soloTackles');
    // ESPN reports total and solo tackles; assists are the difference.
    case 'assists': return z('defensive', 'totalTackles') - z('defensive', 'soloTackles');
    case 'sacks': return z('defensive', 'sacks');
    case 'anytime-td': return z('rushing', 'rushingTouchdowns') + z('receiving', 'receivingTouchdowns') > 0 ? 1 : 0;
    default: return null;
  }
}

function teamStats(summary: J, awayId: string, homeId: string): FootballTeamStat[] {
  const teams: J[] = summary?.boxscore?.teams ?? [];
  const of = (id: string) => (teams.find((t) => String(t.team?.id) === id)?.statistics ?? []) as J[];
  const away = of(awayId);
  const home = of(homeId);
  // ESPN lists "interceptions" twice (thrown, in passing and again under turnovers); keep the first.
  const seen = new Set<string>();
  return away.flatMap((s, i) => {
    const key = String(s.name ?? i);
    if (seen.has(key)) return [];
    seen.add(key);
    const h = home.find((x) => x.name === s.name);
    return [{ key, label: String(s.label ?? key), away: String(s.displayValue ?? ''), home: String(h?.displayValue ?? '') }];
  });
}

function side(comp: J | undefined, league: FootballLeague, state: GameState): GameSide {
  const t = comp?.team ?? {};
  const rec = (comp?.record ?? []).find((r: J) => r.type === 'total')?.summary ?? null;
  return {
    id: String(t.id ?? ''),
    name: String(t.displayName ?? t.name ?? ''),
    abbr: String(t.abbreviation ?? ''),
    logoUrl: t.logos?.[0]?.href ?? t.logo ?? null,
    href: t.id != null ? `/${league}/team/${t.id}` : null,
    score: state === 'pre' || comp?.score == null ? null : num(comp.score),
    record: rec,
  };
}

const PERIOD = (i: number) => (i < 4 ? `Q${i + 1}` : i === 4 ? 'OT' : `${i - 3}OT`);

export async function readFootballGameResearch(league: FootballLeague, eventId: string, now: Date = new Date()): Promise<FootballGameResearchPayload | null> {
  const summary: J = await fetchEspnSummary(LEAGUE_PATH[league], eventId);
  const comp = summary?.header?.competitions?.[0];
  const state = footballGameState(summary);
  if (!comp || !state) return null;
  const awayComp = (comp.competitors ?? []).find((c: J) => c.homeAway === 'away');
  const homeComp = (comp.competitors ?? []).find((c: J) => c.homeAway === 'home');
  const away = side(awayComp, league, state);
  const home = side(homeComp, league, state);
  const start: string = comp.date ?? '';
  const started = state === 'live' || state === 'final';
  const fetchedAt = now.toISOString();

  const [storedLines, propRows, inGame] = await Promise.all([
    readPreGameOpenClose(eventId, start).catch((): GameLineOpenClose[] => []),
    readPreGamePropOddsForGame(eventId, start).catch((): PropOddsRow[] => []),
    state === 'live' ? readInGameLines(eventId, start, now).catch((): InGameLines => ({ now: [], moneyline: [] })) : Promise.resolve(null),
  ]);
  const box = started ? parseFootballBox(summary) : [];
  const { lines: mainLines, altOnly } = gameMainLines(propRows, start, now.getTime());
  const props: FootballPropResult[] = mainLines.map((l) => {
    const athleteId = l.playerId.split(':').pop() ?? l.playerId;
    const teamId = boxTeamOf(box, athleteId);
    return { ...l, athleteId, side: teamId === away.id ? 'away' : teamId === home.id ? 'home' : null, result: started ? footballMarketResult(box, athleteId, l.market) : null };
  });

  const pregame = await readFootballPregame({
    league,
    eventId,
    start,
    season: Number(summary?.header?.season?.year ?? new Date(start || now).getUTCFullYear()),
    awayId: away.id,
    homeId: home.id,
    props: props.filter((p) => p.books >= 2).map((p) => ({ athleteId: p.athleteId, market: p.market })),
    memoize: started,
    final: state === 'final',
  });
  for (const p of props) {
    if (p.side) continue;
    const teamId = pregame.teamOf[p.athleteId];
    p.side = teamId === away.id ? 'away' : teamId === home.id ? 'home' : null;
  }

  const drives = started ? parseDrives(summary) : [];

  const periods = Math.max(awayComp?.linescores?.length ?? 0, homeComp?.linescores?.length ?? 0, started ? 4 : 0);
  const scoreRow = (c: J) => [...Array.from({ length: periods }, (_, i) => num(c?.linescores?.[i]?.displayValue)), num(c?.score)];
  const lineScore = started ? { periods: Array.from({ length: periods }, (_, i) => PERIOD(i)), totals: ['T'], away: scoreRow(awayComp), home: scoreRow(homeComp) } : null;

  const venue = summary?.gameInfo?.venue;
  const w = summary?.gameInfo?.weather;
  const conditions = w?.temperature != null ? [`${w.temperature}°F`, w.displayValue ?? null].filter(Boolean).join(' ') : null;
  const lines = parseGameLines(summary);

  return {
    sport: league,
    gameId: eventId,
    state,
    // Before kickoff ESPN's short detail is the start time ("9/17 - 8:15 PM EDT"), which the hero already shows.
    statusText: String((state === 'pre' ? comp.status?.type?.description : comp.status?.type?.shortDetail) ?? comp.status?.type?.description ?? ''),
    start,
    venue: venue?.fullName ?? null,
    conditions,
    away,
    home,
    lineScore,
    notes: [],
    football: {
      league,
      drives,
      winProbability: started ? parseWinProbability(summary) : [],
      box,
      teamStats: started ? teamStats(summary, away.id, home.id) : [],
      scoring: (summary?.scoringPlays ?? []).map((p: J) => ({
        id: String(p.id),
        teamId: p.team?.id != null ? String(p.team.id) : null,
        type: p.type?.text ?? null,
        text: p.text ?? null,
        period: num(p.period?.number),
        clock: p.clock?.displayValue ?? null,
        awayScore: num(p.awayScore),
        homeScore: num(p.homeScore),
      })),
      lines,
      storedLines,
      props,
      propsAltOnly: altOnly,
      injuries: parseInjuries(summary, fetchedAt),
      pregame,
      live: state === 'live' && inGame ? footballLiveNow(summary, drives, inGame) : null,
    },
    sources: [
      { label: 'Game, drives, box score and win probability', detail: `ESPN ${league === 'nfl' ? 'NFL' : 'college football'} summary, event ${eventId}`, asOf: fetchedAt },
      { label: 'Game lines', detail: `ESPN pickcenter (${lines?.provider ?? 'DraftKings'}): open and close for the moneyline, spread and total${storedLines.length ? '; game_odds_history moneyline, median across books' : ''}`, asOf: fetchedAt },
      { label: 'Player props', detail: 'prop_odds as they stood at the start: the main line quoted on both sides by the most books', asOf: fetchedAt },
      ...(state === 'live' ? [{ label: 'In-game odds', detail: 'game_odds_history after kickoff: the main line from the latest capture (football holds moneylines only), and the moneyline with the vig removed per book', asOf: inGame?.now[0]?.asOf ?? null }] : []),
      { label: 'Strength vs strength', detail: 'team_game_production before this game’s date, ranked across the league', asOf: fetchedAt },
      { label: 'Form and head-to-head', detail: 'ESPN team schedules, regular season and postseason, games before this one', asOf: fetchedAt },
      ...(pregame.passing ? [{ label: 'Passing matchup', detail: 'team_target_profile (nflverse targets): each offense’s throws and each defense’s throws against, by depth and side, for the whole season as held', asOf: fetchedAt }] : []),
      { label: 'Prop history', detail: 'player_game_history, this season and last, games before this one', asOf: fetchedAt },
      ...(state === 'pre' || state === 'postponed' ? [{ label: 'Injuries', detail: 'ESPN summary injury report, as this app fetched it', asOf: fetchedAt }] : []),
    ],
    fetchedAt,
  };
}
