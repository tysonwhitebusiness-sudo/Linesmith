/* Shared game page modules. Each sport composes these with its own field model. */
const GAME_SPORTS = {};

const G = {
  teams: (doc) => doc.header.teams,
  away: (doc) => doc.header.teams[0],
  home: (doc) => doc.header.teams[1],
  team: (doc, id) => doc.header.teams.find((t) => String(t.id) === String(id)),
  numOf: (v) => { if (v == null) return null; const m = String(v).match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; },
  when: (iso) => { if (!iso) return ''; const d = new Date(iso.length === 8 ? `${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6, 8)}T12:00:00Z` : iso); return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', ...(iso.length > 10 ? { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' } : {}) }); },
  implied: (am) => { const o = Number(am); if (!o) return null; return o < 0 ? -o / (-o + 100) : 100 / (o + 100); },
  am: (v) => (v == null ? '—' : Number(v) > 0 ? `+${v}` : String(v)),
  sideColor: (i) => (i === 0 ? 'var(--cmp-a)' : 'var(--cmp-b)'),
};

const MARKET_LABELS = {
  'passing-yards': 'Pass yds', 'passing-tds': 'Pass TD', completions: 'Completions', 'passing-attempts': 'Pass att', interceptions: 'INT', 'rushing-yards': 'Rush yds', 'rushing-attempts': 'Rush att', 'receiving-yards': 'Rec yds', receptions: 'Receptions', 'longest-reception': 'Long rec', 'anytime-td': 'Anytime TD', 'rush-rec-yards': 'Rush+rec yds', 'pass-rush-yards': 'Pass+rush yds',
  'pass-attempts': 'Pass att', sacks: 'Sacks', tackles: 'Tackles', hits: 'Hits', 'total-bases': 'Total bases', 'home-runs': 'Home runs', rbis: 'RBIs', runs: 'Runs', walks: 'Walks', 'batter-strikeouts': 'Strikeouts', singles: 'Singles', doubles: 'Doubles', triples: 'Triples', 'stolen-bases': 'Stolen bases', 'hits-runs-rbis': 'H+R+RBI', 'pitcher-strikeouts': 'Pitcher Ks', 'pitcher-outs': 'Outs recorded', 'earned-runs': 'Earned runs', 'pitcher-hits-allowed': 'Hits allowed', 'pitcher-walks': 'Walks allowed',
  shots: 'Shots', 'shots-on-target': 'Shots on target', 'anytime-goalscorer': 'Goal', goals: 'Goals', assists: 'Assists', saves: 'Saves', 'goals-conceded': 'Goals conceded', tackles: 'Tackles', 'fouls-committed': 'Fouls',
};

/* Scoreboard hero: teams, score, status, linescore, result against the closing line. */
function gameHero(doc, { periods, extraCols = [], chips = [], sub } = {}) {
  const H = doc.header; const [a, hm] = H.teams;
  const side = (t, isHome) => h('div', { class: `team-side${isHome ? ' home' : ''}` },
    isHome ? null : avatar(t.logo, 60, { logo: true, label: t.name }),
    h('div', { style: { minWidth: 0 } }, h('a', { class: `lnk t-heading${t.winner ? ' won' : ''}`, href: '#team' }, t.name), h('div', { class: 't-label' }, [t.record, isHome ? 'Home' : 'Away'].filter(Boolean).join(' · '))),
    isHome ? avatar(t.logo, 60, { logo: true, label: t.name }) : null);
  const ls = a.lines && a.lines.length ? h('div', { class: 'ls-wrap' }, h('table', { class: 'ls-table' },
    h('thead', null, h('tr', null, h('th', null, ''), ...a.lines.map((_, i) => h('th', null, periods ? periods(i) : String(i + 1))), h('th', { class: 'tot' }, 'T'), ...extraCols.map((c) => h('th', null, c.label)))),
    h('tbody', null, ...[a, hm].map((t) => h('tr', null, h('td', null, h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, avatar(t.logo, 18, { logo: true, label: t.abbr }), h('b', null, t.abbr))), ...t.lines.map((v) => h('td', null, v ?? '—')), h('td', { class: 'tot' }, fmt.n(t.score)), ...extraCols.map((c) => h('td', null, c.value(t)))))))) : null;
  return h('section', { class: 'hero' },
    h('div', { class: 'score-hero' }, side(a, false),
      h('div', { style: { textAlign: 'center' } },
        h('div', { class: 'row', style: { justifyContent: 'center', marginBottom: '6px' } }, h('span', { class: 'chip' }, H.status || 'Final')),
        h('div', { class: 'score num' }, h('span', { class: a.winner ? '' : 'lose' }, fmt.n(a.score)), ' – ', h('span', { class: hm.winner ? '' : 'lose' }, fmt.n(hm.score))),
        h('div', { class: 't-label', style: { marginTop: '8px' } }, [G.when(H.date), H.venue, H.attendance ? `${fmt.n(H.attendance)} attendance` : null].filter(Boolean).join(' · ')),
        sub ? h('div', { class: 't-label', style: { marginTop: '2px' } }, sub) : null),
      side(hm, true)),
    chips.length ? h('div', { class: 'result-chips' }, ...chips) : null,
    ls);
}

