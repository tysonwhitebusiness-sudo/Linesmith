/**
 * A slip leg's price check (odds build P12 §2). Pure: from the leg's market
 * (the player's `/api/odds/player` payload) — the best price right now at the
 * leg's line and side, when it was checked, and how many cents the reader's
 * book is worse. The best is the Best price card's own rule (`boardRows` +
 * `bestPrice`): pick'em apps, off-line quotes and D19 outliers never count, so
 * the slip and the player page cannot name different "best" books. Two prices
 * side by side and their gap in cents: no model, no probability.
 */
import { boardRows, bestPrice, decimal } from './section/board';
import { marketSpec, type OddsMarket, type OddsQuote } from './section/types';

export interface SlipBest {
  best: OddsQuote | null;
  mine: OddsQuote | null;
  /** Cents (decimal x 100) the reader's book is below the best; null when it is the best or absent. */
  centsWorse: number | null;
}

export function slipBest(market: OddsMarket | null | undefined, side: 'over' | 'under', line: number | null, userBook: string | null): SlipBest {
  if (!market) return { best: null, mine: null, centsWorse: null };
  const rows = boardRows(market, marketSpec('prop'), line, userBook);
  const i = side === 'over' ? 0 : 1;
  const best = bestPrice(rows, i)?.quote ?? null;
  const row = userBook ? rows.find(r => r.book === userBook && r.at) : undefined;
  const mine = (row ? (i === 0 ? row.qa : row.qb) : null) ?? null;
  const cents = best && mine && best.book !== mine.book ? Math.round((decimal(best.price) - decimal(mine.price)) * 100) : null;
  return { best, mine, centsWorse: cents && cents > 0 ? cents : null };
}

/** A stored book link, only when it is an http(s) URL (never a guessed one). */
export function bookLinkFor(links: Record<string, string> | undefined, book: string | null | undefined): string | null {
  const url = book ? links?.[book] : undefined;
  return url && /^https?:\/\//i.test(url) ? url : null;
}
