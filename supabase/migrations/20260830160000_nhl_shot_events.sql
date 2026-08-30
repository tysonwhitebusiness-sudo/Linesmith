-- Phase 6.7 — NHL shot coordinates. APPROVED (operator, 2026-08-29).
--
-- WHAT THIS UNLOCKS. `lib/sports/nhl/nhle.ts` is integrated for rosters,
-- standings and schedules, and pulls no shot data at all. The same official,
-- keyless API exposes `/gamecenter/{gameId}/play-by-play`, whose `plays[]`
-- carry `details.xCoord`/`details.yCoord`, `shootingPlayerId` and a
-- `typeDescKey` of `shot-on-goal`, `missed-shot`, `blocked-shot` or `goal`.
-- Verified against a real finished game (2024010006): 321 plays, 102 of them
-- shots, coordinates present.
--
-- That is NHL's `spatialGrid` on the player, team and game boards.
--
-- WHY A NEW TABLE. Same reasoning as `mlb_pitch_events` (6.6): `nhle.ts` is on
-- the RENDER PATH and writes read-through caches into `snapshot_cache`. A
-- season of shot events is ~230k rows and has no business being rebuilt on a
-- page load. This is a batch job.
--
-- WHO WRITES IT. Python, per CLAUDE.md's "Python writes, TypeScript renders"
-- and the operator's 2026-08-30 decision on new sourcing tables. `nhle.ts` is
-- untouched.
--
-- GRAIN. One row per shot attempt, not per goal and not pre-aggregated. An
-- aggregate answers only the question it was built for, and blocked and missed
-- shots are exactly what distinguishes a volume shooter from an efficient one.
--
-- RINK COORDINATES. `xCoord` runs -100..100 along the ice with the goals at
-- +/-89; `yCoord` runs -42.5..42.5 across it, 0 at centre. **The sign of x
-- depends on which end the team is attacking, and that alternates by period.**
-- A consumer building a shot map must normalise to one attacking end using
-- `period` and the team's starting side, or it will fold a player's whole
-- season into a symmetric blur. This table stores the RAW values plus the
-- period, so that normalisation is a read-side decision that can be corrected
-- without a re-ingest.

BEGIN;

CREATE TABLE IF NOT EXISTS nhl_shot_events (
  id            bigserial PRIMARY KEY,

  -- NHL's own identifiers. A play is uniquely identified by its game and its
  -- sequence number within that game.
  game_id       bigint      NOT NULL,
  event_idx     integer     NOT NULL,
  game_date     date        NOT NULL,
  -- '20242025' as the NHL writes it, kept as text rather than a start year so
  -- it joins against the schedule endpoints without translation.
  season        text        NOT NULL,

  -- The player who took the shot. NULL only when the feed omits it, which does
  -- happen on some blocked shots.
  shooter_id    integer,
  goalie_id     integer,
  team_id       integer,

  -- 'shot-on-goal' | 'missed-shot' | 'blocked-shot' | 'goal'. Stored as the
  -- feed's own vocabulary rather than a boolean: 'was it a goal' is one
  -- question and these are four different events.
  event_type    text        NOT NULL,
  shot_type     text,

  period        smallint,
  -- Seconds elapsed in the period, from the feed's 'MM:SS'.
  period_seconds integer,

  -- RAW rink coordinates. See the header: x's sign alternates by period.
  x_coord       smallint,
  y_coord       smallint,
  -- 'O' | 'D' | 'N' — the feed's own offensive/defensive/neutral zone code.
  zone_code     text,

  fetched_at    timestamptz NOT NULL DEFAULT now(),

  -- Idempotent re-runs. A backfill sweeps games and a game can be re-fetched
  -- after an interruption; ON CONFLICT DO NOTHING makes that a no-op.
  UNIQUE (game_id, event_idx)
);

-- The two real read patterns, and nothing speculative.
-- 1. One shooter's season: the shot map on a player page.
CREATE INDEX IF NOT EXISTS idx_nhl_shot_events_shooter
  ON nhl_shot_events (shooter_id, season);
-- 2. One game: the game page's shot chart, and the ingester's own
--    already-have-this-game check.
CREATE INDEX IF NOT EXISTS idx_nhl_shot_events_game
  ON nhl_shot_events (game_id);

COMMENT ON TABLE nhl_shot_events IS
  'Phase 6.7: one row per shot attempt from api-web.nhle.com''s '
  '/gamecenter/{id}/play-by-play. Written only by Python (nhl_shots.py, '
  'ingestNhlShotsJob); TypeScript reads it. lib/sports/nhl/nhle.ts is a '
  'separate, render-path, read-through cache and does not write here.';

COMMENT ON COLUMN nhl_shot_events.x_coord IS
  'RAW rink x, -100..100, goals at +/-89. The SIGN DEPENDS ON WHICH END THE '
  'TEAM IS ATTACKING and alternates by period -- a shot map must normalise '
  'using `period` before aggregating, or a season folds into a symmetric '
  'blur. Stored raw so that normalisation stays a read-side decision.';

COMMENT ON COLUMN nhl_shot_events.event_type IS
  'The feed''s own typeDescKey: shot-on-goal | missed-shot | blocked-shot | '
  'goal. Kept as four values rather than a boolean because blocked and missed '
  'shots are what separate a volume shooter from an efficient one.';

COMMIT;
