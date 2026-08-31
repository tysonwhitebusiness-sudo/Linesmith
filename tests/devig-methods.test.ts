import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devigBy, devigPower, devigShin, devigWorstCase, DEVIG_METHODS } from '../lib/odds/devigMethods';
import { scoreMethods, MIN_SAMPLE_FOR_VERDICT, type DevigObservation } from '../lib/odds/devigBacktest';

/**
 * De-vig methods and their backtest — Phase 6.24.
 *
 * These are testable against properties the mathematics guarantees, which is
 * better than pinning outputs: a symmetric price must split evenly under every
 * normalising method, and power and Shin must shade the longshot relative to
 * multiplicative or they are not doing the thing they exist to do.
 */

/** -110 / -110. */
const SYMMETRIC: [number, number] = [1.909090909, 1.909090909];
/** A heavy favourite against a longshot, ~3.4% overround. */
const LOPSIDED: [number, number] = [1.10, 8.00];

test('every normalising method splits a symmetric price evenly', () => {
  for (const m of ['multiplicative', 'power', 'shin'] as const) {
    const r = devigBy(m, ...SYMMETRIC)!;
    assert.equal(r.a.toFixed(6), '0.500000', `${m} did not split -110/-110 evenly`);
    assert.equal((r.a + r.b).toFixed(6), '1.000000', `${m} must sum to one`);
  }
});

test('worst case does NOT sum to one, and that is the point', () => {
  // It is a floor, not a distribution: each side assumes the whole margin sits
  // on the other. Normalising it would turn a conservative bound back into a
  // point estimate.
  const r = devigWorstCase(...SYMMETRIC)!;
  assert.ok(r.a + r.b < 1, 'worst case should sum to 2 - booksum, which is below one');
  assert.equal((r.a + r.b).toFixed(4), (2 - (1 / SYMMETRIC[0] + 1 / SYMMETRIC[1])).toFixed(4));
});

test('worst case is never more generous than multiplicative', () => {
  for (const pair of [SYMMETRIC, LOPSIDED]) {
    const w = devigWorstCase(...pair)!;
    const m = devigBy('multiplicative', ...pair)!;
    assert.ok(w.a <= m.a + 1e-9, 'a floor that exceeds the point estimate is not a floor');
    assert.ok(w.b <= m.b + 1e-9);
  }
});

test('power and Shin shade the longshot relative to multiplicative', () => {
  // This is the favourite-longshot direction and the whole reason to offer
  // them. `b` is the longshot side of LOPSIDED.
  const mult = devigBy('multiplicative', ...LOPSIDED)!;
  const pow = devigPower(...LOPSIDED)!;
  const shin = devigShin(...LOPSIDED)!;
  assert.ok(pow.b < mult.b, `power ${pow.b} should be below multiplicative ${mult.b}`);
  assert.ok(shin.b < mult.b, `shin ${shin.b} should be below multiplicative ${mult.b}`);
  // Power shades harder than Shin at this overround.
  assert.ok(pow.b < shin.b);
});

test('a price with no overround is returned unchanged, not "corrected"', () => {
  // Two sides at +100/+100 sum to exactly 1. There is no margin to remove and
  // inventing one would move a fair price.
  const r = devigPower(2.0, 2.0)!;
  assert.equal(r.a.toFixed(6), '0.500000');
  assert.equal(r.overround.toFixed(6), '0.000000');
});

test('unusable prices produce null on every method', () => {
  for (const m of DEVIG_METHODS) {
    assert.equal(devigBy(m, null, 2.0), null);
    assert.equal(devigBy(m, 1.0, 2.0), null, 'a decimal of 1.0 is a zero-payout price');
    assert.equal(devigBy(m, NaN, 2.0), null);
  }
});

test('the overround reported is the booksum minus one', () => {
  const r = devigBy('multiplicative', ...LOPSIDED)!;
  assert.equal(r.overround.toFixed(6), (1 / 1.1 + 1 / 8.0 - 1).toFixed(6));
});

// ---------------------------------------------------------------------------
// The backtest
// ---------------------------------------------------------------------------

function obs(n: number, homeWon: 0 | 1): DevigObservation[] {
  return Array.from({ length: n }, (_, i) => ({
    gameId: String(i),
    homeDecimal: 1.909090909,
    awayDecimal: 1.909090909,
    homeWon,
  }));
}

test('no winner is declared below the sample floor', () => {
  // Ranking four methods on a sample that cannot separate them produces a
  // confident answer with no information in it. Measured today: 82 games.
  const r = scoreMethods(obs(82, 1));
  assert.equal(r.sampleSize, 82);
  assert.equal(r.verdict, null, 'eighty-two games must not name a winner');
  assert.match(r.note, /below the 1000/);
});

test('a winner is declared once the floor is cleared', () => {
  const r = scoreMethods([...obs(MIN_SAMPLE_FOR_VERDICT, 1)]);
  assert.ok(r.verdict, 'at the floor a verdict should be reported');
  assert.equal(r.scores[0].method, r.verdict, 'the verdict is the best-scoring method');
});

test('methods are ranked on Brier, ascending — lower is better', () => {
  const r = scoreMethods(obs(1200, 1));
  for (let i = 1; i < r.scores.length; i++) {
    assert.ok(r.scores[i - 1].brier <= r.scores[i].brier, 'scores must be sorted best-first');
  }
});

test('the realised rate is reported beside the predictions', () => {
  // Without it, a mean prediction of 0.52 says nothing about whether it was right.
  const r = scoreMethods([...obs(50, 1), ...obs(50, 0)]);
  assert.equal(r.realisedHomeWinRate, 0.5);
});
