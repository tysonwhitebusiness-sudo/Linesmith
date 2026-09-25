/**
 * Odds build P9 §2 — the live layer's diff (`lib/odds/section/liveDiff.ts`).
 * Every animation on the odds section is driven by what this says changed
 * between two refreshes, so each rule the spec names is pinned here on a
 * small payload: nothing on the first payload; a price up or down is one
 * change with its direction; a price that vanishes while its book's row stays
 * is pulled, and comes back as returned; a new history row is a new move;
 * American −110 → −105 is "up" (it pays more).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { advance, diffOdds, keysOf, priceKey, rowOf } from '../lib/odds/section/liveDiff';
import type { GameOddsPayload, OddsQuote, PlayerOddsPayload } from '../lib/odds/section/types';
import type { SlateOddsPayload } from '../lib/odds/section/slate';

const T = '2026-09-25T17:00:00.000Z';
const q = (book: string, side: string, line: number | null, price: number, since = T): OddsQuote =>
  ({ book, side, line, price, since, checkedAt: since, source: `scraper:${book}`, main: true });

const player = (cur: OddsQuote[], hist: PlayerOddsPayload['markets'][number]['hist'] = {}): PlayerOddsPayload => ({
  sport: 'nfl', gameId: 'g1', subjectId: 'p1', asOf: T, latency: [],
  markets: [{ key: 'receptions', cur, hist, open: {} }],
});

test('the first payload produces no changes: opening a page is not news', () => {
  const d = diffOdds(null, keysOf(player([q('draftkings', 'over', 5.5, -110)])));
  assert.deepEqual(d, { changes: [], pulled: [], returned: [], added: [], newMoves: [] });
});

test('a price up and a price down are one change each, with direction, from, to and the new changed_at', () => {
  const a = keysOf(player([q('draftkings', 'over', 5.5, -110), q('fanduel', 'over', 5.5, +120)]));
  const b = keysOf(player([q('draftkings', 'over', 5.5, -105, '2026-09-25T17:01:00.000Z'), q('fanduel', 'over', 5.5, +110)]));
  const d = diffOdds(a, b);
  assert.equal(d.changes.length, 2);
  const dk = d.changes.find(c => c.key.includes('|draftkings|'))!;
  assert.deepEqual({ dir: dk.dir, from: dk.from, to: dk.to, at: dk.at }, { dir: 'up', from: -110, to: -105, at: '2026-09-25T17:01:00.000Z' });
  assert.equal(d.changes.find(c => c.key.includes('|fanduel|'))!.dir, 'down');
});

test('American −110 → −105 is up (pays more); −105 → +105 is up; +150 → +140 is down', () => {
  const one = (from: number, to: number) => diffOdds(keysOf(player([q('dk', 'over', 5.5, from)])), keysOf(player([q('dk', 'over', 5.5, to)]))).changes[0].dir;
  assert.equal(one(-110, -105), 'up');
  assert.equal(one(-105, 105), 'up');
  assert.equal(one(150, 140), 'down');
});

test('the price key is provider|book|period|market|side|line; a game market splits its period off', () => {
  assert.equal(priceKey('receptions', q('draftkings', 'over', 5.5, -110), false), 'scraper:draftkings|draftkings|fg|receptions|over|5.5');
  assert.equal(priceKey('1h_sp', q('pinnacle', 'home', -3.5, -110), true), 'scraper:pinnacle|pinnacle|1h|sp|home|-3.5');
  assert.equal(priceKey('fg_tt_home', q('pinnacle', 'over', 24.5, -110), true), 'scraper:pinnacle|pinnacle|fg|tt_home|over|24.5');
  assert.equal(rowOf('scraper:pinnacle|pinnacle|1h|sp|home|-3.5'), 'pinnacle|1h|sp');
});

test('a price that disappears while its row is still present is pulled; when it reappears it is returned', () => {
  const both = [q('draftkings', 'over', 5.5, -110), q('draftkings', 'over', 6.5, +130)];
  const s0 = advance(null, keysOf(player(both))).snap;
  const r1 = advance(s0, keysOf(player([both[1]])));               // 5.5 gone, DraftKings still quotes 6.5
  assert.deepEqual(r1.diff.pulled, ['scraper:draftkings|draftkings|fg|receptions|over|5.5']);
  const r2 = advance(r1.snap, keysOf(player([both[1]])));           // still gone: not pulled twice
  assert.deepEqual(r2.diff.pulled, []);
  const r3 = advance(r2.snap, keysOf(player(both)));                // back
  assert.deepEqual(r3.diff.returned, ['scraper:draftkings|draftkings|fg|receptions|over|5.5']);
  assert.deepEqual(r3.diff.added, []);
});

test('a book whose every price vanished but which has history (the board shows it pulled) is pulled', () => {
  const hist = { draftkings: [[T, 5.5, -110, -110]] as [string, number, number, number][] };
  const a = keysOf(player([q('draftkings', 'over', 5.5, -110), q('fanduel', 'over', 5.5, -115)], hist));
  const b = keysOf(player([q('fanduel', 'over', 5.5, -115)], hist));
  assert.deepEqual(diffOdds(a, b).pulled, ['scraper:draftkings|draftkings|fg|receptions|over|5.5']);
});

test('a book moving its line (−7 → −7.5 on the same side) is a change on the new key, not a pull and a new price', () => {
  const game = (cur: OddsQuote[]): GameOddsPayload => ({ sport: 'cfb', gameId: 'g', asOf: T, latency: [], powerRatings: [],
    markets: [{ key: 'fg_sp', cur, hist: {}, open: {} }] });
  const a = keysOf(game([q('pinnacle', 'home', -7, -110), q('pinnacle', 'away', 7, -110)]));
  const b = keysOf(game([q('pinnacle', 'home', -7.5, -104), q('pinnacle', 'away', 7.5, -116)]));
  const d = diffOdds(a, b);
  assert.deepEqual(d.pulled, []);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.changes.map(c => [c.key, c.dir]).sort(), [
    ['scraper:pinnacle|pinnacle|fg|sp|away|7.5', 'down'],
    ['scraper:pinnacle|pinnacle|fg|sp|home|-7.5', 'up'],
  ]);
});

test('a price at a book never seen before is added, not returned', () => {
  const a = keysOf(player([q('draftkings', 'over', 5.5, -110)]));
  const b = keysOf(player([q('draftkings', 'over', 5.5, -110), q('fanatics', 'over', 5.5, -112)]));
  const d = diffOdds(a, b);
  assert.deepEqual(d.added, ['scraper:fanatics|fanatics|fg|receptions|over|5.5']);
  assert.deepEqual(d.returned, []);
});

test('a new history row is a new move; an old one is not', () => {
  const h1 = { pinnacle: [[T, 5.5, -110, -110]] as [string, number, number, number][] };
  const h2 = { pinnacle: [...h1.pinnacle, ['2026-09-25T17:02:00.000Z', 6.5, -105, -115]] as [string, number, number, number][] };
  const d = diffOdds(keysOf(player([q('pinnacle', 'over', 5.5, -110)], h1)), keysOf(player([q('pinnacle', 'over', 6.5, -105)], h2)));
  assert.deepEqual(d.newMoves, ['pinnacle|fg|receptions|2026-09-25T17:02:00.000Z']);
});

test('game payloads key by period; the Slate keys each game summary by game', () => {
  const game: GameOddsPayload = { sport: 'nfl', gameId: 'g1', asOf: T, latency: [], powerRatings: [],
    markets: [{ key: '1h_sp', cur: [q('pinnacle', 'home', -3.5, -110)], hist: {}, open: {} }] };
  assert.ok(keysOf(game).prices.has('scraper:pinnacle|pinnacle|1h|sp|home|-3.5'));
  const slate = (home: number): SlateOddsPayload => ({ sport: 'mlb', date: '2026-09-25', asOf: T, buildMs: 1, games: [{
    gameId: '823085', books: 1, checkedAt: T, ml: { home: null, away: null, hold: null }, pinnacle: null,
    total: { line: 8.5, open: 8 }, spread: { line: null, open: null }, moved: null, dk: null, kalshi24h: null,
    board: { draftkings: { home, away: 120 } }, totalLines: [], steam: [], dropping: [], pulls: [] }] });
  const d = diffOdds(keysOf(slate(-130)), keysOf(slate(-125)));
  assert.deepEqual(d.changes.map(c => [c.key, c.dir]), [['slate|draftkings|823085:fg|ml|home|', 'up']]);
});
