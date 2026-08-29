/**
 * The Good Bets engine — one scoring function, reused everywhere a "is this
 * actually worth surfacing" decision needs to be made: Scan's Good Bets tab,
 * Game Detail's Candidates panel, the per-game Recommended Pick badge, and
 * the retroactive record tracker over `pick_history`. Building this once and
 * reusing it is the whole point — three separate implementations would drift
 * out of sync the first time a threshold changes.
 *
 * v2: v1 gated on edge alone, which meant a player on a real cold streak
 * could still qualify as long as his *season-long* rate beat the market
 * price. v2 made it a single consensus gate requiring edge, recent form,
 * streak, H2H, and season rate to ALL pass.
 *
 * v3: edge dropped from a hard requirement to a light sanity check, once a
 * live audit found only ~1 in 8 subject/market/line combos have a genuine
 * two-sided price at all — `resolveCandidateEdge` started estimating a fair
 * probability from a one-sided price to close that gap.
 *
 * v4: the v3 estimate turned out to cluster almost every thin/longshot-priced
 * candidate at exactly the same capped value, which isn't "these are all
 * equally good" — it's the estimate hitting its ceiling on a price that was
 * never reliable, dressed up as a real number. Rather than trust one blended
 * signal, this became three independent tracks; a candidate qualifies by
 * clearing ANY ONE of them (not all — that was v2's mistake in the other
 * direction): `edge`, `recent`, `matchup`.
 *
 * v5: the one-sided estimate itself is gone — see lib/odds/devig.ts's file
 * comment. `edge`/`marketProb` are simply null now when a genuine two-sided
 * price doesn't exist, so the `edge` track only ever sees verifiable numbers.
 * Edge's own recency-blindness got a separate fix at the source instead —
 * `lib/odds/props/edgeModel.ts`'s Beta-Binomial posterior now up-weights the
 * trailing L10 games rather than treating the whole season as one flat count,
 * so `edge` itself carries some recent-performance signal, not just season
 * average vs. price.
 *
 * v6: `recent` renamed `performance` and rebuilt as flat, explicit, user-set
 * bars — any ONE of a recent-form ladder, strong H2H, strong season rate, or
 * a real hot streak, rather than v2's four-required consensus.
 *
 * v7: rare-event markets (home runs, triples, stolen bases, doubles —
 * league rates roughly 2-15%) get their own, lower `performance` thresholds
 * instead of being structurally unable to clear the common-market bars.
 * `performance`, `edge`, `matchup` is the priority order everywhere it
 * matters — the order `goodBetReasons` pushes into the returned array, and
 * the sort rank ScanTable's Reason column uses.
 *
 * v8: a *missing* price no longer excludes a candidate —
 * only a *known* price worse than -300 does. Twenty-five candidates isn't
 * an overwhelming list, and most of the ones a missing price was quietly
 * dropping simply had no posted line in today's feed for that specific
 * market at all (confirmed live for several — no data, not a bad price).
 * The caller is responsible for surfacing that gap visibly (ScanTable's
 * Odds column: "No Odds — Check Book") rather than this function silently
 * excluding on a ceiling it never actually got to check.
 *
 * v9: `performanceMatchDetails` now tags each match with which ScanTable
 * column it came from (`PerformanceColumn`), so the table can highlight the
 * exact cell doing the work — a rare-event L15 of 40% reads as cold next to
 * a 70%-bar market's L15 unless something marks it as the one that actually
 * cleared its own, lower bar.
 *
 * v10: the live surface no longer requires full `isMarketTrusted` status —
 * most untrusted markets simply haven't accumulated enough graded history to
 * *earn* trust yet, which isn't the same as being bad. `isMarketAllowedForGoodBets`
 * only blocks markets with enough graded volume to show they're genuinely
 * worse than a coin flip (`GOOD_BET_EXCLUDED_MARKETS`). The retroactive
 * win/loss record keeps the stricter `isMarketTrusted` line — a record only
 * means something graded against a bar that didn't move.
 *
 * v11 (this revision): `matchup` demoted from a fourth independent track to
 * a rider on the other two — a favorable matchup by itself was too thin a
 * signal to surface a candidate on its own, so it now only appears in
 * `goodBetReasons`' output once `performance` or `edge` has already
 * qualified the candidate.
 */

