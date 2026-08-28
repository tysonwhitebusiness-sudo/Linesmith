/**
 * Live price/edge resolution for one candidate against the player-prop odds
 * board — pure functions, no I/O, so both the client (`usePropOdds.ts`'s
 * hook, reading the fetched slate) and server code (pick-locking at surface
 * time, reading `readPropOddsForGame`/`readPropOddsForSubject` directly) can
 * share one implementation instead of two copies of the same de-vig/
 * staleness logic drifting apart. Moved out of `components/usePropOdds.ts`
 * (Prop Score v1) — that file re-exports everything here for its existing
 * client callers, so no import path had to change at any call site.
 */

import type { PickCandidate } from '../../core/types';
import type { PropOddsRow } from '../../db/client';
import { americanToDecimal } from '../display';
import { devigTwoWay } from '../devig';
import { candidateCategoryToSide, candidateDimensionToMarketKey } from './entityResolution';

export type { PropOddsRow };

/** All prices for one subject+market+line, across every provider/book fetched so far. */
export function rowsFor(rows: PropOddsRow[], subjectId: string, marketKey: string, line: number | null): PropOddsRow[] {
  return rows.filter((r) => r.subjectId === subjectId && r.marketKey === marketKey && r.line === line);
}

/** Best (highest payout) American price for a side, and whether it's the user's own book. */
export function bestPrice(rows: PropOddsRow[], side: string): PropOddsRow | null {
  const sided = rows.filter((r) => r.side === side);
  if (sided.length === 0) return null;
  return sided.reduce((best, r) => (r.americanOdds > best.americanOdds ? r : best));
}

export function userBookPrice(rows: PropOddsRow[], side: string, userSportsbook: string): PropOddsRow | null {
  return rows.find((r) => r.side === side && r.bookmaker === userSportsbook) ?? null;
}

export interface CandidateEdgeInfo {
  price: number | null;
  priceSource?: string;
  priceCapturedAt?: string;
  bookmaker?: string;
  bookCount: number;
  /** Raw, vig included — normalising needs both sides, and only one is priced. */
  impliedRaw: number | null;
  edge: number | null;
  modelProb: number | null;
  marketProb: number | null;
}

/**
 * P1-3 — the price/edge resolution ScanTable's row-building already did
 * inline, extracted so the Good Bets filter (AppShell, Game Detail's
 * Candidates panel) can compute the exact same numbers without duplicating
 * the staleness-gated de-vig logic. Phase C.1's edge: model probability
 * (already computed server-side, per candidate, in adapter.ts) against a
 * genuinely de-vigged market price — both sides from the *same* book, not
 * mixed, and not badly stale. A one-sided price (there used to be a vig
 * estimate for this — removed, its numbers weren't verifiable) or a
 * >10-minute-old quote yields no edge rather than an unreliable one.
 */
/**
 * A pre-resolved edge, already computed server-side by predict/
 * generic_prop_production.py (Python worker) at surface time and
 * persisted straight onto `pick_history` — the SAME real de-vig logic
 * this file's own resolveCandidateEdge implements, just already run once
 * against whatever live prop_odds existed when that candidate first
 * surfaced. Attached to `PickCandidate.subjectMeta.pickHistoryEdge`
 * client-side (components/AppShell.tsx) for the five sports whose own
 * adapter.ts never populates a live propRows feed of their own (NFL/CFB/
 * NBA/NHL/Soccer — see AppShell.tsx's needsModelDataMerge). `impliedRaw`
 * is real, disclosed-missing here: it needs the RAW single-book price
 * (present) but this shape only carries the already-devigged edge/
 * marketProb, not which specific book/side pair produced them, so it's
 * left null rather than recomputed from a mismatched pairing.
 */
export interface PreResolvedEdge {
  price: number | null;
  priceSource?: string;
  priceCapturedAt?: string;
  bookmaker?: string;
  edge: number | null;
  marketProb: number | null;
}

