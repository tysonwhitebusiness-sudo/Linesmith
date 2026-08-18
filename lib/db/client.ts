/**
 * SQLite connection. One process-wide handle, created lazily and cached across
 * hot reloads in dev so `next dev` doesn't leak file handles on every edit.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = process.env.LINESMITH_DB ?? path.join(DB_DIR, 'linebuddy.db');

declare global {
  // eslint-disable-next-line no-var
  var __linesmithDb: DatabaseType | undefined;
}

/**
 * `pick_history` predates Phase C's columns. `CREATE TABLE IF NOT EXISTS`
 * can't add columns to an already-existing table, and the table has never
 * had a real writer (`logSurfaced` was dead code) — so on an old-shape
 * install this drops and lets `SCHEMA_SQL` recreate it, rather than a long
 * ALTER TABLE sequence for a table with nothing to lose. A future migration
 * that has to preserve real rows should not follow this shortcut.
 */
function migratePickHistory(db: DatabaseType): void {
  const columns = db.prepare('PRAGMA table_info(pick_history)').all() as { name: string }[];
  const hasCurrentShape = columns.some((c) => c.name === 'game_id');
  if (columns.length > 0 && !hasCurrentShape) {
    db.exec('DROP TABLE pick_history');
  }
}

/**
 * `game_picks` predates the totals confidence-interval columns, and unlike
 * pick_history this table holds real, non-reconstructable data (locked
 * picks) — so this adds the missing columns in place with ALTER TABLE rather
 * than dropping, only when they're actually absent.
 */
function migrateGamePicksTotalInterval(db: DatabaseType): void {
  const columns = db.prepare('PRAGMA table_info(game_picks)').all() as { name: string }[];
  if (columns.length === 0 || columns.some((c) => c.name === 'total_initial_prob_lower')) return;
  db.exec(`
    ALTER TABLE game_picks ADD COLUMN total_initial_prob_lower REAL;
    ALTER TABLE game_picks ADD COLUMN total_initial_prob_upper REAL;
    ALTER TABLE game_picks ADD COLUMN total_final_prob_lower REAL;
    ALTER TABLE game_picks ADD COLUMN total_final_prob_upper REAL;
  `);
}

/** Same in-place ALTER pattern as migrateGamePicksTotalInterval — historical_odds already holds real ingested data, so this adds the opening-line columns rather than dropping. */
function migrateHistoricalOddsOpenLine(db: DatabaseType): void {
  const columns = db.prepare('PRAGMA table_info(historical_odds)').all() as { name: string }[];
  if (columns.length === 0 || columns.some((c) => c.name === 'ml_home_open_prob')) return;
  db.exec(`
    ALTER TABLE historical_odds ADD COLUMN ml_home_open_prob REAL;
    ALTER TABLE historical_odds ADD COLUMN ml_away_open_prob REAL;
    ALTER TABLE historical_odds ADD COLUMN total_open_line REAL;
    ALTER TABLE historical_odds ADD COLUMN total_open_over_prob REAL;
    ALTER TABLE historical_odds ADD COLUMN total_open_under_prob REAL;
  `);
}

/**
 * Prop Score v1 — pick_history now holds 300k+ real graded rows (backfill +
 * live), so this is deliberately the ALTER-in-place pattern
 * (migrateGamePicksTotalInterval/migrateHistoricalOddsOpenLine), NOT the
 * drop-and-recreate `migratePickHistory` above uses — that shortcut was only
 * ever valid while the table had no real writer.
 */
function migratePickHistoryScoreColumns(db: DatabaseType): void {
  const columns = db.prepare('PRAGMA table_info(pick_history)').all() as { name: string }[];
  if (columns.length === 0 || columns.some((c) => c.name === 'prop_score')) return;
  db.exec(`
    ALTER TABLE pick_history ADD COLUMN prop_score REAL;
    ALTER TABLE pick_history ADD COLUMN score_grade TEXT;
    ALTER TABLE pick_history ADD COLUMN trust_tier TEXT;
  `);
}

/**
 * Home Run model plan, Phase 1 — same in-place ALTER pattern as
 * migratePickHistoryScoreColumns. Lets a graded pick record which
 * model_weights version produced its model_prob, for markets (moneyline,
 * total, home-run) that are fitted/versioned rather than the shared
 * Beta-Binomial props pipeline.
 */
function migratePickHistoryModelVersion(db: DatabaseType): void {
  const columns = db.prepare('PRAGMA table_info(pick_history)').all() as { name: string }[];
  if (columns.length === 0 || columns.some((c) => c.name === 'model_version')) return;
  db.exec(`ALTER TABLE pick_history ADD COLUMN model_version INTEGER;`);
}

/** Same in-place ALTER pattern as the others — model_weights already holds real fit history, so this adds the training-window columns rather than dropping. */
function migrateModelWeightsTrainSeasons(db: DatabaseType): void {
  const columns = db.prepare('PRAGMA table_info(model_weights)').all() as { name: string }[];
  if (columns.length === 0 || columns.some((c) => c.name === 'train_seasons_json')) return;
  db.exec(`
    ALTER TABLE model_weights ADD COLUMN train_seasons_json TEXT;
    ALTER TABLE model_weights ADD COLUMN holdout_seasons_json TEXT;
  `);
}

/** Bet-slip rework — `picks` already holds a real slip, so this adds `line`/`game_id` in place rather than dropping. Both are nullable, so existing rows are simply unset for them. */
function migratePicksLineAndGame(db: DatabaseType): void {
  const columns = db.prepare('PRAGMA table_info(picks)').all() as { name: string }[];
  if (columns.length === 0 || columns.some((c) => c.name === 'line')) return;
  db.exec(`
    ALTER TABLE picks ADD COLUMN line REAL;
    ALTER TABLE picks ADD COLUMN game_id TEXT;
  `);
}

/** Same in-place ALTER pattern — adds team/opponent identity + bookmaker to `picks` and `bets` for logo/matchup display, without touching existing rows. */
function migrateDisplayFields(db: DatabaseType): void {
  for (const table of ['picks', 'bets']) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.length === 0 || columns.some((c) => c.name === 'team_id')) continue;
    db.exec(`
      ALTER TABLE ${table} ADD COLUMN team_id INTEGER;
      ALTER TABLE ${table} ADD COLUMN team TEXT;
      ALTER TABLE ${table} ADD COLUMN opponent_id INTEGER;
      ALTER TABLE ${table} ADD COLUMN opponent TEXT;
      ALTER TABLE ${table} ADD COLUMN bookmaker TEXT;
    `);
  }
}

/**
 * `golf_round_scores` predates its `ingested_at` column (`schema.ts`'s
 * `CREATE TABLE IF NOT EXISTS` declares it, but that's a no-op against an
 * already-existing table) — unlike every other schema addition in this
 * file, this one never got a migration, so the live table was missing the
 * column entirely. `golf_hole_scores` was created after `ingested_at` was
 * added and already has it; only `golf_round_scores` needs this. Same
 * ALTER-in-place pattern as the others — the table already holds 254 real
 * ingested rows, so this adds the column (nullable; no real ingestion
 * timestamp exists to backfill onto historical rows) rather than dropping.
 * Added as nullable to match `writeGolfRoundScores` (which always supplies
 * a value going forward) without a `NOT NULL` default forcing every
 * pre-existing row to share one fabricated timestamp.
 */
function migrateGolfRoundScoresIngestedAt(db: DatabaseType): void {
  const columns = db.prepare('PRAGMA table_info(golf_round_scores)').all() as { name: string }[];
  if (columns.length === 0 || columns.some((c) => c.name === 'ingested_at')) return;
  db.exec(`ALTER TABLE golf_round_scores ADD COLUMN ingested_at TEXT;`);
}

function connect(): DatabaseType {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  // Default journal mode locks the whole file on any write, and the default
  // busy_timeout is 0 (fails instantly instead of waiting) — with proactive
  // background refresh jobs now running across five sports plus every
  // foreground API route reading/writing the same file, that combination is
  // exactly what produced the real "database is locked" SQLITE_BUSY errors
  // seen in this session's dev-verify logs. WAL lets readers proceed while a
  // writer is active; the busy timeout makes a genuine collision retry for
  // up to 5s instead of erroring immediately.
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  // Passive auto-checkpoints (the default, threshold 1000 pages / ~4MB) were
  // already keeping up — a live check found only 338 WAL pages (~1.4MB)
  // outstanding at rest, checkpointed with zero busy-retries. The 992MB
  // -wal file on disk wasn't a backlog; PASSIVE checkpoints copy WAL content
  // into the main db but never call ftruncate, so the file's on-disk size
  // just never shrinks back down on its own (journal_size_limit defaults to
  // -1, unbounded). The single biggest writer is `refreshMlb`'s snapshot
  // cache write — measured at up to ~66MB per commit (mlb:full-raw:{date}
  // in snapshot_cache) — so this caps the file at roughly 2x that, and
  // ensureSchedulerStarted's refreshMlb tick (lib/scheduler.ts, every 4min)
  // runs an explicit TRUNCATE checkpoint after each rebuild to actually
  // reclaim the space rather than relying on the cap alone.
  db.pragma('journal_size_limit = 134217728'); // 128MB
  migratePickHistory(db);
  db.exec(SCHEMA_SQL);
  migrateGamePicksTotalInterval(db);
  migrateHistoricalOddsOpenLine(db);
  migratePickHistoryScoreColumns(db);
  migratePickHistoryModelVersion(db);
  migrateModelWeightsTrainSeasons(db);
  migratePicksLineAndGame(db);
  migrateDisplayFields(db);
  migrateGolfRoundScoresIngestedAt(db);
  return db;
}

export function getDb(): DatabaseType {
  if (!global.__linesmithDb) global.__linesmithDb = connect();
  return global.__linesmithDb;
}

/**
 * Explicit TRUNCATE checkpoint — copies all outstanding WAL frames into the
 * main db file (like a passive auto-checkpoint already does) and then
 * shrinks `linebuddy.db-wal` back to 0 bytes, which PASSIVE checkpoints
 * never do on their own (see the `journal_size_limit` comment in connect()).
 * Called from lib/scheduler.ts's refreshMlb tick — the single biggest
 * writer — rather than on its own timer. Safe to call at any time: if
 * another connection is mid-transaction this returns `busy: 1` (or a
 * partial `checkpointed` count) and simply leaves the remainder for the
 * next call instead of blocking or failing.
 */
export function checkpointWal(): { busy: number; log: number; checkpointed: number } {
  const [result] = getDb().pragma('wal_checkpoint(TRUNCATE)') as {
    busy: number;
    log: number;
    checkpointed: number;
  }[];
  return result;
}

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------

export interface PickRow {
  id: number;
  sport: string;
  subjectId: string;
  subjectName: string;
  dimension: string;
  dimensionLabel: string;
  category: string;
  categoryLabel: string;
  line: number | null;
  gameId: string | null;
  teamId: number | null;
  team: string | null;
  opponentId: number | null;
  opponent: string | null;
  americanOdds: string | null;
  oddsSource: string | null;
  oddsCapturedAt: string | null;
  bookmaker: string | null;
  eventContext: string | null;
  sampleSize: number | null;
  createdAt: string;
}

const PICK_COLUMNS = `
  id,
  sport,
  subject_id      AS subjectId,
  subject_name    AS subjectName,
  dimension,
  dimension_label AS dimensionLabel,
  category,
  category_label  AS categoryLabel,
  line,
  game_id         AS gameId,
  team_id         AS teamId,
  team,
  opponent_id     AS opponentId,
  opponent,
  american_odds   AS americanOdds,
  odds_source     AS oddsSource,
  odds_captured_at AS oddsCapturedAt,
  bookmaker,
  event_context   AS eventContext,
  sample_size     AS sampleSize,
  created_at      AS createdAt
`;

export function listPicks(sport?: string): PickRow[] {
  const db = getDb();
  return sport
    ? (db.prepare(`SELECT ${PICK_COLUMNS} FROM picks WHERE sport = ? ORDER BY created_at DESC, id DESC`).all(sport) as PickRow[])
    : (db.prepare(`SELECT ${PICK_COLUMNS} FROM picks ORDER BY created_at DESC, id DESC`).all() as PickRow[]);
}

export interface PickInput {
  sport: string;
  subjectId: string;
  subjectName: string;
  dimension: string;
  dimensionLabel: string;
  category: string;
  categoryLabel: string;
  line?: number | null;
  gameId?: string | null;
  teamId?: number | null;
  team?: string | null;
  opponentId?: number | null;
  opponent?: string | null;
  americanOdds?: string | null;
  oddsSource?: string | null;
  bookmaker?: string | null;
  eventContext?: string | null;
  sampleSize?: number | null;
}

/** Insert, or update the odds if this exact leg is already on the slip. */
export function addPick(input: PickInput): PickRow {
  const db = getDb();
  const capturedAt = input.americanOdds ? new Date().toISOString() : null;

  db.prepare(
    `INSERT INTO picks
       (sport, subject_id, subject_name, dimension, dimension_label, category, category_label,
        line, game_id, team_id, team, opponent_id, opponent,
        american_odds, odds_source, odds_captured_at, bookmaker, event_context, sample_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (sport, subject_id, dimension, category) DO UPDATE SET
       line             = COALESCE(excluded.line, picks.line),
       game_id          = COALESCE(excluded.game_id, picks.game_id),
       team_id          = COALESCE(excluded.team_id, picks.team_id),
       team             = COALESCE(excluded.team, picks.team),
       opponent_id      = COALESCE(excluded.opponent_id, picks.opponent_id),
       opponent         = COALESCE(excluded.opponent, picks.opponent),
       american_odds    = COALESCE(excluded.american_odds, picks.american_odds),
       odds_source      = COALESCE(excluded.odds_source, picks.odds_source),
       odds_captured_at = COALESCE(excluded.odds_captured_at, picks.odds_captured_at),
       bookmaker        = COALESCE(excluded.bookmaker, picks.bookmaker),
       event_context    = COALESCE(excluded.event_context, picks.event_context)`,
  ).run(
    input.sport,
    input.subjectId,
    input.subjectName,
    input.dimension,
    input.dimensionLabel,
    input.category,
    input.categoryLabel,
    input.line ?? null,
    input.gameId ?? null,
    input.teamId ?? null,
    input.team ?? null,
    input.opponentId ?? null,
    input.opponent ?? null,
    input.americanOdds ?? null,
    input.oddsSource ?? null,
    capturedAt,
    input.bookmaker ?? null,
    input.eventContext ?? null,
    input.sampleSize ?? null,
  );

  return db
    .prepare(`SELECT ${PICK_COLUMNS} FROM picks WHERE sport = ? AND subject_id = ? AND dimension = ? AND category = ?`)
    .get(input.sport, input.subjectId, input.dimension, input.category) as PickRow;
}

