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
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Supabase's certs chain fine in practice; rejectUnauthorized:false
      // matches what Supabase's own connection-string guidance shows for
      // node-postgres when no custom CA bundle is configured.
      ssl: { rejectUnauthorized: false },
      // Real regression (2026-08-23): this pool talks to Supavisor's
      // Session-mode pooler (port 5432, small hard connection ceiling), with
      // no idle/connection timeout tuned at all. Supavisor recycles idle
      // session-mode connections on its own schedule; an unconfigured `pg`
      // client happily keeps using a connection past that point and gets
      // "Connection terminated unexpectedly" the next time it's queried.
      // Every real-history fetcher (understat.ts/cfbd.ts/
      // americanSocceranalysis.ts/tennismylife.ts/sportsdataverse.ts/nhle.ts)
      // round-trips through readSnapshotCache/writeSnapshotCache for its own
      // caching, so when this pool degrades, every sport's real per-match
      // history silently goes empty at once — this is what actually broke.
      // max: 6 (2026-08-27, settled value, third change this same day).
      // Trimmed 10->6->4 earlier to free session-mode room for the
      // health-check cron's own connection, then reverted all the way back
      // to 10 once the cron moved to a separate transaction-mode pool
      // (config.py's DB_POOLER_MODE) that no longer needs that room —
      // but max:10 immediately reproduced a real, live EMAXCONNSESSION on
      // this app itself (hit directly: GET /api/nfl/game/401873299 threw
      // it). pg_stat_activity confirmed ~6 of Supavisor's 15 session-mode
      // slots are permanent Supabase platform overhead (pg_net, pg_cron
      // scheduler, Supavisor's own auth_query/management connections,
      // postgres_exporter, PostgREST), leaving a real budget of ~9 — and
      // `max` is a ceiling each pool is ALLOWED to reach under real
      // concurrent load, not a fixed reservation, so this pool's max:10
      // alone could already claim the entire remaining budget the moment
      // it's genuinely busy, before python-odds-service's worker (which
      // runs constantly in production) touches it at all. Settled on 6
      // here + 3 on the worker (db.py) = 9, matching the real measured
      // budget exactly — deliberately zero slack for ad-hoc local scripts,
      // but no structural overcommit between the two real, permanent
      // consumers.
      //
      // Re-verified 2026-08-29 (task 2.8). Finding P2 M6.2 called this
      // arithmetic wrong, on the grounds that the worker's real max_size was
      // 2 rather than 3 — true of the commit deployed when the audit ran
      // (89f6754, "reduce worker pool max_size 3 -> 2"), but that trim was
      // reverted by 713a1df and settled by ddcaff6 at worker max_size=3.
      // python-odds-service/src/db.py:140 reads `max_size=3` today, so
      // 6 + 3 = 9 is correct and this comment needed no change. The finding
      // itself had gone stale, which is what the plan's "verify it still
      // reproduces" step is for. idleTimeoutMillis lower than Supavisor's own recycle
      // window so this pool proactively closes and reopens connections
      // instead of getting caught using one Supavisor already dropped.
      // connectionTimeoutMillis so a saturated pool fails fast with a
      // clear error instead of hanging indefinitely (pg's own default is
      // 0 = wait forever).
      max: 6,
      idleTimeoutMillis: 15_000,
      connectionTimeoutMillis: 10_000,
    });
    // Without this, an error on an idle pooled client is an unhandled
    // 'error' event on the Pool itself — in a plain Node process that's an
    // uncaught exception that can crash the whole server. This is exactly
    // the shape of error a recycled/dropped Supavisor connection produces.
    pool.on('error', (err) => {
      console.error('[pgPool] idle client error (connection recycled by Supavisor or network blip)', err);
    });
    global.__linesmithPgPool = pool;
  }
  return global.__linesmithPgPool;
}

/** Real, transient connection-drop errors this pool is now expected to hit occasionally under normal Supavisor session recycling — worth one retry before giving up, since the *next* `pool.query()` call gets a fresh connection from the pool rather than the one that just died. Not retried for genuine query errors (bad SQL, constraint violations, etc.) — only the specific error shapes a dropped/reset connection actually produces. */
function isTransientConnectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('Connection terminated unexpectedly') ||
    message.includes('terminating connection due to administrator command') ||
    message.includes('ECONNRESET') ||
    message.includes('ETIMEDOUT')
  );
}

/**
 * Retries once on a transient connection error. **Reads only** — task 3.9,
 * finding P2 M5.
 *
 * This used to wrap `pgRun` as well, which executes INSERT/UPDATE/DELETE. A
 * connection can drop *after* the server has committed but before the client
 * sees the acknowledgement; the error is indistinguishable from one where the
 * statement never ran, so retrying a non-idempotent INSERT applies it twice.
 * Most writes here have natural keys and `ON CONFLICT`, but `pgRun` is generic
 * and cannot know that about its caller's SQL.
 *
 * A surfaced error on a write is the correct outcome: the caller can decide,
 * with knowledge of its own statement, whether retrying is safe. Silent
 * double-application is not recoverable after the fact.
 */
