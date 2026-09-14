/* Sport-native surfaces. Each takes real rows and returns a card body with its own filters and legend. */

const CAT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300']; // dataviz reference categorical order
const PITCH_NAMES = { FF: 'Four-seam', SI: 'Sinker', FC: 'Cutter', SL: 'Slider', ST: 'Sweeper', CH: 'Changeup', CU: 'Curveball', KC: 'Knuckle curve', FS: 'Splitter', SV: 'Slurve', FO: 'Forkball', KN: 'Knuckleball', EP: 'Eephus', FA: 'Fastball', CS: 'Slow curve', '?': 'Unclassified' };

function svgHost(draw) {
  const host = h('div', { class: 'chart-host' });
  let last = 0;
  new ResizeObserver((en) => { const w = Math.round(en[0].contentRect.width); if (Math.abs(w - last) < 8) return; last = w; put(host, draw(Math.max(260, w))); }).observe(host);
  return host;
}
function hoverable(el, tip, onClick) {
  el.setAttribute('tabindex', '0');
  el.addEventListener('pointermove', (e) => Tip.show(e.clientX, e.clientY, ...tip()));
  el.addEventListener('pointerleave', () => Tip.hide());
  el.addEventListener('focus', () => { const b = el.getBoundingClientRect(); Tip.show(b.left + b.width / 2, b.top, ...tip()); });
  el.addEventListener('blur', () => Tip.hide());
  if (onClick) el.addEventListener('click', onClick);
  return el;
}
const divergeFill = (v, mid, span) => { if (v == null) return 'var(--card-sunk)'; const t = Math.max(-1, Math.min(1, (v - mid) / span)); return t >= 0 ? `color-mix(in srgb, var(--good) ${Math.round(t * 60)}%, #e4e5e7)` : `color-mix(in srgb, var(--bad) ${Math.round(-t * 60)}%, #e4e5e7)`; };
const seqFill = (t) => `color-mix(in srgb, #1d2126 ${Math.round(8 + t * 70)}%, #f3f4f5)`;

/* MLB: zones 1-9 plus the four chase quadrants 11-14, catcher's view. */
function mlbZoneMap(zones, { perspective = 'hitter' } = {}) {
  const wrap = h('div');
  let metric = perspective === 'hitter' ? 'xwoba' : 'share';
  const metrics = perspective === 'hitter' ? [{ value: 'xwoba', label: 'xwOBA on contact' }, { value: 'swing', label: 'Swing %' }, { value: 'whiff', label: 'Whiff %' }] : [{ value: 'share', label: 'Location share' }, { value: 'whiff', label: 'Whiff %' }, { value: 'xwoba', label: 'xwOBA allowed' }];
  const draw = () => {
    const S = 300, inner = 150, x0 = (S - inner) / 2, cell = inner / 3;
    const svg = s('svg', { viewBox: `0 0 ${S} ${S}`, role: 'img', 'aria-label': 'Strike zone map, catcher view', style: 'max-width:340px;margin:0 auto;display:block' });
    const val = (z) => zones[z]?.[metric];
    const vals = Object.values(zones).map((z) => z[metric]).filter((v) => v != null);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const fill = (v) => (metric === 'xwoba' ? divergeFill(perspective === 'hitter' ? v : 0.72 - v, 0.36, 0.18) : v == null ? 'var(--card-sunk)' : seqFill((v - lo) / (hi - lo || 1)));
    const quad = [[11, 0, 0], [12, S / 2, 0], [13, 0, S / 2], [14, S / 2, S / 2]];
    for (const [z, x, y] of quad) {
      const r = s('rect', { x: x + 2, y: y + 2, width: S / 2 - 4, height: S / 2 - 4, rx: 10, fill: fill(val(z)), opacity: 0.55 });
      svg.append(hoverable(r, () => [tipRow(fmtZ(val(z)), metrics.find((m) => m.value === metric).label), tipText(`Chase zone ${z} · ${zones[z]?.n ?? 0} pitches (${zones[z]?.share ?? 0}%)`)]));
      const tx = x + (x ? S / 2 - 22 : 22), ty = y + (y ? S / 2 - 16 : 22);
      svg.append(s('text', { x: tx, y: ty, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600, fill: 'var(--ink-2)' }, fmtZ(val(z))));
    }
    svg.append(s('rect', { x: x0 - 3, y: x0 - 3, width: inner + 6, height: inner + 6, rx: 6, fill: 'var(--card)' }));
    for (let i = 0; i < 9; i++) {
      const z = i + 1, cx = x0 + (i % 3) * cell, cy = x0 + Math.floor(i / 3) * cell, v = val(z);
      const g = s('g');
      g.append(s('rect', { x: cx + 1.5, y: cy + 1.5, width: cell - 3, height: cell - 3, rx: 5, fill: fill(v) }), s('text', { x: cx + cell / 2, y: cy + cell / 2 + 4, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: 'var(--ink)' }, fmtZ(v)));
      svg.append(hoverable(g, () => [tipRow(fmtZ(v), metrics.find((m) => m.value === metric).label), tipText(`Zone ${z} · ${zones[z]?.n ?? 0} pitches · swing ${zones[z]?.swing ?? '—'}% · whiff ${zones[z]?.whiff ?? '—'}%`)]));
    }
    function fmtZ(v) { return v == null ? '—' : metric === 'xwoba' ? fmt.rate3(v) : `${Math.round(v)}%`; }
    put(wrap, h('div', { class: 'row', style: { marginBottom: '8px' } }, segmented(metrics, metric, (v) => { metric = v; draw(); })), svg,
      h('div', { class: 'viz-legend' }, h('span', null, 'Catcher\'s view · inner 3×3 is the strike zone · corners are chase zones'), metric === 'xwoba' ? h('span', null, perspective === 'hitter' ? 'green = above league (.360)' : 'green = suppresses contact') : h('span', null, 'darker = more')));
  };
  draw();
  return wrap;
}