/** Manual/screenshot edits clear `bookmaker` — neither identifies a specific book, so a stale book logo next to a hand-typed price would misattribute it. */
export function updatePickOdds(id: number, americanOdds: string | null, source: string): PickRow | null {
  const db = getDb();
  db.prepare(
    `UPDATE picks SET american_odds = ?, odds_source = ?, odds_captured_at = ?, bookmaker = NULL WHERE id = ?`,
  ).run(americanOdds, americanOdds ? source : null, americanOdds ? new Date().toISOString() : null, id);
  return (db.prepare(`SELECT ${PICK_COLUMNS} FROM picks WHERE id = ?`).get(id) as PickRow) ?? null;
}

export function deletePick(id: number): void {
  getDb().prepare('DELETE FROM picks WHERE id = ?').run(id);
}

export function clearPicks(sport?: string): void {
  const db = getDb();
  if (sport) db.prepare('DELETE FROM picks WHERE sport = ?').run(sport);
  else db.prepare('DELETE FROM picks').run();
}

// ---------------------------------------------------------------------------
// Bets — submitted off the slip, graded independently. See schema.ts's
// `bets` table comment for the lifecycle this splits from `picks`.
// ---------------------------------------------------------------------------

export interface BetRow {
  id: number;
  sport: string;
  subjectId: string;
  subjectName: string;
  dimension: string;
  dimensionLabel: string;
  category: string;
  categoryLabel: string;
  line: number | null;
  gameId: string | null;
  teamId: number | null;
  team: string | null;
  opponentId: number | null;
  opponent: string | null;
  americanOdds: string | null;
  oddsSource: string | null;
  bookmaker: string | null;
  eventContext: string | null;
  sampleSize: number | null;
  submittedAt: string;
  status: 'pending' | 'live' | 'won' | 'lost' | 'push';
  actualValue: number | null;
  settledAt: string | null;
}

const BET_COLUMNS = `
  id,
  sport,
  subject_id      AS subjectId,
  subject_name    AS subjectName,
  dimension,
  dimension_label AS dimensionLabel,
  category,
  category_label  AS categoryLabel,
  line,
  game_id         AS gameId,
  team_id         AS teamId,
  team,
  opponent_id     AS opponentId,
  opponent,
  american_odds   AS americanOdds,
  odds_source     AS oddsSource,
  bookmaker,
  event_context   AS eventContext,
  sample_size     AS sampleSize,
  submitted_at    AS submittedAt,
  status,
  actual_value    AS actualValue,
  settled_at      AS settledAt
`;

export function listBets(sport?: string): BetRow[] {
  const db = getDb();
  return sport
    ? (db.prepare(`SELECT ${BET_COLUMNS} FROM bets WHERE sport = ? ORDER BY submitted_at DESC, id DESC`).all(sport) as BetRow[])
    : (db.prepare(`SELECT ${BET_COLUMNS} FROM bets ORDER BY submitted_at DESC, id DESC`).all() as BetRow[]);
}

export function getBet(id: number): BetRow | null {
  return (getDb().prepare(`SELECT ${BET_COLUMNS} FROM bets WHERE id = ?`).get(id) as BetRow) ?? null;
}

/**
 * Move a set of slip legs into `bets` — copy then delete, in one
 * transaction, so a crash mid-submit can't leave a leg on neither table nor
 * duplicated on both. Legs the caller doesn't own (already removed, wrong
 * sport) are silently skipped rather than erroring the whole batch.
 */
export function submitPicksAsBets(ids: number[]): BetRow[] {
  const db = getDb();
  const submitted: BetRow[] = [];

  const run = db.transaction((pickIds: number[]) => {
    const getPick = db.prepare(`SELECT ${PICK_COLUMNS} FROM picks WHERE id = ?`);
    const insert = db.prepare(
      `INSERT INTO bets
         (sport, subject_id, subject_name, dimension, dimension_label, category, category_label,
          line, game_id, team_id, team, opponent_id, opponent, american_odds, odds_source, bookmaker,
          event_context, sample_size)
       VALUES (@sport, @subjectId, @subjectName, @dimension, @dimensionLabel, @category, @categoryLabel,
               @line, @gameId, @teamId, @team, @opponentId, @opponent, @americanOdds, @oddsSource, @bookmaker,
               @eventContext, @sampleSize)`,
    );
    const deletePickStmt = db.prepare('DELETE FROM picks WHERE id = ?');

    for (const id of pickIds) {
      const pick = getPick.get(id) as PickRow | undefined;
      if (!pick) continue;
      const info = insert.run(pick);
      submitted.push(getDb().prepare(`SELECT ${BET_COLUMNS} FROM bets WHERE id = ?`).get(info.lastInsertRowid) as BetRow);
      deletePickStmt.run(id);
    }
  });
  run(ids);

  return submitted;
}

export interface UngradedBetRow {
  id: number;
  subjectId: string;
  dimension: string;
  category: string;
  line: number | null;
}

/** Every game with at least one bet still pending/live — the bet-grading job's work list. */
export function listOpenBetGameIds(): string[] {
  const rows = getDb()
    .prepare(`SELECT DISTINCT game_id AS gameId FROM bets WHERE status IN ('pending', 'live') AND game_id IS NOT NULL`)
    .all() as { gameId: string }[];
  return rows.map((r) => r.gameId);
}

export function listOpenBetsForGame(gameId: string): UngradedBetRow[] {
  return getDb()
    .prepare(
      `SELECT id, subject_id AS subjectId, dimension, category, line
       FROM bets WHERE status IN ('pending', 'live') AND game_id = ?`,
    )
    .all(gameId) as UngradedBetRow[];
}

/** Bump open bets for a game to 'live' without settling them — called while a game is in progress so Live Bets can distinguish "not started" from "in progress" before final grading runs. */
export function markBetsLive(gameId: string): void {
  getDb()
    .prepare(`UPDATE bets SET status = 'live' WHERE status = 'pending' AND game_id = ?`)
    .run(gameId);
}

export interface BetGradeResult {
  id: number;
  outcome: 'win' | 'loss' | 'push';
  actualValue: number | null;
}

export function writeBetGrades(results: BetGradeResult[]): void {
  if (results.length === 0) return;
  const db = getDb();
  const update = db.prepare(
    `UPDATE bets SET status = @status, actual_value = @actualValue, settled_at = @settledAt WHERE id = @id`,
  );
  const settledAt = new Date().toISOString();
  const run = db.transaction((rows: BetGradeResult[]) => {
    for (const r of rows) {
      update.run({ id: r.id, status: r.outcome, actualValue: r.actualValue, settledAt });
    }
  });
  run(results);
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export interface WatchRow {
  id: number;
  sport: string;
  subjectId: string;
  subjectName: string;
  createdAt: string;
}

export function listWatchlist(sport?: string): WatchRow[] {
  const db = getDb();
  const columns = `id, sport, subject_id AS subjectId, subject_name AS subjectName, created_at AS createdAt`;
  return sport
    ? (db.prepare(`SELECT ${columns} FROM watchlist WHERE sport = ? ORDER BY subject_name`).all(sport) as WatchRow[])
    : (db.prepare(`SELECT ${columns} FROM watchlist ORDER BY subject_name`).all() as WatchRow[]);
}

export function addWatch(sport: string, subjectId: string, subjectName: string): void {
  getDb()
    .prepare(
      `INSERT INTO watchlist (sport, subject_id, subject_name) VALUES (?, ?, ?)
       ON CONFLICT (sport, subject_id) DO UPDATE SET subject_name = excluded.subject_name`,
    )
    .run(sport, subjectId, subjectName);
}

export function removeWatch(sport: string, subjectId: string): void {
  getDb().prepare('DELETE FROM watchlist WHERE sport = ? AND subject_id = ?').run(sport, subjectId);
}

// ---------------------------------------------------------------------------
// Odds cache (the-odds-api.com)
// ---------------------------------------------------------------------------

export interface OddsCacheRow {
  cacheKey: string;
  payload: string;
  fetchedAt: string;
  requestsRemaining: number | null;
  requestsUsed: number | null;
}

export function readOddsCache(cacheKey: string): OddsCacheRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT cache_key AS cacheKey, payload, fetched_at AS fetchedAt,
                requests_remaining AS requestsRemaining, requests_used AS requestsUsed
         FROM odds_cache WHERE cache_key = ?`,
      )
      .get(cacheKey) as OddsCacheRow) ?? null
  );
}

export function writeOddsCache(
  cacheKey: string,
  payload: string,
  requestsRemaining: number | null,
  requestsUsed: number | null,
): void {
  getDb()
    .prepare(
      `INSERT INTO odds_cache (cache_key, payload, fetched_at, requests_remaining, requests_used)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (cache_key) DO UPDATE SET
         payload            = excluded.payload,
         fetched_at         = excluded.fetched_at,
         requests_remaining = excluded.requests_remaining,
         requests_used      = excluded.requests_used`,
    )
    .run(cacheKey, payload, new Date().toISOString(), requestsRemaining, requestsUsed);
}

// ---------------------------------------------------------------------------
// Snapshot cache (persist computed snapshots so first load is instant)
// ---------------------------------------------------------------------------

export interface SnapshotCacheRow {
  cacheKey: string;
  payload: string;
  fetchedAt: string;
}

export function readSnapshotCache(cacheKey: string): SnapshotCacheRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT cache_key AS cacheKey, payload, fetched_at AS fetchedAt
         FROM snapshot_cache WHERE cache_key = ?`,
      )
      .get(cacheKey) as SnapshotCacheRow) ?? null
  );
}

