import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { code } from './ui-scope';
import { SPECIAL_RANKINGS, rankingSport } from '../lib/slate/specials';

/**
 * S4's guard — the Specials' words stay the Python job's words.
 *
 * `slate_rankings.py` declares every factor beside the code that measures it,
 * with its column label and the sentence naming its source. The Slate mirrors
 * those in `SPECIAL_RANKINGS`, because a column the page labels differently
 * from what was measured is a claim nobody made. This parses the Python and
 * fails on any drift, in either direction.
 */

const PY = readFileSync('python-odds-service/src/slate_rankings.py', 'utf8');

function pyFactorGroups(): Map<string, Array<{ key: string; label: string; info: string }>> {
  const groups = new Map<string, Array<{ key: string; label: string; info: string }>>();
  const groupRe = /^(\w+_FACTORS)\s*=\s*\(([\s\S]*?)^\)/gm;
  for (const m of PY.matchAll(groupRe)) {
    const factors = [...m[2].matchAll(/Factor\("([^"]+)",\s*"([^"]+)",\s*info="([^"]+)"(?:,\s*higher_better=(?:True|False))?\)/g)].map((f) => ({ key: f[1], label: f[2], info: f[3] }));
    groups.set(m[1], factors);
  }
  return groups;
}

function pyRankings() {
  const body = PY.slice(PY.indexOf('RANKINGS: tuple[RankingDef, ...] = ('));
  const out: Array<{ id: string; title: string; promo: string; group: string; notHeld: string | null }> = [];
  const re = /RankingDef\("([^"]+)",\s*\([^)]*\),\s*"([^"]+)",\s*"([^"]+)",\s*(\w+_FACTORS)([\s\S]*?)\)\s*,\s*(?=RankingDef|\))/g;
  for (const m of body.matchAll(re)) {
    const nh = /not_held="([^"]+)"/.exec(m[5]);
    out.push({ id: m[1], title: m[2], promo: m[3], group: m[4], notHeld: nh ? nh[1] : null });
  }
  return out;
}

test('every Python ranking is mirrored, with the same title, promo and not-held note', () => {
  const py = pyRankings();
  assert.equal(py.length, 8, 'the parser found every RankingDef');
  assert.deepEqual(py.map((r) => r.id).sort(), Object.keys(SPECIAL_RANKINGS).sort());
  for (const r of py) {
    const ts = SPECIAL_RANKINGS[r.id];
    assert.equal(ts.title, r.title, `${r.id} title`);
    assert.equal(ts.promo, r.promo, `${r.id} promo`);
    assert.equal(ts.notHeld ?? null, r.notHeld, `${r.id} not-held note`);
  }
});

test("every factor's key, label and source sentence match the Python declaration", () => {
  const groups = pyFactorGroups();
  for (const r of pyRankings()) {
    const factors = groups.get(r.group);
    assert.ok(factors && factors.length > 0, `${r.group} parsed`);
    assert.deepEqual(SPECIAL_RANKINGS[r.id].factors, factors, `${r.id} factors`);
  }
});

test('soccer rankings are keyed by league, every other sport generically', () => {
  assert.equal(rankingSport('soccer', 'mls'), 'soccer_mls');
  assert.equal(rankingSport('soccer', null), 'soccer_epl');
  assert.equal(rankingSport('nfl', null), 'nfl');
});

test('the card says what the score is not, and names the weights', () => {
  const src = readFileSync('components/slate/SlateSpecials.tsx', 'utf8');
  assert.match(src, /not a probability/);
  assert.match(src, /Weights are equal until a pre-registered backtest/);
  // No price, no edge, no model tier on this surface.
  const body = code(src);
  for (const word of [/\bedge\b/i, /\bbaseline\b/i, /\bgated\b/i, /impliedProb|americanOdds/]) assert.doesNotMatch(body, word);
});

test('a did-not-play is shown as neither a hit nor a miss', () => {
  const src = readFileSync('lib/slate/specials.ts', 'utf8');
  assert.match(src, /o\.played === false \? null/);
  assert.match(src, /filter\(\(o\) => o\.played !== false\)/);
});

test('PY-A: the leader row is never a subject, and `_` factor keys are never values', () => {
  const src = readFileSync('lib/slate/specials.ts', 'utf8');
  assert.match(src, /subject_id <> '\$\{LEADER_ID\}'/);
  assert.match(src, /String\(x\.subject_id\) !== LEADER_ID/);
  assert.match(src, /if \(!k\.startsWith\('_'\)\) values\[k\] = num\(v\)/);
  // The writer stores the leader as rank 0, so `rank <= 5` alone would not exclude it.
  assert.match(readFileSync('python-odds-service/src/db.py', 'utf8'), /'__leader__', 0,/);
});

test('PY-A: every Python ranking declares a hit rule and a kind the reader understands', () => {
  const body = PY.slice(PY.indexOf('RANKINGS: tuple[RankingDef, ...] = ('));
  for (const m of body.matchAll(/hit_rule="(\w+)"/g)) assert.ok(['any', 'gte2', 'slate_max'].includes(m[1]), m[1]);
  assert.match(PY, /HIT_RULES = \("any", "gte2", "slate_max"\)/);
  assert.match(PY, /KINDS = \("special", "spotlight"\)/);
});
