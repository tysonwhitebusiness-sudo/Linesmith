-- THE ARCHIVAL BRIDGE — what makes the training archive stop being a snapshot.
--
-- Measured 2026-09-02: 100% of odds_archive, prop_odds_archive and game_result
-- rows were written by a single import. Nothing writes them on a schedule. The
-- live JOB_REGISTRY jobs write prop_odds and game_odds_book_lines, which NO
-- MODEL READS. So the training set is frozen at 2026-09-01, every model trained
-- on it decays from its first day, and no backtest can ever include a game
-- played after the import.
--
-- This migration adds the two columns the bridge needs. The jobs themselves are
-- archiveClosingLinesJob and archiveResultsJob.

-- ---------------------------------------------------------------------------
-- 1. captured_at — WHEN a price was observed, as opposed to when its game runs.
-- ---------------------------------------------------------------------------
--
-- Without this, capture quality is unmeasurable: a "closing line" recorded 30
-- minutes before kickoff looks identical to one recorded 30 seconds before, and
-- both look identical to one recorded after the game started. That is not a
-- hypothetical — the imported prop archive's `last_updated` turned out to be a
-- record-modified timestamp ESPN touches at settlement, and distinguishing that
-- from a real quote time took a Brier-score comparison against outcomes rather
-- than a simple query.
--
-- `event_start - captured_at` is the health metric for the whole bridge, and
-- health_check's captureLatency reads exactly that.
ALTER TABLE odds_archive      ADD COLUMN IF NOT EXISTS captured_at timestamptz;
ALTER TABLE prop_odds_archive ADD COLUMN IF NOT EXISTS captured_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. bookmaker on prop_odds_archive — the archive was never per-book.
-- ---------------------------------------------------------------------------
--
-- prop_odds_archive's natural key is
--   (sport, event_ref, athlete_id, type_name, line, source)
-- with NO bookmaker, because the ESPN import stored one already-aggregated row
-- per prop. The LIVE table (prop_odds) is per-book, and the model plan needs
-- per-book two-sided prices to de-vig at all — so archiving live props under
-- the old key would collapse every book into one row and silently keep whichever
-- arrived last.
--
-- Historical rows keep bookmaker NULL, which is honest: they genuinely are not
-- attributable to one book. COALESCE in the index below means those rows still
-- occupy exactly one slot each, so nothing existing moves or de-duplicates.
ALTER TABLE prop_odds_archive ADD COLUMN IF NOT EXISTS bookmaker text;

-- Replace the natural key with one that admits a bookmaker dimension. Built
-- CONCURRENTLY-free on purpose: this runs as a migration against a table of
-- ~1.8M rows, and a plain index build is measured in seconds at that size,
-- whereas CONCURRENTLY cannot run inside the migration transaction.
DROP INDEX IF EXISTS prop_odds_archive_natural_key;
CREATE UNIQUE INDEX IF NOT EXISTS prop_odds_archive_natural_key
  ON prop_odds_archive (
    sport, event_ref, COALESCE(athlete_id, ''), type_name,
    COALESCE(line, -9999::double precision), source, COALESCE(bookmaker, '')
  );

-- ---------------------------------------------------------------------------
-- 3. The lookups the bridge and its monitoring actually perform.
-- ---------------------------------------------------------------------------

-- archiveClosingLinesJob's freeze predicate is `WHERE event_start > now()`, so
-- it scans the not-yet-started rows for one sport on every cycle.
CREATE INDEX IF NOT EXISTS odds_archive_unstarted
  ON odds_archive (sport, event_start)
  WHERE event_start IS NOT NULL AND captured_at IS NOT NULL;

-- captureLatency reads the distribution of (event_start - captured_at) per
-- sport over a recent window.
CREATE INDEX IF NOT EXISTS odds_archive_capture_latency
  ON odds_archive (sport, captured_at)
  WHERE captured_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS prop_odds_archive_capture_latency
  ON prop_odds_archive (sport, captured_at)
  WHERE captured_at IS NOT NULL;
