/**
 * The live layer's diff (odds build P9 §2, plan §8 Revision 4). Pure: each
 * refresh of an odds payload is reduced to its keys, compared with the
 * previous refresh's, and the difference drives every animation — a price
 * that moved rolls and flashes, a price that vanished strikes through, one
 * that came back fades in, a new move slides in. Nothing animates on the
 * FIRST payload (`prev === null`): opening a page is not news.
 *
 * Keys:
 *   price  `provider|book|period|market|side|line`
 *   row    `book|period|market`
 *   move   `book|period|market|at` (a history point: the tables' change row, by book and time)
 * The Slate's payload is summarised per game, so its period slot carries the
 * game (`<gameId>:fg`) and its provider slot reads `slate`.
 *
 * A book that moves its line drops one key and gains another on the same side;
 * that pair is a CHANGE on the new key (found in the live check: counted as a
 * pull plus a new price, the commonest live event read "pulled").
 *
 * Direction: `up` means the number went up. For an American price that is
 * the side paying more (−110 → −105 is up; +150 → +140 is down).
 */
import type { SlateOddsPayload } from './slate';
import type { GameOddsPayload, OddsMarket, OddsQuote, PlayerOddsPayload } from './types';

export interface LiveChange { key: string; dir: 'up' | 'down'; from: number; to: number; at: string }
export interface LiveDiff { changes: LiveChange[]; pulled: string[]; returned: string[]; added: string[]; newMoves: string[] }

export interface OddsSnapshotKeys {
  /** price key -> its number and when it last changed (`since`). */
  prices: Map<string, { v: number; at: string }>;
  rows: Set<string>;
  moves: Set<string>;
  /** Price keys that went missing in an earlier diff and have not come back: what makes a reappearance "returned". */
  gone: Set<string>;
}

export const EMPTY_DIFF: LiveDiff = { changes: [], pulled: [], returned: [], added: [], newMoves: [] };

type AnyPayload = PlayerOddsPayload | GameOddsPayload | SlateOddsPayload;

/** `fg_sp` -> ['fg', 'sp']; a player market (no period prefix) is full game. */
export function splitMarketKey(marketKey: string, game: boolean): [period: string, market: string] {
  if (!game) return ['fg', marketKey];
  const i = marketKey.indexOf('_');
  return i < 0 ? ['fg', marketKey] : [marketKey.slice(0, i), marketKey.slice(i + 1)];
}

export function priceKey(marketKey: string, q: Pick<OddsQuote, 'source' | 'book' | 'side' | 'line'>, game: boolean): string {
  const [period, market] = splitMarketKey(marketKey, game);
  return `${q.source}|${q.book}|${period}|${market}|${q.side}|${q.line ?? ''}`;
}

export function rowKeyOf(marketKey: string, book: string, game: boolean): string {
  const [period, market] = splitMarketKey(marketKey, game);
  return `${book}|${period}|${market}`;
}

/** A price key's row. */
export function rowOf(key: string): string {
  const p = key.split('|');
  return `${p[1]}|${p[2]}|${p[3]}`;
}

/** A price or move key's market, as `period|market` (what a market tab counts). */
export function marketOfKey(key: string, kind: 'price' | 'move' = 'price'): string {
  const p = key.split('|');
  return kind === 'price' ? `${p[2]}|${p[3]}` : `${p[1]}|${p[2]}`;
}

/** The Slate's keys for one game's summary. */
export function slatePriceKey(gameId: string, book: string, market: string, side: string): string {
  return `slate|${book}|${gameId}:fg|${market}|${side}|`;
}

function marketKeys(m: OddsMarket, game: boolean, out: OddsSnapshotKeys): void {
  const [period, market] = splitMarketKey(m.key, game);
  for (const q of m.cur) {
    out.prices.set(priceKey(m.key, q, game), { v: q.price, at: q.since });
    out.rows.add(`${q.book}|${period}|${market}`);
  }
  // A book that pulled the market is still a row (the board keeps it, struck through).
  for (const p of m.pulls ?? []) if (!p.returnedAt) out.rows.add(`${p.book}|${period}|${market}`);
  // So is a book with history and no price now: the board shows it as pulled (`board.pulledBooks`).
  for (const [book, h] of Object.entries(m.hist)) {
    out.rows.add(`${book}|${period}|${market}`);
    for (const pt of h) out.moves.add(`${book}|${period}|${market}|${pt[0]}`);
  }
}

