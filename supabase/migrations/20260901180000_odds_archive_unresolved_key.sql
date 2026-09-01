-- odds_archive's natural key is PARTIAL:
--
--   WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL
--
-- which is right for the team sports -- an unresolved row never reaches this
-- table, because import_odds_staging holds it back. But it means a row with a
-- NULL entity id has NO uniqueness protection whatsoever, and tennis is
-- exactly that row: it is a PLAYER contest, its two sides are people, and the
-- tennis-data files publish names ("Vukic A.") with no id of any kind. The
-- 4-digit ids in player_game_history's tennis rows come from a different
-- provider again and there is no name column anywhere to bridge them, so the
-- ids stay NULL rather than being invented.
--
-- Without this index a second run of import_tennis.py would silently double
-- every row it had already written. With it the load is idempotent, keyed on
-- the deterministic match key the loader puts in event_ref.
--
-- The two indexes are disjoint by construction, so no row is covered twice and
-- the existing one is untouched.

CREATE UNIQUE INDEX IF NOT EXISTS odds_archive_natural_key_unresolved
  ON odds_archive (sport, game_date, home_team_raw, away_team_raw, market, side,
                   COALESCE(bookmaker, ''), source, COALESCE(event_ref, ''))
  WHERE home_team_id IS NULL OR away_team_id IS NULL;
