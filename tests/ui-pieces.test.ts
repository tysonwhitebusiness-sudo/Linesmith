import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { OUT_OF_SCOPE, code } from './ui-scope';

/**
 * U5's guard — in scope there is ONE chip, ONE toggle and ONE skeleton.
 *
 * Before U5 there were two of each: `components/ui/`'s and an older set
 * (`.lb-chip` in `globals.css`, the glider `components/SegmentedToggle.tsx`,
 * the duplicate `Skeleton` in `components/Skeleton.tsx`). The old ones stay
 * only for as long as an `OUT_OF_SCOPE` file needs them, which is what these
 * ratchets record.
 */

const CHIP_ALLOWED: Record<string, { count: number; why: string }> = {
  // (U6 moved diagnostics' sixteen onto Chip with semantic tones.)
};

const TOGGLE_ALLOWED: Record<string, string> = {
  // C6 rebuilt Scan's filter bar on the kit `SegmentedToggle`, and the glider
  // `components/SegmentedToggle.tsx` was deleted — nothing imports it now.
};

const SKELETON_ALLOWED: Record<string, string> = {
  // These are page-SHAPED skeletons (a scan card, a player panel), not a
  // second primitive: since U5 they compose `components/ui/`'s `Skeleton`.
  'components/AppShell.tsx': 'OUT_OF_SCOPE — the slate body’s own shapes',
  'components/PlayerDetailPanel.tsx': 'PlayerSkeleton is a page shape, not a primitive',
};

function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  walk('app');
  walk('components');
  return out;
}

const inScope = (f: string) => !f.startsWith('components/ui/') && !OUT_OF_SCOPE.includes(f);

test('the three dead legacy recipes are gone from globals.css', () => {
  // Measured as 0 uses in the U spec §0 audit, and still 0 at U5.
  const css = readFileSync('app/globals.css', 'utf8');
  for (const name of ['.lb-tab', '.lb-filter', '.lb-dense']) {
    assert.doesNotMatch(css, new RegExp(name.replace('.', '\\.')), `${name} is dead and must not be in globals.css`);
  }
  // `.lb-chip` survives only while the out-of-scope files use it.
  assert.match(css, /\.lb-chip/, 'the legacy chip is still needed by Scan');
});

test('in scope, a chip is a Chip', () => {
  const found: Record<string, number> = {};
  for (const f of sources()) {
    if (!inScope(f)) continue;
    const n = (code(readFileSync(f, 'utf8')).match(/lb-chip/g) || []).length;
    if (n > 0) found[f] = n;
  }
  const unexpected = Object.entries(found).filter(([f]) => !(f in CHIP_ALLOWED));
  assert.deepEqual(unexpected, [], `.lb-chip in scope — use components/ui/Chip:\n${unexpected.map(([f, n]) => `  ${f} (${n})`).join('\n')}`);
  for (const [f, { count, why }] of Object.entries(CHIP_ALLOWED)) {
    assert.equal(found[f] ?? 0, count, `${f}: expected ${count} .lb-chip (${why})`);
  }
});

test('in scope, a toggle is the kit toggle', () => {
  const importers = sources().filter(
    (f) => inScope(f) && /from '(\.\/|@\/components\/)SegmentedToggle'/.test(readFileSync(f, 'utf8')),
  );
  assert.deepEqual(
    importers,
    Object.keys(TOGGLE_ALLOWED).filter((f) => inScope(f)),
    'the glider SegmentedToggle has an in-scope importer',
  );
  // It still has an out-of-scope one, so the file itself stays for now.
  const all = sources().filter((f) => /from '(\.\/|@\/components\/)SegmentedToggle'/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(all.sort(), Object.keys(TOGGLE_ALLOWED).sort());
});

test('there is one Skeleton primitive', () => {
  // `components/Skeleton.tsx` keeps the page SHAPES and composes the kit's.
  const src = readFileSync('components/Skeleton.tsx', 'utf8');
  assert.match(src, /import \{ Skeleton \} from '\.\/ui';/, 'the page shapes must compose the kit skeleton');
  assert.doesNotMatch(src, /export function Skeleton\(/, 'the duplicate primitive must be gone');
  const importers = sources().filter((f) => /from '(\.\/|@\/components\/)Skeleton'/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(importers.sort(), Object.keys(SKELETON_ALLOWED).sort());
});

test('Chip.dot is identity, not a tone', () => {
  const src = readFileSync('components/ui/Chip.tsx', 'utf8');
  assert.match(src, /dot\?: string;/, 'dot takes a colour, not a tone name');
  // The tone list gained no hue for a dot. C0 added `onColor`, which is a
  // SURFACE (a translucent chip on a coloured hero band), not a hue.
  assert.match(
    src,
    /export type ChipTone = 'neutral' \| 'good' \| 'bad' \| 'warn' \| 'live' \| 'cmpA' \| 'cmpB' \| 'strong' \| 'masters' \| 'onColor';/,
  );
});

test('Tabs carry a count and SegmentedToggle an icon', () => {
  const src = readFileSync('components/ui/Controls.tsx', 'utf8');
  assert.match(src, /count\?: number;/);
  assert.match(src, /icon\?: ReactNode;/);
  // The count badge changes with selection, which is how it stays legible on
  // the active tab's lighter ground.
  assert.match(src, /on \? 'bg-card text-ink ring-1 ring-line ring-inset' : 'bg-card-sunk text-ink-muted'/);
});

test('the empty and error states can lead with an icon', () => {
  const src = readFileSync('components/ui/States.tsx', 'utf8');
  assert.match(src, /<FeaturedIcon icon=\{icon\} \/>/);
  assert.match(src, /<FeaturedIcon icon=\{icon\} tone="bad" \/>/);
});

test('AvatarLabel takes one sub-line, and AvatarGroup counts the rest', () => {
  const src = readFileSync('components/ui/Pieces.tsx', 'utf8');
  // Two sub-lines would be a card, not a row.
  assert.match(src, /\/\*\* ONE sub-line\. Two would be a card, not a row\. \*\//);
  assert.match(src, /\+\{rest\}/);
  // The borrowed pieces must not have smuggled initials back into the avatar.
  // `code()` first, because the file's own doc comment says the word.
  assert.doesNotMatch(code(src), /initials/i);
});
