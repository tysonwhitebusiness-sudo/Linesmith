-- Phase 6.7 — NBA shot coordinates. APPROVED (operator, 2026-08-29).
--
-- WHAT THIS UNLOCKS. `lib/sports/nba/sportsdataverse.ts` is integrated for box
-- scores only. ESPN's own summary endpoint
-- (`/basketball/nba/summary?event={id}`) returns `plays[]` with `coordinate`,
-- `shootingPlay`, `scoringPlay`, `scoreValue` and the shooter in
-- `participants[].athlete.id`. That is NBA's `spatialGrid` on all three boards.
--
-- WHO WRITES IT. Python, per CLAUDE.md's "Python writes, TypeScript renders"
-- and the operator's 2026-08-30 decision on new sourcing tables.
-- `sportsdataverse.ts` is untouched.
--
-- ============ THE SENTINEL, AND WHY THE COLUMNS ARE NULLABLE ==============
--
-- **ESPN encodes "no coordinate" as roughly -214748340**, near INT32_MIN,
-- rather than as null. A `!= null` check accepts it. Measured on one real game:
-- 55 of 250 shooting plays carried it, and including them turned the mean shot
-- distance for two-pointers into 72,623,934 feet.
--
-- Rows arrive here with those already rejected to NULL by the ingester, so the
-- database never stores a sentinel. The columns are nullable precisely so that
-- "we do not know where this shot was taken" is representable — a free throw
-- has no meaningful location and never gets a fabricated one.
--
-- GEOMETRY, established from ground truth rather than assumed: the basket is at
-- (25, 0) and the units are feet. Three-pointers in that game averaged 26.6
-- feet from that point and two-pointers 12.9, against a real three-point line
-- of 22 feet in the corners and 23.75 at the top. x spans the 50-foot width,
-- y is distance from the baseline.
-- =========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS nba_shot_events (
  id           bigserial PRIMARY KEY,

  game_id      bigint      NOT NULL,
  -- ESPN's own per-play sequence. Unique within a game.
  event_idx    bigint      NOT NULL,
  game_date    date        NOT NULL,
  -- ESPN's season year, e.g. 2025 for the 2024-25 season.
  season       integer     NOT NULL,

  shooter_id   integer,
  team_id      integer,

  -- ESPN's own play type text ('Driving Layup Shot', 'Jump Shot').
  shot_type    text,
  -- 2 or 3. Free throws are not shots from the floor and are excluded entirely.
  point_value  smallint,
  made         boolean     NOT NULL,

  period       smallint,

  -- Feet, basket at (25, 0). NULL where ESPN gave the sentinel — see header.
  x_coord      real,
  y_coord      real,

  fetched_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (game_id, event_idx)
);

CREATE INDEX IF NOT EXISTS idx_nba_shot_events_shooter
  ON nba_shot_events (shooter_id, season);
CREATE INDEX IF NOT EXISTS idx_nba_shot_events_game
  ON nba_shot_events (game_id);

COMMENT ON TABLE nba_shot_events IS
  'Phase 6.7: one row per field-goal attempt from ESPN''s NBA summary '
  'endpoint. Written only by Python (nba_shots.py, ingestNbaShotsJob); '
  'TypeScript reads it. Free throws are excluded -- they have no floor '
  'location and ESPN gives them the missing-coordinate sentinel anyway.';

COMMENT ON COLUMN nba_shot_events.x_coord IS
  'Feet across the court, basket at x=25. NULL where ESPN returned its '
  'missing-coordinate sentinel (~-214748340, near INT32_MIN) -- 55 of 250 '
  'shooting plays in one measured game. A `!= null` check accepts that value; '
  'including it made the mean two-point distance 72,623,934 feet.';

COMMIT;
