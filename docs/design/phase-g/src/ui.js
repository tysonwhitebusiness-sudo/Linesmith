/* Phase G mockup UI kit: one implementation of each F2 component. Plain JS, no deps.
   All data-derived text goes through textContent (never innerHTML). */
const SVGNS = 'http://www.w3.org/2000/svg';

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
function s(tag, attrs, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const fmt = {
  n: (v, d = 0) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })),
  pct: (v, d = 0) => (v == null ? '—' : `${Number(v).toFixed(d)}%`),
  rate3: (v) => (v == null ? '—' : Number(v).toFixed(3).replace(/^0/, '')),
  ord: (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); },
};

/* Tooltip — one element, shown on hover and on keyboard focus. */
const Tip = {
  el: null,
  show(x, y, ...nodes) {
    if (!this.el) { this.el = h('div', { class: 'tip', role: 'tooltip' }); document.body.append(this.el); }
    this.el.replaceChildren(...nodes);
    const r = this.el.getBoundingClientRect();
    const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14));
    const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
    this.el.style.left = `${left}px`; this.el.style.top = `${top}px`;
    this.el.classList.add('on');
  },
  hide() { this.el && this.el.classList.remove('on'); },
  bind(target, content) {
    const show = (e) => { const r = target.getBoundingClientRect(); Tip.show(e.clientX ?? r.left + r.width / 2, e.clientY ?? r.top, ...content()); };
    target.addEventListener('pointermove', show);
    target.addEventListener('pointerleave', () => Tip.hide());
    target.addEventListener('focus', () => { const r = target.getBoundingClientRect(); Tip.show(r.left + r.width / 2, r.top, ...content()); });
    target.addEventListener('blur', () => Tip.hide());
    if (!target.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT)$/.test(target.tagName)) target.setAttribute('tabindex', '0');
  },
};
const tipRow = (value, label, color) => h('div', null, color ? h('span', { class: 'key', style: { background: color } }) : null, h('span', { class: 'tv' }, value), ' ', h('span', { class: 'tk' }, label));
const tipText = (t) => h('div', { class: 'tk', style: { marginTop: '2px' } }, t);

/* Segmented toggle. options: [{value,label}] */
function segmented(options, value, onChange, extraClass = '') {
  const wrap = h('div', { class: `seg ${extraClass}`, role: 'group' });
  const render = () => wrap.replaceChildren(...options.map((o) => h('button', { type: 'button', 'aria-pressed': String(o.value === value), onclick: () => { value = o.value; render(); onChange(value); } }, o.label)));
  render();
  return wrap;
}
/* Tabs. */
function tabs(items, selected, onChange) {
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  const render = () => bar.replaceChildren(...items.map((it) => h('button', { role: 'tab', type: 'button', 'aria-selected': String(it.value === selected), tabindex: it.value === selected ? '0' : '-1', onclick: () => { selected = it.value; render(); onChange(selected); } }, it.label)));
  bar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = items.findIndex((it) => it.value === selected); const n = items[(i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length];
    selected = n.value; render(); onChange(selected); bar.querySelector('[aria-selected="true"]').focus();
  });
  render();
  return bar;
}

