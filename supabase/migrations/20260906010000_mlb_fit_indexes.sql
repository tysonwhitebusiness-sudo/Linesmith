-- Phase 5.4 — indexes for the access pattern the MLB walk-forward actually has.
--
-- The fit reads one MARKET at a time: every prop row whose `type_name` is one of
-- that market's spellings, joined to its outcome. `prop_odds_archive` had no
-- index on `type_name` at all — its five existing indexes are keyed on
-- athlete_id, event_ref or captured_at — so each of the 14 markets forced a
-- scan, and the fit died twice on the 2-minute statement timeout at its fifth
-- market.
--
-- `player_game_history` is scanned by (sport, game_date) twice per market: once
-- by load_game_history for the whole ordered history, once by the serving path
-- for a slate. Its existing lookup index leads with athlete_id, which does not
-- serve a date-ranged scan.
--
-- Both are plain btrees on columns that already exist; nothing about the data
-- changes.
CREATE INDEX IF NOT EXISTS prop_odds_archive_market_date
  ON prop_odds_archive (sport, type_name, game_date);

CREATE INDEX IF NOT EXISTS player_game_history_sport_date
  ON player_game_history (sport, game_date);
