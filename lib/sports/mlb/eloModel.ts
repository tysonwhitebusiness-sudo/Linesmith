/**
 * Elo-style dynamic team rating — updates once per completed game rather
 * than only reflecting a season-to-date average, so a real hot or cold
 * streak shows up immediately instead of being diluted across 60+ games.
 *
 * Mirrors FiveThirtyEight's own MLB approach (see their published dataset
 * and methodology) in one specific way that matters: the STORED rating
 * stays simple — only wins, losses, and margin of victory move it, the same
 * way their "elo" columns work. Home-field, rest, travel, and starting
 * pitcher never touch the stored number; they're applied only at PREDICTION
 * time via `predictHomeWinProb`, the same role their separate "rating"
 * system plays. Keeping these decoupled means a day-of adjustment can never
 * permanently corrupt a team's long-run rating trajectory.
 *
 * K (rating volatility) and the various adjustment coefficients below are
 * deliberately left as named constants — the same kind of hand-picked value
 * gameModel.ts's own constants used to be. Several are now cross-checked
 * against FiveThirtyEight's own published numbers (see each constant's
 * comment) rather than pure guesses, but none are fit against outcomes yet.
 */

import {
  writeEloHistory,
  getCurrentElo as dbGetCurrentElo,
  getLatestEloBeforeSeason,
  getMostRecentEloGame,
  recentPitcherGameScores,
  teamBaselineGameScore,
  writePitcherGameScore,
  type EloHistoryRow,
  type PitcherGameScoreRow,
} from '../../db/client';
import { getScheduleRange, easternDate, getLiveFeed } from './statsapi';

const ELO_SCALE = 400; // standard logistic Elo scale (chess convention, widely reused in sports Elo)
const DEFAULT_K = 5; // MLB's game-to-game randomness calls for a much gentler K than chess's 32 — tunable, still not fit against outcomes
const HOME_ELO_BONUS = 24; // Elo points for the home team — matches FiveThirtyEight's own published home-field value exactly, a good independent sanity check on this constant
export const STARTING_ELO = 1500;
/** Below this many rated games this season, a team's Elo is mostly still its (possibly regressed) season-opening value — too little in-season signal to blend into a live pick. */
export const MIN_GAMES_FOR_ELO_TRUST = 10;

/**
 * How far a team's rating regresses toward the mean between seasons — a
 * fraction of the gap between last season's ending rating and 1500. 1/3 is
 * a standard sports-Elo convention (not FiveThirtyEight's exact undisclosed
 * value); replaces the previous flat-reset-to-1500 approach now that there's
 * enough historical data to actually test alternatives against.
 */
export const SEASON_REGRESSION_FACTOR = 1 / 3;

export function regressToMean(priorRating: number, factor: number = SEASON_REGRESSION_FACTOR): number {
  return STARTING_ELO + factor * (priorRating - STARTING_ELO);
}

// ---------------------------------------------------------------------------
// Rest (item 2)
// ---------------------------------------------------------------------------

/** FiveThirtyEight's published value: each day of rest is worth roughly 2.3 rating points, capped at 3 days. */
export const REST_POINTS_PER_DAY = 2.3;
export const MAX_REST_DAYS = 3;

/** Days between a team's last game and this one, minus the game day itself — back-to-back games are 0 days of rest. No prior game on record (season/history start) is treated as fully rested. */
export function daysOfRest(lastGameDate: string | null, thisGameDate: string): number {
  if (!lastGameDate) return MAX_REST_DAYS;
  const diffDays = Math.round((Date.parse(thisGameDate) - Date.parse(lastGameDate)) / 86_400_000);
  return Math.max(0, diffDays - 1);
}

export function restBonus(days: number): number {
  return Math.min(MAX_REST_DAYS, Math.max(0, days)) * REST_POINTS_PER_DAY;
}

// ---------------------------------------------------------------------------
// Travel (item 3)
// ---------------------------------------------------------------------------