/* Card with the F2 anatomy. */
function card({ title, scope, info, expand, body, foot, dense }) {
  const head = h('div', { class: 'card-h' }, h('div', { class: 't-card' }, title), scope ? h('span', { class: 'scope' }, scope) : null);
  if (info) { const b = h('button', { class: 'icon-btn', type: 'button', 'aria-label': `About ${title}` }, 'ⓘ'); Tip.bind(b, () => [h('div', { style: { maxWidth: '240px' } }, info)]); head.append(b); }
  if (expand) head.append(h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Expand ${title}`, onclick: expand }, '⤢'));
  return h('section', { class: 'card' }, head, h('div', { class: `card-b${dense ? ' dense' : ''}` }, body), foot ? h('div', { class: 'card-f' }, foot) : null);
}

/* Drill-down side panel. */
const Drill = {
  open(title, subtitle, body) {
    if (!this.panel) {
      this.scrim = h('div', { class: 'scrim', onclick: () => this.close() });
      this.titleEl = h('div', { class: 't-title' }); this.subEl = h('div', { class: 't-label' });
      this.bodyEl = h('div', { class: 'panel-b' });
      this.panel = h('aside', { class: 'panel', role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'panel-h' }, h('div', { style: { flex: 1 } }, this.titleEl, this.subEl), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => this.close() }, '✕')), this.bodyEl);
      document.body.append(this.scrim, this.panel);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    }
    this.titleEl.textContent = title; this.subEl.textContent = subtitle || '';
    this.bodyEl.replaceChildren(body);
    this.scrim.classList.add('on'); this.panel.classList.add('on');
    this.panel.querySelector('.icon-btn').focus();
  },
  close() { this.scrim?.classList.remove('on'); this.panel?.classList.remove('on'); },
};

/* Sortable data table. columns: [{key,label,num,fmt,sort}] */
function dataTable(columns, rows, { onRow, sortKey, desc = true } = {}) {
  const table = h('table', { class: 'dt' });
  const thead = h('thead'); const tbody = h('tbody');
  const render = () => {
    const col = columns.find((c) => c.key === sortKey);
    const sorted = col ? [...rows].sort((a, b) => { const va = a[col.key], vb = b[col.key]; if (va == null) return 1; if (vb == null) return -1; return (va > vb ? 1 : va < vb ? -1 : 0) * (desc ? -1 : 1); }) : rows;
    thead.replaceChildren(h('tr', null, ...columns.map((c) => {
      const th = h('th', { class: c.num ? 'n' : '', 'data-sort': c.sort === false ? null : c.key, scope: 'col', 'aria-sort': c.key === sortKey ? (desc ? 'descending' : 'ascending') : null, tabindex: c.sort === false ? null : '0' }, c.label, h('span', { class: 'arr' }, c.key === sortKey && !desc ? '▲' : '▼'));
      if (c.sort !== false) { const go = () => { if (sortKey === c.key) desc = !desc; else { sortKey = c.key; desc = true; } render(); }; th.addEventListener('click', go); th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }); }
      return th;
    })));
    tbody.replaceChildren(...sorted.map((r) => {
      const tr = h('tr', { class: onRow ? 'clickable' : '', tabindex: onRow ? '0' : null });
      if (onRow) { tr.addEventListener('click', () => onRow(r)); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') onRow(r); }); }
      for (const c of columns) { const v = c.render ? c.render(r) : c.fmt ? c.fmt(r[c.key], r) : r[c.key]; tr.append(h('td', { class: c.num ? 'n' : '' }, v ?? '—')); }
      return tr;
    }));
  };
  table.append(thead, tbody); render();
  return h('div', { class: 'tbl-wrap' }, table);
}

/* Avatar: photo / logo with a silhouette-on-team-color fallback, never initials. */
function avatar(url, size, { logo = false, color, label } = {}) {
  const box = h('span', { class: `av${logo ? ' logo' : ''}`, style: { width: `${size}px`, height: `${size}px`, '--team': color || 'oklch(62% 0.01 260)' }, role: 'img', 'aria-label': label || '' });
  const sil = () => box.replaceChildren(s('svg', { class: 'sil', viewBox: '0 0 24 24' }, s('path', { d: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.3-8 5.2V21h16v-1.8c0-2.9-3.6-5.2-8-5.2Z' })));
  if (url) { const img = h('img', { src: url, alt: '', loading: 'lazy' }); img.addEventListener('error', sil); box.append(img); } else sil();
  return box;
}

/* Percentile bar row (Savant-style). direction: 'up' higher is better. */
function pbar(label, valueText, pct, { info } = {}) {
  const color = pct >= 50 ? `color-mix(in srgb, var(--good) ${Math.round(30 + (pct - 50) * 1.4)}%, oklch(70% 0.004 260))` : `color-mix(in srgb, var(--bad) ${Math.round(30 + (50 - pct) * 1.4)}%, oklch(70% 0.004 260))`;
  const row = h('div', { class: 'pbar' },
    h('div', { class: 't-sm ink2' }, label),
    h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: `${pct}%`, background: `color-mix(in oklch, ${color} 35%, transparent)` } }), h('div', { class: 'dot', style: { left: `${pct}%`, background: color } }, String(pct))),
    h('div', { class: 't-sm num', style: { textAlign: 'right', fontWeight: 600 } }, valueText));
  Tip.bind(row, () => [tipRow(valueText, label), tipText(`${fmt.ord(pct)} percentile${info ? ` · ${info}` : ''}`)]);
  return row;
}

/* Number tween for live values. */
function tween(el, to, { from, d = 0, ms = 400 } = {}) {
  const start = from ?? Number(el.dataset.v ?? to); const t0 = performance.now();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const step = (t) => { const k = reduce ? 1 : Math.min(1, (t - t0) / ms); const v = start + (to - start) * (1 - Math.pow(1 - k, 3)); el.textContent = fmt.n(v, d); if (k < 1) requestAnimationFrame(step); };
  el.dataset.v = to; requestAnimationFrame(step);
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

/* Line chart with snapping crosshair. series: [{name,color,values:[number|null], width, dash, area}] */
function lineChartDraw(__W, { series, labels, height = 220, yMin, yMax, yTicks = 4, yFmt = (v) => fmt.n(v), refs = [], markers = [], tooltip, onClick, band }) {
  const W = __W, H = height, m = { l: 40, r: 14, t: 12, b: 26 };
  const n = labels.length;
  const all = series.flatMap((se) => se.values).filter((v) => v != null);
  const lo = yMin ?? Math.min(...all), hi = yMax ?? Math.max(...all);
  const x = (i) => m.l + (n <= 1 ? 0 : (i * (W - m.l - m.r)) / (n - 1));
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo || 1)) * (H - m.t - m.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  if (band) svg.append(s('rect', { x: m.l, y: y(band.to), width: W - m.l - m.r, height: Math.max(0, y(band.from) - y(band.to)), fill: band.fill }));
  for (let k = 0; k <= yTicks; k++) { const v = lo + ((hi - lo) * k) / yTicks; svg.append(s('line', { class: 'grid-l', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }), s('text', { class: 'axis-t', x: m.l - 6, y: y(v) + 3, 'text-anchor': 'end' }, yFmt(v))); }
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 90))));
  const sparse = labels.filter(Boolean).length <= 12;
  labels.forEach((lb, i) => { if (!lb) return; if (sparse || i % every === 0 || i === n - 1) svg.append(s('text', { class: 'axis-t', x: x(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, lb)); });
  for (const r of refs) svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(r.y), y2: y(r.y), stroke: 'var(--ink-muted)', 'stroke-width': 1, 'stroke-dasharray': r.dash ? '4 4' : null }), r.label ? s('text', { class: 'axis-t', x: W - m.r, y: y(r.y) - 4, 'text-anchor': 'end' }, r.label) : null);
  for (const se of series) {
    let d = ''; se.values.forEach((v, i) => { if (v == null) return; d += `${d && se.values[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; });
    if (se.area) { const first = se.values.findIndex((v) => v != null); const last = se.values.length - 1 - [...se.values].reverse().findIndex((v) => v != null); svg.append(s('path', { d: `${d}L${x(last)},${y(se.area)}L${x(first)},${y(se.area)}Z`, fill: se.color, opacity: 0.1 })); }
    svg.append(s('path', { d, fill: 'none', stroke: se.color, 'stroke-width': se.width || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': se.dash || null, opacity: se.opacity || 1 }));
    if (se.dots) se.values.forEach((v, i) => { if (v != null) svg.append(s('circle', { cx: x(i), cy: y(v), r: 2.2, fill: se.color, opacity: 0.55 })); });
  }
  for (const mk of markers) svg.append(s('circle', { cx: x(mk.i), cy: y(mk.y), r: 5, fill: mk.color || 'var(--ink)', stroke: 'var(--card)', 'stroke-width': 2 }));
  const xh = s('line', { class: 'xh', x1: 0, x2: 0, y1: m.t, y2: H - m.b });
  const focusDots = series.map((se) => s('circle', { r: 4.5, fill: se.color, stroke: 'var(--card)', 'stroke-width': 2, opacity: 0 }));
  svg.append(xh, ...focusDots);
  const hit = s('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent', style: onClick ? 'cursor:pointer' : null });
  svg.append(hit);
  const wrap = h('div', { class: 'chart', tabindex: '0', 'aria-label': 'Chart: use left and right arrows to read values' }, svg);
  let cur = -1;
  const setIdx = (i, cx, cy) => {
    cur = Math.max(0, Math.min(n - 1, i));
    xh.setAttribute('x1', x(cur)); xh.setAttribute('x2', x(cur)); xh.style.opacity = 0.35;
    series.forEach((se, k) => { const v = se.values[cur]; focusDots[k].setAttribute('opacity', v == null ? 0 : 1); if (v != null) { focusDots[k].setAttribute('cx', x(cur)); focusDots[k].setAttribute('cy', y(v)); } });
    if (tooltip) Tip.show(cx, cy, ...tooltip(cur));
  };
  hit.addEventListener('pointermove', (e) => { const r = svg.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setIdx(Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1)), e.clientX, e.clientY); });
  hit.addEventListener('pointerleave', () => { Tip.hide(); focusDots.forEach((d) => d.setAttribute('opacity', 0)); xh.style.opacity = 0; });
  if (onClick) hit.addEventListener('click', () => cur >= 0 && onClick(cur));
  wrap.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return; e.preventDefault();
    if (e.key === 'Enter') { if (onClick && cur >= 0) onClick(cur); return; }
    const r = svg.getBoundingClientRect(); const i = cur < 0 ? n - 1 : cur + (e.key === 'ArrowRight' ? 1 : -1);
    setIdx(i, r.left + (x(Math.max(0, Math.min(n - 1, i))) / W) * r.width, r.top + 20);
  });
  wrap.addEventListener('blur', () => Tip.hide());
  return wrap;
}

