-- Phase 6.6 — pitch-level Statcast.
--
-- WHAT THIS UNLOCKS. `lib/sports/mlb/savant.ts` already calls Baseball
-- Savant's PITCH-LEVEL endpoint (`statcast_search/csv`, `type=details`) but
-- passes `group_by: 'name'`, which collapses the response to one
-- season-aggregate row per player. Ungrouped, the same keyless call returns
-- every pitch with its `zone`, `pitch_type`, `plate_x`/`plate_z` and
-- `estimated_woba_using_speedangle`. That is the strike-zone grid
-- (`spatialGrid`), the pitch mix (`usageMix`) and the opposing-starter zone
-- matchup on all three boards, plus seven Statcast metrics the mockups show
-- and we do not have today (only barrelPct, exitVelo, hardHitPct and whiffPct
-- exist).
--
-- WHY A NEW TABLE AND NOT A CHANGE TO savant.ts. That TypeScript function is on
-- the RENDER PATH: it populates a season-aggregate cache in `snapshot_cache`
-- that the player and team pages read. Ungrouping it in place would put ~700k
-- rows per season through a page load. The pitch-level pull is a batch job, and
-- it was never going to belong in that file. `savant.ts` is untouched by this.
--
-- WHO WRITES IT. Python, per CLAUDE.md's "Python writes, TypeScript renders"
-- and the operator's 2026-08-30 decision. Worth noting precisely why that
-- convention did not already bind savant.ts and its three siblings
-- (nflverse.ts, nba/sportsdataverse.ts, nhl/nhle.ts): none of them own a
-- table — they are all read-through caches writing to `snapshot_cache`. The
-- convention binds the moment a real table exists, which is here.
--
-- SCOPE: 2024 onwards (operator, 2026-08-30). Three seasons, roughly 700k
-- pitches each. Storage is a real consideration but not a blocking one: the
-- database is 2,234 MB on the Supabase PRO plan (8 GB included), and this adds
-- a few hundred MB.
--
-- GRAIN. One row per pitch. Deliberately NOT pre-aggregated to
-- player x zone: an aggregate answers only the questions it was built for, and
-- the point of this phase is depth. Every consumer rolls up from here.

BEGIN;

CREATE TABLE IF NOT EXISTS mlb_pitch_events (
  id            bigserial PRIMARY KEY,
  -- Savant's own identifiers. `game_pk` + `at_bat_number` + `pitch_number`
  -- is the natural key: a pitch is uniquely identified by which game, which
  -- plate appearance, and which pitch of it.
  game_pk       bigint      NOT NULL,
  at_bat_number integer     NOT NULL,
  pitch_number  integer     NOT NULL,
  game_date     date        NOT NULL,
  season        integer     NOT NULL,

  pitcher_id    integer     NOT NULL,
  batter_id     integer     NOT NULL,
  -- 'L'/'R'. Handedness is what makes a platoon split (`binarySplit`) real.
  p_throws      text,
  stand         text,

  -- 'FF', 'SL', 'CH'... the pitch mix.
  pitch_type    text,
  -- Savant's 1-14 zone code: 1-9 are the strike zone in a 3x3 grid read from
  -- the catcher's view, 11-14 are the four outside quadrants.
  zone          smallint,
  -- Raw horizontal/vertical location in feet, for anything the 14-zone code
  -- is too coarse for.
  plate_x       real,
  plate_z       real,

  release_speed real,
  launch_speed  real,
  launch_angle  real,
  -- Expected wOBA on contact — the headline quality-of-contact metric, and
  -- what the zone grid is shaded by.
  estimated_woba real,

  -- 'called_strike', 'swinging_strike', 'hit_into_play'... drives whiff rate.
  description   text,
  -- 'single', 'strikeout', NULL for a non-terminal pitch.
  events        text,
  balls         smallint,
  strikes       smallint,

  fetched_at    timestamptz NOT NULL DEFAULT now(),

  -- Idempotent re-runs. The backfill sweeps date ranges and a range can be
  -- re-fetched after an interruption; ON CONFLICT DO NOTHING against this makes
  -- that a no-op rather than a duplicate.
  UNIQUE (game_pk, at_bat_number, pitch_number)
);

-- The two real read patterns, and nothing speculative.
-- 1. One pitcher's season: the pitch mix and the zone grid on a player page.
CREATE INDEX IF NOT EXISTS idx_mlb_pitch_events_pitcher
  ON mlb_pitch_events (pitcher_id, season);
-- 2. One batter's season: the zone grid on a hitter's page, and the
--    opposing-starter zone matchup.
CREATE INDEX IF NOT EXISTS idx_mlb_pitch_events_batter
  ON mlb_pitch_events (batter_id, season);

COMMENT ON TABLE mlb_pitch_events IS
  'Phase 6.6: one row per pitch from Baseball Savant''s statcast_search/csv '
  'endpoint, UNGROUPED. Written only by Python (statcast_pitches.py, '
  'ingestStatcastPitchesJob); TypeScript reads it. lib/sports/mlb/savant.ts is '
  'a separate, render-path, season-AGGREGATE cache and does not write here. '
  'Scope 2024 onwards per the operator, 2026-08-30.';

COMMENT ON COLUMN mlb_pitch_events.zone IS
  'Savant zone code. 1-9 = the strike zone as a 3x3 grid from the CATCHER''S '
  'view (1 is up-and-in to a right-handed batter); 11-14 = the four outside '
  'quadrants. Not a row/column pair -- a consumer building a 3x3 grid maps '
  '1-9 itself and decides what to do with 11-14.';

COMMENT ON COLUMN mlb_pitch_events.estimated_woba IS
  'estimated_woba_using_speedangle: expected wOBA on contact from exit velocity '
  'and launch angle. READ THIS BEFORE AVERAGING IT. Savant does NOT reliably '
  'null it on a pitch that was not put in play -- measured on one real day, 332 '
  'of 3,619 non-in-play pitches carried a value and 218 of those were 0.0. '
  'Averaging every row therefore drags each zone DOWN: zone 1 reads .281 that '
  'way against a true .367, zone 9 .235 against .318. The correct filter is '
  'description = ''hit_into_play'', NOT "estimated_woba IS NOT NULL".';

COMMIT;
