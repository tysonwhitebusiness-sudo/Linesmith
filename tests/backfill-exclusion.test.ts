import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Task 6.19 — no user-facing record may count rows that were never surfaced.
 *
 * **85% of `pick_history` is `event_context='backfill'`** — 316,327 of 372,231,
 * measured 2026-08-30 — and every one has `surfaced_at = graded_at`. They were
 * reconstructed after the fact by a model that no longer exists.
 *
 * THIS EXACT MISS HAS NOW HAPPENED TWICE. Phase 1.8 filtered
 * `calibrationByMarket` and left the other readers. Task 4.8 then filtered the
 * deleted game model out of the home page's record and left the backfill in —
 * its own comment says "the calibration queries had already been filtered and
 * this reader was missed". A predicate that has to be remembered per query gets
 * forgotten per query, so this test enumerates the readers instead.
 *
 * Measured impact on the home page before 6.19:
 *   as shipped 118,691/356,570 = 33.3%   live only 15,689/43,361 = 36.2%
 *   overall Brier 0.1986                 live only 0.2191
 * Both directions — the win rate read worse than reality and the Brier better.
 */

const SRC = readFileSync('lib/db/client.ts', 'utf8');

/** The body of an exported async function, by name. */
function bodyOf(name: string): string {
  const start = SRC.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} no longer exists — this test needs updating, not deleting`);
  const next = SRC.indexOf('\nexport ', start + 1);
  return SRC.slice(start, next === -1 ? SRC.length : next);
}

/**
 * Every reader that reports the MODEL'S OWN RECORD or calibration to a user.
 * Adding a new one without the predicate is the failure this catches.
 */
const MUST_EXCLUDE_BACKFILL = [
  'goodBetsRecord', // the home page's track record
  'overallBrierScore', // /diagnostics headline
  'calibrationBuckets', // the reliability diagram
  'calibrationBucketsForDimension',
  'calibrationByMarket', // filtered since Phase 1.8
  'liveCalibrationBrier', // filtered since Phase 1.8
];

for (const fn of MUST_EXCLUDE_BACKFILL) {
  test(`${fn} excludes backfilled rows`, () => {
    const body = bodyOf(fn);
    const filtered =
      body.includes('LIVE_ROWS_ONLY') ||
      /event_context IS NULL OR event_context (!=|<>) 'backfill'/.test(body);
    assert.ok(
      filtered,
      `${fn} aggregates pick_history without excluding event_context='backfill'. ` +
        `85% of that table is backfill with surfaced_at = graded_at — picks that were ` +
        `never surfaced before their outcome was known.`,
    );
  });
}

test('the two readers that MUST see backfill still do', () => {
  // `calibrationCounts` exists to show `backfillRows` and `liveRows` side by
  // side. Filtering it would erase the split it reports.
  const counts = bodyOf('calibrationCounts');
  assert.match(counts, /backfillRows/, 'calibrationCounts must still report the backfill count');
  assert.ok(
    !counts.includes('LIVE_ROWS_ONLY'),
    'calibrationCounts must NOT be filtered — it is the query that makes the split visible',
  );

  // `leagueBaseRates` is a league base rate off `actual_value > line`, not a
  // model record. More history makes it better.
  const base = bodyOf('leagueBaseRates');
  assert.ok(!base.includes('LIVE_ROWS_ONLY'), 'leagueBaseRates is not a model record and should keep every row');
});

test('the predicate is declared once, not copied per query', () => {
  // Two spellings drift, and then one page excludes backfill while the page
  // beside it does not. Phase 1.8 inlined it and task 4.8 then missed it.
  assert.match(SRC, /const LIVE_ROWS_ONLY = /, 'the predicate must exist as one named constant');
  const inlined = SRC.match(/event_context IS NULL OR event_context (!=|<>) 'backfill'/g) ?? [];
  assert.ok(
    inlined.length <= 3,
    `the backfill predicate is inlined ${inlined.length} times; use LIVE_ROWS_ONLY so a new reader cannot omit it`,
  );
});
