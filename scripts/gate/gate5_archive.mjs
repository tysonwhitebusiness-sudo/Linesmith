// GATE 5 -- run AFTER promotion, against the LIVE table, not the CSVs.
import pg from 'pg'; import fs from 'fs';
const env=fs.readFileSync('.env.local','utf8');
const url=env.split('\n').find(l=>l.startsWith('DATABASE_URL='))?.slice(13).trim().replace(/^["']|["']$/g,'');
const c=new pg.Client({connectionString:url}); await c.connect();
await c.query(`SET statement_timeout='600s'`);
// The oldest date any source legitimately carries. This was '2007-01-01' when
// SBR's NBA file (2007-10-30) was the deepest thing in the archive -- a
// high-water mark mistaken for a rule. nflverse goes back to 1999 and is not
// wrong for doing so.
const ARCHIVE_FLOOR = '1999-01-01';
const fail=[],note=[];
const chk=(cond,l,v)=>{console.log(`  ${cond?'PASS':'FAIL'}  ${l.padEnd(46)} ${v}`); if(!cond)fail.push(`${l} -> ${v}`);};
console.log('\nGATE 5 -- live odds_archive\n');

// The two corrupt SBR NBA moneylines (-8 and +8, impossible American prices)
// are now rejected by promote_odds.mjs's WHERE clause instead of being deleted
// by hand afterwards, so live == staged exactly. The old hand-deletion was not
// reproducible: the next `--truncate` re-import put both rows straight back and
// this check failed on a pipeline that had behaved correctly.
const DELETED_CORRUPT = 0;
// SCOPED TO THE SOURCES THAT ACTUALLY COME THROUGH STAGING. Tennis is loaded
// straight into odds_archive by import_tennis.py, because a tennis match is a
// contest between two PEOPLE and odds_import_staging is shaped around a pair
// of teams. Counting its rows against the staging total would fail this check
// for a load that is entirely correct. gate8_tennis.mjs covers that source.
// DERIVED, not a hardcoded list: whichever sources staging currently holds are
// the ones promotion is responsible for. Sources written straight to the
// archive (tennis) are excluded automatically, and a newly added loader is
// included automatically.
const stagedSrcs=(await c.query(`SELECT DISTINCT source FROM odds_import_staging WHERE resolution_status='resolved'`)).rows.map(r=>r.source);
const staged=await c.query(`SELECT count(*)::int n FROM odds_import_staging WHERE resolution_status='resolved'`);
const live=await c.query(`SELECT count(*)::int n FROM odds_archive WHERE source = ANY($1::text[])`,[stagedSrcs]);
chk(live.rows[0].n===staged.rows[0].n-DELETED_CORRUPT,`5.1 promoted count equals staged-resolved (${stagedSrcs.join(', ')})`,
  `${live.rows[0].n.toLocaleString()} vs ${(staged.rows[0].n-DELETED_CORRUPT).toLocaleString()}`);

console.log('\n5.2  every sport present with a plausible span');
for(const r of (await c.query(`SELECT sport,count(*)::int n,min(game_date)::text lo,max(game_date)::text hi,
  count(DISTINCT source)::int src FROM odds_archive GROUP BY 1 ORDER BY 1`)).rows)
  chk(r.n>1000 && r.lo>=ARCHIVE_FLOOR && r.hi<='2026-12-31', `5.2 ${r.sport}`, `${r.n.toLocaleString()} rows, ${r.lo} -> ${r.hi}, ${r.src} source(s)`);
const sports=(await c.query(`SELECT DISTINCT sport FROM odds_archive`)).rows.map(r=>r.sport);
// Nine: the seven team leagues plus tennis_atp and tennis_wta, added 2026-09-01.
chk(sports.length===9,'5.2 all 9 league keys present',sports.sort().join(' '));

// 5.3 ASSERTS FLAG HONESTY, NOT ABSENCE. The first version demanded that no
// `sub_one_not_two_way` row exist, which would have meant DELETING 95,390 NHL
// rows that are real prices for a real market: some books quote NHL as a
// three-way REGULATION market (measured booksum 0.83). That is not corruption,
// it simply is not a two-way close. The right contract is that any row whose
// booksum falls below 1.0 carries a flag saying so, and that every two-way
// sport still has a large body of genuinely two-way rows to read.
console.log('\n5.3  flag honesty, and enough clean two-way rows');
// `best_of_market` joined the honest-flag list with the tennis load. It is
// not a bookmaker: it is the BEST price across books on each side, so its two
// implied probabilities sum below 1 on about 36% of tennis matches (41,494
// rows, mean booksum 1.0029). That is a cross-book arbitrage, not a broken
// two-way close, and calling it `sub_one_not_two_way` would have been a lie
// told to make a gate pass. A real book below 1.0 still gets the old flag --
// 68 rows, all misplaced decimal points in the source.
const mis=await c.query(`SELECT count(*)::int n FROM odds_archive
  WHERE booksum IS NOT NULL AND booksum<1.0
    AND ml_flag NOT IN ('sub_one_not_two_way','three_way_odd','best_of_market')`);
chk(mis.rows[0].n===0,'5.3 sub-one rows all carry an honest flag',`${mis.rows[0].n} mislabelled`);
for(const r of (await c.query(`SELECT sport,count(*) FILTER (WHERE ml_flag='two_way')::int two,count(*)::int n
  FROM odds_archive WHERE market='moneyline' AND sport NOT LIKE 'soccer%' GROUP BY 1 ORDER BY 1`)).rows)
  chk(r.two>=500 && r.two/r.n>=0.30, `5.3 ${r.sport} clean two-way moneylines`,
      `${r.two.toLocaleString()} of ${r.n.toLocaleString()} (${(r.two/r.n*100).toFixed(0)}%)`);

console.log('\n5.4  booksum sane per sport (the site-API NHL failure was 0.83)');
for(const r of (await c.query(`SELECT sport, avg(booksum)::float b, count(*)::int n FROM odds_archive
  WHERE booksum IS NOT NULL AND ml_flag IN ('two_way','three_way') GROUP BY 1 ORDER BY 1`)).rows)
  chk(r.b>=1.02 && r.b<=1.15, `5.4 ${r.sport} booksum`, `${r.b.toFixed(4)} (n=${r.n.toLocaleString()})`);

console.log('\n5.5  totals are a varying line, never a constant');
for(const r of (await c.query(`SELECT sport,count(DISTINCT line)::int d,stddev(line)::float sd,count(*)::int n
  FROM odds_archive WHERE market='total' AND line IS NOT NULL GROUP BY 1 ORDER BY 1`)).rows)
  chk(r.d>=3 && r.sd>0.1, `5.5 ${r.sport} distinct totals`, `${r.d} distinct, sd ${Number(r.sd).toFixed(3)} (n=${r.n.toLocaleString()})`);

console.log('\n5.6  moneyline prices are real American odds');
const p=await c.query(`SELECT count(*)::int bad FROM odds_archive WHERE market='moneyline' AND price IS NOT NULL AND price BETWEEN -99 AND 99`);
chk(p.rows[0].bad===0,'5.6 impossible prices in (-100,100)',`${p.rows[0].bad}`);
const z=await c.query(`SELECT count(*)::int bad FROM odds_archive WHERE (market='total' AND line=0) OR (market='moneyline' AND price=0)`);
chk(z.rows[0].bad===0,'5.6 zero placeholders promoted',`${z.rows[0].bad}`);

console.log('\n5.8  the archive is a faithful projection of staging, VALUE BY VALUE');
// THE BUG THIS EXISTS FOR, found 2026-09-01. Counting rows is not enough:
// after the NHL SBR parser was fixed, staging held 18,203 total rows with a
// real closing price and the archive held 18,203 total rows with NONE, because
// promotion used ON CONFLICT DO NOTHING and every corrected row collided with
// the row the broken parse had already written. Row counts matched perfectly.
// The moneylines landed only because they were new keys.
//
// So this compares populated-VALUE counts per (sport, source, market, side),
// not row counts. A correction that fails to carry shows up here and nowhere
// else in the suite.
const proj = await c.query(`
  WITH s AS (SELECT sport,source,market,side,count(*)::int n,count(price)::int p,count(line)::int l
             FROM odds_import_staging WHERE resolution_status='resolved' GROUP BY 1,2,3,4),
       a AS (SELECT sport,source,market,side,count(*)::int n,count(price)::int p,count(line)::int l
             FROM odds_archive GROUP BY 1,2,3,4)
  SELECT s.sport,s.source,s.market,s.side,s.p sp,a.p ap,s.l sl,a.l al
  FROM s JOIN a USING (sport,source,market,side)
  WHERE s.p<>a.p OR s.l<>a.l`);
chk(proj.rows.length === 0, '5.8 staged values all reached the archive',
  proj.rows.length ? proj.rows.map(r => `${r.sport}/${r.source}/${r.market}/${r.side} price ${r.sp}->${r.ap} line ${r.sl}->${r.al}`).join('; ') : 'every (sport,source,market,side) matches');

// Same idea one level up: a market that exists in staging must exist in the
// archive at all. NHL SBR moneylines were absent from BOTH for weeks, so this
// would not have caught the original bug -- but it catches the reverse, a
// promotion that drops a whole market.
const missing = await c.query(`
  SELECT sport,source,market,side FROM odds_import_staging WHERE resolution_status='resolved'
  GROUP BY 1,2,3,4
  EXCEPT SELECT sport,source,market,side FROM odds_archive GROUP BY 1,2,3,4`);
chk(missing.rows.length === 0, '5.8 no staged market missing from the archive',
  missing.rows.length ? missing.rows.map(r => `${r.sport}/${r.source}/${r.market}/${r.side}`).join(', ') : 'none');

console.log('\n5.7  database size');
const sz=await c.query(`SELECT pg_size_pretty(pg_database_size(current_database())) s, pg_database_size(current_database())/1048576 mb`);
const mb=Number(sz.rows[0].mb);
chk(mb<6000,'5.7 db size under 6 GB',`${sz.rows[0].s} (was 3,141 MB before this import)`);

if(note.length){console.log('\nNOTES:');note.forEach(n=>console.log(`  - ${n}`));}
console.log(`\n${fail.length?`GATE 5 FAILED -- ${fail.length}`:'GATE 5 PASSED'}`);
fail.forEach(f=>console.log(`  ! ${f}`));
await c.end(); process.exit(fail.length?1:0);
