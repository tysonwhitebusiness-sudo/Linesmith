-- Initial Postgres schema — translated from lib/db/schema.ts's SQLite SCHEMA_SQL
-- (27 tables) as the Phase 1 SQLite -> Supabase/Postgres cutover. Applied via
-- both this file (so the SQL lives in the repo as a reviewable, versioned
-- artifact) and the Supabase MCP connector's apply_migration (so it's also
-- recorded in Supabase's own migration history for this project).
--
-- Deliberately a behavior-preserving port, not a redesign:
--   - INTEGER PRIMARY KEY AUTOINCREMENT -> BIGINT GENERATED ALWAYS AS IDENTITY
--   - REAL -> DOUBLE PRECISION
--   - 0/1 flag columns (is_delayed, was_home, made_cut, *_late, active, hit,
--     actual_won/top5/top10/made_cut) -> BOOLEAN, since Postgres has a real
--     boolean type and there's no reason to keep faking one with INTEGER
--   - TEXT timestamp columns that represent an instant (created_at,
--     fetched_at, submitted_at, surfaced_at, *_captured_at, computed_at,
--     ingested_at, updated_at, predicted_at, finished_at, observed_at,
--     occurred_at, seen_at, fitted_at, graded_at, settled_at,
--     commence_time) -> TIMESTAMPTZ
--   - TEXT columns documented as calendar dates only (game_date, start_date)
--     -> DATE
--   - JSON-holding TEXT columns (feature_names, weights_json,
--     covariance_json, holes_json, *_features_json, *_seasons_json, and the
--     odds_cache/snapshot_cache payload blobs) are deliberately LEFT AS TEXT
--     for this phase — upgrading them to JSONB is a real, separate follow-up
--     migration, not bundled in here, so this cutover changes the storage
--     engine and nothing else about how the app reads/writes JSON.
--   - PRAGMA journal_mode/foreign_keys have no Postgres equivalent and are
--     dropped; moot regardless, since the source schema declares zero FK
--     constraints anywhere (confirmed during the Turso migration audit).
--   - Table order matches the source file for easy side-by-side diffing;
--     since there are no FK constraints, creation order has no effect.

-- ---------------------------------------------------------------------------
-- Legs the user has added to their slip.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS picks (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport              TEXT NOT NULL,
  subject_id         TEXT NOT NULL,
  subject_name       TEXT NOT NULL,
  dimension          TEXT NOT NULL,
  dimension_label    TEXT NOT NULL,
  category           TEXT NOT NULL,
  category_label     TEXT NOT NULL,
  line               DOUBLE PRECISION,
  game_id            TEXT,
  team_id            INTEGER,
  team               TEXT,
  opponent_id        INTEGER,
  opponent           TEXT,
  american_odds      TEXT,
  odds_source        TEXT,
  odds_captured_at   TIMESTAMPTZ,
  bookmaker          TEXT,
  event_context      TEXT,
  sample_size        INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sport, subject_id, dimension, category)
);

CREATE INDEX IF NOT EXISTS idx_picks_sport ON picks (sport);