/**
 * Each team's home-city coordinates — used as a stand-in for exact venue
 * geocoding, which none of the historical sources (this app's own MLB
 * fetches, the uploaded odds files, or the 538 dataset) reliably carry.
 * "How far did they travel between cities" is the right granularity for a
 * rating adjustment this small anyway. MLB team IDs as used throughout this
 * app; the Athletics use their current Sacramento home (Sutter Health Park),
 * not the historical Oakland location.
 */
const TEAM_HOME_COORDS: Record<number, { lat: number; lon: number }> = {
  108: { lat: 33.8, lon: -117.88 }, // LAA — Anaheim
  109: { lat: 33.45, lon: -112.07 }, // ARI — Phoenix
  110: { lat: 39.29, lon: -76.61 }, // BAL — Baltimore
  111: { lat: 42.36, lon: -71.06 }, // BOS — Boston
  112: { lat: 41.88, lon: -87.63 }, // CHC — Chicago
  113: { lat: 39.1, lon: -84.51 }, // CIN — Cincinnati
  114: { lat: 41.5, lon: -81.69 }, // CLE — Cleveland
  115: { lat: 39.74, lon: -104.99 }, // COL — Denver
  116: { lat: 42.33, lon: -83.05 }, // DET — Detroit
  117: { lat: 29.76, lon: -95.37 }, // HOU — Houston
  118: { lat: 39.1, lon: -94.58 }, // KC — Kansas City
  119: { lat: 34.05, lon: -118.24 }, // LAD — Los Angeles
  120: { lat: 38.91, lon: -77.01 }, // WSH — Washington
  121: { lat: 40.75, lon: -73.85 }, // NYM — Queens
  133: { lat: 38.58, lon: -121.49 }, // ATH — Sacramento (current)
  134: { lat: 40.44, lon: -80.0 }, // PIT — Pittsburgh
  135: { lat: 32.72, lon: -117.16 }, // SD — San Diego
  136: { lat: 47.61, lon: -122.33 }, // SEA — Seattle
  137: { lat: 37.77, lon: -122.42 }, // SF — San Francisco
  138: { lat: 38.63, lon: -90.2 }, // STL — St. Louis
  139: { lat: 27.77, lon: -82.65 }, // TB — St. Petersburg
  140: { lat: 32.75, lon: -97.08 }, // TEX — Arlington
  141: { lat: 43.65, lon: -79.38 }, // TOR — Toronto
  142: { lat: 44.98, lon: -93.27 }, // MIN — Minneapolis
  143: { lat: 39.95, lon: -75.17 }, // PHI — Philadelphia
  144: { lat: 33.89, lon: -84.47 }, // ATL — Cumberland/Truist Park
  145: { lat: 41.83, lon: -87.63 }, // CWS — Chicago
  146: { lat: 25.76, lon: -80.19 }, // MIA — Miami
  147: { lat: 40.83, lon: -73.93 }, // NYY — Bronx
  158: { lat: 43.04, lon: -87.91 }, // MIL — Milwaukee
};

function haversineMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 3958.8; // Earth radius, miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

/** 538 discloses a max of ~4 points but not the curve shape — linear up to a cross-country-flight-scale distance is a reasonable, disclosed approximation, not a wild guess: a max-penalty trip should look like LA-to-Boston, not a short regional hop. */
export const MAX_TRAVEL_PENALTY = 4;
export const MILES_FOR_MAX_TRAVEL_PENALTY = 2500;

export function travelPenalty(miles: number): number {
  return Math.min(MAX_TRAVEL_PENALTY, (Math.max(0, miles) / MILES_FOR_MAX_TRAVEL_PENALTY) * MAX_TRAVEL_PENALTY);
}

/** Distance between where a team last played and where they're playing today (today's home team's city, for both sides). */
export function travelMiles(lastLocationTeamId: number | null, todayLocationTeamId: number): number {
  if (lastLocationTeamId == null) return 0;
  const from = TEAM_HOME_COORDS[lastLocationTeamId];
  const to = TEAM_HOME_COORDS[todayLocationTeamId];
  if (!from || !to) return 0;
  return haversineMiles(from, to);
}

