-- Phase 6.13 — golf's `usageMix` and `spatialGrid`, the last two role cells
-- that needed data this app did not have.
--
-- SOURCE: the `golfR` project's bundled PGA Tour shot-by-shot files
-- (`data/pbp/`), 40 tournaments across 2020-2023. The operator sourced these
-- after the sourcing audit; they are what turned "needs ShotLink, which is
-- commercial" into an ingest task.
--
-- ITS SCRAPER IS DEAD AND THAT IS FINE. golfR reads
-- `tourcastdata.pgatour.com`, a host that no longer resolves (verified against
-- a control: `www.pgatour.com` answers 200 from the same machine). This table
-- is therefore a STATIC HISTORICAL SEED, not a feed. Current tournaments would
-- need PGA's present-day endpoint, which nobody has scoped.
--
-- WHY `lie` IS NOT THE LIE. The file has a `lie` column and it is the string
-- "NA" on every one of a real tournament's 10,222 rows. The actual lie
-- vocabulary lives in `from`/`to`: OTB (tee box), OFW (fairway), ORO (rough),
-- OGR (green), OGS (greenside sand), OIR (intermediate rough), ONA (native
-- area). Measured, not assumed — a loader trusting the column named `lie`
-- would write nothing but nulls and look like it worked.
--
-- WRITTEN BY PYTHON, per CLAUDE.md's table-ownership rule: the loader is
-- `python-odds-service/src/golf_shots.py`, operator-run, never scheduled.

CREATE TABLE IF NOT EXISTS golf_shot_events (
  id                BIGSERIAL PRIMARY KEY,
  -- PGA's own ids, kept as text: they are zero-padded ("011") and a numeric
  -- column would silently drop the padding that makes them match the source.
  tournament_id     TEXT    NOT NULL,
  season            INTEGER NOT NULL,
  course_id         TEXT,
  round_number      INTEGER NOT NULL,
  hole_number       INTEGER NOT NULL,
  player_id         TEXT    NOT NULL,
  player_name       TEXT,
  shot_number       INTEGER NOT NULL,
  -- Both already converted to yards by the loader. The source writes "311
  -- yds", "5 ft 3 in" and "108 yds" in one column, so a raw copy would be
  -- unusable for arithmetic.
  distance_yds      DOUBLE PRECISION,
  -- Distance REMAINING to the pin after the shot. This is the proximity half
  -- of `spatialGrid`.
  left_yds          DOUBLE PRECISION,
  -- `from`/`to` in the source. `from_lie` is the lie the shot was played from
  -- and is the grouping axis for both roles.
  from_lie          TEXT,
  to_lie            TEXT,
  is_putt           BOOLEAN NOT NULL DEFAULT FALSE,
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One row per shot. Re-running the loader over the same files is a no-op
  -- rather than a duplicate, the same contract every other ingester here has.
  UNIQUE (tournament_id, season, round_number, hole_number, player_id, shot_number)
);

-- The one query both roles run: every shot a player took in a season.
CREATE INDEX IF NOT EXISTS golf_shot_events_player_season_idx
  ON golf_shot_events (player_id, season);

-- Lie rollups across a season, for the mix.
CREATE INDEX IF NOT EXISTS golf_shot_events_lie_idx
  ON golf_shot_events (season, from_lie);

ALTER TABLE golf_shot_events ENABLE ROW LEVEL SECURITY;

-- Read-only to the app, same posture as the other sourcing tables: the service
-- role writes, everyone else reads.
DROP POLICY IF EXISTS golf_shot_events_read ON golf_shot_events;
CREATE POLICY golf_shot_events_read ON golf_shot_events FOR SELECT USING (true);
