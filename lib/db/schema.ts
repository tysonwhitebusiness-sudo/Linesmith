/**
 * SQLite schema. Applied on first connection and safe to re-run — every
 * statement is CREATE ... IF NOT EXISTS, so this doubles as the migration path
 * for a local single-user database.
 */

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Legs the user has added to their slip. Persisted so the slip survives a
-- restart, which is the concrete upgrade over the browser-artifact version.
CREATE TABLE IF NOT EXISTS picks (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sport              TEXT    NOT NULL,
  subject_id         TEXT    NOT NULL,
  subject_name       TEXT    NOT NULL,
  dimension          TEXT    NOT NULL,
  dimension_label    TEXT    NOT NULL,
  category           TEXT    NOT NULL,
  category_label     TEXT    NOT NULL,
  -- The threshold the pick is measured against (e.g. Over 5.5) — added for
  -- the bet-detail/live-bets rework, so a submitted bet has something to
  -- break the line down against. Nullable: categorical dimensions (a golf
  -- birdie) have no threshold, same as PickCandidate.line upstream.
  line               REAL,
  -- Which game this leg's subject is playing in, captured from the
  -- candidate's own subjectMeta.gamePk at add time — needed to poll live
  -- stats and to grade the bet once the game is final. Nullable: not every
  -- candidate carries a gamePk (e.g. season-long markets).
  game_id            TEXT,
  -- Team/opponent identity, captured from the candidate's own subjectMeta at
  -- add time — lets the slip/bet-detail/live-bets views render team logos
  -- and a real matchup line instead of just the bare dimension label.
  -- team_id/opponent_id drive mlbTeamLogoUrl(); subject_id above already
  -- drives mlbHeadshotUrl() the same way, so no separate image-URL columns
  -- are needed. Nullable: game-level (moneyline/total) and non-MLB
  -- candidates don't carry these.
  team_id            INTEGER,
  team               TEXT,
  opponent_id        INTEGER,
  opponent           TEXT,
  american_odds      TEXT,
  odds_source        TEXT,
  odds_captured_at   TEXT,
  -- Which sportsbook the price came from (e.g. 'draftkings'), for BookLogo —
  -- distinct from odds_source, which records the data provider/aggregator,
  -- not the book itself. Nullable: manual/screenshot odds have no book.
  bookmaker          TEXT,
  event_context      TEXT,
  sample_size        INTEGER,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (sport, subject_id, dimension, category)
);

CREATE INDEX IF NOT EXISTS idx_picks_sport ON picks (sport);