export function writeSnapshotCache(cacheKey: string, payload: string): void {
  getDb()
    .prepare(
      `INSERT INTO snapshot_cache (cache_key, payload, fetched_at)
       VALUES (?, ?, ?)
       ON CONFLICT (cache_key) DO UPDATE SET
         payload    = excluded.payload,
         fetched_at = excluded.fetched_at`,
    )
    .run(cacheKey, payload, new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Pick history (surfaced-candidate log)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Prop odds cache (update-09: five-provider player-prop feed)
// ---------------------------------------------------------------------------

export interface PropOddsRow {
  id: number;
  providerId: string;
  gameId: string;
  subjectId: string;
  subjectName: string;
  marketKey: string;
  line: number | null;
  side: string;
  bookmaker: string;
  americanOdds: number;
  decimalOdds: number | null;
  fetchedAt: string;
  isDelayed: boolean;
  delaySeconds: number | null;
}

const PROP_ODDS_COLUMNS = `
  id,
  provider_id   AS providerId,
  game_id       AS gameId,
  subject_id    AS subjectId,
  subject_name  AS subjectName,
  market_key    AS marketKey,
  line,
  side,
  bookmaker,
  american_odds AS americanOdds,
  decimal_odds  AS decimalOdds,
  fetched_at    AS fetchedAt,
  is_delayed    AS isDelayed,
  delay_seconds AS delaySeconds
`;

function mapPropOddsRow(row: any): PropOddsRow {
  return { ...row, isDelayed: !!row.isDelayed };
}

export interface PropOddsInput {
  providerId: string;
  gameId: string;
  subjectId: string;
  subjectName: string;
  marketKey: string;
  line: number | null;
  side: string;
  bookmaker: string;
  americanOdds: number;
  decimalOdds: number | null;
  isDelayed: boolean;
  delaySeconds: number | null;
}

/** Upserts every row from one provider fetch in a single transaction. */
export function writePropOdds(rows: PropOddsInput[]): void {
  if (rows.length === 0) return;
  const db = getDb();
  const fetchedAt = new Date().toISOString();

  const existing = db.prepare(
    `SELECT american_odds AS americanOdds FROM prop_odds
     WHERE provider_id = @providerId AND game_id = @gameId AND subject_id = @subjectId
       AND market_key = @marketKey AND line IS @line AND side = @side AND bookmaker = @bookmaker`,
  );
  const insertHistory = db.prepare(
    `INSERT INTO prop_odds_history
       (provider_id, game_id, subject_id, market_key, line, side, bookmaker,
        american_odds, decimal_odds, observed_at, is_delayed, delay_seconds)
     VALUES (@providerId, @gameId, @subjectId, @marketKey, @line, @side, @bookmaker,
             @americanOdds, @decimalOdds, @fetchedAt, @isDelayed, @delaySeconds)`,
  );
  const upsert = db.prepare(
    `INSERT INTO prop_odds
       (provider_id, game_id, subject_id, subject_name, market_key, line, side, bookmaker,
        american_odds, decimal_odds, fetched_at, is_delayed, delay_seconds)
     VALUES (@providerId, @gameId, @subjectId, @subjectName, @marketKey, @line, @side, @bookmaker,
             @americanOdds, @decimalOdds, @fetchedAt, @isDelayed, @delaySeconds)
     ON CONFLICT (provider_id, game_id, subject_id, market_key, line, side, bookmaker) DO UPDATE SET
       subject_name  = excluded.subject_name,
       american_odds = excluded.american_odds,
       decimal_odds  = excluded.decimal_odds,
       fetched_at    = excluded.fetched_at,
       is_delayed    = excluded.is_delayed,
       delay_seconds = excluded.delay_seconds`,
  );

  const run = db.transaction((items: PropOddsInput[]) => {
    for (const r of items) {
      const params = { ...r, fetchedAt, isDelayed: r.isDelayed ? 1 : 0 };
      const prior = existing.get(params) as { americanOdds: number } | undefined;
      // No prior row (first time this exact price has been seen) or a
      // genuinely different price — either way, worth a history point. A
      // repeat of the same price on the next poll is not a price movement.
      if (!prior || prior.americanOdds !== r.americanOdds) {
        insertHistory.run(params);
      }
      upsert.run(params);
    }
  });
  run(rows);
}

export interface GameOddsHistoryInput {
  eventId: string;
  market: 'moneyline' | 'total';
  side: string;
  bookmaker: string;
  americanOdds: number;
  point: number | null;
}

/** Same log-on-change discipline as writePropOdds' history half — one new row only when this exact (event, market, side, book) price actually differs from the last one seen. */
export function writeGameOddsHistory(rows: GameOddsHistoryInput[]): void {
  if (rows.length === 0) return;
  const db = getDb();
  const observedAt = new Date().toISOString();
  const existing = db.prepare(
    `SELECT american_odds AS americanOdds FROM game_odds_history
     WHERE event_id = @eventId AND market = @market AND side = @side AND bookmaker = @bookmaker
     ORDER BY observed_at DESC LIMIT 1`,
  );
  const insert = db.prepare(
    `INSERT INTO game_odds_history (event_id, market, side, bookmaker, american_odds, point, observed_at)
     VALUES (@eventId, @market, @side, @bookmaker, @americanOdds, @point, @observedAt)`,
  );
  const run = db.transaction((items: GameOddsHistoryInput[]) => {
    for (const r of items) {
      const params = { ...r, observedAt };
      const prior = existing.get(params) as { americanOdds: number } | undefined;
      if (!prior || prior.americanOdds !== r.americanOdds) {
        insert.run(params);
      }
    }
  });
  run(rows);
}

/**
 * Live-side counterpart to historical_odds' opening line — the earliest
 * point value this app has itself observed for this event's total market,
 * across any book (points rarely diverge much book-to-book, and requiring a
 * SPECIFIC book to have been observed at open would just mean more games
 * silently get no line-movement signal at all). Only reflects movement since
 * this app started polling that event, not the sportsbook's true open —
 * an honest, disclosed gap, same shape as the rest of this codebase's
 * "real data or explicitly null" discipline.
 */
export function getEarliestObservedTotalPoint(eventId: string): number | null {
  const row = getDb()
    .prepare(
      `SELECT point FROM game_odds_history
       WHERE event_id = ? AND market = 'total' AND point IS NOT NULL
       ORDER BY observed_at ASC LIMIT 1`,
    )
    .get(eventId) as { point: number } | undefined;
  return row?.point ?? null;
}

export function readPropOddsForGame(gameId: string): PropOddsRow[] {
  return (getDb()
    .prepare(`SELECT ${PROP_ODDS_COLUMNS} FROM prop_odds WHERE game_id = ? ORDER BY subject_id, market_key, bookmaker`)
    .all(gameId) as any[]).map(mapPropOddsRow);
}

export function readPropOddsForSubject(gameId: string, subjectId: string): PropOddsRow[] {
  return (getDb()
    .prepare(
      `SELECT ${PROP_ODDS_COLUMNS} FROM prop_odds WHERE game_id = ? AND subject_id = ? ORDER BY market_key, bookmaker`,
    )
    .all(gameId, subjectId) as any[]).map(mapPropOddsRow);
}

/** Most recent `fetched_at` this provider has for this game — the basis for Tier 2 cooldowns. */
export function lastPropFetch(providerId: string, gameId: string): string | null {
  const row = getDb()
    .prepare(`SELECT MAX(fetched_at) AS latest FROM prop_odds WHERE provider_id = ? AND game_id = ?`)
    .get(providerId, gameId) as { latest: string | null };
  return row?.latest ?? null;
}

// ---------------------------------------------------------------------------
// Provider usage (budget tracking per provider, per billing period)
// ---------------------------------------------------------------------------

export interface ProviderUsageRow {
  providerId: string;
  periodKind: 'daily' | 'monthly';
  periodKey: string;
  requestCount: number;
  objectCount: number;
  updatedAt: string;
}

export function getProviderUsage(
  providerId: string,
  periodKind: 'daily' | 'monthly',
  periodKey: string,
): ProviderUsageRow {
  const row = getDb()
    .prepare(
      `SELECT provider_id AS providerId, period_kind AS periodKind, period_key AS periodKey,
              request_count AS requestCount, object_count AS objectCount, updated_at AS updatedAt
       FROM provider_usage WHERE provider_id = ? AND period_kind = ? AND period_key = ?`,
    )
    .get(providerId, periodKind, periodKey) as ProviderUsageRow | undefined;
  return row ?? { providerId, periodKind, periodKey, requestCount: 0, objectCount: 0, updatedAt: new Date(0).toISOString() };
}

/** Adds to this period's counters, creating the row if this is the period's first spend. */
export function incrementProviderUsage(
  providerId: string,
  periodKind: 'daily' | 'monthly',
  periodKey: string,
  requests: number,
  objects: number,
): void {
  getDb()
    .prepare(
      `INSERT INTO provider_usage (provider_id, period_kind, period_key, request_count, object_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (provider_id, period_kind, period_key) DO UPDATE SET
         request_count = request_count + excluded.request_count,
         object_count  = object_count + excluded.object_count,
         updated_at    = excluded.updated_at`,
    )
    .run(providerId, periodKind, periodKey, requests, objects, new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Unresolved odds rows (diagnostics)
// ---------------------------------------------------------------------------

export interface UnresolvedOddsRow {
  id: number;
  providerId: string;
  kind: string;
  rawValue: string;
  context: string | null;
  seenAt: string;
}

export function replaceUnresolvedForProvider(
  providerId: string,
  rows: Array<{ kind: string; rawValue: string; context?: string | null }>,
): void {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare('DELETE FROM odds_unresolved WHERE provider_id = ?').run(providerId);
    const insert = db.prepare(
      'INSERT INTO odds_unresolved (provider_id, kind, raw_value, context) VALUES (?, ?, ?, ?)',
    );
    for (const r of rows) insert.run(providerId, r.kind, r.rawValue, r.context ?? null);
  });
  run();
}

export function listUnresolved(): UnresolvedOddsRow[] {
  return getDb()
    .prepare(
      `SELECT id, provider_id AS providerId, kind, raw_value AS rawValue, context, seen_at AS seenAt
       FROM odds_unresolved ORDER BY provider_id, kind, seen_at DESC`,
    )
    .all() as UnresolvedOddsRow[];
}

export interface SurfacedEntry {
  sport: string;
  subjectId: string;
  subjectName: string;
  dimension: string;
  category: string;
  marketKey: string | null;
  line: number | null;
  gameId: string | null;
  sampleSize: number;
  distance: number | null;
  eventContext: string | null;
  /** Phase C.1's edge snapshot — optional because C.0's grading has value before the model exists. */
  modelProb?: number | null;
  marketProb?: number | null;
  edge?: number | null;
  priceSource?: string | null;
  bookmaker?: string | null;
  priceCapturedAt?: string | null;
  /** Prop Score v1 — locked at the same moment as everything else on this row via the same INSERT OR IGNORE, never recomputed after. */
  propScore?: number | null;
  scoreGrade?: string | null;
  trustTier?: string | null;
  /** Which model_weights version (sport/market/version) produced modelProb — fitted markets only (moneyline/total/home-run); null for the shared Beta-Binomial props pipeline. */
  modelVersion?: number | null;
}

/**
 * One row per real-world proposition the day's scan surfaced, keyed on
 * (sport, subject, dimension, category, game) — `INSERT OR IGNORE` because
 * this is called on every snapshot refresh (every ~3 minutes) and a
 * candidate surfaced at 1pm and still surfaced at 1:03pm is the same
 * proposition, not two data points to grade separately.
 */
export function logSurfaced(entries: SurfacedEntry[]): void {
  if (entries.length === 0) return;
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO pick_history
       (sport, subject_id, subject_name, dimension, category, market_key, line, game_id,
        sample_size, distance, event_context, model_prob, market_prob, edge, price_source, bookmaker, price_captured_at,
        prop_score, score_grade, trust_tier, model_version)
     VALUES (@sport, @subjectId, @subjectName, @dimension, @category, @marketKey, @line, @gameId,
             @sampleSize, @distance, @eventContext, @modelProb, @marketProb, @edge, @priceSource, @bookmaker, @priceCapturedAt,
             @propScore, @scoreGrade, @trustTier, @modelVersion)`,
  );
  const run = db.transaction((rows: SurfacedEntry[]) => {
    for (const r of rows) {
      insert.run({
        sport: r.sport,
        subjectId: r.subjectId,
        subjectName: r.subjectName,
        dimension: r.dimension,
        category: r.category,
        marketKey: r.marketKey,
        line: r.line,
        gameId: r.gameId,
        sampleSize: r.sampleSize,
        distance: r.distance,
        eventContext: r.eventContext,
        modelProb: r.modelProb ?? null,
        marketProb: r.marketProb ?? null,
        edge: r.edge ?? null,
        priceSource: r.priceSource ?? null,
        bookmaker: r.bookmaker ?? null,
        priceCapturedAt: r.priceCapturedAt ?? null,
        propScore: r.propScore ?? null,
        scoreGrade: r.scoreGrade ?? null,
        trustTier: r.trustTier ?? null,
        modelVersion: r.modelVersion ?? null,
      });
    }
  });
  run(entries);
}

// ---------------------------------------------------------------------------
// Phase C.0 — grading
// ---------------------------------------------------------------------------

/** Every subject_id the live app has ever surfaced — the backfill job's player list. */
export function listKnownSubjects(sport: string): string[] {
  return (getDb().prepare(`SELECT DISTINCT subject_id AS id FROM pick_history WHERE sport = ?`).all(sport) as { id: string }[]).map(
    (r) => r.id,
  );
}

export interface UngradedRow {
  id: number;
  subjectId: string;
  dimension: string;
  category: string;
  line: number | null;
  marketKey: string | null;
  modelProb: number | null;
  surfacedAt: string;
}

/** Every game with at least one ungraded row — the grading job's work list. */
export function listUngradedGameIds(): string[] {
  const rows = getDb()
    .prepare(`SELECT DISTINCT game_id AS gameId FROM pick_history WHERE outcome IS NULL AND game_id IS NOT NULL`)
    .all() as { gameId: string }[];
  return rows.map((r) => r.gameId);
}

export function listUngradedForGame(gameId: string): UngradedRow[] {
  return getDb()
    .prepare(
      `SELECT id, subject_id AS subjectId, dimension, category, line,
              market_key AS marketKey, model_prob AS modelProb, surfaced_at AS surfacedAt
       FROM pick_history WHERE outcome IS NULL AND game_id = ?`,
    )
    .all(gameId) as UngradedRow[];
}

export interface PropOddsHistoryPoint {
  providerId: string;
  bookmaker: string;
  side: string;
  americanOdds: number;
  decimalOdds: number | null;
  observedAt: string;
  isDelayed: number;
  delaySeconds: number | null;
}

/** Every historical price point for one exact market+line — grading joins this against surfaced_at to find the market's side of the edge, after the fact. */
export function readPropOddsHistoryForKey(
  gameId: string,
  subjectId: string,
  marketKey: string,
  line: number | null,
): PropOddsHistoryPoint[] {
  return getDb()
    .prepare(
      `SELECT provider_id AS providerId, bookmaker, side, american_odds AS americanOdds, decimal_odds AS decimalOdds,
              observed_at AS observedAt, is_delayed AS isDelayed, delay_seconds AS delaySeconds
       FROM prop_odds_history
       WHERE game_id = ? AND subject_id = ? AND market_key = ? AND line IS ?`,
    )
    .all(gameId, subjectId, marketKey, line) as PropOddsHistoryPoint[];
}

export interface GradeResult {
  id: number;
  outcome: 'win' | 'loss';
  actualValue: number | null;
  marketProb?: number | null;
  edge?: number | null;
  priceSource?: string | null;
  bookmaker?: string | null;
  priceCapturedAt?: string | null;
}

export interface BackfillEntry {
  sport: string;
  subjectId: string;
  subjectName: string;
  dimension: string;
  category: string;
  marketKey: string | null;
  line: number;
  gameId: string;
  sampleSize: number;
  modelProb: number;
  outcome: 'win' | 'loss';
  actualValue: number;
  surfacedAt: string;
}

/**
 * Phase C.0.4's historical backfill — writes an already-graded row directly
 * (the gamelog entry used to predict it also carries the actual result, so
 * there's no separate grading pass needed). `INSERT OR IGNORE` on the same
 * unique key as live rows makes re-running the backfill idempotent.
 */
export function writeBackfill(entries: BackfillEntry[]): number {
  if (entries.length === 0) return 0;
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO pick_history
       (sport, subject_id, subject_name, dimension, category, market_key, line, game_id,
        sample_size, distance, event_context, model_prob, outcome, actual_value, surfaced_at, graded_at)
     VALUES (@sport, @subjectId, @subjectName, @dimension, @category, @marketKey, @line, @gameId,
             @sampleSize, NULL, 'backfill', @modelProb, @outcome, @actualValue, @surfacedAt, @surfacedAt)`,
  );
  let written = 0;
  const run = db.transaction((rows: BackfillEntry[]) => {
    for (const r of rows) {
      const info = insert.run(r);
      if (info.changes > 0) written += 1;
    }
  });
  run(entries);
  return written;
}

// ---------------------------------------------------------------------------
// Calibration (Phase C.0.5 — reads pick_history for /diagnostics)
// ---------------------------------------------------------------------------

export interface CalibrationCounts {
  totalRows: number;
  gradedRows: number;
  ungradedRows: number;
  backfillRows: number;
  liveRows: number;
  withModelProb: number;
}

/**
 * 'moneyline' and 'total' are the two game-level dimensions logged — this is
 * how player-prop and game-model calibration stay visually separate rather
 * than blending into one misleading number. (Previously only 'moneyline' was
 * treated as game-level, which silently folded every totals prediction into
 * the player-prop scope instead — fixed as part of bringing totals to
 * calibration parity with moneyline.)
 */
export type CalibrationScope = 'all' | 'player' | 'game';

const GAME_DIMENSIONS = `('moneyline', 'total')`;

function scopeClause(scope: CalibrationScope): string {
  if (scope === 'game') return `AND dimension IN ${GAME_DIMENSIONS}`;
  if (scope === 'player') return `AND dimension NOT IN ${GAME_DIMENSIONS}`;
  return '';
}

export function calibrationCounts(sport: string, scope: CalibrationScope = 'all'): CalibrationCounts {
  const db = getDb();
  const clause = scopeClause(scope);
  const row = (key: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM pick_history WHERE sport = ? AND ${key} ${clause}`).get(sport) as { n: number }).n;
  return {
    totalRows: row('1=1'),
    gradedRows: row('outcome IS NOT NULL'),
    ungradedRows: row('outcome IS NULL'),
    backfillRows: row(`event_context = 'backfill'`),
    liveRows: row(`(event_context IS NULL OR event_context != 'backfill')`),
    withModelProb: row('model_prob IS NOT NULL AND outcome IS NOT NULL'),
  };
}

export interface CalibrationBucket {
  bucket: number;
  n: number;
  wins: number;
}

/** Reliability diagram data — predicted-probability bucket vs. realized win rate. */
export function calibrationBuckets(sport: string, scope: CalibrationScope = 'all'): CalibrationBucket[] {
  return getDb()
    .prepare(
      `SELECT CAST(model_prob * 10 AS INT) / 10.0 AS bucket,
              COUNT(*) AS n,
              SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins
       FROM pick_history
       WHERE sport = ? AND model_prob IS NOT NULL AND outcome IS NOT NULL ${scopeClause(scope)}
       GROUP BY bucket ORDER BY bucket`,
    )
    .all(sport) as CalibrationBucket[];
}

/** Same reliability-diagram shape as calibrationBuckets, but for one specific dimension (e.g. 'moneyline' or 'total') rather than a scope — lets the two game markets get their own reliability diagram instead of being blended into one. */
export function calibrationBucketsForDimension(sport: string, dimension: string): CalibrationBucket[] {
  return getDb()
    .prepare(
      `SELECT CAST(model_prob * 10 AS INT) / 10.0 AS bucket,
              COUNT(*) AS n,
              SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins
       FROM pick_history
       WHERE sport = ? AND dimension = ? AND model_prob IS NOT NULL AND outcome IS NOT NULL
       GROUP BY bucket ORDER BY bucket`,
    )
    .all(sport, dimension) as CalibrationBucket[];
}

export function calibrationCountsForDimension(sport: string, dimension: string): CalibrationCounts {
  const db = getDb();
  const row = (key: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM pick_history WHERE sport = ? AND dimension = ? AND ${key}`).get(sport, dimension) as { n: number }).n;
  return {
    totalRows: row('1=1'),
    gradedRows: row('outcome IS NOT NULL'),
    ungradedRows: row('outcome IS NULL'),
    backfillRows: row(`event_context = 'backfill'`),
    liveRows: row(`(event_context IS NULL OR event_context != 'backfill')`),
    withModelProb: row('model_prob IS NOT NULL AND outcome IS NOT NULL'),
  };
}

