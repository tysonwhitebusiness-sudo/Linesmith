/**
 * Opening → now (O-F), ported from the mockup's `openCard`: the first price
 * recorded per book against its main line now, and a one-line summary. An
 * opener that failed `odds_checks.opener_sanity` (`market_openers.check_flag`)
 * is shown with "⚠ check" and never used as "the opener" (D21). Pure.
 */
import { bookGroup } from '@/lib/odds/books/registry';
import type { MarketSpec, OddsMarket, OddsQuote, OpenerRow } from './types';

export interface OpenNowRow {
  book: string;
  open: OpenerRow;
  nowA: OddsQuote | null;
  nowB: OddsQuote | null;
}

export interface OpenNow {
  rows: OpenNowRow[];
  /** Openers NOT flagged: [min, max] of their lines. */
  openRange: [number, number] | null;
  nowRange: [number, number] | null;
  firstSeen: string | null;
  latestSteam: { leader: string; at: string; followers: number } | null;
}

const range = (a: number[]): [number, number] | null => (a.length ? [Math.min(...a), Math.max(...a)] : null);

export function openNow(m: OddsMarket, sp: MarketSpec, limit = 14): OpenNow {
  const rows = Object.entries(m.open).filter(([k]) => bookGroup(k) !== 'pickem')
    .sort((a, b) => a[1].at.localeCompare(b[1].at)).slice(0, limit)
    .map(([book, open]) => ({
      book, open,
      nowA: m.cur.find(q => q.book === book && q.side === sp.sides[0] && q.main) ?? null,
      nowB: m.cur.find(q => q.book === book && q.side === sp.sides[1] && q.main) ?? null,
    }));
  const trusted = rows.filter(r => !r.open.flagged);
  const st = (m.steam ?? []).slice(-1)[0];
  return {
    rows,
    openRange: range(trusted.map(r => r.open.line).filter((v): v is number => v != null)),
    nowRange: range(rows.map(r => r.nowA?.line).filter((v): v is number => v != null)),
    firstSeen: trusted[0]?.open.at ?? null,
    latestSteam: st ? { leader: st.books[0], at: st.t, followers: st.books.length - 1 } : null,
  };
}

/** "Dropping odds" (O4, plan L5): a market's move open → now in implied
 *  probability, across books — the median book's move and how many books moved
 *  the same way. Names no edge; colours nothing by value. */
export function droppingOdds(m: OddsMarket, sp: MarketSpec): { medianMove: number; sameWay: number; books: number } | null {
  const implied = (a: number) => (a > 0 ? 100 / (a + 100) : -a / (-a + 100));
  const moves: number[] = [];
  for (const [book, o] of Object.entries(m.open)) {
    if (o.flagged || o.priceA == null) continue;
    const now = m.cur.find(q => q.book === book && q.side === sp.sides[0] && q.main && (sp.noLine || q.line === o.line));
    if (now) moves.push(implied(now.price) - implied(o.priceA));
  }
  if (!moves.length) return null;
  const s = [...moves].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  return { medianMove: med, sameWay: moves.filter(x => Math.sign(x) === Math.sign(med) && x !== 0).length, books: moves.length };
}
