-- team_elo_history was MLB-only by construction (no sport column) —
-- reusing it as-is for other sports would risk colliding different
-- sports' own numeric team_id values under the same rating. Adds `sport`,
-- defaulting existing (MLB-only) rows to 'mlb', and widens the unique
-- constraint so the same team_id can carry independent ratings per sport.
ALTER TABLE team_elo_history ADD COLUMN IF NOT EXISTS sport TEXT NOT NULL DEFAULT 'mlb';

ALTER TABLE team_elo_history DROP CONSTRAINT IF EXISTS team_elo_history_team_id_season_game_pk_key;
ALTER TABLE team_elo_history ADD CONSTRAINT team_elo_history_sport_team_id_season_game_pk_key UNIQUE (sport, team_id, season, game_pk);

DROP INDEX IF EXISTS idx_team_elo_lookup;
CREATE INDEX IF NOT EXISTS idx_team_elo_lookup ON team_elo_history (sport, team_id, season, game_date);