/* Result against the closing line, from ESPN's pick center (open/close). */
function lineResultChips(doc) {
  const L = doc.lines; if (!L) return [];
  const [a, hm] = doc.header.teams; const out = [];
  const hs = L.pointSpread?.home?.close?.line; const tot = L.totalLine?.over?.close?.line;
  if (hs != null) {
    const line = G.numOf(hs); const margin = hm.score - a.score + line;
    out.push(h('span', { class: 'chip' },margin === 0 ? `Push on ${hm.abbr} ${hs}` : `${margin > 0 ? hm.abbr : a.abbr} covered (${hm.abbr} ${hs})`));
  }
  if (tot != null) { const t = G.numOf(tot); const sum = a.score + hm.score; out.push(h('span', { class: 'chip' }, sum === t ? `Total push ${t}` : `${sum > t ? 'Over' : 'Under'} ${t} (${sum})`)); }
  const fav = [a, hm].find((t) => G.numOf((t === a ? L.moneyline?.away : L.moneyline?.home)?.close?.odds) < 0);
  if (fav) out.push(h('span', { class: 'chip' }, fav.winner ? `Favorite ${fav.abbr} won` : `Underdog won (${fav.abbr} were favored)`));
  return out;
}

/* Win probability, ESPN-style: one series (home), a 50% midline, markers on scoring plays, swings list. */
function wpCard({ points, doc, title = 'Win probability', scope, foot, onPick, periodOf }) {
  const [a, hm] = doc.header.teams;
  if (!points.length) return null;
  const labels = points.map((p, i) => (i === 0 || periodOf(p) !== periodOf(points[i - 1]) ? periodOf(p) : ''));
  const values = points.map((p) => p.home * 100);
  const markers = points.map((p, i) => ({ p, i })).filter(({ p }) => p.scoring).map(({ p, i }) => ({ i, y: p.home * 100, color: 'var(--ink)' }));
  const swings = points.map((p, i) => ({ p, i, d: i ? p.home - points[i - 1].home : 0 })).filter((x) => x.p.swingable !== false).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 6);
  const chart = lineChart({ series: [{ name: `${hm.abbr} win probability`, color: 'var(--ink)', values, area: 50 }], labels, height: 250, yMin: 0, yMax: 100, yTicks: 4, yFmt: (v) => `${Math.round(v)}%`,
    refs: [{ y: 50, dash: true, label: '50%' }], markers,
    tooltip: (i) => [tipRow(`${(points[i].home * 100).toFixed(1)}%`, `${hm.abbr} win probability`), tipRow(`${((1 - points[i].home) * 100).toFixed(1)}%`, `${a.abbr}`), tipText(points[i].ctx), points[i].text ? tipText(points[i].text) : null].filter(Boolean),
    onClick: onPick ? (i) => onPick(points[i]) : null });
  const last = points[points.length - 1];
  const axisKey = h('div', { class: 'team-key' }, h('span', null, avatar(hm.logo, 18, { logo: true, label: hm.abbr }), `Top = ${hm.abbr} winning`), h('span', null, `Bottom = ${a.abbr} winning`, avatar(a.logo, 18, { logo: true, label: a.abbr })));
  const swingList = h('div', null, h('div', { class: 't-over', style: { margin: '4px 0 6px' } }, 'Biggest swings'), ...swings.map(({ p, d }) => { const favoured = d > 0 ? hm : a; const row = h('div', { class: 'swing', tabindex: '0', onclick: () => onPick && onPick(p) }, h('div', null, h('b', null, `${d > 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}`), h('div', { class: 't-label' }, favoured.abbr)), h('div', null, h('div', { class: 'ink2' }, p.text || p.ctx), h('div', { class: 't-label' }, p.ctx))); row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && onPick) onPick(p); }); return row; }));
  return card({ title, scope: scope || `${points.length} plays · click a point to jump to it`, info: 'The source’s own pre-snap/pre-pitch win probability for the home team, recalculated after every play.', body: h('div', { class: 'split-3-2' }, h('div', null, axisKey, chart), swingList), foot: foot || `Final: ${hm.abbr} ${(last.home * 100).toFixed(0)}% · markers are scoring plays` });
}

