/**
 * Phase 4.10 — enforcement for §9d's line: a ranking is an opinion, an edge is
 * a claim about someone else's price.
 *
 * The stats board ships on ORDERING, which four NHL markets cleared. The
 * betting board ships on beating the de-vigged close, which NOTHING in this
 * project has cleared (tennis t=+20.68, soccer t=+3.05, NHL games t=+5.07, NHL
 * props t=+3.03). If edge language or an edge field reaches the stats board, it
 * has silently become a betting board without passing a betting board's gate.
 *
 * THIS IS A TEST, NOT A SUPPRESSION STATE. The distinction matters here
 * specifically: the rule this replaces (Track E of audit-remediation-plan.md)
 * passed only because nothing rendered at all, and was flagged the next day as
 * "a SUPPRESSION STATE, not a test". These assertions run against real files
 * that really do render, so they can actually fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  toNhlStatsBoardData,
  type NhlProjectionApiRow,
} from '../lib/sports/nhl/adapters/statsBoardAdapter';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Files that make up the stats-board surface. */
const SURFACE = [
  'components/StatsBoard.tsx',
  'components/NhlProjectionsPanel.tsx',
  'lib/sports/nhl/adapters/statsBoardAdapter.ts',
  'app/api/nhl/projections/route.ts',
];

/**
 * Identifiers that only exist to express a claim against a price. Matched as
 * code, not prose — the doc comments in these files necessarily DISCUSS edges
 * in order to explain why they are absent, and a test that failed on the word
 * "edge" appearing in an explanation would be a test nobody could keep.
 */
const FORBIDDEN_CODE = [
  'EdgeBadge',
  'edgeSource',
  'marketProb',
  'impliedProb',
  'propScore',
  'scoreGrade',
  'expectedValue',
  'devig',
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('no edge identifier reaches the stats-board surface', () => {
  for (const file of SURFACE) {
    const code = stripComments(read(file));
    for (const token of FORBIDDEN_CODE) {
      assert.ok(
        !code.includes(token),
        `${file} references \`${token}\` — that is a claim against a price, and ` +
          `the stats board has not passed the gate that would license one.`,
      );
    }
  }
});

test('the stats board imports nothing from the odds or edge modules', () => {
  for (const file of SURFACE) {
    const code = stripComments(read(file));
    const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(
        !/\/odds\/|liveEdge|edgeModel|goodBets/i.test(spec),
        `${file} imports \`${spec}\` — the stats board must not depend on the ` +
          `edge pipeline.`,
      );
    }
  }
});

test('profit and edge language stays out of the rendered copy', () => {
  // Rendered strings only: JSX text and string literals, comments stripped.
  const code = stripComments(read('components/StatsBoard.tsx'));
  for (const phrase of [
    'edge',
    'profit',
    'value bet',
    'beat the',
    '+EV',
    'guaranteed',
    'lock',
    'sharp',
  ]) {
    // Substring, not regex: these are literal phrases and "+EV" is not a valid
    // pattern.
    assert.ok(
      !code.toLowerCase().includes(phrase.toLowerCase()),
      `StatsBoard renders the phrase "${phrase}" — the board states an opinion ` +
        `about a player, never a claim about a price or a payout.`,
    );
  }
});

test('a market without calibration is ranked but shows no probability', () => {
  const rows: NhlProjectionApiRow[] = [
    // shots-on-goal: calibration gap 0.057, so the serving pipe writes a null
    // probability. It must still rank.
    mk('1', 'A', 'shots-on-goal', 2.9, null, null),
    mk('2', 'B', 'shots-on-goal', 3.4, null, null),
    // points: gap 0.013, earned a probability.
    mk('3', 'C', 'points', 0.8, 0.62, 0.5),
  ];
  const data = toNhlStatsBoardData(rows, '2026-01-14');

  const sog = data.markets.find((m) => m.key === 'shots-on-goal');
  assert.ok(sog, 'shots-on-goal must appear — its ordering is monotone');
  assert.equal(sog!.hasProbability, false);
  assert.deepEqual(sog!.rows.map((r) => r.subjectId), ['2', '1'],
    'ranked by projection, highest first — the ordering IS the product');
  for (const r of sog!.rows) {
    assert.equal(r.probability, null);
    assert.equal(r.line, null, 'no line without a probability to attach it to');
  }

  const points = data.markets.find((m) => m.key === 'points');
  assert.equal(points!.hasProbability, true);
  assert.equal(points!.rows[0].probability, 0.62);
});

test('markets whose ordering runs backwards never reach the board', () => {
  // hits (Q3 2.40 -> Q4 2.33) and blocked-shots (Q3 2.03 -> Q4 1.81) were both
  // measured non-monotone in 4.9. Even if a row for one appeared in the cache,
  // the adapter must not surface it: a backwards ranking is the one failure
  // that makes a ranking board lie.
  const data = toNhlStatsBoardData(
    [mk('1', 'A', 'hits', 2.2, null, null), mk('2', 'B', 'blocked-shots', 1.9, null, null)],
    '2026-01-14',
  );
  assert.equal(data.markets.length, 0);
  assert.ok(data.emptyReason, 'an empty board explains itself rather than rendering blank');
});

function mk(
  id: string,
  name: string,
  dimension: string,
  projection: number,
  modelProb: number | null,
  line: number | null,
): NhlProjectionApiRow {
  return {
    subjectId: id,
    subjectName: name,
    teamAbbr: null,
    gameId: 'g1',
    dimension,
    projection,
    modelProb,
    line,
    projectedToi: 16.4,
    sampleSize: 30,
  };
}
