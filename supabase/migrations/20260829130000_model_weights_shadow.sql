-- Task 4.4 (Q6, Q33) — shadow mode as a property of the MODEL, not an edit.
--
-- 4.4's point: "Phase 1.3 hid things by editing components; this makes it a
-- property of the model so a future model graduates by flipping one column."
-- Today a model's visibility is a fact about React files, which means the only
-- way to answer "is this model's output being shown?" is to read the renderer.
--
-- The plan assumed this column already existed ("`model_weights.shadow = true`
-- means compute, log, grade, never render"). It did not — `model_weights` has
-- id/sport/market/version/feature_names/weights_json/intercept/train_*/
-- holdout_*/baseline_holdout_brier/active/fitted_at/covariance_json/
-- train_seasons_json/holdout_seasons_json and nothing else. So 4.4 is a
-- migration, not a flag flip.
--
-- DEFAULT TRUE — operator decision Q33, and the safe direction. Every existing
-- row is stamped shadow=true, so this migration makes NOTHING newly visible:
-- it encodes the state Phase 1.3 already put the UI in, rather than changing
-- what a user sees. Graduating a model is then a deliberate, separate,
-- one-column act — which is exactly what 4.4 is asking for.
--
-- NOT NULL, because "unknown visibility" is not a state this should be able to
-- represent. A model is either rendered or it is not.
--
-- `active` and `shadow` are independent and both are needed:
--   active=true,  shadow=true   compute, log, grade — never render  (today)
--   active=true,  shadow=false  the graduated model, rendered
--   active=false, shadow=*      not the current model at all
-- Q24's "a model that loses to the market is deactivated" acts on `active`;
-- Q6's "predictions hidden until they beat the market" acts on `shadow`.

BEGIN;

ALTER TABLE model_weights
  ADD COLUMN IF NOT EXISTS shadow boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN model_weights.shadow IS
  'Task 4.4 / Q6: true = compute, log and grade this model but never render its '
  'output. Defaults true (Q33) so adding the column made nothing newly visible. '
  'Independent of `active`, which is about which version is current.';

COMMIT;
