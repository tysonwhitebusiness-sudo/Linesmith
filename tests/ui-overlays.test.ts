import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { OUT_OF_SCOPE, code } from './ui-scope';

/**
 * U4's guard — every overlay is a kit overlay.
 *
 * Before U4, three overlays each re-implemented a different subset of what a
 * dialog needs: the slip had a scrim and an animation but no focus trap and no
 * Escape; the account menu was a full-screen click-catching div; the
 * diagnostics dialog stopped click propagation by hand; `DrillDownPanel` had
 * the most complete trap, written by hand, with its own portal. All four are
 * React Aria's now. This is a ZERO.
 */

function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name)) out.push(p);
    }
  };
  walk('components');
  walk('app');
  return out.filter((p) => !p.startsWith('components/ui/') && !OUT_OF_SCOPE.includes(p));
}

test('no createPortal, role="dialog" or aria-modal outside the kit', () => {
  const hits = sources().filter((p) => /createPortal|role="dialog"|aria-modal/.test(code(readFileSync(p, 'utf8'))));
  assert.deepEqual(hits, []);
});

test('no hand-built full-screen scrim outside the kit', () => {
  const hits = sources().filter((p) => /fixed inset-0/.test(code(readFileSync(p, 'utf8'))));
  assert.deepEqual(hits, []);
});

test('DrillDownPanel is the SlideoutMenu, with its props unchanged', () => {
  const src = code(readFileSync('components/ui/DrillDownPanel.tsx', 'utf8'));
  assert.doesNotMatch(src, /createPortal|role="dialog"|addEventListener/);
  assert.match(src, /<SlideoutMenu/);
  for (const prop of ['open', 'onClose', 'title', 'subtitle', 'children', 'width']) assert.match(src, new RegExp(`${prop}\\??:`), prop);
});

test("the kit's overlays are React Aria's", () => {
  const src = code(readFileSync('components/ui/Overlays.tsx', 'utf8'));
  for (const piece of ['ModalOverlay', 'MenuTrigger', 'DialogTrigger', 'Heading']) assert.match(src, new RegExp(piece), piece);
  assert.doesNotMatch(src, /createPortal/);
  // The scrim is ink at 40% with no blur (U spec §4).
  assert.match(src, /bg-ink\/40/);
  assert.doesNotMatch(src, /backdrop-blur/);
});

test('an overlay that moves fades instead under reduced motion', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  assert.match(css, /\.lb-overlay-move\[data-entering\]/);
  assert.match(css, /\.lb-overlay-move\[data-exiting\]/);
  const src = readFileSync('components/ui/Overlays.tsx', 'utf8');
  assert.ok((src.match(/lb-overlay-move/g) ?? []).length >= 2);
});

test('the slip, the account menu and diagnostics use the kit', () => {
  assert.match(readFileSync('components/SlipModal.tsx', 'utf8'), /<Modal\b/);
  assert.match(readFileSync('components/AccountMenu.tsx', 'utf8'), /<Dropdown\b/);
  assert.match(readFileSync('app/diagnostics/page.tsx', 'utf8'), /<Modal\b/);
});