/* Two-sided team comparison bars. Each row: numbers either side, bar share in the middle. */
function teamCompare(doc, rows, { title = 'Team stats', scope = 'this game', lowerBetter = [] } = {}) {
  const [a, hm] = doc.header.teams;
  const body = h('div', null,
    h('div', { class: 'team-key' }, h('span', null, h('i', { class: 'sw-dot', style: { background: G.sideColor(0) } }), avatar(a.logo, 18, { logo: true, label: a.abbr }), a.abbr), h('span', null, hm.abbr, avatar(hm.logo, 18, { logo: true, label: hm.abbr }), h('i', { class: 'sw-dot', style: { background: G.sideColor(1) } }))),
    ...rows.filter((r) => r.away != null || r.home != null).map((r) => {
      const av = G.numOf(r.away), hv = G.numOf(r.home); const tot = (Math.abs(av) || 0) + (Math.abs(hv) || 0);
      const low = lowerBetter.includes(r.key);
      const lead = av == null || hv == null || av === hv ? null : (av > hv) !== low ? 0 : 1;
      const row = h('div', { class: 'cmp-row2' },
        h('div', { class: `v ${lead === 0 ? 'lead' : lead === 1 ? 'trail' : ''}` }, r.away ?? '—'),
        h('div', { class: 'cmp-mid' }, h('div', { class: 'lab' }, r.label), h('div', { class: 'cmp-bars2' }, h('div', null, h('span', { style: { width: `${tot ? (100 * Math.abs(av || 0)) / tot : 0}%`, background: G.sideColor(0) } })), h('div', null, h('span', { style: { width: `${tot ? (100 * Math.abs(hv || 0)) / tot : 0}%`, background: G.sideColor(1) } })))),
        h('div', { class: `v r ${lead === 1 ? 'lead' : lead === 0 ? 'trail' : ''}` }, r.home ?? '—'));
      Tip.bind(row, () => [tipRow(`${r.away ?? '—'} – ${r.home ?? '—'}`, r.label), tipText(low ? 'Lower is better' : lead == null ? 'Even' : `${(lead === 0 ? a : hm).abbr} ahead`)]);
      return row;
    }));
  return card({ title, scope, body });
}

/* ESPN box score: team switch, stat group tabs, one row per athlete. */
function espnBoxCard(doc, { groupLabels = {}, hideGroups = [] } = {}) {
  const [a, hm] = doc.header.teams; let team = hm.id, group = null;
  const wrap = h('div');
  const draw = () => {
    const tb = doc.box.find((b) => String(b.team) === String(team)) || doc.box[0];
    const groups = tb.groups.filter((g) => g.athletes.length && !hideGroups.includes(g.name));
    if (!groups.some((g) => g.name === group)) group = groups[0]?.name;
    const g = groups.find((x) => x.name === group);
    const cols = [{ key: 'name', label: 'Player', sort: false, render: (r) => h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '8px' } }, avatar(r.headshot, 26, { label: r.name }), h('span', null, h('a', { class: 'lnk', href: '#player' }, r.short || r.name), r.pos ? h('span', { class: 't-label' }, ` ${r.pos}`) : null, r.starter === false && groups.length === 1 ? h('span', { class: 't-label' }, ' · bench') : null)) },
      ...(g.labels || []).map((l, i) => ({ key: `c${i}`, label: l, num: true }))];
    const rows = g.athletes.map((at) => { const r = { ...at }; (at.stats || []).forEach((v, i) => { r[`c${i}`] = v; }); if (at.dnp) r.c0 = 'DNP'; return r; });
    if (g.totals && g.totals.some((x) => x)) { const t = { name: 'Team', short: 'Team', headshot: null }; g.totals.forEach((v, i) => { t[`c${i}`] = v; }); rows.push(t); }
    put(wrap, 
      h('div', { class: 'row', style: { marginBottom: '8px' } },
        segmented([a, hm].map((t) => ({ value: t.id, label: t.abbr })), team, (v) => { team = v; draw(); }),
        groups.length > 1 ? tabs(groups.map((x) => ({ value: x.name, label: groupLabels[x.name] || x.name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()) })), group, (v) => { group = v; draw(); }) : null),
      dataTable(cols, rows, { sortKey: null }));
  };
  draw();
  return card({ title: 'Box score', scope: 'click a column to sort', dense: true, body: wrap });
}

