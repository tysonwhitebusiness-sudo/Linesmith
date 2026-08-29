/**
 * MLB adapter — normalises the Stats API into `PickCandidate`s.
 *
 * Initial dimensions (deliberately small and self-contained so more can be
 * added without touching the engine):
 *
 *   hit-in-game   — batter recorded a hit / did not, per game
 *   vs-LHP|vs-RHP — the same, restricted to games facing that handedness
 *   first-inning  — starting pitcher allowed a run in the 1st / did not
 *
 * Each dimension is one function returning `PickCandidate[]`; nothing else in
 * the file knows what they mean.
 */

import type {
  HistoryEntry,
  LiveState,
  LiveStatus,
  PickCandidate,
  SplitEvidence,
  SportSnapshot,
  SubjectSummary,
  WeatherContext,
} from '../../core/types';
import { standardWindows, subsetSplit } from '../../core/pickEngine';
import {
  easternDate,
  extractTeamResults,
  getHandedness,
  getInjuries,
  getLeagueStartingPitcherStats,
  getLiveFeed,
  getPeopleWithGameLogs,
  getRecentLineups,
  getScheduleRange,
  getSlate,
  getStandings,
  getTeamSeasonStats,
  ordinalRank,
  rankPitchers,
  rankTeams,
  PITCHER_RANK_KEYS,
  PITCHER_RANK_LOWER_IS_BETTER,
  PITCHING_RANK_INVERTED_KEYS,
  shiftDate,
  TEAM_STAT_KEYS,
} from './statsapi';
import type {
  GameLogSplit,
  MlbGame,
  MlbLiveFeed,
  PersonStats,
  PitcherRankKey,
  PitcherRanks,
  PitcherStatLine,
  RecentGameResult,
  TeamRanks,
  TeamStatKey,
  TeamStatLine,
} from './statsapi';
import { battersUntil, measuredGamePace, mlbEta } from './timing';
import { getWeather } from '../../weather/openMeteo';
import { leagueBaseRates, getActiveModelWeights, readGameModelCache, readPropModelCacheForGames, propModelCacheKey, type ModelWeightsRow, type PropModelCacheRow } from '../../db/client';
import { computeModelProbability } from '../../odds/props/edgeModel';
import { candidateCategoryToSide } from '../../odds/props/entityResolution';
import { applyFittedHomeRunWeights, applyLineupConfidence, parkHrFactorCentered, expectedPaCentered, pitcherMatchupSignal } from './homeRunModel';
import { loadTeamHrRateAllowedCache, type TeamHrRateAllowedCache } from './homeRunLiveMatchup';
import { ensureGameSims } from './gameSimCache';
import { computeMoneylineModel, type OpposingStarter } from './gameModel';
import { loadParkFactorCache } from './parkFactors';
import { getCurrentElo, restAndTravelFromState, pitcherAdjustment, type CurrentElo } from './eloModel';
import {
  getCachedStatcastPitcherRates,
  BATTER_STATCAST_RANK_KEYS,
  type BatterStatcastKey,
} from './savant';
import { getCachedPitcherRoleRankings } from './pitcherRankings';
import { getCachedBatterRankings, BATTER_TRADITIONAL_RANK_KEYS, type RankedBatter } from './batterRankings';

/**
 * MLB's own image CDN, not ESPN's.
 *
 * This matters: ESPN's headshot path keys on ESPN athlete ids, and the ids we
 * hold come from the MLB Stats API — a different namespace, so an ESPN URL
 * built from them 404s. MLB's CDN keys on exactly the ids we already have.
 */
function mlbHeadshotUrl(personId: number): string {
  return (
    'https://img.mlbstatic.com/mlb-photos/image/upload/' +
    'w_213,d_people:generic:headshot:67:current.png,q_auto:best,f_auto/' +
    `v1/people/${personId}/headshot/67/current`
  );
}

