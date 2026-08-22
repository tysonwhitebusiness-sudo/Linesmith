/**
 * Postgres (Supabase) data-access layer — Phase 1 SQLite -> Postgres cutover.
 *
 * Every exported function here used to be a synchronous better-sqlite3 call;
 * all 48 are now async against lib/db/pgClient.ts's pool. Every caller of
 * every one of these functions needs an `await` added — that update happens
 * file-by-file across lib/ and app/api/, not in this file.
 *
 * Dialect fixes applied while porting (see the Phase 1 migration notes for
 * the full reasoning — kept brief here per-function instead):
 *   - `INSERT OR IGNORE` -> `ON CONFLICT (...) DO NOTHING`
 *   - `col IS ?` / `col IS @x` (SQLite's null-safe equality) on a genuinely
 *     nullable column -> `col IS NOT DISTINCT FROM ...` (Postgres's `IS`
 *     only means IS NULL/IS TRUE/etc., not null-safe equality to any value)
 *   - `datetime('now', '-N day(s)')` -> `now() - interval 'N days'`
 *   - `info.lastInsertRowid` -> `RETURNING ...` on the INSERT
 *   - `? 1 : 0` boolean-as-integer ternaries -> pass the boolean directly
 *     (every 0/1 flag column is now a real BOOLEAN)
 *   - the 9 `PRAGMA table_info`-based migration-guard functions, and
 *     `checkpointWal()`, are dropped entirely — pure SQLite-local-file
 *     plumbing with no Postgres equivalent; the schema now lives in
 *     supabase/migrations/ as a real versioned migration instead.
 */

import { pgGet, pgAll, pgRun, pgTransaction } from './pgClient';

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
  subject_id      AS "subjectId",
  subject_name    AS "subjectName",
  dimension,
  dimension_label AS "dimensionLabel",
  category,
  category_label  AS "categoryLabel",
  line,
  game_id         AS "gameId",
  team_id         AS "teamId",
  team,
  opponent_id     AS "opponentId",
  opponent,
  american_odds   AS "americanOdds",
  odds_source     AS "oddsSource",
  odds_captured_at AS "oddsCapturedAt",
  bookmaker,
  event_context   AS "eventContext",
  sample_size     AS "sampleSize",
  created_at      AS "createdAt"
`;

export async function listPicks(sport?: string): Promise<PickRow[]> {
  return sport
    ? pgAll<PickRow>(`SELECT ${PICK_COLUMNS} FROM picks WHERE sport = ? ORDER BY created_at DESC, id DESC`, [sport])
    : pgAll<PickRow>(`SELECT ${PICK_COLUMNS} FROM picks ORDER BY created_at DESC, id DESC`);
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
export async function addPick(input: PickInput): Promise<PickRow> {
  const capturedAt = input.americanOdds ? new Date().toISOString() : null;

  await pgRun(
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
    [
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
    ],
  );

  return (await pgGet<PickRow>(
    `SELECT ${PICK_COLUMNS} FROM picks WHERE sport = ? AND subject_id = ? AND dimension = ? AND category = ?`,
    [input.sport, input.subjectId, input.dimension, input.category],
  )) as PickRow;
}

/** Manual/screenshot edits clear `bookmaker` — neither identifies a specific book, so a stale book logo next to a hand-typed price would misattribute it. */
export async function updatePickOdds(id: number, americanOdds: string | null, source: string): Promise<PickRow | null> {
  await pgRun(`UPDATE picks SET american_odds = ?, odds_source = ?, odds_captured_at = ?, bookmaker = NULL WHERE id = ?`, [
    americanOdds,
    americanOdds ? source : null,
    americanOdds ? new Date().toISOString() : null,
    id,
  ]);
  return (await pgGet<PickRow>(`SELECT ${PICK_COLUMNS} FROM picks WHERE id = ?`, [id])) ?? null;
}

export async function deletePick(id: number): Promise<void> {
  await pgRun('DELETE FROM picks WHERE id = ?', [id]);
}

export async function clearPicks(sport?: string): Promise<void> {
  if (sport) await pgRun('DELETE FROM picks WHERE sport = ?', [sport]);
  else await pgRun('DELETE FROM picks');
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
  subject_id      AS "subjectId",
  subject_name    AS "subjectName",
  dimension,
  dimension_label AS "dimensionLabel",
  category,
  category_label  AS "categoryLabel",
  line,
  game_id         AS "gameId",
  team_id         AS "teamId",
  team,
  opponent_id     AS "opponentId",
  opponent,
  american_odds   AS "americanOdds",
  odds_source     AS "oddsSource",
  bookmaker,
  event_context   AS "eventContext",
  sample_size     AS "sampleSize",
  submitted_at    AS "submittedAt",
  status,
  actual_value    AS "actualValue",
  settled_at      AS "settledAt"
`;

export async function listBets(sport?: string): Promise<BetRow[]> {
  return sport
    ? pgAll<BetRow>(`SELECT ${BET_COLUMNS} FROM bets WHERE sport = ? ORDER BY submitted_at DESC, id DESC`, [sport])
    : pgAll<BetRow>(`SELECT ${BET_COLUMNS} FROM bets ORDER BY submitted_at DESC, id DESC`);
}

export async function getBet(id: number): Promise<BetRow | null> {
  return (await pgGet<BetRow>(`SELECT ${BET_COLUMNS} FROM bets WHERE id = ?`, [id])) ?? null;
}

/**
 * Move a set of slip legs into `bets` — copy then delete, in one
 * transaction, so a crash mid-submit can't leave a leg on neither table nor
 * duplicated on both. Legs the caller doesn't own (already removed, wrong
 * sport) are silently skipped rather than erroring the whole batch.
 */
export async function submitPicksAsBets(ids: number[]): Promise<BetRow[]> {
  return pgTransaction(async (tx) => {
    const submitted: BetRow[] = [];
    for (const id of ids) {
      const pick = await tx.get<PickRow>(`SELECT ${PICK_COLUMNS} FROM picks WHERE id = ?`, [id]);
      if (!pick) continue;
      const inserted = await tx.get<BetRow>(
        `INSERT INTO bets
           (sport, subject_id, subject_name, dimension, dimension_label, category, category_label,
            line, game_id, team_id, team, opponent_id, opponent, american_odds, odds_source, bookmaker,
            event_context, sample_size)
         VALUES (@sport, @subjectId, @subjectName, @dimension, @dimensionLabel, @category, @categoryLabel,
                 @line, @gameId, @teamId, @team, @opponentId, @opponent, @americanOdds, @oddsSource, @bookmaker,
                 @eventContext, @sampleSize)
         RETURNING ${BET_COLUMNS}`,
        pick,
      );
      submitted.push(inserted as BetRow);
      await tx.run('DELETE FROM picks WHERE id = ?', [id]);
    }
    return submitted;
  });
}

export interface UngradedBetRow {
  id: number;
  subjectId: string;
  dimension: string;
  category: string;
  line: number | null;
}

/** Every game with at least one bet still pending/live — the bet-grading job's work list. */
export async function listOpenBetGameIds(): Promise<string[]> {
  const rows = await pgAll<{ gameId: string }>(
    `SELECT DISTINCT game_id AS "gameId" FROM bets WHERE status IN ('pending', 'live') AND game_id IS NOT NULL`,
  );
  return rows.map((r) => r.gameId);
}

export async function listOpenBetsForGame(gameId: string): Promise<UngradedBetRow[]> {
  return pgAll<UngradedBetRow>(
    `SELECT id, subject_id AS "subjectId", dimension, category, line
     FROM bets WHERE status IN ('pending', 'live') AND game_id = ?`,
    [gameId],
  );
}

/** Bump open bets for a game to 'live' without settling them — called while a game is in progress so Live Bets can distinguish "not started" from "in progress" before final grading runs. */
export async function markBetsLive(gameId: string): Promise<void> {
  await pgRun(`UPDATE bets SET status = 'live' WHERE status = 'pending' AND game_id = ?`, [gameId]);
}

export interface BetGradeResult {
  id: number;
  outcome: 'win' | 'loss' | 'push';
  actualValue: number | null;
}

