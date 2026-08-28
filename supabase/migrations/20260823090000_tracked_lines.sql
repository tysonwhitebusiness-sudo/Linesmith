-- Player-detail live line tracker (docs/live-matchup-and-line-tracker-
-- gameplan-2026-08-23.md, Part 2). Sibling to `watchlist`, not a
-- repurposing of it: watchlist is "follow this subject", this is "track
-- this subject+stat+threshold, live or manual". Same per-user-row-ownership
-- shape as watchlist, RLS policy copied from the exact pattern
-- 20260822171000_rls_on_user_owned_tables.sql already established.

CREATE TABLE IF NOT EXISTS tracked_lines (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id),
  sport        TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  -- Sport's own stat vocabulary, e.g. 'points', 'hits', 'shots_on_goal' —
  -- constrained to keys the app can compute a live value for (see
  -- PlayerDetailData.liveLineTracker.availableStats), not free text.
  stat_key     TEXT NOT NULL,
  stat_label   TEXT NOT NULL,
  side         TEXT NOT NULL CHECK (side IN ('over', 'under')),
  line         DOUBLE PRECISION NOT NULL,
  -- 'manual' = user-entered line; 'prop_odds' = copied from a real sportsbook
  -- line at add-time. Both track the same way once saved.
  source       TEXT NOT NULL CHECK (source IN ('manual', 'prop_odds')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, sport, subject_id, stat_key)
);

CREATE INDEX IF NOT EXISTS idx_tracked_lines_user ON tracked_lines (user_id);
CREATE INDEX IF NOT EXISTS idx_tracked_lines_user_sport ON tracked_lines (user_id, sport);

ALTER TABLE tracked_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY tracked_lines_owner_all ON tracked_lines
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
