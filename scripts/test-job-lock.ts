/**
 * Manual proof for lib/db/pgClient.ts's `withJobLock` — there's no test
 * harness in this repo (no jest/vitest/mocha, no "test" script), so this is
 * a standalone script, run directly against the real Supabase Postgres
 * instance this app already uses. Not wired into any npm script; run by hand
 * when the lock utility itself changes.
 *
 * Run with:
 *   npx tsx scripts/test-job-lock.ts
 *
 * Proves three things:
 *   (a) a lock can be acquired and released normally
 *   (b) a second concurrent attempt on the same job name is skipped, not
 *       blocked/queued, while the first is still running
 *   (c) the lock releases automatically if the holding connection drops
 *       without ever calling pg_advisory_unlock
 */

import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { withJobLock, jobLockKey, JOB_LOCK_NAMESPACE } from '../lib/db/pgClient';

// Same .env.local fallback convention as scripts/migrate-to-postgres.js.
if (!process.env.DATABASE_URL) {
  const envPath = path.join(__dirname, '..', '.env.local');
  const text = fs.readFileSync(envPath, 'utf8');
  const match = text.match(/^DATABASE_URL=(.+)$/m);
  if (!match) throw new Error('DATABASE_URL not found in .env.local');
  process.env.DATABASE_URL = match[1].trim();
}

let failures = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures += 1;
  }
}

async function testAcquireAndRelease() {
  console.log('\n(a) acquire + release normally');
  const outcome = await withJobLock('test-lock-basic', async () => 'job-ran');
  check('lock was acquired', outcome.acquired === true);
  check('job result came through', outcome.acquired === true && outcome.result === 'job-ran');

  // If release genuinely happened, immediately re-acquiring the same name
  // should succeed rather than being skipped.
  const again = await withJobLock('test-lock-basic', async () => 'job-ran-again');
  check('lock was released and could be re-acquired', again.acquired === true);
}

async function testConcurrentSkip() {
  console.log('\n(b) concurrent attempt on a held lock is skipped, not blocked');
  const jobName = 'test-lock-concurrent';

  const first = withJobLock(jobName, async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return 'first-done';
  });

  // Give the first call time to actually acquire before racing the second —
  // otherwise this could flakily race the try-lock itself.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const start = Date.now();
  const second = await withJobLock(jobName, async () => 'second-should-not-run');
  const elapsedMs = Date.now() - start;

  check('second attempt was skipped (acquired: false)', second.acquired === false);
  // Generous cutoff, not a tight latency bound: the real proof is that it
  // didn't wait out the first job's full 1500ms hold — connection setup to
  // a remote Supabase pooler on its own can take a few hundred ms.
  check(`second attempt did not block on the first (${elapsedMs}ms, well under the first job's 1500ms hold)`, elapsedMs < 1200);

  const firstOutcome = await first;
  check('first attempt completed normally', firstOutcome.acquired === true && firstOutcome.result === 'first-done');
}

async function testAutoReleaseOnDroppedConnection() {
  console.log('\n(c) lock auto-releases when the holding connection drops uncleanly');
  const jobName = 'test-lock-crash';
  const key = jobLockKey(jobName);

  // Acquire the lock on a raw connection, deliberately outside withJobLock,
  // then kill that connection without ever calling pg_advisory_unlock —
  // simulating a crashed process rather than a clean shutdown.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1, $2) AS locked', [JOB_LOCK_NAMESPACE, key]);
  check('raw connection acquired the lock directly', rows[0]?.locked === true);

  // A truthy argument to release() tells `pg` to destroy this connection
  // instead of returning it to the pool cleanly — the closest a script can
  // get to simulating a killed process without actually killing this one.
  client.release(new Error('simulated crash — connection dropped without unlocking'));
  await pool.end();

  // Give Postgres a moment to notice the backend is gone.
  await new Promise((resolve) => setTimeout(resolve, 500));

  const outcome = await withJobLock(jobName, async () => 'reacquired-after-crash');
  check('lock was reacquired after the holder disconnected uncleanly', outcome.acquired === true);
}

async function main() {
  await testAcquireAndRelease();
  await testConcurrentSkip();
  await testAutoReleaseOnDroppedConnection();

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nTest script crashed:', err);
  process.exit(1);
});
