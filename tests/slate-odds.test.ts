/**
 * P8 O4: the Slate's odds (`lib/odds/section/slate.ts`, `steam.ts`) on the
 * approved mockup's Sep 24 MLB slate (om-data, the "Slate" tab of
 * odds-rebuild-mockup-2026-09-24.html), plus synthetic steam and dropping-odds
 * cases where the snapshot has none.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { om, toMarket } from './fixtures/omData';
import { decimal } from '@/lib/odds/section/board';
import { bookGroup } from '@/lib/odds/books/registry';
import { boardBooks, droppingList, holdList, moneylineMovers, pulledList, slateGame, steamMovers, type SlateOddsGame } from '@/lib/odds/section/slate';
import { detectSteam, lineMoves } from '@/lib/odds/section/steam';
import type { HistPoint, OddsMarket } from '@/lib/odds/section/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mlb = om().mlb.filter((g: any) => !g.final && g.espn);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const games: SlateOddsGame[] = mlb.map((g: any) => slateGame(g.key, new Map<string, OddsMarket>([
  ['fg_ml', toMarket('fg_ml', g.markets.ml)], ['fg_sp', toMarket('fg_sp', g.markets.sp)], ['fg_tot', toMarket('fg_tot', g.markets.tot)]])));

test('every card: best moneyline per side is the highest decimal price among priced books, and Pinnacle is its own main pair', () => {
  assert.ok(games.length >= 5);
  mlb.forEach((g: { markets: { ml: { cur: [string, string, number | null, number, string, string, number | null, string][] } } }, i: number) => {
    const s = games[i];
    for (const side of ['home', 'away'] as const) {
      const best = s.ml[side];
      if (!best) continue;
      const priced = g.markets.ml.cur.filter(c => c[1] === side && bookGroup(c[0]) !== 'pickem').map(c => decimal(c[3]));
      // Best is never above the top price (an outlier can be excluded, so it may be below).
      assert.ok(decimal(best.price) <= Math.max(...priced) + 1e-9);
    }
    const pa = g.markets.ml.cur.find(c => c[0] === 'pinnacle' && c[1] === 'home' && c[7] === 'main');
    if (pa) assert.equal(s.pinnacle?.home, pa[3]);
    if (s.pinnacle) assert.ok(s.pinnacle.fairHome > 0 && s.pinnacle.fairHome < 1);
  });
});

test('the hub: board columns are priced books only, lowest hold sorts ascending', () => {
  const cols = boardBooks(games);
  assert.ok(cols.length > 3 && cols.every(b => bookGroup(b) !== 'pickem'));
  const h = holdList(games).map(g => g.ml.hold!);
  assert.ok(h.length > 3 && h.every((v, i) => i === 0 || h[i - 1] <= v));
});

test('disagreements list each US or sharp book once', () => {
  for (const g of games) for (const l of g.totalLines) {
    const all = g.totalLines.flatMap(x => x.books);
    assert.equal(new Set(all).size, all.length, `${g.gameId} ${l.line}`);
  }
});

const H = (pts: [number, number | null][]): HistPoint[] => pts.map(([m, l]) => [new Date(Date.UTC(2026, 8, 24, 17, m)).toISOString(), l, -110, -110]);

test('steam: three books moving the same way inside 45 minutes, led by the first mover; a fourth later is its own move', () => {
  const hist = {
    pinnacle: H([[0, 9], [5, 8.5]]),
    circa: H([[0, 9], [12, 8.5]]),
    draftkings: H([[0, 9], [30, 8.5]]),
    fanduel: H([[0, 9], [55, 8.5]]),          // 50 min after the leader: outside the window
    caesars: H([[0, 9], [20, 9.5]]),          // the other way
  };
  const s = detectSteam(hist);
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].books, ['pinnacle', 'circa', 'draftkings']);
  assert.equal(s[0].dir, -1);
  assert.equal(s[0].from, 9);
  assert.equal(lineMoves(hist).length, 5);
  assert.equal(detectSteam({ a: H([[0, 9], [5, 8.5]]), b: H([[0, 9], [6, 8.5]]) }).length, 0);  // two books is not steam
});

test('dropping odds: median-book move open -> now, largest first; moneyline movers by implied change', () => {
  const g = (id: string, ml: number, tot: number, moved: [number, number]): SlateOddsGame => ({
    gameId: id, books: 10, checkedAt: null, ml: { home: null, away: null, hold: null }, pinnacle: null,
    total: { line: null, open: null }, spread: { line: null, open: null },
    moved: { book: 'pinnacle', open: moved[0], now: moved[1], openedAt: '2026-09-24T00:00:00Z' }, dk: null, kalshi24h: null,
    board: {}, totalLines: [], steam: [], pulls: [{ book: 'betmgm', market: 'sp', side: 'home', pulledAt: `2026-09-24T1${id}:00:00Z` }],
    dropping: [{ market: 'ml', medianMove: ml, sameWay: 5, books: 8 }, { market: 'tot', medianMove: tot, sameWay: 3, books: 6 }],
  });
  const gs = [g('1', 0.01, -0.03, [-110, -120]), g('2', 0.05, 0, [-110, -111]), g('3', -0.02, 0.004, [150, 120])];
  assert.deepEqual(droppingList(gs).map(d => `${d.gameId}${d.market}`), ['2ml', '1tot', '3ml', '1ml', '3tot']);
  assert.deepEqual(moneylineMovers(gs).map(m => m.gameId), ['3', '1', '2']);
  assert.deepEqual(pulledList(gs).map(p => p.gameId), ['3', '2', '1']);
  assert.equal(steamMovers(gs).length, 0);
});
