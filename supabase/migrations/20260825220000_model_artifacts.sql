-- Cross-sport prediction framework, Phase 2 (predict/model_benchmark.py):
-- for candidate models whose fitted state does NOT fit model_weights'
-- linear (feature_names, weights, intercept) shape — Bradley-Terry fits
-- per-team ratings, not a fixed feature vector; the tree ensembles and MLP
-- are opaque fitted objects; the stacking meta-model bundles several of
-- the above. Versioned per (sport, market, model_name) rather than just
-- (sport, market) so multiple candidate architectures can each keep their
-- own active row simultaneously — model_weights only ever needs one
-- active row per (sport, market) because 'formula' is the only candidate
-- that writes there; every OTHER candidate architecture writes here
-- instead, and run_benchmark's own reporting needs to compare all of them
-- side by side, not just whichever one happened to write last.
CREATE TABLE IF NOT EXISTS model_artifacts (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport            TEXT NOT NULL,
  market           TEXT NOT NULL,
  model_name       TEXT NOT NULL,     -- 'bradley_terry' | 'catboost' | 'xgboost' | 'lightgbm' | 'mlp' | 'stacking' | ...
  version          INTEGER NOT NULL,
  artifact_json    TEXT,              -- JSON-serializable params (Bradley-Terry: {team_ratings, home_advantage})
  artifact_blob    BYTEA,             -- opaque binary artifact (pickle bytes, base64-free — stored raw); NULL when artifact_json is used instead
  train_games      INTEGER NOT NULL,
  train_log_loss   DOUBLE PRECISION NOT NULL,
  train_brier      DOUBLE PRECISION NOT NULL,
  holdout_games    INTEGER NOT NULL,
  holdout_log_loss DOUBLE PRECISION NOT NULL,
  holdout_brier    DOUBLE PRECISION NOT NULL,
  active           BOOLEAN NOT NULL DEFAULT false,
  fitted_at        TIMESTAMPTZ NOT NULL,
  UNIQUE (sport, market, model_name, version)
);

CREATE INDEX IF NOT EXISTS idx_model_artifacts_lookup ON model_artifacts (sport, market, model_name, active);
