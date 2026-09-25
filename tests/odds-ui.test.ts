/**
 * P8 O1 guards for the odds section's components (`components/odds/`),
 * `docs/design/odds-build/P8-odds-sections.md` §O1:
 *   - Chip only where its filter buttons are controls (GamePropsCard, LineMovement);
 *   - no raw hex (tokens only);
 *   - no `sport ===` (the section is sport-agnostic: data decides, never a sport check);
 *   - every horizontal scroller clips vertically (Revision 2's scroll rule);
 *   - every components/odds/*.tsx is rendered on /kit.
 */
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const DIR = join(process.cwd(), 'components', 'odds');
const files = readdirSync(DIR).filter(f => /\.tsx?$/.test(f));
const src = (f: string) => readFileSync(join(DIR, f), 'utf8');
const CHIP_OK = new Set(['GamePropsCard.tsx', 'LineMovement.tsx']);

test('Chip only in the files whose filter buttons are controls', () => {
  const bad = files.filter(f => !CHIP_OK.has(f) && /\bChip\b/.test(src(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  assert.deepEqual(bad, []);
});

test('no raw hex colour in components/odds', () => {
  const bad = files.filter(f => /#[0-9a-fA-F]{3,8}\b/.test(src(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  assert.deepEqual(bad, []);
});

test('no sport check in components/odds', () => {
  const bad = files.filter(f => /sport\s*===|===\s*['"](mlb|nfl|cfb|nba|nhl|soccer|tennis|golf)['"]/.test(src(f)));
  assert.deepEqual(bad, []);
});

test('every horizontal scroller also clips vertically', () => {
  const bad = files.filter(f => /overflow-x-auto(?![^"'`]*overflow-y-hidden)/.test(src(f)));
  assert.deepEqual(bad, []);
});

test('every components/odds/*.tsx is rendered on /kit', () => {
  const kit = readFileSync(join(process.cwd(), 'app', 'kit', 'KitOdds.tsx'), 'utf8');
  const missing = files.filter(f => f.endsWith('.tsx')).map(f => f.replace(/\.tsx$/, ''))
    .filter(name => !new RegExp(`<${name}\\b`).test(kit));
  assert.deepEqual(missing, []);
});

// ---------------------------------------------------------------------------
// P9 (the live layer): every animation class is switched off under reduced
// motion, and none is used outside components/odds and components/ui (the
// chart primitive takes its classes as props from the odds section).
// ---------------------------------------------------------------------------
const CSS = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
const liveBlock = CSS.slice(CSS.indexOf('Odds build P9'));
const animated = [...liveBlock.matchAll(/^\.(lb-[a-z-]+)\s*\{([^}]*)\}/gm)].filter(m => /animation\s*:/.test(m[2])).map(m => m[1]);

test('P9: the live layer defines its animation classes', () => {
  for (const c of ['lb-roll', 'lb-flash-up', 'lb-flash-down', 'lb-live-ping', 'lb-live-pulse', 'lb-row-pulled', 'lb-row-returned', 'lb-row-new', 'lb-point-pop', 'lb-point-pulse']) {
    assert.ok(animated.includes(c), `${c} is not defined with an animation`);
  }
});

test('P9: the reduced-motion media query covers every animation class', () => {
  const rm = liveBlock.slice(liveBlock.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(rm.length > 0, 'no reduced-motion block');
  const none = rm.slice(0, rm.indexOf('animation: none'));
  const missing = animated.filter(c => !new RegExp(`\\.${c}\\b`).test(none));
  assert.deepEqual(missing, []);
});

test('P9: no animation class is used outside components/odds and components/ui', () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? (e.name === 'node_modules' || e.name.startsWith('.') ? [] : walk(join(dir, e.name))) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);
  const files = ['components', 'app', 'lib'].flatMap(d => walk(join(process.cwd(), d)));
  const bad: string[] = [];
  for (const f of files) {
    const rel = f.slice(process.cwd().length + 1).split(String.fromCharCode(92)).join('/');
    if (rel.startsWith('components/odds/') || rel.startsWith('components/ui/')) continue;
    const s = readFileSync(f, 'utf8');
    for (const c of animated) if (new RegExp(`['"\` ]${c}['"\` ]`).test(s)) bad.push(`${rel}: ${c}`);
  }
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------------------
// P10 ("Where the money is"): every row names whose customers or which
// exchange it describes. No rendered string may speak for all bettors, name
// "sharp money", or present a number as the total wagered.
// ---------------------------------------------------------------------------
test('P10: no "public", "sharp money" or "handle" in the money card or its rows', () => {
  const files = [join(process.cwd(), 'components', 'odds', 'MoneyCard.tsx'), join(process.cwd(), 'lib', 'odds', 'section', 'money.ts')];
  const bad: string[] = [];
  for (const f of files) {
    const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const w of ['public', 'sharp money', 'handle']) if (code.toLowerCase().includes(w)) bad.push(`${f.split(/[\/]/).pop()}: ${w}`);
  }
  assert.deepEqual(bad, []);
});
