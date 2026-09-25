/**
 * Coverage (O-K), ported from the mockup's `coverageCard`: markets x book
 * groups, and the markets a source prices that the app does not show yet
 * (D15; from `scraper_unmatched_prices`). Pure.
 */
import { bookGroup } from '@/lib/odds/books/registry';
import type { OddsMarket } from './types';

export const COVERAGE_GROUPS = ['sharp', 'exchange', 'us', 'offshore', 'pickem'] as const;

export interface CoverageRow {
  key: string;
  label: string;
  books: number;
  lines: number;
  byGroup: Record<(typeof COVERAGE_GROUPS)[number], string[]>;
}

export function coverage(markets: OddsMarket[]): CoverageRow[] {
  return markets.map(m => {
    const books = [...new Set(m.cur.map(q => q.book))];
    const byGroup = Object.fromEntries(COVERAGE_GROUPS.map(g => [g, books.filter(k => bookGroup(k) === g)])) as CoverageRow['byGroup'];
    return { key: m.key, label: m.label ?? m.key, books: books.length,
      lines: new Set(m.cur.map(q => q.line).filter(v => v != null)).size, byGroup };
  });
}
