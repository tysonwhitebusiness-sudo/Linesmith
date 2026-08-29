-- Task 4.8 / Q25 — make the MLB game-model track record honest.
--
-- 4.8 deleted the second MLB game model (`computeMoneylineModel`, the
-- hand-tuned formula in lib/sports/mlb/gameModel.ts). Q25: "re-grade affected
-- history — after snapshotting the pre-regrade rows. Re-grading rewrites the
-- recorded track record, so it stays reversible."
--
-- WHAT "AFFECTED HISTORY" ACTUALLY IS, established from the data rather than
-- assumed. `pick_history` holds 3,614 MLB `moneyline` rows. Python's
-- computeMlbGameModelJob took over writing them at task 2.7b (commit 805c023,
-- 2026-08-28T23:13Z), and its writer sets `commence_time` where the deleted
-- TypeScript one never did. That gives a data-intrinsic boundary — no guessed
-- timestamp needed:
--
--     commence_time IS NULL     3,580 rows, last 2026-08-28 14:53  <- deleted model
--     commence_time IS NOT NULL    34 rows, first 2026-08-29 04:05 <- fitted model
--
-- `total` rows are NOT affected: db.log_game_total_predictions is called from
-- predict/odds_lines_cycle.py:525, so Python's fitted path already wrote them.
-- Checked before writing this, because assuming they were affected would have
-- mislabelled 31,884 rows.
--
-- WHY THIS IS ATTRIBUTION AND NOT A RE-GRADE OF OUTCOMES. A win is a win — the
-- `outcome` column records what the game did, and no model choice changes that.
-- What was wrong is that predictions from two different models sat in one
-- undifferentiated series with `model_version` NULL on every row, so any reader
-- averaging them scores a blend of a model that exists and one that does not.
-- P3 H2 named the reader this breaks: "/diagnostics calibration for
-- dimension='moneyline' is scoring the unfitted formula."
--
-- So the fix is to make the two separable. `model_source` is a new nullable
-- column rather than a reuse of `model_version` (which references
-- model_weights.version and would be type-abuse) or `trust_tier` (which means
-- something else entirely for props).
--
-- REVERSIBLE: every affected row is copied to
-- pick_history_game_model_backup_20260829 before any update, per Q25.

BEGIN;

ALTER TABLE pick_history
  ADD COLUMN IF NOT EXISTS model_source text;

COMMENT ON COLUMN pick_history.model_source IS
  'Task 4.8/Q25: which model produced this row, where more than one ever did. '
  '''ts_unfitted_moneyline'' = the hand-tuned computeMoneylineModel deleted on '
  '2026-08-29. NULL means single-source, no ambiguity to record.';

ALTER TABLE pick_history
  ADD CONSTRAINT pick_history_model_source_valid
    CHECK (model_source IS NULL OR model_source IN ('ts_unfitted_moneyline'));

-- Snapshot first, per Q25.
CREATE TABLE IF NOT EXISTS pick_history_game_model_backup_20260829 AS
  SELECT * FROM pick_history
   WHERE sport = 'mlb' AND dimension = 'moneyline' AND commence_time IS NULL;

UPDATE pick_history
   SET model_source = 'ts_unfitted_moneyline'
 WHERE sport = 'mlb'
   AND dimension = 'moneyline'
   AND commence_time IS NULL
   AND model_source IS NULL;

COMMIT;
