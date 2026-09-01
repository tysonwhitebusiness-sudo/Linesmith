-- Every loader now clears its own rows by `source` before re-inserting, and
-- promotion deletes the archive rows for exactly the sources staging covers.
-- That made `WHERE source = $1` the hottest predicate in the import path, and
-- none of the three tables had an index for it.
--
-- It surfaced as a statement timeout: import_mlb_sbr.py's clear step had to
-- delete 55,756 game_result rows by sequential scan and was cancelled. The
-- loaders are correct; the tables just could not answer the question quickly.
--
-- odds_archive already has a source column in its natural key, but that index
-- leads with `sport` and is partial (`WHERE home_team_id IS NOT NULL`), so it
-- cannot serve a bare source lookup — and the tennis rows it excludes are
-- exactly the ones a source-scoped delete would need to find.

CREATE INDEX IF NOT EXISTS game_result_source ON game_result (source);
CREATE INDEX IF NOT EXISTS odds_import_staging_source ON odds_import_staging (source);
CREATE INDEX IF NOT EXISTS odds_archive_source ON odds_archive (source);
