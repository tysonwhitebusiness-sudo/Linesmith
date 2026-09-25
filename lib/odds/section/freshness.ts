/**
 * The section header's freshness strip (O-I), ported from the mockup's `fresh`
 * and `heartbeat`: books · newest check · oldest unchanged price · pulled
 * count, and price changes per minute over the last 30 minutes. Pure.
 */
import { pulledBooks } from './board';
import type { BoardRow, OddsMarket } from './types';

export interface Freshness {
  books: number;
  newestCheckAt: string | null;
  oldestUnchanged: { book: string; since: string } | null;
  pulled: string[];
  /** Changes per minute across every book, oldest minute first (30 buckets). */
  heartbeat: number[];
  changes30m: number;
}

export function freshness(m: OddsMarket, rows: BoardRow[], now: number): Freshness {
  const checks = rows.map(r => r.checkedAt).filter((v): v is string => !!v).sort();
  const withSince = rows.filter(r => r.since).sort((a, b) => a.since!.localeCompare(b.since!));
  const n = 30;
  const beat = new Array<number>(n).fill(0);
  for (const h of Object.values(m.hist)) {
    for (let i = h.length - 1; i >= 0; i--) {
      const d = Math.floor((now - Date.parse(h[i][0])) / 60000);
      if (d >= n) break;
      if (d >= 0) beat[n - 1 - d]++;
    }
  }
  return {
    books: rows.length,
    newestCheckAt: checks.length ? checks[checks.length - 1] : null,
    oldestUnchanged: withSince.length ? { book: withSince[0].book, since: withSince[0].since! } : null,
    pulled: pulledBooks(m, rows),
    heartbeat: beat,
    changes30m: beat.reduce((a, x) => a + x, 0),
  };
}

/** The LiveDot rule (Revision 4): green while the newest reading is inside 2x the
 *  source's poll interval, amber inside 6x, grey beyond. */
export function liveState(ageS: number, cadenceS: number): 'live' | 'slow' | 'off' {
  return ageS <= 2 * cadenceS ? 'live' : ageS <= 6 * cadenceS ? 'slow' : 'off';
}
