import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAME_HISTORY_MARKETS } from '../lib/odds/gameLineHistory';

/**
 * Game-market line movement — Phase 6.22.
 *
 * The read itself is a Postgres query and is verified by running it (20 books
 * and 17 buckets on a real event, DraftKings moving -124 to -237). What is
 * asserted here is the part that can go wrong silently: the SQL-safety guards
 * on the two values this module interpolates rather than parameterises, and
 * the route's own allowlists.
 */

const SRC = readFileSync('lib/odds/gameLineHistory.ts', 'utf8');
const ROUTE = readFileSync('app/api/odds/game-line-history/route.ts', 'utf8');

test('the two interpolated values are both guarded before reaching SQL', () => {
  // `bucketSeconds` and `hours` go into a divisor and an interval literal,
  // where a `?` placeholder cannot stand in — so the guard is the only defence.
  assert.match(SRC, /Number\.isInteger\(bucketSeconds\)/);
  assert.match(SRC, /Number\.isFinite\(q\.hours\)/);
  assert.match(SRC, /Math\.round\(q\.hours\)/, 'a fractional hours would reach the interval literal unrounded');
});

test('every caller-supplied value is parameterised, never interpolated', () => {
  // eventId, market and side are all caller text. If any appears inside a
  // template literal in the SQL, that is an injection.
  for (const name of ['q.eventId', 'q.market', 'q.side']) {
    assert.ok(
      !new RegExp('\$\{' + name.replace('.', '\.') + '\}').test(SRC),
      `${name} is interpolated into SQL rather than passed as a parameter`,
    );
  }
});

test('the route allowlists market and side rather than pattern-matching them', () => {
  // Both reach equality filters. An allowlist is the only thing that keeps the
  // set closed as the table grows new values.
  assert.match(ROUTE, /GAME_HISTORY_MARKETS as readonly string\[\]\)\.includes\(market\)/);
  assert.match(ROUTE, /SIDES\.has\(side\)/);
  assert.match(ROUTE, /new Set\(\['home', 'away', 'over', 'under', 'draw'\]\)/);
});

test('the markets are the three the table actually holds', () => {
  // Measured 2026-08-31: moneyline 558 events, total 277, spread 68.
  assert.deepEqual([...GAME_HISTORY_MARKETS], ['moneyline', 'total', 'spread']);
});

test('hours is bounded at both ends', () => {
  assert.match(ROUTE, /hours < 1 \|\| hours > MAX_HOURS/);
  assert.match(ROUTE, /MAX_HOURS = 24 \* 30/);
});

test('the bucket takes the LAST observation in each window, not the first', () => {
  // A bucket should read as "where the price ended up". Ascending order here
  // would make it "where it happened to start".
  assert.match(SRC, /ORDER BY bookmaker, bucket, observed_at DESC/);
});

test('the default market is moneyline, because spread is absent from most games', () => {
  // 558 of 559 events have a moneyline; 68 have a spread. Defaulting to spread
  // renders a blank card on almost every game.
  assert.match(ROUTE, /get\('market'\) \?\? 'moneyline'/);
});
