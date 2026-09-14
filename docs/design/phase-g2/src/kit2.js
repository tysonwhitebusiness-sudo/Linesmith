/* Phase G2 kit additions: data helpers, the kept prop analysis block, research sections. */

const U = {
  sum: (a) => a.reduce((s, v) => s + (Number(v) || 0), 0),
  avg: (a) => { const v = a.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; },
  rolling: (a, w) => a.map((_, i) => (i + 1 < Math.min(w, 3) ? null : U.avg(a.slice(Math.max(0, i - w + 1), i + 1)))),
  groupBy: (a, f) => a.reduce((m, x) => { const k = f(x); (m[k] = m[k] || []).push(x); return m; }, {}),
  st: (g, k) => { const v = g.stats ? g.stats[k] : undefined; return v == null ? null : Number(v); },
  pct: (n, d, digits = 1) => (d ? Number(((100 * n) / d).toFixed(digits)) : null),
  day: (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00`),
  shortDate: (iso) => U.day(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  longDate: (iso) => U.day(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  ago: (iso, now = '2026-09-14T02:00:00Z') => { const h = Math.max(0, (new Date(now) - new Date(iso)) / 3.6e6); return h < 1 ? 'just now' : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`; },
  american: (p) => (p == null ? '—' : p > 0 ? `+${p}` : String(p)),
  score: (g) => (g.score != null ? g.score : `${g.pf}-${g.pa}`),
  seasonLabel: (sport, s) => (['nba', 'nhl', 'soccer', 'soccer_epl'].includes(sport) ? `${s}-${String(s + 1).slice(2)}` : String(s)),
};

function section(id, title, sub, ...kids) {
  return h('section', { id: `sec-${id}`, class: 'psec', 'data-sec': id },
    h('div', { class: 'psec-h' }, h('h2', { class: 't-title' }, title), sub ? h('span', { class: 't-label' }, sub) : null),
    h('div', { class: 'stack' }, ...kids));
}

function selectBox(options, value, onChange, label) {
  const sel = h('select', { class: 'sel', 'aria-label': label || 'Select', onchange: (e) => onChange(e.target.value) }, ...options.map((o) => h('option', { value: o.value, selected: o.value === value ? true : null }, o.label)));
  return sel;
}

function statGrid(items) {
  return h('div', { class: 'statgrid' }, ...items.map((it) => {
    const el = h('div', { class: 'tile stat' }, h('div', { class: 'l' }, it.label), h('div', { class: 'v' }, it.value ?? '—'), it.sub ? h('div', { class: 't-label' }, it.sub) : null);
    if (it.info) Tip.bind(el, () => [tipRow(String(it.value ?? '—'), it.label), tipText(it.info)]);
    return el;
  }));
}

function factList(pairs) {
  return h('dl', { class: 'facts' }, ...pairs.filter(([, v]) => v != null && v !== '').flatMap(([k, v]) => [h('dt', null, k), h('dd', null, String(v))]));
}

function vizLegend(items) { return h('div', { class: 'viz-legend' }, ...items.map(([label, color, dash]) => h('span', null, h('i', { style: dash ? { background: 'transparent', border: `2px dashed ${color}`, borderRadius: '2px', width: '12px', height: '0', verticalAlign: '3px' } : { background: color, borderRadius: '2px' } }), label))); }

function statusPill(text) { return h('span', { class: 'pill-note' }, text); }

