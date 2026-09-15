import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mlbHitterSection } from '../lib/sports/mlb/adapters/playerResearchSections';
import type { PlayerStatcastRow, PlayerStatcastSeason } from '../lib/sports/mlb/statcastRollupShapes';

/**
 * R6.1b — MLB's "Contact quality & approach" as data, built from Witt's G2
 * Statcast block (the same formulas R5a's rollup reproduces field for field).
 */
const g2 = JSON.parse(readFileSync('docs/design/phase-g2/data/player-mlb-witt.json', 'utf8'));
const S = g2.statcast.seasons['2026'] as PlayerStatcastSeason;
const pct = g2.statcast.percentiles2026;
const row = (payload: PlayerStatcastSeason): PlayerStatcastRow => ({ season: 2026, playerId: 677951, role: 'bat', asOf: '2026-09-11', qualified: true, payload });
const input = (batting: PlayerStatcastRow | null, extra: Partial<Parameters<typeof mlbHitterSection>[0]> = {}) => ({ season: 2026, seasons: [2026, 2025], batting, pitching: null, loading: false, error: null, ...extra });

test('the section is G2s cards, in G2s order, from the rollup row', () => {
  const sec = mlbHitterSection(input(row({ ...S, percentiles: { ...pct, minBip: 150, sweetSpot: 50, barrelish: 50 }, sweetSpot: 35, barrelish: 10 })));
  assert.equal(sec.state.kind, 'ready');
  assert.deepEqual(sec.rows.map((r) => r.map((c) => c.key)), [['power', 'evHist'], ['evByGame'], ['pitchTypes', 'zone'], ['hands', 'homeRuns']]);
  const power = sec.rows[0][0];
  assert.ok(power.kind === 'percentiles');
  assert.equal(power.rows.find((r) => r.key === 'maxEV')?.valueText, `${S.maxEV!.toFixed(1)} mph`);
  assert.equal(power.rows.find((r) => r.key === 'maxEV')?.percentile, pct.maxEV);
  const homers = sec.rows[3][1];
  assert.ok(homers.kind === 'table');
  assert.equal(homers.rows.length, S.hrList.length);
  assert.equal(sec.source?.asOf, '2026-09-11');
});

test('a hitter below the qualifier prints values with no percentile dot', () => {
  const sec = mlbHitterSection(input(row({ ...S, percentiles: undefined })));
  const power = sec.rows[0][0];
  assert.ok(power.kind === 'percentiles');
  assert.ok(power.rows.every((r) => r.percentile == null));
  assert.match(power.scope ?? '', /below the qualifier/);
});

test('the zone map carries the four chase zones and three views', () => {
  const sec = mlbHitterSection(input(row(S)));
  const zone = sec.rows[2][1];
  assert.ok(zone.kind === 'surface');
  assert.deepEqual(zone.views.map((v) => v.key), ['xwoba', 'swing', 'whiff']);
  assert.deepEqual(zone.views[0].role.outside?.map((c) => c.key), ['11', '12', '13', '14']);
  assert.equal(zone.views[0].role.cells[1][1].value, S.zones['5'].xwoba);
});

test('loading, error and no batting row are states, never empty cards', () => {
  assert.equal(mlbHitterSection(input(null, { loading: true })).state.kind, 'loading');
  assert.equal(mlbHitterSection(input(null, { error: 'x' })).state.kind, 'error');
  const none = mlbHitterSection(input(null));
  assert.equal(none.state.kind, 'empty');
  assert.equal(none.rows.length, 0);
});

test('coverage is stated when the pitch data holds under 99% of the season', () => {
  const held = (S.splitsByHand.L?.pa ?? 0) + (S.splitsByHand.R?.pa ?? 0);
  assert.equal(mlbHitterSection(input(row(S)), held).note, undefined);
  const note = mlbHitterSection(input(row(S)), Math.round(held / 0.92)).note ?? '';
  assert.match(note, new RegExp(`Statcast holds ${held} of this player's`));
  assert.match(note, /\(92%\)/);
});
