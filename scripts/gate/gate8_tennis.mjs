// GATE 8 -- tennis, and specifically the Winner/Loser de-randomisation.
//
// This is gate 4.7, moved. 4.7 lives in gate4_staging.mjs, which checks
// odds_import_staging -- and tennis never enters staging, because that
// importer is shaped around a pair of TEAMS and a tennis match is a contest
// between two people. So the check has to run against the live tables.
//
// WHAT IS BEING GUARDED AGAINST
//
// The tennis-data.co.uk files name every column after the OUTCOME: Winner,
// Loser, WRank, LRank, B365W, B365L, AvgW, AvgL. Loaded in file order the
// target is the column name. A model trained on that scores ~100% and is
// worthless, and nothing about it looks wrong -- every metric is excellent.
//
// 8.1 is therefore the whole gate: p1 must win half the time. But 8.1 ALONE is
// not sufficient, and that is the interesting part -- a loader that assigned
// p1/p2 by a coin flip and threw the prices away entirely would also pass it.
// So 8.2 asserts the data is still real by checking that the cheaper side
// still wins far more often than the dearer one, and 8.3 asserts the same
// orientation was applied to the scores and the prices TOGETHER, which is the
// specific way a half-done de-randomisation fails.
import pg from 'pg'; import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const url = env.split('\n').find(l => l.startsWith('DATABASE_URL='))?.slice(13).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url }); await c.connect();
await c.query(`SET statement_timeout='600s'`);
const fail = [], note = [];
const chk = (cond, l, v) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${l.padEnd(50)} ${v}`); if (!cond) fail.push(`${l} -> ${v}`); };
console.log('\nGATE 8 -- tennis\n');

console.log('8.1  p1 wins half the time (a leak reads as 1.000)');
for (const r of (await c.query(`SELECT sport, count(*)::int n,
    avg((home_score > away_score)::int)::float p1
  FROM game_result WHERE source='tennis_data' GROUP BY 1 ORDER BY 1`)).rows)
  chk(Math.abs(r.p1 - 0.5) <= 0.02, `8.1 ${r.sport} p1 win rate`,
    `${Number(r.p1).toFixed(4)} over ${r.n.toLocaleString()} matches`);

// A TIED SET SCORE IS NOT A TENNIS RESULT, and a row carrying one is a
// mislabelled target rather than a missing one. 583 matches are retirements
// before either player was a set ahead: the file knows who won, the two score
// columns cannot say so, and writing them anyway makes `home_score >
// away_score` false for matches p1 may have won. import_tennis.py drops them;
// this asserts none came back. It also moved the measured p1 rate from 0.4959
// to 0.5006, which is how the problem was noticed at all.
const ties = await c.query(`SELECT count(*)::int n FROM game_result
  WHERE source='tennis_data' AND home_score = away_score`);
chk(ties.rows[0].n === 0, '8.1 no tied set scores (a match has a winner)', `${ties.rows[0].n}`);

// PER YEAR AS WELL AS OVERALL. Twenty-four separate workbooks are loaded here,
// and a leak confined to one of them -- a year whose columns are ordered
// differently, a sheet re-sorted by hand -- would be diluted to invisibility
// in the pooled number. 0.5 +- 0.05 is roughly 3 sd on a 2,500-match season.
console.log('\n8.1b  ...in every season of every tour, not just pooled');
const yrs = await c.query(`SELECT sport, extract(year from game_date)::int y, count(*)::int n,
    avg((home_score > away_score)::int)::float p1
  FROM game_result WHERE source='tennis_data' GROUP BY 1,2 HAVING count(*) >= 500 ORDER BY 1,2`);
const bad = yrs.rows.filter(r => Math.abs(r.p1 - 0.5) > 0.05);
chk(bad.length === 0, '8.1b every tour-season balanced',
  bad.length ? bad.map(r => `${r.sport} ${r.y} ${Number(r.p1).toFixed(3)}`).join(', ')
    : `${yrs.rows.length} tour-seasons, worst ${Math.max(...yrs.rows.map(r => Math.abs(r.p1 - 0.5))).toFixed(3)} from 0.500`);

console.log('\n8.2  ...but the prices still know who was likely to win');
// The counterweight to 8.1. Randomising the sides and then discarding the
// prices would satisfy 8.1 perfectly and leave a table with no information in
// it at all. A real tennis favourite wins roughly two thirds of the time.
const fav = await c.query(`
  WITH m AS (SELECT event_ref, sport,
      avg(price) FILTER (WHERE side='home') hp,
      avg(price) FILTER (WHERE side='away') ap
    FROM odds_archive WHERE source='tennis_data' AND bookmaker='market_avg' AND price IS NOT NULL
    GROUP BY 1,2 HAVING count(*) = 2)
  SELECT m.sport, count(*)::int n,
    avg(((m.hp < m.ap) = (g.home_score > g.away_score))::int)::float favwin
  FROM m JOIN game_result g ON g.event_ref = m.event_ref AND g.source='tennis_data'
  GROUP BY 1 ORDER BY 1`);
for (const r of fav.rows)
  chk(r.favwin >= 0.60 && r.favwin <= 0.80, `8.2 ${r.sport} cheaper side wins`,
    `${(r.favwin * 100).toFixed(1)}% of ${r.n.toLocaleString()} matches`);

