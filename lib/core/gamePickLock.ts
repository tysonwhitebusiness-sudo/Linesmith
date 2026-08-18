/**
 * The Linesmith Pick lock system.
 *
 * Two captures per game per market: an "initial" read taken once the slate
 * opens for the day (intended to be ~6am America/Chicago) and a "final" read
 * frozen 3 hours before first pitch — the pick that actually counts for the
 * record. Once a slot is captured it never moves; `lib/db/client.ts`'s
 * capture functions enforce that with a `WHERE ..._captured_at IS NULL`
 * guard, so calling these on every snapshot refresh (every few minutes) is
 * cheap and safe — most calls are no-ops.
 *
 * This app currently runs only while someone has it open, not as a 24/7
 * server (see the CLAUDE-facing note in gamePickLock's callers) — so both
 * windows are "due" checks evaluated at call time, not a real clock alarm.
 * If the app was closed through 6am or through the 3-hour mark, the next
 * time it's opened this captures a snapshot using whatever the model says
 * *right now* and marks it `late`, rather than silently pretending it ran on
 * time. Once the app runs continuously this same code starts hitting its
 * windows on time and `late` stops firing.
 *
 * Deliberately does not fabricate a pick for a game already in progress or
 * final with no prior capture — a "prediction" made after the outcome is
 * known isn't a prediction. That game simply has no Linesmith Pick on
 * record, which is the honest outcome of the app having been closed all day.
 */

import {
  ensureGamePickRow,
  captureMoneylinePick,
  captureTotalPick,
  getGamePick,
  gradeGamePick,
  type GamePickIdentity,
} from '../db/client';
import { blendProbability, MARKET_BLEND_WEIGHT, ELO_BLEND_WEIGHT } from './probabilityBlend';

const CHICAGO_TZ = 'America/Chicago';
const INITIAL_HOUR_CT = 6;
const LATE_GRACE_MINUTES = 20;
const FINAL_LOCK_HOURS_BEFORE = 3;

function chicagoMinutesOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

function isPastInitialWindow(now: Date): boolean {
  return chicagoMinutesOfDay(now) >= INITIAL_HOUR_CT * 60;
}

function isInitialLate(now: Date): boolean {
  return chicagoMinutesOfDay(now) > INITIAL_HOUR_CT * 60 + LATE_GRACE_MINUTES;
}

function finalLockThresholdMs(commenceTime: string): number {
  return Date.parse(commenceTime) - FINAL_LOCK_HOURS_BEFORE * 60 * 60 * 1000;
}

function isFinalLockDue(commenceTime: string, now: Date): boolean {
  const t = finalLockThresholdMs(commenceTime);
  return Number.isFinite(t) && now.getTime() >= t;
}