async function withConnectionRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientConnectionError(err)) throw err;
    console.warn('[pgPool] transient connection error, retrying once', err instanceof Error ? err.message : err);
    return await fn();
  }
}

export type SqlParams = any[] | Record<string, any> | undefined;

/**
 * Replaces `?` placeholders with `$n`, skipping any `?` that is not a
 * placeholder — task 3.8, findings P2 M4 / P4 M11.
 *
 * The previous implementation was `sql.replace(/\?/g, ...)` across the whole
 * string. That is safe only while no query contains a literal `?`, which was
 * true and is not a property anyone was maintaining. The moment someone writes
 * `WHERE name LIKE '%?%'` or a jsonb existence test, every placeholder after
 * that point shifts by one and parameters silently bind to the wrong columns.
 * Wrong data, not an error, and `tsc` cannot see it.
 *
 * Skipped here: single-quoted literals (including `''` escapes),
 * double-quoted identifiers, dollar-quoted bodies, and `--` / block comments.
 *
 * Postgres's jsonb operators `?`, `?|` and `?&` are a genuine ambiguity — they
 * are real `?` characters outside any string, indistinguishable from a
 * placeholder by scanning alone. Write them doubled (`??`, `??|`, `??&`), the
 * same convention node-postgres and JDBC use; a doubled `?` emits one literal
 * `?` and consumes no parameter.
 */
function scanPlaceholders(sql: string): { text: string; count: number } {
  let out = '';
  let count = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);

    if (two === '--') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"') {
      // Copy the whole literal/identifier verbatim. A doubled quote inside is
      // an escaped quote, not a terminator.
      out += ch;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === ch && sql[i + 1] === ch) { out += ch + ch; i += 2; continue; }
        if (sql[i] === ch) { out += ch; i += 1; break; }
        out += sql[i]; i += 1;
      }
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? sql.length : end + tag[0].length;
        out += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === '?') {
      if (sql[i + 1] === '?') { out += '?'; i += 2; continue; }  // escaped operator
      count += 1;
      out += `$${count}`;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return { text: out, count };
}

