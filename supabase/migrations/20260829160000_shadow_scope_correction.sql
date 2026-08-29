-- Phase 4 gate (2026-08-29) — correct what `model_weights.shadow` actually does.
--
-- Migration 20260829130000 added the column with this comment:
--   'true = compute, log and grade this model but never render its output.'
--
-- G7 (adversarial read-back: "does the repository now describe what actually
-- runs?") found that claim is true of exactly one model, not three.
--
-- WHAT IS ACTUALLY GATED. `getRenderableModelWeights` (lib/db/client.ts) is the
-- single enforcement point, and it works: it returns null for a shadowed row.
-- But a render path is only protected if it reads `model_weights` through that
-- function, and one caller does — the MLB home-run model in
-- lib/sports/mlb/adapter.ts.
--
-- WHAT IS NOT. The MLB game model (moneyline and total) reaches the UI from
-- `mlb_game_model_cache`, written by Python's computeMlbGameModelJob and read
-- by adapter.ts's readGameModelCache. Nothing on that path consults `shadow`,
-- and the Python worker never branches on the column at all (it is read into
-- ModelWeightsRow and otherwise unused). So all three MLB models are flagged
-- shadow=true today while moneyline and total are on screen.
--
-- OPERATOR DECISION, 2026-08-29: correct the claim, leave rendering alone.
-- Honouring the flag on the game model would remove MLB moneyline and total
-- from the UI until a model is deliberately graduated. That is a product
-- decision, not a correction a gate should make on its own. No row changes
-- here and nothing a user sees changes -- this migration rewrites a comment
-- that was describing an intention as though it were a mechanism.

BEGIN;

COMMENT ON COLUMN model_weights.shadow IS
  'Task 4.4 / Q6, scope corrected by the Phase 4 gate 2026-08-29: true = do not '
  'render this model''s output. ENFORCED ONLY where a render path reads '
  'model_weights via getRenderableModelWeights() -- today that is the MLB '
  'home-run model alone. The MLB game model (moneyline, total) renders from '
  'mlb_game_model_cache and is NOT gated by this column; the Python worker does '
  'not branch on it either. Defaults true (Q33). Independent of `active`.';

COMMIT;
