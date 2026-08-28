-- Persisted historical player game logs, generic across sports — the
-- table the ~5hr background pull (game-based ingestion, ESPN scoreboard +
-- summary endpoints per docs/all-sports-prop-score-gameplan-2026-08-27.md)
-- writes into. Shape mirrors predict/generic_player_gamelog.py's
-- PlayerGameStat dataclass exactly (event_id, game_date, opponent_id,
-- is_home, stats) plus the identity columns a single per-athlete fetch
-- doesn't need but persisted, cross-player storage does (sport, athlete_id,
-- team_id, season). Built ahead of the pull finishing so
-- generic_prop_score.py's data-source swap (live ESPN fetch -> DB read)
-- is a small, planned change against a stable contract, not a rewrite.
CREATE TABLE IF NOT EXISTS player_game_history (
  id            BIGSERIAL PRIMARY KEY,
  sport         TEXT NOT NULL,
  athlete_id    TEXT NOT NULL,
  team_id       TEXT,
  season        INT NOT NULL,
  event_id      TEXT NOT NULL,
  game_date     DATE NOT NULL,
  opponent_id   TEXT,
  is_home       BOOLEAN NOT NULL,
  stats         JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sport, athlete_id, event_id)
);

-- Matches the windowed_stat.py access pattern: all of one player's games
-- for a sport, most-recent-first, optionally scoped to a season.
CREATE INDEX IF NOT EXISTS idx_player_game_history_lookup
  ON player_game_history (sport, athlete_id, season, game_date);
