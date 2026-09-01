// Dedupe staging, then promote resolved rows into odds_archive.
// The 38 residual duplicates are MLB rows where the SAME provider appears twice
// in one ESPN odds response (same event_ref, same bookmaker, same market/side).
// They are not doubleheaders -- those were fixed by adding event_ref to the key.
// Keeping the lowest id is arbitrary but safe: the rows are identical apart
// from the surrogate id.
import pg from 'pg'; import fs from 'fs';
const env=fs.readFileSync('.env.local','utf8');
const url=env.split('\n').find(l=>l.startsWith('DATABASE_URL='))?.slice(13).trim().replace(/^["']|["']$/g,'');
const c=new pg.Client({connectionString:url}); await c.connect();
await c.query(`SET statement_timeout='600s'`);

const del=await c.query(`DELETE FROM odds_import_staging s USING (
  SELECT min(id) keep, sport,game_date,home_team_id,away_team_id,market,side,COALESCE(bookmaker,'') b,source,COALESCE(event_ref,'') e
  FROM odds_import_staging WHERE resolution_status='resolved'
  GROUP BY sport,game_date,home_team_id,away_team_id,market,side,COALESCE(bookmaker,''),source,COALESCE(event_ref,'')
  HAVING count(*)>1) d
 WHERE s.resolution_status='resolved' AND s.sport=d.sport AND s.game_date=d.game_date
   AND s.home_team_id=d.home_team_id AND s.away_team_id=d.away_team_id AND s.market=d.market
   AND s.side=d.side AND COALESCE(s.bookmaker,'')=d.b AND s.source=d.source
   AND COALESCE(s.event_ref,'')=d.e AND s.id<>d.keep`);
console.log('deduped staging rows:', del.rowCount);

const ins=await c.query(`
  INSERT INTO odds_archive (sport,event_ref,game_date,home_team_raw,away_team_raw,home_team_id,away_team_id,
    market,side,line,price,open_line,open_price,bookmaker,provider,source,source_priority,booksum,ml_flag)
  SELECT sport,event_ref,game_date,home_team_raw,away_team_raw,home_team_id,away_team_id,
    market,side,line,price,open_line,open_price,bookmaker,provider,source,source_priority,booksum,ml_flag
  FROM odds_import_staging WHERE resolution_status='resolved'
  ON CONFLICT DO NOTHING`);
console.log('promoted into odds_archive:', ins.rowCount);

const s=await c.query(`SELECT sport,source,count(*)::int n,min(game_date)::text lo,max(game_date)::text hi
  FROM odds_archive GROUP BY 1,2 ORDER BY 1,2`);
console.log('\nodds_archive contents:');
s.rows.forEach(r=>console.log(`  ${r.sport.padEnd(11)} ${r.source.padEnd(10)} ${String(r.n).padStart(7)}  ${r.lo} -> ${r.hi}`));
const t=await c.query(`SELECT count(*)::int n FROM odds_archive`);
console.log('\nTOTAL odds_archive rows:', t.rows[0].n.toLocaleString());
await c.end();
