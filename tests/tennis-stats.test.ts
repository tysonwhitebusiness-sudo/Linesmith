import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * DJ-TEN's guard — the tennis serve/return ingest.
 *
 * What is worth pinning is not the arithmetic (there is none here; the rows
 * are copied) but the three decisions that make the data trustworthy: an
 * unresolvable player is dropped rather than guessed, the table says which
 * tour has no source rather than implying both are covered, and the derived
 * rates are NOT stored.
 */

const INGEST = readFileSync('python-odds-service/src/tennis_stats.py', 'utf8');
const JOBS = readFileSync('python-odds-service/src/jobs.py', 'utf8');
const MIGRATION = readFileSync('supabase/migrations/20260923000000_tennis_match_stats.sql', 'utf8');
const DB = readFileSync('python-odds-service/src/db.py', 'utf8');

test('the job is registered so health_check can see it', () => {
  assert.match(JOBS, /\("tennisStatsJob", job_tennis_stats, 24 \* 60 \* 60\)/);
  assert.match(JOBS, /_run_timed\("tennisStatsJob"/);
});

test('a player who cannot be resolved is skipped, never guessed', () => {
  // A serve line filed under the wrong player is worse than a missing one.
  // `_rows_for_match` only emits a side whose id resolved.
  assert.match(INGEST, /if w_id:/);
  assert.match(INGEST, /if l_id:/);
  assert.match(INGEST, /unresolved/);
  // And the run says how many it dropped, rather than reporting a clean pass.
  assert.match(INGEST, /"unresolved_players": len\(unresolved\)/);
});

test('the tour with no source is named, not silently absent', () => {
  // Sackmann's tennis_atp/tennis_wta repos are gone; TML is ATP only. A job
  // log that just showed ATP numbers would read as if WTA were fine.
  assert.match(INGEST, /out\["no_source"\]/);
  assert.match(INGEST, /if s not in TOURS/);
  assert.match(INGEST, /TOURS: dict\[str, str\]/);
  // And the reason is in the file, so the next reader does not "fix" it by
  // pointing TOURS at a repo that no longer exists.
  assert.match(INGEST, /SACKMANN'S REPOS ARE GONE/i);
});

test('hold and break rates are derived, not stored', () => {
  // The table holds counts. A stored rate freezes its derivation into the data,
  // and this one has a subtlety worth keeping visible: a service game is lost
  // exactly when a break point is faced and not saved, because a converted
  // break point ends the game — so bp_faced - bp_saved counts GAMES.
  assert.doesNotMatch(MIGRATION, /hold_pct|break_pct|hold_percentage/);
  assert.match(MIGRATION, /bp_faced - bp_saved` counts GAMES/);
});

test("a row carries both ends of the match, so a return card needs no self-join", () => {
  for (const c of ['opp_ace', 'opp_svpt', 'opp_sv_gms', 'opp_bp_faced']) {
    assert.match(MIGRATION, new RegExp(`\\b${c}\\b`), `${c} column`);
  }
  assert.match(INGEST, /\*\*\{f"opp_\{k\}": v for k, v in l\.items\(\)\}/);
});

test('the write is an upsert, because TML rewrites a season as results land', () => {
  assert.match(DB, /ON CONFLICT \(sport, athlete_id, tourney_id, match_num\) DO UPDATE SET/);
});

test('surface is not re-ingested as if it were missing', () => {
  // The gameplan's correction 6 says surface is held nowhere. It was written
  // before import_tennis.py loaded tennis-data's Surface/Court into
  // game_result (2026-09-02), which covers BOTH tours back to 2015.
  assert.match(MIGRATION, /game_result` has carried `surface`/);
  assert.match(INGEST, /SURFACE WAS ALREADY HELD, for both tours/);
});

test('the Charting Project fills WTA and post-January ATP, and never double-counts', () => {
  assert.match(INGEST, /CHARTING: dict\[str, str\] = \{"tennis_wta": "w", "tennis_atp": "m"\}/);
  // An ATP charted match is written only AFTER the newest TML match held.
  assert.match(INGEST, /after = await db\.tennis_latest_match_date\(sport, SOURCE\)/);
  assert.match(INGEST, /if after is not None and md <= after:/);
  // It records no winner and no service games - stored as null, not guessed.
  assert.match(INGEST, /"won": None, "source": CHARTING_SOURCE/);
  assert.match(INGEST, /"sv_gms": None/);
});

test('a card that shows licensed data says so, visibly', () => {
  // CC BY means attribution wherever the data is SHOWN. A tooltip naming the
  // source was not that.
  const fmt = readFileSync('lib/slate/specialsFormat.ts', 'utf8');
  assert.match(fmt, /'tennis-serve-return':[\s\S]*?Match Charting Project[\s\S]*?Jeff Sackmann, CC BY-NC-SA 4\.0/);
  assert.match(fmt, /'tennis-surface-record':[\s\S]*?TML-Database[\s\S]*?CC BY-NC-SA 4\.0/);
  assert.match(readFileSync('lib/slate/spotlights.ts', 'utf8'), /SOURCE_CREDIT\[g\.rankingId\]/);
  assert.match(readFileSync('components/ResearchFlags.tsx', 'utf8'), /SOURCE_CREDIT\[g\.rankingId\]/);
});
