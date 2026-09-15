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

-- R5c: team shot views, from nba_shot_events and nhl_shot_events (regular
-- season only since R5c). One row per team, side ('for' = its own shots,
-- 'allowed' = its opponents'), and position group (NBA 'allowed' only), so a
-- team page reads a few rows instead of a season of shots. `payload` holds
-- G2's cells: NBA zones and 3-ft bins, NHL 5-ft bins and shot types, each as
-- [attempts, made or goals, points].
CREATE TABLE IF NOT EXISTS team_shot_profile (
    sport           text        NOT NULL,   -- 'nba' | 'nhl'
    season          integer     NOT NULL,   -- player_game_history's label (NBA end year, NHL start year)
    team_id         text        NOT NULL,
    side            text        NOT NULL CHECK (side IN ('for', 'allowed')),
    pos_group       text        NOT NULL,
    games           integer     NOT NULL,   -- views compare teams with 40+ games only
    payload         jsonb       NOT NULL,
    computed_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sport, season, team_id, side, pos_group)
);

ALTER TABLE team_shot_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_shot_profile_read ON team_shot_profile;
CREATE POLICY team_shot_profile_read ON team_shot_profile FOR SELECT USING (true);

-- R5d: where each NFL offense throws and where each defense is thrown at, from
-- nfl_target_events. The event names the offense only; the defense is the
-- other team in the game id ("2025_01_DAL_PHI"). One row per team, side and
-- receiver group ('all', WR/TE/RB on the defense side); `payload.cells` is
-- {"short|left": [targets, completions, air yards]} as in G2. The league total
-- is stored as team_id 'league'. Team ids are ESPN's.
CREATE TABLE IF NOT EXISTS team_target_profile (
    season          integer     NOT NULL,
    team_id         text        NOT NULL,
    side            text        NOT NULL CHECK (side IN ('offense', 'defense')),
    pos_group       text        NOT NULL,
    games           integer     NOT NULL,
    payload         jsonb       NOT NULL,
    computed_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (season, team_id, side, pos_group)
);

ALTER TABLE team_target_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_target_profile_read ON team_target_profile;
CREATE POLICY team_target_profile_read ON team_target_profile FOR SELECT USING (true);
