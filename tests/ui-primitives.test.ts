import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { goodness, ordinal, percentileColor } from '../components/ui/Stats';

/**
 * R3 — the design-system primitives in `components/ui/`. The rules below are the
 * ones F2 measured being broken everywhere, checked on the one place that must
 * never break them, so rebuilt cards (R6–R8) inherit them by composition.
 */

const DIR = 'components/ui';
const files = readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f));
const src = (f: string) => readFileSync(`${DIR}/${f}`, 'utf8');

test('no text below 11px in a primitive (charts aside)', () => {
  // F2: half of all text rendered at 8-10.5px. The one exemption is the
  // percentile number INSIDE RankRow's 22px dot, a chart mark in all but name.
  const allowed = new Set(['Stats.tsx:text-[10px]']);
  for (const f of files) {
    for (const m of src(f).matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
      if (Number(m[1]) < 11) assert.ok(allowed.has(`${f}:${m[0]}`), `${f} uses ${m[0]}`);
    }
  }
});

test('no text lighter than ink-muted', () => {
  // ink-faint was 41% of all text at ~2.4:1 contrast — most of the 43% AA failure rate.
  // A disabled control may use ink-disabled: that is its whole meaning.
  for (const f of files) assert.doesNotMatch(src(f), /(?<!disabled:)text-ink-(faint|soft|disabled)\b/, f);
});

test('no hex color literals: colors come from the shared palette', () => {
  for (const f of files) assert.doesNotMatch(src(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /#[0-9a-fA-F]{3,8}\b/, f);
});

test('Tabs are real tabs and toggles are pressed buttons', () => {
  const controls = src('Controls.tsx');
  assert.match(controls, /role="tablist"/);
  assert.match(controls, /role="tab"/);
  assert.match(controls, /aria-selected=\{on\}/);
  assert.match(controls, /aria-pressed=\{on\}/);
});

test('the avatar never falls back to initials', () => {
  assert.doesNotMatch(src('Avatar.tsx'), /initials\(|slice\(0, 2\)\.toUpperCase/);
  assert.doesNotMatch(readFileSync('components/SubjectAvatar.tsx', 'utf8'), /function initials/);
});

test('direction is declared: a neutral stat is never judged', () => {
  assert.equal(goodness(90, 'neutral'), null);
  assert.equal(goodness(90, 'higher'), 90);
  assert.equal(goodness(90, 'lower'), 10, 'a high percentile of a lower-is-better stat is bad');
  assert.equal(percentileColor(95, 'neutral'), 'oklch(var(--ink-muted))', 'most fouls sits right, in gray');
  assert.match(percentileColor(95, 'higher'), /--good/);
  assert.match(percentileColor(95, 'lower'), /--bad/);
});

test('ordinals', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 112].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '112th']);
});
