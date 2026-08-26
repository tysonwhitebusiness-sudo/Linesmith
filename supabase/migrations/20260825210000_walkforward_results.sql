-- Cross-sport prediction framework, Phase 2 (predict/model_benchmark.py):
-- per-fold + final-test scoring history for every candidate model a
-- run_benchmark() call evaluates. Distinct from model_weights'/
-- model_calibration's single-active-row shape on purpose — this is a
-- benchmarking log kept for later inspection/dashboards (which candidate
-- won, by how much, was it close), not a "current state" table.
CREATE TABLE IF NOT EXISTS walkforward_results (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport              TEXT NOT NULL,
  market             TEXT NOT NULL,
  model_name         TEXT NOT NULL,
  fold_index         INTEGER,        -- NULL for the final held-out test row
  is_final_test      BOOLEAN NOT NULL DEFAULT false,
  train_seasons_json TEXT NOT NULL,
  val_seasons_json   TEXT NOT NULL,  -- single-element array for a CV fold; full test_seasons array for the final-test row
  train_games        INTEGER NOT NULL,
  val_games          INTEGER NOT NULL,
  log_loss           DOUBLE PRECISION NOT NULL,
  brier_score        DOUBLE PRECISION NOT NULL,
  fitted_at          TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_walkforward_results_lookup ON walkforward_results (sport, market, model_name, fitted_at);