/* Lines: ESPN open/close, plus stored snapshots from game_odds_history (pre-game only). */
function linesCard(doc, { threeWay = false } = {}) {
  const L = doc.lines; const [a, hm] = doc.header.teams;
  const parts = [];
  if (L) {
    const rows = [
      { m: 'Moneyline', open: `${a.abbr} ${L.moneyline?.away?.open?.odds ?? '—'} · ${hm.abbr} ${L.moneyline?.home?.open?.odds ?? '—'}${threeWay && L.moneyline?.draw ? ` · Draw ${L.moneyline.draw.open?.odds ?? '—'}` : ''}`, close: `${a.abbr} ${L.moneyline?.away?.close?.odds ?? '—'} · ${hm.abbr} ${L.moneyline?.home?.close?.odds ?? '—'}${threeWay && L.moneyline?.draw ? ` · Draw ${L.moneyline.draw.close?.odds ?? '—'}` : ''}` },
      L.pointSpread?.home?.close?.line != null ? { m: threeWay ? 'Handicap' : 'Spread', open: `${hm.abbr} ${L.pointSpread.home.open?.line ?? '—'} (${L.pointSpread.home.open?.odds ?? '—'})`, close: `${hm.abbr} ${L.pointSpread.home.close?.line} (${L.pointSpread.home.close?.odds ?? '—'})` } : null,
      L.totalLine?.over?.close?.line != null ? { m: 'Total', open: `${L.totalLine.over.open?.line ?? '—'} (${L.totalLine.over.open?.odds ?? '—'})`, close: `${L.totalLine.over.close.line} (${L.totalLine.over.close.odds ?? '—'})` } : null,
    ].filter(Boolean);
    parts.push(dataTable([{ key: 'm', label: 'Market' }, { key: 'open', label: 'Open' }, { key: 'close', label: 'Close' }], rows, { sortKey: null }));
    parts.push(h('div', { class: 'result-chips', style: { justifyContent: 'flex-start' } }, ...lineResultChips(doc)));
  }
  const O = doc.odds; let movement = null;
  if (!L && O && O.rows.length) {
    // No pick-center feed (MLB): show the last stored pre-game quote per market, median across books.
    const pre = O.rows.filter((r) => !r[6]);
    const lastT = Math.max(...pre.map((r) => r[5]));
    const recent = pre.filter((r) => r[5] >= lastT - 3 * 3600);
    const isHome = (side) => /home/i.test(side) || [hm.name, hm.abbr, hm.short].includes(side);
    const med = (xs) => { const v = xs.filter((x) => x != null).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; };
    const q = (mk, f) => recent.filter((r) => r[0] === mk && f(r));
    const rows = [
      q('moneyline', () => true).length ? { m: 'Moneyline', v: `${a.abbr} ${G.am(med(q('moneyline', (r) => !isHome(r[1])).map((r) => r[3])))} · ${hm.abbr} ${G.am(med(q('moneyline', (r) => isHome(r[1])).map((r) => r[3])))}` } : null,
      q('spread', () => true).length ? { m: 'Run line', v: `${hm.abbr} ${fmt.n(med(q('spread', (r) => isHome(r[1])).map((r) => r[4])), 1)} (${G.am(med(q('spread', (r) => isHome(r[1])).map((r) => r[3])))})` } : null,
      q('total', () => true).length ? { m: 'Total', v: `${fmt.n(med(q('total', (r) => /over/i.test(r[1])).map((r) => r[4])), 1)} (over ${G.am(med(q('total', (r) => /over/i.test(r[1])).map((r) => r[3])))})` } : null,
    ].filter(Boolean);
    if (rows.length) {
      parts.push(dataTable([{ key: 'm', label: 'Market' }, { key: 'v', label: 'Last pre-game quote (median of books)' }], rows, { sortKey: null }));
      const tot = med(q('total', (r) => /over/i.test(r[1])).map((r) => r[4])); const rl = med(q('spread', (r) => isHome(r[1])).map((r) => r[4]));
      const chips = [];
      if (rl != null) { const m = hm.score - a.score + rl; chips.push(h('span', { class: 'chip' }, m === 0 ? 'Run line push' : `${m > 0 ? hm.abbr : a.abbr} covered the run line (${hm.abbr} ${rl > 0 ? '+' : ''}${rl})`)); }
      if (tot != null) { const sum = a.score + hm.score; chips.push(h('span', { class: 'chip' }, sum === tot ? `Total push ${tot}` : `${sum > tot ? 'Over' : 'Under'} ${tot} (${sum})`)); }
      parts.push(h('div', { class: 'result-chips', style: { justifyContent: 'flex-start' } }, ...chips));
    }
  }
  if (O && O.rows.length) {
    const pre = O.rows.filter((r) => !r[6]);
    const after = O.rows.length - pre.length;
    const markets = [...new Set(pre.map((r) => r[0]))];
    let mk = markets.includes('moneyline') ? 'moneyline' : markets[0];
    const host = h('div');
    const draw = () => {
      const rs = pre.filter((r) => r[0] === mk);
      const byT = U.groupBy(rs, (r) => Math.floor(r[5] / 1800) * 1800);
      const ts = Object.keys(byT).map(Number).sort((x, y) => x - y);
      const homeName = (side) => /home/i.test(side) || side === hm.name || side === hm.abbr || side === hm.short;
      let series, yFmt, note;
      if (mk === 'moneyline') {
        const vals = ts.map((t) => { const g = byT[t]; const hmP = U.avg(g.filter((r) => homeName(r[1])).map((r) => G.implied(r[3])).filter((v) => v != null)); const awP = U.avg(g.filter((r) => !homeName(r[1]) && !/draw/i.test(r[1])).map((r) => G.implied(r[3])).filter((v) => v != null)); const drP = threeWay ? U.avg(g.filter((r) => /draw/i.test(r[1])).map((r) => G.implied(r[3])).filter((v) => v != null)) : 0; return hmP != null && awP != null && drP != null ? (100 * hmP) / (hmP + awP + drP) : null; });
        const hasDraw = rs.some((r) => /draw/i.test(r[1]));
        if (threeWay && !hasDraw) {
          // Draw prices were not stored, so the vig can't be removed; show both raw implied probabilities.
          const raw = (f) => ts.map((t) => { const v = U.avg(byT[t].filter(f).map((r) => G.implied(r[3])).filter((x) => x != null)); return v == null ? null : 100 * v; });
          series = [{ name: `${a.abbr} implied %`, color: G.sideColor(0), values: raw((r) => !homeName(r[1])) }, { name: `${hm.abbr} implied %`, color: G.sideColor(1), values: raw((r) => homeName(r[1])) }];
          note = 'Raw implied probability (vig included): the draw price was not stored, so it can’t be removed';
        } else {
          series = [{ name: `${hm.abbr} implied win %`, color: 'var(--ink)', values: vals }];
          note = `${hm.abbr} implied probability, vig removed, averaged across books each half hour`;
        }
        const allV = series.flatMap((se) => se.values).filter((v) => v != null); const narrow = allV.length && Math.max(...allV) - Math.min(...allV) < 6; yFmt = (v) => `${fmt.n(v, narrow ? 1 : 0)}%`;
      } else {
        const vals = ts.map((t) => { const pts = byT[t].map((r) => r[4]).filter((v) => v != null); return pts.length ? U.avg(pts) : null; });
        series = [{ name: mk === 'total' ? 'Total' : `${hm.abbr} spread`, color: 'var(--ink)', values: vals }]; yFmt = (v) => fmt.n(v, 1); note = mk === 'total' ? 'Average posted total across books' : 'Average posted point across books (both sides, absolute)';
      }
      put(host, ...[
        markets.length > 1 ? segmented(markets.map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) })), mk, (v) => { mk = v; draw(); }) : null,
        series.length > 1 ? vizLegend(series.map((se) => [se.name, se.color])) : null,
        series[0].values.filter((v) => v != null).length > 1 ? lineChart({ series: series.map((x) => ({ ...x, dots: true })), labels: ts.map((t, i) => { const d = new Date(t * 1000); return i === 0 || d.getUTCDate() !== new Date(ts[i - 1] * 1000).getUTCDate() ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; }), height: 190, yFmt, tooltip: (i) => [...series.map((se) => tipRow(se.values[i] == null ? '—' : yFmt(se.values[i]), se.name, se.color)), tipText(`${new Date(ts[i] * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET · ${byT[ts[i]].length} quotes`)] }) : h('div', { class: 'state' }, 'One snapshot only — no movement to draw'),
        h('div', { class: 't-label' }, `${note}. ${pre.length} pre-game quotes stored${after ? ` · ${after} more were stored after the start and are left out` : ''}.`)].filter(Boolean));
    };
    draw();
    movement = host;
  }
  if (!parts.length && !movement) return card({ title: 'Game lines', body: h('div', { class: 'state' }, h('b', null, 'No lines held for this game'), 'The game predates odds capture.') });
  return card({ title: 'Game lines', scope: L ? `${L.provider || 'ESPN pick center'} open → close` : 'stored snapshots', body: h('div', { class: 'stack' }, ...parts, movement ? h('div', null, h('div', { class: 't-over', style: { margin: '6px 0' } }, 'Movement before the start (the app’s stored quotes)'), movement) : statusPill('Line movement not captured for this game')) });
}

