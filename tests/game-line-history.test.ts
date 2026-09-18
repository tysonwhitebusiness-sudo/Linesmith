import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAME_HISTORY_MARKETS } from '../lib/odds/gameLineHistory';

/**
 * Game-market line movement — Phase 6.22.
 *
 * The reads are Postgres queries, verified by running them. What is asserted
 * here is the part that can go wrong silently: caller text reaching SQL, and
 * the pre-start/in-game window split. (The bucketed history read, its route and
 * their allowlists went in R11a — nothing called them once the old game page
 * was deleted. The game pages call the open/close and in-game reads
 * server-side, with no interpolated values left.)
 */

const SRC = readFileSync('lib/odds/gameLineHistory.ts', 'utf8');

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

test('the markets are the three the table actually holds', () => {
  // Measured 2026-08-31: moneyline 558 events, total 277, spread 68.
  assert.deepEqual([...GAME_HISTORY_MARKETS], ['moneyline', 'total', 'spread']);
});

// R2 — the pre-start split. On the G2 fixture (MLB KC @ BOS, pk 824711) 1,790 of
// 2,782 rows were observed after first pitch; a window ending "now" drew those
// in-play swings as the pre-game market.
import { historyWindows, IN_GAME_HOURS } from '../lib/odds/gameLineHistory';

test('a started game: pre-game ends AT the start, in-game runs from it', () => {
  const now = new Date('2026-09-14T20:00:00Z');
  const w = historyWindows('2026-09-13T23:10:00Z', 48, now);
  assert.equal(w.pre.to.toISOString(), '2026-09-13T23:10:00.000Z');
  assert.equal(w.pre.from.toISOString(), '2026-09-11T23:10:00.000Z', 'the 48h are counted back from the start, not from now');
  assert.ok(w.inGame);
  assert.equal(w.inGame!.from.toISOString(), '2026-09-13T23:10:00.000Z');
  assert.equal(w.inGame!.to.getTime() - w.inGame!.from.getTime(), IN_GAME_HOURS * 3600_000, 'next-morning quotes are not in-game');
});

test('a game in progress: in-game stops at now', () => {
  const now = new Date('2026-09-14T20:00:00Z');
  const w = historyWindows('2026-09-14T19:00:00Z', 48, now);
  assert.equal(w.inGame!.to.toISOString(), now.toISOString());
});

test('no split before the start, or without a real start time', () => {
  const now = new Date('2026-09-14T20:00:00Z');
  for (const startsAt of ['2026-09-15T00:00:00Z', '2026-09-14', null, undefined, 'not a date']) {
    const w = historyWindows(startsAt, 48, now);
    assert.equal(w.inGame, null, String(startsAt));
    assert.equal(w.pre.to.toISOString(), now.toISOString());
  }
});
