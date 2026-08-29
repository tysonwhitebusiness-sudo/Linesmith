-- Q28 / task 4.2 — a market reference for the GAME model.
--
-- THE BLOCKER THIS EXISTS TO REMOVE. Task 4.2 says "activate only if Brier
-- beats market_prob's Brier on held-out live rows", and Q24 says a model that
-- loses to the market is deactivated. Measured 2026-08-29, neither is
-- computable for the two live game models:
--
--   pick_history.market_prob is non-null on ZERO 'moneyline' rows and ZERO
--   'total' rows, and `game_picks` — where the game model's own predictions
--   actually live — has no market-probability column at all.
--
-- So 4.2's gate was not merely failing for mlb/moneyline v8 and mlb/total v8;
-- it was UNCOMPUTABLE. Three of the phase's tasks (4.2's gate, 4.3's Platt
-- fit, 4.5's CLV) are downstream of this one column existing.
--
-- WHAT GOES IN IT. The de-vigged probability of the side the model picked,
-- taken from ONE bookmaker's two-sided price for that game — never two books
-- mixed, and for totals never two different points, which is exactly the P3 C1
-- defect task 5.5 just fixed on the display side. `*_market_prob_book` records
-- which book supplied it so the number is traceable rather than anonymous, and
-- so a later reader can tell a sharp reference from a soft one.
--
-- Deliberately NULLABLE with no default. A game with only one side priced, or
-- no two-sided quote from any single book, genuinely has no market reference,
-- and NULL is the honest answer — inventing one by mixing books is what P3 C1
-- was about. Coverage is therefore a real measurement, not an assumption, and
-- 4.2 reports it.
--
-- Four columns, not two, because a pick is captured twice: at open
-- (`*_initial_*`) and near close (`*_final_*`). CLV (task 4.5) is precisely
-- the difference between those two references, so both must be stored.

BEGIN;

ALTER TABLE game_picks
  ADD COLUMN IF NOT EXISTS ml_initial_market_prob         double precision,
  ADD COLUMN IF NOT EXISTS ml_initial_market_prob_book    text,
  ADD COLUMN IF NOT EXISTS ml_final_market_prob           double precision,
  ADD COLUMN IF NOT EXISTS ml_final_market_prob_book      text,
  ADD COLUMN IF NOT EXISTS total_initial_market_prob      double precision,
  ADD COLUMN IF NOT EXISTS total_initial_market_prob_book text,
  ADD COLUMN IF NOT EXISTS total_final_market_prob        double precision,
  ADD COLUMN IF NOT EXISTS total_final_market_prob_book   text;

-- Probabilities are probabilities — same discipline task 5.4 applied to
-- pick_history.model_prob / market_prob.
ALTER TABLE game_picks
  ADD CONSTRAINT game_picks_ml_initial_market_prob_range
    CHECK (ml_initial_market_prob IS NULL OR (ml_initial_market_prob >= 0 AND ml_initial_market_prob <= 1)),
  ADD CONSTRAINT game_picks_ml_final_market_prob_range
    CHECK (ml_final_market_prob IS NULL OR (ml_final_market_prob >= 0 AND ml_final_market_prob <= 1)),
  ADD CONSTRAINT game_picks_total_initial_market_prob_range
    CHECK (total_initial_market_prob IS NULL OR (total_initial_market_prob >= 0 AND total_initial_market_prob <= 1)),
  ADD CONSTRAINT game_picks_total_final_market_prob_range
    CHECK (total_final_market_prob IS NULL OR (total_final_market_prob >= 0 AND total_final_market_prob <= 1));

COMMIT;
