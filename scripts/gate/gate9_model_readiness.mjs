/**
 * GATE 9 — model readiness. Run before fitting anything.
 *
 * Gates 1–8 assert the data LOADED correctly. This one asserts it can be
 * TRAINED on, which is a different question and has a different failure mode:
 * every check here passed structurally at the moment it was written and still
 * described something that would produce a good-looking, worthless model.
 *
 * The three that motivated it, all found by auditing rather than by any gate:
 *
 *  - 48,489 IN-PLAY prices sat in odds_archive as ordinary bookmakers. Brier
 *    0.032 against 0.208–0.232 for real pre-game books. Invisible in the
 *    aggregate because they were averaged with 19 other books.
 *  - CFB has 20.2% of its games priced by TWO sources. Both rows are correct;
 *    a naive join counts those games twice and silently over-weights whichever
 *    seasons the sources happen to overlap.
 *  - `(sport, athlete_id, game_date)` is NOT unique in player_game_history, and
 *    for three different reasons per sport.
 */
import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.split('\n').find(l => l.startsWith('DATABASE_URL='))?.slice(13).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url }); await c.connect();
await c.query(`SET statement_timeout='900s'`);
const fail = [], note = [];
const chk = (cond, l, v) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${l.padEnd(52)} ${v}`); if (!cond) fail.push(`${l} -> ${v}`); };
console.log('\nGATE 9 — model readiness\n');

console.log('9.1  no bookmaker knows the outcome');
// The generalised form of the in-play finding. Rather than naming the five
// "- Live Odds" books, this asks the question that mattered: is ANY bookmaker
// predicting far better than a market can? A real closing line lands near
// 0.18–0.24 depending on sport; anything under 0.12 is seeing the game.
const sharp = await c.query(`
  WITH p AS (SELECT source, bookmaker, sport, event_ref, game_date, home_team_id, away_team_id,
       avg(CASE WHEN price>0 THEN 100.0/(price+100) ELSE (-price)/((-price)+100.0) END) FILTER (WHERE side='home') hp,
       avg(CASE WHEN price>0 THEN 100.0/(price+100) ELSE (-price)/((-price)+100.0) END) FILTER (WHERE side='away') ap
     FROM odds_archive WHERE market='moneyline' AND price IS NOT NULL AND NOT is_live AND home_team_id IS NOT NULL
     GROUP BY 1,2,3,4,5,6,7)
  SELECT p.source, p.bookmaker, count(*)::int n,
    avg((p.hp/(p.hp+p.ap)-(g.home_score>g.away_score)::int)^2)::float brier
  FROM p JOIN game_result g ON g.sport=p.sport AND g.source=p.source AND g.game_date=p.game_date
    AND g.home_team_id=p.home_team_id AND g.away_team_id=p.away_team_id
    AND COALESCE(g.event_ref,'')=COALESCE(p.event_ref,'')
  WHERE p.hp IS NOT NULL AND p.ap IS NOT NULL AND g.home_score<>g.away_score
  GROUP BY 1,2 HAVING count(*)>=250 ORDER BY 4 LIMIT 1`);
if (!sharp.rows.length) note.push('9.1 no bookmaker with enough graded games');
else {
  const s = sharp.rows[0];
  chk(Number(s.brier) >= 0.12, '9.1 sharpest pre-game book is a market, not an oracle',
    `${s.source}/${s.bookmaker} Brier ${Number(s.brier).toFixed(4)} (n=${s.n.toLocaleString()})`);
}

console.log('\n9.2  the market is calibrated, per sport and per source');
// If a price were mis-parsed, mis-oriented, or joined to the wrong game, this
// is where it shows. Note the join carries BOTH source and event_ref: dropping
// them once produced an apparent catastrophe (MLB implied .263 against a
// realised .005) that was entirely an artifact of doubleheaders meeting the
// wrong scores.
const cal = await c.query(`
  WITH m AS (SELECT sport, source, game_date, home_team_id, away_team_id, COALESCE(event_ref,'') er,
      avg(CASE WHEN price>0 THEN 100.0/(price+100) ELSE (-price)/((-price)+100.0) END) FILTER (WHERE side='home') hp,
      avg(CASE WHEN price>0 THEN 100.0/(price+100) ELSE (-price)/((-price)+100.0) END) FILTER (WHERE side='away') ap
    FROM odds_archive WHERE market='moneyline' AND price IS NOT NULL AND NOT is_live AND home_team_id IS NOT NULL
      AND sport NOT LIKE 'soccer%' AND sport NOT LIKE 'tennis%' GROUP BY 1,2,3,4,5,6)
  SELECT m.sport, m.source, count(*)::int n, avg(m.hp/(m.hp+m.ap))::float implied,
    avg((g.home_score>g.away_score)::int)::float realised
  FROM m JOIN game_result g ON g.sport=m.sport AND g.source=m.source AND g.game_date=m.game_date
    AND g.home_team_id=m.home_team_id AND g.away_team_id=m.away_team_id AND COALESCE(g.event_ref,'')=m.er
  WHERE m.hp IS NOT NULL AND m.ap IS NOT NULL AND g.home_score<>g.away_score
  GROUP BY 1,2 HAVING count(*)>=200 ORDER BY 1,2`);
for (const r of cal.rows)
  chk(Math.abs(r.implied - r.realised) <= 0.04, `9.2 ${r.sport}/${r.source} calibration`,
    `implied ${r.implied.toFixed(4)} vs realised ${r.realised.toFixed(4)} (n=${r.n.toLocaleString()})`);

console.log('\n9.3  spread sign is one convention everywhere');
// nflverse ships the OPPOSITE sign to CFBD. Both were checked against real
// margins rather than assumed, and a single wrong negation would put one
// sport's spread into a shared column backwards — a feature a model fits
// happily and is confidently wrong about.
const sg = await c.query(`
  WITH s AS (SELECT o.sport, o.source, o.game_date, o.home_team_id, o.away_team_id, avg(o.line) line
    FROM odds_archive o WHERE o.market='spread' AND o.side='home' AND o.line IS NOT NULL
      AND NOT o.is_live AND o.home_team_id IS NOT NULL GROUP BY 1,2,3,4,5)
  SELECT s.sport, s.source, count(*)::int n, corr(s.line, (g.home_score-g.away_score))::float r
  FROM s JOIN game_result g ON g.sport=s.sport AND g.game_date=s.game_date
    AND g.home_team_id=s.home_team_id AND g.away_team_id=s.away_team_id
  GROUP BY 1,2 HAVING count(*)>=100 ORDER BY 1,2`);
for (const r of sg.rows)
  chk(r.r < 0, `9.3 ${r.sport}/${r.source} spread sign`, `corr ${r.r.toFixed(3)} (n=${r.n.toLocaleString()})`);

console.log('\n9.4  future-dated rows cannot reach a training set');
// game_result is the guard: it holds no future rows, so any query that joins
// odds to outcomes is safe by construction. Training on odds ALONE is not.
const fut = await c.query(`SELECT
  (SELECT count(*)::int FROM odds_archive WHERE game_date > CURRENT_DATE) o,
  (SELECT count(*)::int FROM game_result WHERE game_date > CURRENT_DATE) g`);
chk(fut.rows[0].g === 0, '9.4 no future-dated results', `${fut.rows[0].g}`);
note.push(`9.4 ${fut.rows[0].o.toLocaleString()} future-dated ODDS rows — always join to game_result`);

console.log('\n9.5  player_game_history: (athlete, date) is NOT a key — event_id is required');
// Three different legitimate reasons, one per sport, and none of them is a bug:
//   MLB     doubleheaders — two real games, same day, same teams
//   NBA     game_date is the UTC date, so a late US game on the 9th and an
//           evening game on the 10th share 2026-04-10
//   tennis  a player really can play twice in a day
// What IS a bug is the tennis subset where BOTH rows carry identical stats:
// the same match indexed under two ESPN event ids from different id ranges.
// THE DEDUPE KEY INCLUDES opponent_id, and getting that wrong was nearly a
// data-loss bug. An earlier version of this note advised deduping on identical
// stats alone. Measured before acting on it:
//
//     same stats + SAME opponent       ATP 3,832  WTA 3,364   <- duplicates
//     same stats + DIFFERENT opponent  ATP    50  WTA    65   <- REAL matches
//
// 115 genuine second-matches-of-the-day carry identical stat lines, because
// tennis stats are low-cardinality (sets won, games won, tiebreaks played).
// Deduping on stats alone would have deleted every one of them.
const dup = await c.query(`
  WITH d AS (SELECT sport, athlete_id, game_date, opponent_id, count(*)::int n,
       count(DISTINCT event_id)::int evs, count(DISTINCT stats::text)::int ds
     FROM player_game_history GROUP BY 1,2,3,4 HAVING count(*)>1)
  SELECT sport, sum(n-1) FILTER (WHERE ds=1)::int redundant,
    count(*) FILTER (WHERE evs<n)::int repeated_event,
    count(*) FILTER (WHERE ds>1)::int real_same_day_rematch
  FROM d GROUP BY 1 ORDER BY 1`);
// ASSERTED FOR TENNIS ONLY, because tennis is the only sport where this
// pattern was traced to an actual duplication: one backfill run on 2026-08-29,
// concentrated in season 2022, ESPN listing one match under two event ids.
//
// The same pattern in MLB and NBA is REAL DATA and was checked rather than
// assumed:
//   MLB 87 rows — MLB's own API returns doubleHeader=Y, gameNumber=1 and 2 for
//                 game_pks 634330/634357. A player can post the same line twice.
//   NBA 19 rows — 400828947 is Knicks at Bulls (00:00Z) and 400828957 is Bulls
//                 at Knicks (23:30Z): a home-and-home back-to-back that the UTC
//                 date collapses onto one day, against the same opponent.
// Failing on those would be demanding that correct data look wrong.
const DEDUPED = new Set(['tennis_atp', 'tennis_wta']);
for (const r of dup.rows) {
  chk(r.repeated_event === 0, `9.5 ${r.sport} no row repeated under one event_id`, `${r.repeated_event}`);
  if (DEDUPED.has(r.sport))
    chk((r.redundant ?? 0) === 0, `9.5 ${r.sport} no same-match duplicates`,
      `${(r.redundant ?? 0).toLocaleString()} redundant (same athlete, date, opponent AND stats)`);
  else if ((r.redundant ?? 0) > 0)
    note.push(`9.5 ${r.sport}: ${r.redundant.toLocaleString()} same-day/same-opponent/same-stats rows — verified REAL (doubleheaders, UTC-boundary back-to-backs), not deduped`);
  if (r.real_same_day_rematch > 0)
    note.push(`9.5 ${r.sport}: ${r.real_same_day_rematch} genuine same-day same-opponent rematches — kept`);
}

console.log('\n9.6  cross-source duplication, which a naive join double-counts');
// Not a defect — both rows are real prices from real books. But pooling
// sources without collapsing to one row per GAME over-weights exactly the
// seasons where two sources overlap, which are the most recent ones.
const xs = await c.query(`
  WITH g AS (SELECT sport, game_date, home_team_id, away_team_id, count(DISTINCT source)::int srcs
    FROM odds_archive WHERE market='moneyline' AND price IS NOT NULL AND NOT is_live AND home_team_id IS NOT NULL
    GROUP BY 1,2,3,4)
  SELECT sport, count(*)::int games, count(*) FILTER (WHERE srcs>1)::int dual
  FROM g GROUP BY 1 ORDER BY 2 DESC`);
for (const r of xs.rows)
  note.push(`9.6 ${r.sport}: ${(r.dual / r.games * 100).toFixed(1)}% of ${r.games.toLocaleString()} games priced by 2 sources`);
console.log('       (reported, not failed — the `model_game_odds` view collapses them)');

// The view is the fix, so assert it actually collapses: exactly one row per
// (game, market, side), 2 sides for a two-way sport and 3 where a draw exists.
const vw = await c.query(`
  SELECT sport, count(*)::int rows,
         count(DISTINCT (game_date, home_team_id, away_team_id))::int games,
         count(DISTINCT source)::int srcs
  FROM model_game_odds WHERE market='moneyline' GROUP BY 1 ORDER BY 1`);
for (const r of vw.rows) {
  const perGame = r.rows / r.games;
  const want = r.sport.startsWith('soccer') ? 3 : 2;
  chk(Math.abs(perGame - want) < 0.01, `9.6 model_game_odds ${r.sport} one row per side`,
    `${perGame.toFixed(2)} rows/game (expect ${want}), ${r.games.toLocaleString()} games`);
}

console.log('\n9.7  trainable set per sport');
const tr = await c.query(`
  WITH o AS (SELECT DISTINCT sport, game_date, home_team_id, away_team_id FROM odds_archive
             WHERE market='moneyline' AND price IS NOT NULL AND NOT is_live AND home_team_id IS NOT NULL),
       r AS (SELECT DISTINCT sport, game_date, home_team_id, away_team_id FROM game_result WHERE home_team_id IS NOT NULL)
  SELECT o.sport, count(*)::int games FROM o JOIN r USING (sport, game_date, home_team_id, away_team_id)
  GROUP BY 1 ORDER BY 2 DESC`);
for (const r of tr.rows)
  chk(r.games >= 3000, `9.7 ${r.sport} distinct trainable games`, `${r.games.toLocaleString()}`);

if (note.length) { console.log('\nNOTES:'); note.forEach(n => console.log(`  - ${n}`)); }
console.log(`\n${fail.length ? `GATE 9 FAILED — ${fail.length}` : 'GATE 9 PASSED'}`);
fail.forEach(f => console.log(`  ! ${f}`));
await c.end(); process.exit(fail.length ? 1 : 0);
