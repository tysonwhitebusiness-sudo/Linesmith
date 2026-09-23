-- DJ-TEN: per-player, per-match tennis serve and return numbers.
--
-- WHY A TABLE AND NOT A JOIN. `player_game_history` holds tennis matches
-- already, but only sets, games and who won (measured 2026-09-22: its `stats`
-- blob is sets_won/games_won/match_won/tiebreaks_played and nothing else).
-- Aces, double faults, service points, service games and break points are not
-- in any feed this app reads, and they are what "Serve vs return" is made of.
--
-- WHAT A ROW IS: one player's side of one match. The player's own serve line
-- is `ace`…`bp_faced`; the SAME match's other side is repeated as `opp_*`,
-- which is that player's RETURN context — a return game is just the
-- opponent's service game seen from the other end. Storing both sides on the
-- row means a return card needs no self-join, at the cost of each match
-- appearing twice. That is the trade this table exists to make: it is read
-- per player, always.
--
-- WHAT IS NOT HERE, DELIBERATELY:
--   * surface. `game_result` has carried `surface`/`court` for both tours
--     since migration 20260902120000 (ATP 29,119 rows, WTA 27,267, back to
--     2015), so a Surface record reads from there. The gameplan's correction 6
--     said surface was held nowhere; it was written before that load.
--     `surface` IS copied onto this row anyway, because the source gives it
--     free and a serve line split by surface is the point of holding both.
--   * hold % and break %. Derived, not stored: a service game is lost exactly
--     when a break point is faced and not saved (a converted break point ends
--     the game, so `bp_faced - bp_saved` counts GAMES, not points). Storing a
--     derived rate would freeze that derivation into the data.
--
-- IDENTITY. `athlete_id` is the ESPN athlete id, the same one
-- `player_game_history` and every tennis page use, resolved through
-- `athlete_crosswalk` (task 6.32). A match whose player cannot be resolved is
-- NOT written: a serve line attached to the wrong person is worse than one
-- that is missing.

CREATE TABLE IF NOT EXISTS tennis_match_stats (
    sport          text    NOT NULL,          -- 'tennis_atp' | 'tennis_wta'
    athlete_id     text    NOT NULL,          -- ESPN athlete id
    tourney_id     text    NOT NULL,
    match_num      integer NOT NULL,
    opponent_id    text,                      -- ESPN id, NULL when unresolved
    match_date     date    NOT NULL,
    season         integer NOT NULL,
    tourney_name   text,
    surface        text,                      -- 'Hard' | 'Clay' | 'Grass' | 'Carpet'
    indoor         boolean,
    tourney_level  text,
    round          text,
    best_of        integer,
    minutes        integer,
    won            boolean NOT NULL,

    -- This player's serve.
    ace            integer,
    df             integer,
    svpt           integer,                   -- service points played
    first_in       integer,
    first_won      integer,
    second_won     integer,
    sv_gms         integer,                   -- service games played
    bp_saved       integer,
    bp_faced       integer,

    -- The opponent's serve, i.e. this player's return.
    opp_ace        integer,
    opp_df         integer,
    opp_svpt       integer,
    opp_first_in   integer,
    opp_first_won  integer,
    opp_second_won integer,
    opp_sv_gms     integer,
    opp_bp_saved   integer,
    opp_bp_faced   integer,

    source         text    NOT NULL,          -- 'tml'
    ingested_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sport, athlete_id, tourney_id, match_num)
);

-- Every read is "this player, recently, maybe on this surface".
CREATE INDEX IF NOT EXISTS tennis_match_stats_player_idx
    ON tennis_match_stats (sport, athlete_id, match_date DESC);

CREATE INDEX IF NOT EXISTS tennis_match_stats_surface_idx
    ON tennis_match_stats (sport, athlete_id, surface, match_date DESC);

COMMENT ON TABLE tennis_match_stats IS
  'DJ-TEN: per-player per-match serve and return numbers from TML-Database (CC BY-NC-SA, based on Jeff Sackmann''s work). Written by tennisStatsJob (Python); read by the tennis spotlights and player pages. One row per player per match; opp_* is the same match from the other end.';
