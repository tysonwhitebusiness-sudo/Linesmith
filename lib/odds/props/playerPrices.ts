/**
 * Every market one player is priced on, at its main line — the table in the
 * player page's "Odds & prices" section (R6.1d, G2 `oddsCard`).
 *
 * Pure, and read by every sport through the same rows `usePropOdds` fetches:
 * the main line is R2's rule (`mainLine.ts`), so the table, the prop block's
 * stepper and the line movement chart all name the same line. A started game's
 * rows are the ones that stood at the start (`readPreGamePropOddsForGame`), and
 * `pickMainLine` filters on the start as well, so no in-play price reaches it.
 */

import type { PropOddsRow } from '@/lib/db/client';
import { lastPreGameQuotes, pickMainLine } from './mainLine';

export interface PlayerPriceQuote {
  americanOdds: number;
  bookmaker: string;
  capturedAt: string;
}

export interface PlayerPriceRow {
  marketKey: string;
  /** `main`: a line books quote on both sides. `yes-no`: no handicap. `alternates-only`: one-sided rungs, so no line. */
  kind: 'main' | 'yes-no' | 'alternates-only';
  line: number | null;
  /** Every line counted books quoted, ascending. */
  availableLines: number[];
  over: PlayerPriceQuote | null;
  under: PlayerPriceQuote | null;
  /** Books with a counted quote at `line` (either side); for alternates, at any line. */
  books: number;
  /** Newest counted quote for the market. */
  updatedAt: string | null;
}

/** `pg` hands `timestamptz` back as a `Date` despite the row type's string. */
const iso = (at: string | Date) => new Date(at).toISOString();
const timeOf = (at: string | Date) => new Date(at).getTime();

const quote = (r: PropOddsRow | null | undefined): PlayerPriceQuote | null =>
  r ? { americanOdds: r.americanOdds, bookmaker: r.bookmaker, capturedAt: iso(r.fetchedAt) } : null;

/** Rows for one player across markets; markets with nothing countable (pick'em only, post-start only) are left out. Sorted by `order`, then market key. */
export function playerPriceRows(
  rows: PropOddsRow[],
  subjectId: string,
  startIso: string | null | undefined,
  now: number = Date.now(),
  order: (marketKey: string) => number = () => 0,
): PlayerPriceRow[] {
  const byMarket = new Map<string, PropOddsRow[]>();
  for (const r of rows) {
    if (r.subjectId !== subjectId) continue;
    byMarket.set(r.marketKey, [...(byMarket.get(r.marketKey) ?? []), r]);
  }
  const out: PlayerPriceRow[] = [];
  for (const [marketKey, marketRows] of byMarket) {
    const result = pickMainLine(marketRows, startIso, { now });
    if (result.kind === 'none') continue;
    const quotes = lastPreGameQuotes(marketRows, startIso, { now });
    const newest = quotes.reduce<string | null>((m, q) => (m == null || timeOf(q.fetchedAt) > timeOf(m) ? iso(q.fetchedAt) : m), null);
    const booksWhere = (keep: (q: PropOddsRow) => boolean) => new Set(quotes.filter(keep).map((q) => q.bookmaker.toLowerCase())).size;
    if (result.kind === 'main') {
      out.push({
        marketKey,
        kind: 'main',
        line: result.line,
        availableLines: result.availableLines,
        over: quote(result.over),
        under: quote(result.under),
        books: booksWhere((q) => q.line === result.line),
        updatedAt: newest,
      });
    } else if (result.kind === 'yes-no') {
      out.push({ marketKey, kind: 'yes-no', line: null, availableLines: [], over: quote(result.over), under: null, books: result.books, updatedAt: newest });
    } else {
      out.push({ marketKey, kind: 'alternates-only', line: null, availableLines: result.availableLines, over: null, under: null, books: booksWhere(() => true), updatedAt: newest });
    }
  }
  return out.sort((a, b) => order(a.marketKey) - order(b.marketKey) || a.marketKey.localeCompare(b.marketKey));
}
