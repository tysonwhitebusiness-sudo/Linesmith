import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketSecondsFor, pinLine } from '../lib/odds/props/lineHistory';

/**
 * Phase 6.16 — line movement, and the two things that made the first cut of it
 * meaningless.
 *
 * 1. **Books post alternate lines simultaneously.** For one real strikeouts
 *    prop, fanatics carried 9 distinct lines from 1.5 to 9.5 and prizepicks 10
 *    from 3.5 to 11.5. A series keyed only on (game, subject, market, side)
 *    walked between alternates and drew a line jumping 2.5 to 10.5. Every point
 *    was a genuine quoted price and the chart was nonsense.
 *
 * 2. **A null line is not a missing value.** Measured across the table: 53% of
 *    `pitcher-strikeouts` rows carry no line at all — 52,024 of 98,434, mostly
 *    from fanduel, fanatics and draftkings — while `anytime-goalscorer` and
 *    `two-plus-goals` are ~100% null because those markets have no handicap.
 *    The first is an ingest defect and the rows are uninterpretable; the second
 *    is correct data. They must not be handled the same way.
 */

test('the modal line is picked, not the mean or the midpoint', () => {
  // Rows arrive ordered by observation count descending.
  const rows = [{ line: 5.5 }, { line: 6.5 }, { line: 4.5 }, { line: 9.5 }];
  const { resolvedLine } = pinLine(rows);
  assert.equal(resolvedLine, 5.5, 'the most-quoted line is the market’s de-facto main one');
  // The mean would be 6.5 and the midpoint of the range 7.0 — neither is a line
  // any book posted, which is the entire objection to computing one.
  assert.notEqual(resolvedLine, 6.5);
  assert.notEqual(resolvedLine, 7);
});

test('every offered alternate comes back, ascending', () => {
  const { availableLines } = pinLine([{ line: 5.5 }, { line: 9.5 }, { line: 1.5 }, { line: 6 }]);
  assert.deepEqual(availableLines, [1.5, 5.5, 6, 9.5], 'a caller can only offer alternates it is told about');
});

test('a requested line is honoured only when it was actually offered', () => {
  const rows = [{ line: 5.5 }, { line: 6.5 }];
  assert.equal(pinLine(rows, 6.5).resolvedLine, 6.5);
  // Silently returning an empty series for a line nobody quoted looks exactly
  // like "this prop stopped moving", which is a different and false statement.
  assert.equal(pinLine(rows, 8.5).resolvedLine, 5.5, 'an unoffered line must fall back, not blank the chart');
});

test('a market with no handicap resolves to null rather than inventing one', () => {
  // anytime-goalscorer and two-plus-goals are ~100% null in the real table.
  // Null IS the line here, and the series tracks price.
  const { resolvedLine, availableLines } = pinLine([{ line: null }]);
  assert.equal(resolvedLine, null);
  assert.deepEqual(availableLines, []);
});

test('null rows never displace a real line when both are present', () => {
  // THE INGEST DEFECT, in one shape: nulls dominate the row count for
  // pitcher-strikeouts, so ordering by count puts them first. They must still
  // not become the pinned line — "over null" is not a bet.
  const rows = [{ line: null }, { line: null }, { line: 5.5 }];
  const { resolvedLine } = pinLine(rows);
  assert.equal(resolvedLine, 5.5, 'a real line must win over a more-numerous null');
});

test('the bucket ladder keeps any window inside the point budget', () => {
  // A chart nobody can read is not a chart. 5-minute buckets over 30 days would
  // be 8,640 points per book.
  for (const hours of [1, 6, 24, 48, 24 * 7, 24 * 30]) {
    const b = bucketSecondsFor(hours);
    assert.ok((hours * 3600) / b <= 160, `${hours}h produced ${(hours * 3600) / b} buckets`);
  }
});

test('a short window still gets fine buckets', () => {
  // The ladder must not overshoot: an hour of data at daily buckets is one
  // point, which shows nothing.
  assert.equal(bucketSecondsFor(1), 300, 'an hour deserves 5-minute resolution');
  assert.ok(bucketSecondsFor(48) <= 1800, 'two days should still be half-hourly or finer');
  // ...and it must be monotonic, or a longer window could paradoxically draw
  // more points than a shorter one.
  let prev = 0;
  for (const h of [1, 2, 6, 12, 24, 48, 96, 24 * 30]) {
    const b = bucketSecondsFor(h);
    assert.ok(b >= prev, `bucket width went backwards at ${h}h`);
    prev = b;
  }
});

// --- the component's only real logic --------------------------------------

test('a bucket a book did not quote becomes NaN, never a carried-forward price', async () => {
  const { alignToBuckets } = await import('../components/LineMovementCard');
  const buckets = ['t1', 't2', 't3', 't4'];
  const points = [
    { t: 't1', americanOdds: -120 },
    // t2 and t3: this book quoted nothing.
    { t: 't4', americanOdds: -150 },
  ];
  const aligned = alignToBuckets(points, buckets);

  assert.equal(aligned[0], -120);
  assert.equal(aligned[3], -150);
  // THE POINT: carrying -120 across t2/t3 would draw a flat segment asserting
  // the price held steady, when what happened is nobody recorded one.
  // `SeriesChart` breaks its line on a non-finite entry, so the gap shows.
  assert.ok(Number.isNaN(aligned[1]), 'a missing bucket must not inherit the previous price');
  assert.ok(Number.isNaN(aligned[2]));
  assert.equal(aligned.length, buckets.length, 'every book must span the shared domain');
});

test('a null price is a gap too, not a zero', async () => {
  const { alignToBuckets } = await import('../components/LineMovementCard');
  const aligned = alignToBuckets([{ t: 't1', americanOdds: null }], ['t1']);
  // American odds of 0 is not a price; plotting one would put a point on the
  // axis where no quote existed.
  assert.ok(Number.isNaN(aligned[0]), 'a null price must not become 0');
});
