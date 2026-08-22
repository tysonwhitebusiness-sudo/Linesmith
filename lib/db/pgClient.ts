/**
 * Postgres connection (Supabase) — replaces the old better-sqlite3 connection
 * in this file's previous life. One process-wide pool, cached across hot
 * reloads in dev the same way the old `global.__linesmithDb` singleton was,
 * for the same reason (avoid reopening a connection on every edit).
 *
 * Exposes a small shim — `pgGet`/`pgAll`/`pgRun`/`pgTransaction` — that
 * accepts SQL written in better-sqlite3's own two binding styles (`?`
 * positional, `@name` named) so lib/db/client.ts's query text could carry
 * over near-verbatim instead of being hand-translated statement by statement.
 */

import { Pool, type PoolClient, types } from 'pg';

// pg returns BIGINT (oid 20 — what COUNT(*) always is, regardless of what's
// being counted) and NUMERIC (oid 1700) as strings by default, to avoid
// silent precision loss on values bigger than Number.MAX_SAFE_INTEGER. This
// codebase has ~30 `COUNT(*)`/aggregate call sites that expect a plain JS
// number back (arithmetic, JSON responses, direct comparisons) the way
// better-sqlite3 always returned one — parsing both as numbers here, once,
// avoids fixing it at every call site. None of this app's counts approach
// the precision-loss range this default exists to protect against.
types.setTypeParser(20, (val: string) => parseInt(val, 10));
types.setTypeParser(1700, (val: string) => parseFloat(val));

declare global {
  // eslint-disable-next-line no-var
  var __linesmithPgPool: Pool | undefined;
}

function getPool(): Pool {
  if (!global.__linesmithPgPool) {
    global.__linesmithPgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Supabase's certs chain fine in practice; rejectUnauthorized:false
      // matches what Supabase's own connection-string guidance shows for
      // node-postgres when no custom CA bundle is configured.
      ssl: { rejectUnauthorized: false },
    });
  }
  return global.__linesmithPgPool;
}

export type SqlParams = any[] | Record<string, any> | undefined;

/** Turns `?`/`@name` placeholders + params into pg's positional `$1,$2,...` + values array. */
function compile(sql: string, params: SqlParams): { text: string; values: any[] } {
  if (params === undefined) return { text: sql, values: [] };
  if (Array.isArray(params)) {
    let i = 0;
    const text = sql.replace(/\?/g, () => `$${++i}`);
    return { text, values: params };
  }
  const values: any[] = [];
  const index = new Map<string, number>();
  const text = sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {
    if (!index.has(name)) {
      values.push(name in params ? (params as any)[name] : null);
      index.set(name, values.length);
    }
    return `$${index.get(name)}`;
  });
  return { text, values };
}

export interface PgRunResult {
  /** Rows affected — the `info.changes` equivalent from better-sqlite3's RunResult. */
  changes: number;
  /** Populated when the statement has a RETURNING clause. */
  rows: any[];
}

export async function pgGet<T = any>(sql: string, params?: SqlParams): Promise<T | undefined> {
  const { text, values } = compile(sql, params);
  const res = await getPool().query(text, values);
  return res.rows[0] as T | undefined;
}

export async function pgAll<T = any>(sql: string, params?: SqlParams): Promise<T[]> {
  const { text, values } = compile(sql, params);
  const res = await getPool().query(text, values);
  return res.rows as T[];
}

export async function pgRun(sql: string, params?: SqlParams): Promise<PgRunResult> {
  const { text, values } = compile(sql, params);
  const res = await getPool().query(text, values);
  return { changes: res.rowCount ?? 0, rows: res.rows };
}

export interface PgTx {
  get<T = any>(sql: string, params?: SqlParams): Promise<T | undefined>;
  all<T = any>(sql: string, params?: SqlParams): Promise<T[]>;
  run(sql: string, params?: SqlParams): Promise<PgRunResult>;
}

function txHandle(client: PoolClient): PgTx {
  return {
    async get<T = any>(sql: string, params?: SqlParams) {
      const { text, values } = compile(sql, params);
      const res = await client.query(text, values);
      return res.rows[0] as T | undefined;
    },
    async all<T = any>(sql: string, params?: SqlParams) {
      const { text, values } = compile(sql, params);
      const res = await client.query(text, values);
      return res.rows as T[];
    },
    async run(sql: string, params?: SqlParams) {
      const { text, values } = compile(sql, params);
      const res = await client.query(text, values);
      return { changes: res.rowCount ?? 0, rows: res.rows };
    },
  };
}