export function resolveCandidateEdge(candidate: PickCandidate, propRows: PropOddsRow[], userSportsbook: string): CandidateEdgeInfo {
  const m = (candidate.subjectMeta ?? {}) as Record<string, unknown>;
  const preResolved = m.pickHistoryEdge as PreResolvedEdge | undefined;
  if (preResolved) {
    const decimal = preResolved.price != null ? americanToDecimal(preResolved.price) : undefined;
    return {
      price: preResolved.price,
      priceSource: preResolved.priceSource,
      priceCapturedAt: preResolved.priceCapturedAt,
      bookmaker: preResolved.bookmaker,
      bookCount: preResolved.bookmaker ? 1 : 0,
      impliedRaw: decimal != null ? 1 / decimal : null,
      edge: preResolved.edge,
      modelProb: typeof m.modelProb === 'number' ? m.modelProb : null,
      marketProb: preResolved.marketProb,
    };
  }
  const side = candidateCategoryToSide(candidate.category) === 'under' ? 'under' : 'over';
  const marketKey = candidateDimensionToMarketKey(candidate.dimension);
  const matched = marketKey ? rowsFor(propRows, candidate.subjectId, marketKey, candidate.line ?? null) : [];
  const mine = userBookPrice(matched, side, userSportsbook);
  const chosen = mine ?? bestPrice(matched, side);
  const bookCount = new Set(matched.map((r) => r.bookmaker)).size;

  const legacyPrice = candidate.odds ? Number(String(candidate.odds.americanOdds).replace('+', '')) : null;
  const price = chosen?.americanOdds ?? (Number.isFinite(legacyPrice) ? legacyPrice : null);
  const priceSource = chosen?.providerId ?? candidate.odds?.source;
  const priceCapturedAt = chosen?.fetchedAt ?? candidate.odds?.capturedAt;
  const bookmaker = chosen?.bookmaker;
  const decimal = price != null ? americanToDecimal(price) : undefined;

  const otherSide = side === 'over' ? 'under' : 'over';
  const counterpart = chosen ? matched.find((r) => r.side === otherSide && r.bookmaker === chosen.bookmaker && r.providerId === chosen.providerId) : undefined;
  const rawModelProb = typeof m.modelProb === 'number' ? m.modelProb : null;
  // Two independent ways a quote can be unusable; before Phase 1.2 this checked
  // only the one that never fires.
  //
  // `delaySeconds` is the provider's *advertised feed delay*, written at fetch
  // time from static config — 60 for SharpAPI, ~300 for SportsGameOdds, null
  // for everyone else. Measured across the whole prop_odds table on 2026-08-28:
  // the maximum value present is 60, against a 600 threshold. No row has ever
  // tripped this gate and none can (audit P3 C4). Meanwhile `fetchedAt` — the
  // quantity that actually answers "is this price current" — sat on the row
  // being ignored, while prices 17.5 hours old rendered as live.
  //
  // 30 minutes rather than the 10 the old comment claimed: 10 would mark every
  // non-MLB sport stale by construction, since the generic-sport jobs are
  // gameday-gated at 20-minute intervals. Mirrors _MAX_ROW_AGE_SECONDS in
  // python-odds-service/src/predict/live_edge.py.
  const MAX_ROW_AGE_MS = 30 * 60_000;
  const tooStale = (r: PropOddsRow) => {
    if (r.delaySeconds != null && r.delaySeconds > 600) return true;
    const fetchedMs = r.fetchedAt ? Date.parse(r.fetchedAt) : NaN;
    return Number.isFinite(fetchedMs) && Date.now() - fetchedMs > MAX_ROW_AGE_MS;
  };
  let edge: number | null = null;
  let modelProb: number | null = null;
  let marketProb: number | null = null;
  if (chosen && counterpart && rawModelProb != null) {
    const overRow = side === 'over' ? chosen : counterpart;
    const underRow = side === 'over' ? counterpart : chosen;
    if (!tooStale(overRow) && !tooStale(underRow)) {
      const devigged = devigTwoWay(americanToDecimal(overRow.americanOdds), americanToDecimal(underRow.americanOdds));
      if (devigged) {
        // devigTwoWay returns {a, b} as (over, under) because overRow is passed
        // first. Using `.a` unconditionally — which this did before Phase 1.1 —
        // compared an under candidate against the OVER's market probability,
        // producing the exact negation of the edge on the bet being shown
        // (audit P3 C3). `rawModelProb` is already side-correct: buildCandidate
        // flips it when the category is an under.
        modelProb = rawModelProb;
        marketProb = side === 'over' ? devigged.a : devigged.b;
        edge = modelProb - marketProb;
      }
    }
  }

  return {
    price: price != null && Number.isFinite(price) ? price : null,
    priceSource,
    priceCapturedAt,
    bookmaker,
    bookCount,
    impliedRaw: decimal != null ? 1 / decimal : null,
    edge,
    modelProb,
    marketProb,
  };
}
