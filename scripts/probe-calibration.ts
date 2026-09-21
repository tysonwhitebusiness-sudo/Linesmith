import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
(async () => {
  const { pgAll } = await import('../lib/db/pgClient');
  const cols = await pgAll(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='model_calibration' ORDER BY ordinal_position`, []);
  console.log(cols.map((c: any) => c.column_name + ':' + c.data_type).join(', '));
  const rows = await pgAll(`SELECT market, version, method, active, fitted_at, holdout_games FROM model_calibration WHERE sport='mlb' AND market NOT LIKE 'pitcher-%' AND market NOT IN ('stolen-bases','home-runs','earned-runs') ORDER BY fitted_at DESC LIMIT 20`, []);
  for (const r of rows) console.log(JSON.stringify(r).slice(0, 400));
  process.exit(0);
})();
