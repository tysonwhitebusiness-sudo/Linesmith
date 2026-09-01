import pg from 'pg'; import fs from 'fs';
const env=fs.readFileSync('.env.local','utf8');
const url=env.split('\n').find(l=>l.startsWith('DATABASE_URL='))?.slice(13).trim().replace(/^["']|["']$/g,'');
const c=new pg.Client({connectionString:url}); await c.connect();
const fail=[],note=[];
const chk=(x,l,v)=>{console.log(`  ${x?'PASS':'FAIL'}  ${l.padEnd(44)} ${v}`); if(!x)fail.push(`${l} -> ${v}`);};
console.log('\nGATE 6 -- injury logger\n');
const r=await c.query(`SELECT sport,count(*)::int n,max(captured_on)::text d FROM injury_report GROUP BY 1 ORDER BY 2 DESC`);
console.log('  captured:', r.rows.map(x=>`${x.sport}:${x.n}`).join(' '));
chk(r.rows.length>=4,'6.1 at least 4 sports captured',`${r.rows.length} sports`);
const t=await c.query(`SELECT count(*)::int n FROM injury_report`);
chk(t.rows[0].n>=500,'6.1 total injury rows',`${t.rows[0].n}`);
const a=await c.query(`SELECT round(100.0*count(athlete_id)/count(*),1) pct FROM injury_report`);
chk(Number(a.rows[0].pct)>=90,'6.2 athlete_id populated',`${a.rows[0].pct}%`);
// idempotence: the unique key means a same-day re-run must not duplicate
const d=await c.query(`SELECT count(*)::int n FROM (SELECT sport,captured_on,COALESCE(athlete_id,''),COALESCE(athlete_name,'')
  FROM injury_report GROUP BY 1,2,3,4 HAVING count(*)>1) t`);
chk(d.rows[0].n===0,'6.3 no duplicate (sport, day, athlete)',`${d.rows[0].n}`);
note.push('soccer returns 0 injuries -- ESPN publishes none for eng.1/usa.1, measured against CFB in the same minute');
if(note.length){console.log('\nNOTES:');note.forEach(n=>console.log(`  - ${n}`));}
console.log(`\n${fail.length?`GATE 6 FAILED -- ${fail.length}`:'GATE 6 PASSED'}`);
fail.forEach(f=>console.log(`  ! ${f}`));
await c.end(); process.exit(fail.length?1:0);
