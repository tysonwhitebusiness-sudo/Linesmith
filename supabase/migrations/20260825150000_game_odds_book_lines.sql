-- OddsHarvester integration (docs/... this session's gameplan): a real
-- per-bookmaker game-lines table, feeding the bookmaker-column/market-row
-- heat-mapped table on Game Detail. Two independent, uncoordinated writers
-- will populate this — a GitHub Actions workflow running OddsHarvester, and
-- python-odds-service's existing the-odds-api port (odds_lines_cycle.py) —
-- so `source` is part of the row's identity, not a display-only column.
-- Without it, whichever writer runs last would silently overwrite the
-- other's price for the same nominal bookmaker; combining sources into one
-- displayed price happens at READ time (the Next.js side), never here.
CREATE TABLE IF NOT EXISTS game_odds_book_lines (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport         TEXT NOT NULL,
  game_id       TEXT NOT NULL,
  market        TEXT NOT NULL, -- 'moneyline' | 'spread' | 'total'
  side          TEXT NOT NULL, -- 'home'/'away' (moneyline, spread) | 'over'/'under' (total)
  bookmaker     TEXT NOT NULL,
  source        TEXT NOT NULL, -- 'oddsharvester' | 'the-odds-api' | future sources
  point         DOUBLE PRECISION, -- spread/total line; null for moneyline
  american_odds INTEGER NOT NULL,
  decimal_odds  DOUBLE PRECISION,
  fetched_at    TIMESTAMPTZ NOT NULL,
  UNIQUE (sport, game_id, market, side, bookmaker, source)
);

CREATE INDEX IF NOT EXISTS idx_game_odds_book_lines_game ON game_odds_book_lines (sport, game_id);

-- game_odds_history predates multi-source writers (the-odds-api only) and
-- its dedup key (event_id, market, side, bookmaker) has no source column —
-- adding OddsHarvester as a second writer without one would let the two
-- sources' history rows oscillate against each other on every cycle
-- whenever they disagree on a nominal bookmaker's price, corrupting the
-- log's "did the price actually move" meaning. Backfilled 'the-odds-api'
-- for every existing row, since that's the only source that has ever
-- written here — preserves existing readers' meaning exactly.
ALTER TABLE game_odds_history ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'the-odds-api';

-- Widen the market check now that OddsHarvester's spread coverage is a real
-- input this table needs to hold (the-odds-api's own port never wrote
-- spread here — "not needed by the game model this feeds" — but the new
-- bookmaker-grid UI needs it). No CHECK constraint existed before this to
-- widen; the comment on the column already documented 'moneyline' | 'total'
-- only, now 'moneyline' | 'spread' | 'total'.
