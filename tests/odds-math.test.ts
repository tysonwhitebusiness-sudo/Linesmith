/**
 * Task 3.11 — the display layer's odds math.
 *
 * Scoped by standing decision Q2: model math lives in Python and has its own
 * tests there. What TypeScript still owns is the conversion and de-vig code
 * that decides what a user actually sees, and that is what this covers.
 *
 * The American/decimal table comes from audit P3 §2.1, which verified these
 * conversions by hand; encoding it here means a future "simplification" of
 * the formula has to reproduce the same numbers rather than merely compile.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { devigTwoWay } from '../lib/odds/devig';
import { americanToDecimal, decimalToAmerican, impliedFromDecimal } from '../lib/odds/display';

const close = (a: number | undefined, b: number, eps = 1e-9) =>
  assert.ok(a !== undefined && Math.abs(a - b) < eps, `expected ~${b}, got ${a}`);

test('american -> decimal, both signs and the boundaries', () => {
  close(americanToDecimal(100), 2.0);
  close(americanToDecimal(-100), 2.0);
  close(americanToDecimal(150), 2.5);
  close(americanToDecimal(-150), 1 + 100 / 150);
  close(americanToDecimal(-110), 1 + 100 / 110);
  close(americanToDecimal(200), 3.0);
  close(americanToDecimal(-200), 1.5);
});

test('decimal -> american round-trips', () => {
  for (const price of [100, 150, -150, -110, 200, -200, 250, -333]) {
    const back = decimalToAmerican(americanToDecimal(price));
    assert.ok(back !== undefined, `no round trip for ${price}`);
    assert.ok(Math.abs(back - price) <= 1, `round trip drifted: ${price} -> ${back}`);
  }
});

test('-100 and +100 are the same price, and +100 is the canonical form', () => {
  // -100 is excluded from the round-trip above on purpose. Both are even
  // money — decimal 2.0 — and there is only one sensible way back, so
  // decimalToAmerican returns +100 for both. Asserting a -100 round trip
  // would be asserting a bug into existence, which the first version of this
  // test did until it failed and the arithmetic was checked rather than the
  // code "fixed".
  close(americanToDecimal(-100), 2.0);
  close(americanToDecimal(100), 2.0);
  assert.equal(decimalToAmerican(2.0), 100);
});

test('null and undefined stay null rather than becoming 0', () => {
  // A silent 0 here would read as "even money" downstream, which is the kind
  // of plausible-but-wrong value this codebase's audit was written to catch.
  assert.equal(americanToDecimal(null), undefined);
  assert.equal(americanToDecimal(undefined), undefined);
  assert.equal(decimalToAmerican(null), undefined);
  assert.equal(impliedFromDecimal(null), undefined);
});

test('implied probability from decimal', () => {
  close(impliedFromDecimal(2.0), 0.5);
  close(impliedFromDecimal(4.0), 0.25);
  close(impliedFromDecimal(1.5), 1 / 1.5);
});

test('de-vig of a two-way market sums to 1', () => {
  // The property that matters, and the one Phase 1.1 (finding P3 C3) turned on:
  // the two sides are complements. A de-vig that does not sum to 1 means the
  // over and under disagree about the same event.
  for (const [a, b] of [
    [-110, -110],
    [-120, +100],
    [+150, -180],
    [-250, +200],
  ] as const) {
    const out = devigTwoWay(americanToDecimal(a), americanToDecimal(b));
    assert.ok(out, `no devig for ${a}/${b}`);
    close(out.a + out.b, 1.0, 1e-9);
    assert.ok(out.a > 0 && out.a < 1, 'probabilities must be in (0,1)');
  }
});

test('de-vig removes the vig rather than passing implied probabilities through', () => {
  // -110/-110 implies 0.5238 a side, 1.0476 total. After de-vig each side is
  // 0.5 exactly. If this ever returns 0.5238 the vig is still in the number.
  const out = devigTwoWay(americanToDecimal(-110), americanToDecimal(-110));
  assert.ok(out);
  close(out.a, 0.5, 1e-9);
  close(out.b, 0.5, 1e-9);
});

test('the favourite gets the larger de-vigged probability', () => {
  // Guards against an argument-order swap — the class of bug P3 C3 actually
  // was, where a side got its opponent's number.
  const out = devigTwoWay(americanToDecimal(-250), americanToDecimal(+200));
  assert.ok(out);
  assert.ok(out.a > out.b, `favourite (-250) should exceed underdog (+200): ${out.a} vs ${out.b}`);
});

test('de-vig refuses incomplete input instead of guessing', () => {
  assert.equal(devigTwoWay(undefined, 2.0), null);
  assert.equal(devigTwoWay(2.0, undefined), null);
  assert.equal(devigTwoWay(null, null), null);
});
