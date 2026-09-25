/**
 * The compact price history — the ONE TypeScript file that reads it.
 *
 * P5 amendment A1 (decision D24, `docs/design/odds-build/P5-schema-and-writers.md`).
 * `prop_price_history` replaced the text-keyed `prop_odds_history` on
 * 2026-09-25: every price change is stored as integer codes into small
 * dictionary tables (`odds_games`, `odds_subjects`, `odds_markets`,
 * `odds_books`, `odds_sources`, `odds_sides`, `odds_periods`), one partition
 * per UTC day of `recorded_at`, at ~117 B/row against 345. Python writes it
 * (`python-odds-service/src/price_history.py`); this file decodes it for every
 * reader, and `tests/price-history-reader.test.ts` fails if any other file
 * names these tables.
 *
 * TWO TIMES PER ROW. `observed_at` is when the price changed at the source
 * (for the paid feeds, which send no time, it is the write time, exactly as
 * before). `recorded_at` is when the writer stored it — the partition key.
 * `observed_at <= recorded_at` always (a CHECK), so a reader that bounds
 * `observed_at` from below may bound `recorded_at` by the same instant, which
 * lets Postgres skip the older days entirely. Every read below does.
 *
 * `line::numeric::float8`, never `line::float8`: the column is `real`, and
 * only the numeric round trip gives back the value the writer was handed
 * (24.3 rather than 24.299999237 — see `line_survives` in the Python module).
 */

import { pgAll } from './pgClient';

/**
 * A price history the Slate's Movers can aggregate over (`lib/slate/marketMoves.ts`).
 * Every expression is SQL over the history alias `t` and the games CTE `s`
 * (`gid text, starts_at timestamptz`), which `from` must join.
 *
 * WHY MOVERS WORKS ON CODES. Measured 2026-09-25 on 12 games (606,143 prop
 * rows): decoding every row through the dictionary tables before grouping
 * took 17.6 s against the text table's 10.4 s, because the planner (believing
 * ~39 rows) decoded each row with five index probes. Grouping on the integer
 * codes and decoding only the final rows (at most 1,500) removes that work.
 */
export interface MoverHistorySource {
  from: (after: string) => string;
  game: string;
  subject: string;
  market: string;
  line: string;
  side: string;
  book: string;
  odds: string;
  /** Predicate taking ONE `?` (text[] of lowercase book names): the book is not one of them. */
  bookNotIn: string;
  /** Predicate: the h-CTE column `col` is one of these side names (constants only). */
  sideIn: (col: string, names: readonly string[]) => string;
  /** An h-CTE column back to its text (identity for a text source). */
  decode: (kind: 'subject' | 'market' | 'side', col: string) => string;
  /** A text value to the column's stored form (identity for a text source). */
  encode: (kind: 'subject' | 'market' | 'side', col: string) => string;
  /**
   * For a read of a FEW chosen keys (CTE `k`: game_id text, subject_id,
   * market): a FROM clause that looks each key up by index, laterally, with the
   * history aliased `t` and the games aliased `s`. Optional; without it the
   * reader joins `from` to `k`.
   */
  keyedFrom?: (after: string) => string;
}

const DICT = {
  subject: { table: 'odds_subjects', text: 'subject_id' },
  market: { table: 'odds_markets', text: 'name' },
  side: { table: 'odds_sides', text: 'name' },
} as const;

function sqlStrings(names: readonly string[]): string {
  for (const n of names) if (!/^[a-z_]+$/.test(n)) throw new Error(`not a side name: ${n}`);
  return names.map((n) => `'${n}'`).join(', ');
}

