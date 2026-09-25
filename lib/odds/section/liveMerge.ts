/**
 * The game page's light refresh (odds build P9 §4). Pure.
 *
 * A game's full payload carries ten days of line history for every period and
 * market — measured 2.2–2.5 s of reading per request (≈10k change rows), which
 * ten polling tabs turned into a queue of 22 on a six-connection pool. So the
 * game page loads the full payload once, then polls `?live=1`: current prices,
 * open (or just-returned) pulls and the splits — no history, openers, power
 * ratings or latency. This merges that light payload onto the last full one:
 * current prices replace, and each book whose MAIN pair changed gains a
 * history point at the time the price changed — the same point the history
 * reader would have made from the change rows (`oddsRead.histFromChanges`
 * takes a book's main pair after each change). Moves and steam are
 * recomputed from the merged history. The hook resyncs in full every few
 * minutes, so any drift is bounded.
 */
import { detectSteam, lineMoves } from './steam';
import type { GameOddsPayload, HistPoint, MarketSpec, OddsMarket, OddsQuote, PullRow } from './types';
import { marketSpec } from './types';

function specOf(marketKey: string): MarketSpec {
  const m = marketKey.slice(marketKey.indexOf('_') + 1);
  return m === 'sp' ? marketSpec('sp') : m === 'ml' || m === 'ml3' ? marketSpec('ml') : marketSpec('tot');
}

/** A book's main pair now: side A's line and both prices, and when the later of the two last changed. */
function mainPair(cur: OddsQuote[], book: string, sp: MarketSpec): { line: number | null; a: number | null; b: number | null; at: string } | null {
  const mine = cur.filter(q => q.book === book && q.main);
  const qa = mine.find(q => q.side === sp.sides[0]) ?? null, qb = mine.find(q => q.side === sp.sides[1]) ?? null;
  if (!qa && !qb) return null;
  const line = sp.noLine ? null : qa ? qa.line : qb!.line == null ? null : sp.signed ? -qb!.line : qb!.line;
  const at = [qa?.since, qb?.since].filter((v): v is string => !!v).sort().at(-1)!;
  return { line, a: qa?.price ?? null, b: qb?.price ?? null, at };
}

const pullKey = (p: PullRow) => `${p.book}|${p.side}|${p.line ?? ''}|${p.pulledAt}`;

export function mergeLiveGame(full: GameOddsPayload, live: GameOddsPayload): GameOddsPayload {
  const byKey = new Map(full.markets.map(m => [m.key, m]));
  const out: OddsMarket[] = [];
  const seen = new Set<string>();
  for (const lm of live.markets) {
    seen.add(lm.key);
    const prev = byKey.get(lm.key);
    const sp = specOf(lm.key);
    const hist: Record<string, HistPoint[]> = {};
    for (const [b, h] of Object.entries(prev?.hist ?? {})) hist[b] = h.slice();
    for (const book of new Set(lm.cur.map(q => q.book))) {
      const now = mainPair(lm.cur, book, sp);
      if (!now) continue;
      const h = hist[book] ?? (hist[book] = []);
      const last = h[h.length - 1];
      if (last && last[1] === now.line && last[2] === now.a && last[3] === now.b) continue;
      // Never before the last point: a source's "since" can trail what history already holds.
      const at = last && now.at <= last[0] ? live.asOf : now.at;
      h.push([at, now.line, now.a, now.b]);
    }
    const pulls = new Map((prev?.pulls ?? []).map(p => [pullKey(p), p]));
    for (const p of lm.pulls ?? []) pulls.set(pullKey(p), p);
    const m: OddsMarket = { ...(prev ?? { open: {} }), key: lm.key, cur: lm.cur, hist, pulls: [...pulls.values()], open: { ...(prev?.open ?? {}), ...lm.open } };
    if (!sp.noLine) { m.moves = lineMoves(hist); m.steam = detectSteam(hist); }
    out.push(m);
  }
  // A market every book has left keeps its history (the board shows them pulled).
  for (const m of full.markets) if (!seen.has(m.key)) out.push({ ...m, cur: [] });
  return { ...full, asOf: live.asOf, markets: out, money: live.money ?? full.money };
}
