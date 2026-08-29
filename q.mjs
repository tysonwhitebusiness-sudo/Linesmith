import pg from 'pg'; import fs from 'fs';
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const c=new pg.Client({connectionString:env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
await c.connect();
const r=await c.query(`
  SELECT CASE WHEN edge < 0 THEN 'negative edge' WHEN edge > 0 THEN 'positive edge' ELSE 'zero' END bucket,
         count(*) n,
         round(100.0*avg((outcome='win')::int)::numeric,2) actual_win_pct,
         round(100.0*avg(market_prob)::numeric,2) market_expected_pct,
         round(100.0*(avg((outcome='win')::int) - avg(market_prob))::numeric,2) vs_market_pts
    FROM pick_history
   WHERE outcome IN ('win','loss') AND edge IS NOT NULL AND market_prob IS NOT NULL
   GROUP BY bucket ORDER BY bucket`);
console.log('4.6 — the fade signal, re-measured:');
for (const x of r.rows) console.log('   ', JSON.stringify(x));
await c.end();
