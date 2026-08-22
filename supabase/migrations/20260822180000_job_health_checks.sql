-- Phase 04 of docs/four-feature-gameplan-2026-08-22.md: structured
-- persistence for health_check.py's check_* results, which today only
-- ever get print()'d (confirmed zero persistence anywhere before this).
-- One row per check, upserted by check_name — same "keep latest, don't
-- grow unbounded" pattern as game_odds_history's own dedup (see
-- CLAUDE.md's backend section), not an append-only log: a human/UI only
-- ever needs each check's current state, not its full history.
CREATE TABLE IF NOT EXISTS job_health_checks (
  check_name  TEXT PRIMARY KEY,
  healthy     BOOLEAN NOT NULL,
  status      TEXT NOT NULL,
  detail      JSONB,
  checked_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_health_checks_healthy ON job_health_checks (healthy);
