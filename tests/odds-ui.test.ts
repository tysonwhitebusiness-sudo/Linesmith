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
