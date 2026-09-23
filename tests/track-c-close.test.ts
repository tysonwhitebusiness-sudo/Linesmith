import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { code, outOfScope } from './ui-scope';

/**
 * C8 — the guards that close Track C.
 *
 * Each one pins a rule the track established that nothing else checks. The
 * band-contrast rule is `team-colors.test.ts`, the six role keys are
 * `player-roles.test.ts`, and Specials parity with Python is
 * `slate-specials.test.ts`; those are not repeated here.
 */

/**
 * Scan's own cell components. Frozen for the same reason as the table they
 * draw — `ui-sweep` names them as its one exception, and `globals.css` gives
 * them the ink shade through an UNLAYERED `.text-good{}` rule, because
 * `@utility text-good` does not override Tailwind's theme-generated class.
 */
const SCAN_CELLS = ['components/StatCells.tsx', 'components/OddsChip.tsx'];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) out.push(...tsxFiles(p));
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

test('C0: a fill colour is never used as text outside the frozen files', () => {
  /**
   * Electric Turf's `good`/`bad`/`warn` are FILLS. Text takes the `-ink`
   * shade, which is the same hue darkened until it carries on a light card —
   * `text-good` on white is the failure this bans.
   */
  const offenders: string[] = [];
  for (const file of tsxFiles('components')) {
    if (outOfScope(file) || SCAN_CELLS.includes(file)) continue;
    const body = code(readFileSync(file, 'utf8'));
    for (const m of body.matchAll(/text-(good|bad|warn)(?![\w-])/g)) offenders.push(`${file}: ${m[0]}`);
  }
  assert.deepEqual(offenders, [], 'these should use the -ink shade');
});

test('C1: a Slate section header is always the shared one', () => {
  /**
   * C1b made the header a transparent bar with a 3px charcoal line, and the
   * only way that stays true everywhere is for every section to draw it
   * through `SectionBand`. A hand-rolled `<h2>` is how the old charcoal band
   * would creep back into one section and not the rest.
   *
   * Counting sections against bands was the first version of this and it was
   * wrong: two Slate sections (golf's winner prices, the props board) do not
   * use a `slate-` id, so the counts legitimately differ.
   */
  const headings: string[] = [];
  for (const file of tsxFiles('components/slate')) {
    const body = code(readFileSync(file, 'utf8'));
    for (const m of body.matchAll(/<h[1-3][\s>]/g)) headings.push(`${file}: ${m[0].trim()}`);
  }
  assert.deepEqual(headings, [], 'these should render a SectionBand');
  // And every file that draws a Slate section draws one.
  const band = readFileSync('components/ui/Section.tsx', 'utf8');
  assert.match(band, /SectionBand/);
});

test('C8: the mockup is marked historical, not current', () => {
  // It was the visual target for Track C and is not what the app looks like
  // now — S6 did the same for the Slate mockup when that track closed.
  const src = readFileSync('docs/design/card-redesign-2026-09-21.html', 'utf8');
  assert.match(src, /HISTORICAL/i);
});

test('C8: CLAUDE.md records what Track C changed', () => {
  const md = readFileSync('CLAUDE.md', 'utf8');
  // The kit gained pieces the track needed.
  for (const piece of ['PercentileCell', 'ResultMark', 'DisclosureBar', 'teamColor']) {
    assert.match(md, new RegExp(piece), `CLAUDE.md names ${piece}`);
  }
  // The fill-vs-ink rule, which is the one that bites.
  assert.match(md, /-ink/);
  // D3 moved: the table is still frozen, its controls are not.
  assert.match(md, /controls are on the kit/);
});

test('SPC: CLAUDE.md says where a research flag renders', () => {
  const md = readFileSync('CLAUDE.md', 'utf8');
  assert.match(md, /ResearchFlags/);
  assert.match(md, /\/api\/slate\/flags/);
});
