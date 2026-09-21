/**
 * The Slate's "Your lines" section (S5) — the signed-in reader's own lines on
 * TODAY's slate: bets, slip legs, tracked lines and watched players.
 *
 * Pure: no fetching, no hooks. The shell hands in what its hooks already hold
 * (the slip and watchlist from `useSlip`, tracked lines and bets from their
 * routes) plus today's candidates, and this joins them. "Today's slate" means
 * the player has a candidate on it — the same test the props board uses, so a
 * line cannot be in this section and missing from the board.
 *
 * Price now vs price then is two prices side by side and nothing between them:
 * no difference is computed, colored or sorted by.
 */

import type { LiveStatus, PickCandidate } from '../core/types';
import { candidateKey } from '../core/types';
import { easternDate } from '../sports/mlb/statsapi';

export type YourLineKind = 'Bet' | 'Slip' | 'Tracked' | 'Watching';

export interface YourLineRow {
  key: string;
  kind: YourLineKind;
  subjectName: string;
  /** "Hits · Over 1.5", or null for a watched player with no market. */
  market: string | null;
  /** The price when it was added, as the book quoted it. */
  priceThen: string | null;
  /** The best price on the board now, when the market is still quoted. */
  priceNow: string | null;
  /** Game state for open lines; the settled result for a graded bet. */
  status: LiveStatus | 'won' | 'lost' | 'push';
  href: string | null;
}

/** The slice of a slip leg or a bet this needs — both carry it. */
export interface LineLeg {
  id: number;
  sport: string;
  subjectId: string;
  subjectName: string;
  dimension: string;
  dimensionLabel: string;
  category: string;
  categoryLabel: string;
  americanOdds: string | null;
}

export interface BetLeg extends LineLeg {
  status: 'pending' | 'live' | 'won' | 'lost' | 'push';
  submittedAt: string;
}

export interface TrackedLeg {
  id: number;
  subjectId: string;
  subjectName: string;
  statKey: string;
  statLabel: string;
  side: 'over' | 'under';
  line: number;
}

export interface WatchLeg {
  id: number;
  subjectId: string;
  subjectName: string;
}

const sideWord = (s: 'over' | 'under') => (s === 'over' ? 'Over' : 'Under');

export function toYourLines(input: {
  sport: string;
  /** The slate's Eastern day — a bet settled on another day is not today's. */
  date: string;
  candidates: PickCandidate[];
  bets: BetLeg[];
  slip: LineLeg[];
  tracked: TrackedLeg[];
  watchlist: WatchLeg[];
}): YourLineRow[] {
  const byKey = new Map<string, PickCandidate>();
  const bySubject = new Map<string, PickCandidate>();
  for (const c of input.candidates) {
    byKey.set(candidateKey(c), c);
    if (!bySubject.has(c.subjectId)) bySubject.set(c.subjectId, c);
  }
  const onSlate = (subjectId: string) => bySubject.has(subjectId);
  const statusOf = (subjectId: string): LiveStatus => bySubject.get(subjectId)?.liveState?.status ?? 'unknown';
  const legMarket = (l: LineLeg) => `${l.dimensionLabel} · ${l.categoryLabel}`;
  const nowFor = (l: LineLeg) => byKey.get(candidateKey({ sport: l.sport as PickCandidate['sport'], subjectId: l.subjectId, dimension: l.dimension, category: l.category }))?.odds?.americanOdds ?? null;

  const out: YourLineRow[] = [];
  for (const b of input.bets) {
    // Only players on today's slate: a bet on anyone else is history (or a
    // different day's game) and lives on the bets page.
    if (!onSlate(b.subjectId)) continue;
    const open = b.status === 'pending' || b.status === 'live';
    if (!open && easternDate(new Date(b.submittedAt)) !== input.date) continue;
    out.push({
      key: `bet-${b.id}`,
      kind: 'Bet',
      subjectName: b.subjectName,
      market: legMarket(b),
      priceThen: b.americanOdds,
      priceNow: open ? nowFor(b) : null,
      status: open ? statusOf(b.subjectId) : (b.status as 'won' | 'lost' | 'push'),
      href: '/bets',
    });
  }
  for (const l of input.slip) {
    if (!onSlate(l.subjectId)) continue;
    out.push({ key: `slip-${l.id}`, kind: 'Slip', subjectName: l.subjectName, market: legMarket(l), priceThen: l.americanOdds, priceNow: nowFor(l), status: statusOf(l.subjectId), href: null });
  }
  for (const t of input.tracked) {
    if (!onSlate(t.subjectId)) continue;
    // A tracked line records a stat, a side and a number, not a book market,
    // and the candidate's category does not say which side its price is for.
    // So no "now" price here rather than one that might be the other side's.
    out.push({
      key: `tracked-${t.id}`,
      kind: 'Tracked',
      subjectName: t.subjectName,
      market: `${t.statLabel} · ${sideWord(t.side)} ${t.line}`,
      priceThen: null,
      priceNow: null,
      status: statusOf(t.subjectId),
      href: null,
    });
  }
  const listed = new Set(out.map((r) => r.subjectName));
  for (const w of input.watchlist) {
    // A watched player already listed with a line needs no second row.
    if (!onSlate(w.subjectId) || listed.has(w.subjectName)) continue;
    out.push({ key: `watch-${w.id}`, kind: 'Watching', subjectName: w.subjectName, market: null, priceThen: null, priceNow: null, status: statusOf(w.subjectId), href: null });
  }
  return out;
}
