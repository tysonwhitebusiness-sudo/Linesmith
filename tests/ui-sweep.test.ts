import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { OUT_OF_SCOPE, code } from './ui-scope';

/**
 * U6's guard — the page sweep, at zero.
 *
 * Before U6, in scope: 378 hand-typed `text-[Npx]` sizes (outside charts), 47
 * native `title=` tooltips (which never show on touch or to a keyboard), and
 * 29 hex literals. Every size is on the type ramp now (never below 11px), every
 * tooltip is the kit `Tooltip`, and every colour comes from the palette. The
 * exceptions are NAMED, each with its reason; anything else fails.
 */

/**
 * The frozen Scan table's own cells (D3: "cells … frozen"). `StatCells` and
 * `OddsChip` draw Scan's columns; converting their native titles would make
 * every Scan cell a tab stop, and their sizes are part of the row layout.
 */
const SCAN_CELLS = new Set(['components/StatCells.tsx', 'components/OddsChip.tsx']);

/** Hex is allowed only where a stylesheet cannot be the source. */
const HEX_HOMES: Record<string, string> = {
  'components/charts/tokens.ts': 'the chart palette itself (categorical hues, football card colours)',
  'app/global-error.tsx': 'renders its own <html> when the stylesheet may not have loaded',
  'app/layout.tsx': "the viewport `themeColor` meta, which takes a literal colour",
};

function sources(ext = /\.tsx?$/): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (ext.test(e.name)) out.push(p);
    }
  };
  walk('components');
  walk('app');
  return out.filter((p) => !OUT_OF_SCOPE.includes(p));
}

/** Native `title=` on a lowercase (DOM) tag — a kit component's `title` PROP is not a tooltip. */
export function nativeTitles(src: string): number {
  const body = code(src);
  let n = 0;
  for (const m of body.matchAll(/<([a-z][a-zA-Z0-9]*)\b/g)) {
    let i = m.index! + m[0].length;
    let depth = 0;
    let flat = '';
    for (; i < body.length; i++) {
      const c = body[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
      else if (depth === 0) flat += c;
    }
    if (/\stitle=/.test(flat)) n++;
  }
  return n;
}

test('no hand-typed text-[Npx] in scope (charts and Scan cells aside)', () => {
  const hits: string[] = [];
  for (const p of sources()) {
    if (p.startsWith('components/charts/') || SCAN_CELLS.has(p)) continue;
    for (const m of code(readFileSync(p, 'utf8')).matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
      // R3's one exemption: the percentile number inside RankRow's 22px dot.
      if (p === 'components/ui/Stats.tsx' && m[0] === 'text-[10px]') continue;
      hits.push(`${p}: ${m[0]}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('no native title= on a DOM element in scope (Scan cells aside)', () => {
  const hits = sources(/\.tsx$/)
    .filter((p) => !SCAN_CELLS.has(p))
    .map((p) => [p, nativeTitles(readFileSync(p, 'utf8'))] as const)
    .filter(([, n]) => n > 0);
  assert.deepEqual(hits, []);
});

test('the title counter counts DOM titles, not kit props', () => {
  assert.equal(nativeTitles('<span title="x">a</span>'), 1);
  assert.equal(nativeTitles('<Card title="x" />'), 0);
  assert.equal(nativeTitles('<div onClick={() => f({ title: 1 })}>a</div>'), 0);
});

test('no hex colour literals in scope outside their named homes', () => {
  const hits = sources()
    .filter((p) => !(p in HEX_HOMES))
    .filter((p) => /#[0-9a-fA-F]{3,8}\b/.test(code(readFileSync(p, 'utf8'))));
  assert.deepEqual(hits, []);
});

test('DataTable can group its header, which is what closed the last two hand-rolled tables', () => {
  const src = readFileSync('components/ui/DataTable.tsx', 'utf8');
  assert.match(src, /columnGroups\?: Array<\{ label: ReactNode; span: number \}>/);
  assert.match(src, /scope="colgroup"/);
});

test('golf colours par with `ink`, never with the W/L `tone` chip', () => {
  // Found on render: `tone` is a RESULT column, so every under-par round in
  // the leaderboard read "W -5". Par is a colour on the number, not a result.
  for (const f of ['components/GolfScheduleView.tsx', 'components/PlayerDetail.tsx']) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /tone: (toned \? )?\([^)]*\) => parTone/, f);
    assert.match(src, /ink: (toned \? )?\([^)]*\) => parTone/, f);
  }
  assert.match(readFileSync('components/ui/DataTable.tsx', 'utf8'), /ink\?: \(row: Row\) => 'good' \| 'bad' \| null;/);
});

test('C0: the Electric Turf fill is never text in scope; text uses the -ink shade', () => {
  // #00d26a on white is ~1.9:1. The fill is for bars, dots and solid badges.
  const hits: string[] = [];
  for (const p of sources()) {
    if (SCAN_CELLS.has(p)) continue;
    for (const m of code(readFileSync(p, 'utf8')).matchAll(/(?<![\w-])(?:[a-z-]+:)*text-(good|bad|warn)(?![\w-])/g)) hits.push(`${p}: ${m[0]}`);
  }
  assert.deepEqual(hits, []);
  const css = readFileSync('app/globals.css', 'utf8');
  for (const t of ['good', 'bad', 'warn']) {
    assert.match(css, new RegExp(`--${t}-ink:`), `${t}-ink token`);
    const rule = css.replace(/\r/g, '').includes(`\n.text-${t} {\n  color: rgb(var(--${t}-ink));`);
    assert.ok(rule, `bare text-${t} renders ink for the frozen Scan files`);
  }
});
