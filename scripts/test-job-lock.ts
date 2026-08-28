/**
 * Manual proof for lib/db/pgClient.ts's `withJobLock` — there's no test
 * harness in this repo (no jest/vitest/mocha, no "test" script), so this is
 * a standalone script, run directly against the real Supabase Postgres
 * instance this app already uses.
 *
 * Run with:
 *   npx tsx scripts/test-job-lock.ts
 *   npx tsx scripts/test-job-lock.ts --child <jobName>   (internal)
 *
 * REWRITTEN 2026-08-28, task 2.7, along with the implementation.
 *
 * The previous version of this script passed against an implementation that
 * was measurably broken, and the reason is worth keeping: it tested two
 * concurrent calls **inside one process**. In-process, `pg`'s pool tends to
 * hand both calls the same physical connection, so the advisory lock excluded
 * correctly and the test went green. Across processes — the only situation a
 * cross-process lock exists for, and the one Phase 8's multi-instance deploy
 * creates — it did not: three concurrent processes all acquired the same
 * lock, because DATABASE_URL points at a TRANSACTION-mode pooler and advisory
 * locks are SESSION-scoped.
 *
 * So test (d) below spawns real child processes. Any future rewrite of this
 * utility that only satisfies (a)-(c) is not proven.
 *
 * Proves four things:
 *   (a) a lease can be acquired and released normally
 *   (b) a second concurrent attempt on the same job name is skipped, not
 *       blocked or queued, while the first is still running
 *   (c) an expired lease is reclaimable — the crash-safety property, which
 *       replaces the old implementation's reliance on a dropped connection
 *   (d) REAL cross-process exclusion: N separate OS processes racing the
 *       same job name, exactly one wins
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { withJobLock } from '../lib/db/pgClient';
import { pgAll, pgRun } from '../lib/db/pgClient';

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
  const outcome = await withJobLock('test-lock-basic', async () => 'job-ran', 60_000);
  check('lease was acquired', outcome.acquired === true);
  check('job result came through', outcome.acquired === true && outcome.result === 'job-ran');

  // If release genuinely happened, immediately re-acquiring the same name
  // should succeed rather than being skipped — despite the 60s lease.
  const again = await withJobLock('test-lock-basic', async () => 'job-ran-again', 60_000);
  check('lease was released early and could be re-acquired', again.acquired === true);
}

async function testReleaseOnThrow() {
  console.log('\n(a2) lease is released even when the job throws');
  const jobName = 'test-lock-throw';
  await withJobLock(jobName, async () => { throw new Error('boom'); }, 60_000).catch(() => undefined);
  const after = await withJobLock(jobName, async () => 'ok', 60_000);
  check('a throwing job did not strand its lease', after.acquired === true);
}

async function testConcurrentSkip() {
  console.log('\n(b) concurrent attempt on a held lease is skipped, not blocked');
  const jobName = 'test-lock-concurrent';

  const first = withJobLock(jobName, async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return 'first-done';
  }, 60_000);

  await new Promise((resolve) => setTimeout(resolve, 300));

  const start = Date.now();
  const second = await withJobLock(jobName, async () => 'second-should-not-run', 60_000);
  const elapsedMs = Date.now() - start;

  check('second attempt was skipped (acquired: false)', second.acquired === false);
  check(`second attempt did not block on the first (${elapsedMs}ms, under the first job's 1500ms hold)`, elapsedMs < 1200);

  const firstOutcome = await first;
  check('first attempt completed normally', firstOutcome.acquired === true && firstOutcome.result === 'first-done');
}

async function testExpiredLeaseIsReclaimable() {
  console.log('\n(c) an expired lease is reclaimable (crash safety)');
  const jobName = 'test-lock-expired';

  // Simulate a process that took the lease and died: write a row whose lease
  // has ALREADY expired, under a holder that is not us, and never release it.
  await pgRun(
    `INSERT INTO job_locks (job_name, locked_until, locked_at, holder)
     VALUES ($1, now() - interval '1 second', now() - interval '10 minutes', 'dead-process@nowhere')
     ON CONFLICT (job_name) DO UPDATE SET locked_until = now() - interval '1 second', holder = 'dead-process@nowhere'`,
    [jobName],
  );

  const outcome = await withJobLock(jobName, async () => 'reclaimed', 60_000);
  check('expired lease was reclaimed by a new holder', outcome.acquired === true);

  // And the opposite: a LIVE lease held by someone else must not be stealable.
  await pgRun(
    `INSERT INTO job_locks (job_name, locked_until, locked_at, holder)
     VALUES ($1, now() + interval '5 minutes', now(), 'live-process@elsewhere')
     ON CONFLICT (job_name) DO UPDATE SET locked_until = now() + interval '5 minutes', holder = 'live-process@elsewhere'`,
    [jobName],
  );
  const blocked = await withJobLock(jobName, async () => 'should-not-run', 60_000);
  check('a live lease held by another process is NOT stealable', blocked.acquired === false);

  // Confirm the failed attempt did not clobber the real holder on its way out.
  const rows = await pgAll<{ holder: string }>(`SELECT holder FROM job_locks WHERE job_name = $1`, [jobName]);
  check('the live holder still owns the lease', rows[0]?.holder === 'live-process@elsewhere');

  await pgRun(`DELETE FROM job_locks WHERE job_name = $1`, [jobName]);
}

/** Child mode: try to take the lease, hold it briefly, print the verdict. */
async function runChild(jobName: string) {
  const outcome = await withJobLock(jobName, async () => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    return 'ran';
  }, 60_000);
  console.log(outcome.acquired ? 'ACQUIRED' : 'SKIPPED');
  process.exit(0);
}

async function testCrossProcessExclusion() {
  console.log('\n(d) REAL cross-process exclusion — the case the old test never covered');
  const jobName = `test-lock-xproc-${Date.now()}`;
  const CHILDREN = 3;

  const runOne = () =>
    new Promise<string>((resolve) => {
      const child = spawn('npx', ['tsx', __filename, '--child', jobName], { shell: true, env: process.env });
      let out = '';
      child.stdout.on('data', (d) => { out += String(d); });
      child.on('close', () => resolve(out.includes('ACQUIRED') ? 'ACQUIRED' : 'SKIPPED'));
    });

  const results = await Promise.all(Array.from({ length: CHILDREN }, runOne));
  const acquired = results.filter((r) => r === 'ACQUIRED').length;
  console.log(`  ${CHILDREN} processes raced -> ${results.join(', ')}`);
  check(`exactly one of ${CHILDREN} separate processes acquired the lease (got ${acquired})`, acquired === 1);

  await pgRun(`DELETE FROM job_locks WHERE job_name = $1`, [jobName]);
}

async function main() {
  const childIdx = process.argv.indexOf('--child');
  if (childIdx !== -1) {
    await runChild(process.argv[childIdx + 1]);
    return;
  }

  await testAcquireAndRelease();
  await testReleaseOnThrow();
  await testConcurrentSkip();
  await testExpiredLeaseIsReclaimable();
  await testCrossProcessExclusion();

  await pgRun(`DELETE FROM job_locks WHERE job_name LIKE 'test-lock-%'`, []);

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nTest script crashed:', err);
  process.exit(1);
});
