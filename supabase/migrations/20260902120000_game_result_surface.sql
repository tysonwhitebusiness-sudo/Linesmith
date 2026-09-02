-- SURFACE AND COURT ON game_result -- the input the approved tennis model needs
-- and the only thing blocking it.
--
-- The 2026-09-02 pre-flight audit recorded tennis as blocked: the approved model
-- is SURFACE-WEIGHTED Elo, and surface was in neither `player_game_history.stats`
-- (8 keys, none of them surface) nor `odds_archive`. Without it the model drops
-- to plain Elo, which the operator's own model-selection artifact explicitly
-- rejected -- clay and grass are close to different sports, and one rating
-- averaged across them is wrong in both directions.
--
-- The data was never missing. tennis-data.co.uk ships `Surface` and `Court` in
-- every workbook already on disk, on 100% of 57,386 matches:
--
--     Surface   Hard 33,850   Clay 16,729   Grass 6,807
--     Court     Outdoor 50,295   Indoor 7,091
--
-- import_tennis.py deliberately dropped both, and said so in its own docstring:
-- "NOT loaded: surface, round, seed ranks and ranking points. There is no column
-- for them in either shared table, and inventing a per-sport tennis table would
-- invert the convention odds_archive's own migration argues for at length."
-- That reasoning was right, and it named the fix: a column on the shared table.
-- The same docstring notes the orientation is a pure function of the match key,
-- so a re-run re-derives exactly the same p1/p2 assignment and these land beside
-- the rows they belong to.
--
-- WHY game_result AND NOT odds_archive. Surface is a property of the EVENT, not
-- of a price -- putting it on odds_archive would repeat it across every book and
-- market row for the same match (tennis alone would carry it on 448,914 rows
-- instead of 56,386). game_result already holds exactly this kind of event
-- context in `venue`, one row per event, and `model_game_odds` joins odds to
-- game_result already, so the model reads surface through the join it is
-- already doing. No new join, no new table.
--
-- COURT IS NOT DECORATION. Indoor hard and outdoor hard play differently enough
-- that it is a real second factor, and it costs one more nullable column from a
-- file already being read. Both are nullable and both are tennis-only today;
-- any sport that later has a genuine surface can populate the same column
-- rather than adding a second one.

ALTER TABLE game_result ADD COLUMN IF NOT EXISTS surface text;
ALTER TABLE game_result ADD COLUMN IF NOT EXISTS court text;

-- The lookup the surface-weighted fit actually does: every completed match on
-- one surface for one sport, in date order. Partial because only tennis
-- populates it, so this indexes ~56k rows rather than all 172k+.
CREATE INDEX IF NOT EXISTS game_result_surface_lookup
  ON game_result (sport, surface, game_date)
  WHERE surface IS NOT NULL;
