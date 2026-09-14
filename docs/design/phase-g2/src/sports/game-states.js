/* Game page states: before start (research, as of kickoff), live (the real game cut at a chosen moment), final (recap + the research as it stood at kickoff). */
(() => {
  const MATCHUP_FILE = { nfl: 'nfl', cfb: 'cfb', nba: 'nba', nhl: 'nhl', mlb: 'mlb', soccer: 'soccer', tennis: 'tennis' };
  const matchup = (sport) => loadData(`matchup-${MATCHUP_FILE[sport]}`);
  const shortDay = (d) => U.shortDate(String(d).slice(0, 10));
  const pctOfRank = (rank, of) => (of > 1 ? Math.round(100 * (1 - (rank - 1) / (of - 1))) : 50);

  /* ---------------- shared: team identity in pre-game data (database ids) ---------------- */
  function preTeams(doc) {
    const P = doc.pregame; const M = matchup(doc.sport); const [a, hm] = doc.header.teams;
    return P.teamIds.map((id, i) => ({ id, abbr: [a, hm][i].abbr, name: [a, hm][i].name, logo: [a, hm][i].logo, side: i }));
  }
  const oppName = (doc, id) => { const M = matchup(doc.sport); const t = M?.teams?.[id]; return t ? t.abbr : id; };
  const oppLogo = (doc, id) => matchup(doc.sport)?.teams?.[id]?.logo;

  /* ---------------- BEFORE START ---------------- */
  function preHero(doc) {
    const H = doc.header; const P = doc.pregame; const tms = preTeams(doc);
    const rec = (t) => { const f = P.form[t.id]; if (!f || !f.games) return 'First game of the season'; const [w, l, d] = f.record; return `${w}-${l}${d ? `-${d}` : ''} this season`; };
    const side = (t, isHome) => h('div', { class: `team-side${isHome ? ' home' : ''}` }, isHome ? null : avatar(t.logo, 60, { logo: true, label: t.name }),
      h('div', { style: { minWidth: 0 } }, h('a', { class: 'lnk t-heading', href: '#team' }, t.name), h('div', { class: 't-label' }, `${rec(t)} · ${isHome ? 'Home' : 'Away'}`)), isHome ? avatar(t.logo, 60, { logo: true, label: t.name }) : null);
    const L = doc.lines; const chips = [];
    if (L) {
      if (L.pointSpread?.home?.close?.line != null) chips.push(h('span', { class: 'chip' }, `${tms[1].abbr} ${L.pointSpread.home.close.line}`));
      if (L.totalLine?.over?.close?.line != null) chips.push(h('span', { class: 'chip' }, `Total ${String(L.totalLine.over.close.line).replace(/^o/, '')}`));
      if (L.moneyline?.home?.close?.odds) chips.push(h('span', { class: 'chip' }, `ML ${tms[0].abbr} ${L.moneyline.away.close.odds} · ${tms[1].abbr} ${L.moneyline.home.close.odds}`));
    }
    const wx = H.weather ? `${H.weather.temp}°F ${H.weather.condition}, wind ${H.weather.wind}` : null;
    return h('section', { class: 'hero' }, h('div', { class: 'score-hero' }, side(tms[0], false),
      h('div', { style: { textAlign: 'center' } }, h('div', { class: 'row', style: { justifyContent: 'center', marginBottom: '6px' } }, h('span', { class: 'chip' }, 'Before start')),
        h('div', { class: 't-heading' }, new Date(H.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'),
        h('div', { class: 't-label', style: { marginTop: '6px' } }, [H.venue, H.city, wx].filter(Boolean).join(' · ')),
        H.probables && (H.probables.away || H.probables.home) ? h('div', { class: 't-label' }, `Probable: ${H.probables.away || 'TBD'} vs ${H.probables.home || 'TBD'}`) : null),
      side(tms[1], true)), chips.length ? h('div', { class: 'result-chips' }, ...chips) : null,
      P.notes.length ? h('div', { class: 't-label', style: { textAlign: 'center', marginTop: '8px' } }, P.notes.join(' ')) : null);
  }

  /* Strength vs strength: one side's production against what the other side allows, both as league ranks. */
  function strengthCard(doc) {
    const P = doc.pregame; const tms = preTeams(doc);
    const seasons = Object.keys(P.strength).sort().reverse();
    const early = P.notes.length > 0;
    let season = early && seasons[1] ? seasons[1] : seasons[0];
    let attack = 0;
    const host = h('div');
    const draw = () => {
      const rows = P.strength[season];
      const off = tms[attack], def = tms[1 - attack];
      const played = season === String(P.season) ? P.gamesBefore : null;
      put(host,
        h('div', { class: 'row', style: { marginBottom: '10px' } },
          segmented(seasons.map((s) => ({ value: s, label: s === String(P.season) ? `This season (${Math.min(...Object.values(P.gamesBefore))} gp)` : `Last season` })), season, (v) => { season = v; draw(); }),
          segmented([{ value: 0, label: `${tms[0].abbr} offense vs ${tms[1].abbr} defense` }, { value: 1, label: `${tms[1].abbr} offense vs ${tms[0].abbr} defense` }], attack, (v) => { attack = Number(v); draw(); })),
        h('div', { class: 'team-key' }, h('span', null, avatar(off.logo, 18, { logo: true, label: off.abbr }), `${off.abbr} produces`), h('span', null, `${def.abbr} allows`, avatar(def.logo, 18, { logo: true, label: def.abbr }))),
        ...rows.map((r) => {
          const o = r.teams[off.id]?.for, d = r.teams[def.id]?.allowed;
          if (!o || !d) return null;
          const po = pctOfRank(o[1], o[2]), pd = pctOfRank(d[1], d[2]);
          const edge = po - pd; // high = offense strength meets a weak spot
          const row = h('div', { class: 'cmp-row2', style: { gridTemplateColumns: '92px minmax(0,1fr) 92px' } },
            h('div', { class: 'v' }, fmt.n(o[0], o[0] < 20 ? 1 : 0), h('div', { class: 't-label' }, `${fmt.ord(o[1])} of ${o[2]}`)),
            h('div', { class: 'cmp-mid' }, h('div', { class: 'lab' }, `${r.label}${Math.abs(edge) >= 35 ? (edge > 0 ? ` · edge ${off.abbr}` : ` · edge ${def.abbr}`) : ''}`),
              h('div', { class: 'cmp-bars2' }, h('div', null, h('span', { style: { width: `${po}%`, background: G.sideColor(off.side) } })), h('div', null, h('span', { style: { width: `${100 - pd}%`, background: G.sideColor(def.side) } })))),
            h('div', { class: 'v r' }, fmt.n(d[0], d[0] < 20 ? 1 : 0), h('div', { class: 't-label' }, `${fmt.ord(d[1])} of ${d[2]}`)));
          Tip.bind(row, () => [tipRow(`${fmt.n(o[0], 2)}`, `${off.abbr} ${r.label.toLowerCase()} per game${/%|per /.test(r.label) ? '' : ''}`), tipRow(`${fmt.n(d[0], 2)}`, `${def.abbr} allows`), tipText(`Left bar: how good ${off.abbr} is at this (longer = better). Right bar: how much ${def.abbr} gives up (longer = more generous).`), tipText(`League range: ${fmt.n(r.league.for[0], 1)}–${fmt.n(r.league.for[r.league.for.length - 1], 1)}`)]);
          return row;
        }),
        h('div', { class: 't-label', style: { marginTop: '6px' } }, `Built from every game before kickoff${played ? ` (${tms[0].abbr} ${played[tms[0].id] ?? 0}, ${tms[1].abbr} ${played[tms[1].id] ?? 0} games)` : ''}. “Edge” marks a gap of 35+ percentile points.`));
    };
    draw();
    return card({ title: 'Strength vs strength', scope: 'league ranks as of kickoff', info: 'Each row puts one team’s production against what the other team allows, both ranked across the league from the app’s game logs.', body: host });
  }

  function formCard(doc) {
    const P = doc.pregame; const tms = preTeams(doc);
    const teamBlock = (t) => {
      const f = P.form[t.id]; if (!f) return null;
      const games = f.last10;
      return h('div', { class: 'stack' },
        h('div', { class: 'row' }, avatar(t.logo, 24, { logo: true, label: t.abbr }), h('b', null, t.name), h('span', { class: 't-label' }, f.games ? `${f.record[0]}-${f.record[1]}${f.record[2] ? `-${f.record[2]}` : ''} · home ${f.home.join('-')} · away ${f.away.join('-')} · ${fmt.n(f.pf, 1)} for, ${fmt.n(f.pa, 1)} against per game` : 'No games yet this season')),
        columnChart({ bars: games.map(([d, o, home, pf, pa]) => ({ label: '', value: Math.abs(pf - pa) || 0.3, color: pf > pa ? 'var(--good)' : pf < pa ? 'var(--bad)' : 'var(--ink-muted)', d, o, home, pf, pa })), height: 110, labelEvery: 1000, tooltip: (b) => [tipRow(`${b.pf > b.pa ? 'W' : b.pf < b.pa ? 'L' : 'D'} ${b.pf}–${b.pa}`, `${b.home ? 'vs' : '@'} ${oppName(doc, b.o)}`), tipText(shortDay(b.d))] }),
        h('div', { class: 't-label' }, `Last ${games.length}, oldest to newest: ${games.map(([d, o, home, pf, pa]) => `${pf > pa ? 'W' : pf < pa ? 'L' : 'D'} ${home ? 'vs' : '@'} ${oppName(doc, o)}`).join(' · ')}`));
    };
    return card({ title: 'Form coming in', scope: 'last 10 results before kickoff', body: h('div', { class: 'split-2' }, ...tms.map(teamBlock)) });
  }

  function h2hCard(doc) {
    const P = doc.pregame; const tms = preTeams(doc);
    const rows = P.h2h.slice().reverse().map(([d, o, home, pf, pa]) => ({ d, home, pf, pa, winner: pf > pa ? tms[0].abbr : pf < pa ? tms[1].abbr : 'Draw' }));
    const wins = [rows.filter((r) => r.winner === tms[0].abbr).length, rows.filter((r) => r.winner === tms[1].abbr).length];
    return card({ title: 'Head-to-head', scope: rows.length ? `${tms[0].abbr} ${wins[0]} – ${wins[1]} ${tms[1].abbr} since 2023` : 'no meetings held', dense: true,
      body: rows.length ? dataTable([{ key: 'd', label: 'Date', fmt: (v) => shortDay(v) }, { key: 'venue', label: 'Where', render: (r) => (r.home ? `at ${tms[0].abbr}` : `at ${tms[1].abbr}`) }, { key: 'score', label: 'Score', render: (r) => `${tms[0].abbr} ${r.pf} – ${r.pa} ${tms[1].abbr}` }, { key: 'winner', label: 'Winner', render: (r) => h('b', null, r.winner) }], rows, { sortKey: null }) : h('div', { class: 'state' }, 'No meetings in the results held (since 2023)') });
  }

  /* Props with each player's history in the market before kickoff: L10 hit rate, vs this opponent, sparkline vs the line. */
  const injuryOf = (doc, name) => (doc.injuries || []).flatMap((t) => t.items).find((i) => i.name === name);
  const nameCell = (doc, name) => { const inj = injuryOf(doc, name); return h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, h('a', { class: 'lnk', href: '#player' }, name), inj ? h('span', { class: `chip ${/out/i.test(inj.status) ? 'bad' : ''}`, title: inj.detail || '' }, inj.status) : null); };

  function propsResearchCard(doc) {
    const P = doc.pregame; const H = P.propHistory || {};
    const rows = (doc.props || []).map((p) => { const hist = H[`${String(p.id).split(':').pop()}|${p.market}`]; if (!hist) return null; const last = hist.last.slice(-10).map((x) => x[1]); const vs = hist.vsOpp.map((x) => x[1]); return { ...p, hist, label: MARKET_LABELS[p.market] || p.market, l10: last.length ? (100 * last.filter((v) => v > p.line).length) / last.length : null, avg: U.avg(last), vsHit: vs.length ? `${vs.filter((v) => v > p.line).length}/${vs.length}` : '—', vsAvg: U.avg(vs), n: last.length }; }).filter(Boolean);
    if (!rows.length) return card({ title: 'Player props', body: h('div', { class: 'state' }, h('b', null, 'No player props held for this game'), doc.odds ? 'Lines were stored for the game, but no player markets with history.' : 'The game predates the app’s odds capture.') });
    const markets = [...new Set(rows.map((r) => r.market))];
    let mk = 'all', limit = 15; const host = h('div');
    const spark = (r) => svgHost((W) => { const w = Math.min(W, 120), hh = 26, vals = r.hist.last.slice(-10).map((x) => x[1]); const mx = Math.max(r.line * 1.6, ...vals, 1); const bw = w / 10; const svg = s('svg', { viewBox: `0 0 ${w} ${hh}`, width: w, height: hh }); vals.forEach((v, i) => svg.append(s('rect', { x: i * bw + 1, y: hh - (Math.max(0, v) / mx) * hh, width: bw - 2, height: (Math.max(0, v) / mx) * hh, fill: v > r.line ? 'var(--good)' : 'var(--bad)', opacity: 0.85 }))); svg.append(s('line', { x1: 0, x2: w, y1: hh - (r.line / mx) * hh, y2: hh - (r.line / mx) * hh, stroke: 'var(--ink)', 'stroke-dasharray': '2 2' })); return svg; });
    const open = (r) => Drill.open(`${r.name} · ${r.label} ${r.line}`, `Best over ${r.over ? `${G.am(r.over.price)} ${r.over.book}` : '—'} · ${r.books} books`, h('div', { class: 'stack' },
      columnChart({ bars: r.hist.last.map(([d, v, o]) => ({ label: shortDay(d), value: v, color: v > r.line ? 'var(--good)' : 'var(--bad)', d, o })), refs: [{ y: r.line, label: `O ${r.line}` }], height: 200, labelEvery: 3, tooltip: (b) => [tipRow(fmt.n(b.value), `${shortDay(b.d)} vs ${oppName(doc, b.o)}`)] }),
      statGrid([{ label: 'Last 10 over', value: r.l10 == null ? '—' : `${fmt.n(r.l10, 0)}%` }, { label: 'Last 10 avg', value: fmt.n(r.avg, 1) }, { label: 'vs this opponent', value: r.vsHit, sub: r.vsAvg != null ? `avg ${fmt.n(r.vsAvg, 1)}` : 'no meetings' }]),
      h('div', { class: 'callout' }, 'Full build: this opens the kept prop analysis block for the player, scoped to this game.')));
    const draw = () => {
      const all = rows.filter((r) => mk === 'all' || r.market === mk).sort((x, y) => (y.l10 ?? -1) - (x.l10 ?? -1));
      put(host, h('div', { class: 'row', style: { marginBottom: '8px' } }, selectBox([{ value: 'all', label: `All markets (${rows.length})` }, ...markets.map((m) => ({ value: m, label: `${MARKET_LABELS[m] || m} (${rows.filter((r) => r.market === m).length})` }))], mk, (v) => { mk = v; limit = 15; draw(); }, 'Market'), h('span', { class: 't-label' }, 'Sorted by last-10 hit rate · click a row for the game-by-game chart')),
        dataTable([{ key: 'name', label: 'Player', render: (r) => nameCell(doc, r.name) }, { key: 'label', label: 'Market' }, { key: 'line', label: 'Line', num: true, render: (r) => h('span', null, fmt.n(r.line, r.line % 1 ? 1 : 0), r.yesNo ? h('span', { class: 't-label' }, ' yes') : null) }, { key: 'overP', label: 'Best over', num: true, render: (r) => (r.over ? h('span', null, G.am(r.over.price), h('span', { class: 't-label' }, ` ${r.over.book}`)) : '—') },
          { key: 'spark', label: 'Last 10 vs line', sort: false, render: (r) => spark(r) }, { key: 'l10', label: 'L10 over', num: true, fmt: (v) => (v == null ? '—' : `${fmt.n(v, 0)}%`) }, { key: 'avg', label: 'L10 avg', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'vsHit', label: 'vs opp', num: true }], all.slice(0, limit), { sortKey: null, onRow: open }),
        all.length > limit ? h('button', { class: 'btn', type: 'button', style: { marginTop: '8px' }, onclick: () => { limit = all.length; draw(); } }, `Show all ${all.length}`) : null);
    };
    draw();
    return card({ title: 'Player props', scope: 'main line and each player’s history before kickoff', dense: true, body: host, foot: `${doc.propsAltOnly ? `${doc.propsAltOnly} markets had only alternate lines stored and are left out. ` : ''}History from the app’s game logs; "vs opp" counts every meeting held.` });
  }

  function watchCard(doc, { live } = {}) {
    const W = doc.pregame.watch; if (!W) return null;
    const tms = preTeams(doc);
    return card({ title: live ? 'Players to watch · so far' : 'Players to watch', scope: `${W.season !== doc.pregame.season ? 'last season’s' : 'season'} averages · vs this opponent`, dense: true, body: h('div', { class: 'split-2' }, ...tms.map((t) => h('div', null, h('div', { class: 'row', style: { margin: '4px 0 6px' } }, avatar(t.logo, 20, { logo: true, label: t.abbr }), h('b', null, t.abbr)),
      dataTable([{ key: 'name', label: 'Player', render: (r) => h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, avatar(r.headshot, 24, { label: r.name }), h('a', { class: 'lnk', href: '#player' }, r.name)) },
        ...W.keys.map(([k, lab]) => ({ key: k, label: lab, num: true, render: (r) => h('span', null, live ? h('b', null, r.now && r.now[k] != null ? `${r.now[k]} ` : (r.now || k !== 'assists' ? '0 ' : '— ')) : null, h('span', { class: live ? 't-label' : '' }, fmt.n(r.avg[k], 1)), r.vsAvg ? h('span', { class: 't-label' }, ` · ${fmt.n(r.vsAvg[k], 1)}`) : null) }))],
      (W.teams[t.id] || []).map((w) => ({ ...w, now: live ? live[w.id] : null })), { sortKey: null })))), foot: live ? 'Bold = so far at this moment (from the play-by-play) · then season average · then average vs this opponent' : 'Season average · average vs this opponent (every meeting held)' });
  }

  function injuriesCard(doc) {
    const inj = doc.injuries || [];
    const all = inj.flatMap((t) => t.items.map((i) => ({ ...i, team: t.team })));
    if (!inj.length) return card({ title: 'Injuries', body: h('div', { class: 'state' }, 'ESPN’s summary for this league carries no injury report') });
    const tAbbr = (id) => doc.header.teams.find((t) => String(t.id) === String(id))?.abbr || id;
    return card({ title: 'Injuries', scope: `${all.length} listed · ESPN`, dense: true, body: all.length ? dataTable([{ key: 'team', label: 'Team', fmt: (v) => tAbbr(v) }, { key: 'name', label: 'Player' }, { key: 'pos', label: 'Pos' }, { key: 'status', label: 'Status', render: (r) => h('span', { class: `chip ${/out/i.test(r.status) ? 'bad' : ''}` }, r.status) }, { key: 'detail', label: 'Detail' }], all, { sortKey: null }) : h('div', { class: 'state' }, 'No injuries listed'), foot: 'This is the report as the summary carries it now, not a snapshot from before kickoff' });
  }

  /* NFL: where each offense throws against where the other defense gives up targets (last full season). */
  function passMatchupCard(doc) {
    const M = matchup('nfl'); const tms = preTeams(doc);
    const season = String(doc.pregame.season - (Math.min(...Object.values(doc.pregame.gamesBefore)) < 4 ? 1 : 0));
    const T = M?.targets?.[season]; if (!T) return null;
    let attack = 0; const host = h('div');
    const cells = [['deep', 'left'], ['deep', 'middle'], ['deep', 'right'], ['short', 'left'], ['short', 'middle'], ['short', 'right']];
    const shares = (obj) => { const c = obj?.cells || {}; const tot = U.sum(Object.values(c).map((v) => v[0])); return Object.fromEntries(cells.map(([l, s2]) => { const v = c[`${l}|${s2}`] || [0, 0]; return [`${l}|${s2}`, { share: tot ? (100 * v[0]) / tot : 0, comp: v[0] ? (100 * v[1]) / v[0] : null, att: v[0] }]; })); };
    const grid = (vals, lg, title) => svgHost((W) => {
      const H = 170, cw = W / 3, ch = (H - 20) / 2; const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title });
      cells.forEach(([l, s2], i) => { const k = `${l}|${s2}`; const v = vals[k], L = lg[k]; const d = v.share - L.share; const x = (i % 3) * cw, y = Math.floor(i / 3) * ch;
        const fill = Math.abs(d) < 1 ? '#ececec' : d > 0 ? `color-mix(in srgb, var(--cmp-a) ${Math.round(Math.min(75, 9 * d + 12))}%, #f2f2f2)` : `color-mix(in srgb, var(--cmp-b) ${Math.round(Math.min(75, -9 * d + 12))}%, #f2f2f2)`;
        const g = s('g'); g.append(s('rect', { x: x + 3, y: y + 3, width: cw - 6, height: ch - 6, rx: 6, fill }), s('text', { x: x + cw / 2, y: y + ch / 2 + 2, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 700, fill: 'var(--ink)' }, `${fmt.n(v.share, 0)}%`), s('text', { x: x + cw / 2, y: y + ch / 2 + 18, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--ink-2)' }, `${fmt.n(v.comp, 0)}% comp`));
        svg.append(hoverable(g, () => [tipRow(`${fmt.n(v.share, 1)}%`, `${l} ${s2} · ${title}`), tipText(`League ${fmt.n(L.share, 1)}% · ${v.att} attempts · ${fmt.n(v.comp, 0)}% completed`)])); });
      svg.append(s('text', { class: 'axis-t', x: W / 2, y: H - 4, 'text-anchor': 'middle' }, 'line of scrimmage below'));
      return h('div', { class: 'chart' }, svg);
    });
    const lg = shares({ cells: T.league });
    const draw = () => {
      const off = tms[attack], def = tms[1 - attack];
      put(host, segmented([{ value: 0, label: `${tms[0].abbr} passing vs ${tms[1].abbr}` }, { value: 1, label: `${tms[1].abbr} passing vs ${tms[0].abbr}` }], attack, (v) => { attack = Number(v); draw(); }),
        h('div', { class: 'split-2', style: { marginTop: '8px' } }, h('div', null, h('div', { class: 't-over', style: { margin: '4px 0' } }, `Where ${off.abbr} throws`), grid(shares(T.off[off.id]), lg, `${off.abbr} throws`)), h('div', null, h('div', { class: 't-over', style: { margin: '4px 0' } }, `Where ${def.abbr} is thrown at`), grid(shares(T.def[def.id]), lg, `${def.abbr} allows`))),
        vizLegend([['More than league', 'var(--cmp-a)'], ['Within 1 point', '#ececec'], ['Less than league', 'var(--cmp-b)']]));
    };
    draw();
    return card({ title: 'Passing matchup', scope: `${season} season · share of attempts by depth and side`, body: host, foot: 'nfl_target_events: each offense’s throws, and every throw made against each defense' });
  }

  function nbaZonesCard(doc) {
    const M = matchup('nba'); const S = M?.shots; if (!S) return null; const tms = preTeams(doc);
    const zones = ['Restricted area', 'Paint (non-RA)', 'Mid-range', 'Corner 3', 'Above-break 3'];
    const pack = (obj) => { const z = obj?.zones || {}; const tot = U.sum(Object.values(z).map((v) => v[0])); return Object.fromEntries(zones.map((n) => { const v = z[n] || [0, 0, 0]; return [n, { share: tot ? (100 * v[0]) / tot : null, fg: v[0] ? (100 * v[1]) / v[0] : null }]; })); };
    let attack = 0; const host = h('div');
    const draw = () => {
      const off = tms[attack], def = tms[1 - attack];
      const o = pack(S.for[off.id]), d = pack(S.allowed[def.id]);
      const rank = (side, id, zone, key, better) => { const vals = Object.entries(S[side]).map(([t, v]) => [t, pack(v)[zone][key]]).filter((x) => x[1] != null).sort((x, y) => (better === 'high' ? y[1] - x[1] : x[1] - y[1])); return `${fmt.ord(vals.findIndex((x) => x[0] === id) + 1)}/${vals.length}`; };
      put(host, segmented([{ value: 0, label: `${tms[0].abbr} shots vs ${tms[1].abbr} defense` }, { value: 1, label: `${tms[1].abbr} shots vs ${tms[0].abbr} defense` }], attack, (v) => { attack = Number(v); draw(); }),
        dataTable([{ key: 'zone', label: 'Zone' }, { key: 'os', label: `${off.abbr} share`, num: true, render: (r) => h('span', null, `${fmt.n(r.os, 1)}%`, h('span', { class: 't-label' }, ` ${rank('for', off.id, r.zone, 'share', 'high')}`)) }, { key: 'ofg', label: `${off.abbr} FG%`, num: true, render: (r) => h('span', null, fmt.n(r.ofg, 1), h('span', { class: 't-label' }, ` ${rank('for', off.id, r.zone, 'fg', 'high')}`)) },
          { key: 'ds', label: `${def.abbr} allows share`, num: true, render: (r) => h('span', null, `${fmt.n(r.ds, 1)}%`, h('span', { class: 't-label' }, ` ${rank('allowed', def.id, r.zone, 'share', 'high')}`)) }, { key: 'dfg', label: `${def.abbr} allows FG%`, num: true, render: (r) => h('span', null, fmt.n(r.dfg, 1), h('span', { class: 't-label' }, ` ${rank('allowed', def.id, r.zone, 'fg', 'high')}`)) }],
          zones.map((z) => ({ zone: z, os: o[z].share, ofg: o[z].fg, ds: d[z].share, dfg: d[z].fg })), { sortKey: null }));
    };
    draw();
    return card({ title: 'Shot zones matchup', scope: `${S.season} — the only season of shot locations held`, dense: true, body: host, foot: 'Ranks: share and FG% among all 30 teams; for “allows”, 1st = gives up the most' });
  }

  function mlbStartersCard(doc) {
    const S = doc.pregame.starters; if (!S) return null;
    const tms = doc.header.teams;
    const one = (side, i) => {
      const p = S[side]; if (!p) return null;
      const opp = tms[1 - i];
      return card({ title: `${tms[i].abbr} starter · ${p.name}`, scope: `throws ${p.hand || '—'} · ${fmt.n(p.pitches)} pitches this season before today`, body: h('div', { class: 'stack' },
        statGrid([{ label: 'GS', value: p.season.gs }, { label: 'IP', value: p.season.ip }, { label: 'ERA', value: fmt.n(p.season.era, 2) }, { label: 'WHIP', value: fmt.n(p.season.whip, 2) }, { label: 'K', value: p.season.k }, { label: 'BB', value: p.season.bb }, { label: 'HR', value: p.season.hr }]),
        dataTable([{ key: 'type', label: 'Pitch', fmt: (v) => PITCH_NAMES[v] || v }, { key: 'share', label: 'Share', num: true, fmt: (v) => `${fmt.n(v, 0)}%` }, { key: 'velo', label: 'mph', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'whiff', label: 'Whiff %', num: true, fmt: (v) => fmt.n(v, 0) }], p.mix.slice(0, 6), { sortKey: null }),
        h('div', { class: 't-over' }, 'Last starts'),
        dataTable([{ key: 'd', label: 'Date', fmt: (v) => shortDay(v) }, { key: 'o', label: 'Opp', fmt: (v) => oppName(doc, v) }, { key: 'ip', label: 'IP', num: true }, { key: 'h', label: 'H', num: true }, { key: 'er', label: 'ER', num: true }, { key: 'bb', label: 'BB', num: true }, { key: 'k', label: 'K', num: true }], p.log.slice().reverse().map(([d, o, ip, hh, er, bb, k]) => ({ d, o, ip, h: hh, er, bb, k })), { sortKey: null }),
        h('div', { class: 't-over' }, `${opp.abbr} lineup against ${p.name}`),
        dataTable([{ key: 'order', label: '#', num: true }, { key: 'name', label: 'Batter', render: (r) => h('span', null, h('a', { class: 'lnk', href: '#player' }, r.name), h('span', { class: 't-label' }, ` ${r.pos} · bats ${r.bats || '—'}`)) }, { key: 'slash', label: 'AVG/OBP/SLG', render: (r) => `${fmt.rate3(r.season.avg)}/${fmt.rate3(r.season.obp)}/${fmt.rate3(r.season.slg)}` }, { key: 'hr', label: 'HR', num: true, render: (r) => r.season.hr },
          { key: 'vh', label: `vs ${p.hand}HP: AVG · K% · xwOBAcon`, render: (r) => (r.vsHand.pa ? `${fmt.rate3(r.vsHand.avg)} · ${fmt.n(r.vsHand.k, 0)}% · ${fmt.rate3(r.vsHand.xwobacon)}` : '—') }, { key: 'vp', label: `vs ${p.name.split(' ').slice(-1)[0]}`, render: (r) => (r.vsPitcher.pa ? h('b', null, `${r.vsPitcher.h}-${r.vsPitcher.ab}${r.vsPitcher.hr ? `, ${r.vsPitcher.hr} HR` : ''}${r.vsPitcher.k ? `, ${r.vsPitcher.k} K` : ''}`) : h('span', { class: 't-label' }, 'never faced')) }], p.vsLineup, { sortKey: null })),
        foot: 'Lineup as posted. Pitch mix, handedness splits and batter-vs-pitcher history from the Statcast corpus before today.' });
    };
    return h('div', { class: 'split-2' }, one('away', 0), one('home', 1));
  }

  function nhlGoaliesCard(doc) {
    const Gl = doc.pregame.goalies; if (!Gl) return null; const tms = doc.header.teams;
    return h('div', { class: 'split-2' }, ...['away', 'home'].map((side, i) => { const g = Gl[side]; if (!g) return null; const starts = g.recent.filter((r) => r[3]); const sv = U.sum(starts.map((r) => r[2])), sa = U.sum(starts.map((r) => r[3]));
      return card({ title: `${tms[i].abbr} goalie · ${g.fullName || g.name}`, scope: `last ${starts.length} appearances before tonight`, body: h('div', { class: 'stack' }, h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '14px' } }, avatar(g.headshot, 48, { label: g.name }), h('div', { style: { flex: 1 } }, statGrid([{ label: 'SV%', value: sa ? fmt.n((100 * sv) / sa, 1) : '—' }, { label: 'GA / start', value: fmt.n(U.avg(starts.map((r) => r[4])), 2) }, { label: 'Shots faced / start', value: fmt.n(U.avg(starts.map((r) => r[3])), 1) }]))),
        columnChart({ bars: starts.slice().reverse().map((r) => ({ label: shortDay(r[0]), value: (100 * r[2]) / r[3], color: r[2] / r[3] >= 0.9 ? 'var(--good)' : 'var(--bad)', r })), height: 120, refs: [{ y: 90, label: '.900' }], labelEvery: 2, tooltip: (b) => [tipRow(`${b.r[2]}/${b.r[3]}`, `saves vs ${oppName(doc, b.r[1])}`), tipText(`${shortDay(b.r[0])} · ${b.r[4]} GA`)] })), foot: 'Started this game; the NHL posts starters close to puck drop' }); }));
  }

  function soccerLineupsCard(doc) {
    const tms = doc.header.teams; const lines = { G: 'GK', D: 'DEF', M: 'MID', F: 'FWD', A: 'MID', L: 'DEF', R: 'DEF', C: 'DEF' };
    const grp = (p) => (p.pos === 'G' ? 'Goalkeeper' : /B$|^CD|^D/.test(p.pos || '') ? 'Defence' : /^F|^S/.test(p.pos || '') ? 'Attack' : 'Midfield');
    return card({ title: 'Lineups', scope: 'announced about an hour before kickoff', body: h('div', { class: 'split-2' }, ...doc.rosters.map((r) => { const t = tms.find((x) => String(x.id) === String(r.team)); const st = r.players.filter((p) => p.starter); return h('div', null, h('div', { class: 'row', style: { marginBottom: '6px' } }, avatar(t?.logo, 22, { logo: true, label: t?.abbr }), h('b', null, t?.name), h('span', { class: 'chip' }, r.formation)),
      ...['Goalkeeper', 'Defence', 'Midfield', 'Attack'].map((g) => h('div', { class: 'row', style: { margin: '4px 0', alignItems: 'baseline' } }, h('span', { class: 't-over', style: { width: '90px' } }, g), h('span', { class: 't-sm ink2' }, st.filter((p) => grp(p) === g).map((p) => `${p.jersey} ${p.short || p.name}`).join(' · ')))),
      h('div', { class: 't-label', style: { marginTop: '6px' } }, `Bench: ${r.players.filter((p) => !p.starter).map((p) => p.short || p.name).join(', ')}`)); })) });
  }

  function tennisPre(doc) {
    const T2 = doc.tennis; const M = matchup('tennis'); const [p1, p2] = T2.players;
    const order = ['Q1', 'Q2', 'Q3', 'R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'];
    const before = (p) => p.season.filter((m) => m.date < T2.date || (m.date === T2.date && m.tourney === T2.tourney && order.indexOf(m.round) < order.indexOf(T2.round)));
    const prof = (name) => M?.players?.[name]?.[T2.date.slice(0, 4)];
    const rows = [['Serve: 1st serve won %', 'firstWon', 'high'], ['Serve: 2nd serve won %', 'secondWon', 'high'], ['Serve: break points saved %', 'bpSaved', 'high'], ['Return: return points won %', 'returnWon', 'high'], ['Return: break points converted %', 'bpConverted', 'high'], ['Aces per match', 'acesPerMatch', 'high']];
    const pr1 = prof(p1.name), pr2 = prof(p2.name);
    const hero = h('section', { class: 'hero' }, h('div', { class: 'score-hero' }, ...[p1, h('div', { style: { textAlign: 'center' } }, h('span', { class: 'chip' }, 'Before start'), h('div', { class: 't-heading', style: { marginTop: '6px' } }, `${T2.tourney} · ${T2.round}`), h('div', { class: 't-label' }, `${T2.surface} · best of ${T2.bestOf}`)), p2].map((p, i) => (i === 1 ? p : h('div', { class: `team-side${i === 2 ? ' home' : ''}` }, avatar(null, 56, { label: p.name, color: '#1f3a5f' }), h('div', null, h('div', { class: 't-heading' }, p.name), h('div', { class: 't-label' }, `No. ${p.rank}${p.seed ? ` · seed ${p.seed}` : ''} · ${before(p).filter((m) => m.won).length}-${before(p).filter((m) => !m.won).length} this year`)))))));
    const matchupCard = card({ title: 'Serve vs return', scope: `${T2.date.slice(0, 4)} season profiles (TennisMyLife)`, body: pr1 && pr2 ? h('div', null, h('div', { class: 'team-key' }, h('span', null, h('i', { class: 'sw-dot', style: { background: G.sideColor(0) } }), p1.name), h('span', null, p2.name, h('i', { class: 'sw-dot', style: { background: G.sideColor(1) } }))),
      ...rows.map(([label, k]) => { const a = pr1[k], b = pr2[k]; const tot = (a || 0) + (b || 0); return h('div', { class: 'cmp-row2' }, h('div', { class: `v ${a > b ? 'lead' : 'trail'}` }, fmt.n(a, 1)), h('div', { class: 'cmp-mid' }, h('div', { class: 'lab' }, label), h('div', { class: 'cmp-bars2' }, h('div', null, h('span', { style: { width: `${tot ? (100 * a) / tot : 0}%`, background: G.sideColor(0) } })), h('div', null, h('span', { style: { width: `${tot ? (100 * b) / tot : 0}%`, background: G.sideColor(1) } })))), h('div', { class: `v r ${b > a ? 'lead' : 'trail'}` }, fmt.n(b, 1))); }),
      h('div', { class: 't-label', style: { marginTop: '6px' } }, `The matchup to read: ${p1.name.split(' ').pop()}’s serve points won (${fmt.n(pr1.firstWon, 1)}% on first serve) against ${p2.name.split(' ').pop()}’s return points won (${fmt.n(pr2.returnWon, 1)}%), and the reverse.`)) : h('div', { class: 'state' }, 'No season profile for one of the players') });
    const formCard2 = card({ title: 'Form coming in', scope: 'matches this year before this round', body: h('div', { class: 'split-2' }, ...[p1, p2].map((p) => { const ms = before(p).slice().sort((x, y) => (y.date + order.indexOf(y.round)).localeCompare(x.date + order.indexOf(x.round))); return h('div', null, h('b', null, p.name), h('div', { class: 'row', style: { marginTop: '6px' } }, ...ms.slice(0, 10).map((m) => { const el = h('span', { class: 'mini-form' }, h('span', { style: { background: m.won ? 'var(--good)' : 'var(--bad)' } }, m.won ? 'W' : 'L')); Tip.bind(el, () => [tipRow(m.score, `${m.won ? 'W' : 'L'} vs ${m.opp}`), tipText(`${m.tourney} ${m.round} · ${m.surface}`)]); return el; })), h('div', { class: 't-label' }, `Hard court ${ms.filter((m) => m.surface === 'Hard' && m.won).length}-${ms.filter((m) => m.surface === 'Hard' && !m.won).length}`)); })) });
    const h2h = card({ title: 'Head-to-head', scope: 'before this match', dense: true, body: dataTable([{ key: 'date', label: 'Event', fmt: (v, r) => `${r.tourney} ${r.date.slice(0, 4)}` }, { key: 'surface', label: 'Surface' }, { key: 'round', label: 'Rd' }, { key: 'winner', label: 'Winner' }, { key: 'score', label: 'Score' }], T2.h2h.filter((x) => !(x.date === T2.date && x.round === T2.round)), { sortKey: null }) });
    return { hero, sections: [{ id: 'pre-match', label: 'Matchup', node: section('pre-match', 'Matchup', 'as of the start', h('div', { class: 'split-2' }, matchupCard, h('div', { class: 'stack' }, formCard2, h2h))) }, { id: 'pre-lines', label: 'Lines', node: section('pre-lines', 'Lines', null, card({ title: 'Odds', body: statusPill(`Odds: ${doc.status.odds}`) })) }] };
  }

  function preSections(doc, { prefix = 'pre-' } = {}) {
    const sp = doc.sport;
    const native = ({ nfl: () => [passMatchupCard(doc)], cfb: () => [], nba: () => [nbaZonesCard(doc)], nhl: () => [nhlGoaliesCard(doc)], mlb: () => [mlbStartersCard(doc)], soccer: () => [soccerLineupsCard(doc)] }[sp] || (() => []))();
    const nativeLabel = { nfl: 'Passing matchup', nba: 'Shot zones', nhl: 'Goalies', mlb: 'Starters & lineups', soccer: 'Lineups' }[sp];
    const out = [
      { id: `${prefix}matchup`, label: 'Matchup', node: section(`${prefix}matchup`, 'Matchup', 'everything here is as of kickoff', strengthCard(doc), h('div', { class: 'split-2' }, formCard(doc), h2hCard(doc))) },
      ...(native.filter(Boolean).length ? [{ id: `${prefix}native`, label: nativeLabel, node: section(`${prefix}native`, nativeLabel, null, ...native.filter(Boolean)) }] : []),
      { id: `${prefix}players`, label: 'Players', node: section(`${prefix}players`, 'Players', null, (doc.props || []).length ? propsResearchCard(doc) : null, watchCard(doc), injuriesCard(doc)) },
      { id: `${prefix}lines`, label: 'Lines', node: section(`${prefix}lines`, 'Lines', 'open to the last quote before kickoff', linesCard(doc, { threeWay: sp === 'soccer', results: false })) },
    ];
    return out;
  }

  /* ---------------- LIVE: cut the real game at a moment ---------------- */
  const clockSecs = (c) => { const [m, s2] = String(c || '0:00').split(':').map(Number); return m * 60 + (s2 || 0); };
  const MOMENTS = {
    nfl: (doc) => [['q1', 'End of 1st quarter', (p) => p.period <= 1], ['half', 'Halftime', (p) => p.period <= 2], ['q3', 'End of 3rd quarter', (p) => p.period <= 3], ['q4', '5:00 left in the 4th', (p) => p.period < 4 || (p.period === 4 && clockSecs(p.clock) >= 300)]],
    nba: (doc) => [['q1', 'End of 1st quarter', (p) => p.period <= 1], ['half', 'Halftime', (p) => p.period <= 2], ['q3', 'End of 3rd quarter', (p) => p.period <= 3], ['q4', '6:00 left in the 4th', (p) => p.period < 4 || (p.period === 4 && clockSecs(p.clock) >= 360)]],
    nhl: () => [['p1', 'After the 1st period', (e) => e.period <= 1], ['p2', 'After the 2nd period', (e) => e.period <= 2], ['p3', '10:00 into the 3rd', (e) => e.period < 3 || (e.period === 3 && clockSecs(e.t) <= 600)]],
    mlb: () => [['i3', 'After 3 innings', (ab) => ab.inning <= 3], ['i5', 'After 5 innings', (ab) => ab.inning <= 5], ['i7', 'After 7 innings', (ab) => ab.inning <= 7]],
    soccer: () => [['m30', '30th minute', (e) => (e.sec ?? 0) <= 1800], ['ht', 'Half-time', (e) => (e.sec ?? 0) <= 2700 + 300 && !/Second Half/i.test(e.text || '')], ['m75', '75th minute', (e) => (e.sec ?? 0) <= 4500]],
  };
  MOMENTS.cfb = MOMENTS.nfl;

  function cut(doc, momentId) {
    const sp = doc.sport; const m = (MOMENTS[sp] ? MOMENTS[sp](doc) : []).find((x) => x[0] === momentId); if (!m) return null;
    const pred = m[2]; const d = JSON.parse(JSON.stringify(doc)); const [a, hm] = d.header.teams;
    let wall = null, clockLabel = m[1];
    const lines = (n, fn) => [0, 1].map((side) => Array.from({ length: n }, (_, i) => fn(side, i)));
    if (sp === 'nfl' || sp === 'cfb' || sp === 'nba') {
      let idx = -1; doc.plays.forEach((p, i) => { if (pred(p)) idx = i; });
      d.plays = doc.plays.slice(0, idx + 1);
      const last = d.plays[d.plays.length - 1] || { away: 0, home: 0 };
      a.score = last.away; hm.score = last.home; wall = last.wall;
      const keep = new Set(d.plays.map((p) => p.id)); d.wp = (doc.wp || []).filter(([id]) => keep.has(id));
      if (d.drives) { const seen = new Set(d.plays.map((p) => p.drive)); d.drives = doc.drives.filter((dr) => seen.has(dr.id)).map((dr, i, arr) => (i === arr.length - 1 && dr.id !== doc.drives[doc.drives.length - 1].id && d.plays[d.plays.length - 1]?.drive === dr.id && !/End of/i.test(dr.result || '') ? { ...dr, result: 'In progress', short: 'NOW' } : dr)); }
      const per = (side, i) => { let prev = 0, tot = 0; for (const p of d.plays) { const v = side ? p.home : p.away; if (p.period === i + 1) tot += v - prev; prev = v; } return tot; };
      const periods = Math.max(...d.plays.map((p) => p.period), 1); [a.lines, hm.lines] = lines(periods, per);
      clockLabel = `${m[1]} · ${a.abbr} ${a.score}–${hm.score} ${hm.abbr}`;
    } else if (sp === 'mlb') {
      d.atBats = doc.atBats.filter(pred);
      const last = d.atBats[d.atBats.length - 1]; a.score = last.away; hm.score = last.home; wall = last.t;
      const keep = new Set(d.atBats.map((x) => x.i)); d.wp = doc.wp.filter(([i]) => keep.has(i));
      const innings = Math.max(...d.atBats.map((x) => x.inning));
      const per = (side, i) => { let prev = 0, tot = 0; for (const x of d.atBats) { const v = side ? x.home : x.away; if (x.inning === i + 1 && (side ? x.half === 'bottom' : x.half === 'top')) tot += v - prev; prev = side ? (x.half === 'bottom' ? v : prev) : (x.half === 'top' ? v : prev); } return tot; };
      // Runs per inning from score changes (runs score without an RBI on errors, wild pitches, balks).
      a.lines = Array(innings).fill(0); hm.lines = Array(innings).fill(0);
      { let pa = 0, ph = 0; for (const x of d.atBats) { a.lines[x.inning - 1] += x.away - pa; hm.lines[x.inning - 1] += x.home - ph; pa = x.away; ph = x.home; } }
      a.hits = d.atBats.filter((x) => x.half === 'top' && ['single', 'double', 'triple', 'home_run'].includes(x.eventType)).length; hm.hits = d.atBats.filter((x) => x.half === 'bottom' && ['single', 'double', 'triple', 'home_run'].includes(x.eventType)).length;
      clockLabel = `${m[1]} · ${a.abbr} ${a.score}–${hm.score} ${hm.abbr}`;
    } else if (sp === 'nhl') {
      d.nhl.events = doc.nhl.events.filter(pred);
      const goals = d.nhl.events.filter((e) => e.type === 'goal'); const lg = goals[goals.length - 1];
      a.score = lg ? lg.as_ : 0; hm.score = lg ? lg.hs : 0;
      const periods = Math.max(...d.nhl.events.map((e) => e.period), 1);
      a.lines = Array.from({ length: periods }, (_, i) => goals.filter((g) => g.period === i + 1 && String(g.team) === String(doc.nhl.awayId)).length);
      hm.lines = Array.from({ length: periods }, (_, i) => goals.filter((g) => g.period === i + 1 && String(g.team) === String(doc.nhl.homeId)).length);
      clockLabel = `${m[1]} · ${a.abbr} ${a.score}–${hm.score} ${hm.abbr}`;
    } else if (sp === 'soccer') {
      if (momentId === 'ht') {
        // Half-time is the commentary up to "Second Half begins" (first-half stoppage runs past 45').
        const cutAt = doc.events.findIndex((e) => /Second Half begins/i.test(e.text || ''));
        d.events = doc.events.slice(0, cutAt < 0 ? doc.events.length : cutAt);
        const lastSec = Math.max(...d.events.map((e) => e.sec || 0));
        d.keyEvents = doc.keyEvents.filter((k) => (k.sec ?? 0) <= lastSec && !/Start 2nd Half/i.test(k.type || ''));
      } else { d.events = doc.events.filter(pred); d.keyEvents = doc.keyEvents.filter(pred); }
      const goals = d.keyEvents.filter((k) => /Goal/.test(k.type || ''));
      const sideOf = (t) => (String(t) === String(a.id) ? 0 : 1);
      a.score = goals.filter((g) => sideOf(g.team) === 0).length; hm.score = goals.filter((g) => sideOf(g.team) === 1).length;
      a.lines = [goals.filter((g) => sideOf(g.team) === 0 && (g.sec ?? 0) <= 2700).length, goals.filter((g) => sideOf(g.team) === 0 && (g.sec ?? 0) > 2700).length].slice(0, momentId === 'm30' || momentId === 'ht' ? 1 : 2);
      hm.lines = [goals.filter((g) => sideOf(g.team) === 1 && (g.sec ?? 0) <= 2700).length, goals.filter((g) => sideOf(g.team) === 1 && (g.sec ?? 0) > 2700).length].slice(0, momentId === 'm30' || momentId === 'ht' ? 1 : 2);
      const kev = d.keyEvents.filter((k) => k.wall); wall = kev.length ? kev[kev.length - 1].wall : null;
      clockLabel = `${m[1]} · ${a.abbr} ${a.score}–${hm.score} ${hm.abbr}`;
    }
    a.winner = hm.winner = false;
    d.header.status = clockLabel;
    return { doc: d, wall, label: m[1] };
  }

  /* Stat so far for a prop, from the plays up to the moment. Football reads names and yards out of the play text. */
  const nameKey = (full) => { const parts = String(full).replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, '').split(' '); return `${parts[0][0]}.${parts.slice(1).join(' ')}`.toLowerCase(); };
  function footballLive(plays) {
    const st = {};
    const add = (n, k, v) => { const key = n.toLowerCase(); (st[key] = st[key] || {})[k] = ((st[key] || {})[k] || 0) + v; };
    const NAME = "([A-Z][a-zA-Z]*\\.[A-Z][\\w'.-]*(?: [A-Z][\\w'.-]+)?)";
    for (const p of plays) {
      const t = p.text || ''; if (/No Play/i.test(t) || /kicks|punts|extra point|field goal/i.test(t)) continue;
      const yds = (s2) => (/no gain/.test(s2) ? 0 : Number((s2.match(/for (-?\d+) yards?/) || [])[1] || 0));
      let mm;
      if ((mm = t.match(new RegExp(`${NAME} pass (?:short|deep) (?:left|right|middle) to ${NAME}(.*)`)))) {
        const y = yds(mm[3]); add(mm[1], 'passing-attempts', 1); add(mm[1], 'pass-attempts', 1); add(mm[1], 'completions', 1); add(mm[1], 'passing-yards', y); add(mm[2], 'receptions', 1); add(mm[2], 'receiving-yards', y); add(mm[2], 'rush-rec-yards', y);
        if (/TOUCHDOWN/.test(t)) { add(mm[1], 'passing-tds', 1); add(mm[2], 'anytime-td', 1); }
      } else if ((mm = t.match(new RegExp(`${NAME} pass incomplete`)))) { add(mm[1], 'passing-attempts', 1); add(mm[1], 'pass-attempts', 1); }
      else if ((mm = t.match(new RegExp(`${NAME} pass .*INTERCEPTED`)))) { add(mm[1], 'passing-attempts', 1); add(mm[1], 'pass-attempts', 1); add(mm[1], 'interceptions', 1); }
      else if ((mm = t.match(new RegExp(`^(?:\\([^)]*\\) )?${NAME} (?:up the middle|(?:left|right) (?:end|tackle|guard)|scrambles|kneels)(.*)`)))) { const y = yds(mm[2]); add(mm[1], 'rushing-yards', y); add(mm[1], 'rushing-attempts', 1); add(mm[1], 'rush-rec-yards', y); if (/TOUCHDOWN/.test(t)) add(mm[1], 'anytime-td', 1); }
    }
    return st;
  }
  function liveStat(doc, cutDoc, p) {
    const sp = doc.sport;
    if (sp === 'nfl' || sp === 'cfb') { cutDoc._fb = cutDoc._fb || footballLive(cutDoc.plays); const s2 = cutDoc._fb[nameKey(p.name)]; return s2 ? (s2[p.market] ?? (['receptions', 'receiving-yards', 'rushing-yards', 'passing-yards', 'completions', 'passing-attempts', 'pass-attempts', 'rush-rec-yards', 'anytime-td', 'interceptions', 'passing-tds', 'rushing-attempts'].includes(p.market) ? 0 : null)) : (['receptions', 'receiving-yards', 'rushing-yards', 'anytime-td', 'rush-rec-yards'].includes(p.market) ? 0 : null); }
    if (sp === 'mlb') {
      const id = Number(String(p.id).split(':').pop()); const bat = cutDoc.atBats.filter((x) => x.batterId === id); const pit = cutDoc.atBats.filter((x) => x.pitcherId === id);
      const hits = bat.filter((x) => ['single', 'double', 'triple', 'home_run'].includes(x.eventType));
      const tb = { single: 1, double: 2, triple: 3, home_run: 4 };
      const m = { hits: hits.length, 'total-bases': U.sum(hits.map((x) => tb[x.eventType])), 'home-runs': bat.filter((x) => x.eventType === 'home_run').length, rbis: U.sum(bat.map((x) => x.rbi || 0)), walks: bat.filter((x) => /walk/.test(x.eventType)).length, 'batter-strikeouts': bat.filter((x) => /strikeout/.test(x.eventType)).length, singles: bat.filter((x) => x.eventType === 'single').length, doubles: bat.filter((x) => x.eventType === 'double').length, triples: bat.filter((x) => x.eventType === 'triple').length, 'pitcher-strikeouts': pit.filter((x) => /strikeout/.test(x.eventType)).length, 'pitcher-hits-allowed': pit.filter((x) => ['single', 'double', 'triple', 'home_run'].includes(x.eventType)).length };
      if (!bat.length && !pit.length) return null;
      return m[p.market] ?? null;
    }
    if (sp === 'soccer') { const mine = cutDoc.events.filter((e) => (e.who || [])[0] === p.name); const m = { shots: mine.filter((e) => /Shot|Goal/.test(e.type || '')).length, 'shots-on-target': mine.filter((e) => /On Target|Goal/.test(e.type || '')).length, goals: mine.filter((e) => /Goal/.test(e.type || '')).length, 'anytime-goalscorer': mine.filter((e) => /Goal/.test(e.type || '')).length }; return m[p.market] ?? null; }
    return null;
  }

  function livePropsCard(doc, cutDoc) {
    const rows = (doc.props || []).map((p) => { const v = liveStat(doc, cutDoc, p); return { ...p, label: MARKET_LABELS[p.market] || p.market, now: v, pct: v == null ? null : Math.min(100, (100 * v) / Math.max(p.line, 0.5)) }; });
    if (!rows.length) return null;
    const tracked = rows.filter((r) => r.now != null).sort((x, y) => (y.pct ?? 0) - (x.pct ?? 0));
    const how = { nfl: 'from the play-by-play text (the live app would read the box score it already refreshes)', cfb: 'from the play-by-play text', mlb: 'from every plate appearance so far', soccer: 'from the commentary feed so far' }[doc.sport];
    return card({ title: 'Props tracker', scope: `${tracked.length} of ${rows.length} tracked`, info: `Stat so far ${how}.`, dense: true, body: dataTable([{ key: 'name', label: 'Player', render: (r) => nameCell(doc, r.name) }, { key: 'label', label: 'Market' }, { key: 'line', label: 'Line', num: true },
      { key: 'prog', label: 'So far', sort: false, render: (r) => h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 44px', gap: '8px', alignItems: 'center', minWidth: '140px' } }, h('div', { class: 'track', style: { height: '8px', background: 'var(--card-sunk)', borderRadius: '4px', position: 'relative', overflow: 'hidden' } }, h('span', { style: { position: 'absolute', inset: 0, width: `${r.pct}%`, background: r.now > r.line ? 'var(--good)' : 'var(--ink-faint)', borderRadius: '4px' } })), h('b', { class: 'num' }, fmt.n(r.now, r.now % 1 ? 1 : 0))) },
      { key: 'st', label: '', sort: false, render: (r) => (r.now > r.line ? h('span', { class: 'chip good' }, 'Over already') : h('span', { class: 't-label' }, `needs ${fmt.n(Math.floor(r.line - r.now) + 1)} more`)) }], tracked.slice(0, 25), { sortKey: null }) });
  }

  function liveOddsCard(doc, wall) {
    const O = doc.odds; if (!O) return card({ title: 'In-game odds', body: h('div', { class: 'state' }, 'No odds captured for this game') });
    if (!wall) return card({ title: 'In-game odds', body: h('div', { class: 'state' }, h('b', null, 'Can’t line up odds with this moment'), 'This feed carries no timestamps on its plays.') });
    const tEnd = Date.parse(wall) / 1000;
    const rows = O.rows.filter((r) => r[6] && r[0] === 'moneyline' && r[5] <= tEnd);
    const [a, hm] = doc.header.teams;
    if (rows.length < 2) return card({ title: 'In-game odds', scope: 'moneyline quotes after the start', body: h('div', { class: 'state' }, `${rows.length} in-game quotes stored up to this moment`) });
    const homeName = (side) => /home/i.test(side) || [hm.name, hm.abbr, hm.short].includes(side);
    const by = U.groupBy(rows, (r) => Math.floor(r[5] / 300) * 300); const ts = Object.keys(by).map(Number).sort((x, y) => x - y);
    const vals = ts.map((t) => { const g = by[t]; const hp = U.avg(g.filter((r) => homeName(r[1])).map((r) => G.implied(r[3])).filter((v) => v != null)); const ap = U.avg(g.filter((r) => !homeName(r[1]) && !/draw/i.test(r[1])).map((r) => G.implied(r[3])).filter((v) => v != null)); return hp != null && ap != null ? (100 * hp) / (hp + ap) : null; });
    return card({ title: 'In-game odds', scope: `${rows.length} moneyline quotes stored after the start, up to this moment`, body: lineChart({ series: [{ name: `${hm.abbr} implied %`, color: 'var(--ink)', values: vals, dots: true }], labels: ts.map((t, i) => (i === 0 || i === ts.length - 1 ? new Date(t * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '')), height: 180, yMin: 0, yMax: 100, refs: [{ y: 50, dash: true }], yFmt: (v) => `${Math.round(v)}%`, tooltip: (i) => [tipRow(vals[i] == null ? '—' : `${fmt.n(vals[i], 1)}%`, `${hm.abbr} implied, vig removed`), tipText(`${new Date(ts[i] * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET · ${by[ts[i]].length} quotes`)] }), foot: 'The stored quotes after kickoff are real in-game prices; the pre-game chart leaves them out' });
  }

  function liveHero(doc, cutDoc, label) {
    const [a, hm] = cutDoc.header.teams; const H = doc.header;
    const last = cutDoc.wp?.length ? cutDoc.wp[cutDoc.wp.length - 1] : null;
    const homeWp = last ? (typeof last[1] === 'number' ? last[1] : null) : null;
    const hero = gameHero(cutDoc, { periods: GAME_SPORTS[doc.sport]?.hero?.periods, extraCols: doc.sport === 'mlb' ? [{ label: 'H', value: (t) => t.hits }] : [], chips: [] });
    const chip = hero.querySelector('.chip'); if (chip) { chip.classList.add('live'); chip.textContent = `Live · ${label}`; }
    if (homeWp != null) hero.append(h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '10px', gap: '10px' } }, h('span', { class: 't-label' }, 'Win probability now'), h('div', { style: { width: '220px', height: '8px', borderRadius: '99px', overflow: 'hidden', display: 'flex', background: 'var(--card-sunk)' } }, h('div', { style: { width: `${100 - homeWp * 100}%`, background: G.sideColor(0) } }), h('div', { style: { width: `${homeWp * 100}%`, background: G.sideColor(1) } })), h('b', { class: 'num' }, `${hm.abbr} ${fmt.n(homeWp * 100, 1)}%`)));
    return hero;
  }

  function liveWatchStats(doc, cutDoc) {
    if (doc.sport === 'nba') { const out = {}; for (const p of cutDoc.plays) { if (!p.who) continue; const o = (out[p.who] = out[p.who] || { points: 0, threePointFieldGoalsMade: 0, rebounds: 0 }); if (p.score && p.pts) { o.points += p.pts; if (p.att === 3) o.threePointFieldGoalsMade += 1; } if (/rebound/i.test(p.type || '')) o.rebounds += 1; } return out; }
    if (doc.sport === 'nhl') { const out = {}; for (const e of cutDoc.nhl.events) { const bump = (id, k) => { if (!id) return; const o = (out[String(id)] = out[String(id)] || { goals: 0, assists: 0, points: 0, sog: 0 }); o[k] += 1; }; if (e.type === 'goal') { bump(e.who, 'goals'); bump(e.who, 'points'); bump(e.who, 'sog'); bump(e.a1, 'assists'); bump(e.a1, 'points'); bump(e.a2, 'assists'); bump(e.a2, 'points'); } if (e.type === 'shot-on-goal') bump(e.who, 'sog'); } return out; }
    return null;
  }

  function liveSections(doc, momentId) {
    const c = cut(doc, momentId); if (!c) return null;
    const def = GAME_SPORTS[doc.sport].games[0];
    const r = def.build(c.doc); const built = Array.isArray(r) ? r : r.sections;
    const keepIds = { nfl: ['flow', 'plays'], cfb: ['flow', 'plays'], nba: ['flow', 'shots', 'plays'], nhl: ['flow', 'rink', 'plays'], mlb: ['flow', 'contact', 'atbats', 'plays'], soccer: ['flow', 'shots', 'plays'] }[doc.sport];
    const pick = (id) => built.find((x) => x.id === id);
    const liveW = liveWatchStats(doc, c.doc);
    const nowSec = { id: 'live-now', label: 'Right now', node: section('live-now', 'Right now', c.label, h('div', { class: 'split-2' }, livePropsCard(doc, c.doc) || (liveW ? watchCard(doc, { live: liveW }) : card({ title: 'Props tracker', body: h('div', { class: 'state' }, 'No player props held for this game') })), liveOddsCard(doc, c.wall)),
      card({ title: 'What the live page would add', body: h('div', { class: 't-sm ink2' }, 'The live box score and team stats refresh from the summary the app already polls. This replay cuts stored plays at a moment, so it shows everything derivable from plays up to then and leaves out the final box score.') })) };
    const secs = [nowSec, ...keepIds.map(pick).filter(Boolean)];
    return { hero: liveHero(doc, c.doc, c.label), sections: secs };
  }

  /* ---------------- wire into GAME_SPORTS ---------------- */
  for (const [sp, def] of Object.entries(GAME_SPORTS)) {
    const g = def.games[0];
    g.moments = MOMENTS[sp] ? (doc) => MOMENTS[sp](doc).map(([id, label]) => ({ id, label })) : (sp === 'tennis' ? () => [] : () => []);
    g.pre = (doc) => (sp === 'tennis' ? tennisPre(doc) : doc.pregame ? { hero: preHero(doc), sections: preSections(doc) } : null);
    g.live = (doc, moment) => liveSections(doc, moment);
    g.final = (doc) => {
      const r = g.build(doc); const base = Array.isArray(r) ? { hero: null, sections: r } : r;
      if (sp === 'tennis') { const tp = tennisPre(doc); const src2 = base.sections.find((x) => x.id === 'sources'); return { hero: base.hero, sections: [...base.sections.filter((x) => x.id !== 'sources'), { id: 'kickoff', label: 'Before the match', node: section('kickoff', 'Before the match', 'the research as it stood before the first serve', ...tp.sections.map((x) => x.node.querySelector('.stack') || x.node)) }, ...(src2 ? [src2] : [])] }; }
      if (!doc.pregame) return base;
      const pre = preSections(doc, { prefix: 'kick-' });
      const src = base.sections.find((x) => x.id === 'sources');
      const rest = base.sections.filter((x) => x.id !== 'sources');
      const before = { id: 'kickoff', label: 'Before the game', node: section('kickoff', 'Before the game', 'the research as it stood at kickoff, kept for the record', ...pre.map((x) => x.node)) };
      return { hero: base.hero, sections: [...rest, before, ...(src ? [src] : [])] };
    };
  }
})();