/** The prop price history as a Movers source: grouped on codes, decoded at the end. */
export const PROP_MOVER_HISTORY: MoverHistorySource = {
  // `s` is re-exposed with each game's CODE, so the chart index (game, ...) drives the read.
  from: (after) =>
    `prop_price_history t
       JOIN (SELECT s0.gid, s0.starts_at, g.id AS gcode FROM s s0 JOIN odds_games g ON g.game_id = s0.gid) s
         ON t.game = s.gcode AND t.recorded_at >= ${after}`,
  game: 's.gid',
  subject: 't.subject',
  market: 't.market',
  line: 't.line::numeric::float8',
  side: 't.side',
  book: 't.book',
  odds: 't.price',
  bookNotIn: 't.book <> ALL (ARRAY(SELECT id FROM odds_books WHERE lower(name) = ANY(?::text[])))',
  // ARRAY(...) is evaluated ONCE (an InitPlan). Written as `IN (SELECT ...)` it
  // became a semi-join that doubled Movers' line-shift query (5.5 s -> 12.1 s).
  sideIn: (col, names) => `${col} = ANY (ARRAY(SELECT id FROM odds_sides WHERE name IN (${sqlStrings(names)})))`,
  // `col` must be qualified by the caller: a bare name would bind to the dictionary's own column.
  decode: (kind, col) => `(SELECT d.${DICT[kind].text} FROM ${DICT[kind].table} d WHERE d.id = ${col})`,
  encode: (kind, col) => `(SELECT d.id FROM ${DICT[kind].table} d WHERE d.${DICT[kind].text} = ${col})`,
  // Measured 2026-09-25: joined as a relation, Movers' trend (40 keys) went from
  // 0.9 s to 8.2 s once fresh statistics made the planner hash-join whole
  // partitions. A LATERAL lookup per key has no such plan to fall into.
  keyedFrom: (after) =>
    `k JOIN (SELECT s0.gid, s0.starts_at, g.id AS gcode FROM s s0 JOIN odds_games g ON g.game_id = s0.gid) s
       ON s.gid = k.game_id
     CROSS JOIN LATERAL (
       SELECT h.* FROM prop_price_history h
        WHERE h.game = s.gcode AND h.subject = k.subject_id AND h.market = k.market AND h.recorded_at >= ${after}
     ) t`,
};

/** Codes for one (game, subject, market), as scalar subqueries the chart index can use. */
const KEY_CODES = `h.game = (SELECT id FROM odds_games WHERE game_id = ?)
       AND h.subject = (SELECT id FROM odds_subjects WHERE subject_id = ?)
       AND h.market = (SELECT id FROM odds_markets WHERE name = ?)
       AND h.side = (SELECT id FROM odds_sides WHERE name = ?)`;

export interface PropKeyWindow {
  gameId: string;
  subjectId: string;
  marketKey: string;
  side: string;
  /** Whole hours back from now; the caller validates it (it is interpolated). */
  hours: number;
  /** ISO instant: rows observed after it are left out (in-play). */
  before?: string | null;
}

function checkedHours(hours: number): number {
  if (!Number.isInteger(hours) || hours <= 0) throw new Error('hours must be a positive integer');
  return hours;
}

/** How often each line was quoted for one prop side in the window, most-quoted first. */
export async function propLineCounts(q: PropKeyWindow): Promise<Array<{ line: number | null; n: string }>> {
  const hours = checkedHours(q.hours);
  return pgAll(
    `SELECT h.line::numeric::float8 AS line, count(*) AS n
       FROM prop_price_history h
      WHERE ${KEY_CODES}
        AND h.recorded_at >= now() - interval '${hours} hours'
        AND h.observed_at >= now() - interval '${hours} hours'
        AND (?::timestamptz IS NULL OR h.observed_at <= ?::timestamptz)
      GROUP BY 1
      ORDER BY count(*) DESC`,
    [q.gameId, q.subjectId, q.marketKey, q.side, q.before ?? null, q.before ?? null],
  );
}

/**
 * The last price per bookmaker per time bucket, for one line of one prop side.
 * `bucketSeconds` is interpolated and must be one of the caller's constants.
 */
