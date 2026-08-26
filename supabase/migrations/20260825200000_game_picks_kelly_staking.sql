-- Cross-sport prediction framework, Phase 1 (predict/staking.py): a
-- Kelly-suggested stake fraction + significance flag alongside each
-- already-captured pick. Kelly needs decimal odds, which aren't known at
-- capture time (capture only knows prob/side) — a real price attaches
-- later, separately, via attach_moneyline_price/attach_total_price
-- (Track A3). These new columns get filled at that same later point, by
-- the new attach_moneyline_kelly_stake/attach_total_kelly_stake (same
-- idempotent "only fill once" shape as the existing price-attach
-- functions), not at capture time.
ALTER TABLE game_picks
  ADD COLUMN IF NOT EXISTS ml_initial_kelly_stake_fraction    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS ml_initial_edge_significant        BOOLEAN,
  ADD COLUMN IF NOT EXISTS ml_final_kelly_stake_fraction      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS ml_final_edge_significant          BOOLEAN,
  ADD COLUMN IF NOT EXISTS total_initial_kelly_stake_fraction DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS total_initial_edge_significant     BOOLEAN,
  ADD COLUMN IF NOT EXISTS total_final_kelly_stake_fraction   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS total_final_edge_significant       BOOLEAN;
