-- Task 2.7a of docs/audit-remediation-plan.md, standing decision Q13:
-- "Python computes every model number in the app; TypeScript renders."
--
-- lib/sports/mlb/adapter.ts computes prop model probabilities live, on the
-- 4-minute snapshot timer — compute_model_probability's TypeScript twin,
-- plus the fitted home-run model and its lineup-confidence discount. Python
-- computes the identical numbers every 5 minutes in
-- predict/prop_candidates.py. Two implementations of one model, which is
-- finding P3 §4 exactly.
--
-- WHY A NEW TABLE, AND NOT pick_history.
-- Python already writes its prop results to pick_history via log_surfaced.
-- That is a LOG: `ON CONFLICT DO NOTHING`, first-surfaced-wins, deliberately
-- so, because a prediction's whole value is that it was recorded before the
-- outcome and never revised. A page needs the opposite — the number as of
-- now, revised as lineups firm up and the fitted model changes. Serving a
-- page from pick_history would pin every candidate to whatever the first
-- tick of the day computed, and "the model said X this morning" is not what
-- a live page is claiming when it shows X.
--
-- So: pick_history stays the immutable record, this is the mutable current
-- state, and both are written by the same Python job from the same
-- CandidateResult in the same pass. They cannot disagree about what the
-- model computed; they differ only in which moment they preserve.
--
-- This deliberately mirrors mlb_game_model_cache, which already does exactly
-- this for the game model and which adapter.ts already reads cache-first
-- (adapter.ts:2323) with a TS fallback when the row is missing or stale.
-- 2.7a is that proven pattern extended to the prop side, not a new one.
--
-- The key is the candidate's real identity. `category` is part of it: the
-- same subject and dimension can surface as 'over' or 'under' (or
-- 'hit'/'no-hit'), and model_prob is stored side-correct — the P3 C3 bug was
-- exactly a side mismatch, so the side belongs in the key rather than being
-- reconstructed by a reader.
CREATE TABLE IF NOT EXISTS mlb_prop_model_cache (
  sport             TEXT        NOT NULL,
  game_id           TEXT        NOT NULL,
  subject_id        TEXT        NOT NULL,
  dimension         TEXT        NOT NULL,
  category          TEXT        NOT NULL,
  line              DOUBLE PRECISION,
  model_prob        DOUBLE PRECISION,
  model_std_dev     DOUBLE PRECISION,
  model_sample_size INTEGER,
  league_rate       DOUBLE PRECISION,
  matchup_favorable BOOLEAN,
  model_version     INTEGER,
  -- Staleness is the reader's safety valve: adapter.ts falls back to
  -- computing in TypeScript when this is missing or older than its max age,
  -- so a stopped worker degrades the page to today's behaviour instead of
  -- serving a frozen number or an empty section.
  computed_at       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (sport, game_id, subject_id, dimension, category)
);

-- The read pattern is "every candidate for this slate", one query per
-- snapshot rebuild rather than one per candidate — a per-candidate lookup
-- would be thousands of round-trips through the pooler on a full slate,
-- which is the same mistake task 2.3 had to undo in write_game_odds_history.
CREATE INDEX IF NOT EXISTS mlb_prop_model_cache_sport_game_idx
  ON mlb_prop_model_cache (sport, game_id);

COMMENT ON TABLE mlb_prop_model_cache IS
  'Current MLB prop model output, written by computeMlbPropPredictionsJob, read cache-first by lib/sports/mlb/adapter.ts. Mutable current state; pick_history is the immutable record of the same numbers.';