/* MLB pitcher: pitch locations by type (plate_x, plate_z), zone box drawn. */
function mlbPitchLocations(locations) {
  const wrap = h('div');
  const counts = locations.reduce((m, r) => ((m[r[0]] = (m[r[0]] || 0) + 1), m), {});
  const types = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 6);
  let on = new Set(types.slice(0, 3));
  const draw = () => put(wrap, 
    h('div', { class: 'row', style: { marginBottom: '8px' } }, ...types.map((t, i) => h('button', { class: `wchip${on.has(t) ? ' on' : ''}`, type: 'button', onclick: () => { on.has(t) ? on.delete(t) : on.add(t); draw(); } }, h('span', { class: 'sw-dot', style: { background: CAT[i], marginRight: '6px' } }), `${PITCH_NAMES[t] || t} · ${counts[t]}`))),
    svgHost((W) => {
      const H = Math.min(420, W * 0.95), X = (x) => W / 2 + (x / 2.2) * (W / 2) * 0.9, Y = (z) => H - (z / 5) * H;
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Pitch locations' });
      svg.append(s('rect', { x: X(-0.83), y: Y(3.5), width: X(0.83) - X(-0.83), height: Y(1.5) - Y(3.5), fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.5 }));
      svg.append(s('line', { x1: X(-0.28), x2: X(-0.28), y1: Y(3.5), y2: Y(1.5), stroke: 'var(--line)' }), s('line', { x1: X(0.28), x2: X(0.28), y1: Y(3.5), y2: Y(1.5), stroke: 'var(--line)' }), s('line', { x1: X(-0.83), x2: X(0.83), y1: Y(2.83), y2: Y(2.83), stroke: 'var(--line)' }), s('line', { x1: X(-0.83), x2: X(0.83), y1: Y(2.17), y2: Y(2.17), stroke: 'var(--line)' }));
      svg.append(s('path', { d: `M${X(-0.71)},${Y(0.25)} h${X(0.71) - X(-0.71)} l-6,8 l${-(X(0.71) - X(-0.71) - 12) / 2},6 l${-(X(0.71) - X(-0.71) - 12) / 2},-6 Z`, fill: 'var(--card-sunk)', stroke: 'var(--line)' }));
      for (const r of locations) { const i = types.indexOf(r[0]); if (i < 0 || !on.has(r[0])) continue; svg.append(s('circle', { cx: X(r[1]), cy: Y(r[2]), r: 3.4, fill: CAT[i], 'fill-opacity': 0.55 })); }
      svg.append(s('text', { x: 8, y: 16, 'font-size': 11, fill: 'var(--ink-muted)' }, 'Catcher\'s view · last 900 pitches of the season'));
      return svg;
    }));
  draw();
  return wrap;
}