import { subsetWindow, windowSet, type WindowedStat } from '../core/windowedStat';
import type { PickCandidate } from '../core/types';

/**
 * The Good Bets *record* (the win/loss tracker, not the Scan tab) is scoped
 * to game-level picks only — moneyline and total. Player props aren't
 * something this app "picks": Scan hands over the data (edge, form, matchup)
 * and the user decides, so crediting/blaming a record against them doesn't
 * match what's actually being offered. A real per-prop pick record belongs
 * to a future recommended-parlays/props-picks feature, not this one.
 */
export const GAME_LEVEL_DIMENSIONS = ['moneyline', 'total'];

/**
 * Task 4.9 (P3 H8) — ONE threshold used to be applied to TWO incompatible
 * quantities that shared the `edge` column:
 *
 *   model_vs_market  model_prob - devig(one book's two-sided price)
 *                    "how far our model is from a book" — a DISAGREEMENT
 *   sharp_vs_soft    sharp_devigged(side) - raw_implied(bettable book)
 *                    "how much better a sharp fair price is than what you'd
 *                    pay" — EXPECTED VALUE, in probability units
 *
 * 0.03 does not mean the same thing in both. A 3-point model disagreement is
 * commonplace and mostly says the model is opinionated; a 3-point sharp-vs-soft
 * edge is a real, rare, bettable +EV gap. Holding them to the same bar either
 * floods the list with the first or suppresses the second.
 *
 * Each therefore gets its own bar, and `GOOD_BET_MIN_EDGE` is retained as the
 * model-vs-market value so existing readers keep their current behaviour
 * unchanged rather than silently shifting under them.
 */
export const GOOD_BET_MIN_EDGE = 0.03;
/** Bar for the DISAGREEMENT quantity. Same 0.03 as before — unchanged behaviour. */
export const GOOD_BET_MIN_EDGE_MODEL_VS_MARKET = 0.03;
/**
 * Bar for the EXPECTED-VALUE quantity. Deliberately higher: this one is real
 * +EV against a sharp reference, and 2 points of it is worth more than 3 points
 * of model disagreement. Set at 0.02 rather than tuned — there is not yet
 * enough sharp-vs-soft history to fit it (task 4.1: sharp coverage is 9.08%,
 * and edge_sharp_vs_soft is populated on 0 rows today), so this is an explicit
 * placeholder to be fitted once that sample exists, not a derived number.
 */
export const GOOD_BET_MIN_EDGE_SHARP_VS_SOFT = 0.02;
export const GOOD_BET_MIN_SAMPLE_SIZE = 6;
/** American odds — a favorite priced worse (more negative) than this fails the price ceiling. Underdogs (positive odds) always pass. */
export const GOOD_BET_MAX_FAVORITE_PRICE = -300;
/**
 * De-vigged-probability proxy for the same -300 ceiling, used only when the
 * raw price isn't available (the retroactive record tracker, which doesn't
 * have `pick_history`'s stored price — only its de-vigged market_prob).
 * A -300 favorite's *raw* implied probability is exactly 0.75, but de-vigging
 * pulls that down (typical vig redistributes it toward ~0.72-0.73) — this is
 * deliberately set at the lower end so the proxy stays conservative rather
 * than letting slightly-worse-than-300 favorites slip through.
 */
export const GOOD_BET_MAX_MARKET_PROB_PROXY = 0.72;

/** A market's own calibration has to clear this bar before any edge computed against it counts for anything. */
export const TRUST_MIN_GRADED_SAMPLE = 30;
export const TRUST_MAX_BRIER = 0.24;

