/**
 * Task 5.5 (P3 C1) — the displayed best total/spread must come from ONE point.
 *
 * `bestTotalFromBooks` and `bestSpreadFromBooks` used to maximise each side
 * across EVERY book regardless of the line that book was quoting, then report
 * whichever side's point happened to win. So the displayed "best over" could be
 * one book's 7.5 sitting beside another book's 9.5 "best under", labelled as a
 * single proposition — and the de-vigged probability shown next to it was
 * derived from two prices for two different bets.
 *
 * Live MLB data carries 21 distinct total points across four sources, so this
 * is a real condition rather than a theoretical one.
 *
 * The fixture is built so the pre-fix code demonstrably gets it wrong: the
 * highest over price sits at a different point from the highest under price. A
 * test that only asserted "a point came back" would have passed before the fix.
 * Mirrors python-odds-service/src/test_modal_point.py, which covers the same
 * property on the Python twin (predict/mlb_game_lines.py).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bestSpreadFromBooks, bestTotalFromBooks, americanToDecimal } from '../lib/odds/display';
import type { BookmakerOdds } from '../lib/odds/types';

const tot = (bookmaker: string, point: number, overPrice: number, underPrice: number) =>
  ({ bookmaker, point, overPrice, underPrice }) as BookmakerOdds;

const spr = (bookmaker: string, spreadHome: number, spreadHomePrice: number, spreadAwayPrice: number) =>
  ({ bookmaker, spreadHome, spreadAway: -spreadHome, spreadHomePrice, spreadAwayPrice }) as BookmakerOdds;

test('best total: over and under come from the same point', () => {
  // B quotes 9.5 and has by far the longest over price. Pre-fix, B's over won
  // and dragged the reported point to 9.5, while the under came from a 7.5 book.
  const best = bestTotalFromBooks([
    tot('A', 7.5, 1.909, 1.909),
    tot('B', 9.5, 5.0, 1.166), // longest over, wrong line
    tot('C', 7.5, 1.952, 1.869), // best over AT the modal point
    tot('D', 7.5, 1.833, 2.0), // best under AT the modal point
  ]);

  assert.equal(best?.point, 7.5, 'modal point is 7.5 — three of four books quote it');
  assert.equal(best?.overPrice, -105, "over is C's, not B's +400 at a different line");
  assert.equal(best?.underPrice, 100, "under is D's");
  assert.equal(best?.book, undefined, 'two different books, so neither is named');
});

test('best total: the returned pair de-vigs to a real overround', () => {
  const best = bestTotalFromBooks([
    tot('A', 7.5, 1.909, 1.909),
    tot('B', 9.5, 5.0, 1.166),
    tot('C', 7.5, 1.952, 1.869),
    tot('D', 7.5, 1.833, 2.0),
  ]);
  const implied =
    1 / americanToDecimal(best!.overPrice)! + 1 / americanToDecimal(best!.underPrice)!;
  assert.ok(implied >= 1 && implied <= 1.1, `overround should be a real book's, got ${implied}`);

  // The pre-fix pairing (+400 over at 9.5, +100 under at 7.5) implies
  // 0.20 + 0.50 = 0.70 — a 30% NEGATIVE hold, which no book offers.
  const oldImplied = 1 / americanToDecimal(400)! + 1 / americanToDecimal(100)!;
  assert.ok(oldImplied < 1, 'the mixed-point pairing is impossible, which is the bug');
});

test('best spread: home and away come from the same point, away is the mirror', () => {
  const best = bestSpreadFromBooks([
    spr('A', -1.5, 1.909, 1.909),
    spr('B', -2.5, 4.5, 1.222), // longest home price, wrong line
    spr('C', -1.5, 1.952, 1.869),
    spr('D', -1.5, 1.833, 2.0),
  ]);
  assert.equal(best?.homePoint, -1.5);
  assert.equal(best?.awayPoint, 1.5, 'away point is the exact mirror');
  assert.equal(best?.homePrice, -105, "home is C's, not B's +350 at -2.5");
  assert.equal(best?.awayPrice, 100, "away is D's");
});

test('the common case does not regress: one book, one point', () => {
  const best = bestTotalFromBooks([tot('A', 8.5, 1.926, 1.893)]);
  assert.equal(best?.point, 8.5);
  assert.equal(best?.overPrice, -108);
  assert.equal(best?.underPrice, -112);
  assert.equal(best?.book, 'A', 'one book supplied both sides, so it is named');
});

test('an implausible price still cannot win best price (5.6 guard holds)', () => {
  const best = bestTotalFromBooks([
    tot('A', 8.5, 1.909, 1.909),
    tot('B', 8.5, 501, 1.909), // +50000, garbage
  ]);
  assert.equal(best?.overPrice, -110, 'the +50000 row is excluded');
});

test('no book quotes a point at all -> undefined, not a fabricated line', () => {
  assert.equal(bestTotalFromBooks([]), undefined);
  assert.equal(
    bestTotalFromBooks([{ bookmaker: 'A', overPrice: 1.9 } as BookmakerOdds]),
    undefined,
    'a price with no point is not a usable total',
  );
});
