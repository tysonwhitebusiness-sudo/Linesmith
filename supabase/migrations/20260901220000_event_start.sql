-- WITHOUT A GAME START TIME, CLV CANNOT BE MEASURED ON PROPS.
--
-- The prop archive did not capture one price per prop. It captured many:
-- measured 2026-09-01, MLB averages 15.1 distinct timestamps per event across
-- a 16-hour window, NFL 36.6 across 106 hours. That is genuinely useful — it is
-- real line movement — but it means "the price" for a prop is not one number,
-- and the one that matters for closing-line value is the LAST OBSERVATION
-- BEFORE THE GAME STARTED.
--
-- Which cannot be identified, because `game_date` is a bare date. A prop
-- observed at 23:40 UTC on the game's own date might be twenty minutes before a
-- 00:00 first pitch or four hours after a 19:00 one.
--
-- The information was never missing from the source. ESPN's CSVs carry
-- `event_date` as a full timestamp — `2025-03-27T19:00Z` — and both loaders
-- truncated it with `[:10]` on the way in. So this is a recoverable loss:
-- preserve the timestamp and re-import.
--
-- `game_date` stays exactly as it is. Every existing key, index, gate and join
-- depends on it, and the local-vs-UTC date offsets that were derived per sport
-- (NHL props join to player history at -1 day) are all expressed in it. This
-- column is added ALONGSIDE, never as a replacement.

ALTER TABLE odds_archive        ADD COLUMN IF NOT EXISTS event_start timestamptz;
ALTER TABLE odds_import_staging ADD COLUMN IF NOT EXISTS event_start timestamptz;
ALTER TABLE prop_odds_archive   ADD COLUMN IF NOT EXISTS event_start timestamptz;
ALTER TABLE game_result         ADD COLUMN IF NOT EXISTS event_start timestamptz;

-- The closing-price lookup this exists to serve: for one prop, the last
-- observation strictly before the game began.
CREATE INDEX IF NOT EXISTS prop_odds_archive_close_lookup
  ON prop_odds_archive (sport, event_ref, athlete_id, type_name, last_updated)
  WHERE event_start IS NOT NULL;

CREATE INDEX IF NOT EXISTS odds_archive_event_start
  ON odds_archive (sport, event_start) WHERE event_start IS NOT NULL;
