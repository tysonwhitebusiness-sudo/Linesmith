-- P11 follow-up (operator, 2026-09-26): the Edge card is never blank. For every
-- market with a sharp reference, Python publishes its evaluation — the best soft
-- price, its fair price and EV (negative included), and every gate's verdict —
-- so the card can show "NO EDGE" and WHY, the way the approved mockup does,
-- without the page computing anything (O6).
--
-- One row per market line (side A's line: a spread's home point, a total's
-- number; NULL for a moneyline). `best` is the side/book with the highest EV;
-- `reason` is set when no candidate could be priced (no sharp reference).
-- Written by predict/market_edge.py (marketEdgeJob) only when a row's content
-- changes; freshness is the job's own breadcrumb, not a per-row time.
CREATE TABLE IF NOT EXISTS market_edge_candidates (
  kind text NOT NULL CHECK (kind IN ('prop','game')), sport text NOT NULL, game_id text NOT NULL,
  subject_id text NOT NULL DEFAULT '', period text NOT NULL DEFAULT 'fg', market text NOT NULL,
  line double precision,
  best jsonb,
  reason text,
  sharp jsonb,
  updated_at timestamptz NOT NULL,
  CONSTRAINT market_edge_candidates_key UNIQUE NULLS NOT DISTINCT (kind, game_id, subject_id, period, market, line)
);
CREATE INDEX IF NOT EXISTS market_edge_candidates_game ON market_edge_candidates (game_id, subject_id);
ALTER TABLE public.market_edge_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS market_edge_candidates_read ON public.market_edge_candidates;
CREATE POLICY market_edge_candidates_read ON public.market_edge_candidates FOR SELECT USING (true);
COMMENT ON TABLE market_edge_candidates IS 'P11: every evaluated market line''s best soft price vs the sharp fair price, with each gate''s verdict; Python (marketEdgeJob) writes, the Edge card reads.';