/* NFL: every target by depth (air yards) and field side, from the line of scrimmage. */
function nflTargetField(rows, { role = 'receiver' } = {}) {
  const wrap = h('div');
  const seasons = [...new Set(rows.map((r) => r[0]))].sort();
  let season = seasons[seasons.length - 1] === 2026 && rows.filter((r) => r[0] === 2026).length < 20 ? seasons[seasons.length - 2] : seasons[seasons.length - 1];
  const draw = () => {
    const rs = rows.filter((r) => r[0] === season && r[2] != null && r[3]);
    const zones = {};
    for (const r of rs) { const zk = `${r[4] || (r[2] >= 20 ? 'deep' : 'short')}|${r[3]}`; const z = (zones[zk] = zones[zk] || { n: 0, c: 0, yac: [], air: [], td: 0 }); z.n++; z.c += r[6] ? 1 : 0; if (r[5] != null) z.yac.push(r[5]); z.air.push(r[2]); z.td += r[7] ? 1 : 0; }
    const body = svgHost((W) => {
      const H = 360, top = 20, los = H - 50, ypx = (air) => los - (Math.max(-8, Math.min(45, air)) / 45) * (los - top), col = { left: W * 0.2, middle: W * 0.5, right: W * 0.8 };
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Targets by depth and side' });
      svg.append(s('rect', { x: 0, y: top, width: W, height: H - top - 10, rx: 10, fill: 'oklch(96% 0.012 150)' }));
      for (let yd = -5; yd <= 45; yd += 5) svg.append(s('line', { x1: 0, x2: W, y1: ypx(yd), y2: ypx(yd), stroke: yd === 0 ? 'var(--ink)' : yd % 10 === 0 ? 'oklch(82% 0.01 150)' : 'oklch(89% 0.01 150)', 'stroke-width': yd === 0 ? 2 : 1 }), yd % 10 === 0 || yd === -5 ? s('text', { x: 6, y: ypx(yd) - 3, 'font-size': 11, fill: 'var(--ink-muted)' }, yd === 0 ? 'Line of scrimmage' : `${yd} yds`) : null);
      svg.append(s('line', { x1: W / 3, x2: W / 3, y1: top, y2: H - 10, stroke: 'oklch(89% 0.01 150)', 'stroke-dasharray': '4 4' }), s('line', { x1: (2 * W) / 3, x2: (2 * W) / 3, y1: top, y2: H - 10, stroke: 'oklch(89% 0.01 150)', 'stroke-dasharray': '4 4' }));
      for (const side of ['left', 'middle', 'right']) svg.append(s('text', { x: col[side], y: H - 18, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600, fill: 'var(--ink-2)' }, side[0].toUpperCase() + side.slice(1)));
      let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
      for (const r of rs) {
        const cx = col[r[3]] + (rnd() - 0.5) * (W / 3.6), cy = ypx(r[2]);
        const dot = s('circle', { cx, cy, r: r[7] ? 6 : 4.5, fill: r[6] ? (r[7] ? 'var(--good)' : 'var(--ink)') : 'var(--card)', stroke: r[8] ? 'var(--bad)' : 'var(--ink)', 'stroke-width': r[8] ? 2.5 : 1.3, 'fill-opacity': r[6] ? 0.8 : 1 });
        svg.append(hoverable(dot, () => [tipRow(`${r[2]} air yds`, `${r[6] ? 'caught' : 'incomplete'}${r[7] ? ' · TD' : ''}${r[8] ? ' · INT' : ''}`), tipText(`Week ${r[1]} · ${r[3]} ${r[4] || ''}${r[5] != null ? ` · ${r[5]} YAC` : ''}`)]));
      }
      return svg;
    });
    const zoneRows = ['deep', 'short'].flatMap((len) => ['left', 'middle', 'right'].map((side) => { const z = zones[`${len}|${side}`] || { n: 0, c: 0, yac: [], air: [], td: 0 }; return { zone: `${len[0].toUpperCase() + len.slice(1)} ${side}`, n: z.n, share: rs.length ? (100 * z.n) / rs.length : 0, catch: z.n ? (100 * z.c) / z.n : null, air: U.avg(z.air), yac: U.avg(z.yac), td: z.td }; }));
    put(wrap, h('div', { class: 'row', style: { marginBottom: '8px' } }, segmented(seasons.map((x) => ({ value: x, label: String(x) })), season, (v) => { season = v; draw(); }), h('span', { class: 't-label' }, `${rs.length} located ${role === 'receiver' ? 'targets' : 'passes'}`)),
      h('div', { class: 'split-2' }, h('div', null, body, h('div', { class: 'viz-legend' }, h('span', null, h('i', { style: { background: 'var(--ink)' } }), 'caught'), h('span', null, h('i', { style: { background: 'var(--card)', border: '1px solid var(--ink)' } }), 'incomplete'), h('span', null, h('i', { style: { background: 'var(--good)' } }), 'touchdown'), h('span', null, h('i', { style: { background: 'var(--card)', border: '2px solid var(--bad)' } }), 'intercepted'))),
        dataTable([{ key: 'zone', label: 'Zone' }, { key: 'n', label: role === 'receiver' ? 'Targets' : 'Att', num: true }, { key: 'share', label: 'Share', num: true, fmt: (v) => `${fmt.n(v, 0)}%` }, { key: 'catch', label: role === 'receiver' ? 'Catch %' : 'Comp %', num: true, fmt: (v) => (v == null ? '—' : `${fmt.n(v, 0)}%`) }, { key: 'air', label: 'Air yds', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'yac', label: 'YAC', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'td', label: 'TD', num: true }], zoneRows, { sortKey: null })));
  };
  draw();
  return wrap;
}