/* Column chart, one mark per value; the mark is the hit target. */
function columnChartDraw(__W, { bars, height = 180, yFmt = (v) => fmt.n(v), refs = [], tooltip, onClick, labelEvery }) {
  const W = __W, H = height, m = { l: 36, r: 8, t: 10, b: 24 };
  const hi = Math.max(...bars.map((b) => b.value), ...refs.map((r) => r.y)) * 1.05 || 1;
  const band = (W - m.l - m.r) / bars.length; const bw = Math.min(24, band - 2);
  const y = (v) => m.t + (1 - v / hi) * (H - m.t - m.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  for (let k = 0; k <= 3; k++) { const v = (hi * k) / 3; svg.append(s('line', { class: 'grid-l', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }), s('text', { class: 'axis-t', x: m.l - 6, y: y(v) + 3, 'text-anchor': 'end' }, yFmt(v))); }
  const every = labelEvery || Math.max(1, Math.ceil(bars.length / 10));
  bars.forEach((b, i) => {
    const cx = m.l + band * i + band / 2; const top = y(b.value); const hgt = Math.max(0, H - m.b - top);
    const r = Math.min(4, bw / 2, hgt);
    const path = `M${cx - bw / 2},${H - m.b}V${top + r}q0,-${r} ${r},-${r}h${bw - 2 * r}q${r},0 ${r},${r}V${H - m.b}Z`;
    const g = s('g', { tabindex: '0', style: onClick ? 'cursor:pointer' : null });
    g.append(s('rect', { x: cx - band / 2, y: m.t, width: band, height: H - m.t - m.b, fill: 'transparent' }), s('path', { d: path, fill: b.color || 'var(--ink)', class: 'bar' }));
    g.addEventListener('pointermove', (e) => { g.querySelector('.bar').setAttribute('opacity', 0.75); tooltip && Tip.show(e.clientX, e.clientY, ...tooltip(b, i)); });
    g.addEventListener('pointerleave', () => { g.querySelector('.bar').setAttribute('opacity', 1); Tip.hide(); });
    g.addEventListener('focus', () => { const rr = g.getBoundingClientRect(); tooltip && Tip.show(rr.left + rr.width / 2, rr.top, ...tooltip(b, i)); });
    g.addEventListener('blur', () => Tip.hide());
    if (onClick) { g.addEventListener('click', () => onClick(b, i)); g.addEventListener('keydown', (e) => { if (e.key === 'Enter') onClick(b, i); }); }
    svg.append(g);
    if (b.label && i % every === 0) svg.append(s('text', { class: 'axis-t', x: cx, y: H - 8, 'text-anchor': 'middle' }, b.label));
  });
  for (const r of refs) svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(r.y), y2: y(r.y), stroke: 'var(--ink-muted)', 'stroke-dasharray': '4 4' }), s('text', { class: 'axis-t', x: W - m.r, y: y(r.y) - 4, 'text-anchor': 'end' }, r.label || ''));
  return h('div', { class: 'chart' }, svg);
}

