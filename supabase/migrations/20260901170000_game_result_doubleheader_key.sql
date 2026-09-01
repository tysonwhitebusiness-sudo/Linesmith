-- game_result's natural key was missing event_ref, and that is not cosmetic.
--
-- CURRENT.md has warned since the odds import that "doubleheaders are real --
-- event_ref belongs in any game natural key". The rule was applied to
-- odds_import_staging and then not carried across to game_result, which was
-- created empty in the same migration and never loaded, so nothing surfaced it.
--
-- Measured before the first load, against the ESPN core files:
--
--     520 (sport, date, home_team, away_team) keys cover 1,044 real events
--     -- 511 MLB, 8 NHL, 1 NBA.
--
-- Loading through the old index with ON CONFLICT DO NOTHING would have
-- silently discarded 524 games that genuinely happened, and the table would
-- have looked complete. Two ESPN event ids on the same day with the same two
-- teams are two games, not a duplicate.
--
-- SBR carries no event id, but it also carries no collisions at all (checked:
-- 0 across 37,845 NBA and NHL rows, neither of which is a sport that plays
-- doubleheaders), so COALESCE to '' leaves it keyed exactly as before.

DROP INDEX IF EXISTS game_result_natural_key;
CREATE UNIQUE INDEX IF NOT EXISTS game_result_natural_key
  ON game_result (sport, game_date, home_team_raw, away_team_raw, source,
                  COALESCE(event_ref, ''));
