/**
 * GATE 4 — run BEFORE promoting staging into odds_archive.
 *
 * 4.5 matters most: two independent sources agreeing, on the same resolved team
 * ids, is the strongest evidence that both the odds parse AND the entity
 * resolution are right. Gate 1.9 could not run it because SBR's names had not
 * been resolved yet.
 */
import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.split('\n').find(l => l.startsWith('DATABASE_URL='))?.slice(13).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query(`SET statement_timeout='300s'`);

const fail = [], note = [];
const chk = (cond, label, val) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ${val}`);
  if (!cond) fail.push(`${label} -> ${val}`);
};

console.log('\nGATE 4 — staging\n');

console.log('4.1  resolution rate >= 90% per sport');
for (const r of (await c.query(`SELECT sport, count(*) FILTER (WHERE resolution_status='resolved')::int ok, count(*)::int n
  FROM odds_import_staging GROUP BY 1 ORDER BY 1`)).rows)
  chk(r.ok / r.n >= 0.90, `4.1 ${r.sport}`, `${(r.ok / r.n * 100).toFixed(2)}% (${r.ok.toLocaleString()}/${r.n.toLocaleString()})`);

console.log('\n4.2  every unresolved row carries a note');
const r2 = await c.query(`SELECT count(*)::int n FROM odds_import_staging WHERE resolution_status<>'resolved' AND resolution_note IS NULL`);
chk(r2.rows[0].n === 0, '4.2 unresolved rows without a note', `${r2.rows[0].n}`);
console.log('       reasons:', (await c.query(`SELECT resolution_note, count(*)::int n FROM odds_import_staging
  WHERE resolution_status<>'resolved' GROUP BY 1 ORDER BY 2 DESC`)).rows.map(x => `${x.resolution_note}=${x.n}`).join(' | '));

// DOUBLEHEADERS ARE REAL. The first run flagged 4,022 "duplicates", 805 of them
// MLB spread/home; the sample was two different ESPN event ids on the same date
// with the same teams — two real games. event_ref is part of the key.
console.log('\n4.3  no duplicate natural keys (event_ref included — doubleheaders are real games)');
const r3 = await c.query(`SELECT count(*)::int n FROM (
  SELECT sport,game_date,home_team_id,away_team_id,market,side,COALESCE(bookmaker,''),source,COALESCE(event_ref,'')
  FROM odds_import_staging WHERE resolution_status='resolved'
  GROUP BY 1,2,3,4,5,6,7,8,9 HAVING count(*)>1) t`);
chk(r3.rows[0].n === 0, '4.3 duplicate natural keys', `${r3.rows[0].n} key(s)`);

console.log('\n4.4  dates inside plausible ranges');
for (const r of (await c.query(`SELECT sport, min(game_date)::text lo, max(game_date)::text hi, count(*)::int n
  FROM odds_import_staging WHERE resolution_status='resolved' GROUP BY 1 ORDER BY 1`)).rows)
  chk(!(r.lo < '2007-01-01' || r.hi > '2026-12-31'), `4.4 ${r.sport} span`, `${r.lo} -> ${r.hi} (${r.n.toLocaleString()})`);

console.log('\n4.5  CROSS-SOURCE: SBR vs ESPN on the same resolved game');
// DERIVE the date offset rather than assuming 0. SBR dates are LOCAL with no
// timezone; ESPN's are UTC, so a 7pm ET tip is next-day UTC. Measured: NBA
// matches cluster at +1 (524) against 0 (142).
//
// The PRIMARY assertion is BIAS, not per-game distance. SBR is one consensus
// snapshot; ESPN is a ~16-book average at close, of a line that genuinely
// moves. Measured on NBA: bias 0.358, sd 2.450, a clean bell curve centred on
// zero — the two sources agree on the mean to a third of a point. NHL reaches
// 100% within ±1.5 only because its totals are 5.5/6.5 with coarse
// granularity; asserting ±1.5 on NBA tests line movement, not the parse.
const TOL = { nba: 3.0, nhl: 1.5 };
for (const sport of ['nba', 'nhl']) {
  const off = await c.query(`
    WITH s AS (SELECT game_date,home_team_id,away_team_id FROM odds_import_staging
               WHERE source='sbr' AND sport=$1 AND market='total' AND side='over' AND resolution_status='resolved'),
         e AS (SELECT DISTINCT game_date,home_team_id,away_team_id FROM odds_import_staging
               WHERE source='espn_core' AND sport=$1 AND market='total' AND side='over' AND resolution_status='resolved')
    SELECT (e.game_date-s.game_date) o, count(*)::int n FROM s JOIN e
      ON e.home_team_id=s.home_team_id AND e.away_team_id=s.away_team_id
      AND e.game_date BETWEEN s.game_date-1 AND s.game_date+1 GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, [sport]);
  if (!off.rows.length) { note.push(`4.5 ${sport}: no overlap`); continue; }
  const O = off.rows[0].o;
  const q = await c.query(`
    WITH s AS (SELECT game_date,home_team_id,away_team_id,line FROM odds_import_staging
               WHERE source='sbr' AND sport=$1 AND market='total' AND side='over' AND resolution_status='resolved' AND line IS NOT NULL),
         e AS (SELECT game_date,home_team_id,away_team_id,avg(line) line FROM odds_import_staging
               WHERE source='espn_core' AND sport=$1 AND market='total' AND side='over' AND resolution_status='resolved' AND line IS NOT NULL GROUP BY 1,2,3)
    SELECT count(*)::int n, avg(s.line-e.line)::float bias, stddev(s.line-e.line)::float sd,
           count(*) FILTER (WHERE abs(s.line-e.line)<=$2)::int agree
    FROM s JOIN e ON e.home_team_id=s.home_team_id AND e.away_team_id=s.away_team_id
       AND e.game_date = s.game_date + ($3)::int`, [sport, TOL[sport], O]);
  const { n, bias, sd, agree } = q.rows[0];
  if (n < 50) { note.push(`4.5 ${sport}: only ${n} overlapping games`); continue; }
  chk(Math.abs(bias) <= 0.75, `4.5 ${sport} total BIAS (the real check)`,
    `${Number(bias).toFixed(3)} pts (sd ${Number(sd).toFixed(2)}, n=${n}, offset ${O}d)`);
  chk(agree / n >= 0.75, `4.5 ${sport} per-game within +-${TOL[sport]}`, `${(agree / n * 100).toFixed(1)}%`);
  // AVERAGE IMPLIED PROBABILITIES, NEVER AMERICAN ODDS. The first version
  // averaged the raw American price and produced a mean home-away gap of 2,528
  // -- one +5000 longshot drags the mean past every real price, so "which side
  // is lower" stopped meaning "which side is the favourite". American odds are
  // not linear and cannot be averaged.
  const f = await c.query(`
    WITH imp AS (SELECT game_date,home_team_id,away_team_id,side,source,
                        CASE WHEN price>0 THEN 100.0/(price+100.0) ELSE (-price)/((-price)+100.0) END p
                 FROM odds_import_staging
                 WHERE sport=$1 AND market='moneyline' AND resolution_status='resolved' AND price IS NOT NULL),
         s AS (SELECT game_date,home_team_id,away_team_id,avg(p) FILTER (WHERE side='home') hp,
                      avg(p) FILTER (WHERE side='away') ap FROM imp WHERE source='sbr' GROUP BY 1,2,3),
         e AS (SELECT game_date,home_team_id,away_team_id,avg(p) FILTER (WHERE side='home') hp,
                      avg(p) FILTER (WHERE side='away') ap FROM imp WHERE source='espn_core' GROUP BY 1,2,3)
    SELECT count(*)::int n, count(*) FILTER (WHERE (s.hp>s.ap)=(e.hp>e.ap))::int same
    FROM s JOIN e ON e.home_team_id=s.home_team_id AND e.away_team_id=s.away_team_id
       AND e.game_date = s.game_date + ($2)::int
    WHERE s.hp IS NOT NULL AND s.ap IS NOT NULL AND e.hp IS NOT NULL AND e.ap IS NOT NULL`, [sport, O]);
  if (f.rows[0].n >= 50) chk(f.rows[0].same / f.rows[0].n >= 0.95, `4.5 ${sport} same favourite`,
    `${(f.rows[0].same / f.rows[0].n * 100).toFixed(1)}% (n=${f.rows[0].n})`);
  else note.push(`4.5 ${sport} favourite: only ${f.rows[0].n} overlaps`);
}

