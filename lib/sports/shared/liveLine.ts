import type { PickCandidate } from '@/lib/core/types';
import type { PropOddsRow } from '@/lib/db/client';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import { isPickemBook, repriceAtMainLine } from '@/lib/odds/props/mainLine';
import { directionMark } from '@/components/MarketLabel';

/**
 * Whether a line on the live game-state card has HIT — the one rule every
 * sport's builder uses (MLB, football, NBA/NHL), so it cannot drift four ways.
 *
 * An over hits the moment the value passes the line, and nothing later in the
 * game can undo it. An under cannot hit while the game is on: a pitcher at 3
 * strikeouts under 6.5 in the fourth has not won anything yet.
 *
 * R6 AUDIT, 2026-09-16: every builder used `dir === 'O' ? value > line : value
 * <= line`, so an under still below its line was marked cleared — and the card
 * draws cleared as a green row with a check mark, the same as a won over. The
 * operator's spec for that card was "a green highlight if they hit". The live
 * card only exists while the game is on, so an under is never marked here.
 */
export function liveLineHit(direction: 'O' | 'U', value: number, line: number): boolean {
  return direction === 'O' && value > line;
}

/**
 * The line and price each market on the live card is shown at — the main line
 * the page re-prices to (R6-F9), and the best counted price on the candidate's
 * side at it.
 *
 * R6 AUDIT: NFL and CFB each carried an identical copy of this, and NBA and NHL
 * (R6.5) had none — they passed `priceFor: () => null` and measured every
 * market but the open one against the snapshot's stale line. One helper, four
 * callers.
 */
export function liveLinePricing(propOdds: { rows: PropOddsRow[] } | undefined, startIso: string | null) {
  const rowsFor = (c: PickCandidate) => {
    const key = candidateDimensionToMarketKey(c.dimension);
    return key && propOdds ? propOdds.rows.filter((r) => r.subjectId === c.subjectId && r.marketKey === key) : [];
  };
  return {
    lineFor: (c: PickCandidate): number | null => repriceAtMainLine(c, rowsFor(c), startIso).marketLine ?? c.line ?? null,
    priceFor: (c: PickCandidate, at: number): { americanOdds: number; bookmaker: string } | null => {
      const side = directionMark(c.category) === 'U' ? 'under' : 'over';
      const rows = rowsFor(c).filter((r) => r.line === at && r.side === side && !isPickemBook(r.bookmaker));
      const best = rows.length ? rows.reduce((a, b) => (b.americanOdds > a.americanOdds ? b : a)) : null;
      return best ? { americanOdds: best.americanOdds, bookmaker: best.bookmaker } : null;
    },
  };
}
