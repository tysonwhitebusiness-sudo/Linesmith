import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPriceRange } from '../lib/sports/shared/priceRange';
import type { UnifiedGameLine } from '../lib/odds/types';

/**
 * The game page's price-dispersion card — Phase 6.20.
 *
 * `RangeBar` was written for this card in the chart-grammar pass and then
 * never rendered on any page; these guard the shaping that feeds it.
 */

function line(books: Array<[string, number]>): UnifiedGameLine {
  return { bookmakers: books.map(([bookmaker, homeOdds]) => ({ bookmaker, homeOdds })) } as UnifiedGameLine;
}

test('three books is the floor — below it the grid already says everything', () => {
  assert.equal(toPriceRange(line([['a', 1.9], ['b', 2.0]]), 'NYY'), null);
  assert.ok(toPriceRange(line([['a', 1.9], ['b', 2.0], ['c', 2.1]]), 'NYY'));
});

test('an absent or empty game line renders nothing rather than an empty axis', () => {
  assert.equal(toPriceRange(null, 'NYY'), null);
  assert.equal(toPriceRange(line([]), 'NYY'), null);
});

test('the best home price is the largest American number, across both signs', () => {
  // +150 beats -110 beats -200. One ordering, no special case at zero.
  const r = toPriceRange(line([['short', 1.5], ['mid', 1.91], ['long', 2.5]]), 'NYY')!;
  assert.equal(r.highlightBook, 'long', '+150 is the best price for a home backer');
});

test('the consensus is the median, not the midpoint of the range', () => {
  // Four books bunched low and one far high: the midpoint would sit far above
  // every price but one. RangeBar draws consensus as its own hairline exactly
  // so the two can be seen to differ.
  const r = toPriceRange(
    line([['a', 1.90], ['b', 1.91], ['c', 1.92], ['d', 1.93], ['e', 4.0]]),
    'NYY',
  )!;
  const values = r.points.map((p) => p.value).sort((x, y) => x - y);
  const midpoint = (values[0] + values[values.length - 1]) / 2;
  assert.equal(r.consensus, values[2], 'the median of five prices is the third');
  assert.notEqual(r.consensus, midpoint);
});

test('a book with no home price is dropped, not counted as zero', () => {
  const raw = { bookmakers: [{ bookmaker: 'a', homeOdds: 1.9 }, { bookmaker: 'b' }, { bookmaker: 'c', homeOdds: 2.0 }, { bookmaker: 'd', homeOdds: 2.1 }] } as UnifiedGameLine;
  const r = toPriceRange(raw, 'NYY')!;
  assert.equal(r.points.length, 3, 'the priceless book must not become a tick at 0');
  assert.ok(!r.points.some((p) => p.book === 'b'));
});

test('the title names whose price it is', () => {
  // The board draws "NYY moneyline" — one named side, not both on one axis.
  const r = toPriceRange(line([['a', 1.9], ['b', 2.0], ['c', 2.1]]), 'BOS')!;
  assert.equal(r.title, 'BOS moneyline');
});
