import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nbaShotSection, shotDistance, shotFamily, shotZone, type NbaShot, type NbaShotsPayload } from '../lib/sports/nba/playerShotShapes';

/**
 * R6.5 — NBA's "Shot profile". The fixtures are built to the geometry measured
 * on the real table (`scripts/measure-hoops-hockey.ts`): x 0-50 across, y in
 * feet OUT FROM THE RIM, `point_value` only ever 2 or 3.
 */
const shot = (over: Partial<NbaShot> = {}): NbaShot => ({
  date: '2026-01-15',
  season: 2026,
  x: 25,
  y: 3,
  pointValue: 2,
  made: true,
  shotType: 'Driving Layup Shot',
  opponent: null,
  ...over,
});
const payload = (shots: NbaShot[]): NbaShotsPayload => ({
  shooterId: 4278073,
  seasons: [...new Set(shots.map((s) => s.season))].sort((a, b) => a - b),
  shots,
  asOf: '2026-09-15T06:00:00Z',
});
const input = (shots: NbaShot[], over: Partial<Parameters<typeof nbaShotSection>[0]> = {}) => ({
  season: null,
  data: payload(shots),
  loading: false,
  error: null,
  ...over,
});

test('the rim is the origin, so distance is measured from it', () => {
  assert.equal(shotDistance({ x: 25, y: 0 }), 0);
  // A corner three sits 22 ft from the rim by rule; x = 3 is the corner line.
  assert.equal(Math.round(shotDistance({ x: 3, y: 0 }) as number), 22);
  assert.equal(shotDistance({ x: null, y: 4 }), null);
});

test('zones tell a corner three from an above-the-break three by where it is', () => {
  assert.equal(shotZone(shot({ x: 25, y: 2, pointValue: 2 })), 'restricted');
  assert.equal(shotZone(shot({ x: 28, y: 10, pointValue: 2 })), 'paint');
  assert.equal(shotZone(shot({ x: 38, y: 12, pointValue: 2 })), 'mid');
  // Same point value, same shooter: only the position separates these two.
  assert.equal(shotZone(shot({ x: 3, y: 2, pointValue: 3 })), 'corner3');
  assert.equal(shotZone(shot({ x: 25, y: 24, pointValue: 3 })), 'break3');
  assert.equal(shotZone(shot({ x: null, y: null })), null);
});

test('the league tagging a shot 3 outweighs the geometry', () => {
  // A shot the feed placed slightly short of the arc but scored as a three is
  // a three: the point value is what actually happened.
  assert.equal(shotZone(shot({ x: 25, y: 21, pointValue: 3 })), 'break3');
});

test('shot types roll into families, and an unnamed type says so', () => {
  assert.equal(shotFamily('Pullup Jump Shot').key, 'pullup');
  assert.equal(shotFamily('Driving Finger Roll Layup').key, 'layup');
  assert.equal(shotFamily('Step Back Jump Shot').key, 'stepback');
  assert.equal(shotFamily('Running Dunk Shot').key, 'dunk');
  assert.equal(shotFamily(null).label, 'Unspecified');
});

test('the section is the chart beside the zone table, then the type table', () => {
  const sec = nbaShotSection(input([shot(), shot({ made: false })]));
  assert.equal(sec.state.kind, 'ready');
  assert.deepEqual([sec.id, sec.title], ['shots', 'Shot profile']);
  assert.deepEqual(sec.rows.map((r) => r.map((c) => c.key)), [['chart', 'zones'], ['types']]);
});

test('by zone reports points per shot, which is the point of the card', () => {
  const shots = [
    ...Array.from({ length: 10 }, () => shot({ x: 25, y: 24, pointValue: 3, made: false, shotType: 'Jump Shot' })),
    ...Array.from({ length: 4 }, () => shot({ x: 25, y: 24, pointValue: 3, made: true, shotType: 'Jump Shot' })),
    ...Array.from({ length: 10 }, () => shot({ x: 30, y: 15, pointValue: 2, made: true, shotType: 'Jump Shot' })),
  ];
  const card = nbaShotSection(input(shots)).rows[0][1];
  assert.ok(card.kind === 'table');
  const three = card.rows.find((r) => r.key === 'break3')!;
  assert.equal(three.values.n, 14);
  assert.equal(three.values.m, 4);
  // 4 makes worth 3 over 14 attempts = 0.857 — better than a 100% long two would
  // have to work for, which is the comparison the column exists to enable.
  assert.equal(Math.round((three.values.pps as number) * 100), 86);
  const mid = card.rows.find((r) => r.key === 'mid')!;
  assert.equal(mid.values.pps, 2);
  // A zone with no attempts is not a row of zeroes.
  assert.ok(card.rows.every((r) => (r.values.n as number) > 0));
});

test('an unplaced attempt is counted by type and stated, never silently dropped', () => {
  const shots = [shot(), shot({ x: null, y: null, shotType: 'Jump Shot' })];
  const sec = nbaShotSection(input(shots));
  const chart = sec.rows[0][0];
  const types = sec.rows[1][0];
  assert.ok(chart.kind === 'scatter' && types.kind === 'table');
  assert.equal(chart.points.length, 1, 'the chart can only draw what was placed');
  assert.equal(
    types.rows.reduce((a, r) => a + (r.values.n as number), 0),
    2,
    'the type table counts both',
  );
  assert.match(sec.note ?? '', /1 of 2 attempts carry a location/);
});

test('the season control lists every season held, and filters to one', () => {
  const sec = nbaShotSection(input([shot({ season: 2025 }), shot({ season: 2026 }), shot({ season: 2026 })], { season: 2026 }));
  assert.deepEqual(sec.season?.options.map((o) => o.label), ['2025-26', '2024-25']);
  const chart = sec.rows[0][0];
  assert.ok(chart.kind === 'scatter' && chart.points.length === 2);
});

test('colour is the outcome: a make is emphasised, and the groups stay the families', () => {
  const sec = nbaShotSection(input([shot({ made: true }), shot({ made: false, shotType: 'Jump Shot' })]));
  const chart = sec.rows[0][0];
  assert.ok(chart.kind === 'scatter');
  assert.equal(chart.surface, 'court');
  assert.deepEqual(chart.emphasis, [true, false]);
  assert.deepEqual(chart.legend?.map((l) => l.label), ['Made', 'Missed']);
  assert.deepEqual(chart.groups.map((g) => g.key).sort(), ['jumper', 'layup']);
});

test('loading, error and a player with no shots each say which they are', () => {
  assert.equal(nbaShotSection(input([], { loading: true })).state.kind, 'loading');
  assert.equal(nbaShotSection(input([], { error: 'nope' })).state.kind, 'error');
  const none = nbaShotSection(input([], { data: null, emptyReason: 'no rows' }));
  assert.equal(none.state.kind === 'empty' ? none.state.reason : '', 'no rows');
});