export function keysOf(payload: AnyPayload): OddsSnapshotKeys {
  const out: OddsSnapshotKeys = { prices: new Map(), rows: new Set(), moves: new Set(), gone: new Set() };
  if ('games' in payload) {
    for (const g of payload.games) {
      const at = g.checkedAt ?? payload.asOf;
      for (const [book, p] of Object.entries(g.board)) {
        for (const side of ['home', 'away'] as const) {
          const v = p[side];
          if (v == null) continue;
          out.prices.set(slatePriceKey(g.gameId, book, 'ml', side), { v, at });
          out.rows.add(`${book}|${g.gameId}:fg|ml`);
        }
      }
      if (g.pinnacle) {
        out.prices.set(slatePriceKey(g.gameId, 'pinnacle', 'ml', 'home'), { v: g.pinnacle.home, at: g.pinnacle.checkedAt ?? at });
        out.prices.set(slatePriceKey(g.gameId, 'pinnacle', 'ml', 'away'), { v: g.pinnacle.away, at: g.pinnacle.checkedAt ?? at });
        out.rows.add(`pinnacle|${g.gameId}:fg|ml`);
      }
      if (g.total.line != null) { out.prices.set(slatePriceKey(g.gameId, 'consensus', 'tot', 'over'), { v: g.total.line, at }); out.rows.add(`consensus|${g.gameId}:fg|tot`); }
      if (g.spread.line != null) { out.prices.set(slatePriceKey(g.gameId, 'consensus', 'sp', 'home'), { v: g.spread.line, at }); out.rows.add(`consensus|${g.gameId}:fg|sp`); }
      if (g.dk?.money != null) { out.prices.set(slatePriceKey(g.gameId, 'draftkings', 'money', 'home'), { v: g.dk.money, at }); out.rows.add(`draftkings|${g.gameId}:fg|money`); }
      for (const p of g.pulls) out.rows.add(`${p.book}|${g.gameId}:fg|${p.market}`);
      for (const s of g.steam) out.moves.add(`${s.books[0]}|${g.gameId}:fg|${s.market}|${s.t}`);
    }
    return out;
  }
  const game = !('subjectId' in payload);
  for (const m of payload.markets) marketKeys(m, game, out);
  return out;
}

/** The difference between two refreshes. The first payload (`prev === null`) is never a change. */
export function diffOdds(prev: OddsSnapshotKeys | null, next: OddsSnapshotKeys): LiveDiff {
  if (!prev) return { changes: [], pulled: [], returned: [], added: [], newMoves: [] };
  const changes: LiveChange[] = [], pulled: string[] = [], returned: string[] = [], added: string[] = [], newMoves: string[] = [];
  const appeared: string[] = [];
  for (const [key, cur] of next.prices) {
    const was = prev.prices.get(key);
    if (was) {
      if (was.v !== cur.v) changes.push({ key, dir: cur.v > was.v ? 'up' : 'down', from: was.v, to: cur.v, at: cur.at });
    } else {
      appeared.push(key);
    }
  }
  const vanished = [...prev.prices.keys()].filter(k => !next.prices.has(k) && next.rows.has(rowOf(k)));
  // A book that MOVED its line (−7 → −7.5) drops one key and gains another on the
  // same side: that is a move, not a pull and a new price. Pair them by side, in
  // line order; what is left over is a real pull, or a real new price.
  const side = (k: string) => k.slice(0, k.lastIndexOf('|'));
  const lineOf = (k: string) => Number(k.slice(k.lastIndexOf('|') + 1));
  const bySide = new Map<string, { v: string[]; a: string[] }>();
  for (const k of vanished) (bySide.get(side(k)) ?? bySide.set(side(k), { v: [], a: [] }).get(side(k))!).v.push(k);
  for (const k of appeared) bySide.get(side(k))?.a.push(k);
  const moved = new Set<string>();
  for (const { v, a } of bySide.values()) {
    if (!v.length || !a.length) continue;
    v.sort((x, y) => lineOf(x) - lineOf(y));
    a.sort((x, y) => lineOf(x) - lineOf(y));
    for (let i = 0; i < Math.min(v.length, a.length); i++) {
      const was = prev.prices.get(v[i])!, cur = next.prices.get(a[i])!;
      const dir = cur.v !== was.v ? (cur.v > was.v ? 'up' : 'down') : lineOf(a[i]) > lineOf(v[i]) ? 'up' : 'down';
      changes.push({ key: a[i], dir, from: was.v, to: cur.v, at: cur.at });
      moved.add(v[i]).add(a[i]);
    }
  }
  for (const k of appeared) if (!moved.has(k)) (prev.gone.has(k) ? returned : added).push(k);
  for (const k of vanished) if (!moved.has(k)) pulled.push(k);
  for (const k of next.moves) if (!prev.moves.has(k)) newMoves.push(k);
  return { changes, pulled, returned, added, newMoves };
}

/**
 * One refresh: the diff, and the snapshot to diff the next refresh against
 * (carrying forward which keys are gone, so a reappearance reads "returned").
 */
export function advance(prev: OddsSnapshotKeys | null, next: OddsSnapshotKeys): { diff: LiveDiff; snap: OddsSnapshotKeys } {
  const diff = diffOdds(prev, next);
  const gone = new Set(prev?.gone ?? []);
  for (const k of diff.pulled) gone.add(k);
  for (const k of gone) if (next.prices.has(k) || !next.rows.has(rowOf(k))) gone.delete(k);
  return { diff, snap: { ...next, gone } };
}
