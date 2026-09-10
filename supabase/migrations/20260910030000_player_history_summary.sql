-- Phase 5.2 — the derived summary that lets player_game_history leave Postgres.
--
-- `player_game_history` is 2,807,445 rows / 1,839 MB, the single largest table
-- in an 8,192 MB database, and the serving pipes replay ALL of it every hour to
-- compute four numbers per player-market. This table stores those four numbers
-- directly: ~20k rows instead of 2.8M.
--
-- WHY NOT SIMPLY TRIM player_game_history. Measured 2026-09-10, keeping only the
-- newest three seasons moved 59.7% of served projections (median 0.0167,
-- p95 0.115, max 0.862) and dropped 44 rows below MIN_PRIOR_GAMES, because
-- `count_prop_engine.shrunk_rate` uses LIFETIME totals. The history is
-- load-bearing, so it has to be reproduced rather than shortened.
--
-- WHY NOT HAVE SERVING READ THE PARQUET CORPUS DIRECTLY. Measured 13-17s per
-- market from Supabase Storage, against 12 markets, hourly -- and every run
-- spends Storage egress, partially undoing what 5.1 saved.
--
-- recent_volume IS ORDER-SENSITIVE AND THAT IS NOT COSMETIC.
-- `PlayerHistory.mean_volume(window=N)` takes the LAST N entries, so this array
-- must be written in the same date order the replay produced, with the same
-- total sort (`mlb_props.load_game_history` breaks ties on `id` because MLB
-- doubleheaders put two rows on one (game_date, athlete_id)). An array written
-- from an unstable sort is a silently different model.
--
-- Capped at 200 entries to match count_prop_engine.MAX_RECENT. Longer would be
-- dead weight the engine discards; shorter would cap a window the fit may ask
-- for, which is exactly the defect the Phase 5 audit found when every market
-- sat pinned at volume_window=40.

CREATE TABLE IF NOT EXISTS player_history_summary (
    sport           text        NOT NULL,
    market          text        NOT NULL,
    athlete_id      text        NOT NULL,
    -- STRICTLY BEFORE this date, matching the leakage control the serving path
    -- applies to a replayed history. A summary without it cannot be checked.
    as_of           date        NOT NULL,
    events          double precision NOT NULL,
    volume          double precision NOT NULL,
    games           integer     NOT NULL,
    recent_volume   double precision[] NOT NULL,
    computed_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sport, market, athlete_id, as_of)
);

-- The serving read is (sport, market, as_of) then a subject filter, which is
-- exactly this index's prefix.
CREATE INDEX IF NOT EXISTS player_history_summary_lookup
    ON player_history_summary (sport, market, as_of);

COMMENT ON TABLE player_history_summary IS
    'Phase 5.2: per-player-market aggregates that reproduce PlayerHistory '
    'without replaying player_game_history. See count_prop_engine.'
    'history_from_summary for why exact float identity with a replay is not '
    'the gate (CPython sum() is compensated and differs from += by ~1 ulp).';
