-- Historical odds archive + supporting tables — overnight sourcing import, 2026-09-01.
--
-- ============ WHY SPORT-KEYED AND NOT PER-SPORT TABLES ============
--
-- The operator asked whether per-sport tables would be better. They would not:
-- it inverts the repo's most load-bearing convention. One `player_game_history`
-- already carries 2.76M rows across NINE sport keys, where NFL has 57 stat keys
-- and tennis has 8 — a far wider divergence than odds will ever show — and it
-- works. Per-sport odds tables would turn every cross-sport query (the de-vig
-- backtest, CLV, seasonAggregates, rankings) into an eight-way UNION and make
-- every schema change happen eight times.
--
-- The differences between sports here are narrow and nameable: soccer has a
-- draw, hockey and baseball have a near-constant handicap. That is a nullable
-- column, exactly the pattern CLAUDE.md's sport-adapter §4 already prescribes.
--
-- ============ WHY SEPARATE FROM game_odds_history ============
--
-- `game_odds_history` is the LIVE observation log: high-churn, upserted
-- constantly, retention-pruned, and it only reaches back to 2026-08-12. This is
-- an IMMUTABLE archive: append-once, kept forever, scanned in bulk for
-- training. Different write pattern, different retention, different indexes.
--
-- `historical_odds` is deliberately NOT merged in. It stores pre-de-vigged
-- CONSENSUS PROBABILITIES — every row sums to exactly 1.0000 — not raw prices.
-- Putting two incompatible semantics behind one name is precisely what made it
-- useless for the de-vig backtest.

CREATE TABLE IF NOT EXISTS odds_archive (
  id              bigserial PRIMARY KEY,
  sport           text NOT NULL,
  -- The source's own event id where it has one (ESPN does, SBR does not).
  -- Never a join key on its own: verified 2026-08-31, Kaggle NHL ids are ESPN
  -- format (401131020) while player_game_history NHL ids are NHL-API format
  -- (2024020653) and they do NOT join. The natural key below is the real key.
  event_ref       text,
  game_date       date NOT NULL,
  home_team_raw   text NOT NULL,
  away_team_raw   text NOT NULL,
  home_team_id    text,
  away_team_id    text,
  market          text NOT NULL,          -- moneyline | total | spread
  side            text NOT NULL,          -- home | away | draw | over | under
  line            double precision,       -- the total or handicap; null for moneyline
  price           integer,                -- American odds
  open_line       double precision,
  open_price      integer,
  bookmaker       text,
  provider        text,
  source          text NOT NULL,
  -- Higher wins on conflict. SBR 100 (real closes, both sides, 2007-2023) >
  -- ESPN core 90 (many books, open+close, verified two-way) > nflverse/CFBD 80
  -- > football-data 70 > tennis-data 60 > ESPN site 50 (its NHL moneyline is a
  -- three-way regulation market summing to 0.83 and its NHL total was a
  -- constant 5.5) > Kaggle 40 (favourite-only price, no team orientation).
  source_priority smallint NOT NULL DEFAULT 50,
  booksum         double precision,
  -- two_way | three_way | sub_one_not_two_way | identical_prices | wide | missing
  ml_flag         text,
  raw_json        jsonb,
  ingested_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS odds_archive_natural_key
  ON odds_archive (sport, game_date, home_team_id, away_team_id, market, side, COALESCE(bookmaker, ''), source)
  WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS odds_archive_sport_date ON odds_archive (sport, game_date);
CREATE INDEX IF NOT EXISTS odds_archive_event ON odds_archive (event_ref) WHERE event_ref IS NOT NULL;

COMMENT ON TABLE odds_archive IS
  'Immutable historical game lines, sport-keyed. Separate from game_odds_history (live, pruned) and historical_odds (pre-de-vigged consensus probabilities).';

-- Props carry NO raw_json by operator decision: ~1.85M+ rows at ~600 bytes
-- would add 1.5-2.5 GB to a 3,141 MB database against an 8 GB ceiling. Every
-- parsed field is kept; only the unparsed blob is dropped.
CREATE TABLE IF NOT EXISTS prop_odds_archive (
  id              bigserial PRIMARY KEY,
  sport           text NOT NULL,
  event_ref       text,
  game_date       date,
  athlete_id      text,
  athlete_name    text,
  type_id         text,
  type_name       text NOT NULL,
  line            double precision,
  over_price      integer,
  under_price     integer,
  open_line       double precision,
  open_over_price integer,
  open_under_price integer,
  provider        text,
  source          text NOT NULL,
  source_priority smallint NOT NULL DEFAULT 50,
  last_updated    timestamptz,
  ingested_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS prop_odds_archive_natural_key
  ON prop_odds_archive (sport, event_ref, COALESCE(athlete_id, ''), type_name, COALESCE(line, -9999), source);
CREATE INDEX IF NOT EXISTS prop_odds_archive_athlete ON prop_odds_archive (sport, athlete_id);

-- Final scores keyed naturally. Justified rather than derived from
-- player_game_history because the new sources cover games the database does
-- not have at all: NHL 2020-21 is entirely absent and ESPN carries it.
CREATE TABLE IF NOT EXISTS game_result (
  id            bigserial PRIMARY KEY,
  sport         text NOT NULL,
  event_ref     text,
  game_date     date NOT NULL,
  home_team_raw text NOT NULL,
  away_team_raw text NOT NULL,
  home_team_id  text,
  away_team_id  text,
  home_score    integer,
  away_score    integer,
  venue         text,
  source        text NOT NULL,
  ingested_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS game_result_natural_key
  ON game_result (sport, game_date, home_team_raw, away_team_raw, source);
CREATE INDEX IF NOT EXISTS game_result_sport_date ON game_result (sport, game_date);

-- Daily availability snapshot. NOT new ingestion: ESPN injuries are ALREADY
-- fetched every day and thrown away — snapshot_cache holds espn-nfl-injuries
-- (8.9 MB), the NBA/NHL/CFB keys and eight MLB ones right now, and a retention
-- rule deletes the MLB ones after two days. No model in this system can learn
-- what an absence is worth until this exists, and unlike odds it cannot be
-- bought retroactively.
CREATE TABLE IF NOT EXISTS injury_report (
  id           bigserial PRIMARY KEY,
  sport        text NOT NULL,
  captured_on  date NOT NULL,
  team_id      text,
  team_name    text,
  athlete_id   text,
  athlete_name text,
  status       text,
  detail       text,
  raw_json     jsonb,
  captured_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS injury_report_daily_key
  ON injury_report (sport, captured_on, COALESCE(athlete_id, ''), COALESCE(athlete_name, ''));
CREATE INDEX IF NOT EXISTS injury_report_lookup ON injury_report (sport, captured_on);

-- Staging. Nothing unresolved is ever promoted; it stays here with a note.
CREATE TABLE IF NOT EXISTS odds_import_staging (
  LIKE odds_archive INCLUDING DEFAULTS
);
ALTER TABLE odds_import_staging ADD COLUMN IF NOT EXISTS resolution_status text;
ALTER TABLE odds_import_staging ADD COLUMN IF NOT EXISTS resolution_note text;

CREATE TABLE IF NOT EXISTS prop_import_staging (
  LIKE prop_odds_archive INCLUDING DEFAULTS
);
ALTER TABLE prop_import_staging ADD COLUMN IF NOT EXISTS resolution_status text;
ALTER TABLE prop_import_staging ADD COLUMN IF NOT EXISTS resolution_note text;
