/**
 * "Every MLB game should have a recommended pick" (idea #10) — but honestly:
 * a pick only gets shown when it actually clears the Good Bets bar (real
 * edge, a market we trust, a sane price). Most games won't have one right
 * now, since moneyline's own calibration isn't there yet (see
 * /diagnostics — Brier 0.2511, barely better than a coin flip). That's the
 * point: a confident-looking pick backed by an unproven market is worse than
 * no pick at all, so this returns null rather than fabricate one.
 *
 * The Total side is different — deliberately NOT gated the same way, and
 * labeled a "model lean" rather than a "pick," since it isn't held to the
 * same trust bar. It's informational: what the model's own runs projection
 * says relative to the posted line, nothing more.
 */

import { computeMoneylineEdge } from './gameEdge';
import { isGoodBet } from './goodBets';
import { computeTotalModel } from '../sports/mlb/gameModel';
import type { MoneylineResult } from '../sports/mlb/gameModel';

export interface RecommendedMoneylinePick {
  side: 'home' | 'away';
  edge: number;
  modelProb: number;
  marketProb: number;
}

/**
 * Moneyline predictions aren't sample-gated the way a player prop is — each
 * one is backed by a full season of team-form data, not a handful of recent
 * games — so this passes a sample size that always clears
 * GOOD_BET_MIN_SAMPLE_SIZE, leaving edge/trust/price as the real gates.
 */
const MONEYLINE_SAMPLE_SIZE = 30;

export function computeRecommendedMoneylinePick(
  gameModel: MoneylineResult | null | undefined,
  moneyline: { away?: number | null; home?: number | null } | null | undefined,
  trustedMarkets: ReadonlySet<string>,
): RecommendedMoneylinePick | null {
  const edgeInfo = computeMoneylineEdge(gameModel, moneyline);
  if (!edgeInfo) return null;

  const homeQualifies = isGoodBet(
    { edge: edgeInfo.home, marketProb: edgeInfo.homeMarketProb, sampleSize: MONEYLINE_SAMPLE_SIZE, dimension: 'moneyline', priceAmerican: moneyline?.home ?? null },
    trustedMarkets,
  );
  const awayQualifies = isGoodBet(
    { edge: edgeInfo.away, marketProb: edgeInfo.awayMarketProb, sampleSize: MONEYLINE_SAMPLE_SIZE, dimension: 'moneyline', priceAmerican: moneyline?.away ?? null },
    trustedMarkets,
  );

  if (homeQualifies && (!awayQualifies || edgeInfo.home >= edgeInfo.away)) {
    return { side: 'home', edge: edgeInfo.home, modelProb: edgeInfo.homeModelProb, marketProb: edgeInfo.homeMarketProb };
  }
  if (awayQualifies) {
    return { side: 'away', edge: edgeInfo.away, modelProb: edgeInfo.awayModelProb, marketProb: edgeInfo.awayMarketProb };
  }
  return null;
}

export interface TotalLean {
  side: 'over' | 'under';
  expectedTotal: number;
  line: number;
  /** Raw Poisson over-probability (0-1) for the picked side — the same "model's own runs projection" this lean is already built from, via `computeTotalModel`. Not the calibrated/fitted total model (that needs server-only inputs — bullpen ERA, line movement, market blend — unavailable at this call site), just its raw ingredient. */
  probability: number;
}

/** Informational only — see file header. Not gated by isGoodBet. */
export function computeTotalLean(
  gameModel: MoneylineResult | null | undefined,
  total: { point?: number | null } | null | undefined,
): TotalLean | null {
  if (!gameModel || total?.point == null) return null;
  const { expectedTotal, overProb } = computeTotalModel({
    homeExpectedRuns: gameModel.homeExpectedRuns,
    awayExpectedRuns: gameModel.awayExpectedRuns,
    line: total.point,
  });
  const side = expectedTotal > total.point ? 'over' : 'under';
  return { side, expectedTotal, line: total.point, probability: side === 'over' ? overProb : 1 - overProb };
}
