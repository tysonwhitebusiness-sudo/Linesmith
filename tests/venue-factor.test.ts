import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeVenueFactor, type VenueFactor } from '../lib/sports/shared/venueFactorShapes';

/**
 * Venue scoring factors — Phase 6.10.
 *
 * The job itself is verified by running it: 282 rows across six sport-stat
 * pairs, every sport's mean factor between 1.000 and 1.030, which is the
 * sanity check the formula guarantees. What is asserted here is the wording
 * shown to a reader and the route's allowlists.
 */

const f = (factor: number, homeGames = 41, awayGames = 41): VenueFactor => ({
  sport: 'nba', teamId: '1', season: 2026, statKey: 'points', factor, homeGames, awayGames,
});

test('a factor within a couple of percent of even reads as neutral', () => {
  // At twenty to forty games a side the noise is larger than one percent, and
  // "+1% points at home" invites acting on a number indistinguishable from
  // nothing.
  assert.match(describeVenueFactor(f(1.005), 'points')!, /^Neutral for points/);
  assert.match(describeVenueFactor(f(0.99), 'points')!, /^Neutral for points/);
});

test('a real effect is signed and carries its sample', () => {
  const s = describeVenueFactor(f(1.12), 'goals')!;
  assert.match(s, /^\+12% goals at home/);
  assert.match(s, /41H\/41A/, 'a factor without its game counts cannot be judged');
  assert.match(s, /2026/, 'the season is part of the claim');
});

test('a negative effect keeps its sign', () => {
  assert.match(describeVenueFactor(f(0.88), 'points')!, /^-12% points at home/);
});

test('an absent or impossible factor renders nothing', () => {
  assert.equal(describeVenueFactor(null, 'points'), null);
  assert.equal(describeVenueFactor(f(0), 'points'), null, 'a zero ratio is not a factor');
  assert.equal(describeVenueFactor(f(NaN), 'points'), null);
});

test('the route allowlists sport and statKey rather than pattern-matching', () => {
  const route = readFileSync('app/api/venue-factor/route.ts', 'utf8');
  assert.match(route, /SPORTS\.has\(sport\)/);
  assert.match(route, /STAT_KEYS\.has\(statKey\)/);
  // The table's vocabulary, not the page's — soccer_epl, never soccer.
  assert.match(route, /'soccer_epl', 'soccer_mls'/);
  assert.ok(!/'soccer'[,\]]/.test(route), "the page's vocabulary would match no rows");
});

test('the job is registered so health_check can see it', () => {
  const jobs = readFileSync('python-odds-service/src/jobs.py', 'utf8');
  assert.match(jobs, /\("venueFactorsJob", job_venue_factors, 24 \* 60 \* 60\)/);
  // `_run_timed` is what writes the breadcrumb health_check reads. Four ingest
  // jobs once shipped without it and were invisible while failing every run.
  assert.match(jobs, /_run_timed\("venueFactorsJob"/);
});

test('the job walks back a season rather than writing nothing', () => {
  // Its first real run wrote zero rows for soccer and CFB because their newest
  // season is a stub of 8-15 events and every team fell under the game floor.
  const src = readFileSync('python-odds-service/src/venue_factors.py', 'utf8');
  assert.match(src, /SEASON_FALLBACK_ATTEMPTS = 2/);
  assert.match(src, /for back in range\(SEASON_FALLBACK_ATTEMPTS \+ 1\)/);
});