interface PerformanceThresholds {
  l15: number;
  l10: number;
  l5: number;
  h2hRate: number;
  h2hMinSample: number;
  season: number;
  hotStreak: number;
}

const PERFORMANCE_THRESHOLDS: PerformanceThresholds = {
  l15: 0.7,
  l10: 0.8,
  l5: 1,
  h2hRate: 0.75,
  h2hMinSample: 4, // "more than 4" — 5+ games
  season: 0.65,
  hotStreak: 5,
};

/**
 * Rare-event markets (home runs, triples, stolen bases, doubles) run at
 * roughly 2-15% league-wide — hitting 65%+ of games, or a 5-game hot streak,
 * simply isn't how those markets behave for anyone, so the flat thresholds
 * above left them structurally unable to ever earn `performance`. These are
 * set relative to how those markets actually run: a real, multiples-of-
 * baseline hot stretch, not the same bar as an everyday market like walks.
 */
const RARE_EVENT_PERFORMANCE_THRESHOLDS: PerformanceThresholds = {
  l15: 0.35,
  l10: 0.4,
  l5: 0.6,
  h2hRate: 0.4,
  h2hMinSample: 4,
  season: 0.25,
  hotStreak: 2,
};

const RARE_EVENT_DIMENSIONS = new Set(['home-runs', 'triples', 'stolen-bases', 'doubles']);

function thresholdsFor(dimension: string): PerformanceThresholds {
  return RARE_EVENT_DIMENSIONS.has(dimension) ? RARE_EVENT_PERFORMANCE_THRESHOLDS : PERFORMANCE_THRESHOLDS;
}

/** `performance`, `edge`, `matchup` — priority order, both for the array `goodBetReasons` returns and for sorting by it. */
export const GOOD_BET_REASONS = ['performance', 'edge', 'matchup'] as const;
export type GoodBetReason = (typeof GOOD_BET_REASONS)[number];

export interface GoodBetInput {
  edge: number | null;
  /**
   * Which quantity `edge` is carrying (task 4.9, P3 H8). 'model_vs_market' is
   * the model-disagreement measure; a sharp reference tier
   * ('pinnacle'/'circa'/'novig'/'kalshi'/'consensus') means the
   * expected-value one. Optional and defaulting to the model-vs-market bar,
   * because 368k historical rows predate the split and cannot be attributed —
   * treating them as the stricter EV quantity would silently reclassify them.
   */
  edgeSource?: string | null;
  marketProb: number | null;
  sampleSize: number;
  dimension: string;
  /** Raw American odds for the side under consideration, when known — gives an exact price-ceiling check. Omit to fall back to the marketProb proxy. */
  priceAmerican?: number | null;
  /**
   * `performance`-track signals — all optional. Omitting one just means that
   * particular check can't pass, not that the whole track fails; a call site
   * without real windowed history (currently: the moneyline Recommended Pick
   * badge, which isn't built from a PickCandidate) still gets the edge/
   * trust/price gate. Every candidate-backed call site should supply these
   * via `candidateGoodBetSignals` below.
   */
  l5?: WindowedStat;
  l10?: WindowedStat;
  l15?: WindowedStat;
  szn?: WindowedStat;
  streak?: number;
  h2h?: WindowedStat;
  /** Opponent-difficulty signal already computed for the Bayesian prior shift (adapter.ts's `matchupSplit`) — the `matchup` track's only input. */
  matchupFavorable?: boolean | null;
}

/** A market is trusted once it has enough graded history and its Brier score is meaningfully better than the naive 0.25 (coin-flip) baseline. */
export function isMarketTrusted(brierScore: number | null | undefined, gradedCount: number): boolean {
  return brierScore != null && gradedCount >= TRUST_MIN_GRADED_SAMPLE && brierScore < TRUST_MAX_BRIER;
}

