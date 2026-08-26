-- Cross-sport prediction framework, Phase 1 (predict/calibration.py): a
-- sibling table to model_weights, not a column bolted onto it. Calibration
-- (Platt scaling / isotonic regression, applied to a fitted model's raw
-- output probability) needs its own independent refit/activation cadence —
-- refitting a model's weights shouldn't force a calibration refit and vice
-- versa. Platt's params ({a, b}, 2 scalars) and isotonic's ({x[], y[]}, a
-- variable-length step function) are structurally different shapes that
-- don't belong in one ambiguous JSON column on model_weights either way.
-- Same versioned/active/deactivate-prior-on-activate discipline as
-- model_weights (see write_model_weights in db.py) — copied deliberately,
-- not reinvented.
CREATE TABLE IF NOT EXISTS model_calibration (
  id                         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport                      TEXT NOT NULL,
  market                     TEXT NOT NULL,
  version                    INTEGER NOT NULL,
  method                     TEXT NOT NULL, -- 'platt' | 'isotonic'
  params_json                TEXT NOT NULL,
  train_games                INTEGER NOT NULL,
  train_log_loss             DOUBLE PRECISION NOT NULL,
  holdout_games              INTEGER NOT NULL,
  holdout_log_loss           DOUBLE PRECISION NOT NULL,
  baseline_holdout_log_loss  DOUBLE PRECISION,
  active                     BOOLEAN NOT NULL DEFAULT false,
  fitted_at                  TIMESTAMPTZ NOT NULL,
  UNIQUE (sport, market, version)
);

CREATE INDEX IF NOT EXISTS idx_model_calibration_lookup ON model_calibration (sport, market, active);
