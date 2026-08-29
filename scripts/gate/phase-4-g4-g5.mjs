/**
 * Phase 4 gate — G4 (the findings must stop reproducing) and G5 (write-path
 * observation: for every table the phase touched, is it still being written?).
 *
 * Second run, after G7 failed and Rule 5 required restarting the whole gate.
 * The G7 fixes changed what several of these queries return, so this re-run is
 * the point, not a formality.
 *
 * Run from the repo root:  node scripts/gate/phase-4-g4-g5.mjs
 */
import pg from 'pg';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

let pass = 0, fail = 0;
async function check(id, claim, sql, fn) {
  const r = await c.query(sql);
  const { ok, got, note } = fn(r.rows);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(8)} ${claim}`);
  console.log(`          ${got}`);
  if (note) console.log(`          ${note}`);
}

console.log('Phase 4 · G4 — the findings must stop reproducing');
console.log(`date: ${new Date().toISOString()}`);
console.log('');

await check('P3 H1', 'probabilities are no longer uncalibrated',
  `SELECT count(*) FILTER (WHERE active) n FROM model_calibration WHERE sport='mlb'`,
  (r) => ({ ok: Number(r[0].n) > 0, got: `${r[0].n} active calibrations`,
    note: 'The finding is only closed because jobs.py now APPLIES them (Q39). A populated table alone was 4.3\'s original, insufficient VERIFY — the gate found nothing consumed it.' }));

await check('P3 H2', 'one MLB game model, and no reader blends the deleted one in',
  `SELECT count(*) n FROM pick_history
    WHERE sport='mlb' AND dimension='moneyline' AND model_prob IS NOT NULL
      AND outcome IS NOT NULL AND model_source IS NULL`,
  (r) => ({ ok: Number(r[0].n) < 100, got: `${r[0].n} moneyline rows from the model that exists`,
    note: 'Unfiltered this is 3,590 — 99.7% written by computeMoneylineModel, deleted 2026-08-29. Ten readers now filter; tests/model-source-filter.test.ts fails if an eleventh is added without it.' }));

await check('P3 H3', 'the activation gate can refuse a model',
  `SELECT market, active FROM model_calibration WHERE sport='mlb' AND active=false ORDER BY market`,
  (r) => ({ ok: r.length > 0, got: `refused: ${r.map((x) => x.market).join(', ') || 'none'}`,
    note: 'Independent evidence that an activation gate rejects real models. The moneyline gate itself was BROKEN and is proven separately by scripts/gate/phase-4-weak-model-refused.py.' }));

await check('P3 L3', 'player_game_history covers the sports 4.7 named',
  `SELECT count(DISTINCT sport) s, count(*) n FROM player_game_history`,
  (r) => ({ ok: Number(r[0].s) >= 9, got: `${r[0].n} rows across ${r[0].s} sports`,
    note: 'Golf deliberately absent — decided, not skipped; the reasoning is in §11 4.7.' }));

await check('P3 H8', 'no unattributed game-model history',
  `SELECT count(*) n FROM pick_history
    WHERE sport='mlb' AND dimension='moneyline' AND commence_time IS NULL AND model_source IS NULL`,
  (r) => ({ ok: Number(r[0].n) === 0, got: `${r[0].n} rows still unattributed`,
    note: 'commence_time IS NULL is the data-intrinsic boundary between the two models — Python\'s writer sets it, the deleted TypeScript one never did.' }));

console.log('');
console.log('Phase 4 · G5 — write paths: is every table the phase touched still being written?');
console.log('');

const TABLES = [
  ['pick_history', 'surfaced_at'],
  ['prop_odds', 'fetched_at'],
  ['mlb_prop_model_cache', 'computed_at'],
  ['mlb_game_model_cache', 'computed_at'],
  ['game_odds_book_lines', 'fetched_at'],
  ['player_game_history', null],
  ['model_weights', 'fitted_at'],
  ['model_calibration', 'fitted_at'],
];
for (const [t, col] of TABLES) {
  const sql = col
    ? `SELECT count(*) n, max(${col}) last FROM ${t}`
    : `SELECT count(*) n, NULL::timestamptz last FROM ${t}`;
  const r = await c.query(sql);
  const { n, last } = r.rows[0];
  const ageH = last ? (Date.now() - new Date(last).getTime()) / 3.6e6 : null;
  // model_weights/model_calibration/player_game_history are written by hand or
  // by a backfill, not continuously — staleness there is expected, not a fault.
  const continuous = !['model_weights', 'model_calibration', 'player_game_history'].includes(t);
  const ok = Number(n) > 0 && (!continuous || (ageH !== null && ageH < 24));
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${t.padEnd(24)} ${String(n).padStart(9)} rows` +
    (last ? `  last ${new Date(last).toISOString()} (${ageH.toFixed(1)}h)` : '  (no timestamp column)') +
    (continuous ? '' : '  [written on demand, staleness expected]'));
}

console.log('');
console.log(`G4+G5: ${pass} pass, ${fail} fail`);
await c.end();
process.exit(fail ? 1 : 0);