/**
 * Dimensions kept out of live Good Bets even under the looser
 * `isMarketAllowedForGoodBets` bar below — not just "not yet proven,"
 * but demonstrably worse than a coin flip, with enough graded volume that
 * it isn't sampling noise. Snapshot as of 2026-08-13's calibration:
 * total (Brier 0.271, n=31,667 — by far the largest sample in the table,
 * so this one's the least likely to be noise), earned-runs (0.269, n=455),
 * pitcher-hits-allowed (0.267, n=453). Revisit this list as calibration moves.
 */
export const GOOD_BET_EXCLUDED_MARKETS = new Set(['total', 'earned-runs', 'pitcher-hits-allowed']);

/**
 * Looser bar than `isMarketTrusted` — used only to decide which markets are
 * allowed to power the *live* Good Bets surface, not the retroactive
 * win/loss record (which still holds `isMarketTrusted`'s stricter line).
 * A market with enough graded history that hasn't earned full trust yet is
 * still shown; a market that's actively bad (`GOOD_BET_EXCLUDED_MARKETS`) or
 * has too little graded history to say anything at all is not.
 */
export function isMarketAllowedForGoodBets(dimension: string, gradedCount: number): boolean {
  return gradedCount >= TRUST_MIN_GRADED_SAMPLE && !GOOD_BET_EXCLUDED_MARKETS.has(dimension);
}

/**
 * A *known* price worse than -300 excludes — that's the whole point of the
 * ceiling. But no price at all is a data gap, not a bad price, so it no
 * longer excludes by default; the caller is expected to show that gap
 * plainly (ScanTable's Odds column: "No Odds — Check Book") rather than have
 * this function quietly drop the candidate for something it can't actually
 * confirm is a problem.
 */
function passesPriceCeiling(input: GoodBetInput): boolean {
  if (input.priceAmerican != null) return input.priceAmerican >= GOOD_BET_MAX_FAVORITE_PRICE;
  if (input.marketProb != null) return input.marketProb <= GOOD_BET_MAX_MARKET_PROB_PROXY;
  return true; // no price signal at all — can't be excluded for a ceiling that can't be checked.
}

/**
 * Foundational sanity check, not the `edge` track — refuses a *known*
 * negative edge, where the model actively disagrees with the price, but an
 * unknown edge (no genuine two-sided price to compute one from) doesn't
 * count against a candidate. This runs for every track; only the `edge`
 * track additionally requires a real, positive, ≥3% number.
 */
function passesEdge(input: GoodBetInput): boolean {
  if (input.edge == null) return true;
  return input.edge >= 0;
}

/** `edge` track — a genuine two-sided de-vig clearing the minimum edge. `input.edge` is only ever set from real market math (see the file comment), so no extra check is needed here.
 *
 * Task 4.9: the bar depends on WHICH quantity `edge` is carrying, which
 * `edgeSource` identifies. 'model_vs_market' is a disagreement measure;
 * anything else (a sharp reference tier — pinnacle/circa/novig/kalshi, or
 * 'consensus') is the expected-value quantity. Absent an edgeSource the row
 * predates the split, and the old bar is the honest default for it. */
function qualifiesByEdge(input: GoodBetInput): boolean {
  if (input.edge == null) return false;
  const threshold =
    input.edgeSource == null || input.edgeSource === 'model_vs_market'
      ? GOOD_BET_MIN_EDGE_MODEL_VS_MARKET
      : GOOD_BET_MIN_EDGE_SHARP_VS_SOFT;
  return input.edge >= threshold;
}

/** Which of ScanTable's own columns this criterion reads from — lets the table highlight the exact cell doing the work instead of leaving it to be inferred from the pill text. */
export type PerformanceColumn = 'l15' | 'l10' | 'l5' | 'h2h' | 'szn' | 'strk';

