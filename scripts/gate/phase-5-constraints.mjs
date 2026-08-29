/**
 * Phase 5 gate — "Every CHECK constraint tested by trying to violate it. One
 * deliberate bad insert per constraint, each rejected. A constraint nobody has
 * tripped is a comment."
 *
 * Task 5.4 added 12 CHECK constraints across three tables. This tries to break
 * each one individually and asserts the database refuses.
 *
 * THE FALSE-PASS THIS GUARDS AGAINST. `docs/CURRENT.md` §3 records three
 * separate occasions where fault injection produced a green result because the
 * fault never actually landed. The same trap is wide open here: an INSERT can
 * fail for reasons that have nothing to do with the constraint under test — a
 * NOT NULL column, a bad type, a missing default. "The insert failed" is
 * therefore NOT evidence. So every case below asserts that the error names the
 * SPECIFIC constraint it was trying to trip, and each case also inserts a known
 * -good control row first, proving the row shape is otherwise valid and that
 * the only thing rejecting it is the constraint being tested.
 *
 * Everything runs inside a transaction that is always rolled back, so this
 * writes nothing permanent to any of the three live tables.
 *
 * Run from the repo root:  node scripts/gate/phase-5-constraints.mjs
 */
import pg from 'pg';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);

/** A valid game_odds_book_lines row, used as the control and as the base each
 *  violation mutates exactly one field of. */
const GOBL_OK = {
  sport: 'mlb', game_id: '__gate5__', market: 'total', side: 'over',
  bookmaker: 'fanduel', source: '__gate5__', point: 8.5,
  american_odds: -110, decimal_odds: 1.91, fetched_at: new Date().toISOString(),
};
const PROP_OK = {
  provider_id: '__gate5__', game_id: '__gate5__', subject_id: '__gate5__',
  subject_name: 'Gate Test', market_key: 'hits', line: 1.5, side: 'over',
  bookmaker: 'fanduel', american_odds: -110, decimal_odds: 1.91,
  fetched_at: new Date().toISOString(),
};
const PICK_OK = {
  sport: 'mlb', subject_id: '__gate5__', subject_name: 'Gate Test',
  dimension: 'hits', category: 'hits', market_key: 'hits', line: 1.5, game_id: '__gate5__',
  model_prob: 0.5, market_prob: 0.5, outcome: 'win', trust_tier: 'weak',
  score_grade: 'A',
};

const insert = (table, obj) => {
  const keys = Object.keys(obj);
  const cols = keys.join(', ');
  const ph = keys.map((_, i) => `$${i + 1}`).join(', ');
  return { text: `INSERT INTO ${table} (${cols}) VALUES (${ph})`, values: keys.map((k) => obj[k]) };
};

