-- Task 4.9 (P3 H8) — two incompatible quantities stop sharing one column.
--
-- `pick_history.edge` holds two different things depending on which writer
-- produced the row, and one threshold (GOOD_BET_MIN_EDGE = 0.03) is applied to
-- whichever one arrives. Located precisely, in the code as it stands today:
--
--   db.write_pick_history_grades  (a port of TS writeGrades, runs at GRADING
--     time)  ->  model_prob - devig(one book's two-sided price)
--     "how much our model disagrees with a book"
--
--   predict/live_edge.resolve_candidate_edge  (runs at SURFACE time)
--     ->  sharp_devigged(side) - raw_implied(bettable book)
--     "how much better a sharp book's fair price is than what you'd pay"
--
-- The second is expected value in probability units; the first is a
-- disagreement measure. 0.03 means something quite different in each, and the
-- Good Bets bar cannot mean one thing while fed both.
--
-- MEASURED TODAY, and P3 H8 still reproduces exactly:
--     pick_history rows        368,657
--     edge populated             3,852
--     edge_source populated          0   <- the whole redesign, unrecorded
--     price populated                2
-- Every populated `edge` came from the grading-time join, which sets
-- market_prob/edge/price_source/bookmaker and never edge_source. So the column
-- is not merely ambiguous in principle — in practice it currently holds ONLY
-- the older definition, while the newer one is invisible.
--
-- `edge` itself is KEPT and still written. It has readers (lib/odds/goodBets.ts
-- and the diagnostics surface), and silently repointing it at one of the two
-- definitions would change what those readers mean without them knowing. It
-- becomes the legacy/ambiguous column; the two new columns are the ones a new
-- reader should use, chosen via edge_source.

BEGIN;

ALTER TABLE pick_history
  ADD COLUMN IF NOT EXISTS edge_model_vs_market double precision,
  ADD COLUMN IF NOT EXISTS edge_sharp_vs_soft   double precision;

COMMENT ON COLUMN pick_history.edge_model_vs_market IS
  'Task 4.9: model_prob - devig(one book two-sided price). "How far our model '
  'is from a book." Written at grading time by write_pick_history_grades.';

COMMENT ON COLUMN pick_history.edge_sharp_vs_soft IS
  'Task 4.9: sharp_devigged(side) - raw_implied(bettable book). Expected value '
  'in probability units. Written at surface time by resolve_candidate_edge.';

COMMENT ON COLUMN pick_history.edge IS
  'LEGACY/AMBIGUOUS (task 4.9, P3 H8): held either definition depending on the '
  'writer. Retained because it has live readers; new readers should use '
  'edge_model_vs_market or edge_sharp_vs_soft and branch on edge_source.';

-- edge_source now has a defined vocabulary. NULL stays legal for the 368k
-- historical rows that predate it and can no longer be attributed.
ALTER TABLE pick_history
  ADD CONSTRAINT pick_history_edge_source_valid
    CHECK (edge_source IS NULL OR edge_source IN ('model_vs_market', 'sharp_vs_soft', 'pinnacle', 'circa', 'novig', 'kalshi', 'consensus'));

-- Backfill what CAN be attributed. Every existing populated `edge` came from
-- the grading-time join — established above by edge_source being 0 everywhere,
-- since that is the one writer that never sets it. This is a real inference
-- from a measurement, not an assumption about intent.
UPDATE pick_history
   SET edge_model_vs_market = edge,
       edge_source = 'model_vs_market'
 WHERE edge IS NOT NULL
   AND edge_source IS NULL;

COMMIT;
