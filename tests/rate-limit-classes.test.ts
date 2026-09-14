/**
 * R1e — which budget a real route lands in.
 *
 * Every path below was seen on the network tab of one real page load
 * (measured 2026-09-14 on /nfl/game/401872931 and /soccer/epl/team/382), so
 * this is the actual fan-out, not a guess about it. The point of the test is
 * that a page's own reads do not share a 60/minute bucket with everything
 * else under /api, and that the vendor-touching routes still do sit on the
 * small budget that protects spend.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS } from '../proxy';

function classify(path: string): { label: string; limit: number } {
  const rule = LIMITS.find((r) => r.test(path));
  assert.ok(rule, `no rule matched ${path}`);
  return { label: rule.label, limit: rule.limit };
}

test('a page-load read gets the page-load budget, not the shared default', () => {
  const measured = [
    '/api/nfl',
    '/api/nfl/game/401872931',
    '/api/nfl/team/7',
    '/api/nfl/teams',
    '/api/mlb',
    '/api/mlb/team/118',
    '/api/mlb/team-form?teamId=118',
    '/api/soccer/epl',
    '/api/soccer/epl/game/401879280',
    '/api/soccer/epl/team/382',
    '/api/cfb/team/194',
    '/api/nba/teams',
    '/api/nhl/teams',
    '/api/tennis/wta',
    '/api/golf/schedule',
    '/api/season-ranks?sport=soccer_epl&side=allowed',
    '/api/team-rating-history?sport=soccer_epl&teamId=382',
    '/api/picks?sport=nfl',
    '/api/watchlist?sport=nfl',
  ];
  for (const path of measured) {
    const { label, limit } = classify(path);
    assert.equal(label, 'page-load', `${path} landed in "${label}"`);
    assert.ok(limit >= 240, `${path} budget is only ${limit}`);
  }
});

test('one real game-page load fits many times over in its budget', () => {
  // The distinct page-load-class routes one NFL game page fetched.
  const oneLoad = [
    '/api/nfl',
    '/api/nfl/game/401872931',
    '/api/nfl/team/12',
    '/api/nfl/team/7',
    '/api/picks?sport=nfl',
    '/api/watchlist?sport=nfl',
  ];
  const budget = classify('/api/nfl').limit;
  // Under the old shared 60/minute bucket this was 10 page views a minute,
  // before live polling. It must now be comfortably more.
  assert.ok(budget / oneLoad.length >= 30, `only ${budget / oneLoad.length} loads per minute`);
});

test('vendor-touching routes keep the small budget', () => {
  for (const path of ['/api/odds/refresh', '/api/props/scan-player', '/api/diagnostics/selftest']) {
    const { label, limit } = classify(path);
    assert.equal(label, 'provider', `${path} landed in "${label}"`);
    assert.equal(limit, 10);
  }
});

test('model fitting and backfills stay on the hourly budget', () => {
  for (const path of ['/api/props/fit-weights', '/api/props/elo-backfill', '/api/props/ingest-statcast']) {
    const { label, limit } = classify(path);
    assert.equal(label, 'fit/backfill', `${path} landed in "${label}"`);
    assert.equal(limit, 2);
  }
});

test('the already-classified page reads under /api/props are unchanged', () => {
  for (const path of ['/api/props/lines?gameId=1', '/api/props/user-sportsbook', '/api/props/calibration?sport=nfl', '/api/odds/lines?sport=nfl', '/api/odds/game-line?sport=nfl&gameId=1']) {
    assert.equal(classify(path).label, 'page-read', path);
  }
});

test('anything else under /api still falls to the default bucket', () => {
  const { label, limit } = classify('/api/bets');
  assert.equal(label, 'default');
  assert.equal(limit, 60);
});
