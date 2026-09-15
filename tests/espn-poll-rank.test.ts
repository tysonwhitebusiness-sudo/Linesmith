import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollRank } from '../lib/sports/multiSport/teamSportEspn';

/**
 * R4 step 5 — CFB ranked opponents from the ESPN team schedule. Checked live on
 * 2026-09-14 against the G2 Ohio State schedule, 12 of 12 games equal; these are
 * the three shapes ESPN sends.
 */
test('poll rank: 1-25 is a rank, 99 is none, missing stays missing', () => {
  assert.equal(pollRank({ curatedRank: { current: 4 } }), 4, 'Texas at #4');
  assert.equal(pollRank({ curatedRank: { current: 99 } }), null, 'unranked, and every NFL team');
  assert.equal(pollRank({}), undefined);
});
