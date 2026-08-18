/**
 * Typed extraction over `getLiveFeed`'s raw `any` payload (statsapi.ts) for
 * the game hero card's Live tab. `getLiveFeed` already fetches this data
 * server-side for every live game during slate build (adapter.ts), but only
 * ever surfaces a score + inning-label string to the client — everything
 * else (per-inning line score, count/outs, baserunners, current batter,
 * live pitching lines) is fetched and discarded. This is the one place that
 * reads the rest of it, field names confirmed against a real MLB Stats API
 * response rather than assumed.
 */

import type { MlbLiveFeed } from './statsapi';
import { STAT_MARKET_BY_DIMENSION, PITCHER_MARKET_DIMENSIONS } from './adapter';

export interface LiveInningLine {
  inning: number;
  away: number | null;
  home: number | null;
}

export interface LiveTotals {
  r: number;
  h: number;
  e: number;
}

export interface LivePitcherLine {
  id: number;
  name: string;
  ip: string;
  h: number;
  r: number;
  k: number;
  pitches: number;
}

export interface LiveBatter {
  id: number;
  name: string;
  /** e.g. "1-for-2, RBI double" — hits-for-at-bats plus the last notable play this game, when there is one. */
  todayLine: string;
}

export interface BoxScoreBatter {
  id: number;
  name: string;
  position: string;
  /** 1-9 lineup slot, derived from the boxscore's own "100"/"200"/... encoding — null for a player without one (shouldn't happen for anyone who's actually batted). */
  order: number | null;
  atBats: number;
  runs: number;
  hits: number;
  rbi: number;
  walks: number;
  strikeOuts: number;
}

export interface BoxScorePitcher {
  id: number;
  name: string;
  inningsPitched: string;
  hits: number;
  runs: number;
  earnedRuns: number;
  walks: number;
  strikeOuts: number;
  pitches: number;
}

export interface BoxScoreTeam {
  /** In appearance order (starters then any substitutes), not raw batting-order slot — a pinch hitter shows where they actually batted, not where the starter they replaced was seeded. */
  batters: BoxScoreBatter[];
  /** In the order they pitched. */
  pitchers: BoxScorePitcher[];
  totals: LiveTotals;
}

export interface LiveInningPlay {
  inning: number;
  half: 'top' | 'bottom';
  /** Batting team's abbreviation-agnostic side — 'away' bats the top, 'home' bats the bottom. */
  battingSide: 'away' | 'home';
  batter: string;
  /** Short official event name, e.g. "Flyout", "Single", "Strikeout". */
  event: string;
  /** The play's own description with the batter's name stripped off the front, same convention as `subjectPlaysToday`. */
  description: string;
  rbi: number;
}

