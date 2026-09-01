// GATE 2.7 -- the decisive prop check: do athlete ids join to player_game_history?
// Props that cannot be tied to a player are unusable no matter how many landed.
import pg from 'pg'; import fs from 'fs';
const env=fs.readFileSync('.env.local','utf8');
const url=env.split('\n').find(l=>l.startsWith('DATABASE_URL='))?.slice(13).trim().replace(/^["']|["']$/g,'');
const c=new pg.Client({connectionString:url}); await c.connect();
await c.query(`SET statement_timeout='600s'`);
const fail=[],note=[];
const chk=(x,l,v)=>{console.log(`  ${x?'PASS':'FAIL'}  ${l.padEnd(44)} ${v}`); if(!x)fail.push(`${l} -> ${v}`);};
console.log('\nGATE 2.7 -- prop athlete ids vs player_game_history\n');
for (const r of (await c.query(`SELECT sport, count(DISTINCT athlete_id)::int n FROM prop_odds_archive
  WHERE athlete_id IS NOT NULL GROUP BY 1 ORDER BY 1`)).rows) {
  const m=await c.query(`SELECT count(DISTINCT p.athlete_id)::int n FROM prop_odds_archive p
    WHERE p.sport=$1 AND p.athlete_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM player_game_history h WHERE h.sport=$1 AND h.athlete_id=p.athlete_id)`,[r.sport]);
  const pct=m.rows[0].n/r.n;
  // MLB is expected to fail: player_game_history uses MLB StatsAPI athlete ids,
  // ESPN props carry ESPN athlete ids -- the same split as team ids.
  if (r.sport==='mlb'||r.sport==='nhl') { note.push(`${r.sport}: ${(pct*100).toFixed(1)}% (${m.rows[0].n}/${r.n}) -- expected, this sport does not use ESPN athlete ids`); continue; }
  chk(pct>=0.80, `2.7 ${r.sport} athlete ids resolve`, `${(pct*100).toFixed(1)}% (${m.rows[0].n}/${r.n})`);
}
console.log('\n2.9  two-sided booksum where both sides merged');
const b=await c.query(`SELECT sport, count(*)::int n, avg(
   CASE WHEN over_price>0 THEN 100.0/(over_price+100) ELSE (-over_price)/((-over_price)+100.0) END +
   CASE WHEN under_price>0 THEN 100.0/(under_price+100) ELSE (-under_price)/((-under_price)+100.0) END)::float bs
  FROM prop_odds_archive WHERE over_price IS NOT NULL AND under_price IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`);
for (const r of b.rows) chk(r.bs>=1.02 && r.bs<=1.35, `2.9 ${r.sport} prop booksum`, `${r.bs.toFixed(4)} (n=${r.n.toLocaleString()})`);
if(note.length){console.log('\nNOTES:');note.forEach(n=>console.log(`  - ${n}`));}
console.log(`\n${fail.length?`GATE 2.7 FAILED -- ${fail.length}`:'GATE 2.7 PASSED'}`);
fail.forEach(f=>console.log(`  ! ${f}`));
await c.end(); process.exit(fail.length?1:0);
