/**
 * Phase 4 gate — task 4.4's "shadow flag round-trip: flip
 * model_weights.shadow and show the renderer changing in both directions —
 * hidden when true, visible when false."
 *
 * BOTH DIRECTIONS MATTER, and only checking one is the trap. A gate that
 * merely shows "shadow=true → hidden" would pass just as happily against a
 * renderer that shows nothing at all, ever. So this asserts the model becomes
 * VISIBLE when the flag is cleared, and hidden again when it is set — and it
 * asserts against `getRenderableModelWeights`, the function the render path
 * actually calls, not against a reimplementation of its logic.
 *
 * Restores the original value in a `finally`, so an assertion failure cannot
 * leave a production model in the wrong visibility state.
 *
 * Run from the repo root:  node scripts/gate/phase-4-shadow-roundtrip.mjs
 */
import pg from 'pg';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);

// lib/db/pgClient reads process.env directly and normally gets it from Next's
// own .env loader, which is not running in a plain node script — without this
// it falls back to a connection with no SSL and fails against Supabase.
for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;

const SPORT = 'mlb';
const MARKET = 'home-run';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${actual}, want ${expected})`}`);
};

const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const before = await c.query(
  'SELECT id, version, active, shadow FROM model_weights WHERE sport=$1 AND market=$2 AND active=true ORDER BY version DESC LIMIT 1',
  [SPORT, MARKET],
);
if (before.rowCount === 0) {
  console.log(`no active ${SPORT}/${MARKET} model — nothing to round-trip`);
  await c.end();
  process.exit(1);
}
const row = before.rows[0];
const original = row.shadow;
console.log(`active ${SPORT}/${MARKET} v${row.version}, shadow=${original} (will be restored)\n`);

// Import the real render-path function rather than reimplementing its rule.
const { getRenderableModelWeights, getActiveModelWeights } = await import('../../lib/db/client.ts');

const setShadow = (v) => c.query('UPDATE model_weights SET shadow=$1 WHERE id=$2', [v, row.id]);

try {
  console.log('direction 1 — shadow = true means the renderer sees nothing:');
  await setShadow(true);
  check('getRenderableModelWeights returns null', (await getRenderableModelWeights(SPORT, MARKET)) === null, true);
  check('but getActiveModelWeights STILL returns it (compute/log/grade continue)',
    (await getActiveModelWeights(SPORT, MARKET)) !== null, true);

  console.log('\ndirection 2 — shadow = false means the renderer sees it:');
  await setShadow(false);
  const visible = await getRenderableModelWeights(SPORT, MARKET);
  check('getRenderableModelWeights returns the model', visible !== null, true);
  check('and it is the same version', visible?.version, row.version);

  console.log('\ndirection 3 — flipping back hides it again:');
  await setShadow(true);
  check('hidden once more', (await getRenderableModelWeights(SPORT, MARKET)) === null, true);
} finally {
  await setShadow(original);
  const after = await c.query('SELECT shadow FROM model_weights WHERE id=$1', [row.id]);
  console.log(`\nrestored: shadow=${after.rows[0].shadow} (was ${original})`);
  if (after.rows[0].shadow !== original) {
    console.log('  FAIL  restore did not take');
    failures++;
  }
  await c.end();
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