export async function writeBetGrades(results: BetGradeResult[]): Promise<void> {
  if (results.length === 0) return;
  const settledAt = new Date().toISOString();
  await pgTransaction(async (tx) => {
    for (const r of results) {
      await tx.run(`UPDATE bets SET status = @status, actual_value = @actualValue, settled_at = @settledAt WHERE id = @id`, {
        id: r.id,
        status: r.outcome,
        actualValue: r.actualValue,
        settledAt,
      });
    }
  });
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

export async function listWatchlist(sport?: string): Promise<WatchRow[]> {
  const columns = `id, sport, subject_id AS "subjectId", subject_name AS "subjectName", created_at AS "createdAt"`;
  return sport
    ? pgAll<WatchRow>(`SELECT ${columns} FROM watchlist WHERE sport = ? ORDER BY subject_name`, [sport])
    : pgAll<WatchRow>(`SELECT ${columns} FROM watchlist ORDER BY subject_name`);
}

export async function addWatch(sport: string, subjectId: string, subjectName: string): Promise<void> {
  await pgRun(
    `INSERT INTO watchlist (sport, subject_id, subject_name) VALUES (?, ?, ?)
     ON CONFLICT (sport, subject_id) DO UPDATE SET subject_name = excluded.subject_name`,
    [sport, subjectId, subjectName],
  );
}

export async function removeWatch(sport: string, subjectId: string): Promise<void> {
  await pgRun('DELETE FROM watchlist WHERE sport = ? AND subject_id = ?', [sport, subjectId]);
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

export async function readOddsCache(cacheKey: string): Promise<OddsCacheRow | null> {
  return (
    (await pgGet<OddsCacheRow>(
      `SELECT cache_key AS "cacheKey", payload, fetched_at AS "fetchedAt",
              requests_remaining AS "requestsRemaining", requests_used AS "requestsUsed"
       FROM odds_cache WHERE cache_key = ?`,
      [cacheKey],
    )) ?? null
  );
}

export async function writeOddsCache(
  cacheKey: string,
  payload: string,
  requestsRemaining: number | null,
  requestsUsed: number | null,
): Promise<void> {
  await pgRun(
    `INSERT INTO odds_cache (cache_key, payload, fetched_at, requests_remaining, requests_used)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (cache_key) DO UPDATE SET
       payload            = excluded.payload,
       fetched_at         = excluded.fetched_at,
       requests_remaining = excluded.requests_remaining,
       requests_used      = excluded.requests_used`,
    [cacheKey, payload, new Date().toISOString(), requestsRemaining, requestsUsed],
  );
}

// ---------------------------------------------------------------------------
// Snapshot cache (persist computed snapshots so first load is instant)
// ---------------------------------------------------------------------------

export interface SnapshotCacheRow {
  cacheKey: string;
  payload: string;
  fetchedAt: string;
}

export async function readSnapshotCache(cacheKey: string): Promise<SnapshotCacheRow | null> {
  return (
    (await pgGet<SnapshotCacheRow>(
      `SELECT cache_key AS "cacheKey", payload, fetched_at AS "fetchedAt"
       FROM snapshot_cache WHERE cache_key = ?`,
      [cacheKey],
    )) ?? null
  );
}

export async function writeSnapshotCache(cacheKey: string, payload: string): Promise<void> {
  await pgRun(
    `INSERT INTO snapshot_cache (cache_key, payload, fetched_at)
     VALUES (?, ?, ?)
     ON CONFLICT (cache_key) DO UPDATE SET
       payload    = excluded.payload,
       fetched_at = excluded.fetched_at`,
    [cacheKey, payload, new Date().toISOString()],
  );
}

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
  provider_id   AS "providerId",
  game_id       AS "gameId",
  subject_id    AS "subjectId",
  subject_name  AS "subjectName",
  market_key    AS "marketKey",
  line,
  side,
  bookmaker,
  american_odds AS "americanOdds",
  decimal_odds  AS "decimalOdds",
  fetched_at    AS "fetchedAt",
  is_delayed    AS "isDelayed",
  delay_seconds AS "delaySeconds"
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
export async function writePropOdds(rows: PropOddsInput[]): Promise<void> {
  if (rows.length === 0) return;
  const fetchedAt = new Date().toISOString();

  await pgTransaction(async (tx) => {
    for (const r of rows) {
      const params = { ...r, fetchedAt };
      // `line IS NOT DISTINCT FROM @line`, not `line = @line` — line is
      // nullable (categorical markets have none), and SQLite's `IS` used to
      // do null-safe equality here for free; Postgres's `IS` doesn't, so
      // this has to be spelled out or a null-line market would never match.
      const prior = await tx.get<{ americanOdds: number }>(
        `SELECT american_odds AS "americanOdds" FROM prop_odds
         WHERE provider_id = @providerId AND game_id = @gameId AND subject_id = @subjectId
           AND market_key = @marketKey AND line IS NOT DISTINCT FROM @line AND side = @side AND bookmaker = @bookmaker`,
        params,
      );
      // No prior row (first time this exact price has been seen) or a
      // genuinely different price — either way, worth a history point. A
      // repeat of the same price on the next poll is not a price movement.
      if (!prior || prior.americanOdds !== r.americanOdds) {
        await tx.run(
          `INSERT INTO prop_odds_history
             (provider_id, game_id, subject_id, market_key, line, side, bookmaker,
              american_odds, decimal_odds, observed_at, is_delayed, delay_seconds)
           VALUES (@providerId, @gameId, @subjectId, @marketKey, @line, @side, @bookmaker,
                   @americanOdds, @decimalOdds, @fetchedAt, @isDelayed, @delaySeconds)`,
          params,
        );
      }
      await tx.run(
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
        params,
      );
    }
  });
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
export async function writeGameOddsHistory(rows: GameOddsHistoryInput[]): Promise<void> {
  if (rows.length === 0) return;
  const observedAt = new Date().toISOString();
  await pgTransaction(async (tx) => {
    for (const r of rows) {
      const params = { ...r, observedAt };
      const prior = await tx.get<{ americanOdds: number }>(
        `SELECT american_odds AS "americanOdds" FROM game_odds_history
         WHERE event_id = @eventId AND market = @market AND side = @side AND bookmaker = @bookmaker
         ORDER BY observed_at DESC LIMIT 1`,
        params,
      );
      if (!prior || prior.americanOdds !== r.americanOdds) {
        await tx.run(
          `INSERT INTO game_odds_history (event_id, market, side, bookmaker, american_odds, point, observed_at)
           VALUES (@eventId, @market, @side, @bookmaker, @americanOdds, @point, @observedAt)`,
          params,
        );
      }
    }
  });
}

/**
 * Live-side counterpart to historical_odds' opening line — the earliest
 * point value this app has itself observed for this event's total market,
 * across any book. Only reflects movement since this app started polling
 * that event, not the sportsbook's true open — an honest, disclosed gap.
 */
export async function getEarliestObservedTotalPoint(eventId: string): Promise<number | null> {
  const row = await pgGet<{ point: number }>(
    `SELECT point FROM game_odds_history
     WHERE event_id = ? AND market = 'total' AND point IS NOT NULL
     ORDER BY observed_at ASC LIMIT 1`,
    [eventId],
  );
  return row?.point ?? null;
}

export async function readPropOddsForGame(gameId: string): Promise<PropOddsRow[]> {
  const rows = await pgAll<any>(
    `SELECT ${PROP_ODDS_COLUMNS} FROM prop_odds WHERE game_id = ? ORDER BY subject_id, market_key, bookmaker`,
    [gameId],
  );
  return rows.map(mapPropOddsRow);
}

export async function readPropOddsForSubject(gameId: string, subjectId: string): Promise<PropOddsRow[]> {
  const rows = await pgAll<any>(
    `SELECT ${PROP_ODDS_COLUMNS} FROM prop_odds WHERE game_id = ? AND subject_id = ? ORDER BY market_key, bookmaker`,
    [gameId, subjectId],
  );
  return rows.map(mapPropOddsRow);
}

/** Most recent `fetched_at` this provider has for this game — the basis for Tier 2 cooldowns. */
export async function lastPropFetch(providerId: string, gameId: string): Promise<string | null> {
  const row = await pgGet<{ latest: string | null }>(
    `SELECT MAX(fetched_at) AS latest FROM prop_odds WHERE provider_id = ? AND game_id = ?`,
    [providerId, gameId],
  );
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

export async function getProviderUsage(
  providerId: string,
  periodKind: 'daily' | 'monthly',
  periodKey: string,
): Promise<ProviderUsageRow> {
  const row = await pgGet<ProviderUsageRow>(
    `SELECT provider_id AS "providerId", period_kind AS "periodKind", period_key AS "periodKey",
            request_count AS "requestCount", object_count AS "objectCount", updated_at AS "updatedAt"
     FROM provider_usage WHERE provider_id = ? AND period_kind = ? AND period_key = ?`,
    [providerId, periodKind, periodKey],
  );
  return row ?? { providerId, periodKind, periodKey, requestCount: 0, objectCount: 0, updatedAt: new Date(0).toISOString() };
}

/** Adds to this period's counters, creating the row if this is the period's first spend. */
export async function incrementProviderUsage(
  providerId: string,
  periodKind: 'daily' | 'monthly',
  periodKey: string,
  requests: number,
  objects: number,
): Promise<void> {
  await pgRun(
    `INSERT INTO provider_usage (provider_id, period_kind, period_key, request_count, object_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider_id, period_kind, period_key) DO UPDATE SET
       request_count = provider_usage.request_count + excluded.request_count,
       object_count  = provider_usage.object_count + excluded.object_count,
       updated_at    = excluded.updated_at`,
    [providerId, periodKind, periodKey, requests, objects, new Date().toISOString()],
  );
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

export async function replaceUnresolvedForProvider(
  providerId: string,
  rows: Array<{ kind: string; rawValue: string; context?: string | null }>,
): Promise<void> {
  await pgTransaction(async (tx) => {
    await tx.run('DELETE FROM odds_unresolved WHERE provider_id = ?', [providerId]);
    for (const r of rows) {
      await tx.run('INSERT INTO odds_unresolved (provider_id, kind, raw_value, context) VALUES (?, ?, ?, ?)', [
        providerId,
        r.kind,
        r.rawValue,
        r.context ?? null,
      ]);
    }
  });
}

export async function listUnresolved(): Promise<UnresolvedOddsRow[]> {
  return pgAll<UnresolvedOddsRow>(
    `SELECT id, provider_id AS "providerId", kind, raw_value AS "rawValue", context, seen_at AS "seenAt"
     FROM odds_unresolved ORDER BY provider_id, kind, seen_at DESC`,
  );
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
  /** Prop Score v1 — locked at the same moment as everything else on this row via the same idempotent insert, never recomputed after. */
  propScore?: number | null;
  scoreGrade?: string | null;
  trustTier?: string | null;
  /** Which model_weights version (sport/market/version) produced modelProb — fitted markets only (moneyline/total/home-run); null for the shared Beta-Binomial props pipeline. */
  modelVersion?: number | null;
}

/**
 * One row per real-world proposition the day's scan surfaced, keyed on
 * (sport, subject, dimension, category, game) — idempotent via
 * ON CONFLICT DO NOTHING because this is called on every snapshot refresh
 * (every ~3 minutes) and a candidate surfaced at 1pm and still surfaced at
 * 1:03pm is the same proposition, not two data points to grade separately.
 */
export async function logSurfaced(entries: SurfacedEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await pgTransaction(async (tx) => {
    for (const r of entries) {
      await tx.run(
        `INSERT INTO pick_history
           (sport, subject_id, subject_name, dimension, category, market_key, line, game_id,
            sample_size, distance, event_context, model_prob, market_prob, edge, price_source, bookmaker, price_captured_at,
            prop_score, score_grade, trust_tier, model_version)
         VALUES (@sport, @subjectId, @subjectName, @dimension, @category, @marketKey, @line, @gameId,
                 @sampleSize, @distance, @eventContext, @modelProb, @marketProb, @edge, @priceSource, @bookmaker, @priceCapturedAt,
                 @propScore, @scoreGrade, @trustTier, @modelVersion)
         ON CONFLICT (sport, subject_id, dimension, category, game_id) DO NOTHING`,
        {
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
        },
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Phase C.0 — grading
// ---------------------------------------------------------------------------

/** Every subject_id the live app has ever surfaced — the backfill job's player list. */
export async function listKnownSubjects(sport: string): Promise<string[]> {
  const rows = await pgAll<{ id: string }>(`SELECT DISTINCT subject_id AS id FROM pick_history WHERE sport = ?`, [sport]);
  return rows.map((r) => r.id);
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
export async function listUngradedGameIds(): Promise<string[]> {
  const rows = await pgAll<{ gameId: string }>(
    `SELECT DISTINCT game_id AS "gameId" FROM pick_history WHERE outcome IS NULL AND game_id IS NOT NULL`,
  );
  return rows.map((r) => r.gameId);
}

export async function listUngradedForGame(gameId: string): Promise<UngradedRow[]> {
  return pgAll<UngradedRow>(
    `SELECT id, subject_id AS "subjectId", dimension, category, line,
            market_key AS "marketKey", model_prob AS "modelProb", surfaced_at AS "surfacedAt"
     FROM pick_history WHERE outcome IS NULL AND game_id = ?`,
    [gameId],
  );
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
export async function readPropOddsHistoryForKey(
  gameId: string,
  subjectId: string,
  marketKey: string,
  line: number | null,
): Promise<PropOddsHistoryPoint[]> {
  return pgAll<PropOddsHistoryPoint>(
    `SELECT provider_id AS "providerId", bookmaker, side, american_odds AS "americanOdds", decimal_odds AS "decimalOdds",
            observed_at AS "observedAt", is_delayed AS "isDelayed", delay_seconds AS "delaySeconds"
     FROM prop_odds_history
     WHERE game_id = ? AND subject_id = ? AND market_key = ? AND line IS NOT DISTINCT FROM ?`,
    [gameId, subjectId, marketKey, line],
  );
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
 * there's no separate grading pass needed). Idempotent on the same unique
 * key as live rows, so re-running the backfill is safe.
 */
export async function writeBackfill(entries: BackfillEntry[]): Promise<number> {
  if (entries.length === 0) return 0;
  return pgTransaction(async (tx) => {
    let written = 0;
    for (const r of entries) {
      const result = await tx.run(
        `INSERT INTO pick_history
           (sport, subject_id, subject_name, dimension, category, market_key, line, game_id,
            sample_size, distance, event_context, model_prob, outcome, actual_value, surfaced_at, graded_at)
         VALUES (@sport, @subjectId, @subjectName, @dimension, @category, @marketKey, @line, @gameId,
                 @sampleSize, NULL, 'backfill', @modelProb, @outcome, @actualValue, @surfacedAt, @surfacedAt)
         ON CONFLICT (sport, subject_id, dimension, category, game_id) DO NOTHING`,
        r,
      );
      if (result.changes > 0) written += 1;
    }
    return written;
  });
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
 * than blending into one misleading number.
 */
export type CalibrationScope = 'all' | 'player' | 'game';

const GAME_DIMENSIONS = `('moneyline', 'total')`;

function scopeClause(scope: CalibrationScope): string {
  if (scope === 'game') return `AND dimension IN ${GAME_DIMENSIONS}`;
  if (scope === 'player') return `AND dimension NOT IN ${GAME_DIMENSIONS}`;
  return '';
}

export async function calibrationCounts(sport: string, scope: CalibrationScope = 'all'): Promise<CalibrationCounts> {
  const clause = scopeClause(scope);
  const row = async (key: string) =>
    (await pgGet<{ n: number }>(`SELECT COUNT(*) AS n FROM pick_history WHERE sport = ? AND ${key} ${clause}`, [sport]))!.n;
  return {
    totalRows: await row('1=1'),
    gradedRows: await row('outcome IS NOT NULL'),
    ungradedRows: await row('outcome IS NULL'),
    backfillRows: await row(`event_context = 'backfill'`),
    liveRows: await row(`(event_context IS NULL OR event_context != 'backfill')`),
    withModelProb: await row('model_prob IS NOT NULL AND outcome IS NOT NULL'),
  };
}

export interface CalibrationBucket {
  bucket: number;
  n: number;
  wins: number;
}

/** Reliability diagram data — predicted-probability bucket vs. realized win rate. */
export async function calibrationBuckets(sport: string, scope: CalibrationScope = 'all'): Promise<CalibrationBucket[]> {
  return pgAll<CalibrationBucket>(
    `SELECT CAST(model_prob * 10 AS INT) / 10.0 AS bucket,
            COUNT(*) AS n,
            SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins
     FROM pick_history
     WHERE sport = ? AND model_prob IS NOT NULL AND outcome IS NOT NULL ${scopeClause(scope)}
     GROUP BY bucket ORDER BY bucket`,
    [sport],
  );
}

/** Same reliability-diagram shape as calibrationBuckets, but for one specific dimension (e.g. 'moneyline' or 'total') rather than a scope. */
export async function calibrationBucketsForDimension(sport: string, dimension: string): Promise<CalibrationBucket[]> {
  return pgAll<CalibrationBucket>(
    `SELECT CAST(model_prob * 10 AS INT) / 10.0 AS bucket,
            COUNT(*) AS n,
            SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins
     FROM pick_history
     WHERE sport = ? AND dimension = ? AND model_prob IS NOT NULL AND outcome IS NOT NULL
     GROUP BY bucket ORDER BY bucket`,
    [sport, dimension],
  );
}

export async function calibrationCountsForDimension(sport: string, dimension: string): Promise<CalibrationCounts> {
  const row = async (key: string) =>
    (await pgGet<{ n: number }>(`SELECT COUNT(*) AS n FROM pick_history WHERE sport = ? AND dimension = ? AND ${key}`, [
      sport,
      dimension,
    ]))!.n;
  return {
    totalRows: await row('1=1'),
    gradedRows: await row('outcome IS NOT NULL'),
    ungradedRows: await row('outcome IS NULL'),
    backfillRows: await row(`event_context = 'backfill'`),
    liveRows: await row(`(event_context IS NULL OR event_context != 'backfill')`),
    withModelProb: await row('model_prob IS NOT NULL AND outcome IS NOT NULL'),
  };
}

export interface MarketCalibration {
  dimension: string;
  n: number;
  wins: number;
  brierScore: number | null;
}

export async function calibrationByMarket(sport: string): Promise<MarketCalibration[]> {
  return pgAll<MarketCalibration>(
    `SELECT dimension,
            COUNT(*) AS n,
            SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins,
            AVG((model_prob - (CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END)) *
                (model_prob - (CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END))) AS "brierScore"
     FROM pick_history
     WHERE sport = ? AND model_prob IS NOT NULL AND outcome IS NOT NULL
     GROUP BY dimension ORDER BY n DESC`,
    [sport],
  );
}

export interface LiveDriftBrier {
  brier: number | null;
  games: number;
}

/**
 * Rolling Brier from the most recent REAL graded picks only (excludes
 * backfill rows entirely). Ordered by grading time so "most recent N" means
 * the actual latest live games, not an arbitrary row order.
 */
export async function liveCalibrationBrier(sport: string, dimension: string, limit: number): Promise<LiveDriftBrier> {
  const row = await pgGet<{ brier: number | null; games: number }>(
    `SELECT AVG((model_prob - actual) * (model_prob - actual)) AS brier, COUNT(*) AS games
     FROM (
       SELECT model_prob, CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END AS actual
       FROM pick_history
       WHERE sport = ? AND dimension = ? AND (event_context IS NULL OR event_context != 'backfill')
             AND outcome IS NOT NULL AND model_prob IS NOT NULL
       ORDER BY graded_at DESC LIMIT ?
     ) sub`,
    [sport, dimension, limit],
  );
  return { brier: row!.brier, games: row!.games };
}

export interface LiveMarketSkill {
  dimension: string;
  n: number;
  /** Brier Skill Score vs. that dimension's own live win rate as the naive baseline — null when the win rate is 0 or 1 (no variance to compare against). */
  bss: number | null;
}

/**
 * Prop Score v1 — live-only (non-backfill) Brier Skill Score per dimension,
 * the input to marketTrust.ts's `trustTierFromLiveBSS`.
 */
export async function liveMarketSkill(sport: string): Promise<LiveMarketSkill[]> {
  const rows = await pgAll<{ dimension: string; n: number; wins: number; brier: number }>(
    `SELECT dimension,
            COUNT(*) AS n,
            SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins,
            AVG((model_prob - (CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END)) *
                (model_prob - (CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END))) AS brier
     FROM pick_history
     WHERE sport = ? AND model_prob IS NOT NULL AND outcome IS NOT NULL
           AND (event_context IS NULL OR event_context != 'backfill')
     GROUP BY dimension`,
    [sport],
  );

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

/** Prop Score v1's own graded track record, broken out by letter grade — live-only (non-backfill). */
export async function scoreRecord(sport: string): Promise<ScoreTierRecord[]> {
  const rows = await pgAll<{ grade: string; n: number; wins: number }>(
    `SELECT score_grade AS grade,
            COUNT(*) AS n,
            SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins
     FROM pick_history
     WHERE sport = ? AND score_grade IS NOT NULL AND outcome IS NOT NULL
           AND (event_context IS NULL OR event_context != 'backfill')
     GROUP BY score_grade ORDER BY score_grade`,
    [sport],
  );
  return rows.map((r) => ({ grade: r.grade, n: r.n, wins: r.wins, winRate: r.n > 0 ? r.wins / r.n : null }));
}

export interface LeagueBaseRate {
  dimension: string;
  rate: number;
  n: number;
}

/** League-wide P(actual > line) per market, from every graded row this app has ever seen — the center of Phase C.1's Beta prior. */
export async function leagueBaseRates(sport: string): Promise<LeagueBaseRate[]> {
  return pgAll<LeagueBaseRate>(
    `SELECT dimension,
            AVG(CASE WHEN actual_value > line THEN 1.0 ELSE 0.0 END) AS rate,
            COUNT(*) AS n
     FROM pick_history
     WHERE sport = ? AND outcome IS NOT NULL AND actual_value IS NOT NULL AND line IS NOT NULL
     GROUP BY dimension`,
    [sport],
  );
}

export async function overallBrierScore(sport: string, scope: CalibrationScope = 'all'): Promise<number | null> {
  const row = await pgGet<{ brier: number | null }>(
    `SELECT AVG((model_prob - (CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END)) *
                (model_prob - (CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END))) AS brier
     FROM pick_history WHERE sport = ? AND model_prob IS NOT NULL AND outcome IS NOT NULL ${scopeClause(scope)}`,
    [sport],
  );
  return row!.brier;
}

export interface GoodBetsRecord {
  wins: number;
  losses: number;
  total: number;
  winRate: number | null;
}

/**
 * The Good Bets engine's actual track record — a retroactive read over every
 * graded pick_history row that WOULD have passed lib/odds/goodBets.ts's
 * isGoodBet() criteria at the time. See the original file-level comment
 * (preserved in git history) for the full reasoning on the relaxed edge/
 * price-ceiling rules and the `sinceIso` cutoff.
 */
export async function goodBetsRecord(
  sport: string,
  trustedDimensions: string[],
  sinceIso?: string,
  minSampleSize = 6,
  maxMarketProb = 0.72,
): Promise<GoodBetsRecord> {
  if (trustedDimensions.length === 0) return { wins: 0, losses: 0, total: 0, winRate: null };
  const params: any[] = [sport, minSampleSize, maxMarketProb, ...trustedDimensions];
  let placeholderIndex = 3;
  const placeholders = trustedDimensions.map(() => '?').join(',');
  let sinceClause = '';
  if (sinceIso) {
    sinceClause = 'AND surfaced_at >= ?';
    params.push(sinceIso);
  }
  const row = await pgGet<{ total: number; wins: number }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins
     FROM pick_history
     WHERE sport = ? AND outcome IS NOT NULL
       AND (edge IS NULL OR edge >= 0) AND sample_size >= ? AND (market_prob IS NULL OR market_prob <= ?)
       AND dimension IN (${placeholders})
       ${sinceClause}`,
    params,
  );
  const losses = row!.total - row!.wins;
  return { wins: row!.wins, losses, total: row!.total, winRate: row!.total > 0 ? row!.wins / row!.total : null };
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
export async function ensureGamePickRow(identity: GamePickIdentity): Promise<void> {
  await pgRun(
    `INSERT INTO game_picks (sport, game_id, home_team_id, away_team_id, home_team_name, away_team_name, matchup, commence_time)
     VALUES (@sport, @gameId, @homeTeamId, @awayTeamId, @homeTeamName, @awayTeamName, @matchup, @commenceTime)
     ON CONFLICT (sport, game_id) DO UPDATE SET
       home_team_id   = excluded.home_team_id,
       away_team_id   = excluded.away_team_id,
       home_team_name = excluded.home_team_name,
       away_team_name = excluded.away_team_name,
       matchup        = excluded.matchup,
       commence_time  = excluded.commence_time`,
    identity,
  );
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
  initialMlFeaturesJson: string | null;
  finalMlFeaturesJson: string | null;
  initialTotalFeaturesJson: string | null;
  finalTotalFeaturesJson: string | null;
}

const GAME_PICK_COLUMNS = `
  id, sport, game_id AS "gameId",
  home_team_id AS "homeTeamId", away_team_id AS "awayTeamId",
  home_team_name AS "homeTeamName", away_team_name AS "awayTeamName",
  matchup, commence_time AS "commenceTime",
  ml_initial_side AS "mlInitialSide", ml_initial_prob AS "mlInitialProb",
  ml_initial_captured_at AS "mlInitialCapturedAt", ml_initial_late AS "mlInitialLate",
  ml_initial_price AS "mlInitialPrice",
  ml_initial_prob_lower AS "mlInitialProbLower", ml_initial_prob_upper AS "mlInitialProbUpper",
  ml_final_side AS "mlFinalSide", ml_final_prob AS "mlFinalProb",
  ml_final_captured_at AS "mlFinalCapturedAt", ml_final_late AS "mlFinalLate",
  ml_final_price AS "mlFinalPrice",
  ml_final_prob_lower AS "mlFinalProbLower", ml_final_prob_upper AS "mlFinalProbUpper",
  total_initial_side AS "totalInitialSide", total_initial_prob AS "totalInitialProb",
  total_initial_line AS "totalInitialLine", total_initial_captured_at AS "totalInitialCapturedAt",
  total_initial_late AS "totalInitialLate", total_initial_price AS "totalInitialPrice",
  total_initial_prob_lower AS "totalInitialProbLower", total_initial_prob_upper AS "totalInitialProbUpper",
  total_final_side AS "totalFinalSide", total_final_prob AS "totalFinalProb",
  total_final_line AS "totalFinalLine", total_final_captured_at AS "totalFinalCapturedAt",
  total_final_late AS "totalFinalLate", total_final_price AS "totalFinalPrice",
  total_final_prob_lower AS "totalFinalProbLower", total_final_prob_upper AS "totalFinalProbUpper",
  final_home_score AS "finalHomeScore", final_away_score AS "finalAwayScore",
  ml_outcome AS "mlOutcome", total_outcome AS "totalOutcome", graded_at AS "gradedAt",
  initial_ml_features_json AS "initialMlFeaturesJson", final_ml_features_json AS "finalMlFeaturesJson",
  initial_total_features_json AS "initialTotalFeaturesJson", final_total_features_json AS "finalTotalFeaturesJson"
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

export async function getGamePick(sport: string, gameId: string): Promise<GamePickRow | null> {
  const row = await pgGet<any>(`SELECT ${GAME_PICK_COLUMNS} FROM game_picks WHERE sport = ? AND game_id = ?`, [sport, gameId]);
  return row ? mapGamePickRow(row) : null;
}

/** Games with at least one open slot to fill or grade — the lock engine's work list. */
export async function listGamePicksForLockCycle(sport: string): Promise<GamePickRow[]> {
  const rows = await pgAll<any>(
    `SELECT ${GAME_PICK_COLUMNS} FROM game_picks
     WHERE sport = ? AND (ml_final_captured_at IS NULL OR total_final_captured_at IS NULL OR graded_at IS NULL)`,
    [sport],
  );
  return rows.map(mapGamePickRow);
}

export interface MoneylinePickCapture {
  sport: string;
  gameId: string;
  slot: 'initial' | 'final';
  side: 'home' | 'away';
  prob: number;
  late: boolean;
  featuresJson?: string | null;
  probLower?: number | null;
  probUpper?: number | null;
}

/** Only writes if this exact slot hasn't been captured yet — a slot, once locked, never moves. */
export async function captureMoneylinePick(c: MoneylinePickCapture): Promise<void> {
  const capturedAt = new Date().toISOString();
  const col = c.slot === 'initial' ? 'ml_initial' : 'ml_final';
  const featuresCol = c.slot === 'initial' ? 'initial_ml_features_json' : 'final_ml_features_json';
  await pgRun(
    `UPDATE game_picks SET ${col}_side = @side, ${col}_prob = @prob, ${col}_captured_at = @capturedAt, ${col}_late = @late, ${featuresCol} = @featuresJson, ${col}_prob_lower = @probLower, ${col}_prob_upper = @probUpper
     WHERE sport = @sport AND game_id = @gameId AND ${col}_captured_at IS NULL`,
    {
      sport: c.sport,
      gameId: c.gameId,
      side: c.side,
      prob: c.prob,
      capturedAt,
      late: c.late,
      featuresJson: c.featuresJson ?? null,
      probLower: c.probLower ?? null,
      probUpper: c.probUpper ?? null,
    },
  );
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
  probLower?: number | null;
  probUpper?: number | null;
}

export async function captureTotalPick(c: TotalPickCapture): Promise<void> {
  const capturedAt = new Date().toISOString();
  const col = c.slot === 'initial' ? 'total_initial' : 'total_final';
  const featuresCol = c.slot === 'initial' ? 'initial_total_features_json' : 'final_total_features_json';
  await pgRun(
    `UPDATE game_picks SET ${col}_side = @side, ${col}_prob = @prob, ${col}_line = @line, ${col}_captured_at = @capturedAt, ${col}_late = @late, ${featuresCol} = @featuresJson, ${col}_prob_lower = @probLower, ${col}_prob_upper = @probUpper
     WHERE sport = @sport AND game_id = @gameId AND ${col}_captured_at IS NULL`,
    {
      sport: c.sport,
      gameId: c.gameId,
      side: c.side,
      prob: c.prob,
      line: c.line,
      capturedAt,
      late: c.late,
      featuresJson: c.featuresJson ?? null,
      probLower: c.probLower ?? null,
      probUpper: c.probUpper ?? null,
    },
  );
}

/**
 * Best-effort odds attachment — the model decides the pick, but the price
 * shown alongside it comes from the separate odds feed, which may run
 * before, after, or never relative to the pick itself. Only ever attaches to
 * a slot that's already locked and whose side matches.
 */
export async function attachMoneylinePrice(
  sport: string,
  gameId: string,
  slot: 'initial' | 'final',
  side: 'home' | 'away',
  americanOdds: number,
): Promise<void> {
  const col = slot === 'initial' ? 'ml_initial' : 'ml_final';
  await pgRun(
    `UPDATE game_picks SET ${col}_price = @price
     WHERE sport = @sport AND game_id = @gameId AND ${col}_side = @side AND ${col}_price IS NULL`,
    { sport, gameId, side, price: americanOdds },
  );
}

export async function attachTotalPrice(
  sport: string,
  gameId: string,
  slot: 'initial' | 'final',
  side: 'over' | 'under',
  americanOdds: number,
): Promise<void> {
  const col = slot === 'initial' ? 'total_initial' : 'total_final';
  await pgRun(
    `UPDATE game_picks SET ${col}_price = @price
     WHERE sport = @sport AND game_id = @gameId AND ${col}_side = @side AND ${col}_price IS NULL`,
    { sport, gameId, side, price: americanOdds },
  );
}

export interface GamePickGrade {
  sport: string;
  gameId: string;
  homeScore: number;
  awayScore: number;
  mlOutcome: 'win' | 'loss' | null;
  totalOutcome: 'win' | 'loss' | null;
}

export async function gradeGamePick(g: GamePickGrade): Promise<void> {
  await pgRun(
    `UPDATE game_picks SET
       final_home_score = @homeScore, final_away_score = @awayScore,
       ml_outcome = @mlOutcome, total_outcome = @totalOutcome, graded_at = @gradedAt
     WHERE sport = @sport AND game_id = @gameId AND graded_at IS NULL`,
    { ...g, gradedAt: new Date().toISOString() },
  );
}

export interface GamePickRecord {
  moneyline: { wins: number; losses: number };
  total: { wins: number; losses: number };
}

/** The record shown on the Scan header — every graded game since this system launched. */
export async function gamePickRecord(sport: string): Promise<GamePickRecord> {
  const ml = await pgGet<{ wins: number | null; losses: number | null }>(
    `SELECT SUM(CASE WHEN ml_outcome = 'win' THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN ml_outcome = 'loss' THEN 1 ELSE 0 END) AS losses
     FROM game_picks WHERE sport = ? AND ml_outcome IS NOT NULL`,
    [sport],
  );
  const total = await pgGet<{ wins: number | null; losses: number | null }>(
    `SELECT SUM(CASE WHEN total_outcome = 'win' THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN total_outcome = 'loss' THEN 1 ELSE 0 END) AS losses
     FROM game_picks WHERE sport = ? AND total_outcome IS NOT NULL`,
    [sport],
  );
  return {
    moneyline: { wins: ml!.wins ?? 0, losses: ml!.losses ?? 0 },
    total: { wins: total!.wins ?? 0, losses: total!.losses ?? 0 },
  };
}

/** Full pick history, newest game first, for the diagnostics table. */
export async function listGamePickHistory(sport: string, limit = 200): Promise<GamePickRow[]> {
  const rows = await pgAll<any>(
    `SELECT ${GAME_PICK_COLUMNS} FROM game_picks
     WHERE sport = ? AND commence_time IS NOT NULL
     ORDER BY commence_time DESC LIMIT ?`,
    [sport, limit],
  );
  return rows.map(mapGamePickRow);
}

export async function writeGrades(results: GradeResult[]): Promise<void> {
  if (results.length === 0) return;
  const gradedAt = new Date().toISOString();
  await pgTransaction(async (tx) => {
    for (const r of results) {
      await tx.run(
        `UPDATE pick_history SET
           outcome = @outcome, actual_value = @actualValue, graded_at = @gradedAt,
           market_prob = COALESCE(@marketProb, market_prob),
           edge = COALESCE(@edge, edge),
           price_source = COALESCE(@priceSource, price_source),
           bookmaker = COALESCE(@bookmaker, bookmaker),
           price_captured_at = COALESCE(@priceCapturedAt, price_captured_at)
         WHERE id = @id`,
        {
          id: r.id,
          outcome: r.outcome,
          actualValue: r.actualValue,
          gradedAt,
          marketProb: r.marketProb ?? null,
          edge: r.edge ?? null,
          priceSource: r.priceSource ?? null,
          bookmaker: r.bookmaker ?? null,
          priceCapturedAt: r.priceCapturedAt ?? null,
        },
      );
    }
  });
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

export async function readParkFactors(season: number): Promise<ParkFactorRow[]> {
  return pgAll<ParkFactorRow>(
    `SELECT venue_id AS "venueId", season, venue_name AS "venueName", factor, games, computed_at AS "computedAt"
     FROM park_factors WHERE season = ?`,
    [season],
  );
}

export async function writeParkFactors(
  season: number,
  rows: Array<{ venueId: number; venueName: string; factor: number; games: number }>,
): Promise<void> {
  if (rows.length === 0) return;
  const computedAt = new Date().toISOString();
  await pgTransaction(async (tx) => {
    for (const r of rows) {
      await tx.run(
        `INSERT INTO park_factors (venue_id, season, venue_name, factor, games, computed_at)
         VALUES (@venueId, @season, @venueName, @factor, @games, @computedAt)
         ON CONFLICT (venue_id, season) DO UPDATE SET
           venue_name = excluded.venue_name, factor = excluded.factor, games = excluded.games, computed_at = excluded.computed_at`,
        { ...r, season, computedAt },
      );
    }
  });
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

export async function readTeamHrRateAllowed(season: number): Promise<TeamHrRateAllowedRow[]> {
  return pgAll<TeamHrRateAllowedRow>(
    `SELECT team_id AS "teamId", season, games_faced AS "gamesFaced", games_with_hr_allowed AS "gamesWithHrAllowed",
            league_hr_rate AS "leagueHrRate", computed_at AS "computedAt"
     FROM team_hr_rate_allowed WHERE season = ?`,
    [season],
  );
}

export async function writeTeamHrRateAllowed(
  season: number,
  leagueHrRate: number,
  rows: Array<{ teamId: number; gamesFaced: number; gamesWithHrAllowed: number }>,
): Promise<void> {
  const computedAt = new Date().toISOString();
  await pgTransaction(async (tx) => {
    for (const r of rows) {
      await tx.run(
        `INSERT INTO team_hr_rate_allowed (team_id, season, games_faced, games_with_hr_allowed, league_hr_rate, computed_at)
         VALUES (@teamId, @season, @gamesFaced, @gamesWithHrAllowed, @leagueHrRate, @computedAt)
         ON CONFLICT (team_id, season) DO UPDATE SET
           games_faced = excluded.games_faced, games_with_hr_allowed = excluded.games_with_hr_allowed,
           league_hr_rate = excluded.league_hr_rate, computed_at = excluded.computed_at`,
        { ...r, season, leagueHrRate, computedAt },
      );
    }
  });
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

export async function readGameSimCache(sport: string, gameId: string): Promise<GameSimCacheRow | null> {
  const row = await pgGet<GameSimCacheRow>(
    `SELECT sport, game_id AS "gameId", home_win_prob AS "homeWinProb", expected_total AS "expectedTotal",
            n, lineup_source AS "lineupSource", computed_at AS "computedAt"
     FROM game_sim_cache WHERE sport = ? AND game_id = ?`,
    [sport, gameId],
  );
  return row ?? null;
}

export async function writeGameSimCache(row: GameSimCacheRow): Promise<void> {
  await pgRun(
    `INSERT INTO game_sim_cache (sport, game_id, home_win_prob, expected_total, n, lineup_source, computed_at)
     VALUES (@sport, @gameId, @homeWinProb, @expectedTotal, @n, @lineupSource, @computedAt)
     ON CONFLICT (sport, game_id) DO UPDATE SET
       home_win_prob = excluded.home_win_prob, expected_total = excluded.expected_total,
       n = excluded.n, lineup_source = excluded.lineup_source, computed_at = excluded.computed_at`,
    row,
  );
}

// ---------------------------------------------------------------------------
// Independently-computed gameModel + Elo (Phase N/O of the TS cutover
// gameplan, docs/mlb-prediction-engine-ts-cutover-gameplan-2026-08-22.md)
// — written by the Python worker's computeMlbGameModelJob, read here so
// adapter.ts can use Python's own computation instead of computing live.
// Read-only from this side; TS never writes this table.
// ---------------------------------------------------------------------------

export interface GameModelCacheRow {
  sport: string;
  gameId: string;
  homeExpectedRuns: number;
  awayExpectedRuns: number;
  homeWinProb: number;
  awayWinProb: number;
  // Inline-typed to match gameModel.ts's own MoneylineResult['diagnostics']
  // shape exactly, without importing from it — importing gameModel.ts (or
  // gamePickLock.ts, which already declares this same shape as a named
  // type) here would risk a circular import, since gamePickLock.ts already
  // imports FROM this file.
  diagnostics: {
    rawLog5HomeWinProb: number;
    homeVenueEdge: number;
    awayVenueEdge: number;
    homeRecentEdge: number;
    awayRecentEdge: number;
    rawHomeRecentEdge: number;
    rawAwayRecentEdge: number;
    parkFactor: number;
  };
  homeElo: number;
  homeGamesPlayed: number;
  awayElo: number;
  awayGamesPlayed: number;
  homeRestDays: number;
  awayRestDays: number;
  homeTravelMiles: number;
  awayTravelMiles: number;
  homePitcherAdj: number;
  awayPitcherAdj: number;
  computedAt: string;
}

/** Null when Python hasn't computed this game yet (or the row has fallen out of the table) — callers fall back to live computation, same neutral-on-miss convention as every other cache in this file. */
export async function readGameModelCache(sport: string, gameId: string): Promise<GameModelCacheRow | null> {
  const row = await pgGet<any>(
    `SELECT sport, game_id AS "gameId",
            home_expected_runs AS "homeExpectedRuns", away_expected_runs AS "awayExpectedRuns",
            home_win_prob AS "homeWinProb", away_win_prob AS "awayWinProb",
            diagnostics_json AS "diagnosticsJson",
            home_elo AS "homeElo", home_games_played AS "homeGamesPlayed",
            away_elo AS "awayElo", away_games_played AS "awayGamesPlayed",
            home_rest_days AS "homeRestDays", away_rest_days AS "awayRestDays",
            home_travel_miles AS "homeTravelMiles", away_travel_miles AS "awayTravelMiles",
            home_pitcher_adj AS "homePitcherAdj", away_pitcher_adj AS "awayPitcherAdj",
            computed_at AS "computedAt"
     FROM mlb_game_model_cache WHERE sport = ? AND game_id = ?`,
    [sport, gameId],
  );
  if (!row) return null;
  const { diagnosticsJson, ...rest } = row;
  return { ...rest, diagnostics: JSON.parse(diagnosticsJson) };
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
export async function writeEloHistory(rows: EloHistoryRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  return pgTransaction(async (tx) => {
    let written = 0;
    for (const r of rows) {
      const result = await tx.run(
        `INSERT INTO team_elo_history (team_id, season, game_pk, game_date, elo, games_played, opponent_team_id, was_home)
         VALUES (@teamId, @season, @gamePk, @gameDate, @elo, @gamesPlayed, @opponentTeamId, @wasHome)
         ON CONFLICT (team_id, season, game_pk) DO NOTHING`,
        r,
      );
      if (result.changes > 0) written += 1;
    }
    return written;
  });
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

/** A team's most recent rating THIS season — null if they haven't played a rated game yet this season. */
export async function getCurrentElo(teamId: number, season: number): Promise<CurrentEloRow | null> {
  const row = await pgGet<any>(
    `SELECT elo, games_played AS "gamesPlayed", game_date AS "gameDate", opponent_team_id AS "opponentTeamId", was_home AS "wasHome"
     FROM team_elo_history WHERE team_id = ? AND season = ?
     ORDER BY game_date DESC, id DESC LIMIT 1`,
    [teamId, season],
  );
  return row ? mapCurrentEloRow(row) : null;
}

/** A team's most recent rating from ANY season before the given one — the season-reversion path's source value. */
export async function getLatestEloBeforeSeason(teamId: number, season: number): Promise<CurrentEloRow | null> {
  const row = await pgGet<any>(
    `SELECT elo, games_played AS "gamesPlayed", game_date AS "gameDate", opponent_team_id AS "opponentTeamId", was_home AS "wasHome"
     FROM team_elo_history WHERE team_id = ? AND season < ?
     ORDER BY season DESC, game_date DESC, id DESC LIMIT 1`,
    [teamId, season],
  );
  return row ? mapCurrentEloRow(row) : null;
}

/** The team's single most recent game overall (any season) — used to compute rest days and travel distance for their NEXT game. */
export async function getMostRecentEloGame(teamId: number): Promise<CurrentEloRow | null> {
  const row = await pgGet<any>(
    `SELECT elo, games_played AS "gamesPlayed", game_date AS "gameDate", opponent_team_id AS "opponentTeamId", was_home AS "wasHome"
     FROM team_elo_history WHERE team_id = ?
     ORDER BY game_date DESC, id DESC LIMIT 1`,
    [teamId],
  );
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

export async function writePitcherGameScore(rows: PitcherGameScoreRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  return pgTransaction(async (tx) => {
    let written = 0;
    for (const r of rows) {
      const result = await tx.run(
        `INSERT INTO pitcher_game_score_history (pitcher_id, team_id, season, game_pk, game_date, game_score)
         VALUES (@pitcherId, @teamId, @season, @gamePk, @gameDate, @gameScore)
         ON CONFLICT (pitcher_id, game_pk) DO NOTHING`,
        r,
      );
      if (result.changes > 0) written += 1;
    }
    return written;
  });
}

/** A pitcher's most recent N starts, most recent first — the rolling-trend input for the live pitcher adjustment. */
export async function recentPitcherGameScores(pitcherId: number, limit: number): Promise<number[]> {
  const rows = await pgAll<{ gameScore: number }>(
    `SELECT game_score AS "gameScore" FROM pitcher_game_score_history WHERE pitcher_id = ? ORDER BY game_date DESC, id DESC LIMIT ?`,
    [pitcherId, limit],
  );
  return rows.map((r) => r.gameScore);
}

/** A team's own starters' rolling Game Score average this season — the "baseline" a specific start is compared against. */
export async function teamBaselineGameScore(teamId: number, season: number, beforeDate: string, limit = 15): Promise<number | null> {
  const rows = await pgAll<{ gameScore: number }>(
    `SELECT game_score AS "gameScore" FROM pitcher_game_score_history
     WHERE team_id = ? AND season = ? AND game_date < ?
     ORDER BY game_date DESC, id DESC LIMIT ?`,
    [teamId, season, beforeDate, limit],
  );
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
  covariance: number[][] | null;
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
export async function writeModelWeights(input: ModelWeightsInput, activate: boolean): Promise<ModelWeightsRow> {
  const fittedAt = new Date().toISOString();

  const row = await pgTransaction(async (tx) => {
    const maxVersion = await tx.get<{ v: number | null }>(`SELECT MAX(version) AS v FROM model_weights WHERE sport = ? AND market = ?`, [
      input.sport,
      input.market,
    ]);
    const nextVersion = (maxVersion?.v ?? 0) + 1;

    if (activate) {
      await tx.run(`UPDATE model_weights SET active = false WHERE sport = ? AND market = ?`, [input.sport, input.market]);
    }
    await tx.run(
      `INSERT INTO model_weights
         (sport, market, version, feature_names, weights_json, intercept, train_games, train_brier,
          holdout_games, holdout_brier, baseline_holdout_brier, active, fitted_at, covariance_json,
          train_seasons_json, holdout_seasons_json)
       VALUES (@sport, @market, @version, @featureNames, @weights, @intercept, @trainGames, @trainBrier,
               @holdoutGames, @holdoutBrier, @baselineHoldoutBrier, @active, @fittedAt, @covariance,
               @trainSeasons, @holdoutSeasons)`,
      {
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
        active: activate,
        fittedAt,
        covariance: input.covariance != null ? JSON.stringify(input.covariance) : null,
        trainSeasons: JSON.stringify(input.trainSeasons),
        holdoutSeasons: JSON.stringify(input.holdoutSeasons),
      },
    );

    return tx.get<any>(`SELECT * FROM model_weights WHERE sport = ? AND market = ? AND version = ?`, [
      input.sport,
      input.market,
      nextVersion,
    ]);
  });

  return mapModelWeightsRow(camelizeModelWeightsRow(row));
}

/** Postgres column names are snake_case; the row shape above expects camelCase — this bridges the one-off SELECT * above without a full column alias list. */
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

export async function getActiveModelWeights(sport: string, market: 'moneyline' | 'total' | 'home-run'): Promise<ModelWeightsRow | null> {
  const row = await pgGet<any>(
    `SELECT * FROM model_weights WHERE sport = ? AND market = ? AND active = true ORDER BY version DESC LIMIT 1`,
    [sport, market],
  );
  return row ? mapModelWeightsRow(camelizeModelWeightsRow(row)) : null;
}

export async function listModelWeightVersions(sport: string, market: 'moneyline' | 'total' | 'home-run'): Promise<ModelWeightsRow[]> {
  const rows = await pgAll<any>(`SELECT * FROM model_weights WHERE sport = ? AND market = ? ORDER BY version DESC`, [sport, market]);
  return rows.map((r) => mapModelWeightsRow(camelizeModelWeightsRow(r)));
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
  mlHomeOpenProb: number | null;
  mlAwayOpenProb: number | null;
  totalOpenLine: number | null;
  totalOpenOverProb: number | null;
  totalOpenUnderProb: number | null;
  source: 'sbr-xlsx' | 'long-csv' | 'scraper-json' | 'oddspapi-historical';
  bookCount: number;
}

/** Upsert on the (season, date, home, away) key — re-running ingestion overwrites rather than duplicates. */
export async function writeHistoricalOdds(rows: HistoricalOddsInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  return pgTransaction(async (tx) => {
    let written = 0;
    for (const r of rows) {
      await tx.run(
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
        r,
      );
      written += 1;
    }
    return written;
  });
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
export async function getHistoricalOdds(
  season: number,
  gameDate: string,
  homeTeamId: number,
  awayTeamId: number,
): Promise<HistoricalOddsRow | null> {
  const row = await pgGet<HistoricalOddsRow>(
    `SELECT ml_home_consensus_prob AS "mlHomeConsensusProb", ml_away_consensus_prob AS "mlAwayConsensusProb",
            total_line AS "totalLine", total_over_consensus_prob AS "totalOverConsensusProb",
            total_under_consensus_prob AS "totalUnderConsensusProb",
            ml_home_open_prob AS "mlHomeOpenProb", ml_away_open_prob AS "mlAwayOpenProb",
            total_open_line AS "totalOpenLine", total_open_over_prob AS "totalOpenOverProb", total_open_under_prob AS "totalOpenUnderProb",
            book_count AS "bookCount"
     FROM historical_odds WHERE season = ? AND game_date = ? AND home_team_id = ? AND away_team_id = ?`,
    [season, gameDate, homeTeamId, awayTeamId],
  );
  return row ?? null;
}

export async function historicalOddsCoverage(): Promise<Array<{ season: number; games: number; source: string }>> {
  return pgAll(`SELECT season, COUNT(*) AS games, source FROM historical_odds GROUP BY season, source ORDER BY season`);
}

// ---------------------------------------------------------------------------
// System events — lightweight error log
// ---------------------------------------------------------------------------

const SYSTEM_EVENTS_ROW_CAP = 500;

export interface SystemEventInput {
  level: 'error' | 'warning';
  source: string;
  message: string;
  detail?: string | null;
}

/** Prunes down to the cap on every write rather than a background job — this app has no long-running process to schedule one on. */
export async function logSystemEvent(input: SystemEventInput): Promise<void> {
  await pgRun(`INSERT INTO system_events (level, source, message, detail) VALUES (@level, @source, @message, @detail)`, {
    level: input.level,
    source: input.source,
    message: input.message,
    detail: input.detail ?? null,
  });
  await pgRun(`DELETE FROM system_events WHERE id NOT IN (SELECT id FROM system_events ORDER BY occurred_at DESC LIMIT ?)`, [
    SYSTEM_EVENTS_ROW_CAP,
  ]);
}

export interface SystemEventRow {
  id: number;
  level: 'error' | 'warning';
  source: string;
  message: string;
  detail: string | null;
  occurredAt: string;
}

export async function listRecentSystemEvents(limit = 50): Promise<SystemEventRow[]> {
  return pgAll<SystemEventRow>(
    `SELECT id, level, source, message, detail, occurred_at AS "occurredAt"
     FROM system_events ORDER BY occurred_at DESC LIMIT ?`,
    [limit],
  );
}

// ---------------------------------------------------------------------------
// DB-wide sanity checks — instant "did ingestion silently stop" read
// ---------------------------------------------------------------------------

/** Every real table this app writes to — a hardcoded list rather than reading pg_catalog, since a few internal/legacy tables (picks, watchlist, watch_links) aren't interesting for an ingestion-health check. */
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

export async function dbTableRowCounts(): Promise<TableRowCount[]> {
  const results: TableRowCount[] = [];
  for (const table of HEALTH_TRACKED_TABLES) {
    const row = await pgGet<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
    results.push({ table, rows: row!.n });
  }
  return results;
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
 * time. `last24h === 0` on a table that already has historical rows is the
 * actual "ingestion silently stopped" signal this exists to catch.
 *
 * Under SQLite, this used two separate cutoff-computation paths because
 * pick_history's surfaced_at (SQLite `datetime('now')`, space-separated)
 * and prop_odds_history's observed_at (JS `.toISOString()`, 'T'/'Z') were
 * two different, non-comparable string formats. Both columns are now real
 * TIMESTAMPTZ, so that split is gone — one helper handles every table.
 */
export async function dataAccumulationSnapshot(): Promise<DataAccumulationRow[]> {
  async function table(tableName: string, column: string, label: string): Promise<DataAccumulationRow> {
    const totals = await pgGet<{ n: number; earliest: string | null; latest: string | null }>(
      `SELECT COUNT(*) AS n, MIN(${column}) AS earliest, MAX(${column}) AS latest FROM ${tableName}`,
    );
    const last24h = (await pgGet<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tableName} WHERE ${column} >= now() - interval '1 day'`))!
      .n;
    const last7d = (await pgGet<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tableName} WHERE ${column} >= now() - interval '7 days'`))!
      .n;
    return { table: tableName, label, rows: totals!.n, earliest: totals!.earliest, latest: totals!.latest, last24h, last7d };
  }

  return Promise.all([
    table('pick_history', 'surfaced_at', 'Every pick this app has surfaced, graded or not'),
    table('prop_odds_history', 'observed_at', 'Player-prop price history — no backfill exists anywhere for this, forward accumulation only'),
    table('game_odds_history', 'observed_at', 'Moneyline/total price history (live-collected, separate from the ingested 2010-2025 archive)'),
    table('golf_hole_scores', 'ingested_at', 'Golf hole-by-hole scores — started from zero this session, no backfill exists yet (see project memory)'),
    table('golf_round_scores', 'ingested_at', 'Golf full-round totals — same forward-only accumulation as golf_hole_scores'),
    table('golf_tournament_results', 'finished_at', 'Golf final tournament results — the outcome label a tournament-winner model trains against; only grows once an ingested tournament actually finishes'),
  ]);
}

export async function eloCoverage(): Promise<Array<{ season: number; teams: number; rows: number }>> {
  return pgAll(
    `SELECT season, COUNT(DISTINCT team_id) AS teams, COUNT(*) AS rows
     FROM team_elo_history GROUP BY season ORDER BY season`,
  );
}

export async function parkFactorCoverage(): Promise<Array<{ season: number; venues: number; computedAt: string | null }>> {
  return pgAll(
    `SELECT season, COUNT(*) AS venues, MAX(computed_at) AS "computedAt"
     FROM park_factors GROUP BY season ORDER BY season`,
  );
}

// ---------------------------------------------------------------------------
// Golf prediction-model data layer
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

export async function writeGolfTournament(input: GolfTournamentInput): Promise<void> {
  await pgRun(
    `INSERT INTO golf_tournaments (event_id, name, course_name, season, start_date, holes_json, field_size, updated_at)
     VALUES (@eventId, @name, @courseName, @season, @startDate, @holesJson, @fieldSize, @updatedAt)
     ON CONFLICT (event_id) DO UPDATE SET
       name        = excluded.name,
       course_name = excluded.course_name,
       start_date  = excluded.start_date,
       holes_json  = excluded.holes_json,
       field_size  = excluded.field_size,
       updated_at  = excluded.updated_at`,
    { ...input, updatedAt: new Date().toISOString() },
  );
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

/** Idempotent on the (event, golfer, round, hole) key — re-polling an already-ingested hole is a silent no-op, so the caller can just hand every completed hole it sees on every poll without tracking what's new itself. */
export async function writeGolfHoleScores(rows: GolfHoleScoreInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const ingestedAt = new Date().toISOString();
  return pgTransaction(async (tx) => {
    let written = 0;
    for (const r of rows) {
      const result = await tx.run(
        `INSERT INTO golf_hole_scores (event_id, espn_id, round, hole, par, strokes, relative_to_par, category, ingested_at)
         VALUES (@eventId, @espnId, @round, @hole, @par, @strokes, @relativeToPar, @category, @ingestedAt)
         ON CONFLICT (event_id, espn_id, round, hole) DO NOTHING`,
        { ...r, ingestedAt },
      );
      if (result.changes > 0) written += 1;
    }
    return written;
  });
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

export async function writeGolfRoundScores(rows: GolfRoundScoreInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const ingestedAt = new Date().toISOString();
  return pgTransaction(async (tx) => {
    let written = 0;
    for (const r of rows) {
      const result = await tx.run(
        `INSERT INTO golf_round_scores (event_id, espn_id, round, total_strokes, relative_to_par, tee_wave, wind_mph, temp_f, precip_prob, ingested_at)
         VALUES (@eventId, @espnId, @round, @totalStrokes, @relativeToPar, @teeWave, @windMph, @tempF, @precipProb, @ingestedAt)
         ON CONFLICT (event_id, espn_id, round) DO NOTHING`,
        { ...r, ingestedAt },
      );
      if (result.changes > 0) written += 1;
    }
    return written;
  });
}

export interface GolfTournamentResultInput {
  eventId: string;
  espnId: string;
  position: string | null;
  madeCut: boolean;
  totalScore: number | null;
}

export async function writeGolfTournamentResults(rows: GolfTournamentResultInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const finishedAt = new Date().toISOString();
  return pgTransaction(async (tx) => {
    let written = 0;
    for (const r of rows) {
      await tx.run(
        `INSERT INTO golf_tournament_results (event_id, espn_id, position, made_cut, total_score, finished_at)
         VALUES (@eventId, @espnId, @position, @madeCut, @totalScore, @finishedAt)
         ON CONFLICT (event_id, espn_id) DO UPDATE SET
           position    = excluded.position,
           made_cut    = excluded.made_cut,
           total_score = excluded.total_score,
           finished_at = excluded.finished_at`,
        { ...r, finishedAt },
      );
      written += 1;
    }
    return written;
  });
}

export interface GolfHoleScoreHistoryRow {
  eventId: string;
  round: number;
  relativeToPar: number;
  category: 'birdie' | 'par' | 'bogey';
}

/** A golfer's own past history on this exact hole, most recent first — empty today (nothing ingested yet), grows every tournament from here on. */
export async function getGolferHoleHistory(espnId: string, hole: number, limit = 40): Promise<GolfHoleScoreHistoryRow[]> {
  return pgAll<GolfHoleScoreHistoryRow>(
    `SELECT event_id AS "eventId", round, relative_to_par AS "relativeToPar", category
     FROM golf_hole_scores WHERE espn_id = ? AND hole = ?
     ORDER BY id DESC LIMIT ?`,
    [espnId, hole, limit],
  );
}

export interface GolfCourseHoleBaselineRow {
  hole: number;
  par: number | null;
  rounds: number;
  avgRelativeToPar: number;
}

/** Field-wide scoring baseline for every hole at a given course, across every ingested tournament there. Empty until the same course recurs after ingestion has started. */
export async function getCourseHoleBaselines(courseName: string): Promise<GolfCourseHoleBaselineRow[]> {
  return pgAll<GolfCourseHoleBaselineRow>(
    `SELECT hs.hole AS hole, hs.par AS par, COUNT(*) AS rounds, AVG(hs.relative_to_par) AS "avgRelativeToPar"
     FROM golf_hole_scores hs
     JOIN golf_tournaments t ON t.event_id = hs.event_id
     WHERE t.course_name = ?
     GROUP BY hs.hole
     ORDER BY hs.hole`,
    [courseName],
  );
}

// ---------------------------------------------------------------------------
// Golf model performance tracking
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
export async function logGolfModelPredictions(rows: GolfModelPredictionInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const predictedAt = new Date().toISOString();
  return pgTransaction(async (tx) => {
    let written = 0;
    for (const r of rows) {
      const result = await tx.run(
        `INSERT INTO golf_model_predictions (event_id, espn_id, dimension, round, category, predicted_prob, league_rate, predicted_at)
         VALUES (@eventId, @espnId, @dimension, @round, @category, @predictedProb, @leagueRate, @predictedAt)
         ON CONFLICT (event_id, espn_id, dimension, round) DO UPDATE SET
           category       = excluded.category,
           predicted_prob = excluded.predicted_prob,
           league_rate    = excluded.league_rate,
           predicted_at   = excluded.predicted_at
         WHERE golf_model_predictions.graded_at IS NULL`,
        { ...r, predictedAt },
      );
      if (result.changes > 0) written += 1;
    }
    return written;
  });
}

export interface GolfTournamentPredictionInput {
  eventId: string;
  espnId: string;
  probWin: number;
  probTop5: number;
  probTop10: number;
  probMadeCut: number;
}

export async function logGolfTournamentPredictions(rows: GolfTournamentPredictionInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const predictedAt = new Date().toISOString();
  return pgTransaction(async (tx) => {
    let written = 0;
    for (const r of rows) {
      const result = await tx.run(
        `INSERT INTO golf_tournament_predictions (event_id, espn_id, prob_win, prob_top5, prob_top10, prob_made_cut, predicted_at)
         VALUES (@eventId, @espnId, @probWin, @probTop5, @probTop10, @probMadeCut, @predictedAt)
         ON CONFLICT (event_id, espn_id) DO UPDATE SET
           prob_win      = excluded.prob_win,
           prob_top5     = excluded.prob_top5,
           prob_top10    = excluded.prob_top10,
           prob_made_cut = excluded.prob_made_cut,
           predicted_at  = excluded.predicted_at
         WHERE golf_tournament_predictions.graded_at IS NULL`,
        { ...r, predictedAt },
      );
      if (result.changes > 0) written += 1;
    }
    return written;
  });
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

/** Every ungraded hole/round prediction that now has a matching real result to grade against. */
export async function findGradeableHolePredictions(): Promise<Array<UngradedHolePrediction & { actualCategory: string }>> {
  const holeRows = await pgAll<any>(
    `SELECT p.id AS id, p.event_id AS "eventId", p.espn_id AS "espnId", p.dimension AS dimension, p.round AS round, p.category AS category, p.predicted_prob AS "predictedProb", hs.category AS "actualCategory"
     FROM golf_model_predictions p
     JOIN golf_hole_scores hs
       ON hs.event_id = p.event_id AND hs.espn_id = p.espn_id AND hs.round = p.round
      AND hs.hole = CAST(SUBSTR(p.dimension, 6) AS INTEGER)
     WHERE p.graded_at IS NULL AND p.dimension LIKE 'hole-%'`,
  );

  const roundRows = await pgAll<any>(
    `SELECT p.id AS id, p.event_id AS "eventId", p.espn_id AS "espnId", p.dimension AS dimension, p.round AS round, p.category AS category, p.predicted_prob AS "predictedProb", rs.category AS "actualCategory"
     FROM golf_model_predictions p
     JOIN (
       SELECT event_id, espn_id, round,
              CASE WHEN relative_to_par < 0 THEN 'birdie' WHEN relative_to_par = 0 THEN 'par' ELSE 'bogey' END AS category
       FROM golf_round_scores
     ) rs ON rs.event_id = p.event_id AND rs.espn_id = p.espn_id AND rs.round = p.round
     WHERE p.graded_at IS NULL AND p.dimension = 'round-score'`,
  );

  return [...holeRows, ...roundRows];
}

export interface GradedHolePredictionInput {
  id: number;
  hit: 0 | 1;
  actualCategory: string;
  brierComponent: number;
}

export async function writeGradedHolePredictions(rows: GradedHolePredictionInput[]): Promise<void> {
  if (rows.length === 0) return;
  const gradedAt = new Date().toISOString();
  await pgTransaction(async (tx) => {
    for (const r of rows) {
      await tx.run(
        `UPDATE golf_model_predictions SET graded_at = @gradedAt, actual_category = @actualCategory, hit = @hit, brier_component = @brierComponent WHERE id = @id`,
        { ...r, hit: !!r.hit, gradedAt },
      );
    }
  });
}

export interface UngradedTournamentPrediction {
  eventId: string;
  espnId: string;
  probWin: number;
  probTop5: number;
  probTop10: number;
  probMadeCut: number;
}

/** Every ungraded tournament-winner prediction whose golfer now has a final result recorded. */
export async function findGradeableTournamentPredictions(): Promise<
  Array<UngradedTournamentPrediction & { position: string | null; madeCut: number }>
> {
  return pgAll(
    `SELECT p.event_id AS "eventId", p.espn_id AS "espnId", p.prob_win AS "probWin", p.prob_top5 AS "probTop5", p.prob_top10 AS "probTop10", p.prob_made_cut AS "probMadeCut",
            r.position AS position, r.made_cut AS "madeCut"
     FROM golf_tournament_predictions p
     JOIN golf_tournament_results r ON r.event_id = p.event_id AND r.espn_id = p.espn_id
     WHERE p.graded_at IS NULL`,
  );
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

export async function writeGradedTournamentPredictions(rows: GradedTournamentPredictionInput[]): Promise<void> {
  if (rows.length === 0) return;
  const gradedAt = new Date().toISOString();
  await pgTransaction(async (tx) => {
    for (const r of rows) {
      await tx.run(
        `UPDATE golf_tournament_predictions SET
           graded_at = @gradedAt, actual_won = @won, actual_top5 = @top5, actual_top10 = @top10, actual_made_cut = @madeCut,
           brier_win = @brierWin, brier_top5 = @brierTop5, brier_top10 = @brierTop10, brier_made_cut = @brierMadeCut
         WHERE event_id = @eventId AND espn_id = @espnId`,
        {
          ...r,
          won: !!r.won,
          top5: !!r.top5,
          top10: !!r.top10,
          madeCut: !!r.madeCut,
          gradedAt,
        },
      );
    }
  });
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

/** The compact "how is it performing" summary for /diagnostics — real graded history only, not a fabricated placeholder. */
export async function golfCalibrationSummary(): Promise<GolfCalibrationSummary> {
  const holeRoundTotals = await pgGet<{ n: number }>(`SELECT COUNT(*) AS n FROM golf_model_predictions`);
  const holeRoundGraded = await pgGet<{ n: number; hitRate: number | null; meanBrier: number | null }>(
    `SELECT COUNT(*) AS n, AVG(CASE WHEN hit THEN 1.0 ELSE 0.0 END) AS "hitRate", AVG(brier_component) AS "meanBrier" FROM golf_model_predictions WHERE graded_at IS NOT NULL`,
  );

  const tournamentTotals = await pgGet<{ n: number }>(`SELECT COUNT(*) AS n FROM golf_tournament_predictions`);
  const tournamentGraded = await pgGet<{ n: number; winBrier: number | null; top5Brier: number | null; top10Brier: number | null; madeCutBrier: number | null }>(
    `SELECT COUNT(*) AS n, AVG(brier_win) AS "winBrier", AVG(brier_top5) AS "top5Brier", AVG(brier_top10) AS "top10Brier", AVG(brier_made_cut) AS "madeCutBrier"
     FROM golf_tournament_predictions WHERE graded_at IS NOT NULL`,
  );

  return {
    holeRound: {
      total: holeRoundTotals!.n,
      graded: holeRoundGraded!.n,
      ungraded: holeRoundTotals!.n - holeRoundGraded!.n,
      hitRate: holeRoundGraded!.n > 0 ? holeRoundGraded!.hitRate : null,
      meanBrier: holeRoundGraded!.n > 0 ? holeRoundGraded!.meanBrier : null,
    },
    tournament: {
      total: tournamentTotals!.n,
      graded: tournamentGraded!.n,
      ungraded: tournamentTotals!.n - tournamentGraded!.n,
      winBrier: tournamentGraded!.n > 0 ? tournamentGraded!.winBrier : null,
      top5Brier: tournamentGraded!.n > 0 ? tournamentGraded!.top5Brier : null,
      top10Brier: tournamentGraded!.n > 0 ? tournamentGraded!.top10Brier : null,
      madeCutBrier: tournamentGraded!.n > 0 ? tournamentGraded!.madeCutBrier : null,
    },
  };
}
