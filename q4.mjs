import pg from 'pg'; import fs from 'fs';
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const c=new pg.Client({connectionString:env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
await c.connect();
const r=await c.query(`
  SELECT width_bucket(market_prob, 0.2, 0.8, 4) band,
         round(min(market_prob)::numeric,2) lo, round(max(market_prob)::numeric,2) hi,
         count(*) FILTER (WHERE edge<0) neg_n,
         round(100.0*(avg((outcome='win')::int) FILTER (WHERE edge<0) - avg(market_prob) FILTER (WHERE edge<0))::numeric,2) neg_vs_mkt,
         count(*) FILTER (WHERE edge>0) pos_n,
         round(100.0*(avg((outcome='win')::int) FILTER (WHERE edge>0) - avg(market_prob) FILTER (WHERE edge>0))::numeric,2) pos_vs_mkt
    FROM pick_history
   WHERE outcome IN ('win','loss') AND edge IS NOT NULL AND market_prob IS NOT NULL
   GROUP BY band ORDER BY band`);
console.log('Is the fade a longshot artifact? vs-market by market_prob band:');
for (const x of r.rows) console.log('   ', JSON.stringify(x));
const d=await c.query(`SELECT dimension, count(*) n, round(100.0*(avg((outcome='win')::int)-avg(market_prob))::numeric,2) vs_mkt FROM pick_history WHERE outcome IN ('win','loss') AND edge<0 AND market_prob IS NOT NULL GROUP BY dimension HAVING count(*)>100 ORDER BY vs_mkt LIMIT 6`);
console.log('negative-edge, by dimension (n>100):');
for (const x of d.rows) console.log('   ', JSON.stringify(x));
await c.end();
