-- P5.1 (odds build): RLS on every public table that still lacked it.
--
-- Measured 2026-09-25 from pg_class (not from any list in the docs): 20 tables
-- had relrowsecurity = false, and the `anon` role held INSERT on every one of
-- them, so anyone with the public anon key could write to them through the
-- REST API. P5 had named three; re-deriving found twenty.
--
-- The app is unaffected: it reads and writes these through `pg` / asyncpg as a
-- role that bypasses RLS, and its Supabase clients are used for sign-in only
-- (grep of app/, lib/, components/ for `.from(` on a Supabase client: none).
-- The pattern is 20260915060000's: RLS on, one read policy, writes denied.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'athlete_crosswalk', 'game_result', 'index_usage_snapshot', 'injury_report', 'job_locks',
    'mlb_pitch_events', 'model_status', 'nba_shot_events', 'nfl_target_events', 'nhl_shot_events',
    'odds_archive', 'odds_import_staging', 'player_history_prefix', 'player_history_summary',
    'prop_model_cache', 'prop_odds_archive', 'slate_rankings', 'team_name_index',
    'tennis_match_stats', 'venue_factors'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (true)', t || '_read', t);
  END LOOP;
END $$;

-- Nothing in public may be left without RLS.
DO $$ DECLARE missing text; BEGIN
  SELECT string_agg(c.relname, ', ') INTO missing
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'public tables still without RLS: %', missing;
  END IF;
END $$;
