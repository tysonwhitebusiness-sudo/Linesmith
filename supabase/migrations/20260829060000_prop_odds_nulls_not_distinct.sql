-- Task 3.10 follow-up — the duplicate-row bug found while batching
-- write_prop_odds. Not in any audit finding; found by measurement.
--
-- THE BUG. prop_odds' uniqueness constraint is
--   (provider_id, game_id, subject_id, market_key, line, side, bookmaker)
-- and `line` is NULL for categorical markets (anytime-TD, hit-in-game and
-- friends) — 192,267 of 221,666 rows, 87% of the table.
--
-- Postgres UNIQUE indexes treat NULLs as DISTINCT, so two rows that differ
-- only by "both have NULL line" do not conflict. write_prop_odds' upsert
-- therefore NEVER matched for those markets: every refresh cycle INSERTed a
-- new row instead of updating the existing one.
--
-- Measured before this migration:
--   duplicated natural keys          13,981
--   rows in those duplicates        192,219   -> 178,238 redundant
--   worst single key                    674 copies
--   duplicated keys WITH a line           0   <- the proof of cause
--
-- The last line is what identifies it beyond doubt: the constraint works
-- perfectly whenever `line` is non-NULL.
--
-- WHY IT MATTERED BEYOND DISK. 5,792 of those keys hold copies that DISAGREE
-- on price, up to 77 distinct prices for a single key. A reader asking for the
-- current price of such a market got an arbitrary one of them. So this was a
-- correctness bug in what the app displayed, not only unbounded growth.
--
-- THE FIX. NULLS NOT DISTINCT (PostgreSQL 15+; this database is 17) makes two
-- NULL lines conflict the way every other equal pair does, so ON CONFLICT
-- fires and the upsert behaves as it always read as though it did.
--
-- Existing duplicates must be collapsed first, because the new index cannot be
-- built over data that violates it. The survivor is the newest row per key by
-- (fetched_at DESC, id DESC) — precisely the row the upsert would have left
-- behind had it ever worked. The discarded rows are superseded snapshots;
-- genuine price movement is preserved independently in prop_odds_history.

BEGIN;

-- Snapshot of everything about to be deleted. Kept until the migration is
-- verified, then dropped by hand — a destructive change to live model inputs
-- should be reversible for longer than the transaction it runs in.
CREATE TABLE IF NOT EXISTS prop_odds_dedup_backup_20260829 AS
SELECT * FROM prop_odds
WHERE id NOT IN (
  SELECT DISTINCT ON (provider_id, game_id, subject_id, market_key, line, side, bookmaker) id
  FROM prop_odds
  ORDER BY provider_id, game_id, subject_id, market_key, line, side, bookmaker, fetched_at DESC, id DESC
);

DELETE FROM prop_odds
WHERE id NOT IN (
  SELECT DISTINCT ON (provider_id, game_id, subject_id, market_key, line, side, bookmaker) id
  FROM prop_odds
  ORDER BY provider_id, game_id, subject_id, market_key, line, side, bookmaker, fetched_at DESC, id DESC
);

ALTER TABLE prop_odds
  DROP CONSTRAINT IF EXISTS prop_odds_provider_id_game_id_subject_id_market_key_line_si_key;

ALTER TABLE prop_odds
  ADD CONSTRAINT prop_odds_natural_key
  UNIQUE NULLS NOT DISTINCT (provider_id, game_id, subject_id, market_key, line, side, bookmaker);

COMMIT;

COMMENT ON CONSTRAINT prop_odds_natural_key ON prop_odds IS
  'NULLS NOT DISTINCT is load-bearing: line is NULL for categorical markets, and without it ON CONFLICT never fires for them and every refresh inserts instead of updating. See migration 20260829060000.';
