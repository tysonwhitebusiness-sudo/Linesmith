/**
 * Shared extraction + patching for the per-sport design boards.
 *
 * Both `build-per-sport.mjs` (player) and `build-team-detail.mjs` (team) splice
 * `chart-grammar.html`'s <style> and its two primitive <script> blocks into
 * their own page. That splice is VERBATIM apart from the patches below, so if
 * the boards ever look different from each other it is a real bug in a
 * primitive rather than a copy that drifted.
 *
 * This module exists because the two build scripts started as a copy of each
 * other, and a patch added to one would silently not exist in the other -- the
 * exact failure mode `run_provider_specs` and the sport adapters were both
 * created to stop. One patch list, applied to both.
 *
 * Every patch asserts its own anchor. A missed rename fails the build loudly
 * instead of rendering MLB's data under another sport's heading.
 */
import fs from 'fs';
import path from 'path';

export const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
export const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

function patch(s, find, replace, label) {
  if (!s.includes(find)) throw new Error('patch missed: ' + label);
  return s.replace(find, replace);
}

/**
 * Returns { style, s1, s2 } ready to splice, with every patch applied.
 * MLB's original values stay the defaults throughout, so chart-grammar.html
 * itself renders identically to before.
 */
export function loadPrimitives() {
  const src = read('chart-grammar.html').split('\n');
  const slice = (a, b) => src.slice(a - 1, b).join('\n');
  const at = (pred, from = 0) => {
    const i = src.findIndex((l, n) => n >= from && pred(l));
    if (i < 0) throw new Error('anchor not found');
    return i + 1;
  };

  const styleStart = at((l) => l.trim() === '<style>');
  const styleEnd = at((l) => l.trim() === '</style>', styleStart);
  const s1Start = at((l) => l.trim() === '<script>', styleEnd);
  const s1End = at((l) => l.trim() === '</script>', s1Start);
  const s2Start = at((l) => l.trim() === '<script>', s1End);
  const s2DataEnd = at((l) => l.includes('// DATA - representative'), s2Start) - 2;

  const style = slice(styleStart, styleEnd);
  let s1 = slice(s1Start, s1End);
  let s2 = slice(s2Start, s2DataEnd);

  // -- rangeBar / contributionBars baked their data into module consts -------
  s1 = patch(s1, '  var BOOKS = [', '  var BOOKS_D = [', 'BOOKS rename');
  s1 = patch(s1,
    '  function rangeBar(hostId, opts) {\n    opts = opts || {};',
    '  function rangeBar(hostId, opts) {\n    opts = opts || {};\n    var BOOKS = opts.books || BOOKS_D;',
    'rangeBar opts.books');
  s1 = patch(s1, '  var CONTRIB = [', '  var CONTRIB_D = [', 'CONTRIB rename');
  s1 = patch(s1,
    '  function contributionBars(hostId, opts) {\n    opts = opts || {};',
    '  function contributionBars(hostId, opts) {\n    opts = opts || {};\n    var CONTRIB = opts.rows || CONTRIB_D;',
    'contributionBars opts.rows');

  // -- export the primitives the boards drive -------------------------------
  s1 = patch(s1,
    '  window.LB = {\n    svg: svg,',
    '  window.LB = {\n    seriesChart: seriesChart, distributionBars: distributionBars,\n' +
    '    densityCurve: densityCurve, percentileRails: percentileRails, heatGrid: heatGrid,\n' +
    '    rangeBar: rangeBar, contributionBars: contributionBars,\n    svg: svg,',
    'LB exports');

  // -- zoneGrid had MLB baked into it ---------------------------------------
  // Found by looking at the built player board: NFL's 14.8 yards-per-target
  // rendered as "4.800", because the primitive formatted every cell with
  // baseball's strip-the-leading-zero convention. The domain (0.20-0.65) and
  // the caption ("catcher view / xwOBA") were hardcoded the same way.
  s2 = patch(s2,
    '    var lo = 0.20, hi = 0.65;',
    '    var lo = opts.lo != null ? opts.lo : 0.20, hi = opts.hi != null ? opts.hi : 0.65;\n' +
    "    var fmt = opts.fmt || function (v) { return v.toFixed(3).slice(1); };\n" +
    "    var unit = opts.unit || 'xwOBA';\n" +
    "    var caption = opts.caption || ('catcher view ' + MIDDOT + ' xwOBA by zone');",
    'zoneGrid domain/format');
  s2 = patch(s2, 'c.v.toFixed(3).slice(1), {', 'fmt(c.v), {', 'zoneGrid cell format');
  s2 = patch(s2,
    "          [{ value: c.v.toFixed(3), label: c.k + ' ' + MIDDOT + ' xwOBA ' + MIDDOT + ' n=' + c.n }]);",
    "          [{ value: fmt(c.v), label: c.k + ' ' + MIDDOT + ' ' + unit + ' ' + MIDDOT + ' n=' + c.n }]);",
    'zoneGrid tooltip');
  s2 = patch(s2,
    "    s.appendChild(txt(w / 2, h - 4, 'catcher view ' + MIDDOT + ' xwOBA by zone', {",
    '    s.appendChild(txt(w / 2, h - 4, caption, {',
    'zoneGrid caption');

  // -- rollingChart forced a ZERO-BASED y axis ------------------------------
  // Same class of bug as zoneGrid, found the same way -- by looking at the
  // built team board rather than at the DOM. A zero-based axis is right for a
  // count stat (hits, receiving yards), which is what the primitive was first
  // written against. It is wrong for a RATING: an Elo series spanning
  // 1460-1590 collapsed into a flat strip at the top of the frame with ticks
  // at 0.0 / 590.2 / 1180.5, destroying the whole signal.
  // Opt-in via `zeroBased: false`, so every existing caller is unchanged.
  s2 = patch(s2,
    '    var lo = 0, hi = Math.max.apply(null, all) * 1.12;',
    '    var lo, hi;\n' +
    '    if (cfg.zeroBased === false) {\n' +
    '      var mnv = Math.min.apply(null, all), mxv = Math.max.apply(null, all);\n' +
    '      var padv = (mxv - mnv) * 0.18 || 1;\n' +
    '      lo = mnv - padv; hi = mxv + padv;\n' +
    '    } else {\n' +
    '      lo = 0; hi = Math.max.apply(null, all) * 1.12;\n' +
    '    }',
    'rollingChart zeroBased');
  s2 = patch(s2,
    "      s.appendChild(txt(padL - 6, y + 3, v.toFixed(1), { anchor: 'end', fill: INK4, size: 9, tabular: true }));",
    "      s.appendChild(txt(padL - 6, y + 3, cfg.fmt ? cfg.fmt(v) : v.toFixed(1), { anchor: 'end', fill: INK4, size: 9, tabular: true }));",
    'rollingChart tick format');
  s2 = patch(s2,
    "    s.appendChild(txt(X(li) - 8, Y(cfg.mean[li]) - 9, cfg.mean[li].toFixed(2), {",
    "    s.appendChild(txt(X(li) - 8, Y(cfg.mean[li]) - 9, cfg.fmt ? cfg.fmt(cfg.mean[li]) : cfg.mean[li].toFixed(2), {",
    'rollingChart end label');

  // -- close script 2's IIFE and export its primitives ----------------------
  s2 += [
    '',
    '  window.LB2 = {',
    '    el: el, statTable: statTable, streakStrip: streakStrip, splitDumbbell: splitDumbbell,',
    '    rollingChart: rollingChart, zoneGrid: zoneGrid, denseTable: denseTable, windowTiles: windowTiles',
    '  };',
    '})();',
    '</script>',
  ].join('\n');

  return { style, s1, s2, where: `style ${styleStart}-${styleEnd}, primitives ${s1Start}-${s1End} and ${s2Start}-${s2DataEnd}` };
}