/* THE KEPT BLOCK — market tabs, line stepper + price, window chips, hit-rate tiles, bars vs line. */
function propBlock({ sport, markets, periodLabel, onOpenGame, unitHint }) {
  const usable = markets.filter((m) => m.values.length);
  if (!usable.length) return card({ title: 'Prop analysis', body: h('div', { class: 'state' }, h('b', null, 'No per-game values for this player'), 'The page still renders the full profile below.') });
  const root = h('div', { class: 'prop' });
  let mk = (usable.find((m) => m.status === 'priced') || usable[0]).key;
  let line = null, win = 'l10', vsOpp = null;
  const draw = () => {
    const m = usable.find((x) => x.key === mk);
    const vals = m.values;
    const lastSeason = vals[vals.length - 1].season;
    if (line == null) line = m.line != null ? m.line : Math.max(0.5, Math.round((U.avg(vals.filter((v) => v.season === lastSeason).map((v) => v.v)) ?? 0) * 2) / 2 - 0.5);
    const opps = [...new Set(vals.map((v) => v.opp).filter(Boolean))];
    if (!vsOpp || !opps.includes(vsOpp)) vsOpp = (window.__cmpOppAbbr && opps.includes(window.__cmpOppAbbr)) ? window.__cmpOppAbbr : vals[vals.length - 1].opp || opps[0];
    const windows = [
      { key: 'opp', label: `vs ${vsOpp || '—'}`, rows: vals.filter((v) => v.opp === vsOpp) },
      { key: 'l5', label: 'Last 5', rows: vals.slice(-5) }, { key: 'l10', label: 'Last 10', rows: vals.slice(-10) }, { key: 'l15', label: 'Last 15', rows: vals.slice(-15) },
      { key: 'season', label: 'Season', rows: vals.filter((v) => v.season === lastSeason) }, { key: 'prev', label: U.seasonLabel(sport, lastSeason - 1), rows: vals.filter((v) => v.season === lastSeason - 1) },
    ];
    if (!opps.length) { windows.shift(); if (win === 'opp') win = 'l10'; }
    const hit = (rows) => rows.filter((r) => r.v > line).length;
    const tabsEl = tabs(usable.map((x) => ({ value: x.key, label: x.label })), mk, (v) => { mk = v; line = null; draw(); });
    const own = m.line != null && line === m.line;
    const stepper = h('div', { class: 'stepper' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Lower line', onclick: () => { line = Math.max(0.5, line - (line >= 20 ? 1 : 0.5)); draw(); } }, '−'),
      h('div', { class: 'line-v' }, h('span', { class: 't-label' }, own ? 'Line' : m.line != null ? 'Your line' : 'Your line (no line posted)'), h('b', { class: 'num' }, `O ${line}`)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Raise line', onclick: () => { line += line >= 20 ? 1 : 0.5; draw(); } }, '+'));
    const price = m.status === 'priced'
      ? h('div', { class: 'price' }, h('span', { class: 'chip' }, `Over ${U.american(m.over?.price)}`), m.under ? h('span', { class: 'chip' }, `Under ${U.american(m.under?.price)}`) : null, h('span', { class: 't-label' }, `${m.over?.book || ''} · best of ${m.books} books · ${U.ago(m.capturedAt)}`), m.line != null && !own ? h('button', { class: 'btn', type: 'button', onclick: () => { line = m.line; draw(); } }, `Reset to ${m.line}`) : null)
      : h('div', { class: 'price' }, statusPill(m.status === 'no line posted' ? 'No line posted for this market' : m.status));
    const cur = windows.find((w) => w.key === win) || windows[2];
    const chips = h('div', { class: 'row' }, ...windows.map((w) => h('button', { class: `wchip${w.key === win ? ' on' : ''}`, type: 'button', 'aria-pressed': String(w.key === win), onclick: () => { win = w.key; draw(); } }, w.label)),
      opps.length > 1 ? selectBox(opps.map((o) => ({ value: o, label: `vs ${o}` })), vsOpp, (v) => { vsOpp = v; win = 'opp'; draw(); }, 'Opponent') : null);
    const tiles = h('div', { class: `hit-tiles${windows.length === 5 ? ' n5' : ''}` }, ...windows.map((w) => {
      const n = w.rows.length, k = hit(w.rows), r = n ? Math.round((100 * k) / n) : null;
      const tone = r == null ? '' : r >= 60 ? 'good' : r <= 40 ? 'bad' : '';
      const el = h('button', { class: `hit-tile ${tone}${w.key === win ? ' on' : ''}`, type: 'button', onclick: () => { win = w.key; draw(); } },
        h('div', { class: 'hit-r num' }, r == null ? '—' : `${r}%`), h('div', { class: 't-label' }, w.label), h('div', { class: 'hit-bar' }, h('span', { style: { width: `${r ?? 0}%` } })), h('div', { class: 't-label num' }, n ? `${k} of ${n} · avg ${fmt.n(U.avg(w.rows.map((x) => x.v)), 1)}` : 'no games'));
      return el;
    }));
    const rows = cur.rows;
    const bars = columnChart({
      bars: rows.map((r) => ({ label: periodLabel(r), value: r.v, color: r.v > line ? 'var(--good)' : 'var(--bad)', r })),
      height: 210, refs: [{ y: line, label: `O ${line}` }], labelEvery: rows.length > 16 ? Math.ceil(rows.length / 12) : 1,
      yFmt: (v) => fmt.n(v, v < 10 && v % 1 ? 1 : 0),
      tooltip: (b) => [tipRow(fmt.n(b.value, b.value % 1 ? 1 : 0), `${m.label}${b.value > line ? ' · over' : ' · under'}`), tipText(`${b.r.home ? 'vs' : '@'} ${b.r.opp || '—'} · ${U.longDate(b.r.date)}`)],
      onClick: onOpenGame ? (b) => onOpenGame(b.r.date) : null,
    });
    put(root, 
      tabsEl,
      h('div', { class: 'prop-top' }, stepper, price),
      chips, tiles,
      card({ title: `${rows.length} games · ${cur.label}`, scope: `${U.seasonLabel(sport, rows[0]?.season ?? lastSeason)}${rows.length && rows[0].season !== rows[rows.length - 1].season ? `–${U.seasonLabel(sport, rows[rows.length - 1].season)}` : ''} · green cleared O ${line}`, info: 'Each bar is one game. Hover for opponent and date; click to open the game.', body: rows.length ? bars : h('div', { class: 'state' }, 'No games in this window'), dense: true }));
  };
  draw();
  return h('div', { class: 'card prop-card' }, h('div', { class: 'card-b' }, root));
}

/* Trend chart with a stat picker and a rolling average; optional compare series. */
function trendCard({ sport, games, stats, periodLabel, compare, title = 'Trends' }) {
  const wrap = h('div');
  let key = stats[0].key, w = 5, scope = 'last2';
  const draw = () => {
    const def = stats.find((x) => x.key === key);
    const seasons = [...new Set(games.map((g) => g.season))];
    const rows = scope === 'all' ? games : scope === 'last2' ? games.filter((g) => g.season >= seasons[seasons.length - 1] - 1) : games.filter((g) => g.season === seasons[seasons.length - 1]);
    const vals = rows.map((g) => def.fn(g));
    const series = [{ name: def.label, color: 'oklch(70% 0.004 260)', values: vals, width: 0.001, dots: true }, { name: `${w}-game avg`, color: 'var(--ink)', values: U.rolling(vals, w) }];
    let cmpRows = null;
    if (compare && compare.on) {
      cmpRows = compare.games.filter((g) => rows.length && g.date >= rows[0].date && g.date <= rows[rows.length - 1].date);
      const byDate = new Map(cmpRows.map((g) => [g.date, def.fn(g)]));
      series.push({ name: `${compare.name} ${w}-game avg`, color: 'var(--cmp-b)', values: U.rolling(rows.map((g) => byDate.get(g.date) ?? null), w) });
      series[1].color = 'var(--cmp-a)';
    }
    const seasonStart = rows.map((g, i) => (i === 0 || g.season !== rows[i - 1].season ? U.seasonLabel(sport, g.season) : ''));
    put(wrap, 
      h('div', { class: 'row', style: { marginBottom: '8px' } }, selectBox(stats.map((x) => ({ value: x.key, label: x.label })), key, (v) => { key = v; draw(); }, 'Stat'),
        segmented([{ value: 3, label: '3' }, { value: 5, label: '5' }, { value: 10, label: '10' }], w, (v) => { w = v; draw(); }), h('span', { class: 't-label' }, 'game average'),
        segmented([{ value: 'season', label: 'This season' }, { value: 'last2', label: 'Last 2' }, { value: 'all', label: 'All held' }], scope, (v) => { scope = v; draw(); }),
        compare ? h('button', { class: 'btn', type: 'button', onclick: () => { compare.on = !compare.on; draw(); } }, compare.on ? `Hide ${compare.name}` : `Compare ${compare.name}`) : null),
      compare && compare.on ? h('div', { class: 'legend row', style: { marginBottom: '6px' } }, h('span', { class: 'chip' }, h('span', { class: 'sw-dot', style: { background: 'var(--cmp-a)' } }), 'This player'), h('span', { class: 'chip' }, h('span', { class: 'sw-dot', style: { background: 'var(--cmp-b)' } }), compare.name)) : null,
      rows.length ? lineChart({ series, labels: seasonStart, height: 240, yMin: 0, yFmt: (v) => fmt.n(v, def.dec || 0),
        tooltip: (i) => [tipRow(fmt.n(vals[i], def.dec || 0), def.label), tipRow(fmt.n(series[1].values[i], 1), `${w}-game average`), tipText(`${periodLabel(rows[i])} · ${rows[i].home ? 'vs' : '@'} ${rows[i].oppAbbr || '—'}${rows[i].result ? ` · ${rows[i].result} ${U.score(rows[i])}` : ''}`)] }) : h('div', { class: 'state' }, 'No games'));
  };
  draw();
  return card({ title, scope: 'any stat · rolling average', info: 'Pick a stat; dots are single games, the line is the rolling average. Hover for the game.', body: wrap });
}

/* Season-by-season table: totals and per-game rates per sport-defined columns. */
function seasonTable({ sport, games, cols, extraRows = [] }) {
  const bySeason = U.groupBy(games, (g) => g.season);
  const rows = Object.keys(bySeason).sort().reverse().map((s) => { const gs = bySeason[s]; const r = { season: U.seasonLabel(sport, Number(s)), gp: gs.length }; for (const c of cols) r[c.key] = c.fn(gs); return r; });
  const career = { season: 'All held', gp: games.length }; for (const c of cols) career[c.key] = c.fn(games);
  return dataTable([{ key: 'season', label: 'Season' }, { key: 'gp', label: 'GP', num: true }, ...cols.map((c) => ({ key: c.key, label: c.label, num: true, fmt: (v) => (v == null ? '—' : typeof v === 'string' ? v : fmt.n(v, c.dec || 0)) }))], [...rows, career, ...extraRows], { sortKey: null });
}

/* Splits table: rows are situations, columns sport-defined per-game averages. */
function splitsTable({ games, cols, splits }) {
  const rows = splits.map((sp) => { const gs = games.filter(sp.f); const r = { split: sp.label, gp: gs.length }; for (const c of cols) r[c.key] = gs.length ? c.fn(gs) : null; return r; }).filter((r) => r.gp);
  return dataTable([{ key: 'split', label: 'Split' }, { key: 'gp', label: 'GP', num: true }, ...cols.map((c) => ({ key: c.key, label: c.label, num: true, fmt: (v) => (v == null ? '—' : typeof v === 'string' ? v : fmt.n(v, c.dec || 0)) }))], rows, { sortKey: null });
}

function standardSplits(games, sport) {
  const seasons = [...new Set(games.map((g) => g.season))];
  const cur = seasons[seasons.length - 1];
  const inScope = (g) => g.season === cur;
  const months = [...new Set(games.filter(inScope).map((g) => g.date.slice(0, 7)))];
  const rest = (g, i, arr) => { const prev = arr[i - 1]; return prev ? (U.day(g.date) - U.day(prev.date)) / 864e5 : null; };
  const withRest = games.map((g, i, arr) => ({ ...g, _rest: rest(g, i, arr) }));
  const tag = new Map(withRest.map((g) => [g.date + g.event, g._rest]));
  return [
    { label: `${U.seasonLabel(sport, cur)} · all`, f: inScope },
    { label: 'Home', f: (g) => inScope(g) && g.home }, { label: 'Away', f: (g) => inScope(g) && !g.home },
    { label: 'In wins', f: (g) => inScope(g) && g.result === 'W' }, { label: 'In losses', f: (g) => inScope(g) && g.result === 'L' },
    ...(['nba', 'nhl', 'mlb'].includes(sport) ? [{ label: 'No rest (back-to-back)', f: (g) => inScope(g) && tag.get(g.date + g.event) === 1 }, { label: '2+ days rest', f: (g) => inScope(g) && (tag.get(g.date + g.event) ?? 0) >= 2 }] : []),
    ...months.map((mo) => ({ label: U.day(`${mo}-15`).toLocaleDateString('en-US', { month: 'long' }), f: (g) => inScope(g) && g.date.startsWith(mo) })),
  ];
}

function gameLog({ sport, games, cols, periodLabel }) {
  const wrap = h('div');
  const seasons = [...new Set(games.map((g) => g.season))].sort((a, b) => b - a);
  let season = seasons[0];
  const open = (g) => Drill.open(`${g.home ? 'vs' : '@'} ${g.oppAbbr || g.opp || ''}`, `${U.longDate(g.date)}${g.result ? ` · ${g.result} ${U.score(g)}` : ''}`,
    h('div', { class: 'stack' }, factList(Object.entries(g.stats).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k.replace(/^(bat_|pit_|passing\.|rushing\.|receiving\.|defensive\.|kicking\.|punting\.|fumbles\.|interceptions\.)/, '').replace(/([A-Z])/g, ' $1').toLowerCase(), fmt.n(v, v % 1 ? 1 : 0)])),
      h('div', { class: 'callout' }, 'Full build: box score for both teams, this player\'s line against today\'s markets, and a link to the game page.')));
  const draw = () => {
    const rows = games.filter((g) => g.season === season).slice().reverse().map((g) => { const r = { _g: g, date: g.date, opp: g, res: g.result ? `${g.result} ${U.score(g)}` : '—' }; for (const c of cols) r[c.key] = c.fn(g); return r; });
    put(wrap, 
      h('div', { class: 'row', style: { marginBottom: '8px' } }, segmented(seasons.map((s) => ({ value: s, label: U.seasonLabel(sport, s) })), season, (v) => { season = v; draw(); })),
      dataTable([
        { key: 'date', label: 'Date', fmt: (v, r) => periodLabel(r._g) },
        { key: 'opp', label: 'Opp', sort: false, render: (r) => h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, h('span', { class: 't-label' }, r._g.home ? 'vs' : '@'), r._g.oppLogo ? avatar(r._g.oppLogo, 18, { logo: true, label: r._g.oppAbbr }) : null, h('span', null, r._g.oppAbbr || '—')) },
        { key: 'res', label: 'Result', render: (r) => h('span', { style: { color: r._g.result === 'W' ? 'var(--good)' : r._g.result === 'L' ? 'var(--bad)' : 'var(--ink-2)', fontWeight: 600 } }, r.res) },
        ...cols.map((c) => ({ key: c.key, label: c.label, num: true, fmt: (v) => (v == null ? '—' : typeof v === 'string' ? v : fmt.n(v, c.dec || 0)) })),
      ], rows, { sortKey: null, onRow: (r) => open(r._g) }));
  };
  draw();
  return card({ title: 'Game log', scope: 'every game held · click a row', dense: true, body: wrap });
}

function oddsCard(markets) {
  const priced = markets.filter((m) => m.status === 'priced');
  return card({ title: 'Odds & prices', scope: priced.length ? `${priced.length} priced markets` : 'none posted', dense: true,
    body: priced.length ? dataTable([{ key: 'label', label: 'Market' }, { key: 'line', label: 'Line', num: true }, { key: 'o', label: 'Best over', num: true, fmt: (v, r) => `${U.american(r.over?.price)} ${r.over?.book || ''}` }, { key: 'u', label: 'Best under', num: true, fmt: (v, r) => (r.under ? `${U.american(r.under.price)} ${r.under.book}` : '—') }, { key: 'books', label: 'Books', num: true }, { key: 'capturedAt', label: 'Updated', fmt: (v) => U.ago(v) }], priced, { sortKey: null })
      : h('div', { class: 'state' }, h('b', null, 'No prices posted'), 'Offseason, or no game on the slate. The research above doesn\'t depend on a line.'),
    foot: 'Line movement from prop_odds_history in the full build (5.2M rows held)' });
}

/* replaceChildren that skips null/false children (they would otherwise render as text). */
function put(el, ...kids) { el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false)); return el; }
