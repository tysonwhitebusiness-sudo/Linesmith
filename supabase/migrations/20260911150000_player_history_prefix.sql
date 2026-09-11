-- Phase 5: the STATIC half of the history summary, so the worker never reads
-- the Parquet corpus.
--
-- WHY. `mlbHistorySummaryJob` built `player_history_summary` from a UNION of the
-- corpus and the Postgres hot window, and that corpus read is the largest
-- single step in the worker's memory climb: traced 2026-09-11 across one worker
-- lifetime, 272 MB before the job and 390 MB after -- +118 MB in one job, never
-- released. `corpus_store` had already measured why (CPython does not return
-- freed arenas to the OS) and barred the corpus EXPORT from the worker for
-- exactly that reason; the summary's corpus READ was never costed the same way.
-- Worker RAM is one of Phase 5's three ceilings and it had got WORSE, not
-- better, during the phase.
--
-- THE KEY OBSERVATION: THE CORPUS HALF NEVER CHANGES. `player_game_history` is
-- pruned to a hot window, and every game BEFORE that window is finished
-- forever. So its contribution to the summary is static and can be computed
-- once, off the worker, and stored -- leaving the daily job a pure Postgres
-- read of prefix + hot window.
--
-- All six aggregates are additively decomposable across a date split, which is
-- what makes this exact rather than approximate:
--   events, volume, games, baseline_over, baseline_total  -> sum
--   recent_volume                                         -> (prefix ++ hot)[-MAX_RECENT:]
-- The concatenation is only valid because the prefix is ENTIRELY earlier than
-- the hot window, which `cutoff` is what pins down.

CREATE TABLE IF NOT EXISTS player_history_prefix (
    sport           text        NOT NULL,
    market          text        NOT NULL,
    athlete_id      text        NOT NULL,
    -- Every game STRICTLY BEFORE this date is in here; everything from it
    -- onwards is in Postgres. Stored rather than implied so a reader can assert
    -- the two halves meet exactly, instead of trusting that they do.
    cutoff          date        NOT NULL,
    events          double precision NOT NULL,
    volume          double precision NOT NULL,
    games           integer     NOT NULL,
    recent_volume   double precision[] NOT NULL,
    baseline_over   integer     NOT NULL DEFAULT 0,
    baseline_total  integer     NOT NULL DEFAULT 0,
    -- The baseline counts depend on the board line, so a changed line has to
    -- invalidate them rather than silently carry forward.
    board_line      double precision,
    computed_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sport, market, athlete_id, cutoff)
);

CREATE INDEX IF NOT EXISTS player_history_prefix_lookup
    ON player_history_prefix (sport, market, cutoff);

COMMENT ON TABLE player_history_prefix IS
    'Phase 5: per-player-market aggregate of all games BEFORE the hot window, '
    'computed from the Parquet corpus on the operator machine so the Render '
    'worker never has to read the corpus. See build_history_prefix.py.';