console.log('\n8.3  the SAME orientation reached the scores and the prices');
// The half-done de-randomisation: names and scores swapped, prices left where
// the file put them. 8.1 still passes (p1 wins 50%) and 8.2 INVERTS -- the
// dearer side starts winning, because "home price" is really "winner price".
// Asserting favwin > 0.5 above already catches a full inversion; this catches
// the milder version by checking each price series separately, since a partial
// swap usually hits one column pair and not the others.
const perbook = await c.query(`
  WITH m AS (SELECT event_ref, sport, bookmaker,
      avg(price) FILTER (WHERE side='home') hp,
      avg(price) FILTER (WHERE side='away') ap
    FROM odds_archive WHERE source='tennis_data' AND price IS NOT NULL
    GROUP BY 1,2,3 HAVING count(*) = 2)
  SELECT m.bookmaker, count(*)::int n,
    avg(((m.hp < m.ap) = (g.home_score > g.away_score))::int)::float favwin
  FROM m JOIN game_result g ON g.event_ref = m.event_ref AND g.source='tennis_data'
  GROUP BY 1 ORDER BY 1`);
for (const r of perbook.rows)
  chk(r.favwin >= 0.60, `8.3 ${r.bookmaker} oriented with the result`,
    `${(r.favwin * 100).toFixed(1)}% (n=${r.n.toLocaleString()})`);

console.log('\n8.4  the load itself is sane');
const cov = await c.query(`SELECT sport, count(*)::int n, count(DISTINCT event_ref)::int matches,
    min(game_date)::text lo, max(game_date)::text hi, count(DISTINCT bookmaker)::int books
  FROM odds_archive WHERE source='tennis_data' GROUP BY 1 ORDER BY 1`);
for (const r of cov.rows)
  chk(r.matches > 20000 && r.books === 4 && r.lo <= '2015-12-31' && r.hi >= '2026-01-01',
    `8.4 ${r.sport} coverage`, `${r.matches.toLocaleString()} matches, ${r.books} price series, ${r.lo} -> ${r.hi}`);
const dup = await c.query(`SELECT count(*)::int n FROM (
  SELECT sport, event_ref, bookmaker, side FROM odds_archive WHERE source='tennis_data'
  GROUP BY 1,2,3,4 HAVING count(*) > 1) t`);
// Idempotency: odds_archive's own natural key is PARTIAL and skips rows with a
// null entity id, which every tennis row has. Migration 20260901180000 adds the
// index that covers them; without it a second run doubles the table in silence.
chk(dup.rows[0].n === 0, '8.4 no duplicate (match, book, side)', `${dup.rows[0].n}`);
const bs = await c.query(`SELECT avg(booksum)::float b, count(*)::int n FROM odds_archive
  WHERE source='tennis_data' AND bookmaker='market_avg' AND booksum IS NOT NULL`);
chk(bs.rows[0].b >= 1.02 && bs.rows[0].b <= 1.12, '8.4 market_avg booksum',
  `${Number(bs.rows[0].b).toFixed(4)} (n=${bs.rows[0].n.toLocaleString()})`);

// market_max is EXCLUDED here on purpose. It is the best price across books,
// so summing below 1 is a cross-book arbitrage and happens on ~36% of matches
// -- expected, and carrying the `best_of_market` flag that says so. A REAL
// book below 1.0 is a source error (Djokovic at +1600 in a Rome semi-final),
// and the point of the bound is to notice if that ever stops being rare.
const sub1 = await c.query(`SELECT count(*)::int bad, count(*) FILTER (WHERE true)::int _
  FROM odds_archive WHERE source='tennis_data' AND bookmaker <> 'market_max'
    AND booksum IS NOT NULL AND booksum < 1.0`);
const realBooks = await c.query(`SELECT count(*)::int n FROM odds_archive
  WHERE source='tennis_data' AND bookmaker <> 'market_max' AND booksum IS NOT NULL`);
chk(sub1.rows[0].bad / realBooks.rows[0].n <= 0.001, '8.4 real books almost never sum below 1',
  `${sub1.rows[0].bad} of ${realBooks.rows[0].n.toLocaleString()} (${(sub1.rows[0].bad / realBooks.rows[0].n * 100).toFixed(3)}%)`);

console.log('\n8.5  player ids are absent, and honestly so');
// NOT a failure. These files publish "Vukic A." and no id of any kind, and
// player_game_history's tennis rows carry 4-digit ids from another provider
// with no name column to bridge them. The columns stay NULL rather than
// holding a guess -- that guess is the failure this project has already paid
// for twice. Asserted so nobody later reads the nulls as a bug and "fixes"
// them by inventing something.
const ids = await c.query(`SELECT count(*)::int n FROM odds_archive
  WHERE source='tennis_data' AND (home_team_id IS NOT NULL OR away_team_id IS NOT NULL)`);
chk(ids.rows[0].n === 0, '8.5 no invented player ids', `${ids.rows[0].n} row(s) carry one`);
note.push('8.5 tennis player ids remain unresolved by design — see import_tennis.py');
note.push('8.6 surface, round and seed ranks are NOT loaded — no column for them in either shared table; the orientation is a pure function of the match key, so a later loader re-derives the same p1/p2 and can add them');

if (note.length) { console.log('\nNOTES:'); note.forEach(n => console.log(`  - ${n}`)); }
console.log(`\n${fail.length ? `GATE 8 FAILED — ${fail.length}` : 'GATE 8 PASSED'}`);
await c.end();
process.exit(fail.length ? 1 : 0);
