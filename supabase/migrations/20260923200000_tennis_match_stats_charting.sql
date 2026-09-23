-- DJ-TEN follow-up: a second source for `tennis_match_stats`.
--
-- The Tennis Abstract Match Charting Project (Jeff Sackmann, CC BY-NC-SA 4.0)
-- is the only live source of WTA serve data, and the only ATP source after
-- TML-Database stalled on 2026-01-17. Its per-match "Overview" line carries
-- the serve and return counts but NOT the winner and NOT service games, so
-- those two columns can be null on a `source = 'mcp'` row. Readers that need
-- them (the surface record) filter on `won IS NOT NULL`.

ALTER TABLE tennis_match_stats ALTER COLUMN won DROP NOT NULL;

COMMENT ON TABLE tennis_match_stats IS
  'DJ-TEN: per-player per-match serve and return numbers. Sources: TML-Database (source=tml) and the Tennis Abstract Match Charting Project (source=mcp), both CC BY-NC-SA 4.0, based on Jeff Sackmann''s work — attribution required wherever shown. Written by tennisStatsJob (Python). One row per player per match; opp_* is the same match from the other end. mcp rows have no winner and no service-game count.';
