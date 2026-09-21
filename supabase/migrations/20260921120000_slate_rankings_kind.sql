-- PY-A (C5 + F0's Python half): one table for the Slate's Specials AND the
-- sport-specific Spotlights.
--
-- `kind` says which surface a ranking belongs to. A Special answers a book's
-- promo ("HR of the day") and is graded the next morning; a Spotlight is a
-- research flag ("targets vs weak pass defences") that the player, team and
-- game pages chip. Both are the same shape - a frozen, factor-scored list - so
-- they share the writer, the freeze and the receipts instead of growing a
-- second table.
--
-- `team_id` / `opponent_id` are the ids the research pages route on. `team` and
-- `opponent` stay as the abbreviations the card prints; a chip on a team page
-- cannot match on an abbreviation that differs by sport.
--
-- Grading also writes one row per graded "longest" ranking with
-- subject_id = '__leader__' and rank 0: the slate's actual leader, ranked by us
-- or not. Readers skip it as a subject.

ALTER TABLE slate_rankings ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'special';
ALTER TABLE slate_rankings ADD COLUMN IF NOT EXISTS team_id text;
ALTER TABLE slate_rankings ADD COLUMN IF NOT EXISTS opponent_id text;

ALTER TABLE slate_rankings DROP CONSTRAINT IF EXISTS slate_rankings_kind_check;
ALTER TABLE slate_rankings ADD CONSTRAINT slate_rankings_kind_check CHECK (kind IN ('special', 'spotlight'));

-- The flags read (F0-UI) looks a player or team up across today's rankings.
CREATE INDEX IF NOT EXISTS slate_rankings_subject_idx ON slate_rankings (slate_date, subject_id);
CREATE INDEX IF NOT EXISTS slate_rankings_team_idx ON slate_rankings (slate_date, team_id) WHERE team_id IS NOT NULL;
