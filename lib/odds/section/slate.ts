/**
 * The Slate's odds (odds build P8, O4; the mockup's `mlbView`, `slateGames`,
 * `slateMovers`, `slateMarket`). Pure: one summary per game from its
 * full-game markets, and the slate-wide lists built from those summaries —
 * Biggest moves (steam with its first mover; moneylines that moved most),
 * Dropping odds, Pulled lines, and the Market hub's Best prices, Openers vs
 * now, Lowest hold and Line disagreements.
 *
 * No edge anywhere (the no-edge rule stands until P11): nothing here compares
 * a price to a model, and nothing is coloured by value.
 */
import { bookGroup } from '@/lib/odds/books/registry';
import { bestPrice, boardRows, consensusLine, implied } from './board';
import { droppingOdds } from './openers';
import { devig } from './sharp';
import { detectSteam } from './steam';
import type { MarketSpec, OddsMarket, SteamRow } from './types';
import { marketSpec } from './types';

const ML = marketSpec('ml'), SP = marketSpec('sp'), TOT = marketSpec('tot');

export interface PriceAt { book: string; price: number }

export interface SlateOddsGame {
  gameId: string;
  books: number;
  checkedAt: string | null;
  ml: { home: PriceAt | null; away: PriceAt | null; hold: number | null };
  pinnacle: { home: number; away: number; fairHome: number; checkedAt: string | null } | null;
  total: { line: number | null; open: number | null };
  spread: { line: number | null; open: number | null };
  /** The home moneyline, open → now, at Pinnacle (else DraftKings). */
  moved: { book: string; open: number; now: number; openedAt: string } | null;
  /** DraftKings customers on the home moneyline (DK Network, else VSiN's DK row). */
  dk: { money: number | null; bets: number | null } | null;
  kalshi24h: number | null;
  /** Each book's main moneyline, for the Market hub's board. */
  board: Record<string, { home: number | null; away: number | null }>;
  /** Totals the US and sharp books disagree on: each line with its books. */
  totalLines: { line: number; books: string[] }[];
  steam: (SteamRow & { market: 'tot' | 'sp' })[];
  dropping: { market: 'ml' | 'sp' | 'tot'; medianMove: number; sameWay: number; books: number }[];
  pulls: { book: string; market: 'ml' | 'sp' | 'tot'; side: string; pulledAt: string }[];
}

export interface SlateOddsPayload {
  sport: string;
  date: string;
  asOf: string;
  games: SlateOddsGame[];
  /** The build's own time, and the part of it spent in the database (F12's measure). */
  buildMs: number;
  queryMs?: number;
}

export interface SplitRow { market: string; side: string; source: string; book: string | null; pctMoney: number | null; pctBets: number | null }

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function openLine(m: OddsMarket | undefined): number | null {
  if (!m) return null;
  return median(Object.values(m.open).filter(o => !o.flagged && o.line != null).map(o => o.line!));
}

const PULL_GROUPS = new Set(['us', 'sharp', 'exchange']);

