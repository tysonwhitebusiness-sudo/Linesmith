import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatInningsPitched, inningsPitchedToOuts, outsToInnings } from '../lib/sports/mlb/innings';

test('whole.thirds notation parses to outs', () => {
  assert.equal(inningsPitchedToOuts('6.1'), 19);
  assert.equal(inningsPitchedToOuts('6.2'), 20);
  assert.equal(inningsPitchedToOuts('7'), 21);
  assert.equal(inningsPitchedToOuts('0.0'), 0);
  assert.equal(inningsPitchedToOuts(5.2), 17, 'a number that still reads as notation');
});

test('totals are summed as outs, not as decimals', () => {
  const outs = ['5.2', '6.2'].reduce((sum, ip) => sum + inningsPitchedToOuts(ip)!, 0);
  assert.equal(formatInningsPitched(outs), '12.1');
  assert.notEqual(formatInningsPitched(outs), String(5.2 + 6.2), 'the decimal sum is 11.4, which cannot exist');
});

test('values that are not notation are refused, not guessed at', () => {
  for (const bad of ['6.3', '6.33', 6.666, '-1', 'abc', '', null, undefined]) {
    assert.equal(inningsPitchedToOuts(bad), null, String(bad));
  }
});

test('real innings for rates', () => {
  assert.equal(outsToInnings(19), 19 / 3);
});
