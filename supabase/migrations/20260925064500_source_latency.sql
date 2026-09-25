-- P7 (odds build, T0): how late each odds source is, measured on the scraper's
-- own history by python-odds-service/scraper_timing.py (laptop, daily). Read by
-- P8's latency badges and P11's sharp-reference gate. Additive. Python writes;
-- RLS on, one read policy (the pattern of 20260925041339).
CREATE TABLE IF NOT EXISTS source_latency (
  sport         text NOT NULL,
  measure       text NOT NULL CHECK (measure IN ('relay_delay','follow_lag','sharp_consistency')),
  source        text NOT NULL,                 -- the scraper source measured (a relay, or the book's best-timed source)
  book          text NOT NULL,                 -- canonical bookmaker
  market_group  text NOT NULL DEFAULT 'all',   -- game_lines | props | all
  n             integer NOT NULL,
  hit_rate      double precision,              -- relay_delay: share repeated within 60 min; follow_lag: share of Pinnacle moves followed
  median_s      double precision,
  p25_s         double precision,
  p75_s         double precision,
  p90_s         double precision,
  proven_fast   boolean NOT NULL DEFAULT false, -- may serve as the sharp reference (T0.3)
  window_start  timestamptz NOT NULL,
  window_end    timestamptz NOT NULL,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sport, measure, source, book, market_group)
);
ALTER TABLE public.source_latency ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS source_latency_read ON public.source_latency;
CREATE POLICY source_latency_read ON public.source_latency FOR SELECT USING (true);
COMMENT ON TABLE source_latency IS 'P7 (T0): measured relay delay, follow lag and sharp self-consistency per source and book; Python (scraper_timing.py) writes.';
