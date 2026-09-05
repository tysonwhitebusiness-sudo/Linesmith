-- Phase 4.9 — the projection pipe needs the PROJECTION itself, which the table
-- did not carry.
--
-- `prop_model_cache` was built for the edge pipe, where `model_prob` (the
-- probability of clearing a specific line) is the number that matters and the
-- expected value behind it is an intermediate. The stats board inverts that:
-- the ranked quantity IS the expected value ("we project 2.7 shots"), and the
-- probability is the optional extra that only two NHL markets earned the right
-- to display (4.8/4.9).
--
-- `model_prob` staying NULL is therefore meaningful, not missing: it is how a
-- rankable-but-not-calibrated market (shots-on-goal, goals) is represented. No
-- separate flag column — a null probability already says "do not show one".
--
-- Existing MLB rows get NULL projection and are unaffected; MLB's adapter reads
-- model_prob (adapter.ts:2323) and never this column.
ALTER TABLE prop_model_cache
  ADD COLUMN IF NOT EXISTS projection double precision,
  ADD COLUMN IF NOT EXISTS projected_toi double precision;

COMMENT ON COLUMN prop_model_cache.projection IS
  'Expected count for the dimension (e.g. 2.7 shots on goal). The quantity the '
  'stats board ranks on. NULL for edge-pipe rows that only ever carried model_prob.';
COMMENT ON COLUMN prop_model_cache.projected_toi IS
  'Projected minutes of ice time behind the projection. Shown as the evidence '
  'for a volume-driven number; NULL where the sport has no minutes concept.';