export async function propLineBuckets(
  q: PropKeyWindow & { bucketSeconds: number; line: number | null },
): Promise<Array<{ bookmaker: string; bucket: Date | string; line: number | null; american_odds: number | null }>> {
  const hours = checkedHours(q.hours);
  if (!Number.isInteger(q.bucketSeconds) || q.bucketSeconds <= 0) throw new Error('bucketSeconds must be a positive integer');
  const b = q.bucketSeconds;
  return pgAll(
    `SELECT DISTINCT ON (bk.name, bucket)
            bk.name AS bookmaker,
            to_timestamp(floor(extract(epoch FROM h.observed_at) / ${b}) * ${b}) AS bucket,
            h.line::numeric::float8 AS line,
            h.price AS american_odds
       FROM prop_price_history h
       JOIN odds_books bk ON bk.id = h.book
      WHERE ${KEY_CODES}
        AND h.recorded_at >= now() - interval '${hours} hours'
        AND h.observed_at >= now() - interval '${hours} hours'
        AND (?::timestamptz IS NULL OR h.observed_at <= ?::timestamptz)
        -- IS NOT DISTINCT FROM: a line-less market pins to its NULL rows.
        AND h.line::numeric::float8 IS NOT DISTINCT FROM ?::float8
      -- DESC on observed_at: DISTINCT ON keeps the LAST observation per bucket.
      ORDER BY bk.name, bucket, h.observed_at DESC`,
    [q.gameId, q.subjectId, q.marketKey, q.side, q.before ?? null, q.before ?? null, q.line],
  );
}

/** One key's latest price at or before an instant, in `PropOddsRow`'s column names. */
export interface PropHistoryLatestRow {
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
  /** A history row IS a change: "since" is the change's own time. */
  changedAt: string;
  extra: null;
}

/**
 * For one game, the last recorded price of every (provider, subject, market,
 * line, side, book) at or before `atIso` — the game page's pre-game props once
 * the game has started (`readPreGamePropOddsForGame`). `fetchedAt` carries the
 * change's `observed_at`, as it always did. `subjectName` comes from
 * `prop_odds` when that still holds the player, else the id.
 */
export async function propLatestAtOrBefore(gameId: string, atIso: string): Promise<PropHistoryLatestRow[]> {
  return pgAll(
    `WITH latest AS (
       -- Keyed on the PROVIDER, as the text table was: a provider whose delay
       -- settings changed has two source codes but is one series.
       SELECT DISTINCT ON (s.provider_id, h.subject, h.market, h.line, h.side, h.book)
              h.id, h.source, h.subject, h.market, h.line, h.side, h.book, h.price, h.decimal_odds, h.observed_at
         FROM prop_price_history h
         JOIN odds_sources s ON s.id = h.source
        WHERE h.game = (SELECT id FROM odds_games WHERE game_id = ?)
          AND h.observed_at <= ?::timestamptz
        ORDER BY s.provider_id, h.subject, h.market, h.line, h.side, h.book, h.observed_at DESC
     )
     SELECT l.id,
            s.provider_id           AS "providerId",
            ?::text                 AS "gameId",
            sj.subject_id           AS "subjectId",
            COALESCE((SELECT p.subject_name FROM prop_odds p WHERE p.game_id = ? AND p.subject_id = sj.subject_id LIMIT 1),
                     sj.subject_id) AS "subjectName",
            m.name                  AS "marketKey",
            l.line::numeric::float8 AS line,
            sd.name                 AS side,
            b.name                  AS bookmaker,
            l.price                 AS "americanOdds",
            l.decimal_odds          AS "decimalOdds",
            l.observed_at           AS "fetchedAt",
            s.is_delayed            AS "isDelayed",
            s.delay_seconds         AS "delaySeconds",
            l.observed_at           AS "changedAt",
            NULL::jsonb             AS extra
       FROM latest l
       JOIN odds_subjects sj ON sj.id = l.subject
       JOIN odds_markets m   ON m.id = l.market
       JOIN odds_books b     ON b.id = l.book
       JOIN odds_sources s   ON s.id = l.source
       JOIN odds_sides sd    ON sd.id = l.side`,
    [gameId, atIso, gameId, gameId],
  );
}

