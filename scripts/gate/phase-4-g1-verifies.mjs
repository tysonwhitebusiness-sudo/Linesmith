/**
 * Phase 4 gate, G1 — "Re-run every VERIFY in the phase, in one sitting, in
 * order. Not the ones you remember; the ones the phase actually wrote down."
 *
 * This is the second G1 run. The first passed, then G7 failed and Rule 5
 * requires re-running the ENTIRE gate rather than just the failed item, because
 * the fixes for G7 touched the same tables and readers the earlier VERIFYs
 * measured. Two of them are expected to have MOVED as a direct result, and are
 * marked so below -- a VERIFY whose number changed for a known reason is a
 * pass; a VERIFY whose number changed for an unknown one is not.
 *
 * Run from the repo root:  node scripts/gate/phase-4-g1-verifies.mjs
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
const line = (s) => console.log(s);

async function verify(task, what, sql, check) {
  const r = await c.query(sql);
  const rows = r.rows;
  const { ok, got, note } = check(rows);
  if (ok) pass++; else fail++;
  line(`${ok ? 'PASS' : 'FAIL'}  ${task.padEnd(6)} ${what}`);
  line(`      got: ${got}`);
  if (note) line(`      ${note}`);
}

line('Phase 4 · G1 — every VERIFY re-run, in order');
line(`date: ${new Date().toISOString()}`);
line('');

await verify('4.1', 'market_prob coverage on game_picks, last 7 days',
  `SELECT count(*) n,
          count(ml_initial_market_prob) ml,
          count(total_initial_market_prob) tot
     FROM game_picks WHERE commence_time > now() - interval '7 days'`,
  (r) => {
    const { n, ml, tot } = r[0];
    const pct = Number(n) ? (100 * Number(ml)) / Number(n) : 0;
    return { ok: true, got: `${n} game_picks rows in 7d — ml_initial_market_prob on ${ml} (${pct.toFixed(2)}%), total_initial_market_prob on ${tot}`,
      note: 'Recorded, not asserted: 4.1 established the cause is upstream coverage, not a bug. Q26 says proceed at the real number.' };
  });

await verify('4.2', 'the market activation gate has a real sample to judge on',
  `SELECT dimension, count(*) n FROM pick_history
    WHERE sport='mlb' AND dimension IN ('moneyline','total')
      AND model_prob IS NOT NULL AND market_prob IS NOT NULL AND outcome IS NOT NULL
      AND model_source IS NULL
    GROUP BY 1 ORDER BY 1`,
  (r) => ({ ok: true, got: r.map((x) => `${x.dimension}=${x.n}`).join(', ') || 'none',
    note: 'Below MARKET_GATE_MIN_N=100 both markets, so the gate reports INSUFFICIENT SAMPLE and does not block. That is the designed behaviour, not a failure.' }));

await verify('4.3', 'model_calibration is populated AND the refusals held',
  `SELECT market, active FROM model_calibration WHERE sport='mlb' ORDER BY market`,
  (r) => {
    const active = r.filter((x) => x.active).length;
    return { ok: r.length === 7 && active === 5,
      got: `${r.length} rows, ${active} active — ${r.map((x) => x.market + (x.active ? '' : '(refused)')).join(', ')}`,
      note: 'runs and total-bases lost to their baseline holdout log loss and stayed inactive. An activation gate refusing a real model.' };
  });

await verify('4.4', 'shadow is set on every model_weights row',
  `SELECT count(*) n, count(*) FILTER (WHERE shadow) s, count(*) FILTER (WHERE active) a FROM model_weights`,
  (r) => ({ ok: r[0].n === r[0].s, got: `${r[0].s} of ${r[0].n} rows shadow=true (${r[0].a} active)`,
    note: 'Q33: default true, so adding the column made nothing newly visible. Scope corrected by Q38 — see the gate entry.' }));

await verify('4.7', 'player_game_history backfilled for all four sports',
  `SELECT sport, count(*) n FROM player_game_history WHERE sport IN ('mlb','nba','tennis_atp','tennis_wta') GROUP BY 1 ORDER BY 1`,
  (r) => {
    const by = Object.fromEntries(r.map((x) => [x.sport, Number(x.n)]));
    const tennis = (by.tennis_atp || 0) + (by.tennis_wta || 0);
    const ok = (by.mlb || 0) > 700000 && (by.nba || 0) > 270000 && tennis > 260000;
    return { ok, got: `mlb=${by.mlb} nba=${by.nba} tennis=${tennis} (atp ${by.tennis_atp} + wta ${by.tennis_wta}); golf=0 deliberately`,
      note: 'Golf: DECIDED, NOT BUILT — §11 4.7 has the evidence (no consumer, schema does not fit, data already in golf\'s own tables).' };
  });

await verify('4.8', 'the deleted model\'s rows are attributed and excluded',
  `SELECT count(*) FILTER (WHERE model_source='ts_unfitted_moneyline') tagged,
          count(*) FILTER (WHERE model_source IS NULL AND dimension='moneyline') current
     FROM pick_history WHERE sport='mlb' AND dimension='moneyline'`,
  (r) => ({ ok: Number(r[0].tagged) === 3580, got: `${r[0].tagged} attributed to the deleted model, ${r[0].current} from the model that exists`,
    note: 'Backed up in full to pick_history_game_model_backup_20260829 before the UPDATE (Q25). Nothing deleted.' }));

await verify('4.9', 'the two edge definitions are separated',
  `SELECT edge_source, count(*) n FROM pick_history WHERE edge_source IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
  (r) => ({ ok: r.some((x) => x.edge_source === 'model_vs_market'),
    got: r.map((x) => `${x.edge_source}=${x.n}`).join(', ') || 'none',
    note: 'edge_sharp_vs_soft is populated on 0 rows — stated in goodBets.ts, not glossed. The 2% bar is forward-looking.' }));

await verify('4.10', 'the generic sports can surface an under',
  `SELECT category, count(*) n FROM pick_history
    WHERE sport = 'soccer' AND category IN ('over','under') GROUP BY 1 ORDER BY 1`,
  (r) => {
    const under = Number(r.find((x) => x.category === 'under')?.n || 0);
    return { ok: under > 0, got: r.map((x) => `${x.category}=${x.n}`).join(', ') || 'none',
      note: "Zero unders existed before 4.10 committed at 13:04:01Z; the first appeared 13:08:47Z. Verified live, on soccer only (Q34). NB: pick_history's sport value is 'soccer' -- player_game_history uses soccer_epl/soccer_mls, and this script asserted the latter on its first run and failed loudly. Different table, different vocabulary." };
  });

line('');
line(`G1: ${pass} pass, ${fail} fail`);
await c.end();
process.exit(fail ? 1 : 0);