function isFinalLockLate(commenceTime: string, now: Date): boolean {
  const t = finalLockThresholdMs(commenceTime);
  return Number.isFinite(t) && now.getTime() > t + LATE_GRACE_MINUTES * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Moneyline
// ---------------------------------------------------------------------------

export interface MoneylineDiagnostics {
  rawLog5HomeWinProb: number;
  homeVenueEdge: number;
  awayVenueEdge: number;
  homeRecentEdge: number;
  awayRecentEdge: number;
  rawHomeRecentEdge: number;
  rawAwayRecentEdge: number;
  parkFactor: number;
}

export interface MoneylineLockInput {
  gameId: string;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  matchup: string;
  commenceTime: string | null;
  isPreGame: boolean;
  homeWinProb: number;
  awayWinProb: number;
  /** Raw ingredients behind homeWinProb — gameModel.ts's MoneylineResult.diagnostics — logged so a later fitting pass can learn real weights instead of trusting the hand-picked ones. */
  diagnostics: MoneylineDiagnostics;
  /** De-vigged market probability the home side will win, when a genuine two-sided price exists at capture time; null otherwise (falls back to pure model, same as always). */
  marketHomeProb: number | null;
  /** Elo's own home-win probability (lib/sports/mlb/eloModel.ts), already gated by the caller for minimum games-played trust; null when not yet trustworthy or unavailable. Deliberately just a plain probability here, not raw ratings — keeps this module sport-agnostic (the "no branching on sport in lib/core" rule), with all Elo-specific computation living in the MLB-specific caller. */
  eloHomeProb: number | null;
  /** 90% confidence interval for the HOME side's win probability, from the fitted regression's own covariance (see gameModel.ts's computeMoneylineConfidenceInterval) — null whenever no fit with a covariance matrix is active (hand-coded-formula fallback has no statistical basis for one). Plain numbers, not raw regression internals, for the same sport-agnostic reason as eloHomeProb above. */
  probLowerHome: number | null;
  probUpperHome: number | null;
}

export function runMoneylineLockCycle(sport: string, games: MoneylineLockInput[], now: Date = new Date()): void {
  for (const g of games) {
    if (!g.commenceTime || !g.isPreGame) continue;
    const identity: GamePickIdentity = {
      sport,
      gameId: g.gameId,
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homeTeamName: g.homeTeamName,
      awayTeamName: g.awayTeamName,
      matchup: g.matchup,
      commenceTime: g.commenceTime,
    };
    ensureGamePickRow(identity);

    // Blend on the home probability directly, then re-derive the side from
    // the BLENDED number — not the model's own side first. Blending can flip
    // which side is actually favored (model 51% home, market 40% home →
    // blended favorite is away), and deciding the side before blending would
    // silently ignore that. Sequential composition: market blends into the
    // model first, then Elo nudges the market-informed number at a smaller
    // weight — see probabilityBlend.ts for why it's sequential rather than a
    // single 3-way weighted average.
    const afterMarketProb = blendProbability(g.homeWinProb, g.marketHomeProb, MARKET_BLEND_WEIGHT);
    const blendedHomeProb = blendProbability(afterMarketProb, g.eloHomeProb, ELO_BLEND_WEIGHT);
    const side: 'home' | 'away' = blendedHomeProb >= 0.5 ? 'home' : 'away';
    const prob = side === 'home' ? blendedHomeProb : 1 - blendedHomeProb;

    // The interval is only meaningful as-is when it's the fit's own direct
    // output (fitted active, nothing further blended on top of it — see
    // route.ts, which nulls out marketHomeProb/eloHomeProb once a fit is
    // folded in). Flip to the picked side the same way `prob` above does:
    // away's bounds are 1 minus home's, with lower/upper swapping.
    const probLower = g.probLowerHome == null ? null : side === 'home' ? g.probLowerHome : 1 - g.probUpperHome!;
    const probUpper = g.probUpperHome == null ? null : side === 'home' ? g.probUpperHome : 1 - g.probLowerHome!;

    const featuresJson = JSON.stringify({
      rawLog5HomeWinProb: g.diagnostics.rawLog5HomeWinProb,
      homeVenueEdge: g.diagnostics.homeVenueEdge,
      awayVenueEdge: g.diagnostics.awayVenueEdge,
      homeRecentEdge: g.diagnostics.homeRecentEdge,
      awayRecentEdge: g.diagnostics.awayRecentEdge,
      parkFactor: g.diagnostics.parkFactor,
      modelHomeProb: g.homeWinProb,
      marketHomeProb: g.marketHomeProb,
      marketBlendWeight: g.marketHomeProb != null ? MARKET_BLEND_WEIGHT : null,
      afterMarketProb,
      eloHomeProb: g.eloHomeProb,
      eloBlendWeight: g.eloHomeProb != null ? ELO_BLEND_WEIGHT : null,
      blendedHomeProb,
      probLowerHome: g.probLowerHome,
      probUpperHome: g.probUpperHome,
    });

    if (isPastInitialWindow(now)) {
      captureMoneylinePick({ sport, gameId: g.gameId, slot: 'initial', side, prob, late: isInitialLate(now), featuresJson, probLower, probUpper });
    }
    if (isFinalLockDue(g.commenceTime, now)) {
      captureMoneylinePick({ sport, gameId: g.gameId, slot: 'final', side, prob, late: isFinalLockLate(g.commenceTime, now), featuresJson, probLower, probUpper });
    }
  }
}

// ---------------------------------------------------------------------------
// Total (O/U)
// ---------------------------------------------------------------------------

export interface TotalLockInput {
  gameId: string;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  matchup: string;
  commenceTime: string | null;
  isPreGame: boolean;
  line: number;
  overProb: number;
  /** De-vigged market probability of the Over, when a genuine two-sided price exists; null otherwise. Null (rather than a real price) whenever a fitted total model is active and has already folded the market in as one of its own features — see route.ts. */
  marketOverProb: number | null;
  /** 90% confidence interval for the OVER probability, from the fitted total model's own covariance (gameModel.ts's computeTotalConfidenceInterval) — null whenever no fit with a covariance matrix is active. */
  probLowerOver: number | null;
  probUpperOver: number | null;
}

export function runTotalLockCycle(sport: string, games: TotalLockInput[], now: Date = new Date()): void {
  for (const g of games) {
    if (!g.commenceTime || !g.isPreGame) continue;
    ensureGamePickRow({
      sport,
      gameId: g.gameId,
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homeTeamName: g.homeTeamName,
      awayTeamName: g.awayTeamName,
      matchup: g.matchup,
      commenceTime: g.commenceTime,
    });

    const blendedOverProb = blendProbability(g.overProb, g.marketOverProb);
    const side: 'over' | 'under' = blendedOverProb >= 0.5 ? 'over' : 'under';
    const prob = side === 'over' ? blendedOverProb : 1 - blendedOverProb;

    // Same side-flip convention as the moneyline interval above — only
    // meaningful as-is when it's the fit's own direct output (see route.ts,
    // which nulls out marketOverProb once a fit is folded in, so no further
    // blending happens on top of it here).
    const probLower = g.probLowerOver == null ? null : side === 'over' ? g.probLowerOver : 1 - g.probUpperOver!;
    const probUpper = g.probUpperOver == null ? null : side === 'over' ? g.probUpperOver : 1 - g.probLowerOver!;

    const featuresJson = JSON.stringify({
      modelOverProb: g.overProb,
      marketOverProb: g.marketOverProb,
      blendWeight: g.marketOverProb != null ? MARKET_BLEND_WEIGHT : null,
      blendedOverProb,
      line: g.line,
      probLowerOver: g.probLowerOver,
      probUpperOver: g.probUpperOver,
    });

    if (isPastInitialWindow(now)) {
      captureTotalPick({ sport, gameId: g.gameId, slot: 'initial', side, prob, line: g.line, late: isInitialLate(now), featuresJson, probLower, probUpper });
    }
    if (isFinalLockDue(g.commenceTime, now)) {
      captureTotalPick({ sport, gameId: g.gameId, slot: 'final', side, prob, line: g.line, late: isFinalLockLate(g.commenceTime, now), featuresJson, probLower, probUpper });
    }
  }
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export interface FinishedGameInput {
  gameId: string;
  isFinal: boolean;
  homeScore: number | null;
  awayScore: number | null;
}

/** Grades against the locked (final) pick, falling back to the initial one if a final lock never happened. */
export function gradeFinishedGamePicks(sport: string, games: FinishedGameInput[]): void {
  for (const g of games) {
    if (!g.isFinal || g.homeScore == null || g.awayScore == null || g.homeScore === g.awayScore) continue;
    const row = getGamePick(sport, g.gameId);
    if (!row || row.gradedAt) continue;

    const mlSide = row.mlFinalSide ?? row.mlInitialSide;
    const totalSide = row.totalFinalSide ?? row.totalInitialSide;
    const totalLine = row.totalFinalLine ?? row.totalInitialLine;

    let mlOutcome: 'win' | 'loss' | null = null;
    if (mlSide) {
      const winner: 'home' | 'away' = g.homeScore > g.awayScore ? 'home' : 'away';
      mlOutcome = mlSide === winner ? 'win' : 'loss';
    }

    let totalOutcome: 'win' | 'loss' | null = null;
    const total = g.homeScore + g.awayScore;
    if (totalSide && totalLine != null && total !== totalLine) {
      const actual: 'over' | 'under' = total > totalLine ? 'over' : 'under';
      totalOutcome = totalSide === actual ? 'win' : 'loss';
    }

    if (mlOutcome || totalOutcome) {
      gradeGamePick({ sport, gameId: g.gameId, homeScore: g.homeScore, awayScore: g.awayScore, mlOutcome, totalOutcome });
    }
  }
}