/**
 * How far back the prop history still reaches, as an ISO instant, or null if
 * nothing has been moved to the corpus yet. Published by the mover
 * (`history_mover.py`) after each drop: the start of the oldest day still held.
 * Every row observed at or after it is retained, because `observed_at <=
 * recorded_at`.
 */
export async function propHistoryFloor(): Promise<string | null> {
  const rows = await pgAll<{ payload: unknown }>(
    `SELECT payload FROM snapshot_cache WHERE cache_key = ?`,
    ['corpus:retained-floor:prop_price_history'],
  );
  if (!rows.length) return null;
  const raw = rows[0].payload;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const floor = (parsed as { floor?: string } | null)?.floor;
  return floor ?? null;
}

/** Rows, first/last observation, and inflow over 1 and 7 days — `/diagnostics`' accumulation check. */
export async function propHistoryAccumulation(): Promise<{ n: number; earliest: string | null; latest: string | null; last24h: number; last7d: number }> {
  const rows = await pgAll<{ n: string; earliest: string | null; latest: string | null; last24h: string; last7d: string }>(
    `SELECT count(*) AS n, min(observed_at) AS earliest, max(observed_at) AS latest,
            count(*) FILTER (WHERE recorded_at >= now() - interval '1 day' AND observed_at >= now() - interval '1 day') AS last24h,
            count(*) FILTER (WHERE recorded_at >= now() - interval '7 days' AND observed_at >= now() - interval '7 days') AS last7d
       FROM prop_price_history`,
  );
  const r = rows[0];
  return {
    n: Number(r?.n ?? 0),
    earliest: r?.earliest ?? null,
    latest: r?.latest ?? null,
    last24h: Number(r?.last24h ?? 0),
    last7d: Number(r?.last7d ?? 0),
  };
}