export interface MarketCalibration {
  dimension: string;
  n: number;
  wins: number;
  brierScore: number | null;
}

export function calibrationByMarket(sport: string): MarketCalibration[] {
  return getDb()
    .prepare(
      `SELECT dimension,
              COUNT(*) AS n,
              SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins,
              AVG((model_prob - (CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END)) *
                  (model_prob - (CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END))) AS brierScore
       FROM pick_history
       WHERE sport = ? AND model_prob IS NOT NULL AND outcome IS NOT NULL
       GROUP BY dimension ORDER BY n DESC`,
    )
    .all(sport) as MarketCalibration[];
}

export interface LiveDriftBrier {
  brier: number | null;
  games: number;
}

/**
 * Rolling Brier from the most recent REAL graded picks only (excludes
 * backfill rows entirely — this is meant to catch the live model quietly
 * drifting worse between refits, e.g. a stale data source or a market-regime
 * shift, which a backfill-dominated aggregate would never surface). Ordered
 * by grading time so "most recent N" means the actual latest live games, not
 * an arbitrary row order.
 */
export function liveCalibrationBrier(sport: string, dimension: string, limit: number): LiveDriftBrier {
  const row = getDb()
    .prepare(
      `SELECT AVG((model_prob - actual) * (model_prob - actual)) AS brier, COUNT(*) AS games
       FROM (
         SELECT model_prob, CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END AS actual
         FROM pick_history
         WHERE sport = ? AND dimension = ? AND (event_context IS NULL OR event_context != 'backfill')
               AND outcome IS NOT NULL AND model_prob IS NOT NULL
         ORDER BY graded_at DESC LIMIT ?
       )`,
    )
    .get(sport, dimension, limit) as { brier: number | null; games: number };
  return { brier: row.brier, games: row.games };
}

export interface LiveMarketSkill {
  dimension: string;
  n: number;
  /** Brier Skill Score vs. that dimension's own live win rate as the naive baseline — null when the win rate is 0 or 1 (no variance to compare against), not when there's simply no signal. */
  bss: number | null;
}

/**
 * Prop Score v1 — live-only (non-backfill) Brier Skill Score per dimension,
 * the input to marketTrust.ts's `trustTierFromLiveBSS`. Deliberately BSS
 * against that dimension's own live win rate, not raw Brier against a flat
 * 0.25 — raw Brier isn't fair to compare across a 10%-base-rate market
 * (home runs) and a 50%-base-rate one (walks), since a rare-event market can
 * look "well-calibrated" on raw Brier just by sitting at a low base rate
 * regardless of actual skill. Backfill rows are excluded on purpose — they
 * were scored under a simpler, non-live trailing-rate formula (see
 * modelBackfill.ts's file comment), and blending them in would measure an
 * old methodology's calibration, not today's live model's.
 */
export function liveMarketSkill(sport: string): LiveMarketSkill[] {
  const rows = getDb()
    .prepare(
      `SELECT dimension,
              COUNT(*) AS n,
              SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins,
              AVG((model_prob - (CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END)) *
                  (model_prob - (CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END))) AS brier
       FROM pick_history
       WHERE sport = ? AND model_prob IS NOT NULL AND outcome IS NOT NULL
             AND (event_context IS NULL OR event_context != 'backfill')
       GROUP BY dimension`,
    )
    .all(sport) as { dimension: string; n: number; wins: number; brier: number }[];

  return rows.map((r) => {
    const p = r.wins / r.n;
    const naiveBrier = p * (1 - p);
    const bss = naiveBrier > 0 ? 1 - r.brier / naiveBrier : null;
    return { dimension: r.dimension, n: r.n, bss };
  });
}

export interface ScoreTierRecord {
  grade: string;
  n: number;
  wins: number;
  winRate: number | null;
}

/**
 * Prop Score v1's own graded track record, broken out by letter grade —
 * "how did B+ props actually do" — live-only (non-backfill; backfill rows
 * predate this feature entirely and never have a score_grade). Populates as
 * real games grade from this batch onward; returns an empty array rather
 * than erroring against today's near-empty graded set.
 */
export function scoreRecord(sport: string): ScoreTierRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT score_grade AS grade,
              COUNT(*) AS n,
              SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins
       FROM pick_history
       WHERE sport = ? AND score_grade IS NOT NULL AND outcome IS NOT NULL
             AND (event_context IS NULL OR event_context != 'backfill')
       GROUP BY score_grade ORDER BY score_grade`,
    )
    .all(sport) as { grade: string; n: number; wins: number }[];
  return rows.map((r) => ({ grade: r.grade, n: r.n, wins: r.wins, winRate: r.n > 0 ? r.wins / r.n : null }));
}

export interface LeagueBaseRate {
  dimension: string;
  rate: number;
  n: number;
}

/**
 * League-wide P(actual > line) per market, from every graded row this app
 * has ever seen (backfilled + live) — the center of Phase C.1's Beta prior.
 * Reads `actual_value`/`line` directly rather than the stored `outcome`,
 * because backfill rows are always recorded as 'over' while live rows can be
 * either side — the raw value comparison is the one thing that means the
 * same thing regardless of which side a candidate was surfaced on.
 */
export function leagueBaseRates(sport: string): LeagueBaseRate[] {
  return getDb()
    .prepare(
      `SELECT dimension,
              AVG(CASE WHEN actual_value > line THEN 1.0 ELSE 0.0 END) AS rate,
              COUNT(*) AS n
       FROM pick_history
       WHERE sport = ? AND outcome IS NOT NULL AND actual_value IS NOT NULL AND line IS NOT NULL
       GROUP BY dimension`,
    )
    .all(sport) as LeagueBaseRate[];
}

export function overallBrierScore(sport: string, scope: CalibrationScope = 'all'): number | null {
  const row = getDb()
    .prepare(
      `SELECT AVG((model_prob - (CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END)) *
                  (model_prob - (CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END))) AS brier
       FROM pick_history WHERE sport = ? AND model_prob IS NOT NULL AND outcome IS NOT NULL ${scopeClause(scope)}`,
    )
    .get(sport) as { brier: number | null };
  return row.brier;
}

export interface GoodBetsRecord {
  wins: number;
  losses: number;
  total: number;
  winRate: number | null;
}

/**
 * The Good Bets engine's actual track record — a retroactive read over
 * every graded pick_history row that WOULD have passed lib/odds/goodBets.ts's
 * isGoodBet() criteria at the time. `trustedDimensions` has to be passed in
 * rather than recomputed here, since "trusted" is itself a live calibration
 * read (calibrationByMarket) that the caller already has to compute for the
 * live filtering paths — this just reuses it. Uses market_prob (not a raw
 * price, which isn't stored) as the -300 price-ceiling proxy — see
 * GOOD_BET_MAX_MARKET_PROB_PROXY's own comment for why that's conservative.
 *
 * Edge is no longer a hard ≥3% requirement, matching isGoodBet's own v3
 * change (see goodBets.ts's file comment) — a known-negative edge still
 * disqualifies, but a null edge (no price history to join against) doesn't.
 * Same relaxation for the price ceiling itself (matching goodBets.ts's v8):
 * a *known* market_prob over the proxy still excludes, but a row with no
 * market_prob at all (no price history ever joined) no longer does either.
 * This function can't reproduce isGoodBet's performance/matchup checks —
 * pick_history doesn't store windowed history or matchup favorability per
 * row — so this remains a partial match on the live gate, not an exact one.
 *
 * `sinceIso`, when passed, excludes everything surfaced before it. Two
 * reasons this exists: (1) the caller is expected to pass only game-level
 * dimensions now (`goodBets.ts`'s `GAME_LEVEL_DIMENSIONS`) — the record
 * dropped player props entirely, since Scan hands those over as data for the
 * user to judge rather than picks this app is making; (2) ~242k of this
 * table's rows are historical backfill scored under a much simpler, non-live
 * model — blending that in measures an old methodology, not today's engine.
 * A cutoff at this feature's relaunch means the record starts sparse but
 * actually reflects live picks.
 */
export function goodBetsRecord(
  sport: string,
  trustedDimensions: string[],
  sinceIso?: string,
  minSampleSize = 6,
  maxMarketProb = 0.72,
): GoodBetsRecord {
  if (trustedDimensions.length === 0) return { wins: 0, losses: 0, total: 0, winRate: null };
  const placeholders = trustedDimensions.map(() => '?').join(',');
  const row = getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins
       FROM pick_history
       WHERE sport = ? AND outcome IS NOT NULL
         AND (edge IS NULL OR edge >= 0) AND sample_size >= ? AND (market_prob IS NULL OR market_prob <= ?)
         AND dimension IN (${placeholders})
         ${sinceIso ? 'AND surfaced_at >= ?' : ''}`,
    )
    .get(sport, minSampleSize, maxMarketProb, ...trustedDimensions, ...(sinceIso ? [sinceIso] : [])) as {
    total: number;
    wins: number;
  };
  const losses = row.total - row.wins;
  return { wins: row.wins, losses, total: row.total, winRate: row.total > 0 ? row.wins / row.total : null };
}

// ---------------------------------------------------------------------------
// Linesmith Pick lock system (game_picks)
// ---------------------------------------------------------------------------

export interface GamePickIdentity {
  sport: string;
  gameId: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  matchup: string | null;
  commenceTime: string | null;
}

/** Ensures the identity row exists, keeping commence time fresh (postponements move it). */
export function ensureGamePickRow(identity: GamePickIdentity): void {
  getDb()
    .prepare(
      `INSERT INTO game_picks (sport, game_id, home_team_id, away_team_id, home_team_name, away_team_name, matchup, commence_time)
       VALUES (@sport, @gameId, @homeTeamId, @awayTeamId, @homeTeamName, @awayTeamName, @matchup, @commenceTime)
       ON CONFLICT (sport, game_id) DO UPDATE SET
         home_team_id   = excluded.home_team_id,
         away_team_id   = excluded.away_team_id,
         home_team_name = excluded.home_team_name,
         away_team_name = excluded.away_team_name,
         matchup        = excluded.matchup,
         commence_time  = excluded.commence_time`,
    )
    .run(identity);
}

export interface GamePickRow {
  id: number;
  sport: string;
  gameId: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  matchup: string | null;
  commenceTime: string | null;
  mlInitialSide: 'home' | 'away' | null;
  mlInitialProb: number | null;
  mlInitialCapturedAt: string | null;
  mlInitialLate: boolean;
  mlInitialPrice: number | null;
  /** 90% confidence interval for mlInitialProb — null when no fitted model with a covariance matrix was active at capture time. */
  mlInitialProbLower: number | null;
  mlInitialProbUpper: number | null;
  mlFinalSide: 'home' | 'away' | null;
  mlFinalProb: number | null;
  mlFinalCapturedAt: string | null;
  mlFinalLate: boolean;
  mlFinalPrice: number | null;
  mlFinalProbLower: number | null;
  mlFinalProbUpper: number | null;
  totalInitialSide: 'over' | 'under' | null;
  totalInitialProb: number | null;
  totalInitialLine: number | null;
  totalInitialCapturedAt: string | null;
  totalInitialLate: boolean;
  totalInitialPrice: number | null;
  /** 90% confidence interval for totalInitialProb — null when no fitted total-market model with a covariance matrix was active at capture time. */
  totalInitialProbLower: number | null;
  totalInitialProbUpper: number | null;
  totalFinalSide: 'over' | 'under' | null;
  totalFinalProb: number | null;
  totalFinalLine: number | null;
  totalFinalCapturedAt: string | null;
  totalFinalLate: boolean;
  totalFinalPrice: number | null;
  totalFinalProbLower: number | null;
  totalFinalProbUpper: number | null;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
  mlOutcome: 'win' | 'loss' | null;
  totalOutcome: 'win' | 'loss' | null;
  gradedAt: string | null;
  /** Raw feature breakdown behind each capture, JSON-encoded — see lib/core/gamePickLock.ts's feature builders. Parse with JSON.parse; null before that slot is captured. */
  initialMlFeaturesJson: string | null;
  finalMlFeaturesJson: string | null;
  initialTotalFeaturesJson: string | null;
  finalTotalFeaturesJson: string | null;
}

