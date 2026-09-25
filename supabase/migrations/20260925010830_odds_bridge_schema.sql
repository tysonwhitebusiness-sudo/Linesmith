-- P5 (odds workstream): schema for the scraper bridge, the approved odds
-- sections (Track O), and D24's compact history. See
-- docs/design/odds-build/P5-schema-and-writers.md, amendments A1-A3.
--
-- Additive: no existing column, key or constraint changes. `prop_odds_history`
-- is NOT touched here; `convert_prop_history.py` copies it into
-- `prop_price_history`, verifies it row for row, and drops it only after the
-- writer and every reader have moved (A1).

-- 1. Two times per price + source detail on prop prices (D23).
ALTER TABLE prop_odds ADD COLUMN IF NOT EXISTS changed_at timestamptz;   -- "since"
ALTER TABLE prop_odds ADD COLUMN IF NOT EXISTS extra jsonb;              -- limit, bid/ask, volume, version, payout
COMMENT ON COLUMN prop_odds.fetched_at IS 'checked: when a source last confirmed this price';
COMMENT ON COLUMN prop_odds.changed_at IS 'since: when this price last changed at the source (NULL on rows written before P5)';

-- 2. Dictionaries for the compact history tables (A1). Append-only: a code
--    never changes meaning, so every writer may cache them for its lifetime.
CREATE TABLE IF NOT EXISTS odds_games (
  id       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id  text NOT NULL UNIQUE,
  sport    text                      -- generic sport key when a writer knows it (game lines do; props do not)
);
CREATE TABLE IF NOT EXISTS odds_subjects (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_id  text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS odds_markets (
  id    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL UNIQUE          -- prop market_key, or a game market type (ml|sp|tot|...)
);
CREATE TABLE IF NOT EXISTS odds_books (
  id    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL UNIQUE          -- canonical bookmaker (entity_resolution.canonical_bookmaker)
);
CREATE TABLE IF NOT EXISTS odds_sources (
  id             smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id    text NOT NULL,       -- 'propline' | 'sharpapi' | ... | 'scraper:<source>'
  is_delayed     boolean NOT NULL DEFAULT false,
  delay_seconds  integer,
  CONSTRAINT odds_sources_key UNIQUE NULLS NOT DISTINCT (provider_id, is_delayed, delay_seconds)
);
CREATE TABLE IF NOT EXISTS odds_sides (
  id    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL UNIQUE          -- over|under|other|home|away|draw|yes|no|odd|even
);
CREATE TABLE IF NOT EXISTS odds_periods (
  id    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL UNIQUE          -- fg|1h|2h|1q..4q|p1..p4|f3|f5|f7|i1..i9|s1|m10
);

-- 3. Prop price history, compact (A1). Replaces prop_odds_history.
--    Columns are ordered widest first so the row packs without padding.
--    `id` continues the corpus's id space: converted rows keep theirs, new rows
--    start at the next 500k grid boundary above today's max (13,151,692), so
--    the old id-chunk corpus files close cleanly.
CREATE SEQUENCE IF NOT EXISTS prop_price_history_id_seq AS bigint START WITH 13500001;
CREATE TABLE IF NOT EXISTS prop_price_history (
  id            bigint NOT NULL DEFAULT nextval('prop_price_history_id_seq'),
  observed_at   timestamptz NOT NULL,   -- since: when the price changed at the source (today's observed_at)
  recorded_at   timestamptz NOT NULL,   -- when our writer stored it; the partition key
  decimal_odds  double precision,       -- as the provider sent it; NULL when it sent none
  game          integer NOT NULL,       -- odds_games.id
  subject       integer NOT NULL,       -- odds_subjects.id
  line          real,
  price         integer NOT NULL,       -- American odds
  market        smallint NOT NULL,      -- odds_markets.id
  book          smallint NOT NULL,      -- odds_books.id
  source        smallint NOT NULL,      -- odds_sources.id
  side          smallint NOT NULL,      -- odds_sides.id
  CONSTRAINT prop_price_history_times CHECK (observed_at <= recorded_at)
) PARTITION BY RANGE (recorded_at);
ALTER SEQUENCE prop_price_history_id_seq OWNED BY prop_price_history.id;
CREATE INDEX IF NOT EXISTS prop_price_history_chart ON prop_price_history (game, subject, market, observed_at);

-- 4. Game-line history, compact from the start (A1; replaces §1's text layout).
CREATE TABLE IF NOT EXISTS game_lines_history (
  observed_at  timestamptz NOT NULL,    -- since: the change time at the source
  recorded_at  timestamptz NOT NULL,    -- when our writer stored it; the partition key
  game         integer NOT NULL,
  point        real,
  price        integer NOT NULL,
  market       smallint NOT NULL,
  period       smallint NOT NULL,       -- odds_periods.id
  side         smallint NOT NULL,
  book         smallint NOT NULL,
  source       smallint NOT NULL,
  is_main      boolean NOT NULL,
  CONSTRAINT game_lines_history_times CHECK (observed_at <= recorded_at)
) PARTITION BY RANGE (recorded_at);
CREATE INDEX IF NOT EXISTS game_lines_history_chart ON game_lines_history (game, period, market, observed_at);

-- 5. Daily partitions. Created ahead by diskGuardJob (14 days); an insert past
--    the last partition fails loudly rather than landing somewhere unexported.
CREATE OR REPLACE FUNCTION odds_history_ensure_partitions(p_from date, p_days_ahead integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  t     text;
  d     date;
  nm    text;
  made  integer := 0;
  last  date := (now() AT TIME ZONE 'UTC')::date + p_days_ahead;
BEGIN
  FOREACH t IN ARRAY ARRAY['prop_price_history', 'game_lines_history'] LOOP
    d := p_from;
    WHILE d <= last LOOP
      nm := t || '_p' || to_char(d, 'YYYYMMDD');
      IF to_regclass('public.' || nm) IS NULL THEN
        EXECUTE format('CREATE TABLE public.%I PARTITION OF public.%I FOR VALUES FROM (%L) TO (%L)',
                       nm, t, d::text || ' 00:00:00+00', (d + 1)::text || ' 00:00:00+00');
        -- No policy on the partition: read it through its parent, whose policy applies.
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', nm);
        made := made + 1;
      END IF;
      d := d + 1;
    END LOOP;
  END LOOP;
  RETURN made;
END $$;
REVOKE ALL ON FUNCTION odds_history_ensure_partitions(date, integer) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION odds_history_ensure_partitions(date, integer) FROM anon, authenticated';
  END IF;
END $$;

-- The range the conversion needs (prop_odds_history's oldest row is 2026-09-11)
-- plus 14 days ahead.
SELECT odds_history_ensure_partitions('2026-09-10', 14);

-- 6. The export ledger (A1/A2): nothing is dropped without a verified row here.
CREATE TABLE IF NOT EXISTS odds_history_exports (
  table_name   text NOT NULL,           -- prop_price_history | game_lines_history
  part         text NOT NULL,           -- 'd<YYYYMMDD>' for a day, 'legacy' for prop ids < 13,500,001
  rows         bigint NOT NULL,
  digest       text NOT NULL,
  object_key   text,
  bytes        bigint,
  exported_at  timestamptz NOT NULL DEFAULT now(),
  verified_at  timestamptz,
  dropped_at   timestamptz,
  PRIMARY KEY (table_name, part)
);

-- 7. The disk guard's state (A2): one row, written every 15 minutes.
CREATE TABLE IF NOT EXISTS disk_guard_state (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  measured_at     timestamptz NOT NULL,
  db_bytes        bigint NOT NULL,
  wal_bytes       bigint NOT NULL,
  limit_bytes     bigint NOT NULL,       -- provisioned x limit pct
  hot_days        integer NOT NULL,      -- the window the mover prunes to
  bridge_paused   boolean NOT NULL DEFAULT false,
  partitions_ahead integer NOT NULL,
  reason          text,
  detail          jsonb
);

-- 8. Pulls: a price a book stopped offering, and when (if) it came back.
CREATE TABLE IF NOT EXISTS prop_odds_pulls (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id        text NOT NULL,
  game_id            text NOT NULL,
  subject_id         text NOT NULL,
  market_key         text NOT NULL,
  line               double precision,
  side               text NOT NULL,
  bookmaker          text NOT NULL,
  last_american_odds integer,
  pulled_at          timestamptz NOT NULL,
  returned_at        timestamptz,
  reason             text               -- 'line' (other lines still quoted) | 'event_gone' | 'complete_fetch'
);
CREATE INDEX IF NOT EXISTS prop_odds_pulls_lookup ON prop_odds_pulls (game_id, subject_id, market_key, pulled_at);
CREATE INDEX IF NOT EXISTS prop_odds_pulls_open ON prop_odds_pulls (provider_id, game_id, subject_id, market_key, side, bookmaker)
  WHERE returned_at IS NULL;

-- 9. Game lines (current state) with periods, alternates and every market type.
CREATE TABLE IF NOT EXISTS game_lines (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport         text NOT NULL,          -- generic: mlb|nfl|cfb|nba|nhl|soccer|tennis
  game_id       text NOT NULL,
  period        text NOT NULL,          -- fg|1h|2h|1q..4q|p1..p4|f3|f5|f7|i1..i9|s1|m10
  market        text NOT NULL,          -- ml|sp|tot|ml3|tt_home|tt_away|tt|odd_even|btts|... (P2 GAME_TYPE)
  side          text NOT NULL,          -- home|away|draw|over|under|yes|no|odd|even
  point         double precision,
  is_main       boolean NOT NULL DEFAULT false,
  bookmaker     text NOT NULL,
  source        text NOT NULL,          -- 'scraper:<source>' | provider id
  american_odds integer NOT NULL,
  decimal_odds  double precision,
  fetched_at    timestamptz NOT NULL,   -- checked
  changed_at    timestamptz NOT NULL,   -- since
  extra         jsonb,
  CONSTRAINT game_lines_key UNIQUE NULLS NOT DISTINCT (sport, game_id, period, market, side, point, bookmaker, source),
  CONSTRAINT game_lines_odds_sane CHECK (american_odds <= -100 OR american_odds >= 100),
  CONSTRAINT game_lines_sport_valid CHECK (sport IN ('mlb','nfl','cfb','nba','nhl','soccer','tennis'))
);
CREATE INDEX IF NOT EXISTS game_lines_game ON game_lines (sport, game_id, period, market);

CREATE TABLE IF NOT EXISTS game_line_pulls (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport text NOT NULL, game_id text NOT NULL, period text NOT NULL, market text NOT NULL, side text NOT NULL,
  point double precision, bookmaker text NOT NULL, source text NOT NULL,
  last_american_odds integer, pulled_at timestamptz NOT NULL, returned_at timestamptz, reason text
);
CREATE INDEX IF NOT EXISTS game_line_pulls_lookup ON game_line_pulls (game_id, period, market, pulled_at);
CREATE INDEX IF NOT EXISTS game_line_pulls_open ON game_line_pulls (sport, game_id, period, market, side, bookmaker, source)
  WHERE returned_at IS NULL;

-- 10. Openers (D21): the first price recorded per book, VSiN's OPEN row for Nevada.
CREATE TABLE IF NOT EXISTS market_openers (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('prop','game')),
  sport         text NOT NULL,
  game_id       text NOT NULL,
  subject_id    text NOT NULL DEFAULT '',   -- '' for game markets
  period        text NOT NULL DEFAULT 'fg',
  market        text NOT NULL,              -- prop market_key or game market type
  side          text NOT NULL,
  bookmaker     text NOT NULL,
  point         double precision,
  american_odds integer,
  opened_at     timestamptz NOT NULL,
  opener_source text NOT NULL CHECK (opener_source IN ('first_seen','vsin_open','an_open','theoddsgap')),
  check_flag    boolean NOT NULL DEFAULT false,
  check_reason  text,
  CONSTRAINT market_openers_key UNIQUE (kind, game_id, subject_id, period, market, side, bookmaker)
);
CREATE INDEX IF NOT EXISTS market_openers_game ON market_openers (sport, game_id);

-- 11. Splits (Track V): every change, one row per change.
CREATE TABLE IF NOT EXISTS market_splits (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport       text NOT NULL,
  game_id     text NOT NULL,
  subject_id  text NOT NULL DEFAULT '',     -- '' for game markets; athlete id for pick counts
  period      text NOT NULL DEFAULT 'fg',
  market      text NOT NULL,                -- ml|sp|tot|<prop market_key>
  side        text NOT NULL,
  line        double precision,
  source      text NOT NULL,                -- dknetwork|vsin|sao_consensus|covers|actionnetwork|sleeper
  book        text,                         -- whose customers: draftkings|circa|NULL (unstated)
  kind        text NOT NULL CHECK (kind IN ('bets_money','picks','pick_counts','bet_count')),
  pct_bets    double precision,
  pct_money   double precision,
  count       integer,
  count_total integer,
  observed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS market_splits_lookup ON market_splits (game_id, market, source, observed_at DESC);

-- 12. Exchange order books (current state; the ladder history stays on the laptop).
CREATE TABLE IF NOT EXISTS exchange_books (
  exchange      text NOT NULL CHECK (exchange IN ('kalshi','polymarket')),
  contract_id   text NOT NULL,
  sport         text NOT NULL,
  game_id       text NOT NULL,
  subject_id    text NOT NULL DEFAULT '',
  period        text NOT NULL DEFAULT 'fg',
  market        text NOT NULL,
  side          text NOT NULL,
  point         double precision,
  best_bid      double precision, best_ask double precision,
  bid_size      double precision, ask_size double precision,
  volume_24h    double precision, open_interest double precision, liquidity double precision,
  ladder        jsonb,                       -- {"bids": [[price,size]...], "asks": [...]} top 10 levels
  changed_at    timestamptz NOT NULL,        -- the ladder's own "price since"
  fetched_at    timestamptz NOT NULL,
  PRIMARY KEY (exchange, contract_id)
);
CREATE INDEX IF NOT EXISTS exchange_books_game ON exchange_books (sport, game_id, market);

-- 13. Reference facts per game (P8: the Vegas board's VSiN power ratings;
--     umpires/referees ride along). One row per (game, source, kind, subject).
CREATE TABLE IF NOT EXISTS game_reference (
  sport       text NOT NULL,
  game_id     text NOT NULL,
  source      text NOT NULL,              -- vsin
  kind        text NOT NULL CHECK (kind IN ('power_rating','umpire','referee','book_link')),
  subject     text NOT NULL,              -- team name for power ratings; bookmaker for book_link; '' for game-level
  data        jsonb NOT NULL,             -- the source row as stored by the scraper
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (sport, game_id, source, kind, subject)
);

-- 14. RLS, the pattern of 20260915060000: read-only to the API roles; the
--     worker writes as the service role.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['odds_games','odds_subjects','odds_markets','odds_books','odds_sources',
                           'odds_sides','odds_periods','prop_price_history','game_lines_history',
                           'odds_history_exports','disk_guard_state',
                           'prop_odds_pulls','game_lines','game_line_pulls',
                           'market_openers','market_splits','exchange_books','game_reference'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (true)', t || '_read', t);
  END LOOP; END $$;

COMMENT ON TABLE prop_price_history IS 'P5 (D24): prop price changes, dictionary-coded, one partition per UTC day of recorded_at. Replaces prop_odds_history. Read only through lib/db/priceHistory.ts and src/price_history.py.';
COMMENT ON TABLE game_lines_history IS 'P5 (D24): game-line changes (price or main-line flag), compact, partitioned like prop_price_history.';
COMMENT ON TABLE odds_history_exports IS 'P5: export ledger for the compact history tables; a partition is dropped only after a verified row here.';
COMMENT ON TABLE disk_guard_state IS 'P5 (D24): diskGuardJob''s last measurement, the hot window it set, and whether the bridge is paused.';
COMMENT ON TABLE game_lines IS 'P5: current per-book game lines, every period, alternate and market type. Python writes (scraper bridge); read by the Track O odds sections.';
COMMENT ON TABLE prop_odds_pulls IS 'P5: a prop price a book stopped offering, and its return.';
COMMENT ON TABLE game_line_pulls IS 'P5: a game-line price a book stopped offering, and its return.';
COMMENT ON TABLE market_openers IS 'P5 (D21): first price per book; VSiN OPEN for Nevada; check_flag = failed the opener sanity check, kept, never used as the opener.';
COMMENT ON TABLE market_splits IS 'P5 (Track V): bets/money %, picks, pick counts and bet counts, labelled by source and whose customers; one row per change.';
COMMENT ON TABLE exchange_books IS 'P5: Kalshi/Polymarket order book per contract, current state.';
COMMENT ON TABLE game_reference IS 'P5: per-game reference facts (VSiN power ratings, umpires, referees), latest wins.';