-- ---------------------------------------------------------------------------
-- Bets the user has submitted off their slip.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bets (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport              TEXT NOT NULL,
  subject_id         TEXT NOT NULL,
  subject_name       TEXT NOT NULL,
  dimension          TEXT NOT NULL,
  dimension_label    TEXT NOT NULL,
  category           TEXT NOT NULL,
  category_label     TEXT NOT NULL,
  line               DOUBLE PRECISION,
  game_id            TEXT,
  team_id            INTEGER,
  team               TEXT,
  opponent_id        INTEGER,
  opponent           TEXT,
  american_odds      TEXT,
  odds_source        TEXT,
  bookmaker          TEXT,
  event_context      TEXT,
  sample_size        INTEGER,
  submitted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'live' | 'won' | 'lost' | 'push'
  actual_value       DOUBLE PRECISION,
  settled_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bets_sport ON bets (sport, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_bets_open_by_game ON bets (game_id) WHERE status IN ('pending', 'live');

CREATE TABLE IF NOT EXISTS watchlist (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport        TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sport, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_sport ON watchlist (sport);

-- ---------------------------------------------------------------------------
-- Log of what the scan surfaced, for grading + calibration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pick_history (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport              TEXT NOT NULL,
  subject_id         TEXT NOT NULL,
  subject_name       TEXT NOT NULL,
  dimension          TEXT NOT NULL,
  category           TEXT NOT NULL,
  market_key         TEXT,
  line               DOUBLE PRECISION,
  game_id            TEXT,
  sample_size        INTEGER,
  distance           INTEGER,
  event_context      TEXT,
  surfaced_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  model_prob         DOUBLE PRECISION,
  market_prob        DOUBLE PRECISION,
  edge               DOUBLE PRECISION,
  price_source       TEXT,
  bookmaker          TEXT,
  price_captured_at  TIMESTAMPTZ,
  outcome            TEXT,
  actual_value       DOUBLE PRECISION,
  graded_at          TIMESTAMPTZ,
  prop_score         DOUBLE PRECISION,
  score_grade        TEXT,
  trust_tier         TEXT,
  model_version      INTEGER,
  UNIQUE (sport, subject_id, dimension, category, game_id)
);

CREATE INDEX IF NOT EXISTS idx_pick_history_subject ON pick_history (sport, subject_id);
CREATE INDEX IF NOT EXISTS idx_pick_history_ungraded ON pick_history (game_id) WHERE outcome IS NULL;

-- Cached game-level lines from the-odds-api.com.
CREATE TABLE IF NOT EXISTS odds_cache (
  cache_key          TEXT PRIMARY KEY,
  payload            TEXT NOT NULL,
  fetched_at         TIMESTAMPTZ NOT NULL,
  requests_remaining INTEGER,
  requests_used      INTEGER
);

-- Cached sport snapshots.
CREATE TABLE IF NOT EXISTS snapshot_cache (
  cache_key  TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL
);

-- User-supplied embed links for the Watch tab.
CREATE TABLE IF NOT EXISTS watch_links (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label      TEXT NOT NULL,
  url        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Update 09: five-provider player-prop odds
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prop_odds (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id    TEXT NOT NULL,
  game_id        TEXT NOT NULL,
  subject_id     TEXT NOT NULL,
  subject_name   TEXT NOT NULL,
  market_key     TEXT NOT NULL,
  line           DOUBLE PRECISION,
  side           TEXT NOT NULL,
  bookmaker      TEXT NOT NULL,
  american_odds  INTEGER NOT NULL,
  decimal_odds   DOUBLE PRECISION,
  fetched_at     TIMESTAMPTZ NOT NULL,
  is_delayed     BOOLEAN NOT NULL DEFAULT false,
  delay_seconds  INTEGER,
  UNIQUE (provider_id, game_id, subject_id, market_key, line, side, bookmaker)
);

CREATE INDEX IF NOT EXISTS idx_prop_odds_game ON prop_odds (game_id);
CREATE INDEX IF NOT EXISTS idx_prop_odds_subject ON prop_odds (game_id, subject_id, market_key);
CREATE INDEX IF NOT EXISTS idx_prop_odds_provider_game ON prop_odds (provider_id, game_id);

-- Append-only price-change archive for prop_odds.
CREATE TABLE IF NOT EXISTS prop_odds_history (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id    TEXT NOT NULL,
  game_id        TEXT NOT NULL,
  subject_id     TEXT NOT NULL,
  market_key     TEXT NOT NULL,
  line           DOUBLE PRECISION,
  side           TEXT NOT NULL,
  bookmaker      TEXT NOT NULL,
  american_odds  INTEGER NOT NULL,
  decimal_odds   DOUBLE PRECISION,
  observed_at    TIMESTAMPTZ NOT NULL,
  is_delayed     BOOLEAN NOT NULL DEFAULT false,
  delay_seconds  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_prop_odds_history_lookup
  ON prop_odds_history (game_id, subject_id, market_key, line, side, bookmaker, observed_at);

-- Append-only, log-on-change archive for game-level moneyline/total prices.
CREATE TABLE IF NOT EXISTS game_odds_history (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id      TEXT NOT NULL,
  market        TEXT NOT NULL, -- 'moneyline' | 'total'
  side          TEXT NOT NULL, -- 'home' | 'away' for moneyline, 'over' | 'under' for total
  bookmaker     TEXT NOT NULL,
  american_odds INTEGER NOT NULL,
  point         DOUBLE PRECISION, -- total line; null for moneyline
  observed_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_odds_history_lookup
  ON game_odds_history (event_id, market, side, bookmaker, observed_at);

-- Per-provider request/object counters, one row per billing period.
CREATE TABLE IF NOT EXISTS provider_usage (
  provider_id    TEXT NOT NULL,
  period_kind    TEXT NOT NULL, -- 'daily' | 'monthly'
  period_key     TEXT NOT NULL, -- '2026-08-11' or '2026-08'
  request_count  INTEGER NOT NULL DEFAULT 0,
  object_count   INTEGER NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (provider_id, period_kind, period_key)
);

-- Diagnostics: players/markets/books a recent fetch couldn't resolve.
CREATE TABLE IF NOT EXISTS odds_unresolved (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id TEXT NOT NULL,
  kind        TEXT NOT NULL, -- 'player' | 'market' | 'bookmaker'
  raw_value   TEXT NOT NULL,
  context     TEXT,
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_odds_unresolved_provider ON odds_unresolved (provider_id);

-- ---------------------------------------------------------------------------
-- Linesmith Pick lock system
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_picks (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport                   TEXT NOT NULL,
  game_id                 TEXT NOT NULL,
  home_team_id            INTEGER,
  away_team_id            INTEGER,
  home_team_name          TEXT,
  away_team_name          TEXT,
  matchup                 TEXT,
  commence_time           TIMESTAMPTZ,

  ml_initial_side          TEXT, -- 'home' | 'away'
  ml_initial_prob          DOUBLE PRECISION,
  ml_initial_captured_at   TIMESTAMPTZ,
  ml_initial_late          BOOLEAN NOT NULL DEFAULT false,
  ml_initial_price         INTEGER,
  ml_initial_prob_lower    DOUBLE PRECISION,
  ml_initial_prob_upper    DOUBLE PRECISION,
  ml_final_side            TEXT,
  ml_final_prob            DOUBLE PRECISION,
  ml_final_captured_at     TIMESTAMPTZ,
  ml_final_late            BOOLEAN NOT NULL DEFAULT false,
  ml_final_price           INTEGER,
  ml_final_prob_lower      DOUBLE PRECISION,
  ml_final_prob_upper      DOUBLE PRECISION,

  total_initial_side        TEXT, -- 'over' | 'under'
  total_initial_prob         DOUBLE PRECISION,
  total_initial_line         DOUBLE PRECISION,
  total_initial_captured_at  TIMESTAMPTZ,
  total_initial_late         BOOLEAN NOT NULL DEFAULT false,
  total_initial_price        INTEGER,
  total_initial_prob_lower   DOUBLE PRECISION,
  total_initial_prob_upper   DOUBLE PRECISION,

  total_final_side           TEXT,
  total_final_prob           DOUBLE PRECISION,
  total_final_line           DOUBLE PRECISION,
  total_final_captured_at    TIMESTAMPTZ,
  total_final_late           BOOLEAN NOT NULL DEFAULT false,
  total_final_price          INTEGER,
  total_final_prob_lower     DOUBLE PRECISION,
  total_final_prob_upper     DOUBLE PRECISION,

  final_home_score        INTEGER,
  final_away_score        INTEGER,
  ml_outcome               TEXT, -- 'win' | 'loss'
  total_outcome             TEXT, -- 'win' | 'loss'
  graded_at                 TIMESTAMPTZ,

  initial_ml_features_json    TEXT,
  final_ml_features_json      TEXT,
  initial_total_features_json TEXT,
  final_total_features_json   TEXT,

  UNIQUE (sport, game_id)
);

CREATE INDEX IF NOT EXISTS idx_game_picks_sport ON game_picks (sport, commence_time);
CREATE INDEX IF NOT EXISTS idx_game_picks_ungraded ON game_picks (sport) WHERE graded_at IS NULL;

-- Park run-environment factors, one row per (venue, season).
CREATE TABLE IF NOT EXISTS park_factors (
  venue_id    INTEGER NOT NULL,
  season      INTEGER NOT NULL,
  venue_name  TEXT NOT NULL,
  factor      DOUBLE PRECISION NOT NULL,
  games       INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (venue_id, season)
);

-- Home Run model's live pitcher-matchup lookup, one row per (team, season).
CREATE TABLE IF NOT EXISTS team_hr_rate_allowed (
  team_id               INTEGER NOT NULL,
  season                INTEGER NOT NULL,
  games_faced           INTEGER NOT NULL,
  games_with_hr_allowed INTEGER NOT NULL,
  league_hr_rate        DOUBLE PRECISION NOT NULL,
  computed_at           TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (team_id, season)
);

-- Sim engine live-wiring cache, one row per pre-game matchup.
CREATE TABLE IF NOT EXISTS game_sim_cache (
  sport          TEXT NOT NULL,
  game_id        TEXT NOT NULL,
  home_win_prob  DOUBLE PRECISION NOT NULL,
  expected_total DOUBLE PRECISION NOT NULL,
  n              INTEGER NOT NULL,
  lineup_source  TEXT NOT NULL, -- 'posted' | 'projected'
  computed_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (sport, game_id)
);

-- Elo rating trajectory, append-only, one row per team per completed game.
CREATE TABLE IF NOT EXISTS team_elo_history (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id          INTEGER NOT NULL,
  season           INTEGER NOT NULL,
  game_pk          INTEGER NOT NULL,
  game_date        DATE NOT NULL,
  elo              DOUBLE PRECISION NOT NULL,
  games_played     INTEGER NOT NULL,
  opponent_team_id INTEGER,
  was_home         BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (team_id, season, game_pk)
);

CREATE INDEX IF NOT EXISTS idx_team_elo_lookup ON team_elo_history (team_id, season, game_date);

-- Starting-pitcher Game Score trend, one row per start.
CREATE TABLE IF NOT EXISTS pitcher_game_score_history (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pitcher_id INTEGER NOT NULL,
  team_id    INTEGER NOT NULL,
  season     INTEGER NOT NULL,
  game_pk    INTEGER NOT NULL,
  game_date  DATE NOT NULL,
  game_score DOUBLE PRECISION NOT NULL,
  UNIQUE (pitcher_id, game_pk)
);

CREATE INDEX IF NOT EXISTS idx_pitcher_game_score_lookup ON pitcher_game_score_history (pitcher_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pitcher_game_score_team ON pitcher_game_score_history (team_id, season, game_date);

-- Fitted model weights, versioned and never overwritten.
CREATE TABLE IF NOT EXISTS model_weights (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport                  TEXT NOT NULL,
  market                 TEXT NOT NULL, -- 'moneyline' | 'total'
  version                INTEGER NOT NULL,
  feature_names          TEXT NOT NULL, -- JSON array, same order as weights_json
  weights_json           TEXT NOT NULL, -- JSON array of coefficients
  intercept              DOUBLE PRECISION NOT NULL,
  train_games            INTEGER NOT NULL,
  train_brier            DOUBLE PRECISION NOT NULL,
  holdout_games          INTEGER NOT NULL,
  holdout_brier          DOUBLE PRECISION NOT NULL,
  baseline_holdout_brier DOUBLE PRECISION,
  active                 BOOLEAN NOT NULL DEFAULT false,
  fitted_at              TIMESTAMPTZ NOT NULL,
  covariance_json        TEXT,
  train_seasons_json     TEXT,
  holdout_seasons_json   TEXT,
  UNIQUE (sport, market, version)
);

CREATE INDEX IF NOT EXISTS idx_model_weights_lookup ON model_weights (sport, market, active);

-- Historical odds, ingested from user-supplied files.
CREATE TABLE IF NOT EXISTS historical_odds (
  id                         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season                     INTEGER NOT NULL,
  game_date                  DATE NOT NULL,
  home_team_id               INTEGER NOT NULL,
  away_team_id               INTEGER NOT NULL,
  home_score                 INTEGER,
  away_score                 INTEGER,
  ml_home_consensus_prob     DOUBLE PRECISION,
  ml_away_consensus_prob     DOUBLE PRECISION,
  total_line                 DOUBLE PRECISION,
  total_over_consensus_prob  DOUBLE PRECISION,
  total_under_consensus_prob DOUBLE PRECISION,
  ml_home_open_prob          DOUBLE PRECISION,
  ml_away_open_prob          DOUBLE PRECISION,
  total_open_line            DOUBLE PRECISION,
  total_open_over_prob       DOUBLE PRECISION,
  total_open_under_prob      DOUBLE PRECISION,
  source                     TEXT NOT NULL, -- 'sbr-xlsx' | 'long-csv'
  book_count                 INTEGER NOT NULL,
  UNIQUE (season, game_date, home_team_id, away_team_id)
);

CREATE INDEX IF NOT EXISTS idx_historical_odds_lookup ON historical_odds (season, game_date, home_team_id, away_team_id);

-- Lightweight persisted error log.
CREATE TABLE IF NOT EXISTS system_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  level       TEXT NOT NULL, -- 'error' | 'warning'
  source      TEXT NOT NULL, -- e.g. 'api/odds/lines', 'api/props/fit-total-weights'
  message     TEXT NOT NULL,
  detail      TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_events_recent ON system_events (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Golf prediction-model data layer
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS golf_tournaments (
  event_id    TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  course_name TEXT,
  season      INTEGER NOT NULL,
  start_date  DATE,
  holes_json  TEXT,
  field_size  INTEGER,
  updated_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS golf_hole_scores (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        TEXT NOT NULL,
  espn_id         TEXT NOT NULL,
  round           INTEGER NOT NULL,
  hole            INTEGER NOT NULL,
  par             INTEGER,
  strokes         INTEGER,
  relative_to_par DOUBLE PRECISION NOT NULL,
  category        TEXT NOT NULL, -- 'birdie' | 'par' | 'bogey'
  ingested_at     TIMESTAMPTZ NOT NULL,
  UNIQUE (event_id, espn_id, round, hole)
);

CREATE INDEX IF NOT EXISTS idx_golf_hole_scores_lookup ON golf_hole_scores (espn_id, hole, event_id);
CREATE INDEX IF NOT EXISTS idx_golf_hole_scores_event ON golf_hole_scores (event_id, round, hole);

CREATE TABLE IF NOT EXISTS golf_round_scores (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        TEXT NOT NULL,
  espn_id         TEXT NOT NULL,
  round           INTEGER NOT NULL,
  total_strokes   INTEGER,
  relative_to_par DOUBLE PRECISION NOT NULL,
  tee_wave        TEXT, -- 'AM' | 'PM' | null when unknown
  wind_mph        DOUBLE PRECISION,
  temp_f          DOUBLE PRECISION,
  precip_prob     DOUBLE PRECISION,
  ingested_at     TIMESTAMPTZ NOT NULL,
  UNIQUE (event_id, espn_id, round)
);

CREATE INDEX IF NOT EXISTS idx_golf_round_scores_lookup ON golf_round_scores (espn_id, event_id);

CREATE TABLE IF NOT EXISTS golf_tournament_results (
  event_id    TEXT NOT NULL,
  espn_id     TEXT NOT NULL,
  position    TEXT, -- e.g. '1', 'T12', 'CUT', 'WD'
  made_cut    BOOLEAN NOT NULL DEFAULT false,
  total_score INTEGER,
  finished_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (event_id, espn_id)
);

CREATE TABLE IF NOT EXISTS golf_model_predictions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        TEXT NOT NULL,
  espn_id         TEXT NOT NULL,
  dimension       TEXT NOT NULL, -- 'hole-7' | 'round-score'
  round           INTEGER NOT NULL,
  category        TEXT NOT NULL, -- 'birdie' | 'par' | 'bogey'
  predicted_prob  DOUBLE PRECISION NOT NULL,
  league_rate     DOUBLE PRECISION,
  predicted_at    TIMESTAMPTZ NOT NULL,
  graded_at       TIMESTAMPTZ,
  actual_category TEXT,
  hit             BOOLEAN, -- true if actual_category = category, set only once graded
  brier_component DOUBLE PRECISION,
  UNIQUE (event_id, espn_id, dimension, round)
);

CREATE INDEX IF NOT EXISTS idx_golf_model_predictions_ungraded ON golf_model_predictions (event_id) WHERE graded_at IS NULL;

CREATE TABLE IF NOT EXISTS golf_tournament_predictions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        TEXT NOT NULL,
  espn_id         TEXT NOT NULL,
  prob_win        DOUBLE PRECISION NOT NULL,
  prob_top5       DOUBLE PRECISION NOT NULL,
  prob_top10      DOUBLE PRECISION NOT NULL,
  prob_made_cut   DOUBLE PRECISION NOT NULL,
  predicted_at    TIMESTAMPTZ NOT NULL,
  graded_at       TIMESTAMPTZ,
  actual_won      BOOLEAN,
  actual_top5     BOOLEAN,
  actual_top10    BOOLEAN,
  actual_made_cut BOOLEAN,
  brier_win       DOUBLE PRECISION,
  brier_top5      DOUBLE PRECISION,
  brier_top10     DOUBLE PRECISION,
  brier_made_cut  DOUBLE PRECISION,
  UNIQUE (event_id, espn_id)
);