console.log('\n4.8  distinct resolved teams per sport equals league size');
const EXPECT = { nba: 30, nhl: 32, nfl: 32, soccer_epl: 20, soccer_mls: 30, mlb: 30 };
for (const r of (await c.query(`SELECT sport, count(DISTINCT home_team_id)::int n FROM odds_import_staging
  WHERE resolution_status='resolved' GROUP BY 1 ORDER BY 1`)).rows) {
  const e = EXPECT[r.sport];
  if (!e) { note.push(`4.8 ${r.sport}: ${r.n} teams (no fixed league size)`); continue; }
  chk(Math.abs(r.n - e) <= 3, `4.8 ${r.sport} teams (expect ~${e})`, `${r.n}`);
}

note.push('4.6 score agreement: game_result not yet populated — deferred to Phase 4b');
note.push('4.7 tennis orientation: tennis is a PLAYER entity, not a team pair, so it is not loaded by this team-shaped importer. Deferred — the Winner/Loser de-randomisation remains REQUIRED before any tennis load.');

if (note.length) { console.log('\nNOTES:'); note.forEach(n => console.log(`  - ${n}`)); }
console.log(`\n${fail.length ? `GATE 4 FAILED — ${fail.length}` : 'GATE 4 PASSED'}`);
fail.forEach(f => console.log(`  ! ${f}`));
await c.end();
process.exit(fail.length ? 1 : 0);
