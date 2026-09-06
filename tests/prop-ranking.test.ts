/**
 * Phase 2 — the cross-market ranking metric.
 *
 * The metric is `calibrated P(over) - league baseline for that market`. What
 * makes it worth testing rather than reading is that both of its failure modes
 * are silent: subtracting the wrong quantity produces a plausible number, and
 * ranking a market that has no baseline produces a confident ordering of
 * nothing. Neither throws.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  rankAcrossMarkets,
  rankWithin,
  deltaOf,
  confidenceOf,
  type RankedRow,
} from '../lib/sports/propRanking';
import type {
  StatsBoardData,
  StatsBoardRow,
} from '../lib/sports/nhl/adapters/statsBoardAdapter';

function row(
  name: string,
  projection: number,
  probability: number | null,
  leagueBaseline: number | null,
  sampleSize = 200,
): StatsBoardRow {
  return {
    subjectId: name,
    subjectName: name,
    teamAbbr: null,
    gameId: 'g1',
    projection,
    probability,
    line: probability == null ? null : 0.5,
    volume: 4.2,
    sampleSize,
    leagueBaseline,
  };
}

function board(markets: Array<{ key: string; rows: StatsBoardRow[] }>): StatsBoardData {
  return {
    sport: 'mlb',
    sportLabel: 'MLB',
    asOf: '2026-09-06T22:29:00Z',
    markets: markets.map((m) => ({
      key: m.key,
      label: m.key,
      unit: 'x',
      volumeLabel: 'Chances',
      volumeUnit: 'ch',
      hasProbability: m.rows[0]?.probability != null,
      rows: m.rows,
    })),
    emptyReason: null,
  };
}

test('a high probability against a high baseline loses to a lower one against a lower baseline', () => {
  // The entire reason the metric subtracts a baseline. Ranking on probability
  // alone would put the 0.5-line market on top of every board forever, because
  // low lines clear more often — which is a fact about lines, not players.
  const data = board([
    { key: 'hits', rows: [row('Common', 0.9, 0.73, 0.61)] },            // +0.12
    { key: 'pitcher-strikeouts', rows: [row('Rare', 6.5, 0.52, 0.11)] }, // +0.41
  ]);
  const ranked = rankAcrossMarkets(data);
  assert.equal(ranked[0].subjectName, 'Rare');
  assert.equal(ranked[1].subjectName, 'Common');
  assert.ok(
    ranked[0].probability! < ranked[1].probability!,
    'the top-ranked row must be allowed to have the LOWER raw probability — otherwise the baseline is doing nothing',
  );
});

test('a row with no probability is ranked but never given a global position', () => {
  // The plan's rule, in the types: nothing unvalidated gets a number next to
  // something validated.
  const data = board([
    { key: 'hits', rows: [row('Calibrated', 1.2, 0.7, 0.6)] },
    { key: 'total-bases', rows: [row('Uncalibrated', 9.9, null, null)] },
  ]);
  const ranked = rankAcrossMarkets(data);

  const uncal = ranked.find((r) => r.subjectName === 'Uncalibrated')!;
  assert.equal(uncal.globalRank, null, 'an uncalibrated row must not receive a global rank');
  assert.equal(uncal.delta, null);
  assert.ok(uncal.marketRank > 0, 'it must still place within its own market');

  assert.equal(ranked[0].subjectName, 'Calibrated');
  assert.ok(
    ranked.indexOf(uncal) > 0,
    'and it sorts BELOW every comparable row, however large its projection is',
  );
});

test('a probability with no baseline is not comparable, and is not silently treated as zero', () => {
  // The dangerous case. `probability - 0` is a real number and would rank
  // enormously high; the row simply has nothing to be measured against.
  const orphan = row('NoBaseline', 1.0, 0.95, null);
  assert.equal(deltaOf(orphan), null);

  const ranked = rankAcrossMarkets(
    board([
      { key: 'a', rows: [orphan] },
      { key: 'b', rows: [row('Modest', 1.0, 0.55, 0.5)] },
    ]),
  );
  assert.equal(ranked[0].subjectName, 'Modest');
  assert.equal(ranked[1].globalRank, null);
});

test('filtering to one market renumbers 1..N rather than showing the global gaps', () => {
  // The plan's line: the same table is both the cross-market board and the
  // per-market leaderboard. A filtered list whose first row reads "#47" is a
  // list the reader has to do arithmetic on.
  const data = board([
    { key: 'hits', rows: [row('H1', 1.3, 0.70, 0.61), row('H2', 1.1, 0.66, 0.61)] },
    { key: 'ks', rows: [row('K1', 7.0, 0.52, 0.11), row('K2', 6.0, 0.50, 0.11)] },
  ]);
  const all = rankAcrossMarkets(data);
  assert.deepEqual(
    all.map((r) => `${r.subjectName}#${r.globalRank}`),
    ['K1#1', 'K2#2', 'H1#3', 'H2#4'],
  );

  const hitsOnly = rankWithin(all.filter((r) => r.marketKey === 'hits'));
  assert.deepEqual(
    hitsOnly.map((r) => `${r.subjectName}#${r.globalRank}`),
    ['H1#1', 'H2#2'],
    'filtering must re-rank from 1, not preserve the global numbering',
  );
});

test('market rank is a real per-market position, not a slice of the global one', () => {
  const data = board([
    { key: 'hits', rows: [row('H1', 1.3, 0.70, 0.61), row('H2', 1.1, 0.66, 0.61)] },
    { key: 'ks', rows: [row('K1', 7.0, 0.52, 0.11)] },
  ]);
  const ranked = rankAcrossMarkets(data);
  const byName = new Map(ranked.map((r) => [r.subjectName, r]));
  assert.equal(byName.get('K1')!.marketRank, 1);
  assert.equal(byName.get('H1')!.marketRank, 1, 'the best hits row is #1 in hits even though it is #2 overall');
  assert.equal(byName.get('H2')!.marketRank, 2);
});

test('ordering is total, so the board does not reshuffle between renders', () => {
  // Identical deltas and identical projections: without the final name
  // tiebreak the comparator returns 0 and the order depends on input order.
  const rows = [row('Zeta', 1.0, 0.6, 0.5), row('Alpha', 1.0, 0.6, 0.5)];
  const a = rankAcrossMarkets(board([{ key: 'hits', rows }]));
  const b = rankAcrossMarkets(board([{ key: 'hits', rows: [...rows].reverse() }]));
  assert.deepEqual(
    a.map((r) => r.subjectName),
    b.map((r) => r.subjectName),
  );
});

test('confidence separates a callup from a career', () => {
  // A nine-game callup must not look like a regular on a board that ranks them
  // against each other.
  assert.equal(confidenceOf(9), 'low');
  assert.equal(confidenceOf(19), 'low');
  assert.equal(confidenceOf(20), 'medium');
  assert.equal(confidenceOf(99), 'medium');
  assert.equal(confidenceOf(100), 'high');
});

test('the ranked row carries its market, so a flattened cross-market list stays self-describing', () => {
  const ranked: RankedRow[] = rankAcrossMarkets(
    board([{ key: 'pitcher-outs', rows: [row('P', 17.2, 0.6, 0.08)] }]),
  );
  assert.equal(ranked[0].marketKey, 'pitcher-outs');
  assert.equal(ranked[0].volumeUnit, 'ch');
});