// ---------------------------------------------------------------------------
// Starting pitcher adjustment (item 4)
// ---------------------------------------------------------------------------

/**
 * Bill James' original Game Score — a single-start quality number, computed
 * from the box score alone. Standard, published formula (not a local
 * invention): start at 50; +1 per out recorded, +1 more for outs beyond the
 * 4th inning (i.e. +2 total per out once a start goes past 12 outs); -2 per
 * hit, -4 per earned run, -2 per unearned run, -1 per walk, +1 per
 * strikeout.
 */
export interface PitcherLineForGameScore {
  outs: number;
  hits: number;
  earnedRuns: number;
  unearnedRuns: number;
  walks: number;
  strikeouts: number;
}

export function computeGameScore(line: PitcherLineForGameScore): number {
  const outsBeyond4th = Math.max(0, line.outs - 12);
  return (
    50 +
    line.outs +
    2 * outsBeyond4th -
    2 * line.hits -
    4 * line.earnedRuns -
    2 * line.unearnedRuns -
    line.walks +
    line.strikeouts
  );
}

/** "6.1" (6 innings, 1 out) → 19 outs. MLB's innings-pitched notation is not decimal — .1/.2 mean 1 or 2 extra outs, never a fraction. */
export function inningsPitchedToOuts(inningsPitched: string | number): number {
  const [wholeStr, partialStr] = String(inningsPitched).split('.');
  const whole = Number(wholeStr) || 0;
  const partial = Number(partialStr) || 0;
  return whole * 3 + partial;
}

/** 538's published multiplier: a start's Game Score, compared to the team's own rolling baseline, swings that team's effective rating by roughly 4.7x the gap. */
export const PITCHER_ADJ_MULTIPLIER = 4.7;
/** How many of a pitcher's own recent starts the rolling trend averages over — not disclosed by 538, a reasonable, disclosed window. */
export const PITCHER_TREND_STARTS = 5;

/** 0 (neutral, no adjustment) when there isn't enough real signal yet — a rookie/call-up with no starts on record, or a team with no baseline starts logged this season. Same "honest gap" discipline as every other sample-gated adjustment in this app. */
export async function pitcherAdjustment(pitcherId: number | null, teamId: number, season: number, gameDate: string): Promise<number> {
  if (!pitcherId) return 0;
  const trend = await recentPitcherGameScores(pitcherId, PITCHER_TREND_STARTS);
  if (trend.length === 0) return 0;
  const pitcherAvg = trend.reduce((s, v) => s + v, 0) / trend.length;
  const baseline = await teamBaselineGameScore(teamId, season, gameDate);
  if (baseline == null) return 0;
  return (pitcherAvg - baseline) * PITCHER_ADJ_MULTIPLIER;
}

// ---------------------------------------------------------------------------
// Rating update (stored Elo — unaffected by rest/travel/pitcher, by design)
// ---------------------------------------------------------------------------

export function eloExpectedHomeWinProb(homeElo: number, awayElo: number, homeBonus: number = HOME_ELO_BONUS): number {
  return 1 / (1 + Math.pow(10, -(homeElo - awayElo + homeBonus) / ELO_SCALE));
}

/**
 * Margin-of-victory multiplier: a blowout moves the rating more than a
 * 1-run win, log-scaled so a 10-run margin doesn't move it 10x as much as a
 * 1-run margin (diminishing returns). Dampened by how big a favorite the
 * winner already was — a heavy favorite blowing out a heavy underdog is
 * expected and shouldn't swing the rating as hard as the same blowout being
 * an upset.
 */
export function movMultiplier(runMargin: number, winnerPreGameEloDiff: number): number {
  const margin = Math.max(1, Math.abs(runMargin));
  const dampener = 2.2 / (Math.abs(winnerPreGameEloDiff) * 0.001 + 2.2);
  return Math.log(margin + 1) * dampener;
}

