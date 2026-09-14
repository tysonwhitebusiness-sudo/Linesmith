/* Shared team page modules. A sport spec supplies season logic, columns and its own native section. */
const TEAM_SPORTS = {};

const T = {
  done: (games) => (games || []).filter((g) => g.done && g.result).sort((a, b) => a.date.localeCompare(b.date)),
  record: (games, ties, wdl) => { const w = games.filter((g) => g.result === 'W').length, l = games.filter((g) => g.result === 'L').length, d = games.filter((g) => g.result === 'D').length; return wdl ? `${w}-${d}-${l}` : ties || d ? `${w}-${l}-${d}` : `${w}-${l}`; },
  streak: (games) => { const gs = T.done(games); if (!gs.length) return null; const last = gs[gs.length - 1].result; let n = 0; for (let i = gs.length - 1; i >= 0 && gs[i].result === last; i--) n++; return `${last}${n}`; },
  ord: (n) => fmt.ord(n),
  pctile: (rank, of) => (of > 1 ? Math.round(100 * (1 - (rank - 1) / (of - 1))) : 50),
};

function teamHero(doc, spec, season, games) {
  const t = doc.team; const gs = T.done(games);
  const home = gs.filter((g) => g.home), away = gs.filter((g) => !g.home);
  const diff = U.sum(gs.map((g) => g.us - g.them));
  const nxt = t.next;
  const last10 = gs.slice(-10);
  return h('section', { class: 'hero' },
    h('div', { class: 'hero-p' },
      avatar(t.logo, 88, { logo: true, label: t.name }),
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'row', style: { gap: '10px' } }, h('div', { class: 't-heading' }, t.name), t.rank ? h('span', { class: 'chip' }, `AP No. ${t.rank}`) : null),
        h('div', { class: 't-sm ink2', style: { marginTop: '4px' } }, [season === Math.max(...Object.keys(doc.schedule).map(Number)) ? t.standing : `Final record ${T.record(gs, spec.ties, spec.wdl)}`, t.venue].filter(Boolean).join(' · ')),
        h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 't-label' }, `Last ${last10.length}`), h('span', { class: 'mini-form', style: { flexWrap: 'wrap' } }, ...last10.map((g) => { const el = h('span', { style: { background: g.result === 'W' ? 'var(--good)' : g.result === 'L' ? 'var(--bad)' : 'var(--ink-muted)' } }, g.result); Tip.bind(el, () => [tipRow(`${fmt.n(g.us)}–${fmt.n(g.them)}`, `${g.result} ${g.home ? 'vs' : '@'} ${g.opp.abbr}`), tipText(G.when(g.date))]); return el; })))),
      h('div', { class: 'stack', style: { minWidth: '240px' } },
        h('div', { class: 't-over' }, `${spec.seasonName(season)} season`),
        nxt ? h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '10px' } }, avatar(nxt.opp?.logo, 32, { logo: true, label: nxt.opp?.abbr }), h('div', null, h('div', { class: 't-sm', style: { fontWeight: 600 } }, `${nxt.completed ? 'Last' : 'Next'}: ${nxt.home ? 'vs' : '@'} ${nxt.opp?.name || '—'}`), h('div', { class: 't-label' }, `${G.when(nxt.date)}${nxt.venue ? ` · ${nxt.venue}` : ''}`))) : statusPill('No upcoming game'))),
    h('div', { style: { marginTop: 'var(--s4)', paddingTop: 'var(--s4)', borderTop: '1px solid var(--line-soft)' } }, statGrid([
      { label: 'Record', value: T.record(gs, spec.ties, spec.wdl), sub: spec.wdl ? 'W-D-L' : null }, { label: 'Home', value: T.record(home, spec.ties, spec.wdl) }, { label: 'Away', value: T.record(away, spec.ties, spec.wdl) },
      { label: spec.diffLabel, value: gs.length ? `${diff > 0 ? '+' : ''}${fmt.n(diff)}` : '—' }, { label: `${spec.unit} for / game`, value: gs.length ? fmt.n(U.avg(gs.map((g) => g.us)), 1) : '—' }, { label: `${spec.unit} against / game`, value: gs.length ? fmt.n(U.avg(gs.map((g) => g.them)), 1) : '—' },
      { label: 'Streak', value: T.streak(games) || '—' }, ...(spec.heroTiles ? spec.heroTiles(doc, season, gs) : []),
    ])));
}

