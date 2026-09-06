-- Phase 5.2 — allow a crosswalk row that asserts a NAME without asserting an
-- ESPN MAPPING.
--
-- The board ranks players out of `player_game_history`, which for MLB is keyed
-- by MLB StatsAPI id, and it needs a name for each. `athlete_crosswalk` is the
-- only place names live, but its builder enumerates candidates from
-- `prop_odds_archive`'s ESPN ids — so a player who has never had a prop line
-- posted is never a candidate and never gets a row. Measured: 618 of 1,777
-- players with 2025+ history, which is the whole of the 14-17% slate gap.
--
-- Those players' MLB ids are already authoritative (they came from MLB's own
-- API), so their names need no MATCHING at all — one lookup against MLB
-- StatsAPI's people endpoint answers it exactly. What was missing was a way to
-- record that without lying about an ESPN id we do not have.
--
-- NULL espn_athlete_id now means precisely "we know who this player is, we have
-- no ESPN mapping for them". Nothing breaks: every existing consumer joins
-- `espn_athlete_id = <some id>`, and NULL never matches that, so name-only rows
-- are invisible to the prop-side path and visible only to name lookups.
ALTER TABLE athlete_crosswalk ALTER COLUMN espn_athlete_id DROP NOT NULL;

COMMENT ON COLUMN athlete_crosswalk.espn_athlete_id IS
  'ESPN athlete id, or NULL for a name-only row (match_method '
  '''mlb_api_name_only'') that asserts identity without an ESPN mapping.';
