-- Task 5.3, extended to game_odds_history (found during 5.13's schema pass).
--
-- game_odds_history has the SAME defect game_odds_book_lines had: 36 spellings
-- for ~26 real books. It was not in P3 H9's text, which named only
-- game_odds_book_lines, but it is the same bug in a table where it matters
-- MORE, for two reasons:
--
--  1. THE DEDUP KEY READS `bookmaker`. write_game_odds_history is log-on-change:
--     it compares the newest american_odds for (event_id, market, side,
--     bookmaker, source) and only inserts when the price differs. With
--     `FanDuel` and `fanduel` as separate keys, one book keeps TWO independent
--     price histories, so a real move can be missed (compared against the wrong
--     history) or invented (first sighting under the other spelling looks like
--     a change). The idx_game_odds_history_lookup index is on that same key.
--
--  2. THIS IS THE TABLE 6.1's LINE-MOVEMENT CHARTS READ. Split spellings draw
--     one book as two half-lines.
--
-- Canonical form is identical to 20260829080000's (operator decision Q30):
-- lowercase, the-odds-api's regional suffix stripped. Same map, restated as
-- data so the substitution is visible in this file too.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: it does not delete anything. Merging the
-- spellings makes 2,380 groups of (event_id, market, side, source, bookmaker,
-- observed_at) hold more than one row — observations that were always
-- duplicates and merely LOOKED distinct because of spelling. They are not
-- created by this change; they are revealed by it. This is an append-only
-- observation log, deleting from it is destructive, and no Phase 5 task
-- requires it, so they are surfaced for task 6.1 (line-movement charts) to
-- decide on rather than quietly removed here. The existing reader already
-- breaks ties deterministically (ORDER BY observed_at DESC, id DESC).
--
-- REVERSIBLE: full pre-change copy in
-- game_odds_history_bookmaker_backup_20260829.

BEGIN;

CREATE TABLE IF NOT EXISTS game_odds_history_bookmaker_backup_20260829 AS
  SELECT * FROM game_odds_history;

CREATE TEMP TABLE _goh_canon (raw text PRIMARY KEY, canon text NOT NULL) ON COMMIT DROP;
INSERT INTO _goh_canon (raw, canon) VALUES
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

UPDATE game_odds_history goh
   SET bookmaker = c.canon
  FROM _goh_canon c
 WHERE c.raw = goh.bookmaker
   AND goh.bookmaker <> c.canon;

COMMIT;
