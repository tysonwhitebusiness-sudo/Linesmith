-- Task 6.28 -- the ATHLETE crosswalk. The team-id equivalent lives in
-- python-odds-service/import_odds_staging.py; this is the same problem one
-- level down and it is worth exactly as much paranoia.
--
-- WHY THIS TABLE EXISTS
--
-- prop_odds_archive carries ESPN athlete ids, because every prop row in it was
-- scraped from ESPN. player_game_history carries a DIFFERENT id per sport,
-- because game_context.py loads each sport from whichever API is authoritative
-- for it:
--
--   nba, nfl, cfb, soccer_epl, soccer_mls   ESPN's athlete id IS our athlete id
--   mlb                                     MLB StatsAPI ids (6 digits)
--   nhl                                     NHL API ids (7 digits)
--
-- So 1.3M MLB and NHL prop rows resolve to a player at 0.0% while every other
-- sport sits at 86-100%. This table closes that, and it covers ALL seven
-- sports -- including the five where the mapping is the identity -- so a
-- consumer joins through one table with no per-sport branch. That is the same
-- reasoning the sport-adapter architecture applies in CLAUDE.md: the place to
-- put a per-sport difference is in data, not in an `if sport ===` at the point
-- of use.
--
-- HOW A ROW EARNS ITS PLACE
--
-- `match_method` records what actually proved the pair, and it is never a
-- numeric-id coincidence. 30 of 39 ESPN NHL TEAM ids "matched"
-- player_game_history and every single match was wrong -- the NHL API calls
-- Toronto 10, ESPN calls Montreal 10. So:
--
--   identity          the two id systems are the same system (the five sports
--                     above). Not a match at all; an assertion that no mapping
--                     is needed.
--   name_and_dob      normalized name AND date of birth agree across the two
--                     APIs. Names collide; birth dates do not.
--   name_unique       name agrees and is unique on both sides, but one side
--                     published no date of birth.
--
-- `verified_game_date` is the part that matters: a REAL date on which this
-- athlete demonstrably played, confirmed on the OUR-ID side independently of
-- the name that produced the match. A crosswalk row without one is a
-- hypothesis. NULL is allowed (not every athlete has a checkable game in the
-- window) but the gate asserts a floor on the share that carry one.

CREATE TABLE IF NOT EXISTS athlete_crosswalk (
  id                 bigserial PRIMARY KEY,
  sport              text NOT NULL,
  espn_athlete_id    text NOT NULL,
  athlete_id         text NOT NULL,   -- ours: whatever player_game_history uses
  athlete_name       text,
  birth_date         date,
  match_method       text NOT NULL,
  verified_game_date date,
  built_at           timestamptz NOT NULL DEFAULT now()
);

-- One ESPN id maps to one of ours, per sport.
CREATE UNIQUE INDEX IF NOT EXISTS athlete_crosswalk_espn_key
  ON athlete_crosswalk (sport, espn_athlete_id);
-- ...and the reverse must be a function too: two ESPN ids collapsing onto one
-- of our athletes is the exact failure mode that filed Montreal under Toronto.
CREATE UNIQUE INDEX IF NOT EXISTS athlete_crosswalk_ours_key
  ON athlete_crosswalk (sport, athlete_id);
CREATE INDEX IF NOT EXISTS athlete_crosswalk_lookup
  ON athlete_crosswalk (sport, athlete_id);
