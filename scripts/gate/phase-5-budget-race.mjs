/**
 * Phase 5 gate — task 5.12 (P4 M8): check-and-spend must be ONE operation.
 *
 * The finding is a check-then-act race: two processes both read "under cap"
 * and both then spend. The fix is a conditional upsert that increments only if
 * the result stays under the limit, and reports whether it won.
 *
 * PROVING THIS NEEDS REAL CONCURRENCY AGAINST REAL POSTGRES. A single-threaded
 * "call it twice and check the number" test would pass just as happily against
 * the OLD code, because the old code is only wrong when two callers interleave.
 * So this fires N genuinely simultaneous reservations at a budget with exactly
 * one unit left and asserts that exactly ONE wins — which is false for
 * check-then-act and true for the conditional upsert.
 *
 * Uses a synthetic provider_id and deletes it afterwards, so no real provider's
 * counters are touched.
 *
 * Run from the repo root:  node scripts/gate/phase-5-budget-race.mjs
 */
import pg from 'pg';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);

const PROVIDER = '__gate5_race__';
const PERIOD_KIND = 'daily';
const PERIOD_KEY = '2026-08-29-gatetest';
const LIMIT = 10;
const RACERS = 12;

// Byte-for-byte the statement db.py's try_reserve issues.
const RESERVE_SQL = `
  INSERT INTO provider_usage (provider_id, period_kind, period_key, request_count, updated_at)
  VALUES ($1, $2, $3, $4, now())
  ON CONFLICT (provider_id, period_kind, period_key) DO UPDATE
     SET request_count = provider_usage.request_count + excluded.request_count,
         updated_at = now()
   WHERE provider_usage.request_count + excluded.request_count <= $5
  RETURNING request_count`;

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
};

const admin = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await admin.connect();
const cleanup = () => admin.query('DELETE FROM provider_usage WHERE provider_id = $1', [PROVIDER]);
await cleanup();

// --- 1. sequential: the conditional actually refuses at the boundary --------
console.log('sequential behaviour at the cap boundary:');
for (let i = 0; i < LIMIT; i++) {
  await admin.query(RESERVE_SQL, [PROVIDER, PERIOD_KIND, PERIOD_KEY, 1, LIMIT]);
}
let n = await admin.query('SELECT request_count FROM provider_usage WHERE provider_id = $1', [PROVIDER]);
check(`${LIMIT} reservations all succeed`, Number(n.rows[0].request_count), LIMIT);

const over = await admin.query(RESERVE_SQL, [PROVIDER, PERIOD_KIND, PERIOD_KEY, 1, LIMIT]);
check('the one past the cap returns no row', over.rowCount, 0);
n = await admin.query('SELECT request_count FROM provider_usage WHERE provider_id = $1', [PROVIDER]);
check('and critically, it did NOT increment', Number(n.rows[0].request_count), LIMIT);

// --- 2. the actual race ----------------------------------------------------
// Reset to one unit below the cap, then have RACERS separate CONNECTIONS all
// try to claim the last unit at the same instant.
await admin.query('UPDATE provider_usage SET request_count = $2 WHERE provider_id = $1', [PROVIDER, LIMIT - 1]);
console.log(`\nthe race: ${RACERS} concurrent connections, 1 unit left, limit ${LIMIT}:`);

const clients = await Promise.all(
  Array.from({ length: RACERS }, async () => {
    const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    return c;
  }),
);
// Fire them all without awaiting in between, so they genuinely interleave.
const results = await Promise.all(
  clients.map((c) => c.query(RESERVE_SQL, [PROVIDER, PERIOD_KIND, PERIOD_KEY, 1, LIMIT]).then((r) => r.rowCount)),
);
await Promise.all(clients.map((c) => c.end()));

const winners = results.filter((r) => r === 1).length;
check(`exactly one of ${RACERS} wins the last unit`, winners, 1);

n = await admin.query('SELECT request_count FROM provider_usage WHERE provider_id = $1', [PROVIDER]);
check('final count lands exactly on the limit, never over', Number(n.rows[0].request_count), LIMIT);
console.log(`       (check-then-act would have let up to ${RACERS} through here, ending at ${LIMIT - 1 + RACERS})`);

// --- 3. the counterfactual: the OLD check-then-act, same race -------------
// Not argued from the diff — actually run. Without this, "exactly one won"
// above could be true for reasons having nothing to do with the fix.
await admin.query('UPDATE provider_usage SET request_count = $2 WHERE provider_id = $1', [PROVIDER, LIMIT - 1]);
console.log(`
counterfactual: the same race against the OLD check-then-act shape:`);

const oldClients = await Promise.all(
  Array.from({ length: RACERS }, async () => {
    const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    return c;
  }),
);
const oldResults = await Promise.all(
  oldClients.map(async (c) => {
    // Step 1: CHECK (what daily_status did).
    const r = await c.query(
      'SELECT request_count FROM provider_usage WHERE provider_id = $1 AND period_kind = $2 AND period_key = $3',
      [PROVIDER, PERIOD_KIND, PERIOD_KEY],
    );
    const spent = Number(r.rows[0]?.request_count ?? 0);
    if (spent >= LIMIT) return 0;
    // Step 2: ACT (what record_daily_spend did), separately.
    await c.query(
      `INSERT INTO provider_usage (provider_id, period_kind, period_key, request_count, updated_at)
       VALUES ($1,$2,$3,1,now())
       ON CONFLICT (provider_id, period_kind, period_key) DO UPDATE
          SET request_count = provider_usage.request_count + 1, updated_at = now()`,
      [PROVIDER, PERIOD_KIND, PERIOD_KEY],
    );
    return 1;
  }),
);
await Promise.all(oldClients.map((c) => c.end()));
const oldWinners = oldResults.filter((r) => r === 1).length;
const oldFinal = Number(
  (await admin.query('SELECT request_count FROM provider_usage WHERE provider_id = $1', [PROVIDER])).rows[0].request_count,
);
console.log(`  OLD shape: ${oldWinners} of ${RACERS} passed the gate; final count ${oldFinal} against a limit of ${LIMIT}`);
check('the old shape really does overshoot (fault confirmed present)', oldFinal > LIMIT, true);

await cleanup();
const left = await admin.query('SELECT count(*) c FROM provider_usage WHERE provider_id = $1', [PROVIDER]);
console.log(`\ncleanup: synthetic rows remaining = ${left.rows[0].c}`);
await admin.end();

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
