-- P6 (odds build): the scraper bridge's tables and the D25 cost guard.
-- Additive. Every table: RLS on, one read policy (writes are the worker/bridge,
-- as a role that bypasses RLS). See docs/design/odds-build/P6-bridge.md and
-- results/P6-cost-audit.md.

-- 1. Meters (D25): one number per meter per UTC day, written by whoever does
--    the work (the bridge counts its own egress bytes and rows; the cron logs
--    its run time). `costGuardJob` reads them; nothing here is estimated.
CREATE TABLE IF NOT EXISTS usage_meters (
  meter       text NOT NULL,            -- e.g. bridge.egress_bytes, bridge.rows_written, cron.run_seconds
  day         date NOT NULL,            -- UTC
  value       double precision NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meter, day)
);

-- 2. The cost guard's state (D25): one row, written by costGuardJob.
CREATE TABLE IF NOT EXISTS cost_guard_state (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  measured_at     timestamptz NOT NULL,
  month           date NOT NULL,          -- first day of the month measured
  projected_usd   double precision NOT NULL,   -- the measured components only
  ceiling_usd     double precision NOT NULL,
  unmeasured      text[] NOT NULL DEFAULT '{}', -- inputs with no measurement: a known unknown, never a guess
  brake           boolean NOT NULL DEFAULT false,
  reason          text,
  detail          jsonb
);

-- 3. Checked times (P6 §6): the scraper re-confirms every quoted price each
--    poll without writing; a row's checked time is max(row, this).
CREATE TABLE IF NOT EXISTS scraper_checks (
  source      text NOT NULL,
  game_id     text NOT NULL,
  last_ok_at  timestamptz NOT NULL,
  PRIMARY KEY (source, game_id)
);

-- 4. Unmatched prices, kept with their prices (P6 §6b, plan B4).
CREATE TABLE IF NOT EXISTS scraper_unmatched_prices (
  source      text NOT NULL,
  scraper_key text NOT NULL,
  event       text,
  market      text NOT NULL,
  player      text,
  book        text NOT NULL,
  line        double precision,
  side        text,
  price       double precision NOT NULL,
  checked     timestamptz NOT NULL,
  since       timestamptz NOT NULL,
  reason      text NOT NULL,
  PRIMARY KEY (source, scraper_key)
);
CREATE INDEX IF NOT EXISTS scraper_unmatched_prices_reason ON scraper_unmatched_prices (reason, checked);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['usage_meters','cost_guard_state','scraper_checks','scraper_unmatched_prices'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (true)', t || '_read', t);
  END LOOP;
END $$;

COMMENT ON TABLE usage_meters IS 'P6.0 (D25): measured usage per meter per UTC day; Python writes (bridge, cron, worker).';
COMMENT ON TABLE cost_guard_state IS 'P6.0 (D25): costGuardJob''s projection against the $50 ceiling, its unmeasured inputs, and the brake the bridge obeys.';
COMMENT ON TABLE scraper_checks IS 'P6: last ok poll per (scraper source, game); a scraper row''s checked time is max(row.fetched_at, last_ok_at).';
COMMENT ON TABLE scraper_unmatched_prices IS 'P6 (B4): priced scraper rows not yet mapped, current state per scraper key; deleted when the key maps.';
