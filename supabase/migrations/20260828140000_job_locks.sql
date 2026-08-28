-- Task 2.7 of docs/audit-remediation-plan.md — cross-process job locking
-- that actually works through the connection pooler.
--
-- WHY NOT ADVISORY LOCKS. lib/db/pgClient.ts's withJobLock used
-- pg_try_advisory_lock. Advisory locks are SESSION-scoped, and since Phase
-- 0.5 DATABASE_URL points at Supabase's TRANSACTION-mode pooler (:6543),
-- which hands a different backend to different transactions. Measured
-- 2026-08-28, three concurrent processes against the real database:
--
--   * all three acquired the same lock — it excluded nobody;
--   * the unlock landed on a different backend than the lock, so the lock
--     LEAKED. pg_locks then showed it held by an *idle* Supavisor backend,
--     and every later attempt was refused until that connection recycled.
--
-- The second failure is the dangerous one: a leaked lock means the job
-- never runs again, silently, which is a worse outcome than the duplicate
-- runs the lock was added to prevent.
--
-- pgClient.ts's own comment anticipated the shape of this ("releasing the
-- client back to the pool between the lock call and the unlock call would
-- ... make the later unlock a no-op on the wrong session, leaking the
-- lock") and proposed holding one dedicated PoolClient for the duration.
-- That mitigation cannot work here: the pooler reassigns backends per
-- transaction no matter what the client does with its handle.
--
-- WHY A LEASE TABLE. This is ordinary row data, not session state, so it
-- behaves identically through any pooling mode. Crash safety — which the
-- advisory lock got for free from the connection closing — comes from
-- `locked_until` expiring on its own, so a process that dies mid-job
-- blocks the next run for at most one lease and then releases without
-- anybody intervening.
--
-- The lease must be longer than the job's real runtime and shorter than
-- its interval; callers pass it, since only they know both.
CREATE TABLE IF NOT EXISTS job_locks (
  job_name     TEXT PRIMARY KEY,
  locked_until TIMESTAMPTZ NOT NULL,
  locked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Diagnostic only: which process believes it holds this. Not part of any
  -- correctness argument — two processes must never both hold a lease, and
  -- that is enforced by the primary key plus the conditional UPDATE in
  -- lib/db/pgClient.ts's withJobLock, not by comparing this column.
  holder       TEXT
);

COMMENT ON TABLE job_locks IS
  'Lease-based cross-process job locks. Replaces pg_try_advisory_lock, which does not work through a transaction-mode pooler — see migration 20260828140000 for the measurement.';