/* Results: margin per game (bars) and running differential (line), with a schedule table. */
function resultsSection(doc, spec, season, games) {
  const gs = T.done(games); const upcoming = (games || []).filter((g) => !g.done).sort((a, b) => a.date.localeCompare(b.date));
  const bars = gs.length ? columnChart({ bars: gs.map((g) => ({ label: '', value: Math.abs(g.us - g.them) || 0.25, color: g.result === 'W' ? 'var(--good)' : g.result === 'L' ? 'var(--bad)' : 'var(--ink-muted)', g })), height: 180, labelEvery: 1000,
    tooltip: (b) => [tipRow(`${b.g.result} ${fmt.n(b.g.us)}–${fmt.n(b.g.them)}`, `${b.g.home ? 'vs' : '@'} ${b.g.opp.name}`), tipText(`${G.when(b.g.date)}${b.g.week ? ` · ${b.g.week}` : ''}${b.g.oppRank ? ` · opponent ranked No. ${b.g.oppRank}` : ''}`)] }) : h('div', { class: 'state' }, 'No completed games');
  let run = 0; const cum = gs.map((g) => (run += g.us - g.them));
  const line = gs.length > 1 ? lineChart({ series: [{ name: spec.diffLabel, color: 'var(--ink)', values: cum, area: 0 }], labels: gs.map((g, i) => { const d = new Date(g.date); return i === 0 || d.getMonth() !== new Date(gs[i - 1].date).getMonth() ? d.toLocaleDateString('en-US', { month: 'short' }) : ''; }), height: 180, refs: [{ y: 0, dash: true }],
    tooltip: (i) => [tipRow(`${cum[i] > 0 ? '+' : ''}${fmt.n(cum[i])}`, `${spec.diffLabel} after game ${i + 1}`), tipText(`${gs[i].result} ${gs[i].home ? 'vs' : '@'} ${gs[i].opp.abbr} ${fmt.n(gs[i].us)}–${fmt.n(gs[i].them)}`)] }) : null;

  const close = spec.closeMargin;
  const split = (label, f) => { const xs = gs.filter(f); return { split: label, gp: xs.length, rec: xs.length ? T.record(xs, spec.ties, spec.wdl) : '—', pf: xs.length ? U.avg(xs.map((g) => g.us)) : null, pa: xs.length ? U.avg(xs.map((g) => g.them)) : null, diff: xs.length ? U.avg(xs.map((g) => g.us - g.them)) : null }; };
  const months = [...new Set(gs.map((g) => new Date(g.date).toLocaleDateString('en-US', { month: 'long', timeZone: 'America/New_York' })))];
  const splitRows = [split('All games', () => true), split('Home', (g) => g.home), split('Away', (g) => !g.home), split(`Decided by ${close} or fewer`, (g) => Math.abs(g.us - g.them) <= close), split(`Decided by more than ${close}`, (g) => Math.abs(g.us - g.them) > close), ...(spec.extraSplits ? spec.extraSplits(gs) : []), ...(months.length > 2 ? months.map((m) => split(m, (g) => new Date(g.date).toLocaleDateString('en-US', { month: 'long', timeZone: 'America/New_York' }) === m)) : [])];

  const sched = dataTable([
    { key: 'date', label: 'Date', fmt: (v, r) => `${U.shortDate(v.slice(0, 10))}${r.week ? ` · ${r.week.replace('Week ', 'Wk ')}` : ''}` },
    { key: 'opp', label: 'Opponent', sort: false, render: (r) => h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, h('span', { class: 't-label' }, r.home ? 'vs' : '@'), avatar(r.opp.logo, 20, { logo: true, label: r.opp.abbr }), h('a', { class: 'lnk', href: '#team' }, r.opp.name), r.oppRank ? h('span', { class: 't-label' }, `No. ${r.oppRank}`) : null) },
    { key: 'res', label: 'Result', sort: false, render: (r) => (r.done ? h('span', { style: { fontWeight: 600, color: r.result === 'W' ? 'var(--good)' : r.result === 'L' ? 'var(--bad)' : 'var(--ink-2)' } }, `${r.result} ${fmt.n(r.us)}–${fmt.n(r.them)}`) : h('span', { class: 't-label' }, new Date(r.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET')) },
    { key: 'venue', label: 'Venue' },
  ], [...gs.slice().reverse(), ...upcoming], { sortKey: null });

  return section('results', 'Results & schedule', `${gs.length} played${upcoming.length ? ` · ${upcoming.length} to play` : ''}`,
    h('div', { class: 'split-2' }, card({ title: 'Margin by game', scope: 'green won · red lost · bar height = margin', body: bars }), line ? card({ title: `Running ${spec.diffLabel.toLowerCase()}`, body: line }) : card({ title: `Running ${spec.diffLabel.toLowerCase()}`, body: h('div', { class: 'state' }, 'Needs more than one game') })),
    h('div', { class: 'split-2' }, card({ title: 'Splits', scope: 'per game', dense: true, body: dataTable([{ key: 'split', label: 'Split' }, { key: 'gp', label: 'GP', num: true }, { key: 'rec', label: 'Record' }, { key: 'pf', label: `${spec.unitShort} for`, num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'pa', label: `${spec.unitShort} agst`, num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'diff', label: 'Diff', num: true, fmt: (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${fmt.n(v, 1)}`) }], splitRows.filter((r) => r.gp), { sortKey: null }) }),
      card({ title: 'Schedule', scope: 'newest results first, then upcoming', dense: true, body: h('div', { class: 'scroll-list', style: { maxHeight: '460px' } }, sched) })));
}

function standingsSection(doc, spec) {
  const S = doc.standings; if (!S) return null;
  const cols = spec.standingCols.filter((c) => S.rows.some((r) => r.stats[c.key] != null));
  const rows = S.rows.map((r) => ({ ...r, ...Object.fromEntries(cols.map((c) => [c.key, c.num ? G.numOf(r.stats[c.key]) : r.stats[c.key]])) }));
  const sortKey = spec.standingSort;
  const sorted = rows.sort((a, b) => spec.standingOrder(a, b));
  return section('standings', 'Standings', `${S.group} · ${S.season || ''}`, card({ title: S.group, scope: 'this team highlighted', dense: true, body: dataTable([
    { key: 'pos', label: '#', num: true, sort: false, render: (r) => String(sorted.indexOf(r) + 1) },
    { key: 'name', label: 'Team', sort: false, render: (r) => h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '8px', fontWeight: r.id === doc.team.id ? 700 : 400 } }, avatar(r.logo, 20, { logo: true, label: r.abbr }), h('a', { class: 'lnk', href: '#team' }, r.name), r.id === doc.team.id ? h('span', { class: 'chip' }, 'This team') : null) },
    ...cols.map((c) => ({ key: c.key, label: c.label, num: !!c.num, fmt: (v, r) => r.stats[c.key] ?? '—' })),
  ], sorted, { sortKey: null }), foot: sortKey ? null : 'Order as published by ESPN' }));
}

/* One ranked stat row: value, rank and a percentile track; with league values, a dot strip too. */
function rankRow({ label, display, rank, of, league, value, better }) {
  const p = rank && of ? T.pctile(rank, of) : null;
  const strip = league && league.length > 2 ? svgHost((W) => {
    const H = 18, lo = Math.min(...league), hi = Math.max(...league); const X = (v) => 6 + ((v - lo) / (hi - lo || 1)) * (W - 12);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${label} across the league` });
    svg.append(s('line', { x1: 6, x2: W - 6, y1: H / 2, y2: H / 2, stroke: 'var(--line)' }));
    for (const v of league) svg.append(s('circle', { cx: X(v), cy: H / 2, r: 3, fill: 'var(--ink-faint)' }));
    svg.append(s('circle', { cx: X(value), cy: H / 2, r: 6, fill: p >= 50 ? 'var(--good)' : 'var(--bad)', stroke: 'var(--card)', 'stroke-width': 2 }));
    return svg;
  }) : null;
  const row = h('div', { class: 'pbar', style: { gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1.6fr) 110px' } },
    h('div', { class: 't-sm ink2' }, label),
    strip || h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: `${p ?? 0}%`, background: `color-mix(in oklch, ${p >= 50 ? 'var(--good)' : 'var(--bad)'} 30%, transparent)` } }), p != null ? h('div', { class: 'dot', style: { left: `${p}%`, background: p >= 50 ? 'var(--good)' : 'var(--bad)' } }, String(rank)) : null),
    h('div', { class: 't-sm num', style: { textAlign: 'right' } }, h('b', null, display), rank ? h('span', { class: 't-label' }, ` · ${T.ord(rank)}${of ? `/${of}` : ''}`) : null));
  Tip.bind(row, () => [tipRow(display, label), tipText(rank ? `${T.ord(rank)} of ${of || '—'}${better === 'low' ? ' · lower is better' : ''}` : 'No league rank published'), league ? tipText(`League range ${fmt.n(Math.min(...league), 1)} – ${fmt.n(Math.max(...league), 1)}`) : null].filter(Boolean));
  return row;
}

/* ESPN core stats (published ranks) for a curated list: [[category, stat, label, 'total'|'perGame']] */
function espnRankedCard(doc, season, title, list, of) {
  const cats = (doc.stats || {})[String(season)]; if (!cats) return card({ title, body: h('div', { class: 'state' }, 'Not available for this season') });
  const find = (cat, name) => cats.find((c) => c.name === cat)?.stats.find((x) => x[0] === name);
  const rows = list.map(([cat, name, label, mode]) => { const st = find(cat, name); if (!st) return null; return rankRow({ label, display: mode === 'perGame' && st[3] ? st[3] : st[2], rank: st[4], of }); }).filter(Boolean);
  return card({ title, scope: `${season} · rank of ${of}`, body: rows.length ? h('div', null, ...rows) : h('div', { class: 'state' }, 'No stats') });
}

/* Roster production from player_game_history totals. cols: [{key,label,fn(p),dec}] */
function rosterCard(doc, season, groups, { title = 'Roster production', note } = {}) {
  const ps = (doc.players || {})[String(season)] || [];
  let g = groups[0].id; const host = h('div');
  const draw = () => {
    const grp = groups.find((x) => x.id === g);
    const rows = ps.filter((p) => grp.filter(p)).map((p) => { const r = { p, name: p.name, games: p.games }; for (const c of grp.cols) r[c.key] = c.fn(p); return r; });
    put(host, groups.length > 1 ? h('div', { class: 'row', style: { marginBottom: '8px' } }, tabs(groups.map((x) => ({ value: x.id, label: x.label })), g, (v) => { g = v; draw(); })) : null,
      dataTable([{ key: 'name', label: 'Player', render: (r) => h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '8px' } }, avatar(r.p.headshot, 28, { label: r.p.name, color: doc.team.color }), h('span', null, h('a', { class: 'lnk', href: '#player' }, r.p.name), r.p.pos ? h('span', { class: 't-label' }, ` ${r.p.pos}`) : null)) }, { key: 'games', label: 'G', num: true },
        ...grp.cols.map((c) => ({ key: c.key, label: c.label, num: true, fmt: (v) => (v == null ? '—' : fmt.n(v, c.dec || 0)) }))], rows, { sortKey: grp.sort || grp.cols[0].key }));
  };
  draw();
  return card({ title, scope: `${season} · from the app's game logs · click a column to sort`, dense: true, body: host, foot: note });
}

function buildTeamPage(doc, spec, season) {
  const games = doc.schedule[String(season)] || [];
  const sections = [
    { id: 'results', label: 'Results', node: resultsSection(doc, spec, season, games) },
    ...(doc.standings ? [{ id: 'standings', label: 'Standings', node: standingsSection(doc, spec) }] : []),
    { id: 'stats', label: 'Team stats', node: section('stats', 'Team stats', 'league rank for each', spec.statsNode(doc, season)) },
    { id: 'roster', label: 'Roster', node: section('roster', 'Roster production', null, spec.rosterNode(doc, season)) },
    ...(spec.native ? spec.native(doc, season) : []),
    { id: 'sources', label: 'Sources', node: section('sources', 'Sources', null, card({ title: 'Where this page comes from', dense: true, body: h('ul', { class: 't-sm ink2', style: { margin: 0, paddingLeft: '18px' } }, ...doc.sources.map((x) => h('li', null, x)), ...Object.entries(doc.status || {}).map(([k, v]) => h('li', null, `${k}: `, statusPill(v)))) })) },
  ].filter((x) => x.node);
  return { hero: teamHero(doc, spec, season, games), sections };
}
