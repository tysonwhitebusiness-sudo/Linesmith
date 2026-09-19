import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameFits, normName, parseRaw } from '../lib/sports/tennis/deepHeadToHead';

/**
 * R12e — tennis head to head before 2024 is matched by NAME (tennis-data.co.uk's
 * "Surname I." form), then verified against each player's own match dates. These
 * cases are the forms measured in `game_result` on 2026-09-19.
 */

test('raw names parse into surname and initials, whatever the punctuation', () => {
  assert.deepEqual(parseRaw('Zverev A.'), { surname: 'zverev', initials: 'a' });
  assert.deepEqual(parseRaw('Auger-Aliassime F.'), { surname: 'auger aliassime', initials: 'f' });
  assert.deepEqual(parseRaw('Lee C.Y.'), { surname: 'lee', initials: 'cy' });
  assert.deepEqual(parseRaw('Soler Espinosa S..'), { surname: 'soler espinosa', initials: 's' });
  assert.deepEqual(parseRaw('Lu J.J'), { surname: 'lu', initials: 'jj' });
  assert.deepEqual(parseRaw('Wang Xiyu'), { surname: 'wang', initials: 'xiyu' });
  assert.equal(normName('Félix Auger-Aliassime'), 'felix auger aliassime');
});

test('a full name fits its source form, with compound surnames, initials and either name order', () => {
  assert.ok(nameFits('Alexander Zverev', 'Zverev A.'));
  assert.ok(nameFits('Félix Auger-Aliassime', 'Auger-Aliassime F.'));
  assert.ok(nameFits('Alex de Minaur', 'De Minaur A.'));
  assert.ok(nameFits('Roberto Bautista Agut', 'Bautista Agut R.'));
  assert.ok(nameFits('Juan Martin del Potro', 'Del Potro J.M.'));
  assert.ok(nameFits('Zhang Zhizhen', 'Zhang Z.'), 'surname first');
  assert.ok(nameFits('Chia-Yi Lee', 'Lee C.Y.'), 'hyphenated given name as two initials');
});

test('the source\'s own disambiguation is respected: Kristyna is not Karolina, Xinyu is not Xiyu', () => {
  assert.ok(nameFits('Karolina Pliskova', 'Pliskova Ka.'));
  assert.ok(!nameFits('Karolina Pliskova', 'Pliskova Kr.'));
  assert.ok(nameFits('Kristyna Pliskova', 'Pliskova Kr.'));
  assert.ok(nameFits('Xiyu Wang', 'Wang Xiyu'));
  assert.ok(!nameFits('Xinyu Wang', 'Wang Xiyu'));
  assert.ok(nameFits('Xinyu Wang', 'Wang Xin.'));
  // Another initial is another player.
  assert.ok(!nameFits('Alexander Zverev', 'Zverev M.'));
});
