-- M3 (master gameplan): the Slate's odds-free rankings.
--
-- WHY. The Slate's Specials rank players for the promos books run — longest
-- home run, most strikeouts, pick-3 anytime TD — from the player and the
-- circumstances, with no odds involved. That is model-shaped work, so it lives
-- in Python (CLAUDE.md) and the page only renders it.
--
-- FROZEN BEFORE FIRST PITCH, which is the whole point of storing it rather than
-- computing it on the page. A ranking recomputed after the games would quietly
-- grade itself against what already happened; receipts built that way are
-- worthless. Each row is refreshed until its sport's first game starts, then
-- `frozen_at` is stamped and it never changes again. `outcome` is filled the
-- next morning from what actually happened.
--
-- `factors` holds every column the card shows, with its value and its percentile
-- over that day's pool, so the page renders the table and the "why" line without
-- recomputing anything.

CREATE TABLE IF NOT EXISTS slate_rankings (
    sport        text        NOT NULL,
    slate_date   date        NOT NULL,
    ranking_id   text        NOT NULL,   -- 'mlb-hr-of-the-day', 'nfl-anytime-td', …
    subject_id   text        NOT NULL,
    rank         integer     NOT NULL,
    score        double precision,        -- 0-100, the mean of the factor percentiles
    subject_name text,
    team         text,
    opponent     text,
    game_id      text,
    factors      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    frozen_at    timestamptz,             -- NULL while the slate is still ahead of us
    outcome      jsonb,                   -- what actually happened, filled the next morning
    computed_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sport, slate_date, ranking_id, subject_id)
);

CREATE INDEX IF NOT EXISTS slate_rankings_read_idx
    ON slate_rankings (sport, slate_date, ranking_id, rank);

-- The grading pass looks for frozen rows from yesterday that have no outcome yet.
CREATE INDEX IF NOT EXISTS slate_rankings_grading_idx
    ON slate_rankings (slate_date, frozen_at)
    WHERE outcome IS NULL;

COMMENT ON TABLE slate_rankings IS
  'M3: the Slate''s odds-free rankings. Written by slateRankingsJob (Python) and frozen at the sport''s first start; read by /api/slate. Graded into outcome the next morning.';
