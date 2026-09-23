import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * DJ-GOLF's guard — the tournament -> course backfill.
 *
 * The data itself lives in Postgres and is not this suite's to check (235 of
 * 235 events carry a course as of 2026-09-22, from 4). What IS worth pinning
 * is the shape of the job, because every part of it was nearly built wrong:
 * the plan called for a new table that already existed, and the fetch crashed
 * on a real event 46 rows in.
 */

const JOBS = readFileSync('python-odds-service/src/jobs.py', 'utf8');
const BACKFILL = readFileSync('python-odds-service/src/golf_courses.py', 'utf8');
const ESPN = readFileSync('python-odds-service/src/predict/golf_espn.py', 'utf8');
const DB = readFileSync('python-odds-service/src/db.py', 'utf8');

test('the job is registered so health_check can see it', () => {
  assert.match(JOBS, /\("golfCoursesJob", job_golf_courses, 6 \* 60 \* 60\)/);
  // `_run_timed` writes the breadcrumb health_check reads. A job without it is
  // invisible while failing every run.
  assert.match(JOBS, /_run_timed\("golfCoursesJob"/);
});

test('a team event does not crash the backfill', () => {
  /**
   * MEASURED, and it took the first full run down 46 events in: the Ryder Cup
   * (401734110) is match play, and its `competitions` is a list of LISTS (the
   * pairings) where every stroke-play event's is a list of one dict. Calling
   * `.get` on it threw `AttributeError` and killed the whole loop.
   */
  assert.match(ESPN, /isinstance\(first, dict\)/);
  assert.match(ESPN, /ryder cup/i);
});

test('an unknown id is not mistaken for today’s tournament', () => {
  // ESPN answers an unknown `&event=` with a 200 and the CURRENT event, so a
  // dead id would otherwise write today's course onto a 2022 tournament.
  assert.match(ESPN, /str\(e\.get\("id"\) or ""\) == str\(event_id\)/);
});

test('the backfill writes the same shape the live path writes', () => {
  // A backfilled row and a live-written one must be indistinguishable to
  // `golf_tournaments`' readers — same holes JSON keys, same writer.
  assert.match(BACKFILL, /db\.write_golf_tournament\(/);
  assert.match(BACKFILL, /"shotsToPar": h\.shots_to_par/);
  assert.match(BACKFILL, /"totalYards": h\.total_yards/);
  const live = readFileSync('python-odds-service/src/predict/golf_history.py', 'utf8');
  assert.match(live, /"shotsToPar": h\.shots_to_par/);
});

test('it takes a slice per run rather than asking for everything at once', () => {
  // ESPN's golf endpoints are free, public and not ours. 235 events clear in
  // four scheduled runs; the one-off CLI is what asks for more.
  assert.match(BACKFILL, /^BATCH = \d+$/m);
  assert.match(BACKFILL, /GAP_SECONDS = /);
  assert.match(BACKFILL, /await asyncio\.sleep\(GAP_SECONDS\)/);
});

test('it asks only for events that are actually missing something', () => {
  // Both conditions matter: the course is the point, and the start date is the
  // one field the live path cannot fill (it refuses to guess from today).
  assert.match(DB, /WHERE t\.course_name IS NULL OR t\.start_date IS NULL/);
  // Newest first: the ids most likely to still answer, and to matter.
  assert.match(DB, /ORDER BY max\(r\.finished_at\) DESC NULLS LAST/);
});

test('an event ESPN will not answer for is recorded, not retried forever', () => {
  assert.match(BACKFILL, /unanswered/);
  assert.doesNotMatch(BACKFILL, /while True/);
});
