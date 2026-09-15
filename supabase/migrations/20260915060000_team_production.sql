-- R5b (research pages): strength rollups from player_game_history.
--
-- WHY. The game page's "strength vs strength", the team page's key players and
-- roster production, and compare's "what this team allows to the position" all
-- need per-team totals for and allowed. Reading a league's game logs on each
-- page load is what the plan rules out; these tables hold the totals, written
-- by `teamProductionJob` (Python) from `player_game_history`, and read directly
-- by TypeScript (CLAUDE.md pattern 2).
--
-- `player_game_history` carries no position (measured 2026-09-14: no key in any
-- sport's stats), so positions get their own table.

-- One row per athlete per sport. Positions come from nflverse players.csv (NFL),
-- ESPN rosters (NBA, soccer) and api-web rosters (NHL); a player keeps the last
-- position seen, since a roster only lists current players.
CREATE TABLE IF NOT EXISTS athlete_positions (
    sport           text        NOT NULL,
    athlete_id      text        NOT NULL,   -- the id player_game_history uses for this sport
    position        text,                   -- as the source spells it (WR, PG, D, M)
    position_group  text,                   -- the group "allowed to the position" rolls up by; NULL = none
    source          text        NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sport, athlete_id)
);

-- One row per team per game per position group ('all' is every player). The
-- ALLOWED side of team T is the rows whose opponent_id is T, so a date cutoff
-- ("as of kickoff") is a SUM over game_date, and league ranks are a GROUP BY.
CREATE TABLE IF NOT EXISTS team_game_production (
    sport           text        NOT NULL,
    season          integer     NOT NULL,   -- player_game_history's season label for this sport
    event_id        text        NOT NULL,
    game_date       date        NOT NULL,
    team_id         text        NOT NULL,
    opponent_id     text        NOT NULL,
    -- 'all', a position group, 'other' (a position outside every group, e.g. an
    -- NFL lineman) or 'unknown' (no position on record)
    pos_group       text        NOT NULL,
    players         integer     NOT NULL,
    stats           jsonb       NOT NULL,   -- summed stat keys (teamProduction.ROLL_KEYS)
    computed_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sport, event_id, team_id, pos_group)
);

CREATE INDEX IF NOT EXISTS team_game_production_season_idx
    ON team_game_production (sport, season, pos_group, game_date);

-- One row per player per team per season: production score (a per-sport weighted
-- sum, never games played, which ranked punters as key players) and the share of
-- the team's production.
CREATE TABLE IF NOT EXISTS player_season_production (
    sport           text        NOT NULL,
    season          integer     NOT NULL,
    athlete_id      text        NOT NULL,
    team_id         text        NOT NULL,
    games           integer     NOT NULL,
    score           double precision NOT NULL,
    score_per_game  double precision NOT NULL,
    team_share      double precision,       -- 0-1 of the team's summed score
    position        text,
    position_group  text,
    stats           jsonb       NOT NULL,
    last_game_date  date        NOT NULL,
    computed_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sport, season, athlete_id, team_id)
);

CREATE INDEX IF NOT EXISTS player_season_production_team_idx
    ON player_season_production (sport, season, team_id, score_per_game DESC);

ALTER TABLE athlete_positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS athlete_positions_read ON athlete_positions;
CREATE POLICY athlete_positions_read ON athlete_positions FOR SELECT USING (true);

ALTER TABLE team_game_production ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_game_production_read ON team_game_production;
CREATE POLICY team_game_production_read ON team_game_production FOR SELECT USING (true);

ALTER TABLE player_season_production ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS player_season_production_read ON player_season_production;
CREATE POLICY player_season_production_read ON player_season_production FOR SELECT USING (true);