/* Board chrome: title, notes, typeface + elevation switchers (persisted per viewer). */
function boardBar(title, note, extra = []) {
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } return null; };
  const apply = () => {
    document.body.classList.remove('font-inter', 'font-plex', 'font-source', 'elev-flat');
    const f = store('g-font') || 'system'; if (f !== 'system') document.body.classList.add(`font-${f}`);
    if ((store('g-elev') || 'raised') === 'flat') document.body.classList.add('elev-flat');
  };
  apply();
  const fontSeg = segmented([{ value: 'system', label: 'System' }, { value: 'inter', label: 'Inter' }, { value: 'plex', label: 'IBM Plex Sans' }, { value: 'source', label: 'Source Sans 3' }], store('g-font') || 'system', (v) => { store('g-font', v); apply(); });
  const elevSeg = segmented([{ value: 'raised', label: 'Cards raised' }, { value: 'flat', label: 'Flat + borders' }], store('g-elev') || 'raised', (v) => { store('g-elev', v); apply(); });
  return h('div', { class: 'board-bar' }, h('div', { class: 'inner' },
    h('div', null, h('div', { class: 'title' }, title), h('div', { class: 'note' }, note)),
    h('div', { style: { flex: 1 } }),
    ...extra,
    h('div', { class: 'row' }, h('span', { class: 'note' }, 'Typeface'), Object.assign(fontSeg, { className: 'seg' })),
    h('div', { class: 'row' }, h('span', { class: 'note' }, 'Elevation'), Object.assign(elevSeg, { className: 'seg' }))));
}

function lineChart(opts) {
  const host = h('div', { class: 'chart-host' });
  let last = 0;
  const draw = (w) => { const W = Math.max(280, Math.round(w)); if (Math.abs(W - last) < 8) return; last = W; host.replaceChildren(lineChartDraw(W, opts)); };
  const ro = new ResizeObserver((entries) => draw(entries[0].contentRect.width));
  ro.observe(host);
  requestAnimationFrame(() => draw(host.clientWidth || 720));
  return host;
}

function columnChart(opts) {
  const host = h('div', { class: 'chart-host' });
  let last = 0;
  const draw = (w) => { const W = Math.max(280, Math.round(w)); if (Math.abs(W - last) < 8) return; last = W; host.replaceChildren(columnChartDraw(W, opts)); };
  const ro = new ResizeObserver((entries) => draw(entries[0].contentRect.width));
  ro.observe(host);
  requestAnimationFrame(() => draw(host.clientWidth || 720));
  return host;
}