export interface PerformanceMatch {
  column: PerformanceColumn;
  /** Compact form for the Reason pill itself, e.g. "L15 40%" — always visible, not just on hover. */
  short: string;
  /** Full form including the threshold that was cleared, e.g. "L15 40% (>35%)" — the pill's tooltip. */
  long: string;
  /**
   * How far past its own threshold this criterion cleared, normalized to
   * [0, 1] — `(rate - threshold) / (1 - threshold)` for rate-based tracks,
   * `(streak - hotStreakBar) / hotStreakBar` for the streak track. Lets a
   * consumer (Prop Score's `P` component) grade *how much* a track cleared
   * by, not just whether it did — a clean 15-point L15 margin is stronger
   * corroboration than a 1-point one, even though `goodBetReasons` treats
   * both as an equal pass. Purely additive: existing Reason-pill consumers
   * only read `column`/`short`/`long` and are unaffected.
   */
  margin: number;
}

/**
 * Every `performance` sub-criterion this candidate actually clears — empty
 * when none do. Used both to decide whether the `performance` track
 * qualifies (`.length > 0`) and to show *which* criterion is doing the work
 * in the UI, since "performance" alone doesn't say whether it's real recent
 * form or just a strong season number carrying a currently-cold player —
 * e.g. a rare-event candidate can clear a 35%-L15 bar while every other
 * column on the row (streak, H2H, season) looks cold, because rare-event
 * markets get their own lower bars (see the file comment above).
 */
export function performanceMatchDetails(input: GoodBetInput): PerformanceMatch[] {
  const t = thresholdsFor(input.dimension);
  const matches: PerformanceMatch[] = [];
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  // Rate-based margin: how far past the threshold, rescaled so "just barely
  // cleared" reads near 0 and "cleared with the maximum possible rate (100%)"
  // reads 1 — clamped since a rate can't literally exceed 1.
  // `l5`'s threshold is exactly 1 (100%) — the only way to clear it is a
  // rate that's also exactly 1, which makes the denominator below 0/0 (NaN)
  // rather than merely small. There's no headroom above 100% to measure a
  // margin against, so "cleared a threshold with no room above it" is
  // definitionally the maximum margin, not an undefined one.
  const rateMargin = (rate: number, threshold: number) => {
    if (threshold >= 1) return rate >= threshold ? 1 : 0;
    return Math.min(1, Math.max(0, (rate - threshold) / (1 - threshold)));
  };

  if (input.l15?.status === 'ok' && input.l15.rate > t.l15) {
    matches.push({ column: 'l15', short: `L15 ${pct(input.l15.rate)}`, long: `L15 ${pct(input.l15.rate)} (>${pct(t.l15)})`, margin: rateMargin(input.l15.rate, t.l15) });
  }
  if (input.l10?.status === 'ok' && input.l10.rate > t.l10) {
    matches.push({ column: 'l10', short: `L10 ${pct(input.l10.rate)}`, long: `L10 ${pct(input.l10.rate)} (>${pct(t.l10)})`, margin: rateMargin(input.l10.rate, t.l10) });
  }
  if (input.l5?.status === 'ok' && input.l5.rate >= t.l5) {
    matches.push({ column: 'l5', short: `L5 ${pct(input.l5.rate)}`, long: `L5 ${pct(input.l5.rate)} (≥${pct(t.l5)})`, margin: rateMargin(input.l5.rate, t.l5) });
  }
  if (input.h2h?.status === 'ok' && input.h2h.total > t.h2hMinSample && input.h2h.rate > t.h2hRate) {
    matches.push({
      column: 'h2h',
      short: `H2H ${pct(input.h2h.rate)}`,
      long: `H2H ${pct(input.h2h.rate)} over ${input.h2h.total} games (>${pct(t.h2hRate)})`,
      margin: rateMargin(input.h2h.rate, t.h2hRate),
    });
  }
  if (input.szn?.status === 'ok' && input.szn.rate > t.season) {
    matches.push({ column: 'szn', short: `SZN ${pct(input.szn.rate)}`, long: `Season ${pct(input.szn.rate)} (>${pct(t.season)})`, margin: rateMargin(input.szn.rate, t.season) });
  }
  if (input.streak != null && input.streak >= t.hotStreak) {
    const streakMargin = Math.min(1, Math.max(0, (input.streak - t.hotStreak) / t.hotStreak));
    matches.push({ column: 'strk', short: `Strk +${input.streak}`, long: `${input.streak}-game hot streak (≥${t.hotStreak})`, margin: streakMargin });
  }

  return matches;
}

