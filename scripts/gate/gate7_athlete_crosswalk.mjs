// GATE 7 -- the athlete crosswalk (task 6.28), against the LIVE table.
//
// The Phase 6 gate says: "Every entity crosswalk verified by joining on a real
// date, never by counting id overlaps. 30 of 39 NHL ids 'matched' and every
// match was wrong."
//
// So this gate does not count rows and call it coverage. 7.5 re-runs the
// discrimination test in SQL every time it is run: it scores the real mapping
// AND a deliberately shuffled one through the identical join, and fails if the
// gap between them is not large. A crosswalk that has quietly rotted -- a
// re-import that shifted ids, an upstream renumbering -- shows up there as the
// two scores converging, which no row count would ever reveal.
import pg from 'pg'; import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const url = env.split('\n').find(l => l.startsWith('DATABASE_URL='))?.slice(13).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url }); await c.connect();
await c.query(`SET statement_timeout='600s'`);
const fail = [], note = [];
const chk = (cond, l, v) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${l.padEnd(52)} ${v}`); if (!cond) fail.push(`${l} -> ${v}`); };
console.log('\nGATE 7 -- athlete_crosswalk\n');

console.log('7.1  the two broken sports now reach a player');
// Before this table both were 0.0%. The floor is deliberately below the
// measured 96.2/91.9 -- a prop posted for a player who never appears again is
// a real thing, and demanding 100% would make the gate a liar.
const cov = await c.query(`
  SELECT p.sport, count(*)::int rows,
         count(*) FILTER (WHERE h.ok IS NOT NULL)::int reach
  FROM prop_odds_archive p
  LEFT JOIN athlete_crosswalk x ON x.sport = p.sport AND x.espn_athlete_id = p.athlete_id
  LEFT JOIN LATERAL (SELECT 1 ok FROM player_game_history h
                     WHERE h.sport = p.sport AND h.athlete_id = x.athlete_id LIMIT 1) h ON true
  GROUP BY 1 ORDER BY 1`);
const FLOOR = { mlb: 0.90, nhl: 0.85, nba: 0.90, nfl: 0.90, cfb: 0.90, soccer_epl: 0.80 };
for (const r of cov.rows) {
  const pct = r.reach / r.rows;
  if (!FLOOR[r.sport]) { note.push(`7.1 ${r.sport}: ${(pct * 100).toFixed(1)}% (${r.reach.toLocaleString()}/${r.rows.toLocaleString()}) — no floor set`); continue; }
  chk(pct >= FLOOR[r.sport], `7.1 ${r.sport} prop rows reaching a player`,
    `${(pct * 100).toFixed(1)}% (${r.reach.toLocaleString()}/${r.rows.toLocaleString()}), floor ${(FLOOR[r.sport] * 100).toFixed(0)}%`);
}

console.log('\n7.2  the mapping is a function in BOTH directions');
// Two ESPN athletes collapsing onto one of ours is the Montreal-filed-as-
// Toronto failure in athlete form. The unique indexes enforce it; this asserts
// they are still there and still doing it.
for (const [label, cols] of [['espn -> ours', 'sport, espn_athlete_id'], ['ours -> espn', 'sport, athlete_id']]) {
  const r = await c.query(`SELECT count(*)::int n FROM (
    SELECT ${cols} FROM athlete_crosswalk GROUP BY 1,2 HAVING count(*)>1) t`);
  chk(r.rows[0].n === 0, `7.2 ${label} is one-to-one`, `${r.rows[0].n} collision(s)`);
}

console.log('\n7.3  every non-identity row was proven against a real game');
const meth = await c.query(`SELECT sport, match_method, count(*)::int n,
  count(verified_game_date)::int v FROM athlete_crosswalk GROUP BY 1,2 ORDER BY 1,2`);
for (const r of meth.rows) {
  if (r.match_method === 'identity') { note.push(`7.3 ${r.sport} identity: ${r.n} rows, no match to prove`); continue; }
  // name_and_dob survives an unverified row (two publishers agreeing on a
  // birth date is independent evidence); name_unique must not.
  const floor = r.match_method === 'name_unique' ? 1.0 : 0.90;
  chk(r.v / r.n >= floor, `7.3 ${r.sport} ${r.match_method} verified`,
    `${r.v}/${r.n} (${(r.v / r.n * 100).toFixed(1)}%), floor ${(floor * 100).toFixed(0)}%`);
}

console.log('\n7.4  a verified date is a date the athlete could actually have played');
// WHERE THE EVIDENCE LIVES DIFFERS BY SPORT, and the first version of this
// check did not know that. It looked only in prop_odds_archive — right for MLB
// and NHL, whose crosswalks were built from prop rows, and wrong for tennis,
// which has no prop rows at all and was verified against MATCH odds in
// odds_archive. It reported 1,186 orphans on 1,186 correct rows.
//
// Either source now satisfies it: a prop row for that ESPN athlete id, or an
// odds_archive row naming the athlete as one of the two sides. Tennis is keyed
// by NAME there because tennis-data publishes no player id, which is the whole
// reason athlete_name carries the source's own spelling.
const span = await c.query(`
  SELECT x.sport, count(*)::int n,
         count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM prop_odds_archive p
           WHERE p.sport = x.sport AND p.athlete_id = x.espn_athlete_id
             AND p.game_date BETWEEN x.verified_game_date - 1 AND x.verified_game_date + 1)
           AND NOT EXISTS (
           SELECT 1 FROM odds_archive o
           WHERE o.sport = x.sport AND x.athlete_name IS NOT NULL
             AND (o.home_team_raw = x.athlete_name OR o.away_team_raw = x.athlete_name)
             AND o.game_date BETWEEN x.verified_game_date - 1 AND x.verified_game_date + 1))::int orphan
  FROM athlete_crosswalk x WHERE x.verified_game_date IS NOT NULL GROUP BY 1 ORDER BY 1`);
for (const r of span.rows)
  chk(r.orphan === 0, `7.4 ${r.sport} verified date sits on a real game`, `${r.orphan} orphan(s) of ${r.n}`);

console.log('\n7.5  THE DISCRIMINATION TEST -- true mapping vs a shuffled one');
// This is the gate. Scoring the real crosswalk alone proves nothing; the
// number only means something next to what a WRONG crosswalk scores through
// the same join. MLB only: NHL's control lives in the builder, because
// player_game_history holds no NHL row inside the prop window at all and the
// comparison has to go out to the NHL API.
const disc = await c.query(`
  WITH ev AS (SELECT DISTINCT event_ref, game_date, home_team_id, away_team_id
              FROM odds_archive WHERE sport='mlb' AND event_ref IS NOT NULL),
  pr AS (SELECT DISTINCT p.athlete_id espn_id, e.game_date, e.home_team_id, e.away_team_id
         FROM prop_odds_archive p JOIN ev e ON e.event_ref = p.event_ref
         WHERE p.sport='mlb' AND p.athlete_id IS NOT NULL),
  x AS (SELECT espn_athlete_id espn_id, athlete_id,
               row_number() OVER (ORDER BY espn_athlete_id) rn,
               count(*) OVER () tot
        FROM athlete_crosswalk WHERE sport='mlb'),
  -- the control: every athlete deliberately mis-mapped onto another real one
  shuf AS (SELECT a.espn_id, b.athlete_id FROM x a
           JOIN x b ON b.rn = ((a.rn + 6) % a.tot) + 1),
  scored AS (
    SELECT pr.espn_id,
      count(*) chances,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM player_game_history h
        WHERE h.sport='mlb' AND h.athlete_id = x.athlete_id AND h.game_date = pr.game_date
          AND h.team_id IN (pr.home_team_id, pr.away_team_id))) true_hits,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM player_game_history h
        WHERE h.sport='mlb' AND h.athlete_id = s.athlete_id AND h.game_date = pr.game_date
          AND h.team_id IN (pr.home_team_id, pr.away_team_id))) shuf_hits
    FROM pr JOIN x ON x.espn_id = pr.espn_id JOIN shuf s ON s.espn_id = pr.espn_id
    GROUP BY 1)
  SELECT count(*)::int pairs, (sum(true_hits)::float/sum(chances)) t, (sum(shuf_hits)::float/sum(chances)) s
  FROM scored`);
const { pairs, t, s } = disc.rows[0];
console.log(`       true ${(t * 100).toFixed(1)}%   shuffled ${(s * 100).toFixed(1)}%   over ${pairs} athletes`);
chk(t >= 0.60, '7.5 mlb true mapping agrees with real games', `${(t * 100).toFixed(1)}%`);
chk(s <= 0.15, '7.5 mlb shuffled control is rejected', `${(s * 100).toFixed(1)}%`);
chk(t / Math.max(s, 0.001) >= 5, '7.5 mlb discrimination ratio', `${(t / Math.max(s, 0.001)).toFixed(1)}x, need 5x`);

console.log('\n7.6  tennis coverage, measured where tennis data actually is');
// tennis-data publishes no player id, so the crosswalk is keyed by the source's
// own spelling and the unit to measure is PLAYER SLOTS in odds_archive, not
// names. 1,186 mapped names cover ~86% of slots because tour regulars appear
// hundreds of times and one-off qualifiers appear once; counting names would
// report ~66% and describe nothing anyone cares about.
const tcov = await c.query(`
  WITH sides AS (
    SELECT sport, home_team_raw nm FROM odds_archive WHERE source='tennis_data'
    UNION ALL SELECT sport, away_team_raw FROM odds_archive WHERE source='tennis_data')
  SELECT s.sport, count(*)::int slots, count(x.athlete_id)::int mapped
  FROM sides s LEFT JOIN athlete_crosswalk x ON x.sport = s.sport AND x.athlete_name = s.nm
  GROUP BY 1 ORDER BY 1`);
for (const r of tcov.rows)
  chk(r.mapped / r.slots >= 0.75, `7.6 ${r.sport} player slots reaching an athlete`,
    `${(r.mapped / r.slots * 100).toFixed(1)}% (${r.mapped.toLocaleString()}/${r.slots.toLocaleString()})`);

console.log('\n7.7  NHL props join to player history at -1 DAY, not 0');
// ESPN stamps a UTC date and the NHL API reports the LOCAL one, so an evening
// puck drop is the next day in ESPN's column. This cost real accuracy twice:
// once when the crosswalk was built, and again when its trainable set was
// first measured at offset 0 and came out 6,692 instead of 10,020 — a 50%
// understatement of NHL's grader data, from a join that looked perfectly
// reasonable. Asserted so the offset is discovered by a failing gate rather
// than by someone wondering why NHL has so little data.
const off = await c.query(`
  WITH ev AS (SELECT DISTINCT event_ref, game_date, home_team_id, away_team_id
              FROM odds_archive WHERE sport='nhl' AND event_ref IS NOT NULL),
  pr AS (SELECT DISTINCT p.athlete_id espn_id, e.game_date, e.home_team_id, e.away_team_id
         FROM prop_odds_archive p JOIN ev e ON e.event_ref = p.event_ref
         WHERE p.sport='nhl' AND p.athlete_id IS NOT NULL),
  x AS (SELECT espn_athlete_id, athlete_id FROM athlete_crosswalk WHERE sport='nhl')
  SELECT o.off, count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM player_game_history h WHERE h.sport='nhl'
        AND h.athlete_id = x.athlete_id AND h.game_date = pr.game_date + o.off
        AND h.team_id IN (pr.home_team_id, pr.away_team_id)))::int hits
  FROM pr JOIN x ON x.espn_athlete_id = pr.espn_id
  CROSS JOIN (VALUES (-2),(-1),(0),(1),(2)) o(off) GROUP BY 1 ORDER BY 2 DESC LIMIT 1`);
if (!off.rows.length) note.push('7.7 no NHL prop/history overlap yet');
else chk(off.rows[0].off === -1, '7.7 NHL best prop->history day offset is -1',
  `${off.rows[0].off} (${off.rows[0].hits.toLocaleString()} hits)`);

if (note.length) { console.log('\nNOTES:'); note.forEach(n => console.log(`  - ${n}`)); }
console.log(`\n${fail.length ? `GATE 7 FAILED — ${fail.length}` : 'GATE 7 PASSED'}`);
await c.end();
process.exit(fail.length ? 1 : 0);
