-- Phase 5.S.7 — the derived team-name index that lets odds_archive leave Postgres.
--
-- `archival_bridge._team_ids` resolves an incoming team NAME to our team id by
-- scanning `odds_archive`'s own history: 1,982,889 rows to produce **874
-- distinct (name, id) pairs**. That was merely wasteful while the whole archive
-- lived in Postgres. It becomes a correctness problem the moment 5.S.7 prunes
-- the archive to its unfrozen tail, because 99.8% of those rows are frozen —
-- the index would collapse from 874 pairs to a handful and every unmatched
-- capture would be routed to `odds_unresolved`. Silently: nothing raises, the
-- bridge keeps running, and the archive quietly stops being fed resolved rows.
--
-- So the pairs are stored instead of re-derived, exactly as `player_history_summary`
-- stores what the serving pipes used to replay.
--
-- WHY NOT HAVE `_team_ids` READ THE PARQUET CORPUS DIRECTLY: it runs on the
-- Render worker behind a 1-hour TTL, and the corpus lives in object storage.
-- Re-reading ~100 MB of `odds_archive` Parquet every hour to rebuild 874 rows
-- would spend Storage egress to solve a problem this table solves for free —
-- and egress is the ceiling 5.1 exists to have protected.
--
-- SEEDED ONCE from the corpus, then kept current from the LIVE tail alone.
-- A genuinely new spelling arrives as a live row, so the refresh never needs to
-- touch the corpus again.

CREATE TABLE IF NOT EXISTS team_name_index (
    sport        text NOT NULL,
    -- The NORMALISED name, because that is the key `_team_ids` looks up:
    -- `normalize_team_name(raw)`. Storing the raw form and normalising on read
    -- would make every reader repeat a transform that must not drift.
    name_key     text NOT NULL,
    team_id      text NOT NULL,
    raw_sample   text,          -- one real spelling, for diagnosis
    first_seen   timestamptz NOT NULL DEFAULT now(),
    last_seen    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sport, name_key)
);

COMMENT ON TABLE team_name_index IS
    'Phase 5.S.7: (normalised team name -> team id) per sport, derived from '
    'odds_archive so that archival_bridge._team_ids need not scan 1.98M rows — '
    'and so that it keeps working once odds_archive is pruned to its unfrozen '
    'tail. Seeded from the Parquet corpus; refreshed from live rows only.';
