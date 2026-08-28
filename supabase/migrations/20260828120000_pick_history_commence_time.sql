-- Task 2.2 of docs/audit-remediation-plan.md, finding P3 H4
-- (docs/audit-phase-3.md:1183) — data leakage in the generic-sports prop
-- production job.
--
-- The leak: predictions were built from an ESPN season gamelog with no
-- check that the game being predicted had already started. Once a game is
-- final its own outcome is in that gamelog, so an hourly tick landing
-- after the final whistle produced a "prediction" whose history contained
-- the answer — and log_surfaced's ON CONFLICT DO NOTHING made whichever
-- tick landed first permanent.
--
-- The start-time filter in generic_prop_production.run_sport is the fix.
-- This column is what makes the fix *auditable*, which is the part that
-- cannot be added retroactively: pick_history has never recorded when the
-- predicted game actually started, so no row — past or future — could be
-- checked for leakage at all. P3 H4's own fix list calls this out
-- ("without this you cannot tell how much of your generic-sport history
-- is contaminated"), and task 2.2's VERIFY is unrunnable without it.
--
-- Nullable on purpose, and it stays nullable:
--   * every pre-existing row genuinely has no value here, and inventing
--     one by joining against a schedule after the fact would manufacture
--     exactly the false certainty this column exists to prevent;
--   * the TypeScript writer (lib/odds/props/pickHistoryLog.ts logSurfaced)
--     does not populate it. That is deliberate rather than an oversight —
--     task 2.7 moves those writes to Python, and adding a second TS write
--     path here would be work with a scheduled deletion date.
--
-- So: NULL means "not auditable for leakage", NOT "predicted before
-- start". Any query treating NULL as safe is wrong. See the audit query
-- in §11 of the remediation plan for the shape that reads this correctly.
ALTER TABLE pick_history ADD COLUMN IF NOT EXISTS commence_time TIMESTAMPTZ;

-- Supports the leakage audit query (WHERE surfaced_at >= commence_time)
-- and the per-sport contamination counts it produces. Partial, because
-- rows with no commence_time can never satisfy that predicate and there
-- are 362k+ of them.
CREATE INDEX IF NOT EXISTS pick_history_commence_time_idx
  ON pick_history (commence_time)
  WHERE commence_time IS NOT NULL;
