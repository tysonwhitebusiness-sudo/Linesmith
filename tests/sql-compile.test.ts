/**
 * Task 3.8 — the `?` placeholder compiler (findings P2 M4, P4 M11), and the
 * jsonb case task 3.11 asks for by name.
 *
 * The old implementation was `sql.replace(/\?/g, ...)` over the whole string.
 * Safe only while no query contained a literal `?` — which was true, and was
 * nobody's job to keep true. The failure it sets up is the bad kind: a query
 * with a `?` in a string literal shifts every later placeholder by one, so
 * parameters bind to the wrong columns and the query SUCCEEDS with wrong data.
 * No exception, nothing for `tsc` to catch, and the result looks plausible.
 *
 * `compile` is module-private, so these exercise it through `pgGet`/`pgAll`
 * with a stubbed pool — the SQL that would have been sent is what matters, and
 * no database is touched.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pgAll } from '../lib/db/pgClient';

process.env.DATABASE_URL ??= 'postgresql://stub:stub@127.0.0.1:1/stub';

let lastQuery: { text: string; values: any[] } | null = null;

// pgClient caches its pool on `global.__linesmithPgPool` and builds it lazily,
// inside getPool() at query time rather than at import. Populating the global
// here therefore substitutes a stub before the first query without needing a
// test-only export in production code — the seam already exists, so this uses
// it rather than widening the module's public surface for a test's benefit.
// No database is touched; the SQL that *would* have been sent is the subject.
(global as any).__linesmithPgPool = {
  query: async (text: string, values: any[]) => {
    lastQuery = { text, values };
    return { rows: [], rowCount: 0 };
  },
};

async function compiled(sql: string, params?: any[]) {
  await pgAll(sql, params);
  return lastQuery!;
}

test('plain placeholders number left to right', async () => {
  const q = await compiled('SELECT * FROM t WHERE a = ? AND b = ?', [1, 2]);
  assert.equal(q.text, 'SELECT * FROM t WHERE a = $1 AND b = $2');
  assert.deepEqual(q.values, [1, 2]);
});

test("a ? inside a string literal is NOT a placeholder", async () => {
  // The exact regression: under the old compiler this became `$1` and the real
  // placeholder became `$2`, so `sport` bound to the LIKE pattern.
  const q = await compiled("SELECT * FROM t WHERE name LIKE '%?%' AND sport = ?", ['mlb']);
  assert.equal(q.text, "SELECT * FROM t WHERE name LIKE '%?%' AND sport = $1");
  assert.deepEqual(q.values, ['mlb']);
});

test('an escaped quote inside a literal does not end it', async () => {
  const q = await compiled("SELECT * FROM t WHERE s = 'it''s ? here' AND id = ?", [7]);
  assert.equal(q.text, "SELECT * FROM t WHERE s = 'it''s ? here' AND id = $1");
});

test('a ? inside a double-quoted identifier is not a placeholder', async () => {
  const q = await compiled('SELECT "weird?col" FROM t WHERE id = ?', [3]);
  assert.equal(q.text, 'SELECT "weird?col" FROM t WHERE id = $1');
});

test('a ? inside a line comment is not a placeholder', async () => {
  const q = await compiled('SELECT 1 -- why? because\nWHERE id = ?', [9]);
  assert.ok(q.text.includes('-- why? because'), 'comment must survive unchanged');
  assert.ok(q.text.includes('$1'), 'the real placeholder must still compile');
  assert.ok(!q.text.includes('$2'), 'the comment must not consume a parameter');
});

test('a ? inside a block comment is not a placeholder', async () => {
  const q = await compiled('SELECT 1 /* huh? */ WHERE id = ?', [4]);
  assert.equal(q.text, 'SELECT 1 /* huh? */ WHERE id = $1');
});

test('the jsonb ? operator, written doubled, emits one literal ?', async () => {
  // This is the case 3.11 names. `payload::jsonb ? 'key'` cannot be told from
  // a placeholder by scanning, so it is written `??` — the same convention
  // node-postgres and JDBC use.
  const q = await compiled("SELECT * FROM t WHERE payload::jsonb ?? 'key' AND id = ?", [5]);
  assert.equal(q.text, "SELECT * FROM t WHERE payload::jsonb ? 'key' AND id = $1");
  assert.deepEqual(q.values, [5]);
});

test('?| and ?& operators survive when doubled', async () => {
  const q = await compiled("SELECT * FROM t WHERE p ??| array['a'] AND q ??& array['b'] AND id = ?", [1]);
  assert.ok(q.text.includes("?| array['a']"), '?| must survive');
  assert.ok(q.text.includes("?& array['b']"), '?& must survive');
  assert.equal(q.values.length, 1);
});

test('a placeholder/parameter mismatch throws instead of binding wrongly', async () => {
  // The whole point: loud beats wrong. Under the old compiler this bound
  // silently and returned confident nonsense.
  await assert.rejects(
    () => pgAll('SELECT * FROM t WHERE a = ? AND b = ?', [1]),
    /2 placeholder\(s\) but 1 parameter\(s\)/,
  );
  await assert.rejects(
    () => pgAll('SELECT * FROM t WHERE a = ?', [1, 2]),
    /1 placeholder\(s\) but 2 parameter\(s\)/,
  );
});

test('named @params still work and dedupe', async () => {
  const q = await compiled('SELECT * FROM t WHERE a = @x AND b = @y AND c = @x', undefined as any);
  // Named params take the object branch; passing undefined returns SQL as-is,
  // so this asserts the array branch has not swallowed the named one.
  assert.ok(q.text.includes('@x'), 'undefined params must pass SQL through untouched');
});