/** Turns `?`/`@name` placeholders + params into pg's positional `$1,$2,...` + values array. */
function compile(sql: string, params: SqlParams): { text: string; values: any[] } {
  if (params === undefined) return { text: sql, values: [] };
  if (Array.isArray(params)) {
    const { text, count } = scanPlaceholders(sql);
    // Native `$n` SQL, passed straight through. Most callers here use `?`, but
    // a few write Postgres's own positional form — and under the previous
    // compiler that worked BY ACCIDENT: the blind `?` replace found nothing to
    // do and handed pg a string it already understood. The count assertion
    // below would otherwise reject those as 0-placeholders-with-N-parameters.
    //
    // Found exactly that way: this assertion failed on withJobLock's own
    // job_locks INSERT immediately after 3.8 shipped, which is the assertion
    // doing its job — a silent behaviour that nobody had chosen became loud.
    if (count === 0 && /\$\d/.test(sql)) {
      const highest = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
      if (highest !== params.length) {
        throw new Error(
          `compile(): SQL uses native $n placeholders up to $${highest} but ${params.length} parameter(s) were supplied. SQL: ${sql.slice(0, 200)}`,
        );
      }
      return { text: sql, values: params };
    }
    if (count !== params.length) {
      // Loud beats wrong. A mismatch means the query and its parameters have
      // drifted apart, and binding whatever happens to line up is how this
      // produces plausible, incorrect data instead of a failure.
      throw new Error(
        `compile(): SQL has ${count} placeholder(s) but ${params.length} parameter(s) were supplied. ` +
          `If this query contains a literal '?' (a jsonb ?/?|/?& operator), double it. SQL: ${sql.slice(0, 200)}`,
      );
    }
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
  return withConnectionRetry(async () => {
    const res = await getPool().query(text, values);
    return res.rows[0] as T | undefined;
  });
}

export async function pgAll<T = any>(sql: string, params?: SqlParams): Promise<T[]> {
  const { text, values } = compile(sql, params);
  return withConnectionRetry(async () => {
    const res = await getPool().query(text, values);
    return res.rows as T[];
  });
}

/**
 * Executes a write. **Deliberately NOT wrapped in `withConnectionRetry`** —
 * task 3.9, finding P2 M5.
 *
 * A dropped connection after the server committed but before the client saw
 * the ack is indistinguishable from one where the statement never ran. Retrying
 * a non-idempotent INSERT there applies it twice, and no error is raised. This
 * function takes arbitrary SQL and cannot know whether its caller's statement
 * has a natural key behind it.
 *
 * A caller whose statement genuinely is idempotent (`ON CONFLICT DO NOTHING` /
 * `DO UPDATE`, or a `WHERE ... IS NULL` guard) and that wants the old
 * behaviour should retry explicitly at its own call site, where that property
 * is actually known. See `pgRunIdempotent` below.
 */
export async function pgRun(sql: string, params?: SqlParams): Promise<PgRunResult> {
  const { text, values } = compile(sql, params);
  const res = await getPool().query(text, values);
  return { changes: res.rowCount ?? 0, rows: res.rows };
}

/**
 * `pgRun` with the single transient-error retry, for statements the CALLER
 * asserts are safe to apply twice.
 *
 * Exists so that "this write is idempotent" is a claim made at a call site
 * that can actually justify it, rather than an assumption baked into every
 * write in the application. If you reach for this, the statement should carry
 * `ON CONFLICT` or an equivalent guard — and if it does not, the right fix is
 * to give it one, not to use this.
 */
export async function pgRunIdempotent(sql: string, params?: SqlParams): Promise<PgRunResult> {
  const { text, values } = compile(sql, params);
  return withConnectionRetry(async () => {
    const res = await getPool().query(text, values);
    return { changes: res.rowCount ?? 0, rows: res.rows };
  });
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

export type JobLockOutcome<T> = { acquired: true; result: T } | { acquired: false };

/** Identifies which process holds a lease. Diagnostic only — never used to decide whether a lock is held. */
const LOCK_HOLDER = `${process.pid}@${(() => { try { return require('os').hostname(); } catch { return 'unknown'; } })()}`;

/**
 * Runs `fn` under a Postgres LEASE, so at most one process across the whole
 * deployment is inside `fn` for a given `jobName` at a time.
 *
 * REPLACED pg_try_advisory_lock, 2026-08-28, task 2.7. That implementation
 * was measured against the real database and did not work, because
 * DATABASE_URL points at Supabase's TRANSACTION-mode pooler (:6543) since
 * Phase 0.5 and advisory locks are SESSION-scoped. Three concurrent
 * processes ALL acquired the same lock; worse, the unlock landed on a
 * different backend than the lock, leaking it onto an idle pooled
 * connection where pg_locks showed it held indefinitely, refusing every
 * later attempt. A lock that silently stops a job forever is a worse
 * failure than the duplicate runs it was meant to prevent.
 *
 * The previous version's own comment argued that holding one dedicated
 * `PoolClient` across the lock/unlock pair made this safe. It does not: the
 * pooler reassigns backends per transaction regardless of what the client
 * does with its handle. That reasoning was sound for a direct connection
 * and became wrong when the pooler changed underneath it.
 *
 * A lease is ordinary row data, so it behaves the same through any pooling
 * mode. `leaseMs` must be LONGER than the job's real worst-case runtime
 * (or a second process starts while the first is still working) and SHORTER
 * than the job's interval (or the next tick is refused). Only the caller
 * knows both, so there is no default.
 *
 * Non-blocking, like the version it replaces: a caller finding the lease
 * held gets `{ acquired: false }` immediately. A skipped run is the correct
 * outcome, not an error — the next tick is one interval away.
 *
 * Crash safety, which the advisory lock got for free from its connection
 * closing, comes from expiry: a process that dies mid-`fn` blocks the job
 * for at most one lease. That is why `fn` throwing still releases in the
 * `finally` below, but a hard kill does not need to.
 */
export async function withJobLock<T>(jobName: string, fn: () => Promise<T>, leaseMs: number): Promise<JobLockOutcome<T>> {
  const leaseSeconds = Math.ceil(leaseMs / 1000);
  // Take the lease only if no live one exists. The WHERE on the DO UPDATE
  // branch is what makes this exclusive: a conflicting row whose lease has
  // not expired fails the predicate, updates nothing, and returns no row.
  const claimed = await pgAll<{ job_name: string }>(
    `INSERT INTO job_locks (job_name, locked_until, locked_at, holder)
     VALUES ($1, now() + ($2 || ' seconds')::interval, now(), $3)
     ON CONFLICT (job_name) DO UPDATE
       SET locked_until = now() + ($2 || ' seconds')::interval,
           locked_at = now(),
           holder = $3
       WHERE job_locks.locked_until < now()
     RETURNING job_name`,
    [jobName, String(leaseSeconds), LOCK_HOLDER],
  );
  if (claimed.length === 0) return { acquired: false };

  try {
    return { acquired: true, result: await fn() };
  } finally {
    // Release early so the next tick isn't made to wait out the full lease.
    // Scoped to `holder` so a process whose lease already expired — and was
    // therefore legitimately taken over by someone else — cannot release
    // the new holder's lease on its way out.
    await pgRun(`UPDATE job_locks SET locked_until = now() WHERE job_name = $1 AND holder = $2`, [jobName, LOCK_HOLDER]);
  }
}


// ---------------------------------------------------------------------------
// Job locks (Postgres advisory locks)
// ---------------------------------------------------------------------------