export interface EloUpdateResult {
  newHomeElo: number;
  newAwayElo: number;
  preGameHomeWinProb: number;
}

export function updateElo(
  homeElo: number,
  awayElo: number,
  homeRuns: number,
  awayRuns: number,
  k: number = DEFAULT_K,
  homeBonus: number = HOME_ELO_BONUS,
): EloUpdateResult {
  const preGameHomeWinProb = eloExpectedHomeWinProb(homeElo, awayElo, homeBonus);
  const homeWon = homeRuns > awayRuns ? 1 : 0;
  const winnerPreGameDiff = homeWon ? homeElo - awayElo : awayElo - homeElo;
  const mov = movMultiplier(homeRuns - awayRuns, winnerPreGameDiff);
  const delta = k * mov * (homeWon - preGameHomeWinProb);
  return {
    newHomeElo: homeElo + delta,
    newAwayElo: awayElo - delta,
    preGameHomeWinProb,
  };
}

// ---------------------------------------------------------------------------
// Prediction (rest + travel + pitcher applied here only, never to the stored rating)
// ---------------------------------------------------------------------------

export interface PredictionAdjustments {
  homeRestDays?: number;
  awayRestDays?: number;
  homeTravelMiles?: number;
  awayTravelMiles?: number;
  homePitcherAdj?: number;
  awayPitcherAdj?: number;
}

export function predictHomeWinProb(homeElo: number, awayElo: number, adj: PredictionAdjustments = {}): number {
  const homeEffective =
    homeElo + HOME_ELO_BONUS + restBonus(adj.homeRestDays ?? 0) - travelPenalty(adj.homeTravelMiles ?? 0) + (adj.homePitcherAdj ?? 0);
  const awayEffective = awayElo + restBonus(adj.awayRestDays ?? 0) - travelPenalty(adj.awayTravelMiles ?? 0) + (adj.awayPitcherAdj ?? 0);
  return 1 / (1 + Math.pow(10, -(homeEffective - awayEffective) / ELO_SCALE));
}

// ---------------------------------------------------------------------------
// Backfill (historical, walk-forward, no lookahead)
// ---------------------------------------------------------------------------

/**
 * Walks the season chronologically once, computing every team's Elo
 * trajectory — same no-lookahead discipline as gameModelBackfill.ts. A
 * team's first game of the walked season starts from their regressed prior
 * season rating (see regressToMean) if one exists in the DB, otherwise the
 * flat starting value — replacing the previous flat-reset-every-season
 * approach.
 */
export async function backfillElo(season: number): Promise<EloHistoryRow[]> {
  // Bounding the range end at *today* only makes sense for the season
  // currently in progress — passing a past season through unbounded would
  // fetch every game from that season's start through today regardless of
  // year, silently pulling in every later season's games too.
  const currentSeason = Number(easternDate().slice(0, 4));
  const rangeEnd = season >= currentSeason ? easternDate() : `${season}-11-30`;
  const games = await getScheduleRange(`${season}-03-01`, rangeEnd);
  const finals = games
    .filter((g) => g.abstractState === 'Final' && g.teams.home.score != null && g.teams.away.score != null)
    .sort((a, b) => (a.gameDate < b.gameDate ? -1 : 1));

  const ratings = new Map<number, number>();
  const gamesPlayed = new Map<number, number>();
  const entries: EloHistoryRow[] = [];

  const startingRatingFor = async (teamId: number): Promise<number> => {
    if (ratings.has(teamId)) return ratings.get(teamId)!;
    const prior = await getLatestEloBeforeSeason(teamId, season);
    const start = prior ? regressToMean(prior.elo) : STARTING_ELO;
    ratings.set(teamId, start);
    return start;
  };

  for (const g of finals) {
    const homeId = g.teams.home.team.id;
    const awayId = g.teams.away.team.id;
    const homeRuns = g.teams.home.score as number;
    const awayRuns = g.teams.away.score as number;
    const homeElo = await startingRatingFor(homeId);
    const awayElo = await startingRatingFor(awayId);

    const result = updateElo(homeElo, awayElo, homeRuns, awayRuns);
    ratings.set(homeId, result.newHomeElo);
    ratings.set(awayId, result.newAwayElo);
    const homeGames = (gamesPlayed.get(homeId) ?? 0) + 1;
    const awayGames = (gamesPlayed.get(awayId) ?? 0) + 1;
    gamesPlayed.set(homeId, homeGames);
    gamesPlayed.set(awayId, awayGames);

    entries.push({
      teamId: homeId,
      season,
      gamePk: g.gamePk,
      gameDate: g.gameDate,
      elo: result.newHomeElo,
      gamesPlayed: homeGames,
      opponentTeamId: awayId,
      wasHome: true,
    });
    entries.push({
      teamId: awayId,
      season,
      gamePk: g.gamePk,
      gameDate: g.gameDate,
      elo: result.newAwayElo,
      gamesPlayed: awayGames,
      opponentTeamId: homeId,
      wasHome: false,
    });
  }

  return entries;
}

