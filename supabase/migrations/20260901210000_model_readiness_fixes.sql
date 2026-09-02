-- The three training hazards gate 9 found, fixed. Only ONE of them was a data
-- defect; the other two are correct data that a naive query gets wrong, and
-- their fix is to make the correct query the easy one rather than to change
-- any rows.

-- ===========================================================================
-- 1. TENNIS: the same match indexed under two ESPN event ids. A REAL defect.
-- ===========================================================================
--
-- 7,196 duplicated player-matches, all written by a single backfill run on
-- 2026-08-29, and concentrated almost entirely in ONE season: 2022 alone
-- accounts for 2,655 of them while 2023-2026 have three between them. ESPN
-- listed those matches under two event ids from different id ranges (122316
-- alongside 94365) and the month-at-a-time sweep in
-- backfill_player_game_history.py picked up both.
--
-- THE DEDUPE KEY IS (athlete, date, OPPONENT, stats) -- NOT (athlete, date,
-- stats). That distinction matters and was nearly got wrong:
--
--     same stats + SAME opponent       ATP 3,832  WTA 3,364   <- duplicates
--     same stats + DIFFERENT opponent  ATP    50  WTA    65   <- REAL matches
--
-- 115 real second-matches-of-the-day happen to have identical stat lines,
-- because tennis stats are low-cardinality (sets won, games won, tiebreaks).
-- Deduping on stats alone would have deleted every one of them.
--
-- Keeps the lowest event_id, arbitrary but stable: the rows are identical in
-- every column that carries meaning.
DELETE FROM player_game_history a USING player_game_history b
WHERE a.sport LIKE 'tennis%'
  AND a.sport = b.sport
  AND a.athlete_id = b.athlete_id
  AND a.game_date = b.game_date
  AND a.opponent_id IS NOT DISTINCT FROM b.opponent_id
  AND a.stats = b.stats
  AND a.event_id::bigint > b.event_id::bigint;

-- ===========================================================================
-- 2. THE REAL KEY of player_game_history, asserted so it cannot drift.
-- ===========================================================================
--
-- `(sport, athlete_id, game_date)` is NOT a key, for three DIFFERENT and
-- entirely legitimate reasons -- which is why it must not be enforced:
--
--   MLB     doubleheaders: two real games, same day, same two teams.
--   NBA     game_date is the UTC date, so a late US game on the 9th and an
--           evening game on the 10th both land on 2026-04-10. Verified against
--           ESPN: 401811024 is Philadelphia at Houston (00:00Z) and 401811030
--           is Philadelphia at Indiana (23:30Z).
--   tennis  a player really can play twice in one day.
--
-- The key that IS real is (sport, athlete_id, event_id). Enforcing it stops a
-- genuine re-insert while leaving all three of the above alone.
CREATE UNIQUE INDEX IF NOT EXISTS player_game_history_key
  ON player_game_history (sport, athlete_id, event_id);

-- ===========================================================================
-- 3. CROSS-SOURCE DUPLICATION: not a defect, so nothing is deleted.
-- ===========================================================================
--
-- CFB has 20.2% of its games priced by two sources, EPL 9.5%, MLS 9.4%, NFL
-- 4.1%. Both rows are real prices from real books and both are worth keeping --
-- but pooling them without collapsing to one row per GAME over-weights exactly
-- the recent seasons where the sources happen to overlap, which are also the
-- seasons a model is most likely to be evaluated on.
--
-- `source_priority` already encodes the answer ("higher wins on conflict", see
-- the odds_archive migration). This view applies it, so the correct query is
-- the short one and the naive query is the one you have to write out by hand.
--
-- It also folds in the other two hazards for free: `NOT is_live` excludes the
-- 48,489 in-play rows, and the join to game_result excludes every future-dated
-- game because that table holds none.
CREATE OR REPLACE VIEW model_game_odds AS
WITH priced AS (
  SELECT o.sport, o.source, o.source_priority, o.game_date, o.home_team_id, o.away_team_id,
         o.event_ref, o.market, o.side,
         avg(o.line)  FILTER (WHERE o.line IS NOT NULL)  AS line,
         avg(CASE WHEN o.price > 0 THEN 100.0/(o.price+100.0)
                  ELSE (-o.price)/((-o.price)+100.0) END) AS implied,
         count(*)::int AS book_count
  FROM odds_archive o
  WHERE NOT o.is_live AND o.home_team_id IS NOT NULL
  GROUP BY 1,2,3,4,5,6,7,8,9
), ranked AS (
  -- One source per GAME, not per row: a game covered by both SBR and ESPN
  -- contributes once, from whichever source this repo rates higher.
  SELECT p.*, row_number() OVER (
           PARTITION BY p.sport, p.game_date, p.home_team_id, p.away_team_id, p.market, p.side
           ORDER BY p.source_priority DESC, p.book_count DESC, p.source
         ) AS src_rank
  FROM priced p
)
SELECT r.sport, r.source, r.game_date, r.home_team_id, r.away_team_id, r.event_ref,
       r.market, r.side, r.line, r.implied, r.book_count,
       g.home_score, g.away_score,
       (g.home_score > g.away_score) AS home_won
FROM ranked r
JOIN game_result g
  ON g.sport = r.sport AND g.source = r.source AND g.game_date = r.game_date
 AND g.home_team_id = r.home_team_id AND g.away_team_id = r.away_team_id
 AND COALESCE(g.event_ref,'') = COALESCE(r.event_ref,'')
WHERE r.src_rank = 1;

COMMENT ON VIEW model_game_odds IS
  'One row per (game, market, side) from the highest-priority source, joined to '
  'its result. Excludes in-play rows and future games by construction. Read '
  'this instead of odds_archive for anything that fits or evaluates a model.';