/* Player props against what happened. resolve(prop) returns the player's actual number or null. */
function propsResultCard(doc, resolve) {
  const P = doc.props || [];
  if (!P.length) return card({ title: 'Player props vs results', body: h('div', { class: 'state' }, h('b', null, 'No player props captured for this game'), doc.odds ? 'Lines were stored for the game, but no player markets.' : 'The game predates the app’s odds capture.') });
  const rows = P.map((p) => { const v = resolve(p); return { ...p, label: MARKET_LABELS[p.market] || p.market, actual: v, res: v == null ? null : v > p.line ? 'Over' : v < p.line ? 'Under' : 'Push' }; });
  const markets = [...new Set(rows.map((r) => r.market))].sort((x, y) => rows.filter((r) => r.market === y).length - rows.filter((r) => r.market === x).length);
  let mk = 'all', limit = 20;
  rows.sort((x, y) => (x.res ? 0 : 1) - (y.res ? 0 : 1));
  const host = h('div');
  const draw = () => {
    const all = rows.filter((r) => mk === 'all' || r.market === mk); const rs = all.slice(0, limit);
    const settled = all.filter((r) => r.res);
    put(host, 
      h('div', { class: 'row', style: { marginBottom: '8px' } }, selectBox([{ value: 'all', label: `All markets (${rows.length})` }, ...markets.map((m) => ({ value: m, label: `${MARKET_LABELS[m] || m} (${rows.filter((r) => r.market === m).length})` }))], mk, (v) => { mk = v; limit = 20; draw(); }, 'Market'),
        h('span', { class: 't-label' }, settled.length ? `${settled.filter((r) => r.res === 'Over').length} over · ${settled.filter((r) => r.res === 'Under').length} under · ${all.length - all.filter((r) => r.res).length} not matched to the box score` : 'No results matched')),
      dataTable([
        { key: 'name', label: 'Player', render: (r) => h('a', { class: 'lnk', href: '#player' }, r.name) },
        { key: 'label', label: 'Market' },
        { key: 'line', label: 'Line', num: true, fmt: (v) => fmt.n(v, v % 1 ? 1 : 0) },
        { key: 'overPrice', label: 'Best over', num: true, render: (r) => (r.over ? h('span', null, G.am(r.over.price), h('span', { class: 't-label' }, ` ${r.over.book}`)) : '—') },
        { key: 'actual', label: 'Result', num: true, fmt: (v) => (v == null ? '—' : fmt.n(v, v % 1 ? 1 : 0)) },
        { key: 'res', label: '', sort: false, render: (r) => (r.res ? h('span', { class: `chip ${r.res === 'Over' ? 'good' : r.res === 'Under' ? 'bad' : ''}` }, r.res) : h('span', { class: 't-label' }, 'unmatched')) },
      ], rs, { sortKey: null }),
      all.length > limit ? h('button', { class: 'btn', type: 'button', style: { marginTop: '8px' }, onclick: () => { limit = all.length; draw(); } }, `Show all ${all.length}`) : null);
  };
  draw();
  return card({ title: 'Player props vs results', scope: 'last pre-game quote per book · main line', dense: true, body: host, foot: 'Green = the over cashed. The main line is the one priced closest to even; the price shown is the best over at that line.' });
}

