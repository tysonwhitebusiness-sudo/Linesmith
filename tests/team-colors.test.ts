import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEAM_PRIMARY_COLOR as MLB } from '../lib/sports/mlb/teamColors';
import { TEAM_PRIMARY_COLOR as NFL } from '../lib/sports/nfl/teamColors';
import { CHARCOAL, bandColors, contrast, teamColor, type TeamColorIndex } from '../lib/sports/shared/teamColors';

/**
 * C0.2's guard — every team band carries white text at 4.5:1, or falls back
 * to charcoal. Never a band you can't read.
 */

const white = '#ffffff';

test('every NFL and MLB team band carries white text at 4.5:1', () => {
  for (const [team, hex] of [...Object.entries(NFL), ...Object.entries(MLB)]) {
    const b = bandColors({ primary: hex, secondary: null });
    for (const stop of b.stops) assert.ok(contrast(stop, white) >= 4.5, `${team} ${hex} → ${stop}`);
  }
});

test('a sample of the other leagues (ESPN colours, 2026-09-21) does too', () => {
  const sample: Array<[string, string, string | null]> = [
    ['ALA', '#9e1b32', null],
    ['LAL', '#552583', '#fdb927'],
    ['TOR', '#003e7e', null],
    ['ARS', '#e20520', '#003399'],
    ['BOU', '#f42727', '#b57edc'],
    ['ACU', '#592d82', '#b1b3b3'],
  ];
  for (const [team, primary, secondary] of sample) {
    const b = bandColors({ primary, secondary });
    for (const stop of b.stops) assert.ok(contrast(stop, white) >= 4.5, `${team} → ${stop}`);
    if (b.accent) assert.ok(contrast(b.accent.bg, b.accent.ink) >= 4.5, `${team} accent`);
  }
});

test("the Vikings band matches the mockup's gradient, and gold takes a dark ink", () => {
  const b = bandColors({ primary: '#4f2683', secondary: '#ffc62f' });
  assert.deepEqual(b.stops, ['#4f2683', '#3a1c61', '#2a1445']);
  assert.equal(b.source, 'primary');
  assert.ok(b.accent && contrast(b.accent.bg, b.accent.ink) >= 4.5);
  assert.notEqual(b.accent?.ink, '#ffffff');
});

test('a primary that cannot carry white text falls back: secondary, then charcoal', () => {
  // NO's gold is too light to darken without turning to mud; LV's black has no hue.
  assert.equal(bandColors({ primary: '#d3bc8d', secondary: '#101820' }).source, 'secondary');
  assert.equal(bandColors({ primary: '#d3bc8d', secondary: null }).source, 'charcoal');
  // Dark team colours keep their hue (an absolute grey test called Green Bay grey).
  assert.equal(bandColors({ primary: '#203731', secondary: null }).source, 'primary');
  assert.equal(bandColors({ primary: '#000000', secondary: '#a5acaf' }).source, 'charcoal');
  assert.equal(bandColors({ primary: '#fdb927', secondary: '#552583' }).source, 'secondary');
  // No team (golf, tennis): charcoal, and no accent.
  const none = bandColors(null);
  assert.equal(none.stops[0], CHARCOAL);
  assert.equal(none.accent, null);
});

test('teamColor looks up by id first, then abbreviation, case-insensitively', () => {
  const index: TeamColorIndex = { byId: { '147': { primary: '#0c2340', secondary: null } }, byAbbr: { MIN: { primary: '#4f2683', secondary: '#ffc62f' } } };
  assert.equal(teamColor(index, { id: 147 })?.primary, '#0c2340');
  assert.equal(teamColor(index, { abbr: 'min' })?.primary, '#4f2683');
  assert.equal(teamColor(index, { id: 1, abbr: 'XYZ' }), null);
  assert.equal(teamColor(null, { abbr: 'MIN' }), null);
});
