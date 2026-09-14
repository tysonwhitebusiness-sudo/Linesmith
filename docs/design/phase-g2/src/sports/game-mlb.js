/* MLB game page: win probability by plate appearance, spray chart with distance, at-bat explorer, pitch mix. */
(() => {
  const SWING_MISS = ['S', 'W', 'M'];
  const STRIKE_CALLS = ['C', 'S', 'W', 'T', 'M'];
  const innLabel = (ab) => `${ab.half === 'top' ? 'Top' : 'Bot'} ${ab.inning}`;

  function build(doc) {
    const [a, hm] = doc.header.teams;
    const abs = doc.atBats;
    const battingSide = (ab) => (ab.half === 'top' ? 0 : 1);
    const byIdx = new Map(abs.map((x) => [x.i, x]));

    /* ---- Game flow ---- */
    const wpPoints = doc.wp.map(([i, home]) => { const ab = byIdx.get(i); return ab ? { home, ab, scoring: ab.scoring, text: ab.desc, ctx: `${innLabel(ab)} · ${a.abbr} ${ab.away}–${ab.home} ${hm.abbr} · ${ab.batter} vs ${ab.pitcher}` } : null; }).filter(Boolean);
    let selAb = (abs.find((x) => x.eventType === 'home_run') || abs.find((x) => x.scoring) || abs[0]).i;
    const explorerHost = h('div');
    const pickAb = (i) => { selAb = i; drawExplorer(); document.getElementById('sec-atbats')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

    /* ---- Spray chart ---- */
    const balls = abs.filter((x) => x.hit && x.hit.x != null).map((x) => { const dx = x.hit.x - 125.42, dy = 198.27 - x.hit.y; return { ...x, fx: dx * 2.5, fy: dy * 2.5, isHit: ['single', 'double', 'triple', 'home_run'].includes(x.eventType) }; });
    function spray() {
      let who = 'all', kind = 'all';
      const wrap = h('div');
      const draw = () => {
        const rs = balls.filter((b) => (who === 'all' || battingSide(b) === who) && (kind === 'all' || (kind === 'hits' ? b.isHit : !b.isHit)));
        put(wrap, h('div', { class: 'row', style: { marginBottom: '8px' } }, segmented([{ value: 'all', label: 'Both teams' }, { value: 0, label: a.abbr }, { value: 1, label: hm.abbr }], who, (v) => { who = v; draw(); }), segmented([{ value: 'all', label: 'All balls in play' }, { value: 'hits', label: 'Hits' }, { value: 'outs', label: 'Outs' }], kind, (v) => { kind = v; draw(); }), h('span', { class: 't-label' }, `${rs.length} batted balls`)),
          svgHost((W) => {
            const H = Math.min(W * 0.78, 520), S = (H - 20) / 440, cx = W / 2, cy = H - 12;
            const P = (x, y) => [cx + x * S, cy - y * S];
            const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Spray chart of batted balls' });
            const arc = (r) => { const [x1, y1] = P(-r * Math.SQRT1_2, r * Math.SQRT1_2); const [x2, y2] = P(r * Math.SQRT1_2, r * Math.SQRT1_2); return `M${cx},${cy} L${x1},${y1} A${r * S},${r * S} 0 0 1 ${x2},${y2} Z`; };
            svg.append(s('path', { d: arc(400), fill: 'oklch(95.5% 0.03 150)', stroke: 'oklch(80% 0.04 150)' }), s('path', { d: arc(150), fill: 'oklch(92% 0.035 70)', opacity: 0.7 }));
            const [bx1, by1] = P(0, 0), [bx2, by2] = P(63.6, 63.6), [bx3, by3] = P(0, 127.3), [bx4, by4] = P(-63.6, 63.6);
            svg.append(s('path', { d: `M${bx1},${by1} L${bx2},${by2} L${bx3},${by3} L${bx4},${by4} Z`, fill: 'none', stroke: '#fff', 'stroke-width': 2 }));
            for (const r of [300, 350, 400]) { const [tx, ty] = P(0, r); svg.append(s('text', { class: 'axis-t', x: tx, y: ty - 3, 'text-anchor': 'middle' }, `${r} ft`)); }
            for (const b of rs.sort((x, y) => (x.hit.ev || 0) - (y.hit.ev || 0))) {
              const [x, y] = P(b.fx, b.fy); const col = G.sideColor(battingSide(b)); const r = 3 + Math.max(0, ((b.hit.ev || 70) - 70) / 8);
              const mark = b.isHit ? s('circle', { cx: x, cy: y, r, fill: col, stroke: 'var(--card)', 'stroke-width': 1.5 }) : s('circle', { cx: x, cy: y, r, fill: 'var(--card)', stroke: col, 'stroke-width': 1.8 });
              svg.append(hoverable(mark, () => [tipRow(b.event, `${b.batter} · ${innLabel(b)}`), tipText(`${b.hit.ev ?? '—'} mph · ${b.hit.la ?? '—'}° · ${b.hit.dist ?? '—'} ft · ${String(b.hit.traj || '').replace('_', ' ')}`), tipText(`off ${b.pitcher} · click to open the at-bat`)], () => pickAb(b.i)));
            }
            return h('div', { class: 'chart' }, svg);
          }),
          vizLegend([[`${a.abbr}`, G.sideColor(0)], [`${hm.abbr}`, G.sideColor(1)], ['Filled = hit · ring = out · size = exit velocity', 'transparent']]));
      };
      draw();
      return wrap;
    }
    const longest = balls.filter((b) => b.hit.dist).sort((x, y) => y.hit.dist - x.hit.dist).slice(0, 12).map((b) => ({ i: b.i, batter: b.batter, team: [a, hm][battingSide(b)].abbr, result: b.event, dist: b.hit.dist, ev: b.hit.ev, la: b.hit.la, pitch: PITCH_NAMES[b.pitches[b.pitches.length - 1]?.[0]] || b.pitches[b.pitches.length - 1]?.[0], mph: b.pitches[b.pitches.length - 1]?.[1] }));

    /* ---- At-bat explorer ---- */
    function zonePlot(ab) {
      return svgHost((W) => {
        const Wd = Math.min(W, 320), H = Wd * 1.05; const X = (px) => Wd / 2 + (px / 2.2) * (Wd / 2); const Y = (pz) => H - ((pz - 0.2) / 4.6) * H;
        const svg = s('svg', { viewBox: `0 0 ${Wd} ${H}`, role: 'img', 'aria-label': 'Pitch locations, catcher view', style: `width:${Wd}px;max-width:100%;height:auto` });
        const top = ab.pitches[0]?.[6] || 3.4, bot = ab.pitches[0]?.[7] || 1.6;
        svg.append(s('rect', { x: 0, y: 0, width: Wd, height: H, rx: 8, fill: 'var(--card-sunk)' }), s('rect', { x: X(-0.708), y: Y(top), width: X(0.708) - X(-0.708), height: Y(bot) - Y(top), fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.5 }));
        for (const k of [1, 2]) { svg.append(s('line', { x1: X(-0.708 + (1.416 * k) / 3), x2: X(-0.708 + (1.416 * k) / 3), y1: Y(top), y2: Y(bot), stroke: 'var(--line)' }), s('line', { x1: X(-0.708), x2: X(0.708), y1: Y(top - ((top - bot) * k) / 3), y2: Y(top - ((top - bot) * k) / 3), stroke: 'var(--line)' })); }
        svg.append(s('path', { d: `M${X(-0.708)},${Y(0.25)} L${X(0.708)},${Y(0.25)} L${X(0.708)},${Y(0.1)} L${X(0)},${Y(0)} L${X(-0.708)},${Y(0.1)} Z`, fill: '#fff', stroke: 'var(--line)' }));
        const types = [...new Set(abs.flatMap((x) => x.pitches.map((p) => p[0])))];
        ab.pitches.forEach((p, n) => {
          if (p[2] == null) return; const col = CAT[types.indexOf(p[0]) % CAT.length];
          const g = s('g'); g.append(s('circle', { cx: X(p[2]), cy: Y(p[3]), r: 11, fill: col, stroke: 'var(--card)', 'stroke-width': 2, opacity: n === ab.pitches.length - 1 ? 1 : 0.85 }), s('text', { x: X(p[2]), y: Y(p[3]) + 4, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: '#fff' }, String(n + 1)));
          svg.append(hoverable(g, () => [tipRow(`${p[1] ?? '—'} mph`, `${n + 1}. ${PITCH_NAMES[p[0]] || p[0]}`), tipText(`${p[5]} · count ${p[8]}-${p[9]}`)]));
        });
        svg.append(s('text', { class: 'axis-t', x: 6, y: 14 }, "Catcher's view"));
        return h('div', { style: { display: 'grid', placeItems: 'center' } }, svg);
      });
    }
    function drawExplorer() {
      const ab = byIdx.get(selAb);
      const innings = [...new Set(abs.map(innLabel))];
      const list = h('div', { class: 'scroll-list', style: { maxHeight: '520px' } }, ...innings.map((inn) => h('div', null, h('div', { class: 't-over', style: { margin: '10px 0 4px' } }, inn),
        ...abs.filter((x) => innLabel(x) === inn).map((x) => { const row = h('div', { class: 'drive-row', tabindex: '0', 'aria-current': String(x.i === selAb), onclick: () => { selAb = x.i; drawExplorer(); } }, avatar(`https://img.mlbstatic.com/mlb-photos/image/upload/w_80,q_auto:best/v1/people/${x.batterId}/headshot/67/current`, 28, { label: x.batter }), h('div', { style: { minWidth: 0 } }, h('div', { class: 't-sm', style: { fontWeight: 600 } }, x.batter), h('div', { class: 't-label' }, `${x.event} · vs ${x.pitcher}`)), x.scoring ? h('span', { class: 'chip' }, `${x.away}–${x.home}`) : h('span', { class: 't-label num' }, `${x.pitches.length}p`)); row.addEventListener('keydown', (e) => { if (e.key === 'Enter') { selAb = x.i; drawExplorer(); } }); return row; }))));
      const types = [...new Set(abs.flatMap((x) => x.pitches.map((p) => p[0])))];
      const detail = card({ title: `${ab.batter} vs ${ab.pitcher}`, scope: `${innLabel(ab)} · ${ab.outs} out · bats ${ab.bats} / throws ${ab.throws}`, body: h('div', { class: 'stack' },
        h('div', { class: 'callout' }, h('b', null, ab.event), ` — ${ab.desc}`),
        ab.hit ? statGrid([{ label: 'Exit velocity', value: ab.hit.ev != null ? `${ab.hit.ev} mph` : '—' }, { label: 'Launch angle', value: ab.hit.la != null ? `${ab.hit.la}°` : '—' }, { label: 'Distance', value: ab.hit.dist != null ? `${ab.hit.dist} ft` : '—' }, { label: 'Trajectory', value: String(ab.hit.traj || '—').replace('_', ' ') }]) : null,
        h('div', { class: 'split-2' }, zonePlot(ab), dataTable([{ key: 'n', label: '#', num: true }, { key: 'type', label: 'Pitch', render: (r) => h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, h('i', { class: 'sw-dot', style: { background: CAT[types.indexOf(r.code) % CAT.length], borderRadius: '50%' } }), r.type) }, { key: 'mph', label: 'mph', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'call', label: 'Result' }, { key: 'count', label: 'Count' }], ab.pitches.map((p, n) => ({ n: n + 1, code: p[0], type: PITCH_NAMES[p[0]] || p[0], mph: p[1], call: p[5], count: `${p[8]}-${p[9]}` })), { sortKey: null }))) });
      put(explorerHost, h('div', { class: 'split-3-2 rev' }, card({ title: 'Plate appearances', scope: `${abs.length} · click one`, body: list }), detail));
    }
    drawExplorer();

    /* ---- Pitching ---- */
    const pitcherIds = [...new Set(abs.map((x) => x.pitcherId))];
    let selP = pitcherIds[0]; const pitchHost = h('div');
    const boxPitch = doc.mlbBox.flatMap((b, i) => b.pitching.map((p) => ({ ...p, team: [a, hm][i].abbr })));
    const drawPitch = () => {
      const pp = abs.filter((x) => x.pitcherId === selP).flatMap((x) => x.pitches);
      const by = U.groupBy(pp, (p) => p[0]);
      const rows = Object.entries(by).map(([code, ps]) => ({ type: PITCH_NAMES[code] || code, n: ps.length, share: (100 * ps.length) / pp.length, avg: U.avg(ps.map((p) => p[1]).filter(Boolean)), max: Math.max(...ps.map((p) => p[1] || 0)), whiff: U.pct(ps.filter((p) => SWING_MISS.includes(p[4])).length, ps.filter((p) => ['S', 'W', 'M', 'F', 'T', 'X', 'D', 'E'].includes(p[4])).length), csw: (100 * ps.filter((p) => ['C', 'S', 'W', 'M'].includes(p[4])).length) / ps.length, zone: (100 * ps.filter((p) => p[2] != null && Math.abs(p[2]) <= 0.83 && p[3] >= (p[7] || 1.6) - 0.12 && p[3] <= (p[6] || 3.4) + 0.12).length) / ps.length })).sort((x, y) => y.n - x.n);
      const bp = boxPitch.find((x) => x.id === selP);
      put(pitchHost, h('div', { class: 'row', style: { marginBottom: '8px' } }, selectBox(pitcherIds.map((id) => { const p = boxPitch.find((x) => x.id === id); return { value: String(id), label: `${p?.team || ''} · ${p?.name || id}` }; }), String(selP), (v) => { selP = Number(v); drawPitch(); }, 'Pitcher'), bp ? h('span', { class: 't-label' }, `${bp.s.inningsPitched} IP · ${bp.s.hits} H · ${bp.s.earnedRuns} ER · ${bp.s.baseOnBalls} BB · ${bp.s.strikeOuts} K · ${bp.s.numberOfPitches || bp.s.pitchesThrown} pitches · season ERA ${bp.season?.era ?? '—'}`) : null),
        dataTable([{ key: 'type', label: 'Pitch' }, { key: 'n', label: 'Thrown', num: true }, { key: 'share', label: 'Share', num: true, fmt: (v) => `${fmt.n(v, 0)}%` }, { key: 'avg', label: 'Avg mph', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'max', label: 'Max', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'zone', label: 'Zone %', num: true, fmt: (v) => fmt.n(v, 0) }, { key: 'csw', label: 'CSW %', num: true, fmt: (v) => fmt.n(v, 0) }, { key: 'whiff', label: 'Whiff %', num: true, fmt: (v) => (v == null ? '—' : fmt.n(v, 0)) }], rows, { sortKey: null }));
    };
    drawPitch();
    const pitchLines = dataTable([{ key: 'team', label: 'Team' }, { key: 'name', label: 'Pitcher', render: (r) => h('a', { class: 'lnk', href: '#player' }, r.name) }, { key: 'ip', label: 'IP', num: true }, { key: 'hh', label: 'H', num: true }, { key: 'er', label: 'ER', num: true }, { key: 'bb', label: 'BB', num: true }, { key: 'k', label: 'K', num: true }, { key: 'hr', label: 'HR', num: true }, { key: 'pc', label: 'P-S', num: true }, { key: 'era', label: 'ERA', num: true }],
      boxPitch.map((p) => ({ team: p.team, name: p.name, ip: p.s.inningsPitched, hh: p.s.hits, er: p.s.earnedRuns, bb: p.s.baseOnBalls, k: p.s.strikeOuts, hr: p.s.homeRuns, pc: `${p.s.numberOfPitches ?? p.s.pitchesThrown}-${p.s.strikes}`, era: p.season?.era })), { sortKey: null, onRow: (r) => { const p = boxPitch.find((x) => x.name === r.name); if (p) { selP = p.id; drawPitch(); } } });

    /* ---- Box ---- */
    let bTeam = 1; const boxHost = h('div');
    const drawBox = () => { const b = doc.mlbBox[bTeam]; put(boxHost, segmented([{ value: 0, label: a.abbr }, { value: 1, label: hm.abbr }], bTeam, (v) => { bTeam = v; drawBox(); }),
      dataTable([{ key: 'name', label: 'Batter', render: (r) => h('span', null, h('a', { class: 'lnk', href: '#player' }, r.name), h('span', { class: 't-label' }, ` ${r.pos}`)) }, { key: 'ab', label: 'AB', num: true }, { key: 'r', label: 'R', num: true }, { key: 'hh', label: 'H', num: true }, { key: 'rbi', label: 'RBI', num: true }, { key: 'hr', label: 'HR', num: true }, { key: 'bb', label: 'BB', num: true }, { key: 'k', label: 'K', num: true }, { key: 'lob', label: 'LOB', num: true }, { key: 'avg', label: 'AVG', num: true }, { key: 'ops', label: 'OPS', num: true }, { key: 'maxev', label: 'Max EV', num: true, fmt: (v) => (v == null ? '—' : fmt.n(v, 1)) }],
        b.batting.map((p) => ({ name: p.name, pos: p.pos, sub: p.order && Number(p.order) % 100 !== 0, ab: p.s.atBats, r: p.s.runs, hh: p.s.hits, rbi: p.s.rbi, hr: p.s.homeRuns, bb: p.s.baseOnBalls, k: p.s.strikeOuts, lob: p.s.leftOnBase, avg: p.season?.avg, ops: p.season?.ops, maxev: Math.max(...balls.filter((x) => x.batterId === p.id && x.hit.ev).map((x) => x.hit.ev), -Infinity) === -Infinity ? null : Math.max(...balls.filter((x) => x.batterId === p.id && x.hit.ev).map((x) => x.hit.ev)) })), { sortKey: null })); };
    drawBox();

    /* ---- Props ---- */
    const allBat = doc.mlbBox.flatMap((b) => b.batting), allPit = doc.mlbBox.flatMap((b) => b.pitching);
    const resolve = (p) => {
      const id = Number(String(p.id).split(':').pop());
      const bt = allBat.find((x) => x.id === id)?.s, pt = allPit.find((x) => x.id === id)?.s;
      const m = { hits: bt && bt.hits, 'total-bases': bt && bt.totalBases, 'home-runs': bt && bt.homeRuns, rbis: bt && bt.rbi, runs: bt && bt.runs, walks: bt && bt.baseOnBalls, 'batter-strikeouts': bt && bt.strikeOuts, doubles: bt && bt.doubles, triples: bt && bt.triples, 'stolen-bases': bt && bt.stolenBases, singles: bt && bt.hits - bt.doubles - bt.triples - bt.homeRuns, 'hits-runs-rbis': bt && bt.hits + bt.runs + bt.rbi,
        'pitcher-strikeouts': pt && pt.strikeOuts, 'pitcher-outs': pt && pt.outs, 'earned-runs': pt && pt.earnedRuns, 'pitcher-hits-allowed': pt && pt.hits, 'pitcher-walks': pt && pt.baseOnBalls };
      const v = m[p.market]; return v == null || Number.isNaN(v) ? null : v;
    };

    const H = doc.header;
    const hero = gameHero(doc, { extraCols: [{ label: 'H', value: (t) => t.hits }, { label: 'E', value: (t) => t.errors }, { label: 'LOB', value: (t) => t.lob }], chips: [],
      sub: [H.decisions?.winner ? `W ${H.decisions.winner}` : null, H.decisions?.loser ? `L ${H.decisions.loser}` : null, H.decisions?.save ? `SV ${H.decisions.save}` : null, H.weather ? `${H.weather.temp}°F ${H.weather.condition}, wind ${H.weather.wind}` : null].filter(Boolean).join(' · ') });

    return { hero, sections: buildGameShell(doc, [
      { id: 'flow', label: 'Game flow', node: section('flow', 'Game flow', 'win probability after every plate appearance', wpCard({ points: wpPoints, doc, periodOf: (p) => String(p.ab.inning), onPick: (pt) => pickAb(pt.ab.i), scope: `${wpPoints.length} plate appearances · click one to open it`, foot: 'MLB Stats API win probability · x-axis is innings · markers are scoring plays' })) },
      { id: 'contact', label: 'Batted balls', node: section('contact', 'Batted balls', 'every ball in play with exit velocity and distance', h('div', { class: 'split-3-2' }, card({ title: 'Spray chart', scope: 'generic park outline, not Fenway’s walls', body: spray() }), card({ title: 'Longest batted balls', scope: 'projected distance', dense: true, body: dataTable([{ key: 'batter', label: 'Batter', render: (r) => h('span', null, h('a', { class: 'lnk', href: '#player' }, r.batter), h('span', { class: 't-label' }, ` ${r.team}`)) }, { key: 'result', label: 'Result' }, { key: 'dist', label: 'Ft', num: true }, { key: 'ev', label: 'EV', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'la', label: 'LA', num: true, fmt: (v) => (v == null ? '—' : `${v}°`) }, { key: 'pitch', label: 'Pitch' }], longest, { sortKey: null, onRow: (r) => pickAb(r.i) }), foot: 'The live feed carries distance for every batted ball; the app drops it at ingest today' }))) },
      { id: 'atbats', label: 'At-bats', node: section('atbats', 'At-bat explorer', 'every pitch, located', explorerHost) },
      { id: 'pitching', label: 'Pitching', node: section('pitching', 'Pitching', null, h('div', { class: 'split-2' }, card({ title: 'Pitching lines', scope: 'click a pitcher to see their mix', dense: true, body: pitchLines }), card({ title: 'Pitch mix', scope: 'this game, from the pitch feed', dense: true, body: pitchHost, foot: 'CSW = called strikes + whiffs per pitch · zone uses each batter’s strike zone' }))) },
      { id: 'box', label: 'Box score', node: section('box', 'Box score', null, card({ title: 'Batting', scope: 'season AVG/OPS through this game', dense: true, body: boxHost })) },
      { id: 'lines', label: 'Lines & props', node: section('lines', 'Lines & props', null, linesCard(doc), propsResultCard(doc, resolve)) },
      { id: 'plays', label: 'Play-by-play', node: section('plays', 'Play-by-play', null, playLogCard(doc, abs.map((x) => ({ period: x.inning, clock: x.half === 'top' ? '▲' : '▼', text: `${x.batter}: ${x.desc}`, team: [a, hm][battingSide(x)].id, key: x.scoring, tag: x.scoring ? `${x.away}–${x.home}` : null })), { periodName: (p) => `Inn ${p}`, keyLabel: 'Scoring only' })) },
    ]) };
  }

  GAME_SPORTS.mlb = { label: 'MLB', games: [{ slug: 'mlb-kc-bos', build }] };
})();