/* NBA: half court in feet, rim at (25, 5.25). */
function nbaShotChart(rawRows) {
  // Stored y puts the rim at about 1 ft (fitted against made-shot point values: 99.8% agreement), so shift to
  // baseline-origin feet (rim 5.25). Misses are stored with point value 2 regardless, so their value comes from the arc.
  const rows = rawRows.map(([x, y, made, type, pts]) => { const yy = y + 4.25; const three = Math.hypot(x - 25, yy - 5.25) >= 23.25 || (Math.abs(x - 25) >= 21.5 && yy <= 14); return [x, yy, made, type, made ? pts : three ? 3 : 2]; });
  const wrap = h('div');
  let show = 'all';
  const zoneOf = ([x, y, , , pts]) => { const d = Math.hypot(x - 25, y - 5.25); if (pts === 3) return y < 14 ? 'Corner 3' : 'Above-break 3'; if (d <= 4) return 'Restricted area'; if (Math.abs(x - 25) <= 8 && y <= 19) return 'Paint (non-RA)'; return 'Mid-range'; };
  const draw = () => {
    const rs = rows.filter((r) => r[1] <= 47 && (show === 'all' || (show === 'made') === r[2]));
    const zones = {};
    for (const r of rows) { if (r[1] > 47) continue; const z = zoneOf(r); const q = (zones[z] = zones[z] || { fga: 0, fgm: 0, pts: 0 }); q.fga++; if (r[2]) { q.fgm++; q.pts += r[4]; } }
    const total = Object.values(zones).reduce((s2, z) => s2 + z.fga, 0);
    put(wrap, h('div', { class: 'row', style: { marginBottom: '8px' } }, segmented([{ value: 'all', label: 'All' }, { value: 'made', label: 'Makes' }, { value: 'miss', label: 'Misses' }], show, (v) => { show = v; draw(); }), h('span', { class: 't-label' }, `${rows.length} shots · 2024-25`)),
      h('div', { class: 'split-2' }, svgHost((W) => {
        const H = W * (47 / 50), X = (x) => (x / 50) * W, Y = (y) => (y / 47) * H;
        const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Shot chart' });
        const L = { fill: 'none', stroke: 'var(--line)', 'stroke-width': 1.5 };
        svg.append(s('rect', { x: 0, y: 0, width: W, height: H, rx: 8, fill: 'oklch(97% 0.012 70)' }), s('rect', { x: X(17), y: 0, width: X(16), height: Y(19), ...L }), s('circle', { cx: X(25), cy: Y(19), r: X(6), ...L }), s('circle', { cx: X(25), cy: Y(5.25), r: X(0.75), stroke: 'var(--bad)', fill: 'none', 'stroke-width': 2 }), s('line', { x1: X(22), x2: X(28), y1: Y(4), y2: Y(4), stroke: 'var(--ink)', 'stroke-width': 2 }), s('path', { d: `M${X(21)},${Y(5.25)} A${X(4)},${Y(4)} 0 0 0 ${X(29)},${Y(5.25)}`, ...L }));
        const ang = Math.acos(22 / 23.75), yCorner = 5.25 + 23.75 * Math.sin(ang);
        svg.append(s('path', { d: `M${X(3)},0 L${X(3)},${Y(yCorner)} A${X(23.75)},${Y(23.75)} 0 0 0 ${X(47)},${Y(yCorner)} L${X(47)},0`, ...L }), s('line', { x1: 0, x2: W, y1: H - 1, y2: H - 1, ...L }));
        for (const r of rs) { const dot = r[2] ? s('circle', { cx: X(r[0]), cy: Y(r[1]), r: 3.6, fill: 'var(--good)', 'fill-opacity': 0.75 }) : s('path', { d: `M${X(r[0]) - 3},${Y(r[1]) - 3}l6,6m0,-6l-6,6`, stroke: 'var(--bad)', 'stroke-width': 1.4, 'stroke-opacity': 0.55 }); svg.append(hoverable(dot, () => [tipRow(r[2] ? 'Made' : 'Missed', `${r[4]}-pointer`), tipText(`${r[3]} · ${zoneOf(r)}`)])); }
        return svg;
      }), dataTable([{ key: 'zone', label: 'Zone' }, { key: 'fga', label: 'FGA', num: true }, { key: 'share', label: 'Share', num: true, fmt: (v) => `${fmt.n(v, 0)}%` }, { key: 'fg', label: 'FG %', num: true, fmt: (v) => `${fmt.n(v, 1)}%` }, { key: 'pps', label: 'Pts/shot', num: true, fmt: (v) => fmt.n(v, 2) }],
        Object.entries(zones).map(([zone, z]) => ({ zone, fga: z.fga, share: (100 * z.fga) / total, fg: (100 * z.fgm) / z.fga, pps: z.pts / z.fga })), { sortKey: 'fga' })),
      h('div', { class: 'viz-legend' }, h('span', null, h('i', { style: { background: 'var(--good)' } }), 'made'), h('span', null, '✕ missed (red)'), h('span', null, 'Heaves past half court excluded')));
  };
  draw();
  return wrap;
}

