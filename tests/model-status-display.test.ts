/**
 * M1 — the display rule follows the model's status, and no page decides for
 * itself.
 *
 * Before this, "which model is real" lived across plan documents. Nothing in
 * the app could read it, so a baseline could render a probability beside a
 * price as readily as a gated model could — and one already does: NHL props
 * carry a temperature calibration but have never been through the prop gate.
 *
 * The rule under test:
 *   gated     probability beside implied, projection, pick, record
 *   baseline  pick and projection only; never a probability beside a price,
 *             never a record framed as a track record
 *   failed    nothing, and the page says why
 *   none      nothing
 *
 * The register itself is Python's (`src/model_status.py`, mirrored into
 * `model_status`); this checks the TypeScript read side that every surface
 * shares, plus the two foldings (`soccer_epl` -> soccer, `tennis_atp` -> tennis)
 * that exist because a model is built per sport, not per league.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  baseSport,
  findStatus,
  mayShowPick,
  mayShowProbability,
  mayShowRecord,
  statusLabel,
  statusOf,
  type ModelStatusRow,
} from '@/lib/models/modelStatus';

const row = (sport: string, kind: 'game' | 'prop', status: ModelStatusRow['status']): ModelStatusRow => ({
  sport,
  kind,
  engine: status === 'none' || status === 'failed' ? null : 'engine',
  status,
  evidence: 'measured somewhere, with a date',
  since: '2026-09-19',
  fittedAt: null,
  notes: null,
  gate: { test: 'a test', criteria: 'some criteria', minSample: 200 },
  checkedAt: '2026-09-19T00:00:00.000Z',
});

// The seeded register as of 2026-09-19, in miniature.
const rows: ModelStatusRow[] = [
  row('mlb', 'prop', 'gated'),
  row('mlb', 'game', 'baseline'),
  row('nfl', 'game', 'baseline'),
  row('nfl', 'prop', 'baseline'),
  row('nhl', 'prop', 'baseline'),
  row('cfb', 'game', 'baseline'),
  row('soccer', 'game', 'failed'),
  row('nba', 'prop', 'failed'),
  row('golf', 'prop', 'none'),
  row('tennis', 'game', 'none'),
];

test('a gated model may show a probability beside a price', () => {
  assert.equal(statusOf(rows, 'mlb', 'prop'), 'gated');
  assert.equal(mayShowProbability(rows, 'mlb', 'prop'), true);
  assert.equal(mayShowRecord(rows, 'mlb', 'prop'), true);
  assert.equal(mayShowPick(rows, 'mlb', 'prop'), true);
});

test('a baseline shows a pick, never a probability or a record', () => {
  for (const [sport, kind] of [['mlb', 'game'], ['nfl', 'game'], ['nfl', 'prop'], ['nhl', 'prop'], ['cfb', 'game']] as const) {
    assert.equal(mayShowPick(rows, sport, kind), true, `${sport}/${kind} may show a pick`);
    assert.equal(mayShowProbability(rows, sport, kind), false, `${sport}/${kind} must not show a probability`);
    assert.equal(mayShowRecord(rows, sport, kind), false, `${sport}/${kind} must not show a record`);
  }
});

test("MLB's game model is a baseline: it does not beat the close", () => {
  // clvSummaryJob, read 2026-09-20: moneyline mean CLV -0.0571 prob-points,
  // positive-CLV rate 37.9%. A win-loss record would read as a track record.
  assert.equal(mayShowProbability(rows, 'mlb', 'game'), false);
  assert.equal(mayShowProbability(rows, 'mlb', 'prop'), true);
});

test('a failed or absent model shows nothing at all', () => {
  for (const [sport, kind] of [['soccer', 'game'], ['nba', 'prop'], ['golf', 'prop'], ['tennis', 'game']] as const) {
    assert.equal(mayShowPick(rows, sport, kind), false, `${sport}/${kind} shows no pick`);
    assert.equal(mayShowProbability(rows, sport, kind), false);
    assert.equal(mayShowRecord(rows, sport, kind), false);
  }
  assert.match(statusLabel(rows, 'soccer', 'game'), /did not pass/);
  assert.equal(statusLabel(rows, 'golf', 'prop'), 'no model');
});

test('leagues fold onto the sport the model is built for', () => {
  assert.equal(baseSport('soccer_epl'), 'soccer');
  assert.equal(baseSport('soccer_mls'), 'soccer');
  assert.equal(baseSport('tennis_atp'), 'tennis');
  assert.equal(baseSport('mlb'), 'mlb');
  assert.equal(statusOf(rows, 'soccer_mls', 'game'), 'failed');
  assert.equal(statusOf(rows, 'tennis_wta', 'game'), 'none');
});

test('an unknown sport or kind is "none", never a default yes', () => {
  assert.equal(statusOf(rows, 'cricket', 'prop'), 'none');
  assert.equal(mayShowProbability(rows, 'cricket', 'prop'), false);
  assert.equal(findStatus(rows, 'cfb', 'prop'), null);
  assert.equal(mayShowPick(rows, 'cfb', 'prop'), false);
});

test('every label is plain about what it is', () => {
  assert.equal(statusLabel(rows, 'mlb', 'prop'), 'validated model');
  assert.equal(statusLabel(rows, 'nhl', 'prop'), 'baseline model, not validated');
});
