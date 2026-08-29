import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * `pick_history` holds rows from two MLB game models. The one deleted on
 * 2026-08-29 (`computeMoneylineModel`) is attributed
 * `model_source = 'ts_unfitted_moneyline'`; the model that still exists writes
 * NULL. Any reader that SCORES or PRESENTS a model must exclude the deleted
 * one, or it reports a blend of a model that exists and one that does not.
 *
 * WHY THIS TEST EXISTS. That filter has now been missed twice, in two separate
 * passes over the same file. Task 4.8 filtered three readers; the Phase 4 gate
 * then found `goodBetsRecord` (the home page's own win-loss record) still
 * unfiltered, and after fixing that, found five more behind /diagnostics. The
 * unfiltered /diagnostics moneyline calibration was measured at n=3,590 with
 * 3,580 of those rows -- 99.7% -- belonging to the deleted model.
 *
 * Both misses happened because the filter is invisible unless you read every
 * query in a 2,900-line file. A grep-based assertion is crude, but it fails
 * loudly when someone adds a seventh scoring reader, which is exactly the
 * failure mode that has actually occurred.
 *
 * DELIBERATELY NOT LISTED: `listUngradedGameIds`, `listUngradedForGame` and
 * `listKnownSubjects` (the grading path must see every row) and
 * `leagueBaseRates` (keys off `actual_value > line`; moneyline rows carry no
 * line, so the deleted model's rows cannot reach it).
 */
const SCORING_READERS = [
  'calibrationCounts',
  'calibrationBuckets',
  'calibrationBucketsForDimension',
  'calibrationCountsForDimension',
  'calibrationByMarket',
  'liveCalibrationBrier',
  'liveMarketSkill',
  'scoreRecord',
  'overallBrierScore',
  'goodBetsRecord',
];

const SOURCE = readFileSync('lib/db/client.ts', 'utf8');

/** The body of an exported function, from its signature to the next one. */
function bodyOf(name: string): string {
  const start = SOURCE.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} not found in lib/db/client.ts — was it renamed?`);
  const next = SOURCE.indexOf('\nexport ', start + 1);
  return SOURCE.slice(start, next === -1 ? SOURCE.length : next);
}

for (const name of SCORING_READERS) {
  test(`${name} excludes the deleted model's rows`, () => {
    const body = bodyOf(name);
    assert.match(
      body,
      /model_source IS NULL|CURRENT_MODEL_ONLY/,
      `${name} reads pick_history to score or present a model, but does not filter ` +
        `model_source. Without it the number mixes the fitted model with ` +
        `computeMoneylineModel, deleted 2026-08-29. Add ` +
        '`${CURRENT_MODEL_ONLY}` to its WHERE clause, or if this reader genuinely ' +
        'must see every row, remove it from SCORING_READERS in this test and say why.',
    );
  });
}

test('the shared predicate is defined once, not copied per query', () => {
  assert.match(
    SOURCE,
    /const CURRENT_MODEL_ONLY = /,
    'CURRENT_MODEL_ONLY should be declared once in lib/db/client.ts',
  );
});

test('every reader in the list actually queries pick_history', () => {
  // Guards the test itself: if a reader is refactored to stop touching
  // pick_history, the assertion above would keep passing on a stale comment
  // rather than on a real filter.
  for (const name of SCORING_READERS) {
    const body = bodyOf(name);
    assert.match(
      body,
      /FROM pick_history/,
      `${name} no longer queries pick_history — remove it from SCORING_READERS`,
    );
  }
});
