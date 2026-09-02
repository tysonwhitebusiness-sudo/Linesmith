-- IN-PLAY PRICES WERE SITTING IN THE ARCHIVE AS ORDINARY BOOKMAKERS.
--
-- Found by auditing Brier per bookmaker on 2026-09-01. ESPN's core odds feed
-- includes five "- Live Odds" books, and they are not sharper markets, they are
-- prices taken after the game started:
--
--     ESPN BET - Live Odds                          Brier 0.0320
--     Caesars Sportsbook (New Jersey) - Live Odds   Brier 0.0511
--     ESPN Bet - Live Odds                          Brier 0.0594
--     ---- every genuine pre-game book ----         Brier 0.208 - 0.232
--
-- A price that scores 0.03 already knows the score. 48,489 rows. Training a
-- model on them would produce a spectacular backtest and a worthless model, and
-- nothing in the schema distinguished them from a real closing line.
--
-- FLAGGED, NOT DELETED. They are real observations of a real market and a live
-- model would want them; what they must never be is a pre-game close. Gate 5.3
-- and every model query filter on `NOT is_live`, so the default is exclusion
-- and inclusion has to be deliberate.
--
-- This is the same reasoning gate 5.3 already applies to sub-one booksums:
-- flag honesty, not absence.

ALTER TABLE odds_archive ADD COLUMN IF NOT EXISTS is_live boolean NOT NULL DEFAULT false;
ALTER TABLE odds_import_staging ADD COLUMN IF NOT EXISTS is_live boolean NOT NULL DEFAULT false;

-- Backfill from the only marker the source gives: the bookmaker's own name.
UPDATE odds_archive SET is_live = true
  WHERE bookmaker ILIKE '%live odds%' OR bookmaker ILIKE '%in-play%' OR bookmaker ILIKE '%inplay%';
UPDATE odds_import_staging SET is_live = true
  WHERE bookmaker ILIKE '%live odds%' OR bookmaker ILIKE '%in-play%' OR bookmaker ILIKE '%inplay%';

CREATE INDEX IF NOT EXISTS odds_archive_pregame
  ON odds_archive (sport, market, game_date) WHERE NOT is_live;
