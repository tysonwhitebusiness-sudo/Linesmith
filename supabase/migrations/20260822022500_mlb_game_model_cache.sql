-- Phase N of the TS cutover gameplan (docs/mlb-prediction-engine-ts-cutover-gameplan-2026-08-22.md):
-- Python's independently-computed gameModel + Elo per game, persisted so a
-- future Phase O can have adapter.ts read from here instead of computing
-- live. Additive only — nothing reads this table yet.
CREATE TABLE IF NOT EXISTS mlb_game_model_cache (
  sport               TEXT NOT NULL,
  game_id             TEXT NOT NULL,
  home_expected_runs  DOUBLE PRECISION NOT NULL,
  away_expected_runs  DOUBLE PRECISION NOT NULL,
  home_win_prob       DOUBLE PRECISION NOT NULL,
  away_win_prob       DOUBLE PRECISION NOT NULL,
  diagnostics_json    TEXT NOT NULL,
  home_elo            DOUBLE PRECISION NOT NULL,
  home_games_played   INTEGER NOT NULL,
  away_elo            DOUBLE PRECISION NOT NULL,
  away_games_played   INTEGER NOT NULL,
  home_rest_days      DOUBLE PRECISION NOT NULL,
  away_rest_days      DOUBLE PRECISION NOT NULL,
  home_travel_miles   DOUBLE PRECISION NOT NULL,
  away_travel_miles   DOUBLE PRECISION NOT NULL,
  home_pitcher_adj    DOUBLE PRECISION NOT NULL,
  away_pitcher_adj    DOUBLE PRECISION NOT NULL,
  computed_at         TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (sport, game_id)
);