/* Play-by-play list with filters. items: [{period, clock, text, key?, team?, tag?}] */
function playLogCard(doc, items, { periodName = (p) => `Q${p}`, title = 'Play-by-play', keyLabel = 'Scoring only' } = {}) {
  const periods = [...new Set(items.map((i) => i.period))];
  let per = 'all', keyOnly = false, limit = 60;
  const host = h('div');
  const draw = () => {
    const rs = items.filter((i) => (per === 'all' || i.period === per) && (!keyOnly || i.key)).slice().reverse();
    put(host, 
      h('div', { class: 'row', style: { marginBottom: '8px' } }, segmented([{ value: 'all', label: 'All' }, ...periods.map((p) => ({ value: p, label: periodName(p) }))], per, (v) => { per = v; limit = 60; draw(); }),
        h('button', { class: `wchip${keyOnly ? ' on' : ''}`, type: 'button', 'aria-pressed': String(keyOnly), onclick: () => { keyOnly = !keyOnly; draw(); } }, keyLabel), h('span', { class: 't-label' }, `${rs.length} plays`)),
      h('div', { class: 'scroll-list' }, ...rs.slice(0, limit).map((i) => { const t = i.team ? G.team(doc, i.team) : null; return h('div', { class: `play-row${i.key ? ' key' : ''}` }, h('div', { class: 't-label num' }, `${periodName(i.period)} ${i.clock || ''}`), h('div', { class: 'row', style: { flexWrap: 'nowrap', alignItems: 'flex-start' } }, t ? avatar(t.logo, 18, { logo: true, label: t.abbr }) : null, h('span', { class: 'ink2' }, i.text)), i.tag ? h('span', { class: 'score-tag' }, i.tag) : h('span')); }),
        rs.length > limit ? h('button', { class: 'btn', type: 'button', style: { marginTop: '8px' }, onclick: () => { limit += 100; draw(); } }, `Show ${Math.min(100, rs.length - limit)} more`) : null));
  };
  draw();
  return card({ title, scope: 'newest first', body: host });
}

