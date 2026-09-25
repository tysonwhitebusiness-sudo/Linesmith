/**
 * The Scan table's odds cells (odds build P8, O4; D22): Sharp, Books, Checked,
 * Open → now and the pulled marker, for one row's quotes — the prop rows at
 * that player, market and line. Pure. No edge: nothing here compares a price
 * with a model (D5; the Edge column is P11's).
 */
import type { PropOddsRow } from '@/lib/db/client';
import { devig } from './sharp';

export interface ScanOddsCells {
  /** Pinnacle's two prices at the row's line, and its no-vig over. */
  sharp: { over: number; under: number; fairOver: number } | null;
  /** Books quoting the row's line (pick'em apps included: they are books a user can see). */
  books: number;
  /** The newest "checked" among those quotes. */
  checkedAt: string | null;
}

export function scanOddsCells(rows: PropOddsRow[]): ScanOddsCells {
  const pin = (side: string) => rows.find(r => r.bookmaker === 'pinnacle' && r.side === side) ?? null;
  const o = pin('over'), u = pin('under');
  let checked: string | null = null;
  for (const r of rows) if (r.fetchedAt && (!checked || r.fetchedAt > checked)) checked = r.fetchedAt;
  return {
    sharp: o && u ? { over: o.americanOdds, under: u.americanOdds, fairOver: devig(o.americanOdds, u.americanOdds) } : null,
    books: new Set(rows.map(r => r.bookmaker)).size,
    checkedAt: checked,
  };
}

/** The key the Scan extras are held under: player, market and (for pulls) line. */
export const scanKey = (subjectId: string, marketKey: string, line?: number | null) =>
  line === undefined ? `${subjectId}|${marketKey}` : `${subjectId}|${marketKey}|${line ?? ''}`;

export interface ScanExtras {
  /** The line most books opened at, by player and market. */
  open: Record<string, number>;
  /** How many books have pulled the row's line and not put it back, by player, market and line. */
  pulled: Record<string, number>;
}

/** Seconds since `iso`, as the Checked cell prints it ("40s", "12m", "3h"). */
export function shortAge(iso: string | null, now: number): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
}