const GAME_PICK_COLUMNS = `
  id, sport, game_id AS gameId,
  home_team_id AS homeTeamId, away_team_id AS awayTeamId,
  home_team_name AS homeTeamName, away_team_name AS awayTeamName,
  matchup, commence_time AS commenceTime,
  ml_initial_side AS mlInitialSide, ml_initial_prob AS mlInitialProb,
  ml_initial_captured_at AS mlInitialCapturedAt, ml_initial_late AS mlInitialLate,
  ml_initial_price AS mlInitialPrice,
  ml_initial_prob_lower AS mlInitialProbLower, ml_initial_prob_upper AS mlInitialProbUpper,
  ml_final_side AS mlFinalSide, ml_final_prob AS mlFinalProb,
  ml_final_captured_at AS mlFinalCapturedAt, ml_final_late AS mlFinalLate,
  ml_final_price AS mlFinalPrice,
  ml_final_prob_lower AS mlFinalProbLower, ml_final_prob_upper AS mlFinalProbUpper,
  total_initial_side AS totalInitialSide, total_initial_prob AS totalInitialProb,
  total_initial_line AS totalInitialLine, total_initial_captured_at AS totalInitialCapturedAt,
  total_initial_late AS totalInitialLate, total_initial_price AS totalInitialPrice,
  total_initial_prob_lower AS totalInitialProbLower, total_initial_prob_upper AS totalInitialProbUpper,
  total_final_side AS totalFinalSide, total_final_prob AS totalFinalProb,
  total_final_line AS totalFinalLine, total_final_captured_at AS totalFinalCapturedAt,
  total_final_late AS totalFinalLate, total_final_price AS totalFinalPrice,
  total_final_prob_lower AS totalFinalProbLower, total_final_prob_upper AS totalFinalProbUpper,
  final_home_score AS finalHomeScore, final_away_score AS finalAwayScore,
  ml_outcome AS mlOutcome, total_outcome AS totalOutcome, graded_at AS gradedAt,
  initial_ml_features_json AS initialMlFeaturesJson, final_ml_features_json AS finalMlFeaturesJson,
  initial_total_features_json AS initialTotalFeaturesJson, final_total_features_json AS finalTotalFeaturesJson
`;

function mapGamePickRow(row: any): GamePickRow {
  return {
    ...row,
    mlInitialLate: !!row.mlInitialLate,
    mlFinalLate: !!row.mlFinalLate,
    totalInitialLate: !!row.totalInitialLate,
    totalFinalLate: !!row.totalFinalLate,
  };
}

export function getGamePick(sport: string, gameId: string): GamePickRow | null {
  const row = getDb()
    .prepare(`SELECT ${GAME_PICK_COLUMNS} FROM game_picks WHERE sport = ? AND game_id = ?`)
    .get(sport, gameId);
  return row ? mapGamePickRow(row) : null;
}

/** Games with at least one open slot to fill or grade — the lock engine's work list. */
export function listGamePicksForLockCycle(sport: string): GamePickRow[] {
  return (
    getDb()
      .prepare(
        `SELECT ${GAME_PICK_COLUMNS} FROM game_picks
         WHERE sport = ? AND (ml_final_captured_at IS NULL OR total_final_captured_at IS NULL OR graded_at IS NULL)`,
      )
      .all(sport) as any[]
  ).map(mapGamePickRow);
}

export interface MoneylinePickCapture {
  sport: string;
  gameId: string;
  slot: 'initial' | 'final';
  side: 'home' | 'away';
  prob: number;
  late: boolean;
  /** JSON-encoded feature breakdown (raw log5, venue/form edges, park factor, market prob, blend weight...) — see gamePickLock.ts. */
  featuresJson?: string | null;
  /** 90% confidence interval bounds for `prob`, for the picked side — null when no fitted model with a covariance matrix was active at capture time. */
  probLower?: number | null;
  probUpper?: number | null;
}

/** Only writes if this exact slot hasn't been captured yet — a slot, once locked, never moves. */
export function captureMoneylinePick(c: MoneylinePickCapture): void {
  const capturedAt = new Date().toISOString();
  const col = c.slot === 'initial' ? 'ml_initial' : 'ml_final';
  const featuresCol = c.slot === 'initial' ? 'initial_ml_features_json' : 'final_ml_features_json';
  getDb()
    .prepare(
      `UPDATE game_picks SET ${col}_side = @side, ${col}_prob = @prob, ${col}_captured_at = @capturedAt, ${col}_late = @late, ${featuresCol} = @featuresJson, ${col}_prob_lower = @probLower, ${col}_prob_upper = @probUpper
       WHERE sport = @sport AND game_id = @gameId AND ${col}_captured_at IS NULL`,
    )
    .run({
      sport: c.sport,
      gameId: c.gameId,
      side: c.side,
      prob: c.prob,
      capturedAt,
      late: c.late ? 1 : 0,
      featuresJson: c.featuresJson ?? null,
      probLower: c.probLower ?? null,
      probUpper: c.probUpper ?? null,
    });
}

export interface TotalPickCapture {
  sport: string;
  gameId: string;
  slot: 'initial' | 'final';
  side: 'over' | 'under';
  prob: number;
  line: number;
  late: boolean;
  featuresJson?: string | null;
  /** 90% confidence interval bounds for `prob`, for the picked side — null when no fitted total-market model with a covariance matrix was active at capture time. */
  probLower?: number | null;
  probUpper?: number | null;
}

export function captureTotalPick(c: TotalPickCapture): void {
  const capturedAt = new Date().toISOString();
  const col = c.slot === 'initial' ? 'total_initial' : 'total_final';
  const featuresCol = c.slot === 'initial' ? 'initial_total_features_json' : 'final_total_features_json';
  getDb()
    .prepare(
      `UPDATE game_picks SET ${col}_side = @side, ${col}_prob = @prob, ${col}_line = @line, ${col}_captured_at = @capturedAt, ${col}_late = @late, ${featuresCol} = @featuresJson, ${col}_prob_lower = @probLower, ${col}_prob_upper = @probUpper
       WHERE sport = @sport AND game_id = @gameId AND ${col}_captured_at IS NULL`,
    )
    .run({
      sport: c.sport,
      gameId: c.gameId,
      side: c.side,
      prob: c.prob,
      line: c.line,
      capturedAt,
      late: c.late ? 1 : 0,
      featuresJson: c.featuresJson ?? null,
      probLower: c.probLower ?? null,
      probUpper: c.probUpper ?? null,
    });
}

/**
 * Best-effort odds attachment — the model decides the pick (in /api/mlb,
 * from win probability alone), but the price shown alongside it comes from
 * the separate odds feed (/api/odds/lines), which may run before, after, or
 * never relative to the pick itself. Only ever attaches to a slot that's
 * already locked and whose side matches (never overwrites a mismatched or
 * already-priced slot), so a picked side never ends up displaying the other
 * side's price.
 */
export function attachMoneylinePrice(sport: string, gameId: string, slot: 'initial' | 'final', side: 'home' | 'away', americanOdds: number): void {
  const col = slot === 'initial' ? 'ml_initial' : 'ml_final';
  getDb()
    .prepare(
      `UPDATE game_picks SET ${col}_price = @price
       WHERE sport = @sport AND game_id = @gameId AND ${col}_side = @side AND ${col}_price IS NULL`,
    )
    .run({ sport, gameId, side, price: americanOdds });
}

export function attachTotalPrice(sport: string, gameId: string, slot: 'initial' | 'final', side: 'over' | 'under', americanOdds: number): void {
  const col = slot === 'initial' ? 'total_initial' : 'total_final';
  getDb()
    .prepare(
      `UPDATE game_picks SET ${col}_price = @price
       WHERE sport = @sport AND game_id = @gameId AND ${col}_side = @side AND ${col}_price IS NULL`,
    )
    .run({ sport, gameId, side, price: americanOdds });
}

export interface GamePickGrade {
  sport: string;
  gameId: string;
  homeScore: number;
  awayScore: number;
  mlOutcome: 'win' | 'loss' | null;
  totalOutcome: 'win' | 'loss' | null;
}

export function gradeGamePick(g: GamePickGrade): void {
  getDb()
    .prepare(
      `UPDATE game_picks SET
         final_home_score = @homeScore, final_away_score = @awayScore,
         ml_outcome = @mlOutcome, total_outcome = @totalOutcome, graded_at = @gradedAt
       WHERE sport = @sport AND game_id = @gameId AND graded_at IS NULL`,
    )
    .run({ ...g, gradedAt: new Date().toISOString() });
}

export interface GamePickRecord {
  moneyline: { wins: number; losses: number };
  total: { wins: number; losses: number };
}

/** The record shown on the Scan header — every graded game since this system launched (the table has no rows from before it, by construction). */
export function gamePickRecord(sport: string): GamePickRecord {
  const db = getDb();
  const ml = db
    .prepare(
      `SELECT SUM(CASE WHEN ml_outcome = 'win' THEN 1 ELSE 0 END) AS wins,
              SUM(CASE WHEN ml_outcome = 'loss' THEN 1 ELSE 0 END) AS losses
       FROM game_picks WHERE sport = ? AND ml_outcome IS NOT NULL`,
    )
    .get(sport) as { wins: number | null; losses: number | null };
  const total = db
    .prepare(
      `SELECT SUM(CASE WHEN total_outcome = 'win' THEN 1 ELSE 0 END) AS wins,
              SUM(CASE WHEN total_outcome = 'loss' THEN 1 ELSE 0 END) AS losses
       FROM game_picks WHERE sport = ? AND total_outcome IS NOT NULL`,
    )
    .get(sport) as { wins: number | null; losses: number | null };
  return {
    moneyline: { wins: ml.wins ?? 0, losses: ml.losses ?? 0 },
    total: { wins: total.wins ?? 0, losses: total.losses ?? 0 },
  };
}

/** Full pick history, newest game first, for the diagnostics table. */
export function listGamePickHistory(sport: string, limit = 200): GamePickRow[] {
  return (
    getDb()
      .prepare(
        `SELECT ${GAME_PICK_COLUMNS} FROM game_picks
         WHERE sport = ? AND commence_time IS NOT NULL
         ORDER BY commence_time DESC LIMIT ?`,
      )
      .all(sport, limit) as any[]
  ).map(mapGamePickRow);
}

export function writeGrades(results: GradeResult[]): void {
  if (results.length === 0) return;
  const db = getDb();
  const update = db.prepare(
    `UPDATE pick_history SET
       outcome = @outcome, actual_value = @actualValue, graded_at = @gradedAt,
       market_prob = COALESCE(@marketProb, market_prob),
       edge = COALESCE(@edge, edge),
       price_source = COALESCE(@priceSource, price_source),
       bookmaker = COALESCE(@bookmaker, bookmaker),
       price_captured_at = COALESCE(@priceCapturedAt, price_captured_at)
     WHERE id = @id`,
  );
  const gradedAt = new Date().toISOString();
  const run = db.transaction((rows: GradeResult[]) => {
    for (const r of rows) {
      update.run({
        id: r.id,
        outcome: r.outcome,
        actualValue: r.actualValue,
        gradedAt,
        marketProb: r.marketProb ?? null,
        edge: r.edge ?? null,
        priceSource: r.priceSource ?? null,
        bookmaker: r.bookmaker ?? null,
        priceCapturedAt: r.priceCapturedAt ?? null,
      });
    }
  });
  run(results);
}

// ---------------------------------------------------------------------------
// Park factors (model-upgrade Phase 1)
// ---------------------------------------------------------------------------

export interface ParkFactorRow {
  venueId: number;
  season: number;
  venueName: string;
  factor: number;
  games: number;
  computedAt: string;
}

export function readParkFactors(season: number): ParkFactorRow[] {
  return getDb()
    .prepare(
      `SELECT venue_id AS venueId, season, venue_name AS venueName, factor, games, computed_at AS computedAt
       FROM park_factors WHERE season = ?`,
    )
    .all(season) as ParkFactorRow[];
}

export function writeParkFactors(season: number, rows: Array<{ venueId: number; venueName: string; factor: number; games: number }>): void {
  if (rows.length === 0) return;
  const db = getDb();
  const computedAt = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO park_factors (venue_id, season, venue_name, factor, games, computed_at)
     VALUES (@venueId, @season, @venueName, @factor, @games, @computedAt)
     ON CONFLICT (venue_id, season) DO UPDATE SET
       venue_name = excluded.venue_name, factor = excluded.factor, games = excluded.games, computed_at = excluded.computed_at`,
  );
  const run = db.transaction((items: typeof rows) => {
    for (const r of items) upsert.run({ ...r, season, computedAt });
  });
  run(rows);
}

// ---------------------------------------------------------------------------
// Home Run model's live pitcher-matchup cache
// ---------------------------------------------------------------------------

export interface TeamHrRateAllowedRow {
  teamId: number;
  season: number;
  gamesFaced: number;
  gamesWithHrAllowed: number;
  leagueHrRate: number;
  computedAt: string;
}

export function readTeamHrRateAllowed(season: number): TeamHrRateAllowedRow[] {
  return getDb()
    .prepare(
      `SELECT team_id AS teamId, season, games_faced AS gamesFaced, games_with_hr_allowed AS gamesWithHrAllowed,
              league_hr_rate AS leagueHrRate, computed_at AS computedAt
       FROM team_hr_rate_allowed WHERE season = ?`,
    )
    .all(season) as TeamHrRateAllowedRow[];
}

export function writeTeamHrRateAllowed(
  season: number,
  leagueHrRate: number,
  rows: Array<{ teamId: number; gamesFaced: number; gamesWithHrAllowed: number }>,
): void {
  const db = getDb();
  const computedAt = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO team_hr_rate_allowed (team_id, season, games_faced, games_with_hr_allowed, league_hr_rate, computed_at)
     VALUES (@teamId, @season, @gamesFaced, @gamesWithHrAllowed, @leagueHrRate, @computedAt)
     ON CONFLICT (team_id, season) DO UPDATE SET
       games_faced = excluded.games_faced, games_with_hr_allowed = excluded.games_with_hr_allowed,
       league_hr_rate = excluded.league_hr_rate, computed_at = excluded.computed_at`,
  );
  const run = db.transaction((items: typeof rows) => {
    for (const r of items) upsert.run({ ...r, season, leagueHrRate, computedAt });
  });
  run(rows);
}

