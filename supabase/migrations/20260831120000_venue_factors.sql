-- Venue scoring factors for the sports that are not baseball — Phase 6.10.
--
-- ============ WHY A NEW TABLE AND NOT A COLUMN ON park_factors ============
--
-- `park_factors` is keyed `(venue_id, season)` and holds 542 MLB rows. The
-- obvious move for "park factors beyond MLB" is a `sport` column on it. That
-- would be wrong, because the key cannot be filled: measured 2026-08-31, a
-- tree-wide scan for a venue column found exactly two in the whole database,
-- and both of them are on `park_factors` itself. **No other sport stores a
-- venue per historical game at all.**
--
-- What every sport does store is `player_game_history.is_home`. In every league
-- except baseball a team plays its home games in one building for a season, so
-- the home TEAM identifies the venue. That is a different key, and giving it
-- its own table is more honest than a `venue_id` column that silently means
-- "team id" on six sports out of seven.
--
-- `park_factors` is left exactly as it is. MLB keeps a real venue key because
-- MLB genuinely has one.
--
-- ============ THE FACTOR IS THE CLASSIC HOME/ROAD RATIO ============
--
-- factor = (scoring per game in this team's HOME games)
--          / (scoring per game in this team's AWAY games)
--
-- Both totals count BOTH teams' scoring, which is what makes it a statement
-- about the building rather than about the home side: the same team appears in
-- the numerator and the denominator, so its own quality largely cancels. A
-- factor of 1.10 means this venue produced ten percent more scoring than the
-- same team's road games did.
--
-- It is a season-level number and a noisy one at small game counts, which is
-- why `home_games`/`away_games` travel with it — a caller that will not show a
-- factor off fifteen games needs to be able to tell.

CREATE TABLE IF NOT EXISTS venue_factors (
  -- `player_game_history`'s own vocabulary: nba, nhl, cfb, nfl, soccer_epl,
  -- soccer_mls, tennis_atp, tennis_wta. NOT the page's ('soccer', 'tennis') —
  -- the same mismatch CURRENT.md flags as having cost a wrong assertion once.
  sport          text    NOT NULL,
  -- The HOME team, which is the venue. Text because team ids are numeric in
  -- some sports and prefixed strings in others, and this only ever joins back
  -- to `player_game_history.team_id`, which is itself text.
  team_id        text    NOT NULL,
  season         integer NOT NULL,
  -- Which stat the factor is about — 'points', 'goals', 'totalGoals'. A venue
  -- can play big for goals and neutral for cards, so the stat is part of the
  -- key rather than an assumption.
  stat_key       text    NOT NULL,
  factor         double precision NOT NULL,
  home_rate      double precision NOT NULL,
  away_rate      double precision NOT NULL,
  home_games     integer NOT NULL,
  away_games     integer NOT NULL,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sport, team_id, season, stat_key)
);

-- The read path is always "this team, this season, this stat", and the writer
-- upserts the same key, so the primary key is the only index this needs.
COMMENT ON TABLE venue_factors IS
  'Home/road scoring ratio per team-season, the non-MLB analogue of park_factors. Keyed by home team because no sport but MLB stores a venue per game (Phase 6.10).';
