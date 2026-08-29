-- Task 5.3/5.13 residue sweep — and the reason it was needed, which is worth
-- more than the migration itself.
--
-- The Phase 5 gate's G1 re-ran 5.3's VERIFY and it FAILED:
-- `game_odds_book_lines` was back to 37 distinct bookmakers (from 22) and
-- `game_odds_history` to 31. New un-canonical rows really were arriving.
--
-- The cause was NOT a code defect. Both writers canonicalise correctly —
-- verified end-to-end against the live database, submitting
-- ['FanDuel','MyBookie.ag','DraftKings'] through the real
-- db.write_game_odds_history and getting back ['fanduel','mybookie',
-- 'draftkings'].
--
-- The cause was LONG-RUNNING PROCESSES HOLDING THE OLD MODULE IN MEMORY.
-- `db.py` was saved at 08:01:15Z. OddsHarvester runs as Windows scheduled
-- tasks on a ~20-minute cycle (LinesmithOddsHarvester*), and Python binds
-- imported modules at process start. A harvester run that began at ~07:53Z
-- was still executing at 08:11:57Z and wrote through its in-memory pre-fix
-- copy of `write_game_odds_history`. The Render worker had the same shape at
-- a smaller scale: its last un-canonical write was 08:05:09Z, seconds after
-- the 08:04:17Z restart, from a cycle already in flight.
--
-- Confirmed self-resolving by measurement rather than by argument. Rows
-- written after 08:15:00Z:
--     game_odds_book_lines  193 rows, 4 books, 0 un-canonical
--     game_odds_history       7 rows, 3 books, 0 un-canonical
--
-- THE GENERAL LESSON, which is why this is written down at length: on this
-- system a deploy does NOT mean every writer is running the new code. Render
-- restarts the worker, but the scheduled harvester tasks on the operator's
-- machine keep their own processes alive for minutes afterwards. Any future
-- migration that normalises a column MUST be re-applied after those processes
-- have cycled, or the verification will look like a regression and send the
-- next reader hunting a bug that does not exist.
--
-- This sweep is the same UPDATE both earlier migrations ran, re-applied. It is
-- idempotent: rows already canonical do not match. The original backups
-- (game_odds_book_lines_bookmaker_backup_20260829,
--  game_odds_history_bookmaker_backup_20260829) still hold the pre-change
-- state and are NOT overwritten here.

BEGIN;

CREATE TEMP TABLE _canon (raw text PRIMARY KEY, canon text NOT NULL) ON COMMIT DROP;
INSERT INTO _canon (raw, canon) VALUES
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

-- game_odds_book_lines: collapsing can collide on its unique key
-- (sport, game_id, market, side, bookmaker, source). Keep the freshest row per
-- canonical key.
--
-- REVERSIBILITY, STATED ACCURATELY. This deleted 1,213 rows (7,552 -> 6,339).
-- The 5.3 backup table holds 6,199 rows whose newest `fetched_at` is
-- 07:21:30Z, so it does NOT cover the rows the pre-fix processes wrote between
-- 07:21Z and 08:15Z, some of which were dropped here. Saying "anything dropped
-- is already in the backup" would have been false, and it is exactly the kind
-- of unverified claim this whole remediation exists to stamp out.
--
-- Why the loss is nonetheless immaterial: `game_odds_book_lines` is a
-- CURRENT-STATE table, not a log — its ON CONFLICT upsert means a key only
-- ever holds the latest price, and the per-key history lives in
-- `game_odds_history` (which has no dedup step here and lost nothing). Every
-- row deleted was a stale duplicate of a key whose freshest observation was
-- kept. Nothing a reader can ask this table has a different answer now.
WITH renamed AS (
  SELECT gobl.id, gobl.sport, gobl.game_id, gobl.market, gobl.side, gobl.source,
         gobl.fetched_at, COALESCE(c.canon, gobl.bookmaker) AS canon
    FROM game_odds_book_lines gobl
    LEFT JOIN _canon c ON c.raw = gobl.bookmaker
), ranked AS (
  SELECT id, row_number() OVER (
           PARTITION BY sport, game_id, market, side, canon, source
           ORDER BY fetched_at DESC, id DESC) AS rn
    FROM renamed
)
DELETE FROM game_odds_book_lines WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

UPDATE game_odds_book_lines gobl
   SET bookmaker = c.canon
  FROM _canon c
 WHERE c.raw = gobl.bookmaker AND gobl.bookmaker <> c.canon;

-- game_odds_history has no unique constraint (PK on id only), so no dedup step.
UPDATE game_odds_history goh
   SET bookmaker = c.canon
  FROM _canon c
 WHERE c.raw = goh.bookmaker AND goh.bookmaker <> c.canon;

COMMIT;
