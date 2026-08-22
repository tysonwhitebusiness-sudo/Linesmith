-- Follow-up to 20260822170000_add_user_id_to_slip_tables.sql — the pre-auth
-- UNIQUE constraints on picks/watchlist don't include user_id, which means
-- two different users adding the identical (sport, subject_id, dimension,
-- category) leg would silently collide (ON CONFLICT would update the OTHER
-- user's row instead of inserting the new user's own row). Re-scope both
-- constraints to include user_id before any multi-user traffic exists.
-- `bets` has no such constraint (append-only, no ON CONFLICT upsert), so
-- nothing to change there.

DO $$
DECLARE
  picks_constraint_name text;
  watchlist_constraint_name text;
BEGIN
  SELECT conname INTO picks_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'picks'::regclass AND contype = 'u'
    AND conkey = (
      SELECT array_agg(attnum ORDER BY attnum) FROM pg_attribute
      WHERE attrelid = 'picks'::regclass AND attname IN ('sport', 'subject_id', 'dimension', 'category')
    );
  IF picks_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE picks DROP CONSTRAINT %I', picks_constraint_name);
  END IF;

  SELECT conname INTO watchlist_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'watchlist'::regclass AND contype = 'u'
    AND conkey = (
      SELECT array_agg(attnum ORDER BY attnum) FROM pg_attribute
      WHERE attrelid = 'watchlist'::regclass AND attname IN ('sport', 'subject_id')
    );
  IF watchlist_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE watchlist DROP CONSTRAINT %I', watchlist_constraint_name);
  END IF;
END $$;

ALTER TABLE picks ADD CONSTRAINT picks_user_sport_subject_dimension_category_key
  UNIQUE (user_id, sport, subject_id, dimension, category);
ALTER TABLE watchlist ADD CONSTRAINT watchlist_user_sport_subject_key
  UNIQUE (user_id, sport, subject_id);
