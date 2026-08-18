/**
 * Prop Score v1 — Market Trust badge, kept deliberately SEPARATE from the
 * Signal Score itself (see propScore.ts's file comment for why an earlier
 * design that multiplied a market-trust term into the score was wrong: it
 * mathematically capped or zeroed the score for any market with a bad live
 * BSS, silently punishing an individual strong prop for its market's still-
 * thin track record). This file only answers "how much should you weigh any
 * score from this market at all" — a question about the market, not the pick.
 *
 * Live Brier Skill Score, not raw Brier: `BSS = 1 - (live_brier /
 * naive_brier)`, `naive_brier = p̄(1-p̄)` from that dimension's own live win
 * rate. Fair across rare-event (home runs, ~12% base rate) and common
 * (walks, ~50%) markets alike, unlike comparing raw Brier scores directly —
 * a market can look "well-calibrated" on raw Brier alone just by sitting at
 * a low base rate, regardless of actual skill. See lib/db/client.ts's
 * `liveMarketSkill`, which computes this from non-backfill `pick_history`
 * rows only (the historical backfill used a different, simpler formula and
 * would misrepresent the live model's own performance if blended in).
 */

export type MarketTrust = 'proven' | 'weak' | 'building' | 'excluded';

export const MARKET_TRUST_LABEL: Record<MarketTrust, string> = {
  proven: 'Proven',
  weak: 'Weak',
  building: 'Building Track Record',
  excluded: 'Excluded',
};

/** Below this many live-graded rows, a BSS estimate is noise, not evidence — same instinct as goodBets.ts's TRUST_MIN_GRADED_SAMPLE, tuned for this narrower live-only (non-backfill) pool. */
export const TRUST_MIN_LIVE_SAMPLE = 50;
/** A market whose live model shows this much real skill over its own naive baseline earns Proven. */
export const TRUST_PROVEN_BSS = 0.02;
/** A market whose live BSS is this far *below* naive earns a hard Excluded — no score shown at all, not just a low one. */
export const TRUST_EXCLUDED_BSS = -0.08;

/**
 * `n < TRUST_MIN_LIVE_SAMPLE` → `building`, regardless of what the (noisy)
 * BSS number happens to say — most prop dimensions are here today, and
 * that's an honest "not enough evidence yet," not a downgrade. Only once a
 * dimension has enough live-graded rows to say something real does its BSS
 * sign/magnitude decide `proven` / `weak` / `excluded`.
 */
export function trustTierFromLiveBSS(bss: number | null, n: number): MarketTrust {
  if (bss == null || n < TRUST_MIN_LIVE_SAMPLE) return 'building';
  if (bss <= TRUST_EXCLUDED_BSS) return 'excluded';
  if (bss >= TRUST_PROVEN_BSS) return 'proven';
  return 'weak';
}
