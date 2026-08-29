-- Task 5.3 (P3 H9) — collapse game_odds_book_lines' bookmaker spellings.
--
-- Measured 2026-08-29 against live data: 33 distinct spellings for 22 real
-- books. `fanduel` / `FanDuel` / `Fanduel` was 750 rows split three ways;
-- `BetMGM` / `betmgm` / `BetMGM.us` another 546. This corrupts best-price
-- selection (the core Tier B feature) and is part of why 4.1's de-vig
-- resolution rate sits at 18% — `_two_sided_devigged_for_row` matches on
-- bookmaker equality, so a `Fanduel` over never pairs with a `fanduel` under.
--
-- The canonical form (operator decision Q30) is lowercase with the-odds-api's
-- regional/licence suffix stripped: bet365.us -> bet365, BetOnline.ag ->
-- betonline, LowVig.ag -> lowvig, MyBookie.ag -> mybookie. `betus` is NOT
-- stripped — BetUS is a real book whose name ends in "us".
--
-- The write path was fixed first, in ONE place per language:
-- db.py's write_game_odds_book_lines and client.ts's writeGameOddsBookLines.
-- This migration only repairs the history those two used to write.
--
-- REVERSIBLE: every pre-change row is copied to
-- game_odds_book_lines_bookmaker_backup_20260829 before anything is modified.
-- Drop that table only once the change has soaked, the same discipline
-- prop_odds_dedup_backup_20260829 is under.

BEGIN;

-- 1. Full backup of the table as it stands, before any mutation.
CREATE TABLE IF NOT EXISTS game_odds_book_lines_bookmaker_backup_20260829 AS
  SELECT * FROM game_odds_book_lines;

-- 2. The canonical mapping, as data rather than as procedural logic, so the
--    exact substitution applied is readable in this file and in the diff.
CREATE TEMP TABLE _bookmaker_canon (raw text PRIMARY KEY, canon text NOT NULL) ON COMMIT DROP;
INSERT INTO _bookmaker_canon (raw, canon) VALUES
  ('bet365.us',    'bet365'),
  ('BetMGM',       'betmgm'),
  ('BetMGM.us',    'betmgm'),
  ('BetOnline.ag', 'betonline'),
  ('betonlineag',  'betonline'),
  ('BetRivers',    'betrivers'),
  ('BetUS',        'betus'),
  ('Bovada',       'bovada'),
  ('DraftKings',   'draftkings'),
  ('FanDuel',      'fanduel'),
  ('Fanduel',      'fanduel'),
  ('LowVig.ag',    'lowvig'),
  ('MyBookie.ag',  'mybookie'),
  ('mybookieag',   'mybookie'),
  ('tab_au',       'tabau');

-- 3. Collapsing spellings creates collisions on the table's own unique key
--    (sport, game_id, market, side, bookmaker, source) — that key is exactly
--    what failed to merge these rows in the first place. Keep the freshest row
--    per canonical key and drop the rest. Every dropped row is already in the
--    backup table from step 1.
WITH renamed AS (
  SELECT gobl.id,
         gobl.sport, gobl.game_id, gobl.market, gobl.side, gobl.source,
         gobl.fetched_at,
         COALESCE(c.canon, gobl.bookmaker) AS canon
    FROM game_odds_book_lines gobl
    LEFT JOIN _bookmaker_canon c ON c.raw = gobl.bookmaker
), ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY sport, game_id, market, side, canon, source
           ORDER BY fetched_at DESC, id DESC
         ) AS rn
    FROM renamed
)
DELETE FROM game_odds_book_lines
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 4. Now the rename cannot collide.
UPDATE game_odds_book_lines gobl
   SET bookmaker = c.canon
  FROM _bookmaker_canon c
 WHERE c.raw = gobl.bookmaker
   AND gobl.bookmaker <> c.canon;

COMMIT;
