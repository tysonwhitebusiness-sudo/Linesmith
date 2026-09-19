-- R12a (research pages, deep history): team-id indexes on game_result.
--
-- WHY. Deep history reads "every game this franchise played" and "every
-- meeting of these two teams" across up to 27 seasons. game_result (185,327
-- rows, measured 2026-09-18) is indexed on (sport, game_date), source, a
-- raw-name natural key and a tennis surface lookup — nothing on the team ids,
-- so each of those reads scanned the whole sport.
--
-- OWNERSHIP. game_result is Python-owned (db.py writes it). An index adds no
-- writer and changes no write path; recorded in docs/table-ownership.md.
CREATE INDEX IF NOT EXISTS game_result_home_team ON game_result (sport, home_team_id, game_date);
CREATE INDEX IF NOT EXISTS game_result_away_team ON game_result (sport, away_team_id, game_date);
