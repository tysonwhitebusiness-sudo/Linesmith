-- M1 (master gameplan): what each sport's model is, and what a page may say.
--
-- WHY. "Which model is real" lived across plan documents and nothing in the app
-- could read it, so every surface decided for itself what to render. This is
-- the one place, mirrored from `src/model_status.py` by `modelStatusJob` and
-- read by TypeScript through /api/model-status (CLAUDE.md pattern 2: Python
-- writes, TypeScript renders).
--
-- The status drives the display rule:
--   gated     may show a probability beside the market's implied probability
--   baseline  a pick and a projection only — no probability beside a price,
--             no record framed as a track record, never an edge
--   failed/none  nothing; the section hides and says why
--
-- `gate_*` travels with the row so the promotion job (M4) can re-run the test
-- that would move it, rather than that criterion living in a document.

CREATE TABLE IF NOT EXISTS model_status (
    sport           text        NOT NULL,
    kind            text        NOT NULL,           -- 'game' | 'prop'
    engine          text,                           -- the module that serves it; NULL when none
    status          text        NOT NULL,
    evidence        text        NOT NULL,           -- the measurement behind the status, with its date
    since           date        NOT NULL,
    fitted_at       date,                           -- when its numbers were last fitted, if ever
    notes           text,
    gate_test       text,
    gate_criteria   text,
    gate_min_sample integer,
    checked_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sport, kind),
    CONSTRAINT model_status_kind_valid CHECK (kind IN ('game', 'prop')),
    CONSTRAINT model_status_status_valid CHECK (status IN ('none', 'baseline', 'gated', 'failed'))
);

COMMENT ON TABLE model_status IS
  'M1: one row per sport x kind. Written by modelStatusJob from model_status.py; read by /api/model-status. The status decides what a page may claim.';

-- Both the generic Elo baseline and MLB''s own ensemble write game_picks, told
-- apart only by sport. A source column makes that explicit, so no later query
-- can average a validated model with an unvalidated one.
ALTER TABLE game_picks ADD COLUMN IF NOT EXISTS source text;

UPDATE game_picks
   SET source = CASE WHEN sport = 'mlb' THEN 'mlb_ensemble' ELSE 'generic_elo' END
 WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS game_picks_source_idx ON game_picks (source, sport, commence_time DESC);

-- M4's promotion test records what it measured on the row it judged, including
-- the runs that could not run and why — a gate that cannot run has not passed.
ALTER TABLE model_status ADD COLUMN IF NOT EXISTS gate_result text;
ALTER TABLE model_status ADD COLUMN IF NOT EXISTS gate_sample integer;
ALTER TABLE model_status ADD COLUMN IF NOT EXISTS gate_checked_at timestamptz;
