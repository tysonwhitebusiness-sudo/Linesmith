/**
 * Assembles docs/design/player-detail-per-sport.html from:
 *   - chart-grammar.html   (its <style> and its two primitive <script> blocks,
 *                           reused VERBATIM apart from the three patches below)
 *   - _ps-extra.css        (only the classes the per-sport board adds)
 *   - _ps-body.html        (the page markup)
 *   - _ps-data1/2.js       (the eight sport datasets)
 *   - _ps-render.js        (one renderSport(), no sport check in it)
 *
 * Reusing the primitives verbatim is the point: if the two pages ever disagree
 * visually, that is a real bug in a primitive, not a copy that drifted.
 *
 * Run:  node docs/design/build-per-sport.mjs
 */
import fs from 'fs';
import path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const src = read('chart-grammar.html').split('\n');

/** 1-indexed, inclusive, matching what `sed -n 'a,bp'` would give. */
const slice = (a, b) => src.slice(a - 1, b).join('\n');

// ---- locate the blocks by content, never by hardcoded line number ---------
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

let style = slice(styleStart, styleEnd);
let s1 = slice(s1Start, s1End);
let s2 = slice(s2Start, s2DataEnd);

// ---- patch 1: make rangeBar/contributionBars take their rows from opts ----
// Both baked their data into a module-level const. Rename the const, then
// shadow it with a local that prefers opts. Assert each patch actually landed;
// a silently-missed rename would render every sport MLB's book prices.
function patch(s, find, replace, label) {
  if (!s.includes(find)) throw new Error('patch missed: ' + label);
  return s.replace(find, replace);
}
s1 = patch(s1, '  var BOOKS = [', '  var BOOKS_D = [', 'BOOKS rename');
s1 = patch(s1,
  "  function rangeBar(hostId, opts) {\n    opts = opts || {};",
  "  function rangeBar(hostId, opts) {\n    opts = opts || {};\n    var BOOKS = opts.books || BOOKS_D;",
  'rangeBar opts.books');
s1 = patch(s1, '  var CONTRIB = [', '  var CONTRIB_D = [', 'CONTRIB rename');
s1 = patch(s1,
  "  function contributionBars(hostId, opts) {\n    opts = opts || {};",
  "  function contributionBars(hostId, opts) {\n    opts = opts || {};\n    var CONTRIB = opts.rows || CONTRIB_D;",
  'contributionBars opts.rows');

// ---- patch 2: export the primitives this page drives ----------------------
s1 = patch(s1,
  '  window.LB = {\n    svg: svg,',
  '  window.LB = {\n    seriesChart: seriesChart, distributionBars: distributionBars,\n' +
  '    densityCurve: densityCurve, percentileRails: percentileRails, heatGrid: heatGrid,\n' +
  '    rangeBar: rangeBar, contributionBars: contributionBars,\n    svg: svg,',
  'LB exports');

// ---- patch 3: zoneGrid had MLB baked into it ------------------------------
// Found by looking at the built page: NFL's 14.8 yards-per-target rendered as
// "4.800", because the primitive formatted every cell with baseball's
// strip-the-leading-zero convention. The domain (0.20-0.65) and the caption
// ("catcher view / xwOBA") were hardcoded the same way. That is precisely the
// leak this whole study is about, found in a primitive rather than a page --
// so it is fixed here, with MLB's values as the defaults so chart-grammar.html
// renders identically.
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

// ---- patch 4: close script 2's IIFE and export its primitives -------------
s2 += [
  '',
  '  window.LB2 = {',
  '    el: el, statTable: statTable, streakStrip: streakStrip, splitDumbbell: splitDumbbell,',
  '    rollingChart: rollingChart, zoneGrid: zoneGrid, denseTable: denseTable, windowTiles: windowTiles',
  '  };',
  '})();',
  '</script>',
].join('\n');

// ---- the page's own script ------------------------------------------------
const mine = [
  '<script>',
  '/* Per-sport board. ASCII only - the artifact wrapper owns <head>, so there',
  '   is no <meta charset> to rely on. Same rule as chart-grammar.html. */',
  '(function () {',
  "  'use strict';",
  '  var LB = window.LB, LB2 = window.LB2;',
  '  if (!LB || !LB2) return;',
  '  var heatInk = LB.heatInk, seqFill = LB.seqFill;',
  '  var el = LB2.el, statTable = LB2.statTable, streakStrip = LB2.streakStrip;',
  '  var splitDumbbell = LB2.splitDumbbell, rollingChart = LB2.rollingChart;',
  '  var zoneGrid = LB2.zoneGrid, denseTable = LB2.denseTable, windowTiles = LB2.windowTiles;',
  '',
  read('_ps-data1.js'),
  read('_ps-data2.js'),
  read('_ps-render.js'),
  '})();',
  '</script>',
].join('\n');

const out = [
  '<title>Eight Sports, One Page</title>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">',
  '',
  style,
  '<style>',
  read('_ps-extra.css'),
  '</style>',
  '',
  read('_ps-body.html'),
  '',
  s1,
  '',
  s2,
  '',
  mine,
  '',
].join('\n');

const nonAscii = out.split('\n')
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => /[^\x00-\x7e]/.test(l))
  .map(([n]) => n);
if (nonAscii.length) {
  throw new Error('non-ASCII on lines: ' + nonAscii.slice(0, 20).join(', '));
}

fs.writeFileSync(path.join(DIR, 'player-detail-per-sport.html'), out, 'ascii');
console.log('wrote player-detail-per-sport.html  (' + Math.round(out.length / 1024) + ' KB, ' +
  out.split('\n').length + ' lines)');
console.log('reused from chart-grammar.html: style ' + styleStart + '-' + styleEnd +
  ', primitives ' + s1Start + '-' + s1End + ' and ' + s2Start + '-' + s2DataEnd);
