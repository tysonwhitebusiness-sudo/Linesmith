-- Auth phase (Phase 03 of docs/four-feature-gameplan-2026-08-22.md): adds
-- per-user scoping to the three genuinely user-owned tables. Deliberately
-- does NOT touch pick_history — that table is a system-wide model-
-- calibration log (what the model surfaced, for later grading), not
-- per-user data; every user should see the same calibration numbers. See
-- the gameplan doc's Phase 03 section for the full reasoning.
--
-- Nullable on purpose: existing rows belong to no one until the operator's
-- own account is backfilled onto them (a separate, explicit step run once
-- the operator's real auth.users id is known — see the gameplan doc).
-- References auth.users directly (Supabase Auth's own table, same
-- Postgres database) rather than a duplicate app-level users table.

ALTER TABLE picks ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE bets ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_picks_user ON picks (user_id);
CREATE INDEX IF NOT EXISTS idx_bets_user ON bets (user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist (user_id);
