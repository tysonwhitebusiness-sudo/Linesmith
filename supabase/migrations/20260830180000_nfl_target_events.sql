-- Phase 6.8 — nflverse play-by-play, the passing half.
--
-- WHAT THIS UNLOCKS. `lib/sports/nfl/nflverse.ts` pulls that project's WEEKLY
-- BOX SCORES only. Its play-by-play release carries `air_yards`,
-- `pass_location` (left/middle/right) and `pass_length` (short/deep) per play,
-- which is NFL's target map (`spatialGrid`) and target mix (`usageMix`). The
-- adapter's own comments already flag the gap ("nflverse's Receiving group is
-- thin").
--
-- Same vendor, same release mechanism, no key, no cost.
--
-- WHY A NEW TABLE. `play_by_play_{season}.csv` is ~99 MB and 372 columns.
-- `nflverse.ts` is on the render path and writes read-through caches into
-- `snapshot_cache`; streaming a 99 MB CSV on a page load is not a thing that
-- can happen. Python owns this, per CLAUDE.md and the operator's 2026-08-30
-- decision on new sourcing tables.
--
-- GRAIN. One row per PASS ATTEMPT WITH A RECEIVER — not every play. A 99 MB
-- season is ~50k plays of which the passing game is roughly 19k; storing
-- kickoffs and timeouts to build a target map would be storage spent on rows
-- no consumer will ever read.
--
-- INCOMPLETIONS ARE KEPT. `air_yards` exists on an incomplete pass and a
-- target map built from completions only measures the quarterback's accuracy
-- rather than where the receiver is used. `complete_pass` distinguishes them.

BEGIN;

CREATE TABLE IF NOT EXISTS nfl_target_events (
  id            bigserial PRIMARY KEY,

  -- nflverse's own identifiers. `game_id` is a string like '2024_01_BAL_KC'.
  game_id       text        NOT NULL,
  play_id       integer     NOT NULL,
  season        integer     NOT NULL,
  week          smallint,

  -- GSIS ids, e.g. '00-0033873'. Text, not integers — they are not numeric.
  receiver_id   text,
  passer_id     text,
  team          text,

  -- Yards the ball travelled past the line of scrimmage. NEGATIVE on a screen,
  -- which is real and must not be clamped to zero.
  air_yards     real,
  -- 'left' | 'middle' | 'right'.
  pass_location text,
  -- 'short' | 'deep'. nflverse's own two-way split, kept alongside the
  -- continuous `air_yards` rather than instead of it.
  pass_length   text,
  yards_after_catch real,

  complete_pass boolean,
  touchdown     boolean,
  interception  boolean,

  fetched_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (game_id, play_id)
);

-- One receiver's season: the target map on a player page.
CREATE INDEX IF NOT EXISTS idx_nfl_target_events_receiver
  ON nfl_target_events (receiver_id, season);
-- One season's ingest check, and a team's own passing distribution.
CREATE INDEX IF NOT EXISTS idx_nfl_target_events_season_game
  ON nfl_target_events (season, game_id);

COMMENT ON TABLE nfl_target_events IS
  'Phase 6.8: one row per pass attempt with a receiver, from nflverse''s '
  'play_by_play_{season}.csv. Written only by Python (nfl_pbp.py, '
  'ingestNflPbpJob); TypeScript reads it. lib/sports/nfl/nflverse.ts is a '
  'separate, render-path, weekly-box-score cache and does not write here.';

COMMENT ON COLUMN nfl_target_events.air_yards IS
  'Yards past the line of scrimmage at the catch point. NEGATIVE on a screen '
  'pass, which is real -- clamping it to zero would move every screen into the '
  'same band as a checkdown and erase the distinction a target map exists to '
  'show.';

COMMIT;
