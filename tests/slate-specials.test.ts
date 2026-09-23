import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { code } from './ui-scope';
import { SPECIAL_ONLY_RANKINGS, SPECIAL_RANKINGS, SPOTLIGHT_RANKINGS, rankingKind, rankingSport } from '../lib/slate/specials';

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
  const out: Array<{ id: string; title: string; promo: string; group: string; notHeld: string | null; kind: string }> = [];
  const re = /RankingDef\("([^"]+)",\s*\([^)]*\),\s*"([^"]+)",\s*"([^"]+)",\s*(\w+_FACTORS)([\s\S]*?)\)\s*,\s*(?=RankingDef|\))/g;
  for (const m of body.matchAll(re)) {
    const nh = /not_held="([^"]+)"/.exec(m[5]);
    const k = /kind="(\w+)"/.exec(m[5]);
    // Python's own default: a RankingDef that does not say is a Special.
    out.push({ id: m[1], title: m[2], promo: m[3], group: m[4], notHeld: nh ? nh[1] : null, kind: k ? k[1] : 'special' });
  }
  return out;
}

test('every Python ranking is mirrored, with the same title, promo and not-held note', () => {
  const py = pyRankings();
  assert.equal(py.length, 44, "the parser found every RankingDef (8 specials + 36 spotlights)");
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

/**
 * C5 — the receipts card reads the payload defensively.
 *
 * FOUND BY RENDERING, NOT BY `tsc`. `/api/slate/specials` is a `cachedRoute`
 * and `snapshot_cache` survives deploys, so for one TTL after this payload's
 * shape changed the page was handed the OLD shape: `receipts.slates` was
 * undefined, `.length` on it threw, and the whole Slate went down with a
 * client-side error. The type said the field was there; the cached bytes
 * disagreed. Any array added to a cached payload needs the same treatment.
 */
test('C5: the receipts card survives a payload cached before its shape changed', () => {
  const src = readFileSync('components/slate/SlateSpecials.tsx', 'utf8');
  assert.match(src, /const top5 = receipts\.top5 \?\? \[\]/);
  assert.match(src, /const slates = receipts\.slates \?\? \[\]/);
  // And nothing reaches into the payload's arrays directly any more.
  const body = code(src);
  assert.doesNotMatch(body, /receipts\.top5\./);
  assert.doesNotMatch(body, /receipts\.slates\./);
});

test('C5: the receipts say what they are not — separate calls, not a parlay', () => {
  const src = readFileSync('components/slate/SlateSpecials.tsx', 'utf8');
  assert.match(src, /a ranking of separate calls, not a parlay/);
  assert.match(src, /neither a hit nor a miss/);
  // The result mark is the kit's, and a did-not-play has its own kind.
  assert.match(src, /ResultMark result=\{r\.hit == null \? 'dnp'/);
});

test('C5: a graded slate counts only players who played', () => {
  const src = readFileSync('lib/slate/specials.ts', 'utf8');
  // The per-slate bars skip a did-not-play before counting either side.
  assert.match(src, /if \(o\.played === false\) continue;/);
  // And the latest graded slate counts the leader row, which for a "longest"
  // ranking can be the only row graded (measured, nfl-longest-reception 09-21).
  assert.match(src, /const latest = all\[0\]\?\.slate_date/);
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

/**
 * F0 — the drift guard now covers BOTH kinds.
 *
 * A spotlight and a Special share the table, the writer and the words, and
 * differ in exactly one thing: a Special is a book promo that gets graded the
 * next morning, a spotlight is a research flag that never is. Which one an id
 * is decides where it renders — `readSpecials` selects `kind='special'` and
 * `readFlags` selects `kind='spotlight'` — so a disagreement here means a
 * ranking silently renders nowhere, or renders as the wrong thing.
 */
test('F0: every ranking is the same KIND in both languages', () => {
  const py = pyRankings();
  assert.equal(py.filter((r) => r.kind === 'spotlight').length, 36, 'the Python file declares 36 spotlights');
  assert.equal(Object.keys(SPOTLIGHT_RANKINGS).length, 36, 'the registry mirrors 36 spotlights');
  for (const r of py) assert.equal(rankingKind(r.id), r.kind, `${r.id} kind`);
  // The two halves are disjoint and together they are the whole registry.
  assert.equal(Object.keys(SPECIAL_ONLY_RANKINGS).length + Object.keys(SPOTLIGHT_RANKINGS).length, Object.keys(SPECIAL_RANKINGS).length);
});

test('F0: a spotlight is never graded, and a Special always is', () => {
  const body = PY.slice(PY.indexOf('RANKINGS: tuple[RankingDef, ...] = ('));
  const re = /RankingDef\("([^"]+)"([\s\S]*?)\)\s*,\s*(?=RankingDef|\))/g;
  for (const m of body.matchAll(re)) {
    const graded = /grade_stat="[^"]+"/.test(m[2]);
    const spotlight = /kind="spotlight"/.test(m[2]);
    assert.equal(graded, !spotlight, `${m[1]}: grade_stat must be set for a Special and absent for a spotlight`);
  }
});

test('PY-A: every Python ranking declares a hit rule and a kind the reader understands', () => {
  const body = PY.slice(PY.indexOf('RANKINGS: tuple[RankingDef, ...] = ('));
  for (const m of body.matchAll(/hit_rule="(\w+)"/g)) assert.ok(['any', 'gte2', 'slate_max'].includes(m[1]), m[1]);
  assert.match(PY, /HIT_RULES = \("any", "gte2", "slate_max"\)/);
  assert.match(PY, /KINDS = \("special", "spotlight"\)/);
});