/* NHL: offensive zone, both ends folded onto one net (x 25..100). */
function nhlRinkMap(rows, { goalie = false } = {}) {
  const wrap = h('div');
  let show = 'on';
  const fold = (r) => (r[0] < 0 ? [-r[0], -r[1]] : [r[0], r[1]]);
  const isSlot = (x, y) => x >= 69 && x <= 89 && Math.abs(y) <= 9 + (89 - x) * 0.55;
  const draw = () => {
    const rs = rows.filter((r) => (show === 'all' ? true : show === 'goals' ? r[2] === 'goal' : ['goal', 'shot-on-goal'].includes(r[2])));
    const stat = (f) => { const sub = rows.filter((r) => ['goal', 'shot-on-goal'].includes(r[2])).filter((r) => f(...fold(r))); const g = sub.filter((r) => r[2] === 'goal').length; return { sog: sub.length, g, pct: sub.length ? (100 * g) / sub.length : null }; };
    const slot = stat(isSlot), outside = stat((x, y) => !isSlot(x, y));
    put(wrap, h('div', { class: 'row', style: { marginBottom: '8px' } }, segmented([{ value: 'on', label: 'On goal' }, { value: 'goals', label: 'Goals' }, { value: 'all', label: 'All attempts' }], show, (v) => { show = v; draw(); }), h('span', { class: 't-label' }, `${rows.length} attempts ${goalie ? 'faced' : 'taken'} · 2024-25`)),
      h('div', { class: 'split-2' }, svgHost((W) => {
        const H = W * (85 / 75), X = (x) => ((x - 25) / 75) * W, Y = (y) => ((42.5 - y) / 85) * H;
        const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Shot map' });
        svg.append(s('rect', { x: 0, y: 0, width: W, height: H, rx: 24, fill: 'oklch(97.5% 0.006 230)', stroke: 'var(--line)' }), s('line', { x1: X(25) + 2, x2: X(25) + 2, y1: 0, y2: H, stroke: '#2f6fb3', 'stroke-width': 4 }), s('line', { x1: X(89), x2: X(89), y1: Y(40), y2: Y(-40), stroke: 'var(--bad)', 'stroke-width': 1.5 }));
        svg.append(s('path', { d: `M${X(89)},${Y(4)} A${X(31) - X(25)},${Y(0) - Y(6)} 0 0 0 ${X(89)},${Y(-4)}`, fill: 'color-mix(in srgb, #2f6fb3 18%, transparent)', stroke: 'var(--bad)' }), s('rect', { x: X(89), y: Y(3), width: X(92) - X(89), height: Y(-3) - Y(3), fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2 }));
        for (const cy of [22, -22]) svg.append(s('circle', { cx: X(69), cy: Y(cy), r: (15 / 75) * W, fill: 'none', stroke: 'var(--bad)', 'stroke-opacity': 0.5 }), s('circle', { cx: X(69), cy: Y(cy), r: 3, fill: 'var(--bad)' }));
        svg.append(s('path', { d: `M${X(69)},${Y(22)} L${X(89)},${Y(9)} L${X(89)},${Y(-9)} L${X(69)},${Y(-22)} Z`, fill: 'color-mix(in srgb, var(--warn) 10%, transparent)', stroke: 'var(--warn)', 'stroke-dasharray': '4 3' }));
        for (const r of rs) { const [x, y] = fold(r); if (x < 25) continue; const goal = r[2] === 'goal'; const dot = s('circle', { cx: X(x), cy: Y(y), r: goal ? 5.5 : 3.4, fill: goal ? 'var(--good)' : r[2] === 'shot-on-goal' ? 'var(--ink)' : 'var(--ink-faint)', 'fill-opacity': goal ? 0.95 : 0.5, stroke: goal ? 'var(--card)' : 'none', 'stroke-width': 1.5 }); svg.append(hoverable(dot, () => [tipRow(r[2].replace(/-/g, ' '), r[3] || 'unknown type'), tipText(`Period ${r[4]} · ${Math.round(Math.hypot(89 - x, y))} ft from net`)])); }
        return svg;
      }), h('div', { class: 'stack' },
        statGrid([{ label: goalie ? 'Save % from the slot' : 'Shooting % from the slot', value: slot.pct == null ? '—' : `${fmt.n(goalie ? 100 - slot.pct : slot.pct, 1)}%`, sub: `${slot.g} goals on ${slot.sog}`, info: 'Slot: the high-danger area between the faceoff dots in front of the net (dashed).' }, { label: goalie ? 'Save % outside' : 'Shooting % outside', value: outside.pct == null ? '—' : `${fmt.n(goalie ? 100 - outside.pct : outside.pct, 1)}%`, sub: `${outside.g} goals on ${outside.sog}` }]),
        dataTable([{ key: 'type', label: 'Shot type' }, { key: 'n', label: 'On goal', num: true }, { key: 'g', label: 'Goals', num: true }, { key: 'pct', label: goalie ? 'Save %' : 'Sh %', num: true, fmt: (v) => fmt.n(v, 1) }],
          Object.entries(U.groupBy(rows.filter((r) => ['goal', 'shot-on-goal'].includes(r[2])), (r) => r[3] || 'unknown')).map(([type, rr]) => { const g = rr.filter((r) => r[2] === 'goal').length; return { type, n: rr.length, g, pct: goalie ? 100 - (100 * g) / rr.length : (100 * g) / rr.length }; }), { sortKey: 'n' }))),
      h('div', { class: 'viz-legend' }, h('span', null, h('i', { style: { background: 'var(--good)' } }), 'goal'), h('span', null, h('i', { style: { background: 'var(--ink)' } }), 'on goal'), h('span', null, h('i', { style: { background: 'var(--ink-faint)' } }), 'missed / blocked'), h('span', null, 'both ends folded onto one net')));
  };
  draw();
  return wrap;
}