export interface LiveGameDetail {
  inning: { number: number; half: 'top' | 'bottom'; ordinal: string };
  outs: number;
  count: { balls: number; strikes: number };
  score: { home: number; away: number };
  linescore: LiveInningLine[];
  totals: { away: LiveTotals; home: LiveTotals };
  bases: { first: boolean; second: boolean; third: boolean };
  batter: LiveBatter | null;
  onDeck: LiveBatter | null;
  inHole: LiveBatter | null;
  /** Every completed plate appearance so far this game, in order — the detail behind the by-inning line score. */
  plays: LiveInningPlay[];
  pitchers: { away: LivePitcherLine | null; home: LivePitcherLine | null };
  /**
   * The pitcher actually facing `batter` right now — from
   * `linescore.defense.pitcher`, the defending team's own designated
   * pitcher field, which is guaranteed to belong to the non-batting side
   * (unlike `linescore.offense.pitcher`, confirmed against a real live feed
   * to sometimes echo the *batting* team's own pitcher instead of the
   * opponent's — a real quirk in MLB's feed, not a typo here). Updates the
   * moment a substitution happens. `pitchers.away`/`pitchers.home` above
   * are each team's *last pitcher used* per the boxscore's own pitcher-ID
   * list, which can lag a beat behind a mid-at-bat pitching change — this
   * field is the one to show as "who's on the mound right now".
   */
  currentPitcher: LivePitcherLine | null;
  boxscore: { away: BoxScoreTeam; home: BoxScoreTeam };
  /** Set by the `/live` route when called with `?subjectId=`, not by `buildLiveGameDetail` itself. */
  player?: LivePlayerLine | null;
  /** Set by the `/live` route when called with `?subjectId=` — see `liveMarketValues`. */
  liveValues?: Record<string, number>;
  /** Set by the `/live` route when called with `?subjectId=` — see `subjectPlaysToday`. */
  subjectPlays?: SubjectPlay[];
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** Notable-event suffix for a batter's today line, e.g. ", RBI double" — omitted when the last play isn't worth naming (out, non-RBI single, etc. still get named; only truly empty/unknown events are dropped). */
function lastPlaySuffix(plays: any, batterId: number): string {
  const allPlays = Array.isArray(plays?.allPlays) ? plays.allPlays : [];
  for (let i = allPlays.length - 1; i >= 0; i--) {
    const play = allPlays[i];
    if (play?.matchup?.batter?.id !== batterId || !play?.about?.isComplete) continue;
    const event = play?.result?.event as string | undefined;
    if (!event) return '';
    const rbi = Number(play?.result?.rbi ?? 0);
    const label = rbi > 0 ? `RBI ${event.toLowerCase()}` : event.toLowerCase();
    return `, ${label}`;
  }
  return '';
}

function pitcherLine(boxTeam: any, gameData: any): LivePitcherLine | null {
  const pitcherIds: number[] = Array.isArray(boxTeam?.pitchers) ? boxTeam.pitchers : [];
  const currentId = pitcherIds[pitcherIds.length - 1];
  if (currentId == null) return null;
  const entry = boxTeam?.players?.[`ID${currentId}`];
  const pitching = entry?.stats?.pitching;
  if (!pitching) return null;
  const name = entry?.person?.fullName ?? gameData?.players?.[`ID${currentId}`]?.fullName ?? 'Unknown';
  return {
    id: currentId,
    name,
    ip: String(pitching.inningsPitched ?? '0.0'),
    h: Number(pitching.hits ?? 0),
    r: Number(pitching.runs ?? 0),
    k: Number(pitching.strikeOuts ?? 0),
    pitches: Number(pitching.numberOfPitches ?? pitching.pitchesThrown ?? 0),
  };
}

/** Same shape as `pitcherLine`, but keyed off a known ID (`linescore.defense.pitcher`) instead of assuming "last pitcher used" — the ID can belong to either box team, so both are checked. */
function pitcherLineById(boxTeams: any, gameData: any, pitcherId: number | undefined, pitcherName: string | undefined): LivePitcherLine | null {
  if (pitcherId == null) return null;
  const entry = boxTeams.home?.players?.[`ID${pitcherId}`] ?? boxTeams.away?.players?.[`ID${pitcherId}`];
  const pitching = entry?.stats?.pitching;
  if (!pitching) return null;
  const name = pitcherName ?? entry?.person?.fullName ?? gameData?.players?.[`ID${pitcherId}`]?.fullName ?? 'Unknown';
  return {
    id: pitcherId,
    name,
    ip: String(pitching.inningsPitched ?? '0.0'),
    h: Number(pitching.hits ?? 0),
    r: Number(pitching.runs ?? 0),
    k: Number(pitching.strikeOuts ?? 0),
    pitches: Number(pitching.numberOfPitches ?? pitching.pitchesThrown ?? 0),
  };
}

function totalsFor(teamLinescore: any): LiveTotals {
  return {
    r: Number(teamLinescore?.runs ?? 0),
    h: Number(teamLinescore?.hits ?? 0),
    e: Number(teamLinescore?.errors ?? 0),
  };
}

export interface LiveBattingLine {
  atBats: number;
  hits: number;
  runs: number;
  rbi: number;
  walks: number;
  strikeOuts: number;
}

export interface LivePitchingLine {
  inningsPitched: string;
  hits: number;
  runs: number;
  earnedRuns: number;
  walks: number;
  strikeOuts: number;
  pitches: number;
}

export interface LivePlayerLine {
  id: number;
  batting: LiveBattingLine | null;
  pitching: LivePitchingLine | null;
  isCurrentBatter: boolean;
  isCurrentPitcher: boolean;
}

export interface SubjectPlay {
  inning: number;
  /** Short official event name, e.g. "Flyout", "Single", "Strikeout". */
  event: string;
  /** The play's own description with the batter's name stripped off the front — "flies out to right fielder Esteury Ruiz" rather than repeating "Elly De La Cruz flies out to...". */
  description: string;
  rbi: number;
}

/** Every completed plate appearance this subject has had today, in order — the detail behind the aggregate batting line (`livePlayerLine`), same `plays.allPlays` source `lastPlaySuffix` reads for the currently-up batter, just kept for every play instead of only the latest. */
export function subjectPlaysToday(feed: MlbLiveFeed, subjectId: string): SubjectPlay[] {
  const allPlays = Array.isArray(feed.plays?.allPlays) ? feed.plays.allPlays : [];
  const id = Number(subjectId);
  const out: SubjectPlay[] = [];
  for (const play of allPlays) {
    if (play?.matchup?.batter?.id !== id || !play?.about?.isComplete) continue;
    const event = play?.result?.event as string | undefined;
    if (!event) continue;
    const rawDescription = String(play?.result?.description ?? '').trim();
    const batterName = play?.matchup?.batter?.fullName as string | undefined;
    const description = (
      batterName && rawDescription.startsWith(batterName) ? rawDescription.slice(batterName.length) : rawDescription
    )
      .trim()
      .replace(/\.$/, '');
    out.push({
      inning: Number(play?.about?.inning ?? 0),
      event,
      description,
      rbi: Number(play?.result?.rbi ?? 0),
    });
  }
  return out;
}

/**
 * Every completed plate appearance in the game so far, not filtered to one
 * subject — same `plays.allPlays` source and batter-name-stripping
 * convention as `subjectPlaysToday`, just kept for the by-inning drill-down
 * instead of a single player's line.
 */
export function buildInningPlays(feed: MlbLiveFeed): LiveInningPlay[] {
  const allPlays = Array.isArray(feed.plays?.allPlays) ? feed.plays.allPlays : [];
  const out: LiveInningPlay[] = [];
  for (const play of allPlays) {
    if (!play?.about?.isComplete) continue;
    const event = play?.result?.event as string | undefined;
    if (!event) continue;
    const rawDescription = String(play?.result?.description ?? '').trim();
    const batterName = (play?.matchup?.batter?.fullName as string | undefined) ?? 'Unknown';
    const description = (
      rawDescription.startsWith(batterName) ? rawDescription.slice(batterName.length) : rawDescription
    )
      .trim()
      .replace(/\.$/, '');
    const half: 'top' | 'bottom' = play?.about?.halfInning === 'bottom' ? 'bottom' : 'top';
    out.push({
      inning: Number(play?.about?.inning ?? 0),
      half,
      battingSide: half === 'top' ? 'away' : 'home',
      batter: batterName,
      event,
      description,
      rbi: Number(play?.result?.rbi ?? 0),
    });
  }
  return out;
}

/**
 * One player's live batting/pitching line, keyed out of the same boxscore
 * `buildLiveGameDetail` reads — same `boxscore.teams.{home,away}.players["ID"+id]`
 * lookup `lib/odds/props/grading.ts`'s `findPlayer` already proves out for an
 * arbitrary subject ID, just against a live (not yet final) feed.
 */
export function livePlayerLine(feed: MlbLiveFeed, subjectId: string): LivePlayerLine | null {
  const boxTeams = feed.boxscore?.teams ?? {};
  const key = `ID${subjectId}`;
  const homeEntry = boxTeams.home?.players?.[key];
  const awayEntry = boxTeams.away?.players?.[key];
  const entry = homeEntry ?? awayEntry;
  if (!entry) return null;

  const battingStats = entry.stats?.batting;
  const pitchingStats = entry.stats?.pitching;
  const id = Number(subjectId);

  const batting: LiveBattingLine | null = battingStats
    ? {
        atBats: Number(battingStats.atBats ?? 0),
        hits: Number(battingStats.hits ?? 0),
        runs: Number(battingStats.runs ?? 0),
        rbi: Number(battingStats.rbi ?? 0),
        walks: Number(battingStats.baseOnBalls ?? 0),
        strikeOuts: Number(battingStats.strikeOuts ?? 0),
      }
    : null;

  const pitching: LivePitchingLine | null =
    pitchingStats && pitchingStats.inningsPitched != null
      ? {
          inningsPitched: String(pitchingStats.inningsPitched ?? '0.0'),
          hits: Number(pitchingStats.hits ?? 0),
          runs: Number(pitchingStats.runs ?? 0),
          earnedRuns: Number(pitchingStats.earnedRuns ?? 0),
          walks: Number(pitchingStats.baseOnBalls ?? 0),
          strikeOuts: Number(pitchingStats.strikeOuts ?? 0),
          pitches: Number(pitchingStats.numberOfPitches ?? pitchingStats.pitchesThrown ?? 0),
        }
      : null;

  if (!batting && !pitching) return null;

  const currentPitcherTeam = homeEntry ? boxTeams.home : boxTeams.away;
  const pitcherIds: number[] = Array.isArray(currentPitcherTeam?.pitchers) ? currentPitcherTeam.pitchers : [];
  const isCurrentPitcher = pitching != null && pitcherIds[pitcherIds.length - 1] === id;
  const isCurrentBatter = feed.linescore?.offense?.batter?.id === id;

  return { id, batting, pitching, isCurrentBatter, isCurrentPitcher };
}

/**
 * "Has this line hit yet" during a live game — the exact same `valueOf`
 * table `grading.ts` uses to settle finished picks (`STAT_MARKET_BY_DIMENSION`),
 * run against the live boxscore instead of the final one. Boxscore stat
 * objects use the same field names in-progress or final, so no separate
 * mapping is needed. `hit-in-game` and `first-inning` aren't in that table
 * (grading.ts hand-builds those too) so they're computed the same way here.
 * `vs-LHP`/`vs-RHP` aren't covered — same documented gap as grading.ts.
 */
export function liveMarketValues(feed: MlbLiveFeed, subjectId: string): Record<string, number> {
  const boxTeams = feed.boxscore?.teams ?? {};
  const key = `ID${subjectId}`;
  const homeEntry = boxTeams.home?.players?.[key];
  const awayEntry = boxTeams.away?.players?.[key];
  const entry = homeEntry ?? awayEntry;
  if (!entry) return {};
  const isHome = homeEntry != null;

  const battingStats = entry.stats?.batting;
  const pitchingStats = entry.stats?.pitching;
  const values: Record<string, number> = {};

  for (const [dimension, def] of Object.entries(STAT_MARKET_BY_DIMENSION)) {
    const statGroup = PITCHER_MARKET_DIMENSIONS.has(dimension) ? pitchingStats : battingStats;
    if (!statGroup) continue;
    values[dimension] = def.valueOf(statGroup);
  }

  if (battingStats) {
    values['hit-in-game'] = Number(battingStats.hits ?? 0);
  }

  if (pitchingStats) {
    const innings = Array.isArray(feed.linescore?.innings) ? feed.linescore.innings : [];
    const first = innings.find((i: any) => i.num === 1);
    if (first) {
      // Home team pitches the top of the 1st (retiring the away side); away
      // team pitches the bottom — same convention grading.ts uses.
      values['first-inning'] = Number((isHome ? first.away?.runs : first.home?.runs) ?? 0);
    }
  }

  return values;
}

/** Every batter and pitcher who's appeared for one team, in the order the boxscore lists them — `batters`/`pitchers` there are already appearance-ordered (substitutes included), so no re-sorting is needed. */
function buildBoxScoreTeam(boxTeam: any, gameData: any, teamLinescore: any): BoxScoreTeam {
  const batterIds: number[] = Array.isArray(boxTeam?.batters) ? boxTeam.batters : [];
  const pitcherIds: number[] = Array.isArray(boxTeam?.pitchers) ? boxTeam.pitchers : [];

  const batters: BoxScoreBatter[] = batterIds
    .map((id): BoxScoreBatter | null => {
      const entry = boxTeam?.players?.[`ID${id}`];
      const batting = entry?.stats?.batting;
      // A pitcher who came in but never had a plate appearance still shows
      // up in `batters` on some feeds — no batting line means nothing to
      // show, not a zero-for-zero row.
      if (!batting || batting.plateAppearances == null) return null;
      const name = entry?.person?.fullName ?? gameData?.players?.[`ID${id}`]?.fullName ?? 'Unknown';
      const order = entry?.battingOrder != null ? Math.floor(Number(entry.battingOrder) / 100) : null;
      return {
        id,
        name,
        position: entry?.position?.abbreviation ?? '',
        order,
        atBats: Number(batting.atBats ?? 0),
        runs: Number(batting.runs ?? 0),
        hits: Number(batting.hits ?? 0),
        rbi: Number(batting.rbi ?? 0),
        walks: Number(batting.baseOnBalls ?? 0),
        strikeOuts: Number(batting.strikeOuts ?? 0),
      };
    })
    .filter((b): b is BoxScoreBatter => b != null);

  const pitchers: BoxScorePitcher[] = pitcherIds
    .map((id): BoxScorePitcher | null => {
      const entry = boxTeam?.players?.[`ID${id}`];
      const pitching = entry?.stats?.pitching;
      if (!pitching) return null;
      const name = entry?.person?.fullName ?? gameData?.players?.[`ID${id}`]?.fullName ?? 'Unknown';
      return {
        id,
        name,
        inningsPitched: String(pitching.inningsPitched ?? '0.0'),
        hits: Number(pitching.hits ?? 0),
        runs: Number(pitching.runs ?? 0),
        earnedRuns: Number(pitching.earnedRuns ?? 0),
        walks: Number(pitching.baseOnBalls ?? 0),
        strikeOuts: Number(pitching.strikeOuts ?? 0),
        pitches: Number(pitching.numberOfPitches ?? pitching.pitchesThrown ?? 0),
      };
    })
    .filter((p): p is BoxScorePitcher => p != null);

  return { batters, pitchers, totals: totalsFor(teamLinescore) };
}

/** Shared by `batter`/`onDeck`/`inHole` — hits-for-at-bats plus the last notable play *this player* had today, wherever in the lineup they sit. */
function battingTodayLine(boxTeams: any, feed: MlbLiveFeed, id: number): string {
  const battingSide = boxTeams.home?.players?.[`ID${id}`] ? boxTeams.home : boxTeams.away;
  const batting = battingSide?.players?.[`ID${id}`]?.stats?.batting;
  const base = `${Number(batting?.hits ?? 0)}-for-${Number(batting?.atBats ?? 0)}`;
  return `${base}${lastPlaySuffix(feed.plays, id)}`;
}

export function buildLiveGameDetail(feed: MlbLiveFeed): LiveGameDetail | null {
  const linescore = feed.linescore;
  if (!linescore || linescore.currentInning == null) return null;

  const boxTeams = feed.boxscore?.teams ?? {};
  const offense = linescore.offense ?? {};
  const defense = linescore.defense ?? {};
  const batterId: number | undefined = offense.batter?.id;
  const batterName: string | undefined = offense.batter?.fullName;
  const onDeckId: number | undefined = offense.onDeck?.id;
  const onDeckName: string | undefined = offense.onDeck?.fullName;
  const inHoleId: number | undefined = offense.inHole?.id;
  const inHoleName: string | undefined = offense.inHole?.fullName;

  return {
    inning: {
      number: linescore.currentInning,
      half: linescore.isTopInning ? 'top' : 'bottom',
      ordinal: ordinal(linescore.currentInning),
    },
    outs: Number(linescore.outs ?? 0),
    count: { balls: Number(linescore.balls ?? 0), strikes: Number(linescore.strikes ?? 0) },
    score: {
      home: Number(linescore.teams?.home?.runs ?? 0),
      away: Number(linescore.teams?.away?.runs ?? 0),
    },
    linescore: (Array.isArray(linescore.innings) ? linescore.innings : []).map((inn: any) => ({
      inning: inn.num,
      away: inn.away?.runs ?? null,
      home: inn.home?.runs ?? null,
    })),
    totals: {
      away: totalsFor(linescore.teams?.away),
      home: totalsFor(linescore.teams?.home),
    },
    bases: {
      first: offense.first != null,
      second: offense.second != null,
      third: offense.third != null,
    },
    batter:
      batterId != null && batterName
        ? { id: batterId, name: batterName, todayLine: battingTodayLine(boxTeams, feed, batterId) }
        : null,
    onDeck:
      onDeckId != null && onDeckName
        ? { id: onDeckId, name: onDeckName, todayLine: battingTodayLine(boxTeams, feed, onDeckId) }
        : null,
    inHole:
      inHoleId != null && inHoleName
        ? { id: inHoleId, name: inHoleName, todayLine: battingTodayLine(boxTeams, feed, inHoleId) }
        : null,
    plays: buildInningPlays(feed),
    pitchers: {
      away: pitcherLine(boxTeams.away, feed.gameData),
      home: pitcherLine(boxTeams.home, feed.gameData),
    },
    currentPitcher: pitcherLineById(boxTeams, feed.gameData, defense.pitcher?.id, defense.pitcher?.fullName),
    boxscore: {
      away: buildBoxScoreTeam(boxTeams.away, feed.gameData, linescore.teams?.away),
      home: buildBoxScoreTeam(boxTeams.home, feed.gameData, linescore.teams?.home),
    },
  };
}
