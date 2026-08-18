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
export function resolveCandidateEdge(candidate: PickCandidate, propRows: PropOddsRow[], userSportsbook: string): CandidateEdgeInfo {
  const m = (candidate.subjectMeta ?? {}) as Record<string, unknown>;
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
  const tooStale = (r: PropOddsRow) => r.delaySeconds != null && r.delaySeconds > 600;
  let edge: number | null = null;
  let modelProb: number | null = null;
  let marketProb: number | null = null;
  if (chosen && counterpart && rawModelProb != null) {
    const overRow = side === 'over' ? chosen : counterpart;
    const underRow = side === 'over' ? counterpart : chosen;
    if (!tooStale(overRow) && !tooStale(underRow)) {
      const devigged = devigTwoWay(americanToDecimal(overRow.americanOdds), americanToDecimal(underRow.americanOdds));
      if (devigged) {
        modelProb = rawModelProb;
        marketProb = devigged.a;
        edge = rawModelProb - devigged.a;
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