/** Row count, for `/diagnostics`' table list. */
export async function propHistoryRowCount(): Promise<number> {
  const rows = await pgAll<{ n: string }>(`SELECT count(*) AS n FROM prop_price_history`);
  return Number(rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// P8 (odds build, 2026-09-25): the odds section's history reads.
// ---------------------------------------------------------------------------

/** One prop price change for one player (the odds section's Line movement). */
export interface PropChangeRow {
  providerId: string;
  marketKey: string;
  line: number | null;
  side: string;
  bookmaker: string;
  americanOdds: number;
  observedAt: string;
}

/** Every prop price change for one player in one game since `sinceIso`, oldest first. */
export async function propChangesForSubject(gameId: string, subjectId: string, sinceIso: string): Promise<PropChangeRow[]> {
  return pgAll(
    `SELECT s.provider_id AS "providerId", m.name AS "marketKey", h.line::numeric::float8 AS line,
            sd.name AS side, b.name AS bookmaker, h.price AS "americanOdds", h.observed_at AS "observedAt"
       FROM prop_price_history h
       JOIN odds_sources s ON s.id = h.source
       JOIN odds_markets m ON m.id = h.market
       JOIN odds_books b   ON b.id = h.book
       JOIN odds_sides sd  ON sd.id = h.side
      WHERE h.game = (SELECT id FROM odds_games WHERE game_id = ?)
        AND h.subject = (SELECT id FROM odds_subjects WHERE subject_id = ?)
        AND h.observed_at >= ?::timestamptz AND h.recorded_at >= ?::timestamptz
      ORDER BY h.observed_at`,
    [gameId, subjectId, sinceIso, sinceIso],
  );
}

/** One game-line price change (the game page's Line movement). */
export interface GameLineChangeRow {
  source: string;
  period: string;
  market: string;
  side: string;
  point: number | null;
  bookmaker: string;
  americanOdds: number;
  isMain: boolean;
  observedAt: string;
}

/** Every game-line price change for one game since `sinceIso`, oldest first. */
export async function gameLineChangesForGame(gameId: string, sinceIso: string): Promise<GameLineChangeRow[]> {
  return pgAll(
    `SELECT s.provider_id AS source, pe.name AS period, m.name AS market, sd.name AS side,
            h.point::numeric::float8 AS point, b.name AS bookmaker, h.price AS "americanOdds",
            h.is_main AS "isMain", h.observed_at AS "observedAt"
       FROM game_lines_history h
       JOIN odds_sources s  ON s.id = h.source
       JOIN odds_markets m  ON m.id = h.market
       JOIN odds_periods pe ON pe.id = h.period
       JOIN odds_books b    ON b.id = h.book
       JOIN odds_sides sd   ON sd.id = h.side
      WHERE h.game = (SELECT id FROM odds_games WHERE game_id = ?)
        AND h.observed_at >= ?::timestamptz AND h.recorded_at >= ?::timestamptz
      ORDER BY h.observed_at`,
    [gameId, sinceIso, sinceIso],
  );
}

/** One book's last full-game main price at or before its game's start (a close). */
export interface GameLineCloseRow {
  gameId: string;
  market: string;
  side: string;
  point: number | null;
  bookmaker: string;
  americanOdds: number;
  observedAt: string;
}

/**
 * Each book's last full-game main spread and total price at or before each
 * game's start (the team page's "Against the closing number", odds build P8
 * O3). History is hot for ten days, so an older game has no rows here.
 */
export async function gameLineClosesForGames(games: { gameId: string; start: string }[]): Promise<GameLineCloseRow[]> {
  if (!games.length) return [];
  const floor = new Date(Math.min(...games.map(g => Date.parse(g.start))) - 11 * 86400e3).toISOString();
  return pgAll(
    `SELECT DISTINCT ON (q.game_id, h.book, h.market, h.side)
            q.game_id AS "gameId", m.name AS market, sd.name AS side, h.point::numeric::float8 AS point,
            b.name AS bookmaker, h.price AS "americanOdds", h.observed_at AS "observedAt"
       FROM unnest(?::text[], ?::timestamptz[]) AS q(game_id, start)
       JOIN odds_games g    ON g.game_id = q.game_id
       JOIN game_lines_history h ON h.game = g.id
       JOIN odds_markets m  ON m.id = h.market
       JOIN odds_periods pe ON pe.id = h.period
       JOIN odds_books b    ON b.id = h.book
       JOIN odds_sides sd   ON sd.id = h.side
      WHERE pe.name = 'fg' AND m.name IN ('sp', 'tot') AND h.is_main
        AND h.observed_at <= q.start AND h.recorded_at >= ?::timestamptz
      ORDER BY q.game_id, h.book, h.market, h.side, h.observed_at DESC`,
    [games.map(g => g.gameId), games.map(g => g.start), floor],
  );
}

/** Full-game main-line changes for a set of games since `sinceIso` (the Slate's steam), oldest first. */
export async function gameLineChangesForGames(gameIds: string[], sinceIso: string): Promise<(GameLineChangeRow & { gameId: string })[]> {
  if (!gameIds.length) return [];
  return pgAll(
    `SELECT g.game_id AS "gameId", s.provider_id AS source, pe.name AS period, m.name AS market, sd.name AS side,
            h.point::numeric::float8 AS point, b.name AS bookmaker, h.price AS "americanOdds",
            h.is_main AS "isMain", h.observed_at AS "observedAt"
       FROM game_lines_history h
       JOIN odds_games g    ON g.id = h.game
       JOIN odds_sources s  ON s.id = h.source
       JOIN odds_markets m  ON m.id = h.market
       JOIN odds_periods pe ON pe.id = h.period
       JOIN odds_books b    ON b.id = h.book
       JOIN odds_sides sd   ON sd.id = h.side
      WHERE g.game_id = ANY(?) AND pe.name = 'fg' AND m.name IN ('ml', 'sp', 'tot') AND h.is_main
        AND h.observed_at >= ?::timestamptz AND h.recorded_at >= ?::timestamptz
      ORDER BY h.observed_at`,
    [gameIds, sinceIso, sinceIso],
  );
}
