import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { cx } from '../components/ui/cx';
import { OUT_OF_SCOPE } from './ui-scope';

/**
 * U0's guard — the Tailwind 3.4 → 4 move.
 *
 * Two kinds of thing are checked here, both of which were real hazards rather
 * than hypothetical ones:
 *
 *  1. **The foundation is actually v4.** A half-migrated tree still builds: v4
 *     accepts a lot of v3 syntax, and a leftover `tailwind.config.ts` or a
 *     `@tailwind` directive would be read as a silent second source of truth.
 *  2. **The four renamed utilities are gone.** `shadow-sm`, `rounded-sm`,
 *     `outline-none` and a bare `ring` all still COMPILE under v4 — they just
 *     mean something different, so nothing fails and the page quietly changes.
 *     Those are the ones worth a test; the renames that error out find
 *     themselves.
 *
 * `cx` gets its own cases because it stopped being a plain join in U0. The one
 * that actually bites is `text-label` + `text-ink`: without the extension in
 * `cx.ts`, tailwind-merge reads both as text colours and drops the size.
 */

const SOURCE_DIRS = ['app', 'components'];

function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  for (const d of SOURCE_DIRS) walk(d);
  return out;
}

/** Strips the leading variants (`hover:`, `md:`, `data-[x]:`) off one class. */
function bare(token: string): string {
  const variant = /^(?:[a-z0-9-]+|data-\[[^\]]*\]|supports-\[[^\]]*\]|\[&[^\]]*\]):/;
  let t = token;
  for (let i = 0; i < 6 && variant.test(t); i++) t = t.replace(variant, '');
  return t;
}

test('the Tailwind config is gone: the theme lives in @theme', () => {
  assert.ok(!existsSync('tailwind.config.ts'), 'tailwind.config.ts still exists');
  assert.ok(!existsSync('tailwind.config.js'), 'tailwind.config.js still exists');
});

test('globals.css is a v4 stylesheet, with the v3 content globs kept', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  assert.doesNotMatch(css, /@tailwind\s+(base|components|utilities)/, 'v3 @tailwind directive left behind');
  assert.match(css, /@import\s+'tailwindcss'\s+source\(none\)/, 'v4 auto-detection would sweep lib/, docs/ and tests/');
  // Exactly the globs the v3 `content` array had. A third @source would start
  // generating utilities from strings that were never class names.
  assert.match(css, /@source\s+'\.\.\/app\/\*\*\/\*\.\{ts,tsx\}'/);
  assert.match(css, /@source\s+'\.\.\/components\/\*\*\/\*\.\{ts,tsx\}'/);
  assert.match(css, /@theme\s*\{/);
});

test('postcss runs the v4 plugin', () => {
  const pc = readFileSync('postcss.config.mjs', 'utf8');
  assert.match(pc, /@tailwindcss\/postcss/);
  assert.doesNotMatch(pc, /['"]tailwindcss['"]\s*:/, 'the v3 postcss plugin no longer exists');
});

test('the five named motion durations survive v4, which has no duration namespace', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  for (const d of ['instant', 'quick', 'smooth', 'data', 'live']) {
    assert.match(css, new RegExp(`@utility duration-${d}\\s*\\{`), `duration-${d} would silently generate nothing`);
  }
});

test('no utility that v4 renamed is left in the tree', () => {
  // Each of these still compiles under v4 and means something else:
  //   shadow-sm   was 0 1px 2px, is now v3's `shadow`   -> shadow-xs
  //   rounded-sm  was 2px, is now 4px                   -> rounded-xs
  //   outline-none was a transparent 2px outline,
  //                is now outline-style: none           -> outline-hidden
  //   ring (bare) was 3px blue, is now 1px currentColor -> name a width
  const renamed = new Set(['shadow-sm', 'rounded-sm', 'outline-none', 'ring']);
  const offenders: string[] = [];
  for (const f of sources()) {
    // The kit page NAMES these in prose — its whole "Tailwind 4 traps" section
    // is a row per rename, labelled with the old class. It is documentation of
    // the migration, not a survivor of it.
    if (f.startsWith('app/kit/')) continue;
    const src = readFileSync(f, 'utf8');
    // Only look inside quoted strings: `ring` and `shadow` are ordinary English
    // words and appear in comments and identifiers all over this codebase.
    for (const m of src.matchAll(/["'`]([^"'`\n]{1,400})["'`]/g)) {
      for (const token of m[1].split(/\s+/)) {
        if (renamed.has(bare(token))) offenders.push(`${f}: ${token}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'renamed v3 utilities still in the tree');
});

test('the out-of-scope list names files that exist', () => {
  // A stale path here silently stops guarding nothing, which is worse than
  // failing: later phases read this list to decide what to skip.
  for (const f of OUT_OF_SCOPE) assert.ok(existsSync(f), `${f} is on OUT_OF_SCOPE but does not exist`);
});

test('cx keeps a type-ramp size and an ink role together', () => {
  // The case the U spec calls out by name. Without `extendTailwindMerge`,
  // tailwind-merge reads `text-label` as a colour and one of the two is lost.
  assert.equal(cx('text-label', 'text-ink'), 'text-label text-ink');
  assert.equal(cx('text-body-sm', 'text-ink-muted'), 'text-body-sm text-ink-muted');
  assert.equal(cx('text-overline', 'text-good'), 'text-overline text-good');
});

test('cx resolves a real conflict in favour of the later class', () => {
  // This is the whole point of the change: a `className` passed into a
  // primitive replaces the base class it conflicts with, instead of racing it
  // in the cascade where whichever Tailwind happened to emit second won.
  assert.equal(cx('text-body', 'text-title'), 'text-title');
  assert.equal(cx('font-medium', 'font-semibold'), 'font-semibold');
  assert.equal(cx('p-4', 'p-6'), 'p-6');
  assert.equal(cx('bg-card', 'bg-card-sunk'), 'bg-card-sunk');
});

test('cx keeps the named motion tokens, which are not numbers', () => {
  assert.equal(cx('transition-colors', 'duration-quick', 'ease-standard'), 'transition-colors duration-quick ease-standard');
  assert.equal(cx('duration-quick', 'duration-smooth'), 'duration-smooth', 'two durations still conflict');
  assert.equal(cx('ease-standard', 'ease-emphasized'), 'ease-emphasized');
});

test('cx still drops falsy parts', () => {
  assert.equal(cx('a', false, null, undefined, 'b'), 'a b');
  assert.equal(cx(), '');
});