-- Bets the user has submitted off their slip — a distinct, append-mostly
-- lifecycle from 'picks' (which stays the editable, pre-submit slip).
-- Submitting copies a pick's row here and deletes it from 'picks', so a
-- submitted bet survives the slip being cleared. One row per submitted leg;
-- status starts 'pending' and is settled by the same read-time grading
-- pattern lib/odds/props/grading.ts already uses for 'pick_history' —
-- checked against the live/final box score for 'game_id' once a game is
-- live or final, via lib/odds/props/betGrading.ts.
CREATE TABLE IF NOT EXISTS bets (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sport              TEXT    NOT NULL,
  subject_id         TEXT    NOT NULL,
  subject_name       TEXT    NOT NULL,
  dimension          TEXT    NOT NULL,
  dimension_label    TEXT    NOT NULL,
  category           TEXT    NOT NULL,
  category_label     TEXT    NOT NULL,
  line               REAL,
  game_id            TEXT,
  team_id            INTEGER,
  team               TEXT,
  opponent_id        INTEGER,
  opponent           TEXT,
  american_odds      TEXT,
  odds_source        TEXT,
  bookmaker          TEXT,
  event_context      TEXT,
  sample_size        INTEGER,
  submitted_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  status             TEXT    NOT NULL DEFAULT 'pending', -- 'pending' | 'live' | 'won' | 'lost' | 'push'
  actual_value       REAL,
  settled_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_bets_sport ON bets (sport, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_bets_open_by_game ON bets (game_id) WHERE status IN ('pending', 'live');

CREATE TABLE IF NOT EXISTS watchlist (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sport        TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (sport, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_sport ON watchlist (sport);

-- Log of what the scan surfaced, so "did this actually hit" can be answered
-- later — Phase C's outcome-grading + calibration foundation. One row per
-- (sport, subject, dimension, category, game): repeated snapshot refreshes
-- during the same game day must not create duplicate rows, since the point
-- is one grade per real proposition, not one row per refresh cycle.
CREATE TABLE IF NOT EXISTS pick_history (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sport              TEXT NOT NULL,
  subject_id         TEXT NOT NULL,
  subject_name       TEXT NOT NULL,
  dimension          TEXT NOT NULL,
  category           TEXT NOT NULL,
  market_key         TEXT,
  line               REAL,
  game_id            TEXT,
  sample_size        INTEGER,
  distance           INTEGER,
  event_context      TEXT,
  surfaced_at        TEXT NOT NULL DEFAULT (datetime('now')),
  -- Model vs. market snapshot at surface time (Phase C.1) — nullable because
  -- C.0's grading has value on its own before the edge model exists.
  model_prob         REAL,
  market_prob        REAL,
  edge                REAL,
  price_source       TEXT,
  bookmaker          TEXT,
  price_captured_at  TEXT,
  -- Grading (Phase C.0), filled in once the game is final.
  outcome            TEXT,
  actual_value       REAL,
  graded_at          TEXT,
  -- Prop Score v1: locked at the same moment as everything else on this row
  -- (first INSERT OR IGNORE wins, later refreshes are no-ops) — so the score
  -- shown for a graded pick is provably the one that existed when it was
  -- first surfaced, not recomputed after the fact.
  prop_score         REAL,
  score_grade        TEXT,
  trust_tier         TEXT,
  -- Which model_weights version (see below) produced model_prob on this row,
  -- for the fitted markets (moneyline/total/home-run) — null for rows from
  -- the shared Beta-Binomial props pipeline, which isn't versioned this way.
  -- Lets per-version accuracy be reported without blending across versions,
  -- same discipline model_weights itself already applies to its own history.
  model_version      INTEGER,
  UNIQUE (sport, subject_id, dimension, category, game_id)
);

CREATE INDEX IF NOT EXISTS idx_pick_history_subject ON pick_history (sport, subject_id);
CREATE INDEX IF NOT EXISTS idx_pick_history_ungraded ON pick_history (game_id) WHERE outcome IS NULL;

-- Cached game-level lines from the-odds-api.com. Persisted rather than held in
-- memory so a restart doesn't spend another credit from a 500/month budget.
CREATE TABLE IF NOT EXISTS odds_cache (
  cache_key          TEXT PRIMARY KEY,
  payload            TEXT NOT NULL,
  fetched_at         TEXT NOT NULL,
  requests_remaining INTEGER,
  requests_used      INTEGER
);

-- Cached sport snapshots. A full snapshot takes 20-30s to build from the MLB
-- API; caching it here means the first page load after a restart is instant.
CREATE TABLE IF NOT EXISTS snapshot_cache (
  cache_key  TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

-- User-supplied embed links for the Watch tab.
CREATE TABLE IF NOT EXISTS watch_links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL,
  url        TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Update 09: five-provider player-prop odds
-- ---------------------------------------------------------------------------

-- One row per (provider, game, subject, market, line, side, bookmaker) — the
-- spec's cache key extended with bookmaker, since a single provider fetch
-- routinely returns several books' prices for the same player/market/line,
-- and section 6 requires "N books" counts to see everything fetched.
-- Persisted (not in-memory) so a dev-server restart doesn't silently
-- re-trigger Tier 2 fetches against a metered budget just to repopulate a cache.
CREATE TABLE IF NOT EXISTS prop_odds (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id    TEXT    NOT NULL,
  game_id        TEXT    NOT NULL,
  subject_id     TEXT    NOT NULL,
  subject_name   TEXT    NOT NULL,
  market_key     TEXT    NOT NULL,
  line           REAL,
  side           TEXT    NOT NULL,
  bookmaker      TEXT    NOT NULL,
  american_odds  INTEGER NOT NULL,
  decimal_odds   REAL,
  fetched_at     TEXT    NOT NULL,
  is_delayed     INTEGER NOT NULL DEFAULT 0,
  delay_seconds  INTEGER,
  UNIQUE (provider_id, game_id, subject_id, market_key, line, side, bookmaker)
);

CREATE INDEX IF NOT EXISTS idx_prop_odds_game ON prop_odds (game_id);
CREATE INDEX IF NOT EXISTS idx_prop_odds_subject ON prop_odds (game_id, subject_id, market_key);
CREATE INDEX IF NOT EXISTS idx_prop_odds_provider_game ON prop_odds (provider_id, game_id);

-- Append-only. prop_odds above is a pure upsert — the latest price
-- overwrites the last, so it has never retained a real history. This table
-- is the actual archive: one row is added only when a price for a given
-- key genuinely changes, not on every refresh tick, so it captures real line
-- movement without growing on every no-op 3-minute poll. This is what makes
-- both real "Line movement" display and a post-season Phase C.1 v2 model
-- possible — before this, that data was simply discarded every fetch.
CREATE TABLE IF NOT EXISTS prop_odds_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id    TEXT    NOT NULL,
  game_id        TEXT    NOT NULL,
  subject_id     TEXT    NOT NULL,
  market_key     TEXT    NOT NULL,
  line           REAL,
  side           TEXT    NOT NULL,
  bookmaker      TEXT    NOT NULL,
  american_odds  INTEGER NOT NULL,
  decimal_odds   REAL,
  observed_at    TEXT    NOT NULL,
  is_delayed     INTEGER NOT NULL DEFAULT 0,
  delay_seconds  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_prop_odds_history_lookup
  ON prop_odds_history (game_id, subject_id, market_key, line, side, bookmaker, observed_at);

-- Same append-only, log-on-change pattern as prop_odds_history, for
-- game-level moneyline/total prices (odds_cache is upsert-only, same gap).
-- One row per (event, market, side, book) observation. Moneyline/total only
-- for now — spread isn't needed by the game model this feeds.
CREATE TABLE IF NOT EXISTS game_odds_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     TEXT NOT NULL,
  market       TEXT NOT NULL, -- 'moneyline' | 'total'
  side         TEXT NOT NULL, -- 'home' | 'away' for moneyline, 'over' | 'under' for total
  bookmaker    TEXT NOT NULL,
  american_odds INTEGER NOT NULL,
  point        REAL,          -- total line; null for moneyline
  observed_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_odds_history_lookup
  ON game_odds_history (event_id, market, side, bookmaker, observed_at);

-- Per-provider request/object counters, one row per billing period the
-- provider actually resets on (daily for Odds-API.io, monthly for the
-- metered Tier 2 providers). period_key changing IS the reset — no cron
-- needed, a new period simply starts an unseen row at zero.
CREATE TABLE IF NOT EXISTS provider_usage (
  provider_id    TEXT    NOT NULL,
  period_kind    TEXT    NOT NULL, -- 'daily' | 'monthly'
  period_key     TEXT    NOT NULL, -- '2026-08-11' or '2026-08'
  request_count  INTEGER NOT NULL DEFAULT 0,
  object_count   INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT    NOT NULL,
  PRIMARY KEY (provider_id, period_kind, period_key)
);

-- Diagnostics: players/markets/books a recent fetch couldn't resolve, so
-- coverage gaps are visible rather than silently dropped (update-09 § 6).
-- Cleared and repopulated per provider on each fetch, so this always reflects
-- the most recent attempt rather than growing without bound.
CREATE TABLE IF NOT EXISTS odds_unresolved (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  kind        TEXT NOT NULL, -- 'player' | 'market' | 'bookmaker'
  raw_value   TEXT NOT NULL,
  context     TEXT,
  seen_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_odds_unresolved_provider ON odds_unresolved (provider_id);

-- ---------------------------------------------------------------------------
-- Linesmith Pick lock system
-- ---------------------------------------------------------------------------

-- One row per game. Each market (moneyline, total) gets two capture slots:
-- 'initial' (everything the slate offers, captured once around 6am local —
-- see lib/core/gamePickLock.ts) and 'final' (re-evaluated and frozen 3 hours
-- before first pitch — the pick that actually counts for the record). A slot
-- is written at most once; once ml_final_captured_at is set it is never
-- overwritten, which is what "locked" means here. Grading always prefers the
-- final slot and falls back to initial only when a final lock never
-- happened (server was offline through the 3-hour mark) — an honest
-- degradation, not a silent one, tracked via the *_late flags.
CREATE TABLE IF NOT EXISTS game_picks (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  sport                   TEXT NOT NULL,
  game_id                 TEXT NOT NULL,
  home_team_id            INTEGER,
  away_team_id            INTEGER,
  home_team_name          TEXT,
  away_team_name          TEXT,
  matchup                 TEXT,
  commence_time           TEXT,

  ml_initial_side         TEXT,    -- 'home' | 'away'
  ml_initial_prob         REAL,    -- model win prob for the picked side
  ml_initial_captured_at  TEXT,
  ml_initial_late         INTEGER NOT NULL DEFAULT 0,

  ml_initial_price         INTEGER, -- American odds for the picked side, best-effort (attached from the odds feed whenever it's around)
  -- 90% Wald confidence interval (predictProbWithInterval) for the picked
  -- side's probability, captured at the same moment as the prob column and
  -- frozen the same way — null whenever no fitted model with a covariance
  -- matrix was active at capture time (the hand-coded formula fallback has
  -- no statistical basis for an interval).
  ml_initial_prob_lower    REAL,
  ml_initial_prob_upper    REAL,
  ml_final_side           TEXT,
  ml_final_prob           REAL,
  ml_final_captured_at    TEXT,
  ml_final_late           INTEGER NOT NULL DEFAULT 0,
  ml_final_price           INTEGER,
  ml_final_prob_lower      REAL,
  ml_final_prob_upper      REAL,

  total_initial_side      TEXT,    -- 'over' | 'under'
  total_initial_prob      REAL,
  total_initial_line      REAL,
  total_initial_captured_at TEXT,
  total_initial_late      INTEGER NOT NULL DEFAULT 0,
  total_initial_price      INTEGER,
  -- 90% Wald confidence interval for the picked side's over/under
  -- probability, same basis as the ml_* columns above — null whenever no
  -- fitted total-market model with a covariance matrix was active at capture
  -- time (formula-only fallback has no statistical basis for one).
  total_initial_prob_lower REAL,
  total_initial_prob_upper REAL,

  total_final_side        TEXT,
  total_final_prob        REAL,
  total_final_line        REAL,
  total_final_captured_at TEXT,
  total_final_late        INTEGER NOT NULL DEFAULT 0,
  total_final_price        INTEGER,
  total_final_prob_lower   REAL,
  total_final_prob_upper   REAL,

  final_home_score        INTEGER,
  final_away_score        INTEGER,
  ml_outcome              TEXT,    -- 'win' | 'loss'
  total_outcome            TEXT,   -- 'win' | 'loss'
  graded_at                TEXT,

  -- Model-upgrade phases (market blend, park factor, Elo, fitted weights):
  -- the raw feature breakdown behind each capture, stored as JSON rather
  -- than one rigid column per signal, since the feature set is expected to
  -- keep growing across phases without needing a schema migration each
  -- time. Captured once per slot, same "never overwritten" lock semantics
  -- as everything else on this row.
  initial_ml_features_json    TEXT,
  final_ml_features_json      TEXT,
  initial_total_features_json TEXT,
  final_total_features_json   TEXT,

  UNIQUE (sport, game_id)
);

CREATE INDEX IF NOT EXISTS idx_game_picks_sport ON game_picks (sport, commence_time);
CREATE INDEX IF NOT EXISTS idx_game_picks_ungraded ON game_picks (sport) WHERE graded_at IS NULL;

-- Park run-environment factors — one row per (venue, season), recomputed
-- from that season's own completed games (see lib/sports/mlb/parkFactors.ts).
-- A season boundary is a real reset point (new season, and the "season to
-- date" sample the factor is computed from restarts), so it's part of the key.
CREATE TABLE IF NOT EXISTS park_factors (
  venue_id    INTEGER NOT NULL,
  season      INTEGER NOT NULL,
  venue_name  TEXT NOT NULL,
  factor      REAL NOT NULL,
  games       INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (venue_id, season)
);

-- Home Run model's live pitcher-matchup lookup — one row per (team, season),
-- same season-aggregate "rate of opponent batter-games with a HR" the
-- training builder computes (homeRunModelFit.ts's aggregateLeagueAndTeamHrRates),
-- persisted so the live path can do a cheap read instead of re-running the
-- full qualified-batter game-log pull on every request. league_hr_rate is
-- duplicated onto every row of a season rather than a separate table — one
-- extra REAL per row is cheaper than a second lookup for a single scalar
-- that's the same for all 30 teams that season.
CREATE TABLE IF NOT EXISTS team_hr_rate_allowed (
  team_id                INTEGER NOT NULL,
  season                 INTEGER NOT NULL,
  games_faced            INTEGER NOT NULL,
  games_with_hr_allowed  INTEGER NOT NULL,
  league_hr_rate         REAL NOT NULL,
  computed_at            TEXT NOT NULL,
  PRIMARY KEY (team_id, season)
);

-- Sim engine plan, Phase 7's live-wiring follow-up — one row per pre-game
-- matchup, holding the real per-batter simulation's output (see
-- lib/sports/mlb/gameSimCache.ts). Overwritten (not append-only, unlike
-- team_elo_history) because this cache is meant to IMPROVE over the course of
-- a day: an early row computed against a projected lineup gets replaced once
-- the real lineup posts. lineup_source records which one produced the
-- current row, so a caller can tell a rough early read from the real one
-- without re-deriving it. No season column — game_id alone is unique per
-- game regardless of season.
CREATE TABLE IF NOT EXISTS game_sim_cache (
  sport           TEXT NOT NULL,
  game_id         TEXT NOT NULL,
  home_win_prob   REAL NOT NULL,
  expected_total  REAL NOT NULL,
  n               INTEGER NOT NULL,
  lineup_source   TEXT NOT NULL, -- 'posted' | 'projected'
  computed_at     TEXT NOT NULL,
  PRIMARY KEY (sport, game_id)
);

-- Elo rating trajectory (model-upgrade Phase 2) — one row per team per
-- completed game, storing the rating AFTER that game. Append-only by
-- design: predicting a future game means finding each team's most recent
-- row before that game's date, never overwriting history. Flat 1500 reset
-- each season (see lib/sports/mlb/eloModel.ts) rather than a carried-over
-- rating, so season is part of the identity, not just a filter.
CREATE TABLE IF NOT EXISTS team_elo_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id           INTEGER NOT NULL,
  season            INTEGER NOT NULL,
  game_pk           INTEGER NOT NULL,
  game_date         TEXT NOT NULL,
  elo               REAL NOT NULL,
  games_played      INTEGER NOT NULL,
  -- Opponent + home/away, so rest and travel can be reconstructed later from
  -- history alone (last game's date + location) without a separate log.
  opponent_team_id  INTEGER,
  was_home          INTEGER NOT NULL DEFAULT 0,
  UNIQUE (team_id, season, game_pk)
);

CREATE INDEX IF NOT EXISTS idx_team_elo_lookup ON team_elo_history (team_id, season, game_date);

-- Starting-pitcher Game Score trend (model-upgrade Elo item 4) — one row per
-- start, so a live per-game Elo adjustment can be computed from a pitcher's
-- own recent trend without re-deriving it from box scores every time.
CREATE TABLE IF NOT EXISTS pitcher_game_score_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pitcher_id  INTEGER NOT NULL,
  team_id     INTEGER NOT NULL,
  season      INTEGER NOT NULL,
  game_pk     INTEGER NOT NULL,
  game_date   TEXT NOT NULL,
  game_score  REAL NOT NULL,
  UNIQUE (pitcher_id, game_pk)
);

CREATE INDEX IF NOT EXISTS idx_pitcher_game_score_lookup ON pitcher_game_score_history (pitcher_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pitcher_game_score_team ON pitcher_game_score_history (team_id, season, game_date);

-- Fitted model weights (model-upgrade Phase 3) — replaces the hand-picked
-- constants (home-field edge, venue cap, form discount) with coefficients
-- learned from real graded outcomes. One row per fit attempt, versioned and
-- never overwritten, so a bad refit can't destroy the fit history; only one
-- row per (sport, market) is ever "active" at a time — see
-- lib/sports/mlb/modelFit.ts's guardrail, which only flips "active" when a
-- new fit's holdout Brier actually beats the currently active one's.
CREATE TABLE IF NOT EXISTS model_weights (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sport         TEXT NOT NULL,
  market        TEXT NOT NULL, -- 'moneyline' | 'total'
  version       INTEGER NOT NULL,
  feature_names TEXT NOT NULL, -- JSON array, same order as weights_json
  weights_json  TEXT NOT NULL, -- JSON array of coefficients
  intercept     REAL NOT NULL,
  train_games   INTEGER NOT NULL,
  train_brier   REAL NOT NULL,
  holdout_games INTEGER NOT NULL,
  holdout_brier REAL NOT NULL,
  baseline_holdout_brier REAL, -- the hand-coded formula's own Brier on the same holdout, for direct comparison
  active        INTEGER NOT NULL DEFAULT 0,
  fitted_at     TEXT NOT NULL,
  -- Covariance matrix of [intercept, weights] at the fit (JSON, row-major),
  -- from logisticRegression.ts's Fisher-information approximation. Nullable
  -- — only present on fits produced after uncertainty quantification was
  -- added; older rows fall back to no confidence interval. Powers
  -- predictProbWithInterval so a live prediction can carry a real
  -- statistical interval, not just a point estimate.
  covariance_json TEXT,
  -- Which seasons actually went into this fit — JSON arrays. Nullable, same
  -- reason as covariance_json: only present on fits produced after this
  -- existed. Lets the diagnostics page answer "was this trained on current
  -- data" directly from the row, instead of trusting fitted_at alone (a
  -- fit run today could still have been pointed at a stale, hardcoded
  -- season range).
  train_seasons_json TEXT,
  holdout_seasons_json TEXT,
  UNIQUE (sport, market, version)
);

CREATE INDEX IF NOT EXISTS idx_model_weights_lookup ON model_weights (sport, market, active);

-- Historical odds, ingested from user-supplied files (2010-2020 SBR-format
-- spreadsheets, 2021-2025 multi-book CSV) rather than fetched live — kept
-- separate from game_odds_history (which logs THIS app's own live polling)
-- so ingested and live-collected data are never confused about their
-- provenance. One row per game: a de-vigged consensus probability, not raw
-- per-book prices, since that's what modelFit.ts's training set actually
-- consumes. Joined against the MLB schedule by (season, date, home, away)
-- team ID at training time — no gamePk stored here since ingestion never
-- calls the MLB API itself (see historicalOddsIngest.ts's file header).
CREATE TABLE IF NOT EXISTS historical_odds (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  season                    INTEGER NOT NULL,
  game_date                 TEXT NOT NULL, -- YYYY-MM-DD
  home_team_id              INTEGER NOT NULL,
  away_team_id              INTEGER NOT NULL,
  home_score                INTEGER,
  away_score                INTEGER,
  ml_home_consensus_prob    REAL,
  ml_away_consensus_prob    REAL,
  total_line                REAL,
  total_over_consensus_prob REAL,
  total_under_consensus_prob REAL,
  -- Opening-line counterparts to the closing-line columns above — both
  -- source files carry these (SBR's 'Open'/'Open OU' columns, the long
  -- CSV's open_home/open_away/open_total), just never parsed before. Lets
  -- training see how far the line moved from open to close, not just where
  -- it settled.
  ml_home_open_prob         REAL,
  ml_away_open_prob         REAL,
  total_open_line           REAL,
  total_open_over_prob      REAL,
  total_open_under_prob     REAL,
  source                    TEXT NOT NULL, -- 'sbr-xlsx' | 'long-csv'
  book_count                INTEGER NOT NULL,
  UNIQUE (season, game_date, home_team_id, away_team_id)
);

CREATE INDEX IF NOT EXISTS idx_historical_odds_lookup ON historical_odds (season, game_date, home_team_id, away_team_id);

-- Lightweight persisted error log — the app previously had no error history
-- at all, only ephemeral console.error output that's gone the moment the
-- process restarts. Deliberately NOT a full observability stack (disproportionate
-- for a single-user local app): a handful of key routes write one row here on
-- catch, capped by ROW_CAP in client.ts's pruning, not by a retention window.
CREATE TABLE IF NOT EXISTS system_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  level        TEXT NOT NULL, -- 'error' | 'warning'
  source       TEXT NOT NULL, -- e.g. 'api/odds/lines', 'api/props/fit-total-weights'
  message      TEXT NOT NULL,
  detail       TEXT,
  occurred_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_system_events_recent ON system_events (occurred_at DESC);

-- Golf prediction-model data layer. Golf previously had no accumulated
-- history at all — every golf page re-fetches ESPN's CURRENT-week feed live,
-- nothing about a past round/hole/tournament is ever saved. These four
-- tables start persisting that going forward (see lib/sports/golf/
-- historyIngest.ts, called from adapter.ts's getGolfSnapshot on every poll)
-- so a real fitted model has a sample to train against eventually — same
-- role MLB's team_elo_history/historical_odds play, just starting from zero.
-- Written idempotently (UNIQUE + INSERT OR IGNORE): re-polling the same
-- already-completed hole/round/result is a no-op, so the ingest job doesn't
-- need to track what it's already seen.

-- One row per tournament instance — the join key everything else hangs off,
-- and what lets "this course, across multiple years" queries exist at all.
-- holes_json is the course's par/yardage per hole (ESPN's EspnCourse.holes),
-- stored as JSON rather than 18 columns since it's read as a unit, never
-- filtered/sorted by an individual hole's par at the SQL level.
CREATE TABLE IF NOT EXISTS golf_tournaments (
  event_id     TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  course_name  TEXT,
  season       INTEGER NOT NULL,
  start_date   TEXT,
  holes_json   TEXT,
  field_size   INTEGER,
  updated_at   TEXT NOT NULL
);

-- Finest grain — one row per golfer/tournament/round/hole. Feeds the
-- hole-score predictor directly; round/tournament totals can be derived by
-- summing this table, but round_scores/tournament_results below still store
-- their own totals directly rather than requiring a join+sum on every read.
CREATE TABLE IF NOT EXISTS golf_hole_scores (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       TEXT NOT NULL,
  espn_id        TEXT NOT NULL,
  round          INTEGER NOT NULL,
  hole           INTEGER NOT NULL,
  par            INTEGER,
  strokes        INTEGER,
  relative_to_par REAL NOT NULL,
  category       TEXT NOT NULL, -- 'birdie' | 'par' | 'bogey'
  ingested_at    TEXT NOT NULL,
  UNIQUE (event_id, espn_id, round, hole)
);

CREATE INDEX IF NOT EXISTS idx_golf_hole_scores_lookup ON golf_hole_scores (espn_id, hole, event_id);
CREATE INDEX IF NOT EXISTS idx_golf_hole_scores_event ON golf_hole_scores (event_id, round, hole);

-- One row per golfer/tournament/round — round-level context (weather, tee
-- wave) that doesn't belong repeated on 18 hole rows.
CREATE TABLE IF NOT EXISTS golf_round_scores (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        TEXT NOT NULL,
  espn_id         TEXT NOT NULL,
  round           INTEGER NOT NULL,
  total_strokes   INTEGER,
  relative_to_par REAL NOT NULL,
  tee_wave        TEXT, -- 'AM' | 'PM' | null when unknown
  wind_mph        REAL,
  temp_f          REAL,
  precip_prob     REAL,
  ingested_at     TEXT NOT NULL,
  UNIQUE (event_id, espn_id, round)
);

CREATE INDEX IF NOT EXISTS idx_golf_round_scores_lookup ON golf_round_scores (espn_id, event_id);

-- One row per golfer/tournament — the outcome label a tournament-winner
-- model trains against. Written once a golfer's tournament is over (made
-- cut or not, final position known); re-polled/overwritten via INSERT OR
-- IGNORE like the others, since a final result never changes once posted.
CREATE TABLE IF NOT EXISTS golf_tournament_results (
  event_id     TEXT NOT NULL,
  espn_id      TEXT NOT NULL,
  position     TEXT, -- e.g. '1', 'T12', 'CUT', 'WD'
  made_cut     INTEGER NOT NULL DEFAULT 0,
  total_score  INTEGER,
  finished_at  TEXT NOT NULL,
  PRIMARY KEY (event_id, espn_id)
);

-- Model performance tracking — "how is it performing," not just "is data
-- coming in." Golf's Phase A models (see project memory) compute a fresh
-- prediction every snapshot poll but nothing persisted it until now, so
-- there was nothing to grade once the real outcome landed. One row per
-- (event, golfer, dimension, round), upserted every poll with the LATEST
-- prediction — but only while ungraded (graded_at IS NULL); once a real
-- outcome grades it, the row freezes so a later poll can't overwrite a
-- graded prediction with a "prediction" made after the fact. Grading itself
-- (lib/sports/golf/models/grading.ts) joins against golf_hole_scores/
-- golf_round_scores once they carry the matching real result.
CREATE TABLE IF NOT EXISTS golf_model_predictions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id         TEXT NOT NULL,
  espn_id          TEXT NOT NULL,
  dimension        TEXT NOT NULL, -- 'hole-7' | 'round-score'
  round            INTEGER NOT NULL,
  category         TEXT NOT NULL, -- 'birdie' | 'par' | 'bogey' — the candidate's own predicted category at prediction time
  predicted_prob   REAL NOT NULL,
  league_rate      REAL,
  predicted_at     TEXT NOT NULL,
  graded_at        TEXT,
  actual_category  TEXT,
  hit              INTEGER, -- 1 if actual_category = category, 0 otherwise — set only once graded
  brier_component  REAL,    -- (predicted_prob - hit)^2, set only once graded
  UNIQUE (event_id, espn_id, dimension, round)
);

CREATE INDEX IF NOT EXISTS idx_golf_model_predictions_ungraded ON golf_model_predictions (event_id) WHERE graded_at IS NULL;

-- Tournament-winner predictions — same idea, one row per (event, golfer),
-- four independent binary outcomes (win/top5/top10/made cut) graded together
-- once golf_tournament_results carries that golfer's final result.
CREATE TABLE IF NOT EXISTS golf_tournament_predictions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        TEXT NOT NULL,
  espn_id         TEXT NOT NULL,
  prob_win        REAL NOT NULL,
  prob_top5       REAL NOT NULL,
  prob_top10      REAL NOT NULL,
  prob_made_cut   REAL NOT NULL,
  predicted_at    TEXT NOT NULL,
  graded_at       TEXT,
  actual_won      INTEGER,
  actual_top5     INTEGER,
  actual_top10    INTEGER,
  actual_made_cut INTEGER,
  brier_win       REAL,
  brier_top5      REAL,
  brier_top10     REAL,
  brier_made_cut  REAL,
  UNIQUE (event_id, espn_id)
);
`;
