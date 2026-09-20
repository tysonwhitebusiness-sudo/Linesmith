import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { OUT_OF_SCOPE } from './ui-scope';

/**
 * U1's guard — one Button component, and no page styles its own.
 *
 * Before U1 there were 96 in-scope raw `<button>` elements across 38 files and
 * no Button component at all, so every press feel, focus ring, disabled state
 * and loading state was re-decided per call site. The ratchet below is the
 * thing that stops that growing back.
 *
 * It is a RATCHET, not a zero: the allowlist below names every survivor with
 * the phase that removes it. A new raw `<button>` fails immediately, because
 * the allowlist counts are exact.
 */

const ALLOWED: Record<string, { count: number; why: string }> = {
  // Listbox options, not buttons. `role="option"` inside a `role="listbox"` is
  // a Select/ComboBox in all but name, and U3 adopts both — converting them to
  // Button now would mean writing the same listbox behaviour twice.
  'components/TeamDetailPanel.tsx': { count: 1, why: 'listbox option — U3 Select' },
  'components/PlayerDetailPanel.tsx': { count: 1, why: 'listbox option — U3 ComboBox' },
  'components/PlayerResearchSections.tsx': { count: 1, why: 'listbox option — U3 Select' },
  'components/GolfScheduleView.tsx': { count: 1, why: 'listbox option — U3 Select' },
  'components/TennisScheduleView.tsx': { count: 1, why: 'listbox option — U3 Select' },

  // The slip's scrim: a full-bleed dismiss target that belongs to the Modal
  // primitive, which U4 builds. It has no label, no text and no size of its own.
  'components/SlipModal.tsx': { count: 1, why: 'modal scrim — U4 Modal owns it' },

  // The old glider toggle, kept only while `OUT_OF_SCOPE` files still import
  // it. U5 moves the in-scope callers off and deletes the file.
  'components/SegmentedToggle.tsx': { count: 1, why: 'the old-kit duplicate — U5 deletes it' },

  // Diagnostics is swept last, exactly as the U spec sequences its tables
  // ("diagnostics allowlisted until U6"). Its two `.lb-btn-primary` buttons
  // were converted in U1 so the class could be deleted; the remaining 14 are
  // admin controls that move with the rest of that page.
  'app/diagnostics/page.tsx': { count: 14, why: 'U6 sweeps diagnostics last' },

  // The last-resort boundary renders its own <html>: at that point the root
  // layout is the thing that failed, so the stylesheet may never have applied
  // and a kit Button would render unstyled. Inline styles are correct here.
  'app/global-error.tsx': { count: 1, why: 'runs when the stylesheet may not have loaded' },
};

/** Strips comments, so the word `<button` in a code comment is not a button. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.tsx')) out.push(p);
    }
  };
  walk('app');
  walk('components');
  return out.filter(
    (f) =>
      // The kit IS the buttons.
      !f.startsWith('components/ui/') &&
      // A chart mark is a `<button>` for a real reason: it is a data point you
      // can press, sized and positioned by the chart, not by a control scale.
      !f.startsWith('components/charts/') &&
      !OUT_OF_SCOPE.includes(f),
  );
}

test('no raw <button> in scope, except the named survivors', () => {
  const found: Record<string, number> = {};
  for (const f of sources()) {
    const n = (code(readFileSync(f, 'utf8')).match(/<button[\s>]/g) || []).length;
    if (n > 0) found[f] = n;
  }

  const unexpected = Object.entries(found).filter(([f]) => !(f in ALLOWED));
  assert.deepEqual(
    unexpected,
    [],
    `raw <button> in a file with no reason to have one — use components/ui/Button:\n${unexpected.map(([f, n]) => `  ${f} (${n})`).join('\n')}`,
  );

  // Exact counts, so the allowlist cannot quietly absorb a new one.
  for (const [f, { count, why }] of Object.entries(ALLOWED)) {
    assert.equal(found[f] ?? 0, count, `${f}: expected ${count} raw <button> (${why}), found ${found[f] ?? 0}`);
  }
});

test('the legacy .lb-btn-primary recipe is gone', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  assert.doesNotMatch(css, /\.lb-btn-primary/, 'globals.css still defines the old CTA glow');
  for (const f of sources()) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /lb-btn-primary/, `${f} still uses .lb-btn-primary`);
  }
});

test('Button is exported from the kit and nothing imports it by path', () => {
  const index = readFileSync('components/ui/index.ts', 'utf8');
  for (const name of ['Button', 'IconButton', 'CloseButton']) {
    assert.match(index, new RegExp(`\\b${name}\\b`), `${name} is not exported from components/ui`);
  }
  for (const f of sources()) {
    assert.doesNotMatch(
      readFileSync(f, 'utf8'),
      /from ['"](@\/components\/ui\/Button|\.\/ui\/Button|\.\.\/ui\/Button)['"]/,
      `${f} imports Button by file path rather than from the kit`,
    );
  }
});

test('every icon-only button names itself', () => {
  // An `IconButton` has no visible text, so `aria-label` is required by its
  // type. This catches the other half: a `CloseButton` is allowed to inherit
  // the default "Close", but an IconButton written without a label would be a
  // compile error, and this asserts the type has not been loosened.
  const src = readFileSync('components/ui/Button.tsx', 'utf8');
  assert.match(src, /'aria-label':\s*string;/, 'IconButton no longer requires aria-label');
  assert.match(src, /aria-label=\{rest\['aria-label'\] \?\? 'Close'\}/, 'CloseButton lost its default name');
});