// ---------------------------------------------------------------------------
// Live per-game simulation cache (sim engine plan, Phase 7 live-wiring)
// ---------------------------------------------------------------------------

export interface GameSimCacheRow {
  sport: string;
  gameId: string;
  homeWinProb: number;
  expectedTotal: number;
  n: number;
  lineupSource: 'posted' | 'projected';
  computedAt: string;
}

export function readGameSimCache(sport: string, gameId: string): GameSimCacheRow | null {
  const row = getDb()
    .prepare(
      `SELECT sport, game_id AS gameId, home_win_prob AS homeWinProb, expected_total AS expectedTotal,
              n, lineup_source AS lineupSource, computed_at AS computedAt
       FROM game_sim_cache WHERE sport = ? AND game_id = ?`,
    )
    .get(sport, gameId) as GameSimCacheRow | undefined;
  return row ?? null;
}

export function writeGameSimCache(row: GameSimCacheRow): void {
  getDb()
    .prepare(
      `INSERT INTO game_sim_cache (sport, game_id, home_win_prob, expected_total, n, lineup_source, computed_at)
       VALUES (@sport, @gameId, @homeWinProb, @expectedTotal, @n, @lineupSource, @computedAt)
       ON CONFLICT (sport, game_id) DO UPDATE SET
         home_win_prob = excluded.home_win_prob, expected_total = excluded.expected_total,
         n = excluded.n, lineup_source = excluded.lineup_source, computed_at = excluded.computed_at`,
    )
    .run(row);
}

// ---------------------------------------------------------------------------
// Team Elo history (model-upgrade Phase 2)
// ---------------------------------------------------------------------------

export interface EloHistoryRow {
  teamId: number;
  season: number;
  gamePk: number;
  gameDate: string;
  elo: number;
  gamesPlayed: number;
  opponentTeamId: number | null;
  wasHome: boolean;
}

/** Append-only, idempotent via UNIQUE(team_id, season, game_pk) — safe to call for an already-recorded game (no-op) or to re-run a full backfill without duplicating rows. */
export function writeEloHistory(rows: EloHistoryRow[]): number {
  if (rows.length === 0) return 0;
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO team_elo_history (team_id, season, game_pk, game_date, elo, games_played, opponent_team_id, was_home)
     VALUES (@teamId, @season, @gamePk, @gameDate, @elo, @gamesPlayed, @opponentTeamId, @wasHome)`,
  );
  let written = 0;
  const run = db.transaction((items: EloHistoryRow[]) => {
    for (const r of items) {
      const info = insert.run({ ...r, wasHome: r.wasHome ? 1 : 0 });
      if (info.changes > 0) written += 1;
    }
  });
  run(rows);
  return written;
}

export interface CurrentEloRow {
  elo: number;
  gamesPlayed: number;
  gameDate: string;
  opponentTeamId: number | null;
  wasHome: boolean;
}

function mapCurrentEloRow(row: any): CurrentEloRow {
  return { ...row, wasHome: !!row.wasHome };
}

/** A team's most recent rating THIS season — null if they haven't played a rated game yet this season (caller decides whether to fall back to the flat starting value or to a prior-season reversion). */
export function getCurrentElo(teamId: number, season: number): CurrentEloRow | null {
  const row = getDb()
    .prepare(
      `SELECT elo, games_played AS gamesPlayed, game_date AS gameDate, opponent_team_id AS opponentTeamId, was_home AS wasHome
       FROM team_elo_history WHERE team_id = ? AND season = ?
       ORDER BY game_date DESC, id DESC LIMIT 1`,
    )
    .get(teamId, season);
  return row ? mapCurrentEloRow(row) : null;
}

/** A team's most recent rating from ANY season before the given one — the season-reversion path's source value when the team has no rows yet this season. */
export function getLatestEloBeforeSeason(teamId: number, season: number): CurrentEloRow | null {
  const row = getDb()
    .prepare(
      `SELECT elo, games_played AS gamesPlayed, game_date AS gameDate, opponent_team_id AS opponentTeamId, was_home AS wasHome
       FROM team_elo_history WHERE team_id = ? AND season < ?
       ORDER BY season DESC, game_date DESC, id DESC LIMIT 1`,
    )
    .get(teamId, season);
  return row ? mapCurrentEloRow(row) : null;
}

/** The team's single most recent game overall (any season) — used to compute rest days and travel distance for their NEXT game, regardless of season boundaries. */
export function getMostRecentEloGame(teamId: number): CurrentEloRow | null {
  const row = getDb()
    .prepare(
      `SELECT elo, games_played AS gamesPlayed, game_date AS gameDate, opponent_team_id AS opponentTeamId, was_home AS wasHome
       FROM team_elo_history WHERE team_id = ?
       ORDER BY game_date DESC, id DESC LIMIT 1`,
    )
    .get(teamId);
  return row ? mapCurrentEloRow(row) : null;
}

// ---------------------------------------------------------------------------
// Pitcher Game Score history (Elo item 4 — pitcher adjustment)
// ---------------------------------------------------------------------------

export interface PitcherGameScoreRow {
  pitcherId: number;
  teamId: number;
  season: number;
  gamePk: number;
  gameDate: string;
  gameScore: number;
}

export function writePitcherGameScore(rows: PitcherGameScoreRow[]): number {
  if (rows.length === 0) return 0;
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO pitcher_game_score_history (pitcher_id, team_id, season, game_pk, game_date, game_score)
     VALUES (@pitcherId, @teamId, @season, @gamePk, @gameDate, @gameScore)`,
  );
  let written = 0;
  const run = db.transaction((items: PitcherGameScoreRow[]) => {
    for (const r of items) {
      const info = insert.run(r);
      if (info.changes > 0) written += 1;
    }
  });
  run(rows);
  return written;
}

/** A pitcher's most recent N starts, most recent first — the rolling-trend input for the live pitcher adjustment. */
export function recentPitcherGameScores(pitcherId: number, limit: number): number[] {
  const rows = getDb()
    .prepare(`SELECT game_score AS gameScore FROM pitcher_game_score_history WHERE pitcher_id = ? ORDER BY game_date DESC, id DESC LIMIT ?`)
    .all(pitcherId, limit) as { gameScore: number }[];
  return rows.map((r) => r.gameScore);
}

/** A team's own starters' rolling Game Score average this season — the "baseline" a specific start is compared against. */
export function teamBaselineGameScore(teamId: number, season: number, beforeDate: string, limit = 15): number | null {
  const rows = getDb()
    .prepare(
      `SELECT game_score AS gameScore FROM pitcher_game_score_history
       WHERE team_id = ? AND season = ? AND game_date < ?
       ORDER BY game_date DESC, id DESC LIMIT ?`,
    )
    .all(teamId, season, beforeDate, limit) as { gameScore: number }[];
  if (rows.length === 0) return null;
  return rows.reduce((s, r) => s + r.gameScore, 0) / rows.length;
}

// ---------------------------------------------------------------------------
// Fitted model weights (model-upgrade Phase 3)
// ---------------------------------------------------------------------------

export interface ModelWeightsInput {
  sport: string;
  market: 'moneyline' | 'total' | 'home-run';
  featureNames: string[];
  weights: number[];
  intercept: number;
  trainGames: number;
  trainBrier: number;
  holdoutGames: number;
  holdoutBrier: number;
  baselineHoldoutBrier: number | null;
  /** [intercept, weights...] covariance matrix from the fit, for predictProbWithInterval. Null if the fit didn't compute one. */
  covariance: number[][] | null;
  /** Which seasons actually went into this fit — lets a caller (the diagnostics page) verify freshness directly from the row rather than trusting fittedAt alone. */
  trainSeasons: number[];
  holdoutSeasons: number[];
}

export interface ModelWeightsRow {
  id: number;
  sport: string;
  market: string;
  version: number;
  featureNames: string[];
  weights: number[];
  intercept: number;
  trainGames: number;
  trainBrier: number;
  holdoutGames: number;
  holdoutBrier: number;
  baselineHoldoutBrier: number | null;
  active: boolean;
  fittedAt: string;
  covariance: number[][] | null;
  /** Null on rows fitted before this existed — older fit, no season record kept. */
  trainSeasons: number[] | null;
  holdoutSeasons: number[] | null;
}

function mapModelWeightsRow(row: any): ModelWeightsRow {
  return {
    ...row,
    featureNames: JSON.parse(row.featureNames),
    weights: JSON.parse(row.weights),
    active: !!row.active,
    covariance: row.covariance != null ? JSON.parse(row.covariance) : null,
    trainSeasons: row.trainSeasons != null ? JSON.parse(row.trainSeasons) : null,
    holdoutSeasons: row.holdoutSeasons != null ? JSON.parse(row.holdoutSeasons) : null,
  };
}

/** Always writes a new version — fit history is append-only, never overwritten. `activate` decides whether this new row also flips `active` (deactivating whatever was active before for this sport+market). */
export function writeModelWeights(input: ModelWeightsInput, activate: boolean): ModelWeightsRow {
  const db = getDb();
  const nextVersion =
    ((db.prepare(`SELECT MAX(version) AS v FROM model_weights WHERE sport = ? AND market = ?`).get(input.sport, input.market) as { v: number | null }).v ??
      0) + 1;
  const fittedAt = new Date().toISOString();

  const run = db.transaction(() => {
    if (activate) {
      db.prepare(`UPDATE model_weights SET active = 0 WHERE sport = ? AND market = ?`).run(input.sport, input.market);
    }
    db.prepare(
      `INSERT INTO model_weights
         (sport, market, version, feature_names, weights_json, intercept, train_games, train_brier,
          holdout_games, holdout_brier, baseline_holdout_brier, active, fitted_at, covariance_json,
          train_seasons_json, holdout_seasons_json)
       VALUES (@sport, @market, @version, @featureNames, @weights, @intercept, @trainGames, @trainBrier,
               @holdoutGames, @holdoutBrier, @baselineHoldoutBrier, @active, @fittedAt, @covariance,
               @trainSeasons, @holdoutSeasons)`,
    ).run({
      sport: input.sport,
      market: input.market,
      version: nextVersion,
      featureNames: JSON.stringify(input.featureNames),
      weights: JSON.stringify(input.weights),
      intercept: input.intercept,
      trainGames: input.trainGames,
      trainBrier: input.trainBrier,
      holdoutGames: input.holdoutGames,
      holdoutBrier: input.holdoutBrier,
      baselineHoldoutBrier: input.baselineHoldoutBrier,
      active: activate ? 1 : 0,
      fittedAt,
      covariance: input.covariance != null ? JSON.stringify(input.covariance) : null,
      trainSeasons: JSON.stringify(input.trainSeasons),
      holdoutSeasons: JSON.stringify(input.holdoutSeasons),
    });
  });
  run();

  const row = db
    .prepare(`SELECT * FROM model_weights WHERE sport = ? AND market = ? AND version = ?`)
    .get(input.sport, input.market, nextVersion);
  return mapModelWeightsRow(camelizeModelWeightsRow(row));
}

/** SQLite column names are snake_case; the row shape above expects camelCase — this bridges the one-off SELECT * above without a full column alias list. */
function camelizeModelWeightsRow(row: any): any {
  return {
    id: row.id,
    sport: row.sport,
    market: row.market,
    version: row.version,
    featureNames: row.feature_names,
    weights: row.weights_json,
    intercept: row.intercept,
    trainGames: row.train_games,
    trainBrier: row.train_brier,
    holdoutGames: row.holdout_games,
    holdoutBrier: row.holdout_brier,
    baselineHoldoutBrier: row.baseline_holdout_brier,
    active: row.active,
    fittedAt: row.fitted_at,
    covariance: row.covariance_json,
    trainSeasons: row.train_seasons_json,
    holdoutSeasons: row.holdout_seasons_json,
  };
}

