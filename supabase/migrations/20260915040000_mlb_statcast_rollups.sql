-- R5a (research pages): Statcast rollups the MLB player, team and game pages read.
--
-- WHY. `mlb_pitch_events` keeps five days in Postgres and whole seasons live only
-- in the Parquet corpus, which a page cannot read. These three tables hold the
-- season views the cards need, computed off the worker on the operator's machine
-- (`build_statcast_rollups.py`, after the corpus refresh). Python writes,
-- TypeScript reads them directly (CLAUDE.md pattern 2).
--
-- `payload` is the card's own shape, as in the G2 datasets the pages are rebuilt
-- to (`docs/design/phase-g2/data/`); the columns beside it are what a reader
-- filters or sorts on. Every row says what it is as of.

CREATE TABLE IF NOT EXISTS mlb_statcast_player_season (
    season        integer     NOT NULL,
    player_id     integer     NOT NULL,
    -- 'bat' = as a hitter (pitches seen), 'pit' = as a pitcher (pitches thrown).
    role          text        NOT NULL CHECK (role IN ('bat', 'pit')),
    -- Pitches through this date are included.
    as_of         date        NOT NULL,
    pitches       integer     NOT NULL,
    bip           integer     NOT NULL,
    -- Hitters: in the league-percentile pool. Pitchers: enough pitches for a location map.
    qualified     boolean     NOT NULL DEFAULT false,
    payload       jsonb       NOT NULL,
    computed_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (season, player_id, role)
);

CREATE TABLE IF NOT EXISTS mlb_statcast_team_season (
    season        integer     NOT NULL,
    -- StatsAPI team id, as text to match player_game_history.team_id.
    team_id       text        NOT NULL,
    -- 'bat' = the lineup, 'pit' = the staff.
    side          text        NOT NULL CHECK (side IN ('bat', 'pit')),
    as_of         date        NOT NULL,
    pitches       integer     NOT NULL,
    payload       jsonb       NOT NULL,
    computed_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (season, team_id, side)
);

-- One row per game, written before first pitch and then left alone, so a final
-- game's page keeps the research as it stood at kickoff.
CREATE TABLE IF NOT EXISTS mlb_statcast_game_pregame (
    game_pk       bigint      PRIMARY KEY,
    game_date     date        NOT NULL,
    season        integer     NOT NULL,
    -- Pitches through this date are included: the day before the game.
    as_of         date        NOT NULL,
    payload       jsonb       NOT NULL,
    computed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mlb_statcast_game_pregame_date_idx ON mlb_statcast_game_pregame (game_date);

-- Read-only to the app, same posture as the other sourcing tables: the service
-- role writes, everyone else reads.
ALTER TABLE mlb_statcast_player_season ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mlb_statcast_player_season_read ON mlb_statcast_player_season;
CREATE POLICY mlb_statcast_player_season_read ON mlb_statcast_player_season FOR SELECT USING (true);

ALTER TABLE mlb_statcast_team_season ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mlb_statcast_team_season_read ON mlb_statcast_team_season;
CREATE POLICY mlb_statcast_team_season_read ON mlb_statcast_team_season FOR SELECT USING (true);

ALTER TABLE mlb_statcast_game_pregame ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mlb_statcast_game_pregame_read ON mlb_statcast_game_pregame;
CREATE POLICY mlb_statcast_game_pregame_read ON mlb_statcast_game_pregame FOR SELECT USING (true);