/** table, human label, the constraint that MUST reject it, the mutation. */
const CASES = [
  ['game_odds_book_lines', "market 'parlay' is not a real market", 'gobl_market_valid', { ...GOBL_OK, market: 'parlay' }],
  ['game_odds_book_lines', "side 'sideways' is not a real side", 'gobl_side_valid', { ...GOBL_OK, side: 'sideways' }],
  ['game_odds_book_lines', "sport 'quidditch' is not a real sport", 'gobl_sport_valid', { ...GOBL_OK, sport: 'quidditch' }],
  ['game_odds_book_lines', 'a moneyline carrying a point', 'gobl_point_shape', { ...GOBL_OK, market: 'moneyline', side: 'home', point: 8.5 }],
  ['game_odds_book_lines', 'a total with no point at all', 'gobl_point_shape', { ...GOBL_OK, point: null }],
  ['game_odds_book_lines', 'MLB total of 2.5 (the P3 H10 row)', 'gobl_point_plausible', { ...GOBL_OK, point: 2.5 }],
  ['game_odds_book_lines', 'MLB total of 15.5 (the high-side twin)', 'gobl_point_plausible', { ...GOBL_OK, point: 15.5 }],
  ['game_odds_book_lines', 'MLB spread of -40', 'gobl_point_plausible', { ...GOBL_OK, market: 'spread', side: 'home', point: -40 }],
  ['game_odds_book_lines', 'american odds of 0', 'gobl_american_odds_sane', { ...GOBL_OK, american_odds: 0 }],
  ['game_odds_book_lines', 'american odds of -5', 'gobl_american_odds_sane', { ...GOBL_OK, american_odds: -5 }],
  ['prop_odds', "side 'maybe' is not a real side", 'prop_odds_side_valid', { ...PROP_OK, side: 'maybe' }],
  ['prop_odds', 'american odds of 42', 'prop_odds_american_odds_sane', { ...PROP_OK, american_odds: 42 }],
  ['pick_history', "outcome 'kinda won'", 'pick_history_outcome_valid', { ...PICK_OK, outcome: 'kinda won' }],
  ['pick_history', "trust_tier 'vibes'", 'pick_history_trust_tier_valid', { ...PICK_OK, trust_tier: 'vibes' }],
  ['pick_history', "score_grade 'S++'", 'pick_history_score_grade_valid', { ...PICK_OK, score_grade: 'S++' }],
  ['pick_history', 'model_prob of 1.4', 'pick_history_model_prob_range', { ...PICK_OK, model_prob: 1.4 }],
  ['pick_history', 'market_prob of -0.2', 'pick_history_market_prob_range', { ...PICK_OK, market_prob: -0.2 }],
];

const CONTROLS = [
  ['game_odds_book_lines', GOBL_OK],
  ['prop_odds', PROP_OK],
  ['pick_history', PICK_OK],
];

const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('BEGIN');

let failures = 0;

// Step 1: the controls. If a known-good row cannot be inserted, every
// "rejected!" below would be meaningless — the row shape itself would be the
// thing failing, not the constraint under test.
console.log('CONTROLS — a valid row must be accepted by each table:');
for (const [table, row] of CONTROLS) {
  await c.query('SAVEPOINT ctl');
  try {
    const q = insert(table, row);
    await c.query(q.text, q.values);
    console.log(`  PASS  ${table}: valid row accepted`);
    await c.query('RELEASE SAVEPOINT ctl');
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${table}: valid row REJECTED (${e.message}) — every result below is untrustworthy`);
    await c.query('ROLLBACK TO SAVEPOINT ctl');
  }
}

console.log('\nVIOLATIONS — each must be rejected BY ITS OWN NAMED CONSTRAINT:');
for (const [table, label, constraint, row] of CASES) {
  await c.query('SAVEPOINT v');
  let outcome;
  try {
    const q = insert(table, row);
    await c.query(q.text, q.values);
    outcome = { ok: false, why: 'ACCEPTED — the constraint did not fire' };
    await c.query('ROLLBACK TO SAVEPOINT v');
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT v');
    // The whole point: rejected is not enough, it must be rejected by THIS one.
    if (e.constraint === constraint) outcome = { ok: true, why: `rejected by ${e.constraint}` };
    else outcome = { ok: false, why: `rejected by the WRONG thing: ${e.constraint ?? e.message}` };
  }
  if (!outcome.ok) failures++;
  console.log(`  ${outcome.ok ? 'PASS' : 'FAIL'}  ${table}: ${label} -> ${outcome.why}`);
}

await c.query('ROLLBACK');
const left = await c.query(
  `SELECT (SELECT count(*) FROM game_odds_book_lines WHERE game_id = '__gate5__') a,
          (SELECT count(*) FROM prop_odds WHERE game_id = '__gate5__') b,
          (SELECT count(*) FROM pick_history WHERE game_id = '__gate5__') d`,
);
console.log(`\nrolled back; test rows remaining: ${JSON.stringify(left.rows[0])}`);
console.log(`\n${failures === 0 ? `ALL PASS (${CASES.length} constraints tripped deliberately)` : `${failures} FAILURE(S)`}`);
await c.end();
process.exit(failures === 0 ? 0 : 1);
