-- The name lookup `getGolfShotProfile` runs. Case-insensitive because the two
-- feeds do not agree on capitalisation, and the id spaces do not join at all.
CREATE INDEX IF NOT EXISTS golf_shot_events_player_name_idx
  ON golf_shot_events (lower(player_name));
