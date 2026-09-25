-- P11 (E1 + O6): the market edge. docs/design/odds-build/P11-edge.md, "Build" §1.
--
-- market_edges     what may be shown now: every market-side passing all gates.
--                  Python (predict/market_edge.py, marketEdgeJob) is the only writer.
-- market_edge_log  every edge from the moment it first passes until a gate first
--                  fails (ended_at, end_reason). P13's closing-line test reads it.
-- app_flags        runtime switches read by the app. TWO writers, named:
--                  the operator by hand (edge_display), and Python (edge_auto_off only).

CREATE TABLE IF NOT EXISTS market_edges (
  kind text NOT NULL CHECK (kind IN ('prop','game')), sport text NOT NULL, game_id text NOT NULL,
  subject_id text NOT NULL DEFAULT '', period text NOT NULL DEFAULT 'fg', market text NOT NULL,
  side text NOT NULL, line double precision, bookmaker text NOT NULL, provider text NOT NULL,
  soft_american integer NOT NULL, fair_prob double precision NOT NULL, edge_pts double precision NOT NULL,
  ev double precision NOT NULL, method text NOT NULL, reference jsonb NOT NULL,
  soft_checked_at timestamptz NOT NULL, soft_since timestamptz NOT NULL, sharp_checked_at timestamptz NOT NULL,
  sharp_since timestamptz NOT NULL, passing_since timestamptz NOT NULL, single_source boolean NOT NULL,
  computed_at timestamptz NOT NULL,
  -- NULLS NOT DISTINCT: a moneyline has no line, and a NULL must still key one row.
  CONSTRAINT market_edges_key UNIQUE NULLS NOT DISTINCT (kind, game_id, subject_id, period, market, side, line, bookmaker)
);
CREATE INDEX IF NOT EXISTS market_edges_game ON market_edges (sport, game_id);

CREATE TABLE IF NOT EXISTS market_edge_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL, sport text NOT NULL, game_id text NOT NULL, subject_id text NOT NULL DEFAULT '',
  period text NOT NULL DEFAULT 'fg', market text NOT NULL, side text NOT NULL, line double precision,
  bookmaker text NOT NULL, provider text NOT NULL, soft_american integer NOT NULL, fair_prob double precision NOT NULL,
  ev double precision NOT NULL, method text NOT NULL, gates jsonb NOT NULL, reference jsonb NOT NULL,
  shown_at timestamptz NOT NULL, ended_at timestamptz, end_reason text, displayed boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS market_edge_log_game ON market_edge_log (sport, game_id, shown_at);
CREATE INDEX IF NOT EXISTS market_edge_log_open ON market_edge_log (kind, game_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS app_flags (
  key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL
);
INSERT INTO app_flags (key, value, updated_by) VALUES ('edge_display', '{"enabled": true}', 'migration')
  ON CONFLICT (key) DO NOTHING;

-- RLS: the 20260915060000 pattern — on, one read policy, writes denied to anon.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['market_edges','market_edge_log','app_flags'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (true)', t || '_read', t);
  END LOOP;
END $$;

COMMENT ON TABLE market_edges IS 'P11 (E1): market-sides passing every edge gate now; Python (marketEdgeJob) writes, TypeScript renders.';
COMMENT ON TABLE market_edge_log IS 'P11 (E1): every edge from first pass to first failing gate; displayed = shown on pages at the time. P13 reads it.';
COMMENT ON TABLE app_flags IS 'P11: runtime switches. edge_display = operator by hand; edge_auto_off = Python (the gate-9 self-check).';
