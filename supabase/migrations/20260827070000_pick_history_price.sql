-- Phase 7 of docs/daily-picks-full-model-build-2026-08-27.md — the
-- simulated $10 bankroll needs a real bettable price to compute
-- profit/loss from, and pick_history never persisted one (market_prob/
-- edge are derived, devigged values, not a raw american-odds price the
-- way game_picks.ml_initial_price etc already are). live_edge.py's
-- CandidateEdgeInfo has always computed a real `price` at candidate-
-- generation time; this column is where it's now kept, first-surfaced-
-- wins same as every other pick_history column (ON CONFLICT DO NOTHING).
ALTER TABLE pick_history ADD COLUMN IF NOT EXISTS price INTEGER;