function mlbTeamLogoUrl(teamId: number): string {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

// ---------------------------------------------------------------------------
// Model-upgrade Phase 4 — lineup/platoon-aware offense, weather physics
// ---------------------------------------------------------------------------

/**
 * Standard linear-weights coefficients (wOBA) — well-established sabermetric
 * constants, not locally derived. Used here only as a RATIO (a batter's
 * vs-handedness wOBA over their own overall wOBA), which is deliberately
 * more conservative than converting wOBA to an absolute runs figure: a ratio
 * self-cancels most of the error if these constants drift slightly from
 * this exact season's true values, where an absolute conversion would not.
 */
const WOBA_WEIGHTS = { walk: 0.69, hitByPitch: 0.72, single: 0.89, double: 1.27, triple: 1.62, homeRun: 2.1 };
/** Below this many at-bats in the split, a batter's vs-handedness rate is too thin to trust — same "honest gap" discipline as every other sample-gated adjustment in this app. */
const MIN_AB_FOR_PLATOON_SPLIT = 20;
/** Bounds the whole lineup's platoon adjustment to ±15% of their normal scoring rate — one hot/cold platoon read shouldn't dominate the model. */
const MAX_PLATOON_FACTOR_DEVIATION = 0.15;

interface HittingCounts {
  atBats: number;
  walks: number;
  hitByPitch: number;
  sacFlies: number;
  singles: number;
  doubles: number;
  triples: number;
  homeRuns: number;
}

function sumHittingCounts(logs: GameLogSplit[]): HittingCounts {
  const out: HittingCounts = { atBats: 0, walks: 0, hitByPitch: 0, sacFlies: 0, singles: 0, doubles: 0, triples: 0, homeRuns: 0 };
  for (const g of logs) {
    const atBats = Number(g.stat?.atBats ?? 0);
    const hits = Number(g.stat?.hits ?? 0);
    const doubles = Number(g.stat?.doubles ?? 0);
    const triples = Number(g.stat?.triples ?? 0);
    const homeRuns = Number(g.stat?.homeRuns ?? 0);
    out.atBats += atBats;
    out.walks += Number(g.stat?.baseOnBalls ?? 0);
    out.hitByPitch += Number(g.stat?.hitByPitch ?? 0);
    out.sacFlies += Number(g.stat?.sacFlies ?? 0);
    out.singles += hits - doubles - triples - homeRuns;
    out.doubles += doubles;
    out.triples += triples;
    out.homeRuns += homeRuns;
  }
  return out;
}

function wobaFromCounts(c: HittingCounts): number | null {
  const denom = c.atBats + c.walks + c.sacFlies + c.hitByPitch;
  if (denom <= 0) return null;
  const numer =
    WOBA_WEIGHTS.walk * c.walks +
    WOBA_WEIGHTS.hitByPitch * c.hitByPitch +
    WOBA_WEIGHTS.single * c.singles +
    WOBA_WEIGHTS.double * c.doubles +
    WOBA_WEIGHTS.triple * c.triples +
    WOBA_WEIGHTS.homeRun * c.homeRuns;
  return numer / denom;
}

/**
 * How much today's actual lineup — specifically facing this handedness of
 * starter — should be expected to out- or under-perform its own overall
 * rate. 1.0 (no adjustment) whenever there isn't enough real signal:
 * unknown opposing hand, a batter missing from the fetched stats, or too
 * few plate appearances in the split to trust it for that one batter (that
 * batter simply contributes no adjustment rather than a noisy one).
 */
function lineupPlatoonFactor(
  lineupIds: number[],
  opposingHand: string | undefined,
  batters: Map<number, PersonStats>,
  startersByGame: Map<number, { homeId?: number; awayId?: number }>,
  handById: Map<number, { pitchHand?: string }>,
): number {
  if (!opposingHand || lineupIds.length === 0) return 1;

  let ratioSum = 0;
  let count = 0;
  for (const id of lineupIds) {
    const person = batters.get(id);
    if (!person) continue;

    const vsHandLogs = person.gameLog.filter((split) => {
      if (!split.gamePk) return false;
      const starters = startersByGame.get(split.gamePk);
      if (!starters) return false;
      const opposingId = split.isHome ? starters.awayId : starters.homeId;
      if (!opposingId) return false;
      return handById.get(opposingId)?.pitchHand === opposingHand;
    });

    const vsHandCounts = sumHittingCounts(vsHandLogs);
    if (vsHandCounts.atBats < MIN_AB_FOR_PLATOON_SPLIT) continue;

    const overallCounts = sumHittingCounts(person.gameLog);
    const vsHandWoba = wobaFromCounts(vsHandCounts);
    const overallWoba = wobaFromCounts(overallCounts);
    if (vsHandWoba == null || overallWoba == null || overallWoba <= 0) continue;

    ratioSum += vsHandWoba / overallWoba;
    count += 1;
  }

  if (count === 0) return 1;
  const avgRatio = ratioSum / count;
  return Math.min(1 + MAX_PLATOON_FACTOR_DEVIATION, Math.max(1 - MAX_PLATOON_FACTOR_DEVIATION, avgRatio));
}

/**
 * MLB venues with a fixed or retractable roof — weather (temperature, wind)
 * shouldn't move the model for these, since conditions are climate
 * controlled rather than the day's actual outdoor forecast. A retractable
 * roof's open/closed state isn't available from the feed this app already
 * uses, so these are excluded unconditionally rather than guessed — the
 * same "don't invent precision that isn't there" rule the rest of this
 * codebase already follows. Names match exactly what the schedule feed
 * reports (see the venue names surfaced by parkFactors.ts).
 */
const DOME_VENUE_NAMES = new Set([
  'Tropicana Field',
  'Rogers Centre',
  'Daikin Park',
  'Chase Field',
  'American Family Field',
  'T-Mobile Park',
  'Globe Life Field',
  'loanDepot park',
]);

const NEUTRAL_TEMP_F = 70;
/** Runs multiplier per degree away from a neutral 70°F — small, well-established, direction-independent (warmer air carries fly balls further either way). */
const TEMP_FACTOR_PER_DEGREE = 0.005;
const MAX_WEATHER_FACTOR_DEVIATION = 0.08;

/**
 * Deliberately temperature-only for now, not wind direction: a wind effect
 * needs each park's own orientation (which way center field actually
 * faces) to know whether a given wind direction helps or hurts, and getting
 * even one of 30 parks' orientations wrong would silently corrupt that
 * game's prediction. Temperature's effect doesn't depend on orientation at
 * all, so it's the one piece of weather physics safe to ship without that
 * reference data.
 */
function weatherRunsFactor(venueName: string | undefined, tempF: number | undefined): number {
  if (!venueName || DOME_VENUE_NAMES.has(venueName) || tempF == null || !Number.isFinite(tempF)) return 1;
  const delta = (tempF - NEUTRAL_TEMP_F) * TEMP_FACTOR_PER_DEGREE;
  return 1 + Math.min(MAX_WEATHER_FACTOR_DEVIATION, Math.max(-MAX_WEATHER_FACTOR_DEVIATION, delta));
}

/** How much history any dimension will look at. */
const HISTORY_WINDOW = 15;
/** How far back to pull linescores/probables for derived history. */
const RANGE_DAYS = 45;
/**
 * Phase O of docs/mlb-prediction-engine-ts-cutover-gameplan-2026-08-22.md —
 * a mlb_game_model_cache row older than this is treated as missing, not
 * trusted stale data, and this file falls back to computing gameModel/Elo
 * live instead. 2x the Python worker's own 15min computeMlbGameModelJob
 * interval, matching health_check.py's own STALE_MULTIPLIER convention for
 * exactly the same reason: the queue is priority-ordered, not a strict
 * timer, so a single legitimately-late cycle shouldn't trigger fallback —
 * only a genuinely stopped job should.
 */
const GAME_MODEL_CACHE_MAX_AGE_MS = 30 * 60_000;

/**
 * Task 2.7a — how stale a `mlb_prop_model_cache` row may be before this file
 * recomputes the prop model locally instead. 10 minutes: 2x
 * computeMlbPropPredictionsJob's own 5-minute interval, the same
 * "2x the writer's interval" rule GAME_MODEL_CACHE_MAX_AGE_MS above follows
 * and for the same reason — the Python queue is priority-ordered rather than
 * a strict timer, so one legitimately-late cycle must not trigger fallback,
 * only a genuinely stopped job.
 */
const PROP_MODEL_CACHE_MAX_AGE_MS = 10 * 60_000;

interface GameEloContext {
  home: { elo: number; gamesPlayed: number };
  away: { elo: number; gamesPlayed: number };
  homeRestDays: number;
  awayRestDays: number;
  homeTravelMiles: number;
  awayTravelMiles: number;
  homePitcherAdj: number;
  awayPitcherAdj: number;
}

// ---------------------------------------------------------------------------
// Slate assembly
// ---------------------------------------------------------------------------

interface TeamSide {
  teamId: number;
  teamName: string;
  abbreviation: string;
  isHome: boolean;
  /** Batting order for this game. */
  lineup: number[];
  lineupNames: Map<number, string>;
  /** True when the lineup is carried over from a previous game, not posted. */
  lineupProjected: boolean;
  starterId?: number;
  starterName?: string;
  /** Handedness of the pitcher this side will FACE. */
  opposingHand?: string;
}

interface SlateGame {
  gamePk: number;
  gameDate: string;
  status: LiveStatus;
  detailedState: string;
  away: TeamSide;
  home: TeamSide;
  venueName?: string;
  venueId?: number;
  weather?: WeatherContext;
  live?: MlbLiveFeed;
  /** Final score straight off the schedule fetch — free, unlike the live feed, which is only fetched for games still in progress. */
  finalScore?: { home: number; away: number };
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/**
 * Score and inning for a game in progress — or the final score for one that
 * has finished, straight off the schedule fetch (no live-feed call needed,
 * unlike mid-game, since the schedule already reports each side's final run
 * total once the game is over).
 */
function liveScoreboard(game: SlateGame): {
  liveScore?: { home: string; away: string };
  livePeriod?: string;
} {
  if (game.status === 'done' && game.finalScore) {
    return { liveScore: { home: String(game.finalScore.home), away: String(game.finalScore.away) } };
  }

  const linescore = game.live?.linescore;
  if (!linescore) return {};

  // MLB counts warmup as a live game and serves a 0–0 first-inning linescore
  // for it. Showing that as a live score claims play has started when it hasn't.
  if (/warmup|pre-game|scheduled|delayed start/i.test(game.detailedState)) return {};

  const home = linescore.teams?.home?.runs;
  const away = linescore.teams?.away?.runs;
  if (home == null && away == null) return {};

  const inning = linescore.currentInning;
  const state = linescore.inningState;

  return {
    liveScore: { home: String(home ?? 0), away: String(away ?? 0) },
    livePeriod: inning ? `${state ?? ''} ${ordinal(inning)}`.trim() : undefined,
  };
}

/**
 * A plain-English reading of the conditions.
 *
 * Built strictly from the numbers Open-Meteo actually returned — every clause
 * below is gated on a real value, and the whole sentence is omitted when there
 * is no weather to describe. It reads better than "72°F · Wind 6 mph W · Rain
 * 15%" and, crucially, says what the numbers *mean* for the game, which is the
 * question a bettor is actually asking. Nothing here is generated or guessed.
 */
function weatherNarrative(weather: WeatherContext | undefined, gameDate: string, venue?: string): string | null {
  if (!weather) return null;

  const hour = new Date(gameDate).getHours();
  const partOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const where = venue ? ` at ${venue}` : '';

  const temp = weather.tempF;
  const warmth =
    temp == null
      ? null
      : temp >= 85
        ? 'hot'
        : temp >= 72
          ? 'warm'
          : temp >= 58
            ? 'mild'
            : temp >= 45
              ? 'cool'
              : 'cold';

  const sky = weather.rainPct >= 60 ? 'a strong chance of rain' : weather.rainPct >= 30 ? 'some chance of rain' : 'dry conditions';

  const first = `This ${partOfDay}'s game${where} looks ${warmth ?? 'unremarkable'}${
    temp != null ? ` at ${Math.round(temp)}°F` : ''
  }, with ${sky}.`;

  const wind =
    weather.windMph >= 15
      ? `A strong ${weather.windMph} mph wind out of the ${weather.windDir} should play a part.`
      : weather.windMph >= 8
        ? `A ${weather.windMph} mph breeze from the ${weather.windDir}.`
        : `Winds are light at ${weather.windMph} mph.`;

  const impact =
    weather.rainPct >= 50
      ? 'Rain is the thing to watch here.'
      : weather.windMph >= 15
        ? 'Expect the wind to matter more than anything else.'
        : 'Overall, conditions should have little effect.';

  const caveat = weather.approximateLocation ? ' Reading is an area forecast, not an on-site one.' : '';

  return `${first} ${wind} ${impact}${caveat}`;
}

/**
 * Season totals divided by games played.
 *
 * Comparing raw totals would reward whoever has played more games, which the
 * stat comparison would then render as a longer bar — a real distortion in
 * August when teams differ by several games.
 */
function perGame(line: TeamStatLine | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  if (!line) {
    for (const { key } of TEAM_STAT_KEYS) out[key] = null;
    return out;
  }

  for (const { key, decimals } of TEAM_STAT_KEYS) {
    const value = line.values[key];
    if (value == null) {
      out[key] = null;
      continue;
    }
    // Rate stats (AVG/OBP/SLG/OPS) are already per-something; only counting
    // stats get divided down.
    out[key] = decimals === 3 || line.gamesPlayed === 0 ? value : value / line.gamesPlayed;
  }
  return out;
}

/** `perGame`'s companion — the same stat line, undivided, for callers that need the real season number alongside the per-game rate rather than instead of it. */
function seasonTotals(line: TeamStatLine | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  if (!line) {
    for (const { key } of TEAM_STAT_KEYS) out[key] = null;
    return out;
  }
  for (const { key } of TEAM_STAT_KEYS) {
    out[key] = line.values[key] ?? null;
  }
  return out;
}

function statusFor(game: MlbGame): LiveStatus {
  switch (game.abstractState) {
    case 'Live':
      return 'live';
    case 'Preview':
      return 'pre';
    case 'Final':
      return 'done';
    default:
      return 'unknown';
  }
}

/** Most recent posted batting order per team, used to project today's lineup. */
function buildRecentLineups(games: MlbGame[]): Map<number, { ids: number[]; names: Map<number, string>; date: string }> {
  const out = new Map<number, { ids: number[]; names: Map<number, string>; date: string }>();

  const sorted = [...games].sort((a, b) => a.gameDate.localeCompare(b.gameDate));
  for (const game of sorted) {
    for (const side of ['away', 'home'] as const) {
      const players = side === 'away' ? game.lineups?.awayPlayers : game.lineups?.homePlayers;
      if (!players || players.length === 0) continue;
      const teamId = game.teams[side].team.id;
      // Later games overwrite earlier ones, leaving the most recent lineup.
      out.set(teamId, {
        ids: players.map((p) => p.id),
        names: new Map(players.map((p) => [p.id, p.fullName])),
        date: game.gameDate,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Live position
// ---------------------------------------------------------------------------

interface LivePosition {
  battingTeamIsHome: boolean | null;
  currentBatterId: number | null;
  battingOrder: number[];
  inning: number | null;
  inningState: string | null;
  pace: number | null;
}

function readLivePosition(live: MlbLiveFeed | undefined, now: Date): LivePosition {
  if (!live) {
    return { battingTeamIsHome: null, currentBatterId: null, battingOrder: [], inning: null, inningState: null, pace: null };
  }

  const ls = live.linescore ?? {};
  const isTop = Boolean(ls.isTopInning);
  const battingTeamIsHome = ls.currentInning ? !isTop : null;

  const boxSide = isTop ? 'away' : 'home';
  const battingOrder: number[] = live.boxscore?.teams?.[boxSide]?.battingOrder ?? [];

  const plateAppearances = Array.isArray(live.plays?.allPlays) ? live.plays.allPlays.length : 0;
  const pace = measuredGamePace({
    firstPitch: live.gameData?.datetime?.dateTime,
    plateAppearances,
    now,
  });

  return {
    battingTeamIsHome,
    currentBatterId: ls.offense?.batter?.id ?? null,
    battingOrder,
    inning: ls.currentInning ?? null,
    inningState: ls.inningState ?? null,
    pace,
  };
}

/**
 * Live state for one batter. Exact when their side is batting; honestly
 * unknown-but-explained when they are in the field or no lineup exists.
 */
function batterLiveState(
  game: SlateGame,
  side: TeamSide,
  batterId: number,
  position: LivePosition,
  now: Date,
): LiveState {
  const base = { distanceUnit: 'batters' as const };

  if (game.status === 'done') {
    return { ...base, status: 'done', distanceToSubject: null, etaMinutes: null, etaConfidence: null };
  }

  if (game.status === 'pre') {
    return {
      ...base,
      status: 'pre',
      distanceToSubject: null,
      etaMinutes: null,
      etaConfidence: null,
      note: side.lineupProjected
        ? 'Lineup not posted yet — order projected from their last game.'
        : `First pitch ${new Date(game.gameDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`,
    };
  }

  if (game.status !== 'live') {
    return { ...base, status: 'unknown', distanceToSubject: null, etaMinutes: null, etaConfidence: null };
  }

  const teamIsBatting = position.battingTeamIsHome === side.isHome;
  if (!teamIsBatting) {
    return {
      ...base,
      status: 'live',
      distanceToSubject: null,
      etaMinutes: null,
      etaConfidence: null,
      note: `${side.abbreviation} are in the field (${position.inningState ?? ''} ${position.inning ?? ''}). Batter count resumes when they bat.`.trim(),
    };
  }

  const distance = battersUntil(position.battingOrder, position.currentBatterId, batterId);
  const eta = mlbEta(distance, position.pace);

  return {
    ...base,
    status: 'live',
    distanceToSubject: distance,
    etaMinutes: eta.etaMinutes,
    etaConfidence: eta.etaConfidence,
    note: distance === null ? 'Not in the current batting order — position unknown.' : eta.note,
  };
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

function recent(splits: GameLogSplit[], limit = HISTORY_WINDOW): GameLogSplit[] {
  // Game logs arrive oldest-first; keep the tail and preserve that order.
  return splits.slice(-limit);
}

function hitEntry(split: GameLogSplit, index: number): HistoryEntry {
  const hits = Number(split.stat?.hits ?? 0);
  const atBats = Number(split.stat?.atBats ?? 0);
  const got = hits > 0;
  return {
    period: index + 1,
    result: `${hits}-${atBats}`,
    category: got ? 'hit' : 'no-hit',
    periodLabel: `${split.date?.slice(5) ?? ''} ${split.isHome ? 'vs' : '@'} ${split.opponentName ?? ''}`.trim(),
    // Opponent and venue ride along so split evidence can be derived later.
    raw: { ...split.stat, opponentId: split.opponentId, isHome: split.isHome },
  };
}

/** Read the fields hitEntry stashed on `raw`. */
function entryMeta(entry: HistoryEntry): { opponentId?: number; isHome?: boolean } {
  const raw = entry.raw as { opponentId?: number; isHome?: boolean } | null;
  return raw ?? {};
}

function buildCandidate(
  base: Pick<PickCandidate, 'sport' | 'subjectId' | 'subjectName' | 'dimension' | 'dimensionLabel'>,
  history: HistoryEntry[],
  preferredCategory: string,
  categoryLabels: Record<string, string>,
  liveState: LiveState,
  subjectMeta: Record<string, unknown>,
  context?: PickCandidate['context'],
  supportingSplits?: SplitEvidence[],
  /** Threshold the pattern sits on. Every MLB dimension here is a 0.5 line. */
  line = 0.5,
  /**
   * Task 2.7a — resolves this candidate's Python-computed model row, if one
   * exists and is fresh. Takes the resolved `category` because the cache is
   * keyed by it: the same subject and dimension surface as 'over' or 'under'
   * depending on where their history sits, and the two carry complementary
   * probabilities.
   *
   * A LOOKUP rather than a value, because the caller knows the game id but
   * cannot know the category — that is decided here, three lines below.
   */
  cachedModelFor?: (category: string) => PropModelCacheRow | null,
): PickCandidate | null {
  if (history.length === 0) return null;

  const consistent = history.every((h) => h.category === history[0].category);
  const category = consistent ? history[0].category : preferredCategory;

  // Every model feeding `context.modelProb` computes P(over) — it is derived
  // from an over/hit count. But this is the line where a candidate becomes an
  // "under"/"no-hit"/"no-run", and before Phase 1.1 nothing flipped the
  // probability to match. The number stored and displayed was then the
  // probability of the proposition the user was NOT being shown: a card
  // reading "Under 4.5 K — model 58%" was really claiming the OVER was 58%.
  //
  // Confirmed in the data, not just by reading the code (audit P3 C3,
  // re-verified 2026-08-28): the 36 graded under-side rows in pick_history
  // score a Brier of 0.3756 against their own outcomes as stored, and 0.1956
  // flipped. A probability that scores far worse as-is than inverted is the
  // probability of the other outcome.
  //
  // Mirrors _prob_for_category in
  // python-odds-service/src/predict/prop_candidates.py. The Python worker owns
  // the live write path and this owns rendering; both had the same bug, so
  // both needed the same fix.
  // subjectMeta is a Record<string, unknown> bag, so this needs a runtime check
  // rather than a typed field access — the looseness of that bag is part of why
  // the bug survived review in the first place.
  const rawModelProb = subjectMeta.modelProb;
  const locallyComputedMeta =
    typeof rawModelProb === 'number' && candidateCategoryToSide(category) === 'under'
      ? { ...subjectMeta, modelProb: 1 - rawModelProb }
      : subjectMeta;

  // Task 2.7a — prefer the model Python already computed.
  //
  // THE FLIP ABOVE IS WHY THIS SUBSTITUTION HAPPENS HERE AND NOWHERE ELSE.
  // The callers hand this function P(over); the block above turns it into
  // P(this candidate's proposition). Python's `_prob_for_category` applies
  // that same flip inside `CandidateResult`, so `cached.modelProb` arrives
  // ALREADY side-correct. Substituting at a caller — before the flip — would
  // send an under-side probability through it a second time and store its
  // complement: audit finding P3 C3, reintroduced by a change meant to be
  // structural. Substituting after it, here, the two conventions meet once.
  //
  // Cache-first with a local fallback, the same shape gameModelAndEloFor
  // already uses for mlb_game_model_cache: a missing or stale row degrades
  // to computing in TypeScript, so a stopped worker costs freshness rather
  // than emptying the page.
  const cached = cachedModelFor?.(category) ?? null;
  const sidedSubjectMeta =
    cached && Date.now() - Date.parse(cached.computedAt) <= PROP_MODEL_CACHE_MAX_AGE_MS
      ? {
          ...subjectMeta,
          modelProb: cached.modelProb,
          modelStdDev: cached.modelStdDev,
          modelSampleSize: cached.modelSampleSize,
          leagueRate: cached.leagueRate,
          matchupFavorable: cached.matchupFavorable,
          ...(cached.modelVersion != null ? { modelVersion: cached.modelVersion } : {}),
        }
      : locallyComputedMeta;

  return {
    ...base,
    subjectMeta: sidedSubjectMeta,
    category,
    categoryLabel: categoryLabels[category] ?? category,
    line,
    history,
    consistent,
    sampleSize: history.length,
    supportingSplits,
    liveState,
    context,
  };
}

const HIT_LABELS: Record<string, string> = { hit: 'Records a hit', 'no-hit': 'No hit' };
const RUN_LABELS: Record<string, string> = { run: 'Allows a 1st-inning run', 'no-run': 'No 1st-inning run' };

/** Dimension: did this batter get a hit, game by game. */
function hitInGameCandidates(
  person: PersonStats,
  game: SlateGame,
  side: TeamSide,
  liveState: LiveState,
  matchupCtx: MatchupContext,
): PickCandidate | null {
  // The candidate carries the full season, not a trimmed display window —
  // L5/L10/L15 windows still read the tail of it, but season totals and the
  // full gamelog table need every game, not just the last 15.
  const full = person.gameLog
    .filter((s) => Number(s.stat?.atBats ?? 0) > 0 || Number(s.stat?.plateAppearances ?? 0) > 0)
    .map(hitEntry);
  const history = full;

  const opponentId = side.isHome ? game.away.teamId : game.home.teamId;
  const opponentAbbr = side.isHome ? game.away.abbreviation : game.home.abbreviation;
  const venueLabel = side.isHome ? 'home games' : 'away games';

  // Splits always measure hits, even on a card whose pattern is "no hit", so
  // the label has to name the outcome — a bare "0 of 5" beside a 100% headline
  // reads as a contradiction rather than as the other side of the same coin.
  const splits: SplitEvidence[] = [
    ...standardWindows(full, 'hit', [5, 10, 15]).map((s) => ({ ...s, label: `Hit, ${s.label.toLowerCase()}` })),
    subsetSplit(
      full,
      'hit',
      (e) => entryMeta(e).opponentId === opponentId,
      `Hit vs ${opponentAbbr}`,
      'head-to-head',
    ),
    subsetSplit(
      full,
      'hit',
      (e) => entryMeta(e).isHome === side.isHome,
      `Hit in ${venueLabel}`,
      'venue-split',
      3,
    ),
  ];

  // Same opponent-difficulty mechanism every other market uses now — prefers
  // the specific opposing starter's own hits-allowed rank once they've
  // thrown enough to mean something, falling back to the team-wide rank.
  const matchup = matchupSplit(opponentAbbr, 'hits', 'hits', 'against', matchupCtx);
  if (matchup) splits.push(matchup.split);
  // Drives the Scan table's DVP column, which is deliberately the team-wide
  // (not starter-specific) rank — DVP is a slate-wide sort/filter column, and
  // a mid-scroll switch between two different rank sources depending on
  // whether a given starter has 3 starts yet would make the column
  // impossible to sort consistently.
  const matchupRank = matchupCtx.allowedRanks.get(opponentId)?.hits ?? null;

  const leagueRate = matchupCtx.leagueRates?.get('hit-in-game');
  const recent10 = full.slice(-10);
  const model =
    leagueRate != null
      ? computeModelProbability({
          dimension: 'hit-in-game',
          leagueRate,
          overCount: full.filter((e) => e.category === 'hit').length,
          totalCount: full.length,
          matchupFavorable: matchup?.favorable ?? null,
          recentOverCount: recent10.filter((e) => e.category === 'hit').length,
          recentTotalCount: recent10.length,
        })
      : null;

  return buildCandidate(
    {
      sport: 'mlb',
      subjectId: String(person.id),
      subjectName: person.fullName,
      dimension: 'hit-in-game',
      dimensionLabel: 'Hit in game',
    },
    history,
    'hit',
    HIT_LABELS,
    liveState,
    {
      team: side.abbreviation,
      teamName: side.teamName,
      opponent: side.isHome ? game.away.abbreviation : game.home.abbreviation,
      opponentId,
      opponentLogoUrl: mlbTeamLogoUrl(opponentId),
      isHome: side.isHome,
      position: person.primaryPosition,
      headshotUrl: mlbHeadshotUrl(person.id),
      teamLogoUrl: mlbTeamLogoUrl(side.teamId),
      teamId: side.teamId,
      batSide: person.batSide,
      lineupProjected: side.lineupProjected,
      gamePk: game.gamePk,
      opposingStarter: side.isHome ? game.away.starterName : game.home.starterName,
      opposingStarterId: side.isHome ? game.away.starterId : game.home.starterId,
      opposingStarterStats: opposingStarterCard(matchupCtx),
      opposingStarterOverallRank: opposingStarterOverallRank(matchupCtx),
      ownStatcast: ownStatcastCard(person.id, matchupCtx),
      ownStatcastSummary: ownStatcastSummary(person.id, matchupCtx),
      ownBattingStats: ownBattingCard(person.id, matchupCtx),
      matchupRank,
      matchupStatLabel: TEAM_STAT_PHRASE.hits,
      modelProb: model?.prob ?? null,
      modelStdDev: model?.stdDev ?? null,
      modelSampleSize: model?.sampleSize ?? null,
      leagueRate: leagueRate ?? null,
      matchupFavorable: matchup?.favorable ?? null,
    },
    { weather: game.weather },
    splits,
    0.5,
    (category) =>
      matchupCtx.propModelCache?.get(propModelCacheKey(String(game.gamePk), String(person.id), 'hit-in-game', category)) ?? null,
  );
}

/**
 * Dimension: hit rate against the handedness the batter faces today.
 *
 * The opposing starter for each past game comes from the schedule's listed
 * probable, so this reflects the announced starter rather than every pitcher
 * the batter actually saw — stated plainly in the label.
 */
function vsHandCandidates(
  person: PersonStats,
  game: SlateGame,
  side: TeamSide,
  liveState: LiveState,
  startersByGame: Map<number, { homeId?: number; awayId?: number }>,
  handById: Map<number, { pitchHand?: string }>,
  matchupCtx: MatchupContext,
): PickCandidate | null {
  const hand = side.opposingHand;
  if (!hand) return null;

  const history = person.gameLog
    .filter((split) => {
      if (!split.gamePk) return false;
      if (Number(split.stat?.atBats ?? 0) === 0) return false;
      const starters = startersByGame.get(split.gamePk);
      if (!starters) return false;
      const opposingId = split.isHome ? starters.awayId : starters.homeId;
      if (!opposingId) return false;
      return handById.get(opposingId)?.pitchHand === hand;
    })
    .map(hitEntry);

  const handLabel = hand === 'L' ? 'LHP' : 'RHP';
  const splits: SplitEvidence[] = standardWindows(history, 'hit', [5, 10]).map((s) => ({
    ...s,
    kind: 'handedness' as const,
    label: `Hit vs ${handLabel}, ${s.label.toLowerCase()}`,
  }));

  return buildCandidate(
    {
      sport: 'mlb',
      subjectId: String(person.id),
      subjectName: person.fullName,
      dimension: `vs-${handLabel}`,
      dimensionLabel: `Hit vs ${handLabel} (listed starters)`,
    },
    history,
    'hit',
    HIT_LABELS,
    liveState,
    {
      team: side.abbreviation,
      opponent: side.isHome ? game.away.abbreviation : game.home.abbreviation,
      opponentId: side.isHome ? game.away.teamId : game.home.teamId,
      opponentLogoUrl: mlbTeamLogoUrl(side.isHome ? game.away.teamId : game.home.teamId),
      isHome: side.isHome,
      headshotUrl: mlbHeadshotUrl(person.id),
      teamLogoUrl: mlbTeamLogoUrl(side.teamId),
      teamId: side.teamId,
      batSide: person.batSide,
      gamePk: game.gamePk,
      opposingStarter: side.isHome ? game.away.starterName : game.home.starterName,
      opposingHand: hand,
      ownStatcast: ownStatcastCard(person.id, matchupCtx),
      ownStatcastSummary: ownStatcastSummary(person.id, matchupCtx),
      ownBattingStats: ownBattingCard(person.id, matchupCtx),
    },
    { weather: game.weather },
    splits,
  );
}

/**
 * Dimension: did this starter allow a run in the 1st inning.
 *
 * Derived by joining the pitcher's own game log to the linescore of each of
 * those games — the starter is on the mound for the 1st, so the runs scored in
 * the opposing half of inning one are theirs.
 */
function firstInningCandidates(
  person: PersonStats,
  game: SlateGame,
  side: TeamSide,
  inningOneByGame: Map<number, { home: number; away: number }>,
  liveState: LiveState,
): PickCandidate | null {
  const history: HistoryEntry[] = [];

  for (const split of person.gameLog) {
    if (Number(split.stat?.gamesStarted ?? 0) === 0) continue;
    if (!split.gamePk) continue;

    const innings = inningOneByGame.get(split.gamePk);
    if (!innings) continue;

    // A pitcher on the away team is on the mound for the bottom of the 1st.
    const runsAllowed = split.isHome ? innings.away : innings.home;
    history.push({
      period: history.length + 1,
      result: runsAllowed > 0 ? `${runsAllowed} R` : '0 R',
      category: runsAllowed > 0 ? 'run' : 'no-run',
      periodLabel: `${split.date?.slice(5) ?? ''} ${split.isHome ? 'vs' : '@'} ${split.opponentName ?? ''}`.trim(),
      raw: { runsAllowed, gamePk: split.gamePk },
    });
  }

  return buildCandidate(
    {
      sport: 'mlb',
      subjectId: String(person.id),
      subjectName: person.fullName,
      dimension: 'first-inning',
      dimensionLabel: '1st inning, runs allowed',
    },
    history,
    'no-run',
    RUN_LABELS,
    liveState,
    {
      team: side.abbreviation,
      opponent: side.isHome ? game.away.abbreviation : game.home.abbreviation,
      opponentId: side.isHome ? game.away.teamId : game.home.teamId,
      opponentLogoUrl: mlbTeamLogoUrl(side.isHome ? game.away.teamId : game.home.teamId),
      isHome: side.isHome,
      headshotUrl: mlbHeadshotUrl(person.id),
      teamLogoUrl: mlbTeamLogoUrl(side.teamId),
      teamId: side.teamId,
      pitchHand: person.pitchHand,
      gamePk: game.gamePk,
      role: 'starting pitcher',
    },
    { weather: game.weather },
    standardWindows(history.slice(-HISTORY_WINDOW), 'no-run', [3, 5, 10]).map((s) => ({
      ...s,
      label: `No run, ${s.label.toLowerCase()}`,
    })),
  );
}

// ---------------------------------------------------------------------------
// Generic counting-stat markets (total bases, home runs, RBIs, ...)
//
// hit-in-game/vs-hand/first-inning above are each hand-written because they
// need a bespoke history filter (handedness join, inning-level linescore
// join). Everything below is the same shape every time — "did this raw
// gamelog field clear a line, game by game" — so it's one generic builder
// driven by a table of stat definitions, rather than sixteen near-identical
// copies of hitInGameCandidates. Every dimension here is already seeded in
// `MLB_MARKETS` (components/MarketLabel.tsx) and already resolvable by the
// five-provider prop odds feed (lib/odds/props/entityResolution.ts) — this
// is what actually produces the candidates those two were built ahead of.
// ---------------------------------------------------------------------------

const OU_LABELS: Record<string, string> = { over: 'Over', under: 'Under' };

/** MLB's innings-pitched notation ("6.1" = 6⅓ IP) converted to outs recorded. */
function outsFromInningsPitched(raw: unknown): number {
  const [whole, frac] = String(raw ?? '0').split('.');
  return (Number(whole) || 0) * 3 + (Number(frac) || 0);
}

// ---------------------------------------------------------------------------
// Opponent-difficulty context
//
// Two sources, preferring the sharper one: the opposing *starter's* own rank
// among every other MLB starter (getLeagueStartingPitcherStats/rankPitchers),
// falling back to the opposing *team's* whole-staff rank (rankTeams) when the
// starter hasn't logged enough starts to rank meaningfully yet — a rookie
// call-up's first outing shouldn't be read through a wobbly two-start ERA.
// Pitcher props read the mirror image: the opposing *lineup's* rank, not the
// opposing pitcher's.
// ---------------------------------------------------------------------------

const MIN_STARTS_FOR_PITCHER_RANK = 3;

interface MatchupContext {
  hittingRanks: TeamRanks;
  allowedRanks: TeamRanks;
  pitcherRanks: PitcherRanks;
  startsByPitcherId: Map<number, number>;
  opponentTeamId: number;
  /** The specific opposing starter, when known — undefined falls straight through to the team-level rank. */
  opposingStarterId?: number;
  /** Raw season lines behind `pitcherRanks` — lets a UI show "3.42 ERA (12th)" rather than just the rank. */
  pitcherStatsById?: Map<number, PitcherStatLine>;
  /** Phase C.1's Beta prior center, per market dimension — real league-wide P(actual > line) from every graded outcome this app has seen. */
  leagueRates?: Map<string, number>;
  /**
   * Task 2.7a — Python's already-computed prop model output for this slate,
   * loaded once per snapshot (like `leagueRates`), never per candidate. Keyed
   * by `propModelCacheKey`. Empty map when the worker has written nothing yet,
   * which every candidate handles by computing locally instead.
   */
  propModelCache?: Map<string, PropModelCacheRow>;
  /** Overall composite rank among all 250+ starters — see pitcherRankings.ts. Undefined for a season nobody's loaded /diagnostics's Pitcher Rankings card for yet. */
  starterOverallRankById?: Map<number, { rank: number | null; poolSize: number }>;
  /** This batter's own Statcast production (not what they faced) — overall AND position-scoped ranks, plus composites — cache-only, same hot-path-safety reasoning as `starterOverallRankById` above. Undefined for a season nobody's computed batter rankings for yet. */
  batterRankingsById?: Map<number, RankedBatter>;
  /** Home Run model plan, Phase 6 — the currently ACTIVE `home-run` model_weights row, or null when none has ever beaten the Beta-Binomial baseline on holdout yet (see homeRunModelFit.ts). Read once per snapshot, same pattern as leagueRates, not once per candidate. */
  homeRunModel?: ModelWeightsRow | null;
  /** venueId -> factor, same cache game-level moneyline/totals already use (loadParkFactorCache) — read once per snapshot and reused here for the home-run model's park feature. */
  parkFactorCache?: Map<number, number>;
  /** Live team HR-rate-allowed cache (homeRunLiveMatchup.ts) — closes the pitcherMatchupSignal live gap; read once per snapshot, not once per candidate. */
  hrTeamMatchupCache?: TeamHrRateAllowedCache;
}

/** Which team-stat rank a batter market reads matchup context from — always the opposing pitching staff's *against*-rank (what it allows). */
const BATTER_MARKET_TEAM_STAT: Record<string, TeamStatKey> = {
  'hit-in-game': 'hits',
  'total-bases': 'totalBases',
  'home-runs': 'homeRuns',
  rbis: 'rbi',
  runs: 'runs',
  walks: 'baseOnBalls',
  'batter-strikeouts': 'strikeOuts',
  doubles: 'doubles',
  triples: 'triples',
  singles: 'singles',
  'stolen-bases': 'stolenBases',
  'hits-runs-rbis': 'hits',
};

/** The individual-starter equivalent, when a specific opposing starter is known and ranked. */
const BATTER_MARKET_PITCHER_STAT: Partial<Record<string, PitcherRankKey>> = {
  'hit-in-game': 'hits',
  'total-bases': 'hits',
  // Barrel% (well-struck, HR-profile contact) is a sharper proxy for
  // home-run risk than the raw home-runs-allowed count, which is noisy over
  // a partial season — falls back to the team-wide rank via the same
  // undefined-key mechanism as rbis/runs/etc. below when a starter hasn't
  // logged enough Statcast-sampled swings yet (see MIN_BATTED_BALLS_FOR_QUALITY_RATE, savant.ts).
  'home-runs': 'barrelPct',
  walks: 'baseOnBalls',
  'batter-strikeouts': 'strikeOuts',
  singles: 'hits',
  'hits-runs-rbis': 'hits',
  // rbis/runs/doubles/triples/stolen-bases have no clean single-pitcher stat
  // to point at (RBIs and runs depend on who's on base ahead of the batter,
  // not the pitcher alone) — team rank is the honest signal for those.
};

/** Pitcher markets read the mirror image: the opposing *lineup's* for-rank. */
const PITCHER_MARKET_TEAM_STAT: Record<string, TeamStatKey> = {
  'first-inning': 'runs',
  'pitcher-strikeouts': 'strikeOuts',
  'earned-runs': 'runs',
  'pitcher-hits-allowed': 'hits',
  'pitcher-walks-allowed': 'baseOnBalls',
  // pitcher-outs has no team-level proxy — durability tracks the pitcher's
  // own workload trend, not the opponent's, so it's deliberately absent here
  // and gets no matchup bullet.
};

/**
 * Prose names for a matchup sentence — deliberately not `TEAM_STAT_KEYS`'
 * `label` field, which is a table-header abbreviation ("3B", "BB") meant to
 * sit under a column, not read in a sentence. "COL pitching ranks poorly in
 * 3B" reads as third base, not triples; this is what fixed it.
 */
const TEAM_STAT_PHRASE: Record<TeamStatKey, string> = {
  runs: 'runs',
  hits: 'hits',
  singles: 'singles',
  doubles: 'doubles',
  triples: 'triples',
  totalBases: 'total bases',
  earnedRuns: 'earned runs',
  homeRuns: 'home runs',
  rbi: 'RBIs',
  baseOnBalls: 'walks',
  strikeOuts: 'strikeouts',
  stolenBases: 'stolen bases',
  avg: 'batting average',
  obp: 'on-base percentage',
  slg: 'slugging',
  ops: 'OPS',
};

/**
 * The team-level (never starter-specific) rank + prose label for a market's
 * matchup stat — deliberately the same source `hitInGameCandidates` always
 * used for its DVP field. Scan's DVP column sorts across the whole slate, so
 * it needs one consistent rank source per market rather than switching
 * between team- and starter-scale numbers mid-column.
 */
function teamLevelMatchupRank(
  teamStatKey: TeamStatKey | undefined,
  side: 'against' | 'for',
  ctx: MatchupContext,
): { rank: number; label: string } | null {
  if (!teamStatKey) return null;
  const ranks = side === 'against' ? ctx.allowedRanks : ctx.hittingRanks;
  const rank = ranks.get(ctx.opponentTeamId)?.[teamStatKey];
  if (rank == null) return null;
  return { rank, label: TEAM_STAT_PHRASE[teamStatKey] };
}

export interface OpposingStarterStat {
  // Widened from PitcherRankKey: this same shape now also carries
  // BatterStatcastKey (ownStatcastCard) and BatterTraditionalKey
  // (ownBattingCard) values, which aren't all members of PitcherRankKey —
  // `key` is only ever used client-side as a lookup/React key, so a plain
  // string is the honest contract.
  key: string;
  label: string;
  value: number;
  decimals: number;
  rank: number;
  poolSize: number;
}

/**
 * The opposing starter's full rank line — ERA/WHIP/K/BB/H/HR, each with the
 * real value and where it sits among every other MLB starter — for the
 * Matchup card. Distinct from `matchupSplit`'s single-stat bullet: that picks
 * the one stat relevant to whichever market is active, this is the starter's
 * whole season line regardless of market. Requires the same start-count floor
 * as the rank system generally, so a two-start call-up doesn't get a rank
 * built on noise.
 */
/** Shared by `opposingStarterCard` (a player prop's matchup card) and the Probable Pitchers card's own-starter line — same ERA/WHIP/K/BB/H/HR-with-rank shape either way, just a different starterId. */
function starterStatCard(
  starterId: number | undefined,
  pitcherStatsById: Map<number, PitcherStatLine>,
  pitcherRanks: PitcherRanks,
  startsByPitcherId: Map<number, number>,
): OpposingStarterStat[] | undefined {
  if (starterId == null) return undefined;
  const starts = startsByPitcherId.get(starterId) ?? 0;
  if (starts < MIN_STARTS_FOR_PITCHER_RANK) return undefined;

  const line = pitcherStatsById.get(starterId);
  const ranks = pitcherRanks.get(starterId);
  if (!line || !ranks) return undefined;

  const poolSize = pitcherRanks.size;
  return PITCHER_RANK_KEYS.map(({ key, decimals }): OpposingStarterStat | null => {
    const value = line.values[key];
    const rank = ranks[key];
    if (value == null || rank == null) return null;
    return { key, label: pitcherStatPhrase(key), value, decimals, rank, poolSize };
  }).filter((s): s is OpposingStarterStat => s != null);
}

function opposingStarterCard(ctx: MatchupContext): OpposingStarterStat[] | undefined {
  if (!ctx.pitcherStatsById) return undefined;
  return starterStatCard(ctx.opposingStarterId, ctx.pitcherStatsById, ctx.pitcherRanks, ctx.startsByPitcherId);
}

/** A starter's overall composite rank (e.g. "#12 of 251") — same number shown on /diagnostics and the Bullpen card, not a separate calculation. Undefined until the Statcast-backed rankings have been computed at least once this season. */
function starterOverallRank(
  starterId: number | undefined,
  byId: Map<number, { rank: number | null; poolSize: number }> | undefined,
): { rank: number | null; poolSize: number } | undefined {
  if (starterId == null) return undefined;
  return byId?.get(starterId);
}

function opposingStarterOverallRank(ctx: MatchupContext): { rank: number | null; poolSize: number } | undefined {
  return starterOverallRank(ctx.opposingStarterId, ctx.starterOverallRankById);
}

/**
 * The SUBJECT pitcher's own percentile stats — same `starterStatCard`/
 * `starterOverallRank` calls `opposingStarterCard`/`opposingStarterOverallRank`
 * make, just keyed on `personId` (self) instead of `ctx.opposingStarterId`
 * (the opponent). Powers a pitcher-subject Player Detail page's own side of
 * the contact-quality matchup card, the pitcher-role mirror of
 * `ownStatcastCard`/`ownStatcastSummary` on the batter side.
 */
function ownPitcherCard(personId: number, ctx: MatchupContext): OpposingStarterStat[] | undefined {
  if (!ctx.pitcherStatsById) return undefined;
  return starterStatCard(personId, ctx.pitcherStatsById, ctx.pitcherRanks, ctx.startsByPitcherId);
}

function ownPitcherOverallRank(personId: number, ctx: MatchupContext): { rank: number | null; poolSize: number } | undefined {
  return starterOverallRank(personId, ctx.starterOverallRankById);
}

/**
 * A batter's own Statcast quality-of-contact line, same tile shape as
 * `opposingStarterCard` (`OpposingStarterStat[]`) so PlayerDetail can render
 * both with the one bit of tile JSX. Per-stat ranks here are against the
 * whole qualified-batter pool — see `ownStatcastSummary` for the position-
 * scoped composite. No start-count-style floor here — the per-player sample
 * gates already live in savant.ts (`MIN_SWINGS_FOR_WHIFF_RATE`,
 * `MIN_BATTED_BALLS_FOR_QUALITY_RATE`), so a value only ever shows up here
 * once it's already real.
 */
function ownStatcastCard(personId: number, ctx: MatchupContext): OpposingStarterStat[] | undefined {
  const ranked = ctx.batterRankingsById?.get(personId);
  if (!ranked) return undefined;

  const tiles = BATTER_STATCAST_RANK_KEYS.map(({ key, decimals }): OpposingStarterStat | null => {
    const value = ranked.values[key];
    const rank = ranked.overallRanks[key];
    if (value == null || rank == null) return null;
    return { key, label: batterStatPhrase(key), value, decimals, rank, poolSize: ranked.poolSize };
  }).filter((s): s is OpposingStarterStat => s != null);

  return tiles.length > 0 ? tiles : undefined;
}

/**
 * A batter's own traditional season line (AVG/OBP/SLG/OPS/HR/RBI), ranked
 * against every batter with a season row — the counterpart to
 * `ownStatcastCard` for the "Season stats" section of the matchup card and
 * the Hitter Stats rail card, not gated by the Statcast batted-ball
 * thresholds `ownStatcastCard` is.
 */
function ownBattingCard(personId: number, ctx: MatchupContext): OpposingStarterStat[] | undefined {
  const ranked = ctx.batterRankingsById?.get(personId);
  if (!ranked) return undefined;

  // Optional chaining on `traditionalValues`/`traditionalRanks` themselves
  // (not just the per-key lookup) — `ranked` can come back from a 24h-cached
  // JSON blob written before these fields existed, so the object shape isn't
  // guaranteed to match the current `RankedBatter` type until the cache
  // naturally rolls over.
  const tiles = BATTER_TRADITIONAL_RANK_KEYS.map(({ key, label, decimals }): OpposingStarterStat | null => {
    const value = ranked.traditionalValues?.[key];
    const rank = ranked.traditionalRanks?.[key];
    if (value == null || rank == null) return null;
    return { key, label, value, decimals, rank, poolSize: ranked.traditionalPoolSize };
  }).filter((s): s is OpposingStarterStat => s != null);

  return tiles.length > 0 ? tiles : undefined;
}

export interface OwnStatcastSummary {
  overallRank: number | null;
  poolSize: number;
  position: string;
  positionRank: number | null;
  positionPoolSize: number;
}

/** The composite-score headline for `ownStatcastCard` — "#N of M overall" and "#N of M at <position>" — mirroring how `starterOverallRank` gives the Matchup card's per-stat tiles a single top-line number. */
function ownStatcastSummary(personId: number, ctx: MatchupContext): OwnStatcastSummary | undefined {
  const ranked = ctx.batterRankingsById?.get(personId);
  if (!ranked) return undefined;
  return {
    overallRank: ranked.overallRank,
    poolSize: ranked.poolSize,
    position: ranked.position,
    positionRank: ranked.positionRank,
    positionPoolSize: ranked.positionPoolSize,
  };
}

function batterStatPhrase(key: BatterStatcastKey): string {
  switch (key) {
    case 'barrelPct':
      return 'barrel%';
    case 'exitVelo':
      return 'avg exit velocity';
    case 'hardHitPct':
      return 'hard-hit%';
    case 'whiffPct':
      return 'whiff%';
    default:
      return key;
  }
}

function pitcherStatPhrase(key: PitcherRankKey): string {
  switch (key) {
    case 'homeRuns':
      return 'home runs allowed';
    case 'hits':
      return 'hits allowed';
    case 'baseOnBalls':
      return 'walks allowed';
    case 'strikeOuts':
      return 'strikeouts';
    case 'fip':
      return 'FIP';
    case 'kbbPct':
      return 'K-BB%';
    case 'whiffPct':
      return 'whiff%';
    case 'barrelPct':
      return 'barrel% allowed';
    case 'exitVelo':
      return 'avg exit velocity allowed';
    case 'hardHitPct':
      return 'hard-hit% allowed';
    default:
      return key;
  }
}

/**
 * Only worth a bullet in the extreme third of the pool — a middling rank
 * says nothing either way. Percentile-based, not an absolute cutoff: a
 * 30-team pool and a ~180-starter pool need different absolute numbers to
 * mean "bottom third," and hardcoding the 30-team numbers here once
 * flagged nearly every *pitcher* as "poor" — rank 21 of 30 is the bottom
 * third, but rank 21 of 180 is the top eighth.
 */
function rankWorthShowing(rank: number, poolSize: number): boolean {
  return rank > (poolSize * 2) / 3 || rank <= poolSize / 3;
}

/**
 * `favorable` is deliberately a separate input, not derived from the rank's
 * own top/bottom-third split — "ranks poorly/well" describes an objective
 * fact about the rank (bottom third of *its own* pool = poorly, full stop),
 * while whether that's *favorable for an Over bet* depends on which stat
 * and which side of the matchup it is. They usually agree (a defense that
 * ranks poorly at preventing home runs is a favorable matchup for a
 * home-run bet) but not always — a pitching staff that "ranks well" in
 * strikeouts (rank 1 = most Ks recorded, per `PITCHING_RANK_INVERTED_KEYS`)
 * is the *favorable* matchup for a batter's own strikeout-over prop, not
 * the unfavorable one. Computing them from the same shortcut is exactly how
 * that case would have silently gotten the sign wrong.
 */
function rankSplit(
  kind: 'opponent-rank',
  label: string,
  rank: number,
  poolSize: number,
  favorable: boolean,
): { split: SplitEvidence; rank: number; favorable: boolean } {
  const ranksWell = rank <= poolSize / 3;
  return {
    rank,
    favorable,
    split: {
      kind,
      label: `${label} ${ranksWell ? 'well' : 'poorly'}`,
      figure: ordinalRank(rank) ?? undefined,
      stat: { status: 'ok', hits: 0, total: poolSize, rate: poolSize > 1 ? (rank - 1) / (poolSize - 1) : 0, average: rank },
    },
  };
}

/**
 * A matchup bullet plus the raw rank, since Phase A's relevance floor needs
 * the number and the InsightRow bullet needs the sentence — one computation,
 * two consumers, so they can never disagree about which rank was used.
 *
 * Prefers the specific opposing starter's own rank once they've thrown
 * enough to mean something (`MIN_STARTS_FOR_PITCHER_RANK`); otherwise falls
 * back to the opposing team's whole-staff rank. Batter markets read the
 * opponent's *against* rank (what their pitching allows); pitcher markets
 * read the opponent's *for* rank (what their lineup does).
 */
function matchupSplit(
  opponentAbbr: string,
  teamStatKey: TeamStatKey | undefined,
  pitcherStatKey: PitcherRankKey | undefined,
  side: 'against' | 'for',
  ctx: MatchupContext,
): { split: SplitEvidence; rank: number; favorable: boolean } | null {
  if (pitcherStatKey && ctx.opposingStarterId != null) {
    const starts = ctx.startsByPitcherId.get(ctx.opposingStarterId) ?? 0;
    if (starts >= MIN_STARTS_FOR_PITCHER_RANK) {
      const poolSize = ctx.pitcherRanks.size;
      const rank = ctx.pitcherRanks.get(ctx.opposingStarterId)?.[pitcherStatKey];
      if (rank != null && poolSize > 0 && rankWorthShowing(rank, poolSize)) {
        // Always a batter market (only BATTER_MARKET_PITCHER_STAT sets this).
        // For stats where rank 1 = fewest allowed (era/hits/BB/HR/whip), a
        // *weak* pitcher (high rank number) is the favorable matchup. For
        // strikeouts — the one stat here where rank 1 = most recorded,
        // i.e. the pitcher causes the outcome rather than allowing it — a
        // *dominant* pitcher (low rank number) is what's favorable instead,
        // because that's what drives the batter's own strikeout total up.
        const badPitcherIsFavorable = PITCHER_RANK_LOWER_IS_BETTER.has(pitcherStatKey);
        const favorable = badPitcherIsFavorable ? rank > (poolSize * 2) / 3 : rank <= poolSize / 3;
        return rankSplit('opponent-rank', `Starter ranks in ${pitcherStatPhrase(pitcherStatKey)}`, rank, poolSize, favorable);
      }
    }
  }

  if (!teamStatKey) return null;
  const ranks = side === 'against' ? ctx.allowedRanks : ctx.hittingRanks;
  const rank = ranks.get(ctx.opponentTeamId)?.[teamStatKey];
  // Fixed at 30 — MLB has exactly 30 teams, unlike the pitcher pool above
  // (which varies with how many starters have made at least one start).
  const TEAM_POOL_SIZE = 30;
  if (rank == null || !rankWorthShowing(rank, TEAM_POOL_SIZE)) return null;
  const noun = side === 'against' ? 'pitching' : 'lineup';

  let favorable: boolean;
  if (side === 'for') {
    // Pitcher markets reading the opposing lineup's own output (hittingRanks,
    // rank 1 = most of that stat, no inversions applied there): more of the
    // stat is always favorable for the pitcher's matching over-prop, so
    // favorable is uniformly "ranks well" here.
    favorable = rank <= TEAM_POOL_SIZE / 3;
  } else {
    // Batter markets reading the opposing pitching staff's against-rank.
    // Same inversion as the starter-specific branch above, at team scale:
    // strikeouts is the one against-stat rankTeams already flips
    // (PITCHING_RANK_INVERTED_KEYS) so rank 1 means most Ks recorded, not
    // fewest allowed — a staff that "ranks well" there is the favorable
    // matchup for a batter's strikeout-over prop, the opposite of every
    // other against-stat, where ranking well means stingy and unfavorable.
    favorable = PITCHING_RANK_INVERTED_KEYS.has(teamStatKey) ? rank <= TEAM_POOL_SIZE / 3 : rank > (TEAM_POOL_SIZE * 2) / 3;
  }

  return rankSplit('opponent-rank', `${opponentAbbr} ${noun} ranks in ${TEAM_STAT_PHRASE[teamStatKey]}`, rank, TEAM_POOL_SIZE, favorable);
}

export interface StatMarketDef {
  dimension: string;
  dimensionLabel: string;
  /** Reads the raw per-game value this market counts. */
  valueOf: (stat: Record<string, any>) => number;
  /** Default over/under threshold for candidate pattern-matching — independent of whatever line a sportsbook actually posts. */
  line: number;
  /**
   * Set only for rare-positive events (home runs, triples, stolen bases) —
   * markets where "the event didn't happen" is true for almost every player
   * almost every game, so an Under streak is a base-rate artifact, not a
   * pattern. When set, the builder never generates an Under-headlined
   * candidate at all, and only generates an Over one once the Over rate
   * clears a floor (§ Phase A) that shifts a few points based on matchup
   * quality. Markets without this keep both sides live, since the split is
   * genuinely closer to even for most players.
   */
  interestSide?: 'over';
}

const BATTER_STAT_MARKETS: StatMarketDef[] = [
  { dimension: 'total-bases', dimensionLabel: 'Total Bases', valueOf: (s) => Number(s.totalBases ?? 0), line: 1.5 },
  { dimension: 'home-runs', dimensionLabel: 'Home Runs', valueOf: (s) => Number(s.homeRuns ?? 0), line: 0.5, interestSide: 'over' },
  { dimension: 'rbis', dimensionLabel: 'RBIs', valueOf: (s) => Number(s.rbi ?? 0), line: 0.5 },
  { dimension: 'runs', dimensionLabel: 'Runs', valueOf: (s) => Number(s.runs ?? 0), line: 0.5 },
  { dimension: 'walks', dimensionLabel: 'Walks', valueOf: (s) => Number(s.baseOnBalls ?? 0), line: 0.5 },
  { dimension: 'batter-strikeouts', dimensionLabel: 'Batter Strikeouts', valueOf: (s) => Number(s.strikeOuts ?? 0), line: 0.5 },
  // Real sportsbooks only ever post the Over on doubles — there's no Under
  // side to bet, same as home runs/triples/stolen bases, so it gets the
  // same interestSide treatment (confirmed against real books, not assumed).
  { dimension: 'doubles', dimensionLabel: 'Doubles', valueOf: (s) => Number(s.doubles ?? 0), line: 0.5, interestSide: 'over' },
  { dimension: 'triples', dimensionLabel: 'Triples', valueOf: (s) => Number(s.triples ?? 0), line: 0.5, interestSide: 'over' },
  {
    dimension: 'singles',
    dimensionLabel: 'Singles',
    // Not reported directly — hits minus every extra-base hit.
    valueOf: (s) => Number(s.hits ?? 0) - Number(s.doubles ?? 0) - Number(s.triples ?? 0) - Number(s.homeRuns ?? 0),
    line: 0.5,
  },
  { dimension: 'stolen-bases', dimensionLabel: 'Stolen Bases', valueOf: (s) => Number(s.stolenBases ?? 0), line: 0.5, interestSide: 'over' },
  {
    dimension: 'hits-runs-rbis',
    dimensionLabel: 'H+R+RBI',
    valueOf: (s) => Number(s.hits ?? 0) + Number(s.runs ?? 0) + Number(s.rbi ?? 0),
    line: 1.5,
  },
];

const PITCHER_STAT_MARKETS: StatMarketDef[] = [
  { dimension: 'pitcher-strikeouts', dimensionLabel: 'Pitcher Strikeouts', valueOf: (s) => Number(s.strikeOuts ?? 0), line: 4.5 },
  { dimension: 'earned-runs', dimensionLabel: 'Earned Runs', valueOf: (s) => Number(s.earnedRuns ?? 0), line: 2.5 },
  { dimension: 'pitcher-outs', dimensionLabel: 'Pitcher Outs', valueOf: (s) => outsFromInningsPitched(s.inningsPitched), line: 15.5 },
  // Pitching-group gamelogs report `hits`/`baseOnBalls` as allowed, not earned by the pitcher at bat — same field names as the batting group, different meaning, because they come from a differently-scoped fetch (`getPeopleWithGameLogs(ids, 'pitching', season)`).
  { dimension: 'pitcher-hits-allowed', dimensionLabel: 'Hits Allowed', valueOf: (s) => Number(s.hits ?? 0), line: 5.5 },
  { dimension: 'pitcher-walks-allowed', dimensionLabel: 'Walks Allowed', valueOf: (s) => Number(s.baseOnBalls ?? 0), line: 1.5 },
];

/**
 * Every table-driven market, keyed by dimension — reused by Phase C's
 * grading job (lib/odds/props/grading.ts) so "what actually happened"
 * reads the exact same stat field as "what the candidate counted." Boxscore
 * stat objects use the same field names as gamelog `split.stat`, so the same
 * `valueOf` works against either. `hit-in-game` isn't here — it's hand-built
 * (hits > 0), graded separately.
 */
export const STAT_MARKET_BY_DIMENSION: Record<string, StatMarketDef> = Object.fromEntries(
  [...BATTER_STAT_MARKETS, ...PITCHER_STAT_MARKETS].map((def) => [def.dimension, def]),
);
export const PITCHER_MARKET_DIMENSIONS = new Set(PITCHER_STAT_MARKETS.map((d) => d.dimension));

// ---------------------------------------------------------------------------
// Team markets
//
// Confirmed live on all four real providers before building this
// (docs/odds-provider-verification.md's team-markets addendum) — SharpAPI's
// `team_total`, Odds-API.io's "Team Total Home/Away", SportsGameOdds'
// `points-{home,away}-game-ou`, OddsPapi's "Over Under Team 1/2" all price
// exactly this. Seeded from `extractTeamResults`, which already exists (built
// for Game Detail's Last 5 Games) and reads off `rangeGames` — already
// fetched for every game on the slate, so this costs no new network call.
// ---------------------------------------------------------------------------

interface TeamStatMarketDef {
  dimension: string;
  dimensionLabel: string;
  valueOf: (r: RecentGameResult) => number;
  line: number;
}

const TEAM_STAT_MARKETS: TeamStatMarketDef[] = [
  { dimension: 'team-total-runs', dimensionLabel: 'Team Total Runs', valueOf: (r) => r.runsFor, line: 4.5 },
];

function teamStatEntry(r: RecentGameResult, index: number, def: TeamStatMarketDef): HistoryEntry {
  const value = def.valueOf(r);
  const over = value > def.line;
  return {
    period: index + 1,
    result: String(value),
    category: over ? 'over' : 'under',
    periodLabel: `${r.date.slice(5, 10)} ${r.isHome ? 'vs' : '@'} ${r.opponentAbbr}`,
    raw: { opponentId: r.opponentId, isHome: r.isHome },
  };
}

/**
 * Team candidates are stamped with a `team-` prefixed `subjectId`
 * (`team-116`, never a bare number) specifically so they can never collide
 * with a real MLB person id, and so every consumer downstream (the props
 * odds registry, the player picker, the Scan table's player-scoped filters)
 * can tell a team candidate apart from a player one without a second field.
 */
function teamCandidateSubjectId(teamId: number): string {
  return `team-${teamId}`;
}

function teamStatMarketCandidates(
  teamId: number,
  teamName: string,
  teamAbbr: string,
  opponentAbbr: string,
  opponentId: number,
  isHome: boolean,
  game: SlateGame,
  def: TeamStatMarketDef,
  results: RecentGameResult[],
): PickCandidate | null {
  const full = results.map((r, i) => teamStatEntry(r, i, def));
  if (full.length === 0) return null;
  const history = full.slice(-HISTORY_WINDOW);
  const label = def.dimensionLabel;

  const splits: SplitEvidence[] = [
    ...standardWindows(full, 'over', [5, 10, 15]).map((s) => ({ ...s, label: `${label}, ${s.label.toLowerCase()}` })),
    subsetSplit(full, 'over', (e) => (e.raw as { opponentId?: number })?.opponentId === opponentId, `${label} vs ${opponentAbbr}`, 'head-to-head'),
  ];

  return buildCandidate(
    {
      sport: 'mlb',
      subjectId: teamCandidateSubjectId(teamId),
      subjectName: teamName,
      dimension: def.dimension,
      dimensionLabel: def.dimensionLabel,
    },
    history,
    'over',
    OU_LABELS,
    { status: game.status, distanceToSubject: null, distanceUnit: 'games', etaMinutes: null, etaConfidence: null },
    {
      team: teamAbbr,
      opponent: opponentAbbr,
      opponentId,
      opponentLogoUrl: mlbTeamLogoUrl(opponentId),
      teamLogoUrl: mlbTeamLogoUrl(teamId),
      teamId,
      gamePk: game.gamePk,
      isTeamCandidate: true,
      isHome,
    },
    { weather: game.weather },
    splits,
    def.line,
  );
}

/** One entry per game for a generic over/under counting-stat market. */
function statEntry(split: GameLogSplit, index: number, def: StatMarketDef): HistoryEntry {
  const value = def.valueOf(split.stat ?? {});
  const over = value > def.line;
  return {
    period: index + 1,
    result: String(value),
    category: over ? 'over' : 'under',
    periodLabel: `${split.date?.slice(5) ?? ''} ${split.isHome ? 'vs' : '@'} ${split.opponentName ?? ''}`.trim(),
    raw: { ...split.stat, opponentId: split.opponentId, isHome: split.isHome },
  };
}

/**
 * Phase A's relevance floor for rare-positive markets (home runs, triples,
 * stolen bases): below this Over rate, the pattern is closer to base-rate
 * noise than a real signal, and the candidate isn't generated at all. Shifts
 * a few points either way based on the matchup — a soft opposing staff
 * justifies surfacing a slightly cooler streak; a shutdown one raises the bar.
 */
const RARE_EVENT_FLOOR = { base: 0.25, favorableMatchup: 0.2, toughMatchup: 0.35 };

function overRateOf(history: HistoryEntry[]): number {
  if (history.length === 0) return 0;
  return history.filter((h) => h.category === 'over').length / history.length;
}

/** Every generic counting-stat market shares this shape: filter eligible games, bucket by the line, build splits. */
function statMarketCandidates(
  person: PersonStats,
  game: SlateGame,
  side: TeamSide,
  liveState: LiveState,
  def: StatMarketDef,
  eligible: (split: GameLogSplit) => boolean,
  metaExtra: Record<string, unknown>,
  role: 'batter' | 'pitcher',
  matchupCtx: MatchupContext,
): PickCandidate | null {
  const full = person.gameLog.filter(eligible).map((s, i) => statEntry(s, i, def));
  if (full.length === 0) return null;
  // Phase A's floor gate deliberately reads recent form, not season-long
  // average — a full-season rate would mask a real recent change in usage.
  const recent = full.slice(-HISTORY_WINDOW);

  const opponentId = side.isHome ? game.away.teamId : game.home.teamId;
  const opponentAbbr = side.isHome ? game.away.abbreviation : game.home.abbreviation;
  const venueLabel = side.isHome ? 'home games' : 'away games';
  const label = def.dimensionLabel;

  const matchupSide: 'against' | 'for' = role === 'batter' ? 'against' : 'for';
  const teamStatKey = role === 'batter' ? BATTER_MARKET_TEAM_STAT[def.dimension] : PITCHER_MARKET_TEAM_STAT[def.dimension];
  const matchup =
    role === 'batter'
      ? matchupSplit(opponentAbbr, teamStatKey, BATTER_MARKET_PITCHER_STAT[def.dimension], matchupSide, matchupCtx)
      : matchupSplit(opponentAbbr, teamStatKey, undefined, matchupSide, matchupCtx);
  // Same team-wide rank source as hitInGameCandidates — Scan's DVP column
  // needs one consistent rank per market, not one that could jump to a
  // starter-specific scale mid-column depending on start count.
  const teamRank = teamLevelMatchupRank(teamStatKey, matchupSide, matchupCtx);

  // Phase A: rare-positive markets need the Over rate to clear a real bar,
  // shifted by the matchup — otherwise every player in the league "passes"
  // simply because the event is uncommon for everyone, which is exactly the
  // noise this gate exists to cut.
  if (def.interestSide === 'over') {
    const floor = !matchup
      ? RARE_EVENT_FLOOR.base
      : matchup.favorable
        ? RARE_EVENT_FLOOR.favorableMatchup
        : RARE_EVENT_FLOOR.toughMatchup;
    if (overRateOf(recent) < floor) return null;
  }

  const splits: SplitEvidence[] = [
    ...standardWindows(full, 'over', [5, 10, 15]).map((s) => ({ ...s, label: `${label}, ${s.label.toLowerCase()}` })),
    subsetSplit(full, 'over', (e) => entryMeta(e).opponentId === opponentId, `${label} vs ${opponentAbbr}`, 'head-to-head'),
    subsetSplit(full, 'over', (e) => entryMeta(e).isHome === side.isHome, `${label} in ${venueLabel}`, 'venue-split', 3),
  ];
  if (matchup) splits.push(matchup.split);

  // Phase C.1 — Beta-Binomial model probability, built from the real league
  // rate for this market plus this candidate's own full-season history.
  // Null (not a guess) when pick_history has no graded rows for this market
  // yet, e.g. right after a fresh install before any grading has run.
  const leagueRate = matchupCtx.leagueRates?.get(def.dimension);
  const recent10 = full.slice(-10);
  const model =
    leagueRate != null
      ? computeModelProbability({
          dimension: def.dimension,
          leagueRate,
          overCount: full.filter((e) => e.category === 'over').length,
          totalCount: full.length,
          matchupFavorable: matchup?.favorable ?? null,
          recentOverCount: recent10.filter((e) => e.category === 'over').length,
          recentTotalCount: recent10.length,
        })
      : null;

  // Home Run model plan, Phase 6 — only overrides modelProb when (a) this IS
  // the home-runs dimension, (b) a version has actually beaten the live
  // Beta-Binomial baseline on holdout (matchupCtx.homeRunModel non-null), and
  // (c) the plain Beta-Binomial `model` above resolved at all. Falls through
  // to the unmodified `model.prob` otherwise — same "only override when
  // fitted is present" shape as app/api/odds/lines/route.ts's moneyline/total
  // `if (fitted)`.
  let finalModelProb = model?.prob ?? null;
  let homeRunModelVersion: number | null = null;
  if (def.dimension === 'home-runs' && model != null && matchupCtx.homeRunModel) {
    const fitted = matchupCtx.homeRunModel;
    const parkFactor = game.venueId != null ? (matchupCtx.parkFactorCache?.get(game.venueId) ?? 1) : 1;
    const slot = side.lineup.indexOf(person.id) + 1; // 0 if not found -> expectedPaCentered's neutral fallback below

    // Live team HR-rate-allowed — same season-aggregate definition the fit
    // was trained on (see homeRunLiveMatchup.ts), read from a cache refreshed
    // periodically via POST /api/mlb/refresh-hr-matchup rather than
    // recomputed per candidate. Falls back to the league rate on its own
    // (via matchupSignal === 0 when never refreshed this season, or a team
    // below the trust floor) — never a bare, unexplained 0.
    const teamHrRate = matchupCtx.hrTeamMatchupCache?.rateFor(opponentId) ?? matchupCtx.hrTeamMatchupCache?.leagueHrRate ?? 0.11;
    const leagueHrRateForMatchup = matchupCtx.hrTeamMatchupCache?.leagueHrRate ?? 0.11;

    const blended = applyFittedHomeRunWeights(
      {
        betaBinomialHrProb: model.prob,
        parkHrFactorCentered: parkHrFactorCentered(parkFactor),
        pitcherMatchupSignal: pitcherMatchupSignal(teamHrRate, leagueHrRateForMatchup),
        expectedPaCentered: slot > 0 ? expectedPaCentered(slot) : 0,
      },
      fitted.weights,
      fitted.intercept,
    );

    // Same ×0.9-style discount as FullCountProps' documented example — a
    // projected (not yet official) lineup slot doesn't guarantee this batter
    // actually starts. Flat constant for now (no per-player start-probability
    // model exists yet); 1.0 (no discount) once the lineup is official.
    const PROJECTED_LINEUP_START_PROBABILITY = 0.9;
    finalModelProb = side.lineupProjected ? applyLineupConfidence(blended, PROJECTED_LINEUP_START_PROBABILITY) : blended;
    homeRunModelVersion = fitted.version;
  }

  return buildCandidate(
    {
      sport: 'mlb',
      subjectId: String(person.id),
      subjectName: person.fullName,
      dimension: def.dimension,
      dimensionLabel: def.dimensionLabel,
    },
    full,
    'over',
    OU_LABELS,
    liveState,
    {
      team: side.abbreviation,
      opponent: opponentAbbr,
      opponentId,
      opponentLogoUrl: mlbTeamLogoUrl(opponentId),
      isHome: side.isHome,
      headshotUrl: mlbHeadshotUrl(person.id),
      teamLogoUrl: mlbTeamLogoUrl(side.teamId),
      teamId: side.teamId,
      gamePk: game.gamePk,
      opposingStarter: side.isHome ? game.away.starterName : game.home.starterName,
      opposingStarterId: role === 'batter' ? (side.isHome ? game.away.starterId : game.home.starterId) : undefined,
      opposingStarterStats: role === 'batter' ? opposingStarterCard(matchupCtx) : undefined,
      opposingStarterOverallRank: role === 'batter' ? opposingStarterOverallRank(matchupCtx) : undefined,
      ownStatcast: role === 'batter' ? ownStatcastCard(person.id, matchupCtx) : undefined,
      ownStatcastSummary: role === 'batter' ? ownStatcastSummary(person.id, matchupCtx) : undefined,
      ownBattingStats: role === 'batter' ? ownBattingCard(person.id, matchupCtx) : undefined,
      ownPitcherStats: role === 'pitcher' ? ownPitcherCard(person.id, matchupCtx) : undefined,
      ownPitcherOverallRank: role === 'pitcher' ? ownPitcherOverallRank(person.id, matchupCtx) : undefined,
      matchupRank: teamRank?.rank ?? null,
      matchupStatLabel: teamRank?.label,
      modelProb: finalModelProb,
      modelVersion: homeRunModelVersion,
      modelStdDev: model?.stdDev ?? null,
      modelSampleSize: model?.sampleSize ?? null,
      leagueRate: leagueRate ?? null,
      matchupFavorable: matchup?.favorable ?? null,
      ...metaExtra,
    },
    { weather: game.weather },
    splits,
    def.line,
    (category) =>
      matchupCtx.propModelCache?.get(propModelCacheKey(String(game.gamePk), String(person.id), def.dimension, category)) ?? null,
  );
}

function starterLiveState(game: SlateGame, position: LivePosition): LiveState {
  const base = { distanceUnit: 'innings' as const };

  if (game.status === 'pre') {
    return {
      ...base,
      status: 'pre',
      distanceToSubject: 1,
      etaMinutes: null,
      etaConfidence: null,
      note: `First pitch ${new Date(game.gameDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`,
    };
  }
  if (game.status === 'live') {
    const inning = position.inning ?? null;
    return {
      ...base,
      status: inning !== null && inning > 1 ? 'done' : 'live',
      distanceToSubject: inning !== null && inning <= 1 ? 0 : null,
      etaMinutes: null,
      etaConfidence: null,
      note: inning !== null && inning > 1 ? 'First inning is complete.' : 'First inning in progress.',
    };
  }
  return { ...base, status: 'done', distanceToSubject: null, etaMinutes: null, etaConfidence: null };
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export async function getMlbSnapshot(now: Date = new Date()): Promise<SportSnapshot> {
  const warnings: string[] = [];
  const today = easternDate(now);
  const season = Number(today.slice(0, 4));

  const slate = await getSlate(today);
  if (slate.length === 0) {
    return {
      sport: 'mlb',
      eventName: 'MLB',
      eventDetail: today,
      status: 'unknown',
      candidates: [],
      subjects: [],
      warnings: [`No MLB games scheduled for ${today} (or the schedule feed did not respond).`],
      fetchedAt: now.toISOString(),
    };
  }

  const [rangeGames, recentLineupGames] = await Promise.all([
    getScheduleRange(shiftDate(today, -RANGE_DAYS), today),
    getRecentLineups(today, 4),
  ]);

  // gamePk → 1st-inning runs, and gamePk → listed starters.
  const inningOneByGame = new Map<number, { home: number; away: number }>();
  const startersByGame = new Map<number, { homeId?: number; awayId?: number }>();
  for (const game of rangeGames) {
    const first = game.linescore?.innings?.find((i) => i.num === 1);
    if (first) {
      inningOneByGame.set(game.gamePk, {
        home: Number(first.home?.runs ?? 0),
        away: Number(first.away?.runs ?? 0),
      });
    }
    startersByGame.set(game.gamePk, {
      homeId: game.teams.home.probablePitcher?.id,
      awayId: game.teams.away.probablePitcher?.id,
    });
  }

  const recentLineups = buildRecentLineups(recentLineupGames);

  /**
   * League context: what each team does, and what it allows.
   *
   * Three cheap, hour-cached calls that serve both the Scan table's DVP column
   * and Game Detail's comparison and rankings sections. Pitching is ranked with
   * `higherIsBetter: false` so rank 1 is the stingiest staff — which makes an
   * opponent's rank of 30th read directly as "most exploitable".
   */
  const [teamHitting, teamPitching, standings, leaguePitcherStats] = await Promise.all([
    getTeamSeasonStats(season, 'hitting'),
    getTeamSeasonStats(season, 'pitching'),
    getStandings(season),
    getLeagueStartingPitcherStats(season),
  ]);

  const hittingRanks = rankTeams(teamHitting, true);
  const allowedRanks = rankTeams(teamPitching, false, PITCHING_RANK_INVERTED_KEYS);
  const hittingById = new Map(teamHitting.map((t) => [t.teamId, t]));
  const pitchingById = new Map(teamPitching.map((t) => [t.teamId, t]));

  // Statcast quality metrics (whiff%/barrel%/exit velo/hard-hit%), merged in
  // on top of the traditional+FIP stats above — cache-only read (see
  // `getCachedStatcastPitcherRates`'s own comment), so a season nobody has
  // ever loaded /diagnostics's Pitcher Rankings card for just quietly
  // contributes no Statcast columns rather than blocking or failing this
  // request, which every scan goes through.
  const statcastRates = await getCachedStatcastPitcherRates(season);
  const leaguePitcherStatsEnriched = leaguePitcherStats.map((p) => {
    const sc = statcastRates.get(p.personId);
    if (!sc) return p;
    return {
      ...p,
      values: { ...p.values, whiffPct: sc.whiffPct, barrelPct: sc.barrelPct, exitVelo: sc.exitVelo, hardHitPct: sc.hardHitPct },
    };
  });

  // Individual-starter matchup context — sharper than the team-wide (bullpen
  // included) rank above, used when today's opposing starter has logged
  // enough starts to rank meaningfully (see MIN_STARTS_FOR_PITCHER_RANK).
  const pitcherRanks = rankPitchers(leaguePitcherStatsEnriched);
  const startsByPitcherId = new Map(leaguePitcherStatsEnriched.map((p) => [p.personId, p.gamesStarted]));
  const pitcherStatsById = new Map(leaguePitcherStatsEnriched.map((p) => [p.personId, p]));

  // Overall composite rank (starters/closers/relievers pooled and ranked
  // together elsewhere — see pitcherRankings.ts), reused here rather than
  // recomputed so the "#N" shown next to a starter's name always matches the
  // same number /diagnostics and the Bullpen card show — one ranking, read
  // from its one cache, not two slightly-different calculations of "how good
  // is this pitcher". Cache-only for the same hot-path-safety reason as the
  // Statcast merge above.
  const roleRankings = await getCachedPitcherRoleRankings(season);
  const starterOverallRankById = new Map(
    roleRankings?.starters.map((p) => [p.personId, { rank: p.overallRank, poolSize: p.poolSize }]) ?? [],
  );

  // A batter's own quality-of-contact line — overall AND position-scoped
  // composite ranks, same "one ranking, read from its one cache" reasoning
  // as `starterOverallRankById` above (see batterRankings.ts). Cache-only
  // for the same hot-path-safety reason as the Statcast merge above.
  const batterRankings = await getCachedBatterRankings(season);
  const batterRankingsById = new Map(batterRankings?.batters.map((b) => [b.personId, b]) ?? []);

  // Phase C.1's Beta prior center per market — real, not assumed, from every
  // graded outcome pick_history has seen so far. Empty on a totally fresh
  // install (no grading has happened yet); computeModelProbability treats a
  // missing rate as "no candidates for this market" rather than guessing.
  const leagueRates = new Map((await leagueBaseRates('mlb')).map((r) => [r.dimension, r.rate]));

  // Home Run model plan, Phase 6 — read once per snapshot, not per candidate.
  // Null until a fit actually beats the live Beta-Binomial baseline on
  // holdout (see homeRunModelFit.ts's activation gate); statMarketCandidates
  // falls back to the plain Beta-Binomial modelProb, unchanged, when this is
  // null — same "only override when fitted is present" shape as
  // app/api/odds/lines/route.ts's `if (fitted)` for moneyline/total.
  const homeRunModel = await getActiveModelWeights('mlb', 'home-run');
  // Named distinctly from the game-level `parkFactorCache` declared later in
  // this function (moneyline/total's own park-factor pass) — same
  // loadParkFactorCache(season) call, just a separate local binding so the
  // two independent scopes don't collide.
  const hrParkFactorCache = await loadParkFactorCache(season);
  // Live pitcher-matchup signal — cheap cached read (see homeRunLiveMatchup.ts).
  // Refreshed periodically via POST /api/mlb/refresh-hr-matchup, not here;
  // falls back to the neutral league rate on its own if that's never been run
  // yet for this season, so this call is always safe.
  const hrTeamMatchupCache = await loadTeamHrRateAllowedCache(season);

  // Handedness for every listed starter in the window, for the vs-hand split.
  const starterIds = [...startersByGame.values()].flatMap((s) => [s.homeId, s.awayId]).filter((id): id is number => !!id);
  const handById = await getHandedness(starterIds);

  // Assemble each game with its two sides.
  const games: SlateGame[] = [];
  let projectedLineupCount = 0;

  for (const game of slate) {
    const makeSide = (which: 'away' | 'home'): TeamSide => {
      const team = game.teams[which].team;
      const posted = which === 'away' ? game.lineups?.awayPlayers : game.lineups?.homePlayers;
      const fallback = recentLineups.get(team.id);

      const usePosted = posted && posted.length > 0;
      if (!usePosted && fallback) projectedLineupCount += 1;

      const starter = game.teams[which].probablePitcher;
      return {
        teamId: team.id,
        teamName: team.name,
        abbreviation: team.abbreviation ?? team.name.slice(0, 3).toUpperCase(),
        isHome: which === 'home',
        lineup: usePosted ? posted!.map((p) => p.id) : (fallback?.ids ?? []),
        lineupNames: usePosted
          ? new Map(posted!.map((p) => [p.id, p.fullName]))
          : (fallback?.names ?? new Map()),
        lineupProjected: !usePosted,
        starterId: starter?.id,
        starterName: starter?.fullName,
      };
    };

    const away = makeSide('away');
    const home = makeSide('home');
    // Each side faces the other side's starter.
    away.opposingHand = home.starterId ? handById.get(home.starterId)?.pitchHand : undefined;
    home.opposingHand = away.starterId ? handById.get(away.starterId)?.pitchHand : undefined;

    games.push({
      gamePk: game.gamePk,
      gameDate: game.gameDate,
      status: statusFor(game),
      detailedState: game.detailedState,
      away,
      home,
      venueName: game.venue?.name,
      venueId: game.venue?.id,
      finalScore:
        game.teams.home.score != null && game.teams.away.score != null
          ? { home: game.teams.home.score, away: game.teams.away.score }
          : undefined,
    });
  }

  // Live feeds only for games actually in progress.
  const liveGames = games.filter((g) => g.status === 'live');
  const feeds = await Promise.all(liveGames.map((g) => getLiveFeed(g.gamePk)));
  liveGames.forEach((g, i) => {
    g.live = feeds[i] ?? undefined;
  });
  if (liveGames.length > 0 && feeds.some((f) => f === null)) {
    warnings.push('One or more live game feeds did not respond — those batter positions are unavailable.');
  }

  // Weather per venue, from MLB's exact venue coordinates.
  await Promise.all(
    slate.map(async (game, index) => {
      const coords = game.venue?.location?.defaultCoordinates;
      if (!coords) return;
      const weather = await getWeather(
        {
          latitude: coords.latitude,
          longitude: coords.longitude,
          resolvedName: game.venue?.name ?? '',
          approximate: false,
        },
        new Date(game.gameDate),
      );
      if (weather) games[index].weather = weather;
    }),
  );

  // Sim engine plan, Phase 7's live-wiring follow-up — ensure a live
  // simulation is cached for every pre-game matchup with a resolvable
  // lineup and starter on both sides, upgrading projected→posted as real
  // lineups post. Piggybacks on this function's own ~5-minute rebuild cache
  // (app/api/mlb/route.ts) rather than a new schedule — see
  // gameSimCache.ts's own header. Failures are per-game and non-fatal
  // (already caught inside ensureGameSims), so one bad matchup never blocks
  // the rest of the snapshot.
  try {
    await ensureGameSims(
      games.map((g) => ({
        gamePk: g.gamePk,
        season,
        status: g.status,
        homeLineup: g.home.lineup,
        awayLineup: g.away.lineup,
        homeLineupProjected: g.home.lineupProjected,
        awayLineupProjected: g.away.lineupProjected,
        homeStarterId: g.home.starterId,
        awayStarterId: g.away.starterId,
        homeTeamId: g.home.teamId,
        awayTeamId: g.away.teamId,
        venueId: g.venueId,
      })),
    );
  } catch (error) {
    console.error('[adapter] ensureGameSims failed', error);
  }

  // Fetch stats for everyone we intend to score.
  const batterIds = games.flatMap((g) => [...g.away.lineup, ...g.home.lineup]);
  const pitcherIds = games.flatMap((g) => [g.away.starterId, g.home.starterId]).filter((id): id is number => !!id);

  const [batters, pitchers] = await Promise.all([
    getPeopleWithGameLogs(batterIds, 'hitting', season),
    getPeopleWithGameLogs(pitcherIds, 'pitching', season),
  ]);

  /**
   * Say so when a stats fetch comes back short.
   *
   * Without this the failure is invisible: every `batters.get(id)` misses, the
   * loop `continue`s, and the API returns a cheerful 200 with zero candidates
   * and no indication that anything went wrong. An empty scan should never be
   * indistinguishable from a slate with nothing on it.
   */
  const uniqueBatters = new Set(batterIds).size;
  const uniquePitchers = new Set(pitcherIds).size;
  if (uniqueBatters > 0 && batters.size < uniqueBatters) {
    warnings.push(
      `Batter stats returned for ${batters.size} of ${uniqueBatters} players — the rest are missing from this scan.`,
    );
  }
  if (uniquePitchers > 0 && pitchers.size < uniquePitchers) {
    warnings.push(
      `Pitcher stats returned for ${pitchers.size} of ${uniquePitchers} players — the rest are missing from this scan.`,
    );
  }

  // Build candidates.
  // Task 2.7a — Python's prop model output for this whole slate, in one
  // query, read once here rather than per candidate (a full slate is ~2,400
  // of them, and a round trip each through the pooler is the shape that made
  // write_game_odds_history take 290s before task 2.3 batched it). Every
  // candidate below prefers a fresh row from this over recomputing the model
  // in TypeScript; an empty map, a missing row or a stale one all fall back
  // to the local computation, so this can only make the page fresher, never
  // emptier. Placed after `games` is built, since it keys on the slate.
  const propModelCache = await readPropModelCacheForGames('mlb', games.map((g) => String(g.gamePk)));

  const candidates: PickCandidate[] = [];
  const subjects: SubjectSummary[] = [];

  for (const game of games) {
    const position = readLivePosition(game.live, now);

    for (const side of [game.away, game.home]) {
      const teamOpponentId = side.isHome ? game.away.teamId : game.home.teamId;
      const teamOpponentAbbr = side.isHome ? game.away.abbreviation : game.home.abbreviation;
      for (const def of TEAM_STAT_MARKETS) {
        const teamCandidate = teamStatMarketCandidates(
          side.teamId,
          side.teamName,
          side.abbreviation,
          teamOpponentAbbr,
          teamOpponentId,
          side.isHome,
          game,
          def,
          extractTeamResults(rangeGames, side.teamId),
        );
        if (teamCandidate) candidates.push(teamCandidate);
      }

      for (const batterId of side.lineup) {
        const person = batters.get(batterId);
        if (!person) continue;

        const liveState = batterLiveState(game, side, batterId, position, now);

        const opponentId = side.isHome ? game.away.teamId : game.home.teamId;
        const batterMatchupCtx: MatchupContext = {
          hittingRanks,
          allowedRanks,
          pitcherRanks,
          startsByPitcherId,
          opponentTeamId: opponentId,
          opposingStarterId: side.isHome ? game.away.starterId : game.home.starterId,
          pitcherStatsById,
          leagueRates,
          starterOverallRankById,
          batterRankingsById,
          homeRunModel,
          parkFactorCache: hrParkFactorCache,
          hrTeamMatchupCache,
          propModelCache,
        };

        const hit = hitInGameCandidates(person, game, side, liveState, batterMatchupCtx);
        if (hit) candidates.push(hit);

        const vsHand = vsHandCandidates(person, game, side, liveState, startersByGame, handById, batterMatchupCtx);
        if (vsHand) candidates.push(vsHand);

        // Splits require a real plate appearance — same eligibility rule
        // hitInGameCandidates already applies, so a pinch-runner-only game
        // doesn't count as "0 total bases" for a player who didn't bat.
        const battedThisGame = (s: GameLogSplit) =>
          Number(s.stat?.atBats ?? 0) > 0 || Number(s.stat?.plateAppearances ?? 0) > 0;
        for (const def of BATTER_STAT_MARKETS) {
          const c = statMarketCandidates(
            person,
            game,
            side,
            liveState,
            def,
            battedThisGame,
            {
              position: person.primaryPosition,
              batSide: person.batSide,
              lineupProjected: side.lineupProjected,
            },
            'batter',
            batterMatchupCtx,
          );
          if (c) candidates.push(c);
        }

        const last = person.gameLog[person.gameLog.length - 1];
        subjects.push({
          subjectId: String(person.id),
          subjectName: person.fullName,
          statusLine: last ? `Last: ${last.stat?.hits ?? 0}-${last.stat?.atBats ?? 0}` : undefined,
          meta: {
            team: side.abbreviation,
            role: 'batter',
            gamePk: game.gamePk,
            headshotUrl: mlbHeadshotUrl(person.id),
            teamLogoUrl: mlbTeamLogoUrl(side.teamId),
            teamId: side.teamId,
          },
          liveState,
        });
      }

      if (side.starterId) {
        const person = pitchers.get(side.starterId);
        if (person) {
          const liveState = starterLiveState(game, position);
          const first = firstInningCandidates(person, game, side, inningOneByGame, liveState);
          if (first) candidates.push(first);

          // Every dimension in the app so far only tracks starters (the main
          // loop never fetches relievers), so the same "did this person
          // start" filter firstInningCandidates already uses applies here.
          const started = (s: GameLogSplit) => Number(s.stat?.gamesStarted ?? 0) > 0;
          const pitcherMatchupCtx: MatchupContext = {
            hittingRanks,
            allowedRanks,
            pitcherRanks,
            startsByPitcherId,
            opponentTeamId: side.isHome ? game.away.teamId : game.home.teamId,
            leagueRates,
            // Needed for ownPitcherCard/ownPitcherOverallRank — the subject
            // pitcher's own percentile stats, same maps opposingStarterCard
            // already reads for the batter side's opponent.
            pitcherStatsById,
            starterOverallRankById,
            propModelCache,
          };
          for (const def of PITCHER_STAT_MARKETS) {
            const c = statMarketCandidates(
              person,
              game,
              side,
              liveState,
              def,
              started,
              {
                pitchHand: person.pitchHand,
                role: 'starting pitcher',
              },
              'pitcher',
              pitcherMatchupCtx,
            );
            if (c) candidates.push(c);
          }

          subjects.push({
            subjectId: String(person.id),
            subjectName: person.fullName,
            statusLine: `${side.abbreviation} starter${person.pitchHand ? ` (${person.pitchHand}HP)` : ''}`,
            meta: {
              team: side.abbreviation,
              role: 'pitcher',
              gamePk: game.gamePk,
              headshotUrl: mlbHeadshotUrl(person.id),
              teamLogoUrl: mlbTeamLogoUrl(side.teamId),
              teamId: side.teamId,
            },
            liveState,
          });
        }
      }
    }
  }

  if (projectedLineupCount > 0) {
    warnings.push(
      `${projectedLineupCount} lineup(s) not posted yet — those batting orders are carried over from each team's last game and are marked projected.`,
    );
  }

  /**
   * The stat block Game Detail's comparison and rankings sections read from.
   *
   * Injuries are deliberately *not* here. They need one roster call per team,
   * which on a 15-game slate is 30 requests on the critical path of a view that
   * never shows them — measured at roughly 25s of added cold latency. Game
   * Detail fetches the two teams it actually needs from `/api/mlb/injuries`.
   */
  const teamContext = (teamId: number) => {
    const record = standings.get(teamId);
    const hitting = hittingById.get(teamId);
    const pitching = pitchingById.get(teamId);
    return {
      teamId,
      record: record ? { wins: record.wins, losses: record.losses } : null,
      divisionRank: record?.divisionRank ? ordinalRank(Number(record.divisionRank)) : null,
      homeRecord: record?.homeRecord ?? null,
      awayRecord: record?.awayRecord ?? null,
      lastTen: record?.lastTen ?? null,
      // Per-game rates, so two teams with different games played compare fairly.
      forStats: perGame(hitting),
      forStatsSeason: seasonTotals(hitting),
      againstStats: perGame(pitching),
      forRanks: Object.fromEntries(
        TEAM_STAT_KEYS.map(({ key }) => [key, ordinalRank(hittingRanks.get(teamId)?.[key])]),
      ),
      againstRanks: Object.fromEntries(
        TEAM_STAT_KEYS.map(({ key }) => [key, ordinalRank(allowedRanks.get(teamId)?.[key])]),
      ),
    };
  };

  const starterInfo = (starterId: number | undefined): OpposingStarter | null => {
    if (starterId == null) return null;
    const era = pitcherStatsById.get(starterId)?.values.era;
    if (era == null) return null;
    return { era, starts: startsByPitcherId.get(starterId) ?? 0 };
  };

  /**
   * Game-level model — moneyline only here (Pythagorean + log5, gameModel.ts).
   * Deliberately doesn't compute the totals half: that needs the sportsbook's
   * actual total line, which lives in the separate game-odds pipeline
   * (lib/odds/display.ts), not here — client code combines this game's
   * homeExpectedRuns/awayExpectedRuns with whatever line it resolves.
   */
  // Loaded once per snapshot build (cached table read, no network call) rather
  // than per game — a park's factor doesn't change within a single request.
  const parkFactorCache = await loadParkFactorCache(season);

  const gameModelFor = (g: SlateGame) => {
    const home = teamContext(g.home.teamId);
    const away = teamContext(g.away.teamId);
    if (home.forStats.runs == null || home.againstStats.runs == null || away.forStats.runs == null || away.againstStats.runs == null) {
      return null;
    }
    const parkFactor = g.venueId != null ? (parkFactorCache.get(g.venueId) ?? 1) : 1;
    const weatherFactor = weatherRunsFactor(g.venueName, g.weather?.tempF);
    const homePlatoonFactor = lineupPlatoonFactor(g.home.lineup, g.home.opposingHand, batters, startersByGame, handById);
    const awayPlatoonFactor = lineupPlatoonFactor(g.away.lineup, g.away.opposingHand, batters, startersByGame, handById);
    const result = computeMoneylineModel({
      home: {
        runsScoredPerGame: home.forStats.runs * homePlatoonFactor,
        runsAllowedPerGame: home.againstStats.runs,
        seasonRecord: home.record,
        venueRecord: home.homeRecord,
        recentRecord: home.lastTen,
      },
      away: {
        runsScoredPerGame: away.forStats.runs * awayPlatoonFactor,
        runsAllowedPerGame: away.againstStats.runs,
        seasonRecord: away.record,
        venueRecord: away.awayRecord,
        recentRecord: away.lastTen,
      },
      homeStarter: starterInfo(g.home.starterId),
      awayStarter: starterInfo(g.away.starterId),
      // Combined venue run-environment: park's own character × today's
      // temperature effect — both are "how many runs does this SPECIFIC
      // game's conditions add or remove," so they compose as one
      // multiplier rather than two separate model inputs.
      parkFactor: parkFactor * weatherFactor,
    });
    return result;
  };

  const anyLive = games.some((g) => g.status === 'live');
  const allDone = games.every((g) => g.status === 'done');

  // Batch-loaded once per unique team instead of the games.map below calling
  // getCurrentElo up to 4x per game (twice directly, twice more inside what
  // restAndTravelFor used to do internally) — same DB query
  // (getCurrentElo/dbGetCurrentElo), just deduplicated across both the
  // repeated call within one game and, on a doubleheader day, the same
  // team's still-pregame state across its two games.
  const eloByTeam = new Map<number, CurrentElo>();
  for (const g of games) {
    if (!eloByTeam.has(g.home.teamId)) eloByTeam.set(g.home.teamId, await getCurrentElo(g.home.teamId, season));
    if (!eloByTeam.has(g.away.teamId)) eloByTeam.set(g.away.teamId, await getCurrentElo(g.away.teamId, season));
  }

  /**
   * Phase O of the TS cutover gameplan
   * (docs/mlb-prediction-engine-ts-cutover-gameplan-2026-08-22.md): Python's
   * computeMlbGameModelJob independently computes gameModel + Elo for every
   * pre-game matchup and writes it to mlb_game_model_cache on a 15min
   * cadence. Prefer that here — it's now the same computation this file
   * would otherwise do itself, just computed once by the worker instead of
   * once per snapshot rebuild. Falls back to the exact prior live-compute
   * path (gameModelFor + getCurrentElo/restAndTravelFromState/
   * pitcherAdjustment, unchanged below) whenever the cache row is missing
   * OR older than GAME_MODEL_CACHE_MAX_AGE_MS — a stale row (the job
   * stopped running) must never silently keep serving an old prediction
   * forever, it should degrade to exactly today's behavior instead.
   */
  const gameModelAndEloFor = async (
    g: SlateGame,
  ): Promise<{ gameModel: ReturnType<typeof computeMoneylineModel> | null; elo: GameEloContext }> => {
    const cached = await readGameModelCache('mlb', String(g.gamePk));
    if (cached && Date.now() - Date.parse(cached.computedAt) <= GAME_MODEL_CACHE_MAX_AGE_MS) {
      return {
        gameModel: {
          homeWinProb: cached.homeWinProb,
          awayWinProb: cached.awayWinProb,
          homeExpectedRuns: cached.homeExpectedRuns,
          awayExpectedRuns: cached.awayExpectedRuns,
          diagnostics: cached.diagnostics,
        },
        elo: {
          home: { elo: cached.homeElo, gamesPlayed: cached.homeGamesPlayed },
          away: { elo: cached.awayElo, gamesPlayed: cached.awayGamesPlayed },
          homeRestDays: cached.homeRestDays,
          awayRestDays: cached.awayRestDays,
          homeTravelMiles: cached.homeTravelMiles,
          awayTravelMiles: cached.awayTravelMiles,
          homePitcherAdj: cached.homePitcherAdj,
          awayPitcherAdj: cached.awayPitcherAdj,
        },
      };
    }

    // Fallback — identical to the live computation this replaced.
    const home = eloByTeam.get(g.home.teamId)!;
    const away = eloByTeam.get(g.away.teamId)!;
    const homeRT = restAndTravelFromState(home, g.gameDate, g.home.teamId);
    const awayRT = restAndTravelFromState(away, g.gameDate, g.home.teamId);
    const [homePitcherAdj, awayPitcherAdj] = await Promise.all([
      pitcherAdjustment(g.home.starterId ?? null, g.home.teamId, season, g.gameDate),
      pitcherAdjustment(g.away.starterId ?? null, g.away.teamId, season, g.gameDate),
    ]);
    return {
      gameModel: gameModelFor(g),
      elo: {
        home: { elo: home.elo, gamesPlayed: home.gamesPlayed },
        away: { elo: away.elo, gamesPlayed: away.gamesPlayed },
        homeRestDays: homeRT.restDays,
        awayRestDays: awayRT.restDays,
        homeTravelMiles: homeRT.miles,
        awayTravelMiles: awayRT.miles,
        homePitcherAdj,
        awayPitcherAdj,
      },
    };
  };

  return {
    sport: 'mlb',
    eventName: 'MLB',
    eventDetail: `${games.length} games · ${today}`,
    status: anyLive ? 'live' : allDone ? 'done' : 'pre',
    candidates,
    subjects,
    context: {
      other: {
        games: await Promise.all(games.map(async (g) => ({
          gamePk: g.gamePk,
          matchup: `${g.away.abbreviation} @ ${g.home.abbreviation}`,
          // Full names are what the Odds API keys its events on.
          awayTeamName: g.away.teamName,
          homeTeamName: g.home.teamName,
          awayTeamId: g.away.teamId,
          homeTeamId: g.home.teamId,
          state: g.detailedState,
          status: g.status,
          venue: g.venueName,
          firstPitch: g.gameDate,
          awayStarter: g.away.starterName,
          homeStarter: g.home.starterName,
          awayStarterId: g.away.starterId ?? null,
          homeStarterId: g.home.starterId ?? null,
          awayStarterStats: starterStatCard(g.away.starterId, pitcherStatsById, pitcherRanks, startsByPitcherId),
          homeStarterStats: starterStatCard(g.home.starterId, pitcherStatsById, pitcherRanks, startsByPitcherId),
          awayStarterOverallRank: starterOverallRank(g.away.starterId, starterOverallRankById),
          homeStarterOverallRank: starterOverallRank(g.home.starterId, starterOverallRankById),
          weather: g.weather,
          weatherNarrative: weatherNarrative(g.weather, g.gameDate, g.venueName),
          away: teamContext(g.away.teamId),
          home: teamContext(g.home.teamId),
          ...(await gameModelAndEloFor(g)),
          ...liveScoreboard(g),
        }))),
        statKeys: TEAM_STAT_KEYS,
      },
    },
    warnings,
    fetchedAt: now.toISOString(),
  };
}
