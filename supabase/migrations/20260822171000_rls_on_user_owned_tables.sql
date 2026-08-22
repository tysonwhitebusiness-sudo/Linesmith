-- Auth phase, security-critical follow-up: Supabase auto-exposes every
-- public-schema table via its PostgREST REST API. This app's own backend
-- bypasses RLS (it connects with a direct Postgres connection string, not
-- through PostgREST) and already filters every query by user_id explicitly
-- — but the NEXT_PUBLIC_SUPABASE_ANON_KEY shipped to the browser bundle can
-- call that REST API directly. Without RLS, anyone holding that public key
-- could read or write ANY user's picks/bets/watchlist rows straight through
-- Supabase's REST API, completely bypassing this app's route-level auth
-- checks. Enabling RLS with a default-deny policy set closes that gap.
--
-- Legacy rows with user_id IS NULL (pre-auth global data, not yet backfilled
-- to the operator's account) are deliberately invisible under every policy
-- below — this app's own backend doesn't rely on RLS to read/write them (it
-- connects with a privileged role), so this only affects the anon-key REST
-- path, where "nobody can see unowned rows" is the safe default.

ALTER TABLE picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY picks_owner_all ON picks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY bets_owner_all ON bets
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY watchlist_owner_all ON watchlist
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
