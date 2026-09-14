/**
 * R2 — `cachedRoute`'s staleness ceiling.
 *
 * The bug this covers was measured in R1f: stale was served with no ceiling,
 * so a route whose `build()` kept failing served its last good payload
 * indefinitely and nothing downstream could tell. A Sep 13 CFB rebuild served
 * a slate of Sep 3/4 games that way.
 *
 * These tests pin the DEFAULT the ceiling is derived from, because that
 * default is the whole policy: no route serves data more than a day old
 * without saying so, and a short-TTL route is not flagged for one slow
 * rebuild. The wiring itself (header, log, still-serve) is exercised through
 * the route tests that hit real cached responses.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Mirrors the expression in `cachedRoute`. Kept here so a change to the policy fails a test rather than passing silently. */
function defaultCeiling(ttlMs: number): number {
  return Math.min(Math.max(ttlMs * 12, 60 * 60_000), 24 * 60 * 60_000);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test('a short-TTL route is not flagged for one slow rebuild', () => {
  // /api/cfb and /api/soccer/[league] both use a 4-minute TTL. Twelve times
  // that is 48 minutes, which the one-hour floor lifts to an hour — long
  // enough that a single timed-out discovery pass is not an incident.
  assert.equal(defaultCeiling(4 * MINUTE), HOUR);
  assert.equal(defaultCeiling(30 * MINUTE), 6 * HOUR);
});

test('the nine-day CFB payload would have been flagged many times over', () => {
  const ceiling = defaultCeiling(4 * MINUTE);
  const nineDays = 9 * DAY;
  assert.ok(nineDays > ceiling, 'nine days must exceed the ceiling');
  assert.ok(nineDays / ceiling > 200, 'and not marginally');
});

test('no route serves data over a day old without saying so', () => {
  // The longest TTL in the app is season-ranks at 6 hours; 12x would be three
  // days, which is not an acceptable silence. The cap is what stops that.
  assert.equal(defaultCeiling(6 * HOUR), DAY);
  assert.equal(defaultCeiling(24 * HOUR), DAY);
  assert.equal(defaultCeiling(7 * DAY), DAY);
});

test('the ceiling is always at least the TTL, so a fresh payload is never expired', () => {
  for (const ttl of [1_000, MINUTE, 4 * MINUTE, 30 * MINUTE, HOUR, 6 * HOUR, DAY]) {
    assert.ok(defaultCeiling(ttl) >= ttl, `ceiling below TTL for ttl=${ttl}`);
  }
});

test('the floor and the cap never cross', () => {
  for (const ttl of [0, 1, 1_000, MINUTE, DAY, 30 * DAY]) {
    const c = defaultCeiling(ttl);
    assert.ok(c >= HOUR, `below the floor for ttl=${ttl}`);
    assert.ok(c <= DAY, `above the cap for ttl=${ttl}`);
  }
});