/* Soccer: Understat coordinates (x toward goal 0..1, y across 0..1), dots sized by xG. */
function soccerShotMap(shots) {
  const wrap = h('div');
  const seasons = [...new Set(shots.map((r) => r[6]))].sort();
  let season = 'all', sit = 'all';
  const draw = () => {
    const rs = shots.filter((r) => (season === 'all' || r[6] === season) && (sit === 'all' || r[4] === sit));
    const goals = rs.filter((r) => r[3] === 'Goal').length, xg = U.sum(rs.map((r) => r[2]));
    put(wrap, h('div', { class: 'row', style: { marginBottom: '8px' } }, selectBox([{ value: 'all', label: 'All seasons held' }, ...seasons.map((x) => ({ value: x, label: `${x}-${String(Number(x) + 1).slice(2)}` }))], season, (v) => { season = v; draw(); }, 'Season'),
      segmented([{ value: 'all', label: 'All' }, { value: 'OpenPlay', label: 'Open play' }, { value: 'SetPiece', label: 'Set piece' }, { value: 'FromCorner', label: 'Corners' }, { value: 'Penalty', label: 'Penalties' }], sit, (v) => { sit = v; draw(); })),
      h('div', { class: 'split-2' }, svgHost((W) => {
        const H = W * 0.78, X = (y) => y * W, Y = (x) => H - ((x - 0.5) / 0.5) * H;
        const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Shot map, attacking half' });
        const L = { fill: 'none', stroke: 'oklch(80% 0.02 150)', 'stroke-width': 1.5 };
        svg.append(s('rect', { x: 0, y: 0, width: W, height: H, rx: 8, fill: 'oklch(96% 0.02 150)' }), s('rect', { x: X(0.21), y: Y(1), width: X(0.79) - X(0.21), height: Y(0.843) - Y(1), ...L }), s('rect', { x: X(0.37), y: Y(1), width: X(0.63) - X(0.37), height: Y(0.948) - Y(1), ...L }), s('rect', { x: X(0.45), y: Y(1) - 5, width: X(0.55) - X(0.45), height: 5, fill: 'var(--ink)' }), s('circle', { cx: X(0.5), cy: Y(0.895), r: 2.5, fill: 'oklch(70% 0.02 150)' }), s('path', { d: `M${X(0.4)},${Y(0.843)} A${W * 0.087},${W * 0.087} 0 0 0 ${X(0.6)},${Y(0.843)}`, ...L }), s('line', { x1: 0, x2: W, y1: H - 1, y2: H - 1, ...L }));
        for (const r of rs.slice().sort((a, b) => b[2] - a[2])) { const goal = r[3] === 'Goal'; const dot = s('circle', { cx: X(r[1]), cy: Y(r[0]), r: 3 + Math.sqrt(r[2]) * 14, fill: goal ? 'var(--good)' : 'var(--ink)', 'fill-opacity': goal ? 0.85 : 0.25, stroke: goal ? 'var(--card)' : 'var(--ink)', 'stroke-opacity': goal ? 1 : 0.5, 'stroke-width': 1 }); svg.append(hoverable(dot, () => [tipRow(`${fmt.n(r[2], 2)} xG`, r[3].replace(/([A-Z])/g, ' $1').trim()), tipText(`${r[5].replace(/([A-Z])/g, ' $1').trim()} · ${r[4].replace(/([A-Z])/g, ' $1').trim()} · ${r[7]}'`)])); }
        return svg;
      }), h('div', { class: 'stack' }, statGrid([{ label: 'Shots', value: rs.length }, { label: 'Goals', value: goals }, { label: 'xG', value: fmt.n(xg, 1) }, { label: 'Goals − xG', value: `${goals - xg >= 0 ? '+' : ''}${fmt.n(goals - xg, 1)}`, info: 'Positive means finishing above the quality of chances.' }, { label: 'xG per shot', value: fmt.n(rs.length ? xg / rs.length : null, 2) }, { label: 'Conversion', value: rs.length ? `${fmt.n((100 * goals) / rs.length, 1)}%` : '—' }]),
        dataTable([{ key: 'type', label: 'Body part' }, { key: 'n', label: 'Shots', num: true }, { key: 'g', label: 'Goals', num: true }, { key: 'xg', label: 'xG', num: true, fmt: (v) => fmt.n(v, 1) }], Object.entries(U.groupBy(rs, (r) => r[5])).map(([t, rr]) => ({ type: t.replace(/([A-Z])/g, ' $1').trim(), n: rr.length, g: rr.filter((r) => r[3] === 'Goal').length, xg: U.sum(rr.map((r) => r[2])) })), { sortKey: 'n' }))),
      h('div', { class: 'viz-legend' }, h('span', null, h('i', { style: { background: 'var(--good)' } }), 'goal'), h('span', null, h('i', { style: { background: 'var(--ink)', opacity: 0.35 } }), 'no goal'), h('span', null, 'dot size = xG')));
  };
  draw();
  return wrap;
}