export function getActiveModelWeights(sport: string, market: 'moneyline' | 'total' | 'home-run'): ModelWeightsRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM model_weights WHERE sport = ? AND market = ? AND active = 1 ORDER BY version DESC LIMIT 1`)
    .get(sport, market);
  return row ? mapModelWeightsRow(camelizeModelWeightsRow(row)) : null;
}

export function listModelWeightVersions(sport: string, market: 'moneyline' | 'total' | 'home-run'): ModelWeightsRow[] {
  return (
    getDb()
      .prepare(`SELECT * FROM model_weights WHERE sport = ? AND market = ? ORDER BY version DESC`)
      .all(sport, market) as any[]
  ).map((r) => mapModelWeightsRow(camelizeModelWeightsRow(r)));
}

// ---------------------------------------------------------------------------
// Historical odds (ingested, Phase A)
// ---------------------------------------------------------------------------

export interface HistoricalOddsInput {
  season: number;
  gameDate: string;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  mlHomeConsensusProb: number | null;
  mlAwayConsensusProb: number | null;
  totalLine: number | null;
  totalOverConsensusProb: number | null;
  totalUnderConsensusProb: number | null;
  /** Opening-line counterparts — null for any row ingested before this was tracked (re-run ingestion to backfill). */
  mlHomeOpenProb: number | null;
  mlAwayOpenProb: number | null;
  totalOpenLine: number | null;
  totalOpenOverProb: number | null;
  totalOpenUnderProb: number | null;
  source: 'sbr-xlsx' | 'long-csv' | 'scraper-json' | 'oddspapi-historical';
  bookCount: number;
}

/** Upsert on the (season, date, home, away) key — re-running ingestion overwrites rather than duplicates. */
export function writeHistoricalOdds(rows: HistoricalOddsInput[]): number {
  if (rows.length === 0) return 0;
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO historical_odds
       (season, game_date, home_team_id, away_team_id, home_score, away_score,
        ml_home_consensus_prob, ml_away_consensus_prob, total_line,
        total_over_consensus_prob, total_under_consensus_prob,
        ml_home_open_prob, ml_away_open_prob, total_open_line, total_open_over_prob, total_open_under_prob,
        source, book_count)
     VALUES (@season, @gameDate, @homeTeamId, @awayTeamId, @homeScore, @awayScore,
             @mlHomeConsensusProb, @mlAwayConsensusProb, @totalLine,
             @totalOverConsensusProb, @totalUnderConsensusProb,
             @mlHomeOpenProb, @mlAwayOpenProb, @totalOpenLine, @totalOpenOverProb, @totalOpenUnderProb,
             @source, @bookCount)
     ON CONFLICT (season, game_date, home_team_id, away_team_id) DO UPDATE SET
       home_score = excluded.home_score, away_score = excluded.away_score,
       ml_home_consensus_prob = excluded.ml_home_consensus_prob,
       ml_away_consensus_prob = excluded.ml_away_consensus_prob,
       total_line = excluded.total_line,
       total_over_consensus_prob = excluded.total_over_consensus_prob,
       total_under_consensus_prob = excluded.total_under_consensus_prob,
       ml_home_open_prob = excluded.ml_home_open_prob,
       ml_away_open_prob = excluded.ml_away_open_prob,
       total_open_line = excluded.total_open_line,
       total_open_over_prob = excluded.total_open_over_prob,
       total_open_under_prob = excluded.total_open_under_prob,
       source = excluded.source, book_count = excluded.book_count`,
  );
  let written = 0;
  const run = db.transaction((items: HistoricalOddsInput[]) => {
    for (const r of items) {
      upsert.run(r);
      written += 1;
    }
  });
  run(rows);
  return written;
}

export interface HistoricalOddsRow {
  mlHomeConsensusProb: number | null;
  mlAwayConsensusProb: number | null;
  totalLine: number | null;
  totalOverConsensusProb: number | null;
  totalUnderConsensusProb: number | null;
  mlHomeOpenProb: number | null;
  mlAwayOpenProb: number | null;
  totalOpenLine: number | null;
  totalOpenOverProb: number | null;
  totalOpenUnderProb: number | null;
  bookCount: number;
}

/** The join modelFit.ts's training walk uses — one lookup per game, keyed the same way the schedule data already is. */
export function getHistoricalOdds(season: number, gameDate: string, homeTeamId: number, awayTeamId: number): HistoricalOddsRow | null {
  const row = getDb()
    .prepare(
      `SELECT ml_home_consensus_prob AS mlHomeConsensusProb, ml_away_consensus_prob AS mlAwayConsensusProb,
              total_line AS totalLine, total_over_consensus_prob AS totalOverConsensusProb,
              total_under_consensus_prob AS totalUnderConsensusProb,
              ml_home_open_prob AS mlHomeOpenProb, ml_away_open_prob AS mlAwayOpenProb,
              total_open_line AS totalOpenLine, total_open_over_prob AS totalOpenOverProb, total_open_under_prob AS totalOpenUnderProb,
              book_count AS bookCount
       FROM historical_odds WHERE season = ? AND game_date = ? AND home_team_id = ? AND away_team_id = ?`,
    )
    .get(season, gameDate, homeTeamId, awayTeamId) as HistoricalOddsRow | undefined;
  return row ?? null;
}

export function historicalOddsCoverage(): Array<{ season: number; games: number; source: string }> {
  return getDb()
    .prepare(`SELECT season, COUNT(*) AS games, source FROM historical_odds GROUP BY season, source ORDER BY season`)
    .all() as Array<{ season: number; games: number; source: string }>;
}

// ---------------------------------------------------------------------------
// System events — lightweight error log (see schema.ts's own comment on why
// this isn't a full observability stack)
// ---------------------------------------------------------------------------

const SYSTEM_EVENTS_ROW_CAP = 500;

export interface SystemEventInput {
  level: 'error' | 'warning';
  source: string;
  message: string;
  detail?: string | null;
}

/** Prunes down to the cap on every write rather than a background job — this app has no long-running process to schedule one on. */
export function logSystemEvent(input: SystemEventInput): void {
  const db = getDb();
  db.prepare(`INSERT INTO system_events (level, source, message, detail) VALUES (@level, @source, @message, @detail)`).run({
    level: input.level,
    source: input.source,
    message: input.message,
    detail: input.detail ?? null,
  });
  db.prepare(
    `DELETE FROM system_events WHERE id NOT IN (SELECT id FROM system_events ORDER BY occurred_at DESC LIMIT ?)`,
  ).run(SYSTEM_EVENTS_ROW_CAP);
}

export interface SystemEventRow {
  id: number;
  level: 'error' | 'warning';
  source: string;
  message: string;
  detail: string | null;
  occurredAt: string;
}

export function listRecentSystemEvents(limit = 50): SystemEventRow[] {
  return getDb()
    .prepare(
      `SELECT id, level, source, message, detail, occurred_at AS occurredAt
       FROM system_events ORDER BY occurred_at DESC LIMIT ?`,
    )
    .all(limit) as SystemEventRow[];
}

// ---------------------------------------------------------------------------
// DB-wide sanity checks — instant "did ingestion silently stop" read
// ---------------------------------------------------------------------------

/** Every real table this app writes to — a hardcoded list rather than reading sqlite_master, since a few internal/legacy tables (picks, watchlist, watch_links) aren't interesting for an ingestion-health check. */
const HEALTH_TRACKED_TABLES = [
  'pick_history',
  'game_picks',
  'prop_odds',
  'prop_odds_history',
  'game_odds_history',
  'odds_unresolved',
  'park_factors',
  'team_elo_history',
  'pitcher_game_score_history',
  'model_weights',
  'historical_odds',
  'system_events',
  'golf_tournaments',
  'golf_hole_scores',
  'golf_round_scores',
  'golf_tournament_results',
  'golf_model_predictions',
  'golf_tournament_predictions',
] as const;

export interface TableRowCount {
  table: string;
  rows: number;
}

export function dbTableRowCounts(): TableRowCount[] {
  const db = getDb();
  return HEALTH_TRACKED_TABLES.map((table) => ({
    table,
    rows: (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
  }));
}

export interface DataAccumulationRow {
  table: string;
  /** Short, human-readable purpose — shown alongside the table name so this reads as "is X still coming in" rather than a bare table name. */
  label: string;
  rows: number;
  earliest: string | null;
  latest: string | null;
  last24h: number;
  last7d: number;
}

/**
 * "Are we actively accumulating our own data" check — separate from
 * dbTableRowCounts's flat totals, this is specifically about growth over
 * time: no historical player-prop odds exist anywhere to backfill (unlike
 * game-level moneyline/total, which has a real 2010-2025 ingested archive —
 * see historicalOddsCoverage), so prop_odds_history/pick_history's own
 * forward accumulation, starting from whenever this app first ran, IS the
 * only path to a real dataset a year from now. `last24h === 0` on a table
 * that already has historical rows is the actual "ingestion silently
 * stopped" signal this exists to catch — a healthy, actively-used app should
 * never show that.
 *
 * pick_history's surfaced_at is written via SQLite's own `datetime('now')`
 * (space-separated, no 'Z') — cutoffs computed the same way, in-SQL, so the
 * comparison never depends on JS/SQLite date-format parsing agreeing.
 * prop_odds_history/game_odds_history's observed_at is written via JS
 * `Date.toISOString()` ('T'/'Z') — cutoffs computed in JS to match, for the
 * same reason. The two formats are NOT comparable to each other; this
 * function deliberately never mixes them.
 */
export function dataAccumulationSnapshot(): DataAccumulationRow[] {
  const db = getDb();

  function sqliteFormatTable(table: string, column: string, label: string): DataAccumulationRow {
    const totals = db.prepare(`SELECT COUNT(*) AS n, MIN(${column}) AS earliest, MAX(${column}) AS latest FROM ${table}`).get() as {
      n: number;
      earliest: string | null;
      latest: string | null;
    };
    const last24h = (
      db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} >= datetime('now', '-1 day')`).get() as { n: number }
    ).n;
    const last7d = (
      db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} >= datetime('now', '-7 days')`).get() as { n: number }
    ).n;
    return { table, label, rows: totals.n, earliest: totals.earliest, latest: totals.latest, last24h, last7d };
  }

  function isoFormatTable(table: string, column: string, label: string): DataAccumulationRow {
    const totals = db.prepare(`SELECT COUNT(*) AS n, MIN(${column}) AS earliest, MAX(${column}) AS latest FROM ${table}`).get() as {
      n: number;
      earliest: string | null;
      latest: string | null;
    };
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const last24h = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} >= ?`).get(cutoff24h) as { n: number }).n;
    const last7d = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} >= ?`).get(cutoff7d) as { n: number }).n;
    return { table, label, rows: totals.n, earliest: totals.earliest, latest: totals.latest, last24h, last7d };
  }

  return [
    sqliteFormatTable('pick_history', 'surfaced_at', 'Every pick this app has surfaced, graded or not'),
    isoFormatTable('prop_odds_history', 'observed_at', 'Player-prop price history — no backfill exists anywhere for this, forward accumulation only'),
    isoFormatTable('game_odds_history', 'observed_at', 'Moneyline/total price history (live-collected, separate from the ingested 2010-2025 archive)'),
    isoFormatTable('golf_hole_scores', 'ingested_at', 'Golf hole-by-hole scores — started from zero this session, no backfill exists yet (see project memory)'),
    isoFormatTable('golf_round_scores', 'ingested_at', 'Golf full-round totals — same forward-only accumulation as golf_hole_scores'),
    isoFormatTable('golf_tournament_results', 'finished_at', 'Golf final tournament results — the outcome label a tournament-winner model trains against; only grows once an ingested tournament actually finishes'),
  ];
}

export function eloCoverage(): Array<{ season: number; teams: number; rows: number }> {
  return getDb()
    .prepare(
      `SELECT season, COUNT(DISTINCT team_id) AS teams, COUNT(*) AS rows
       FROM team_elo_history GROUP BY season ORDER BY season`,
    )
    .all() as Array<{ season: number; teams: number; rows: number }>;
}

export function parkFactorCoverage(): Array<{ season: number; venues: number; computedAt: string | null }> {
  return getDb()
    .prepare(
      `SELECT season, COUNT(*) AS venues, MAX(computed_at) AS computedAt
       FROM park_factors GROUP BY season ORDER BY season`,
    )
    .all() as Array<{ season: number; venues: number; computedAt: string | null }>;
}

// ---------------------------------------------------------------------------
// Golf prediction-model data layer (see schema.ts's golf_* tables for the
// full rationale — forward accumulation only, started from zero, no
// historical backfill exists yet). Written from
// lib/sports/golf/historyIngest.ts on every snapshot poll; read from the
// eventual golf model files once there's enough of a sample to be useful.
// ---------------------------------------------------------------------------

export interface GolfTournamentInput {
  eventId: string;
  name: string;
  courseName: string | null;
  season: number;
  startDate: string | null;
  holesJson: string | null;
  fieldSize: number | null;
}

export function writeGolfTournament(input: GolfTournamentInput): void {
  getDb()
    .prepare(
      `INSERT INTO golf_tournaments (event_id, name, course_name, season, start_date, holes_json, field_size, updated_at)
       VALUES (@eventId, @name, @courseName, @season, @startDate, @holesJson, @fieldSize, @updatedAt)
       ON CONFLICT (event_id) DO UPDATE SET
         name        = excluded.name,
         course_name = excluded.course_name,
         start_date  = excluded.start_date,
         holes_json  = excluded.holes_json,
         field_size  = excluded.field_size,
         updated_at  = excluded.updated_at`,
    )
    .run({ ...input, updatedAt: new Date().toISOString() });
}

export interface GolfHoleScoreInput {
  eventId: string;
  espnId: string;
  round: number;
  hole: number;
  par: number | null;
  strokes: number | null;
  relativeToPar: number;
  category: 'birdie' | 'par' | 'bogey';
}

/** INSERT OR IGNORE on the (event, golfer, round, hole) key — re-polling an already-ingested hole is a silent no-op, so the caller can just hand every completed hole it sees on every poll without tracking what's new itself. */
export function writeGolfHoleScores(rows: GolfHoleScoreInput[]): number {
  if (rows.length === 0) return 0;
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO golf_hole_scores (event_id, espn_id, round, hole, par, strokes, relative_to_par, category, ingested_at)
     VALUES (@eventId, @espnId, @round, @hole, @par, @strokes, @relativeToPar, @category, @ingestedAt)`,
  );
  let written = 0;
  const ingestedAt = new Date().toISOString();
  const run = db.transaction((items: GolfHoleScoreInput[]) => {
    for (const r of items) {
      const info = insert.run({ ...r, ingestedAt });
      if (info.changes > 0) written += 1;
    }
  });
  run(rows);
  return written;
}

export interface GolfRoundScoreInput {
  eventId: string;
  espnId: string;
  round: number;
  totalStrokes: number | null;
  relativeToPar: number;
  teeWave: 'AM' | 'PM' | null;
  windMph: number | null;
  tempF: number | null;
  precipProb: number | null;
}

export function writeGolfRoundScores(rows: GolfRoundScoreInput[]): number {
  if (rows.length === 0) return 0;
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO golf_round_scores (event_id, espn_id, round, total_strokes, relative_to_par, tee_wave, wind_mph, temp_f, precip_prob, ingested_at)
     VALUES (@eventId, @espnId, @round, @totalStrokes, @relativeToPar, @teeWave, @windMph, @tempF, @precipProb, @ingestedAt)`,
  );
  let written = 0;
  const ingestedAt = new Date().toISOString();
  const run = db.transaction((items: GolfRoundScoreInput[]) => {
    for (const r of items) {
      const info = insert.run({ ...r, ingestedAt });
      if (info.changes > 0) written += 1;
    }
  });
  run(rows);
  return written;
}

