-- team_elo_history.team_id: integer -> text.
--
-- It is the ONLY id column in the database that is not text. Measured
-- 2026-08-31: player_game_history.team_id/athlete_id/event_id/opponent_id,
-- prop_odds.game_id/subject_id, pick_history.game_id/subject_id,
-- game_odds_history.event_id, game_picks.game_id and venue_factors.team_id are
-- all `text`; team_elo_history.team_id alone is `integer`.
--
-- Every join out of Elo therefore needs a cast today, and an uncast join
-- against a text column raises `operator does not exist: text = integer` —
-- which it did, during this session's own entity audit. That is exactly the
-- class of failure a bulk import turns into silently-dropped rows.
--
-- Backed up first because this rewrites 88,802 rows. Verify the count after.

CREATE TABLE IF NOT EXISTS team_elo_history_int_backup_20260901 AS
  SELECT * FROM team_elo_history;

ALTER TABLE team_elo_history
  ALTER COLUMN team_id TYPE text USING team_id::text;

ALTER TABLE team_elo_history
  ALTER COLUMN opponent_team_id TYPE text USING opponent_team_id::text;