export async function refreshEloBackfill(season: number): Promise<{ gamesWalked: number; rowsWritten: number }> {
  const entries = await backfillElo(season);
  const rowsWritten = await writeEloHistory(entries);
  return { gamesWalked: entries.length / 2, rowsWritten };
}

// ---------------------------------------------------------------------------
// Live path
// ---------------------------------------------------------------------------

export interface CurrentElo {
  elo: number;
  gamesPlayed: number;
  lastGameDate: string | null;
  /** Team id of wherever they were last (their own, if last game was home; the opponent's, if away) — the travel calculation's starting point. */
  lastLocationTeamId: number | null;
}

/**
 * A team's rating right now: this season's most recent row if they've
 * played, otherwise their regressed prior-season rating, otherwise the flat
 * starting value for a team with no history at all.
 */
export async function getCurrentElo(teamId: number, season: number): Promise<CurrentElo> {
  const thisSeason = await dbGetCurrentElo(teamId, season);
  if (thisSeason) {
    return {
      elo: thisSeason.elo,
      gamesPlayed: thisSeason.gamesPlayed,
      lastGameDate: thisSeason.gameDate,
      lastLocationTeamId: thisSeason.wasHome ? teamId : thisSeason.opponentTeamId,
    };
  }
  const prior = await getLatestEloBeforeSeason(teamId, season);
  if (prior) {
    return {
      elo: regressToMean(prior.elo),
      gamesPlayed: 0,
      lastGameDate: prior.gameDate,
      lastLocationTeamId: prior.wasHome ? teamId : prior.opponentTeamId,
    };
  }
  return { elo: STARTING_ELO, gamesPlayed: 0, lastGameDate: null, lastLocationTeamId: null };
}

/**
 * Rest + travel computed from an already-fetched `CurrentElo` state — no DB
 * call of its own. For a caller building a whole slate (adapter.ts), every
 * team's state is batch-loaded once up front (getCurrentElo is 1-2 queries
 * per team, and a naive per-game `restAndTravelFor` call re-fetches the same
 * team's state a caller had often *just* fetched a moment earlier); this
 * lets that caller reuse the pre-loaded state instead of re-querying.
 */
export function restAndTravelFromState(state: CurrentElo, gameDate: string, todayHomeTeamId: number): { restDays: number; miles: number } {
  return {
    restDays: daysOfRest(state.lastGameDate, gameDate),
    miles: travelMiles(state.lastLocationTeamId, todayHomeTeamId),
  };
}

/** Rest + travel for one team's upcoming game — the live-path counterpart used at prediction time, sourced from Elo history so it works whether the team's last game was this season or last. */
export async function restAndTravelFor(teamId: number, season: number, gameDate: string, todayHomeTeamId: number): Promise<{ restDays: number; miles: number }> {
  return restAndTravelFromState(await getCurrentElo(teamId, season), gameDate, todayHomeTeamId);
}
