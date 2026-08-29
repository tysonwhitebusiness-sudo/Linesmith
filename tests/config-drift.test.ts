/**
 * Task 5.11 (P2 M3) — the TypeScript and Python provider configuration must
 * agree, and an env var nobody reads must be visible.
 *
 * P2 M3: "Provider configuration exists in three places that must agree by
 * hand — this caused two real defects (a silently-ignored spend cap and the C1
 * market map)." Phase 5 found two MORE instances of exactly this:
 *
 *   - PROPLINE_2_DAILY_LIMIT was set in .env.local and .env.example and never
 *     read by config.py, so propline_2 ran with no cap AND no spend recording
 *     (task 5.2).
 *   - Five PARLAYAPI_*_SOFT_CAP vars were set, documented, and never read, so
 *     the soft caps did nothing at all (task 5.9).
 *
 * Both are the same failure mode: configuration that exists and is ignored
 * looks identical to configuration that works. This test makes that state
 * fail loudly.
 *
 * Deliberately TEXTUAL on both sides. Importing the Python map is impossible
 * from node, and exporting the TS map purely for a test would change
 * production code to suit its test. Parsing both files means the test reads
 * what a human reads.
 *
 * Hermetic — file reads only, no database, no network. Runs in CI per Q20.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const read = (p: string) => fs.readFileSync(p, 'utf8');

const TS_ENTITY = read('lib/odds/props/entityResolution.ts');
const PY_ENTITY = read('python-odds-service/src/entity_resolution.py');
const PY_CONFIG = read('python-odds-service/src/config.py');
const ENV_EXAMPLE = read('.env.example');
const TS_PROVIDER_CONFIG = read('lib/odds/props/config.ts');
// A few vars are read directly by the Next app rather than through either
// provider-config module; grep the whole lib/ tree once so this test does not
// need its own list of which.
const NEXT_ENV_USAGE = fs
  .readdirSync('lib/odds', { recursive: true, encoding: 'utf8' })
  .filter((f) => typeof f === 'string' && f.endsWith('.ts'))
  .map((f) => read(`lib/odds/${f}`))
  .join('\n');

/** Pull `key: 'value'` / `'key': 'value'` pairs out of one TS object literal. */
function tsMap(source: string, declaration: string): Map<string, string> {
  const start = source.indexOf(declaration);
  assert.ok(start !== -1, `could not find ${declaration}`);
  const body = source.slice(start, source.indexOf('\n};', start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/^\s*'?([A-Za-z0-9_+\-. ]+)'?\s*:\s*'([^']+)'/gm)) {
    out.set(m[1], m[2]);
  }
  return out;
}

/** Pull `"key": "value"` pairs out of one Python dict literal. */
function pyMap(source: string, declaration: string): Map<string, string> {
  const start = source.indexOf(declaration);
  assert.ok(start !== -1, `could not find ${declaration}`);
  const body = source.slice(start, source.indexOf('\n}', start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/^\s*"([^"]+)"\s*:\s*"([^"]+)"/gm)) {
    out.set(m[1], m[2]);
  }
  return out;
}

test('market key aliases: every key TS knows, Python maps the same way', () => {
  const ts = tsMap(TS_ENTITY, 'const MARKET_KEY_ALIASES');
  const py = pyMap(PY_ENTITY, 'MARKET_KEY_ALIASES: dict[str, str] = {');
  assert.ok(ts.size > 50, `TS map looks unparsed (${ts.size} entries)`);
  assert.ok(py.size > 50, `Python map looks unparsed (${py.size} entries)`);

  const disagreements: string[] = [];
  for (const [key, tsValue] of ts) {
    const pyValue = py.get(key);
    if (pyValue !== undefined && pyValue !== tsValue) {
      disagreements.push(`${key}: TS=${tsValue} Python=${pyValue}`);
    }
  }
  assert.deepEqual(disagreements, [], 'the two alias maps disagree on a shared key');
});

test('the Propline MLB vocabulary (task 5.1) is present in BOTH languages', () => {
  // These are the keys the live 2026-08-29 capture proved Propline sends, and
  // whose absence was the real cause of P2 C1. If one language gains them and
  // the other does not, the feed silently half-works again.
  const required = [
    'batter_hits', 'batter_rbis', 'batter_runs', 'batter_singles',
    'batter_doubles', 'batter_triples', 'batter_walks', 'batter_home_runs',
    'batter_total_bases', 'batter_strikeouts', 'batter_stolen_bases',
    'batter_hits_runs_rbis', 'pitcher_outs', 'pitcher_earned_runs',
    'pitcher_hits_allowed', 'pitcher_walks_allowed',
  ];
  const ts = tsMap(TS_ENTITY, 'const MARKET_KEY_ALIASES');
  const py = pyMap(PY_ENTITY, 'MARKET_KEY_ALIASES: dict[str, str] = {');
  const missingTs = required.filter((k) => !ts.has(k));
  const missingPy = required.filter((k) => !py.has(k));
  assert.deepEqual(missingTs, [], 'missing from the TypeScript alias map');
  assert.deepEqual(missingPy, [], 'missing from the Python alias map');
  for (const k of required) {
    assert.equal(ts.get(k), py.get(k), `${k} maps to different canonical keys`);
  }
});

test('bookmaker aliases agree across languages', () => {
  const ts = tsMap(TS_ENTITY, 'const BOOKMAKER_ALIASES');
  const py = pyMap(PY_ENTITY, 'BOOKMAKER_ALIASES: dict[str, str] = {');
  const disagreements: string[] = [];
  for (const [key, tsValue] of ts) {
    const pyValue = py.get(key);
    if (pyValue !== undefined && pyValue !== tsValue) {
      disagreements.push(`${key}: TS=${tsValue} Python=${pyValue}`);
    }
  }
  assert.deepEqual(disagreements, [], 'the two bookmaker maps disagree');
  // Task 5.3's additions specifically — a canonicalisation that exists in one
  // language collapses spellings there and not in the other.
  for (const k of ['lowvig', 'mybookie', 'betus', 'matchbook', 'smarkets', 'rebet', 'onexbet', 'tabau']) {
    assert.ok(ts.has(k), `TS bookmaker map is missing ${k}`);
    assert.ok(py.has(k), `Python bookmaker map is missing ${k}`);
  }
});

test('no orphan provider env vars: everything in .env.example is read somewhere', () => {
  // The exact failure that produced tasks 5.2 and 5.9. An env var that is
  // documented but unread is worse than an absent one, because it reads as
  // configured.
  //
  // Scans BOTH config files rather than keeping a hand-written "TS only"
  // allowlist. A first draft of this test did keep such a list, and it
  // immediately reported four false orphans (SHARPAPI_RATE_PER_MIN,
  // SHARPAPI_DELAY_SECONDS, SPORTSGAMEODDS_MONTHLY_LIMIT,
  // PARLAYAPI_MLB_MONTHLY_LIMIT) that lib/odds/props/config.ts reads perfectly
  // well — an allowlist that must be updated by hand is the same class of
  // drift this test exists to catch.
  const declared = [...ENV_EXAMPLE.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
  assert.ok(declared.length > 20, `.env.example looks unparsed (${declared.length} vars)`);

  const readers = PY_CONFIG + TS_PROVIDER_CONFIG + NEXT_ENV_USAGE;
  const orphans = declared.filter((v) => !readers.includes(v));
  assert.deepEqual(
    orphans,
    [],
    `these env vars are documented in .env.example but read by no config file — ` +
      `exactly how PROPLINE_2_DAILY_LIMIT and the PARLAYAPI_*_SOFT_CAP family silently did nothing`,
  );
});