function seasonSeriesCard(doc) {
  const S = doc.seasonSeries; if (!S || !S.events?.length) return null;
  return card({ title: 'Season series', scope: S.summary || '', dense: true, body: dataTable([{ key: 'date', label: 'Date', fmt: (v) => U.shortDate(v.slice(0, 10)) }, { key: 'res', label: 'Result' }], S.events.map((e) => ({ date: e.date, res: e.competitors.join(' · ') })), { sortKey: null }) });
}

function leadersCard(doc) {
  if (!doc.leaders?.length) return null;
  const rows = [];
  for (const t of doc.leaders) { const team = G.team(doc, t.team); for (const c of t.cats.slice(0, 3)) for (const l of c.leaders) rows.push(h('div', { class: 'leader' }, avatar(l.headshot, 36, { label: l.name }), h('div', { style: { minWidth: 0 } }, h('a', { class: 'lnk t-sm', href: '#player', style: { fontWeight: 600 } }, l.name), h('div', { class: 't-label' }, `${team?.abbr || ''} · ${c.name}`)), h('div', { class: 't-sm num ink2', style: { textAlign: 'right', maxWidth: '180px' } }, l.value))); }
  return card({ title: 'Game leaders', body: h('div', null, ...rows) });
}

function buildGameShell(doc, sections) {
  sections.push({ id: 'sources', label: 'Sources', node: section('sources', 'Sources', null, card({ title: 'Where this page comes from', dense: true, body: h('ul', { class: 't-sm ink2', style: { margin: 0, paddingLeft: '18px' } }, ...doc.sources.map((x) => h('li', null, x)), ...Object.entries(doc.status || {}).map(([k, v]) => h('li', null, `${k}: `, statusPill(v)))) })) });
  return sections;
}
