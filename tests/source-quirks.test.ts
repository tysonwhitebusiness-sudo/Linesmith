import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundOrder } from '../lib/sports/tennis/tennismylife';

/**
 * R2 source quirks. TennisMyLife's `tourney_date` is the tournament START, so
 * every match in an event shares a date and only the round orders a player's
 * run through the draw.
 */

test('rounds order a draw from qualifying to the final', () => {
  const rounds = ['F', 'R32', 'Q2', 'SF', 'R16', 'QF', 'RR', 'R128', 'R64'];
  const sorted = [...rounds].sort((a, b) => roundOrder(a, '1') - roundOrder(b, '1'));
  assert.deepEqual(sorted, ['Q2', 'RR', 'R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']);
});

test('match number breaks ties inside a round, and never outranks the round', () => {
  assert.ok(roundOrder('R32', '2') > roundOrder('R32', '1'));
  assert.ok(roundOrder('R16', '1') > roundOrder('R32', '300'));
});

test('an unknown or missing round sorts with round-robin, before the knockout', () => {
  assert.equal(roundOrder(undefined, undefined), roundOrder('RR', undefined));
  assert.ok(roundOrder('', '') < roundOrder('R128', '1'));
});