/** `performance` track — any ONE sub-criterion clearing is enough. */
function qualifiesByPerformance(input: GoodBetInput): boolean {
  return performanceMatchDetails(input).length > 0;
}

/** `matchup` track — the opponent-difficulty signal is favorable on its own. */
function qualifiesByMatchup(input: GoodBetInput): boolean {
  return input.matchupFavorable === true;
}

/**
 * Every reason this candidate qualifies as a good bet, in priority order
 * (`performance`, `edge`, `matchup`) — empty when it doesn't qualify at all.
 * `trustedMarkets` is the set of dimension keys whose calibration currently
 * passes `isMarketTrusted` — computed once per session from
 * `/api/props/calibration`'s `byMarket`, not recomputed here, since this
 * function has to stay a pure, cheap, per-row check.
 */
export function goodBetReasons(input: GoodBetInput, trustedMarkets: ReadonlySet<string>): GoodBetReason[] {
  if (!passesEdge(input)) return [];
  if (input.sampleSize < GOOD_BET_MIN_SAMPLE_SIZE) return [];
  if (!trustedMarkets.has(input.dimension)) return [];
  if (!passesPriceCeiling(input)) return [];

  const reasons: GoodBetReason[] = [];
  if (qualifiesByPerformance(input)) reasons.push('performance');
  if (qualifiesByEdge(input)) reasons.push('edge');
  // Matchup is corroborating, not load-bearing — a favorable matchup alone
  // (with nothing else behind it) isn't enough to qualify a candidate, so it
  // only ever rides along once performance or edge has already qualified it.
  if (reasons.length > 0 && qualifiesByMatchup(input)) reasons.push('matchup');
  return reasons;
}

export function isGoodBet(input: GoodBetInput, trustedMarkets: ReadonlySet<string>): boolean {
  return goodBetReasons(input, trustedMarkets).length > 0;
}

export interface CandidateGoodBetSignals {
  l5: WindowedStat;
  l10: WindowedStat;
  l15: WindowedStat;
  szn: WindowedStat;
  streak: number;
  h2h: WindowedStat;
  matchupFavorable: boolean | null;
}

/**
 * The windowed-stat side of `GoodBetInput`, computed straight from a
 * candidate's own history — the same computation ScanTable's row-building
 * already did for its L5/L10/L15/H2H/Strk/SZN columns, extracted so every
 * `isGoodBet`/`goodBetReasons` call site reads the exact numbers the table
 * shows rather than a second, possibly-drifted copy of the same logic.
 */
export function candidateGoodBetSignals(candidate: PickCandidate): CandidateGoodBetSignals {
  const windows = windowSet(candidate.history, candidate.category);
  const m = (candidate.subjectMeta ?? {}) as Record<string, unknown>;
  const opponentId = m.opponentId;
  const h2h = subsetWindow(
    candidate.history,
    candidate.category,
    (entry) => {
      const raw = entry.raw as { opponentId?: number } | null;
      return raw?.opponentId != null && opponentId != null && raw.opponentId === Number(opponentId);
    },
    { minimum: 1 },
  );
  return {
    l5: windows.l5,
    l10: windows.l10,
    l15: windows.l15,
    szn: windows.szn,
    streak: windows.streak,
    h2h,
    matchupFavorable: typeof m.matchupFavorable === 'boolean' ? m.matchupFavorable : null,
  };
}
