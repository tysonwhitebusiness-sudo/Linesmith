-- The natural key must include event_ref: DOUBLEHEADERS ARE REAL.
--
-- Gate 4.3 found 4,022 "duplicate" natural keys, 805 of them MLB spread/home.
-- The sample was two different ESPN event ids (401704598, 401704603) on
-- 2025-03-25 with the same two teams -- an MLB doubleheader. Two real games,
-- not a duplicate. Collapsing them would silently discard one game's odds.
--
-- Where a source has no event id (SBR does not) the COALESCE keeps the old
-- behaviour, which is correct: SBR publishes one row per matchup per day.

DROP INDEX IF EXISTS odds_archive_natural_key;
CREATE UNIQUE INDEX IF NOT EXISTS odds_archive_natural_key
  ON odds_archive (sport, game_date, home_team_id, away_team_id, market, side,
                   COALESCE(bookmaker, ''), source, COALESCE(event_ref, ''))
  WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL;
