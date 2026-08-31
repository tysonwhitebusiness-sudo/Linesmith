import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impliedProbability, summariseClv, type BetClv } from '../lib/odds/userClv';

/**
 * User-facing CLV — Phase 6.21.
 *
 * THE DATABASE HALF IS VERIFIED BY RUNNING IT, not mocked here: against a real
 * `game_odds_history` series the closing read returns the true last
 * observation, matches book names case-insensitively, and a synthetic bet
 * taken at -76 against a -136 close scores +0.1445 while one taken at -196
 * scores -0.0859. What is asserted below is the arithmetic and the reporting
 * of missing data, which is where this can be quietly wrong.
 */

function clv(v: number | null, unmeasured: BetClv['unmeasured'] = null): BetClv {
  return { betId: 'x', entryOdds: -110, closing: null, clvProbPoints: v, unmeasured };
}

test('implied probability is right on both sides of zero', () => {
  assert.equal(impliedProbability(-110)!.toFixed(4), '0.5238');
  assert.equal(impliedProbability(150)!.toFixed(4), '0.4000');
  assert.equal(impliedProbability(100)!.toFixed(4), '0.5000');
});

test('a price that cannot be read is null, never zero', () => {
  // Zero would read as "this bet was a certainty against", which is a claim.
  for (const bad of [null, undefined, 0, NaN, Infinity]) {
    assert.equal(impliedProbability(bad as number), null, `${bad} should not produce a probability`);
  }
});

test('positive CLV means the bettor beat the close', () => {
  // Close minus entry: a longer price than the close is a lower implied
  // probability at entry, so the difference is positive. Same sign convention
  // `clv_backtest.py` prints for the model.
  const entry = impliedProbability(-76)!;
  const close = impliedProbability(-136)!;
  assert.ok(close - entry > 0, 'taking -76 into a -136 close is beating the close');
});

test('unmeasured bets are EXCLUDED from the average, not counted as zero', () => {
  // Counting them as zero pulls the mean toward zero in proportion to how
  // badly covered the history is, which reads as "you are exactly average" —
  // the most misleading possible summary of missing data.
  const s = summariseClv([clv(0.10), clv(0.20), clv(null, 'no-closing-price'), clv(null, 'no-bookmaker')]);
  assert.equal(s.betsConsidered, 4);
  assert.equal(s.betsMeasured, 2);
  assert.equal(s.meanClvProbPoints!.toFixed(4), '0.1500', 'the two nulls must not drag the mean to 0.075');
});

test('the summary says WHY each unmeasured bet was unmeasured', () => {
  const s = summariseClv([clv(0.1), clv(null, 'no-bookmaker'), clv(null, 'no-bookmaker'), clv(null, 'no-reference-time')]);
  assert.deepEqual(s.unmeasuredReasons, { 'no-bookmaker': 2, 'no-reference-time': 1 });
});

test('nothing measured reports null, not zero', () => {
  const s = summariseClv([clv(null, 'no-closing-price')]);
  assert.equal(s.meanClvProbPoints, null);
  assert.equal(s.positiveClvRate, null, 'a rate off zero bets is not 0%, it is unknown');
});

test('the positive rate counts strictly-positive CLV', () => {
  const s = summariseClv([clv(0.1), clv(-0.1), clv(0), clv(0.2)]);
  assert.equal(s.positiveClvRate, 0.5, 'exactly matching the close is not beating it');
});