export interface GolfTournamentResultInput {
  eventId: string;
  espnId: string;
  position: string | null;
  madeCut: boolean;
  totalScore: number | null;
}

export function writeGolfTournamentResults(rows: GolfTournamentResultInput[]): number {
  if (rows.length === 0) return 0;
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO golf_tournament_results (event_id, espn_id, position, made_cut, total_score, finished_at)
     VALUES (@eventId, @espnId, @position, @madeCut, @totalScore, @finishedAt)
     ON CONFLICT (event_id, espn_id) DO UPDATE SET
       position    = excluded.position,
       made_cut    = excluded.made_cut,
       total_score = excluded.total_score,
       finished_at = excluded.finished_at`,
  );
  let written = 0;
  const finishedAt = new Date().toISOString();
  const run = db.transaction((items: GolfTournamentResultInput[]) => {
    for (const r of items) {
      insert.run({ ...r, madeCut: r.madeCut ? 1 : 0, finishedAt });
      written += 1;
    }
  });
  run(rows);
  return written;
}

export interface GolfHoleScoreHistoryRow {
  eventId: string;
  round: number;
  relativeToPar: number;
  category: 'birdie' | 'par' | 'bogey';
}

/** A golfer's own past history on this exact hole, most recent first — empty today (nothing ingested yet), grows every tournament from here on. Distinct from the current tournament's own `PickCandidate.history` (already live, not DB-backed) — this is what lets a future model see hole N at THIS course across multiple visits, not just this week. */
export function getGolferHoleHistory(espnId: string, hole: number, limit = 40): GolfHoleScoreHistoryRow[] {
  return getDb()
    .prepare(
      `SELECT event_id AS eventId, round, relative_to_par AS relativeToPar, category
       FROM golf_hole_scores WHERE espn_id = ? AND hole = ?
       ORDER BY id DESC LIMIT ?`,
    )
    .all(espnId, hole, limit) as GolfHoleScoreHistoryRow[];
}

export interface GolfCourseHoleBaselineRow {
  hole: number;
  par: number | null;
  rounds: number;
  avgRelativeToPar: number;
}

/** Field-wide scoring baseline for every hole at a given course, across every ingested tournament there — the historical counterpart to GolfScheduleView's live per-week CourseInsightsCard, which only ever sees the current field. Empty until the same course recurs after ingestion has started. */
export function getCourseHoleBaselines(courseName: string): GolfCourseHoleBaselineRow[] {
  return getDb()
    .prepare(
      `SELECT hs.hole AS hole, hs.par AS par, COUNT(*) AS rounds, AVG(hs.relative_to_par) AS avgRelativeToPar
       FROM golf_hole_scores hs
       JOIN golf_tournaments t ON t.event_id = hs.event_id
       WHERE t.course_name = ?
       GROUP BY hs.hole
       ORDER BY hs.hole`,
    )
    .all(courseName) as GolfCourseHoleBaselineRow[];
}

// ---------------------------------------------------------------------------
// Golf model performance tracking — "is it performing," not just "is data
// coming in." Every poll logs the latest prediction for each hole/round-score
// candidate and the whole field's tournament-winner sim; a separate grading
// pass (lib/sports/golf/models/grading.ts) fills in the outcome + Brier
// component once the real result lands in golf_hole_scores/golf_round_scores/
// golf_tournament_results. See schema.ts's golf_model_predictions/
// golf_tournament_predictions for the full design rationale.
// ---------------------------------------------------------------------------

export interface GolfModelPredictionInput {
  eventId: string;
  espnId: string;
  dimension: string;
  round: number;
  category: 'birdie' | 'par' | 'bogey';
  predictedProb: number;
  leagueRate: number | null;
}

/** Upserts the LATEST prediction per (event, golfer, dimension, round) — but only while ungraded. Once a real outcome has graded a row, a later poll's "prediction" (made after the fact) must never overwrite it. */
export function logGolfModelPredictions(rows: GolfModelPredictionInput[]): number {
  if (rows.length === 0) return 0;
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO golf_model_predictions (event_id, espn_id, dimension, round, category, predicted_prob, league_rate, predicted_at)
     VALUES (@eventId, @espnId, @dimension, @round, @category, @predictedProb, @leagueRate, @predictedAt)
     ON CONFLICT (event_id, espn_id, dimension, round) DO UPDATE SET
       category       = excluded.category,
       predicted_prob = excluded.predicted_prob,
       league_rate    = excluded.league_rate,
       predicted_at   = excluded.predicted_at
     WHERE graded_at IS NULL`,
  );
  let written = 0;
  const predictedAt = new Date().toISOString();
  const run = db.transaction((items: GolfModelPredictionInput[]) => {
    for (const r of items) {
      const info = upsert.run({ ...r, predictedAt });
      if (info.changes > 0) written += 1;
    }
  });
  run(rows);
  return written;
}

export interface GolfTournamentPredictionInput {
  eventId: string;
  espnId: string;
  probWin: number;
  probTop5: number;
  probTop10: number;
  probMadeCut: number;
}

export function logGolfTournamentPredictions(rows: GolfTournamentPredictionInput[]): number {
  if (rows.length === 0) return 0;
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO golf_tournament_predictions (event_id, espn_id, prob_win, prob_top5, prob_top10, prob_made_cut, predicted_at)
     VALUES (@eventId, @espnId, @probWin, @probTop5, @probTop10, @probMadeCut, @predictedAt)
     ON CONFLICT (event_id, espn_id) DO UPDATE SET
       prob_win      = excluded.prob_win,
       prob_top5     = excluded.prob_top5,
       prob_top10    = excluded.prob_top10,
       prob_made_cut = excluded.prob_made_cut,
       predicted_at  = excluded.predicted_at
     WHERE graded_at IS NULL`,
  );
  let written = 0;
  const predictedAt = new Date().toISOString();
  const run = db.transaction((items: GolfTournamentPredictionInput[]) => {
    for (const r of items) {
      const info = upsert.run({ ...r, predictedAt });
      if (info.changes > 0) written += 1;
    }
  });
  run(rows);
  return written;
}

export interface UngradedHolePrediction {
  id: number;
  eventId: string;
  espnId: string;
  dimension: string;
  round: number;
  category: 'birdie' | 'par' | 'bogey';
  predictedProb: number;
}

/** Every ungraded hole/round prediction that now has a matching real result to grade against — a hole-N prediction joins golf_hole_scores on (event, golfer, round, hole parsed from the dimension string); a round-score prediction joins golf_round_scores on (event, golfer, round). Returns the prediction plus the real category so the caller (grading.ts) can compute hit/Brier in one place for both dimension shapes. */
export function findGradeableHolePredictions(): Array<UngradedHolePrediction & { actualCategory: string }> {
  const db = getDb();
  const holeRows = db
    .prepare(
      `SELECT p.id AS id, p.event_id AS eventId, p.espn_id AS espnId, p.dimension AS dimension, p.round AS round, p.category AS category, p.predicted_prob AS predictedProb, hs.category AS actualCategory
       FROM golf_model_predictions p
       JOIN golf_hole_scores hs
         ON hs.event_id = p.event_id AND hs.espn_id = p.espn_id AND hs.round = p.round
        AND hs.hole = CAST(SUBSTR(p.dimension, 6) AS INTEGER)
       WHERE p.graded_at IS NULL AND p.dimension LIKE 'hole-%'`,
    )
    .all() as Array<UngradedHolePrediction & { actualCategory: string }>;

  const roundRows = db
    .prepare(
      `SELECT p.id AS id, p.event_id AS eventId, p.espn_id AS espnId, p.dimension AS dimension, p.round AS round, p.category AS category, p.predicted_prob AS predictedProb, rs.category AS actualCategory
       FROM golf_model_predictions p
       JOIN (
         SELECT event_id, espn_id, round,
                CASE WHEN relative_to_par < 0 THEN 'birdie' WHEN relative_to_par = 0 THEN 'par' ELSE 'bogey' END AS category
         FROM golf_round_scores
       ) rs ON rs.event_id = p.event_id AND rs.espn_id = p.espn_id AND rs.round = p.round
       WHERE p.graded_at IS NULL AND p.dimension = 'round-score'`,
    )
    .all() as Array<UngradedHolePrediction & { actualCategory: string }>;

  return [...holeRows, ...roundRows];
}

export interface GradedHolePredictionInput {
  id: number;
  hit: 0 | 1;
  actualCategory: string;
  brierComponent: number;
}

export function writeGradedHolePredictions(rows: GradedHolePredictionInput[]): void {
  if (rows.length === 0) return;
  const db = getDb();
  const update = db.prepare(
    `UPDATE golf_model_predictions SET graded_at = @gradedAt, actual_category = @actualCategory, hit = @hit, brier_component = @brierComponent WHERE id = @id`,
  );
  const gradedAt = new Date().toISOString();
  const run = db.transaction((items: GradedHolePredictionInput[]) => {
    for (const r of items) update.run({ ...r, gradedAt });
  });
  run(rows);
}

export interface UngradedTournamentPrediction {
  eventId: string;
  espnId: string;
  probWin: number;
  probTop5: number;
  probTop10: number;
  probMadeCut: number;
}

/** Every ungraded tournament-winner prediction whose golfer now has a final result recorded — joined against golf_tournament_results, which is itself only written once event.completed is true (see historyIngest.ts), so this never fires mid-tournament. */
export function findGradeableTournamentPredictions(): Array<UngradedTournamentPrediction & { position: string | null; madeCut: number }> {
  return getDb()
    .prepare(
      `SELECT p.event_id AS eventId, p.espn_id AS espnId, p.prob_win AS probWin, p.prob_top5 AS probTop5, p.prob_top10 AS probTop10, p.prob_made_cut AS probMadeCut,
              r.position AS position, r.made_cut AS madeCut
       FROM golf_tournament_predictions p
       JOIN golf_tournament_results r ON r.event_id = p.event_id AND r.espn_id = p.espn_id
       WHERE p.graded_at IS NULL`,
    )
    .all() as Array<UngradedTournamentPrediction & { position: string | null; madeCut: number }>;
}

export interface GradedTournamentPredictionInput {
  eventId: string;
  espnId: string;
  won: 0 | 1;
  top5: 0 | 1;
  top10: 0 | 1;
  madeCut: 0 | 1;
  brierWin: number;
  brierTop5: number;
  brierTop10: number;
  brierMadeCut: number;
}

export function writeGradedTournamentPredictions(rows: GradedTournamentPredictionInput[]): void {
  if (rows.length === 0) return;
  const db = getDb();
  const update = db.prepare(
    `UPDATE golf_tournament_predictions SET
       graded_at = @gradedAt, actual_won = @won, actual_top5 = @top5, actual_top10 = @top10, actual_made_cut = @madeCut,
       brier_win = @brierWin, brier_top5 = @brierTop5, brier_top10 = @brierTop10, brier_made_cut = @brierMadeCut
     WHERE event_id = @eventId AND espn_id = @espnId`,
  );
  const gradedAt = new Date().toISOString();
  const run = db.transaction((items: GradedTournamentPredictionInput[]) => {
    for (const r of items) update.run({ ...r, gradedAt });
  });
  run(rows);
}

export interface GolfCalibrationSummary {
  holeRound: {
    total: number;
    graded: number;
    ungraded: number;
    hitRate: number | null;
    meanBrier: number | null;
  };
  tournament: {
    total: number;
    graded: number;
    ungraded: number;
    winBrier: number | null;
    top5Brier: number | null;
    top10Brier: number | null;
    madeCutBrier: number | null;
  };
}

/** The compact "how is it performing" summary for /diagnostics — real graded history only, not a fabricated placeholder. Every field is null until at least one prediction has actually been graded (a real outcome landed), same "absent, not fabricated" convention propScore.ts follows. */
export function golfCalibrationSummary(): GolfCalibrationSummary {
  const db = getDb();

  const holeRoundTotals = db.prepare(`SELECT COUNT(*) AS n FROM golf_model_predictions`).get() as { n: number };
  const holeRoundGraded = db
    .prepare(`SELECT COUNT(*) AS n, AVG(hit) AS hitRate, AVG(brier_component) AS meanBrier FROM golf_model_predictions WHERE graded_at IS NOT NULL`)
    .get() as { n: number; hitRate: number | null; meanBrier: number | null };

  const tournamentTotals = db.prepare(`SELECT COUNT(*) AS n FROM golf_tournament_predictions`).get() as { n: number };
  const tournamentGraded = db
    .prepare(
      `SELECT COUNT(*) AS n, AVG(brier_win) AS winBrier, AVG(brier_top5) AS top5Brier, AVG(brier_top10) AS top10Brier, AVG(brier_made_cut) AS madeCutBrier
       FROM golf_tournament_predictions WHERE graded_at IS NOT NULL`,
    )
    .get() as { n: number; winBrier: number | null; top5Brier: number | null; top10Brier: number | null; madeCutBrier: number | null };

  return {
    holeRound: {
      total: holeRoundTotals.n,
      graded: holeRoundGraded.n,
      ungraded: holeRoundTotals.n - holeRoundGraded.n,
      hitRate: holeRoundGraded.n > 0 ? holeRoundGraded.hitRate : null,
      meanBrier: holeRoundGraded.n > 0 ? holeRoundGraded.meanBrier : null,
    },
    tournament: {
      total: tournamentTotals.n,
      graded: tournamentGraded.n,
      ungraded: tournamentTotals.n - tournamentGraded.n,
      winBrier: tournamentGraded.n > 0 ? tournamentGraded.winBrier : null,
      top5Brier: tournamentGraded.n > 0 ? tournamentGraded.top5Brier : null,
      top10Brier: tournamentGraded.n > 0 ? tournamentGraded.top10Brier : null,
      madeCutBrier: tournamentGraded.n > 0 ? tournamentGraded.madeCutBrier : null,
    },
  };
}