/** Wraps a board's data+render files in the IIFE that borrows LB / LB2. */
export function boardScript(files) {
  return [
    '<script>',
    '/* Per-sport board. ASCII only - the artifact wrapper owns <head>, so there',
    '   is no <meta charset> to rely on. Same rule as chart-grammar.html. */',
    '(function () {',
    "  'use strict';",
    '  var LB = window.LB, LB2 = window.LB2;',
    '  if (!LB || !LB2) return;',
    '  var heatInk = LB.heatInk, seqFill = LB.seqFill, divFill = LB.divFill;',
    '  var el = LB2.el, statTable = LB2.statTable, streakStrip = LB2.streakStrip;',
    '  var splitDumbbell = LB2.splitDumbbell, rollingChart = LB2.rollingChart;',
    '  var zoneGrid = LB2.zoneGrid, denseTable = LB2.denseTable, windowTiles = LB2.windowTiles;',
    '',
    ...files.map(read),
    '})();',
    '</script>',
  ].join('\n');
}

/** Assembles and writes a board. Refuses to write anything non-ASCII. */
export function writeBoard({ title, bodyFile, extraCss, scriptFiles, outFile }) {
  const { style, s1, s2, where } = loadPrimitives();
  const out = [
    `<title>${title}</title>`,
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">',
    '',
    style,
    '<style>',
    read(extraCss),
    '</style>',
    '',
    read(bodyFile),
    '',
    s1,
    '',
    s2,
    '',
    boardScript(scriptFiles),
    '',
  ].join('\n');

  const bad = out.split('\n').map((l, i) => [i + 1, l])
    .filter(([, l]) => /[^\x00-\x7e]/.test(l)).map(([n]) => n);
  if (bad.length) throw new Error('non-ASCII on lines: ' + bad.slice(0, 20).join(', '));

  fs.writeFileSync(path.join(DIR, outFile), out, 'ascii');
  console.log(`wrote ${outFile}  (${Math.round(out.length / 1024)} KB, ${out.split('\n').length} lines)`);
  console.log('reused from chart-grammar.html: ' + where);
}