/** One game's Slate summary from its markets keyed `fg_ml`, `fg_sp`, `fg_tot`. */
export function slateGame(gameId: string, markets: Map<string, OddsMarket>, splits: SplitRow[] = []): SlateOddsGame {
  const ml = markets.get('fg_ml'), sp = markets.get('fg_sp'), tot = markets.get('fg_tot');
  const books = new Set<string>();
  for (const m of [ml, sp, tot]) for (const q of m?.cur ?? []) if (bookGroup(q.book) !== 'pickem') books.add(q.book);
  const checks = [ml, sp, tot].flatMap(m => m?.cur.map(q => q.checkedAt) ?? []).filter((v): v is string => !!v).sort();
  const mlRows = ml ? boardRows(ml, ML, null) : [];
  const b0 = bestPrice(mlRows, 0), b1 = bestPrice(mlRows, 1);
  const pinQ = (side: string) => ml?.cur.find(q => q.book === 'pinnacle' && q.side === side && q.main) ?? null;
  const ph = pinQ('home'), pa = pinQ('away');
  const opener = ml?.open.pinnacle && !ml.open.pinnacle.flagged ? ['pinnacle', ml.open.pinnacle] as const
    : ml?.open.draftkings && !ml.open.draftkings.flagged ? ['draftkings', ml.open.draftkings] as const : null;
  const nowHome = opener ? ml?.cur.find(q => q.book === opener[0] && q.side === 'home' && q.main) ?? null : null;
  const dkRow = splits.find(s => s.source === 'dknetwork' && s.market === 'ml' && s.side === 'home')
    ?? splits.find(s => s.source === 'vsin' && s.book === 'draftkings' && s.market === 'ml' && s.side === 'home');
  const kal = ml?.cur.find(q => q.book === 'kalshi' && q.side === 'home' && typeof q.extra?.volume_24h === 'number');
  const board: SlateOddsGame['board'] = {};
  for (const q of ml?.cur ?? []) {
    if (!q.main || (q.side !== 'home' && q.side !== 'away')) continue;
    const b = board[q.book] ?? (board[q.book] = { home: null, away: null });
    b[q.side as 'home' | 'away'] = q.price;
  }
  // One main total per book: several sources can relay the same book, so the
  // most recently checked quote speaks for it.
  const bookLine = new Map<string, { line: number; at: string }>();
  for (const q of tot?.cur ?? []) {
    if (!q.main || q.side !== 'over' || q.line == null || (bookGroup(q.book) !== 'us' && bookGroup(q.book) !== 'sharp')) continue;
    const at = q.checkedAt ?? q.since;
    const cur = bookLine.get(q.book);
    if (!cur || at > cur.at) bookLine.set(q.book, { line: q.line, at });
  }
  const byLine = new Map<number, string[]>();
  for (const [book, v] of bookLine) (byLine.get(v.line) ?? byLine.set(v.line, []).get(v.line)!).push(book);
  const dropping: SlateOddsGame['dropping'] = [];
  for (const [k, m, s] of [['ml', ml, ML], ['sp', sp, SP], ['tot', tot, TOT]] as const) {
    const d = m ? droppingOdds(m, s) : null;
    if (d && d.books >= 2) dropping.push({ market: k, ...d });
  }
  const pulls: SlateOddsGame['pulls'] = [];
  for (const [k, m] of [['ml', ml], ['sp', sp], ['tot', tot]] as const) {
    for (const p of m?.pulls ?? []) {
      if (p.returnedAt || !PULL_GROUPS.has(bookGroup(p.book))) continue;
      // Only a book's main line counts: a pulled alternate is routine.
      if (m!.cur.some(q => q.book === p.book && q.main)) continue;
      pulls.push({ book: p.book, market: k, side: p.side, pulledAt: p.pulledAt });
    }
  }
  const dedupPulls = [...new Map(pulls.map(p => [`${p.book}|${p.market}`, p])).values()];
  return {
    gameId,
    books: books.size,
    checkedAt: checks[checks.length - 1] ?? null,
    ml: { home: b0 ? { book: b0.book, price: b0.quote.price } : null, away: b1 ? { book: b1.book, price: b1.quote.price } : null,
      hold: b0 && b1 ? implied(b0.quote.price) + implied(b1.quote.price) - 1 : null },
    pinnacle: ph && pa ? { home: ph.price, away: pa.price, fairHome: devig(ph.price, pa.price), checkedAt: ph.checkedAt } : null,
    total: { line: tot ? consensusLine(tot, TOT).modal : null, open: openLine(tot) },
    spread: { line: sp ? consensusLine(sp, SP).modal : null, open: openLine(sp) },
    moved: opener && opener[1].priceA != null && nowHome ? { book: opener[0], open: opener[1].priceA, now: nowHome.price, openedAt: opener[1].at } : null,
    dk: dkRow ? { money: dkRow.pctMoney, bets: dkRow.pctBets } : null,
    kalshi24h: kal ? (kal.extra!.volume_24h as number) : null,
    board,
    totalLines: byLine.size > 1 ? [...byLine].sort((a, b) => a[0] - b[0]).map(([line, bs]) => ({ line, books: bs.sort() })) : [],
    steam: [...(tot ? detectSteam(tot.hist).map(s => ({ ...s, market: 'tot' as const })) : []),
      ...(sp ? detectSteam(sp.hist).map(s => ({ ...s, market: 'sp' as const })) : [])],
    dropping,
    pulls: dedupPulls,
  };
}

// ---------------------------------------------------------------------------
// Slate-wide lists
// ---------------------------------------------------------------------------

/** Moneylines that moved most, open → now, by the change in implied probability. */
export function moneylineMovers(games: SlateOddsGame[], n = 6) {
  return games.filter(g => g.moved).map(g => ({ gameId: g.gameId, ...g.moved!, d: implied(g.moved!.now) - implied(g.moved!.open) }))
    .filter(x => x.d !== 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, n);
}

/** The latest steam runs across the slate, newest first. */
export function steamMovers(games: SlateOddsGame[], n = 6) {
  return games.flatMap(g => g.steam.map(s => ({ gameId: g.gameId, ...s }))).sort((a, b) => b.t.localeCompare(a.t)).slice(0, n);
}

/** Dropping odds (plan L5): every market's median-book move open → now, largest first. */
export function droppingList(games: SlateOddsGame[], n = 10) {
  return games.flatMap(g => g.dropping.map(d => ({ gameId: g.gameId, ...d }))).filter(d => d.medianMove !== 0)
    .sort((a, b) => Math.abs(b.medianMove) - Math.abs(a.medianMove)).slice(0, n);
}

/** Main lines a US, sharp or exchange book has taken down and not put back, newest first. */
export function pulledList(games: SlateOddsGame[], n = 10) {
  return games.flatMap(g => g.pulls.map(p => ({ gameId: g.gameId, ...p }))).sort((a, b) => b.pulledAt.localeCompare(a.pulledAt)).slice(0, n);
}

/** Lowest hold at the best moneyline prices, lowest first (a negative hold is a fact, D20). */
export function holdList(games: SlateOddsGame[]) {
  return games.filter(g => g.ml.hold != null && g.ml.home && g.ml.away).sort((a, b) => a.ml.hold! - b.ml.hold!);
}

/** The Market hub board's book columns: the books that price the most games, in group order. */
export function boardBooks(games: SlateOddsGame[], max = 13): string[] {
  const cnt = new Map<string, number>();
  for (const g of games) for (const b of Object.keys(g.board)) cnt.set(b, (cnt.get(b) ?? 0) + 1);
  const order = ['sharp', 'exchange', 'us', 'nevada', 'offshore', 'intl'];
  return [...cnt].filter(([b]) => bookGroup(b) !== 'pickem').sort((a, b) => b[1] - a[1]).slice(0, max).map(([b]) => b)
    .sort((a, b) => order.indexOf(bookGroup(a)) - order.indexOf(bookGroup(b)) || cnt.get(b)! - cnt.get(a)!);
}

export type { MarketSpec };