/**
 * Replaces better-sqlite3's `db.transaction(fn)` — a real BEGIN/COMMIT
 * around an async callback (impossible with better-sqlite3's sync-only
 * transactions, which is exactly why every one of these needed rewriting,
 * not just re-wrapping — see the Phase 1 migration notes in client.ts).
 */
export async function pgTransaction<T>(fn: (tx: PgTx) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(txHandle(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Job locks (Postgres advisory locks)
// ---------------------------------------------------------------------------

/**
 * Fixed classid every job lock in this app is taken under, so these locks
 * never collide with some unrelated future use of Postgres advisory locks
 * under a low, easily-reused integer like 1 or 2. Arbitrary constant, chosen
 * once; exported only so the test script can target the same key directly.
 */
export const JOB_LOCK_NAMESPACE = 847_240_119;

/**
 * Deterministic job-name -> int4 key (djb2 hash, masked into the positive
 * int4 range). Advisory locks take either one bigint or a (int, int) pair;
 * the two-int form is used here specifically to avoid any BigInt<->string
 * round-tripping through the pg driver — the same class of footgun
 * `types.setTypeParser` above exists to paper over for COUNT(*)/NUMERIC.
 * `pg_try_advisory_lock`/`pg_advisory_unlock` only ever return a boolean, so
 * there's nothing to parse either way, but building a correct 64-bit key in
 * JS has its own sharp edges (Number vs BigInt, sign bit) this sidesteps
 * entirely by staying in plain 32-bit int arithmetic.
 *
 * Collisions are only a real risk with a large or unbounded set of job
 * names; this app's handful of fixed scheduler job names (refreshTier1,
 * refreshSportsGameOddsJob, refreshNflJob, refreshCfbJob,
 * refreshSoccerEplJob, ...) is small and known ahead of time, so a hash
 * collision is not a practical concern here — this wouldn't be an
 * appropriate scheme for locking on arbitrary/user-supplied keys.
 */
export function jobLockKey(jobName: string): number {
  let hash = 5381;
  for (let i = 0; i < jobName.length; i++) {
    hash = (hash * 33 + jobName.charCodeAt(i)) | 0;
  }
  return hash & 0x7fffffff;
}

export type JobLockOutcome<T> = { acquired: true; result: T } | { acquired: false };

/**
 * Runs `fn` under a Postgres session-level advisory lock keyed by `jobName`,
 * so at most one process — a Node scheduler today, potentially a Python
 * worker later — can be inside `fn` for a given job name at a time.
 *
 * Non-blocking: uses `pg_try_advisory_lock`, not `pg_advisory_lock`, so a
 * second caller finding the lock already held gets back `{ acquired: false }`
 * immediately instead of queueing — a skipped run is the correct, expected
 * outcome here, not an error to throw or catch.
 *
 * Deliberately no expiry/cleanup table or TTL logic: advisory locks are tied
 * to the session that took them and release automatically the moment that
 * session's connection closes, whether from a clean shutdown, a crash, or a
 * dropped network link — that automatic release is the entire reason to use
 * them over a manually-managed `job_locks` row. This is also why the lock is
 * held on one dedicated `PoolClient` for the full duration of `fn`, instead
 * of the ambient pool's per-call connection pattern `pgGet`/`pgAll`/`pgRun`
 * use: an advisory lock only means something scoped to the exact session
 * that acquired it, so releasing the client back to the pool between the
 * lock call and the unlock call would let an unrelated query grab that same
 * physical connection and make the later unlock call a no-op on the wrong
 * session, leaking the lock until that connection happens to close.
 */
export async function withJobLock<T>(jobName: string, fn: () => Promise<T>): Promise<JobLockOutcome<T>> {
  const key = jobLockKey(jobName);
  const client = await getPool().connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1, $2) AS locked', [JOB_LOCK_NAMESPACE, key]);
    if (!rows[0]?.locked) {
      return { acquired: false };
    }
    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [JOB_LOCK_NAMESPACE, key]);
    }
  } finally {
    client.release();
  }
}
