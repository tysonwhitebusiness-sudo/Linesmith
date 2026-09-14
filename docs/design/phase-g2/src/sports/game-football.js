/* NFL + CFB game page: win probability, drive chart field model, selected drive, box, lines, props. */
(() => {
  const qName = (p) => (p > 4 ? (p === 5 ? 'OT' : `${p - 4}OT`) : `Q${p}`);

  function build(doc) {
    const [a, hm] = doc.header.teams;
    const side = (teamId) => (String(teamId) === String(a.id) ? 0 : 1);
    const playById = new Map(doc.plays.map((p) => [p.id, p]));
    const drives = doc.drives.filter((d, i, arr) => arr.findIndex((x) => x.id === d.id) === i);
    let selDrive = (drives.find((d) => d.score) || drives[0])?.id;
    const xOfYardLine = (yl) => 100 - yl; // yardLine counts from the home goal line; away end zone drawn on the left
    const xOfPlay = (p, yte) => (side(p.team) === 0 ? 100 - yte : yte);

    const wpPoints = doc.wp.map(([id, home]) => { const p = playById.get(id); return p ? { id, home, play: p, scoring: p.score, text: p.text, ctx: `${qName(p.period)} ${p.clock} · ${a.abbr} ${p.away}–${p.home} ${hm.abbr}${p.downText ? ` · ${p.downText} at ${p.spot}` : ''}` } : null; }).filter(Boolean);

    const flowHost = h('div', { class: 'stack' });
    const pick = (pt) => { selDrive = pt.play.drive; drawFlow(); document.getElementById('drive-detail')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };

    function driveChart() {
      return svgHost((W) => {
        const ez = Math.max(28, W * 0.06), fw = W - 2 * ez, lane = 20, top = 26, H = top + drives.length * lane + 24;
        const X = (x) => ez + (x / 100) * fw;
        const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Every drive of the game on the field' });
        svg.append(s('rect', { x: 0, y: top - 8, width: W, height: H - top, rx: 8, fill: 'oklch(96.5% 0.012 150)' }),
          s('rect', { x: 0, y: top - 8, width: ez, height: H - top, rx: 8, fill: a.color, opacity: 0.9 }), s('rect', { x: W - ez, y: top - 8, width: ez, height: H - top, rx: 8, fill: hm.color, opacity: 0.9 }));
        for (let yd = 10; yd < 100; yd += 10) svg.append(s('line', { x1: X(yd), x2: X(yd), y1: top - 8, y2: H - 16, stroke: yd === 50 ? 'oklch(62% 0.01 150)' : 'oklch(86% 0.01 150)' }), s('text', { class: 'axis-t', x: X(yd), y: 14, 'text-anchor': 'middle' }, String(yd <= 50 ? yd : 100 - yd)));
        svg.append(s('text', { x: ez / 2, y: 14, 'text-anchor': 'middle', class: 'axis-t' }, a.abbr), s('text', { x: W - ez / 2, y: 14, 'text-anchor': 'middle', class: 'axis-t' }, hm.abbr));
        drives.forEach((d, i) => {
          const y = top + i * lane + lane / 2 - 4; const sx = X(xOfYardLine(d.start ?? 50)); const ex = X(xOfYardLine(d.end ?? d.start ?? 50));
          const col = G.sideColor(side(d.team)); const on = d.id === selDrive;
          const g = s('g', { style: 'cursor:pointer' });
          g.append(s('rect', { x: 0, y: y - lane / 2 + 2, width: W, height: lane - 2, fill: on ? 'rgba(0,0,0,.05)' : 'transparent' }));
          g.append(s('line', { x1: sx, x2: ex, y1: y, y2: y, stroke: col, 'stroke-width': on ? 8 : 6, 'stroke-linecap': 'round', opacity: d.score ? 1 : 0.55 }));
          g.append(s('circle', { cx: sx, cy: y, r: 3, fill: '#fff', stroke: col, 'stroke-width': 2 }));
          const lx = Math.max(sx, ex) + 8, rightSide = lx > W - ez - 70;
          g.append(s('text', { class: 'axis-t', x: rightSide ? Math.min(sx, ex) - 8 : lx, y: y + 4, 'text-anchor': rightSide ? 'end' : 'start', style: `font-weight:${d.score ? 700 : 500};fill:${d.score ? 'var(--ink)' : 'var(--ink-muted)'}` }, d.short || d.result || ''));
          hoverable(g, () => [tipRow(d.result || '—', `${G.team(doc, d.team)?.abbr} drive · ${qName(d.period)} ${d.clock}`), tipText(`${d.plays} plays, ${d.yards} yds, ${d.time} · ${d.startText} → ${d.endText || '—'}`)], () => { selDrive = d.id; drawFlow(); });
          svg.append(g);
        });
        return h('div', { class: 'chart' }, svg);
      });
    }

    function driveField(d) {
      const plays = doc.plays.filter((p) => p.drive === d.id);
      const moving = plays.filter((p) => p.start != null && p.end != null && !/kickoff|punt|timeout|end of|extra point|two-point/i.test(`${p.type} ${p.text}`));
      const offense = G.team(doc, d.team);
      const field = svgHost((W) => {
        const H = 150, ez = Math.max(28, W * 0.06), fw = W - 2 * ez, top = 40, fh = 80;
        const X = (x) => ez + (x / 100) * fw;
        const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Plays of the selected drive' });
        svg.append(s('rect', { x: 0, y: top, width: W, height: fh, rx: 8, fill: 'oklch(96% 0.012 150)' }), s('rect', { x: 0, y: top, width: ez, height: fh, rx: 8, fill: a.color }), s('rect', { x: W - ez, y: top, width: ez, height: fh, rx: 8, fill: hm.color }));
        for (let yd = 10; yd < 100; yd += 10) svg.append(s('line', { x1: X(yd), x2: X(yd), y1: top, y2: top + fh, stroke: yd === 50 ? 'oklch(60% 0.01 150)' : 'oklch(85% 0.01 150)' }), s('text', { class: 'axis-t', x: X(yd), y: top + fh + 16, 'text-anchor': 'middle' }, String(yd <= 50 ? yd : 100 - yd)));
        svg.append(s('text', { x: ez / 2, y: top + fh / 2 + 4, fill: '#fff', 'font-size': 12, 'font-weight': 700, 'text-anchor': 'middle' }, a.abbr), s('text', { x: W - ez / 2, y: top + fh / 2 + 4, fill: '#fff', 'font-size': 12, 'font-weight': 700, 'text-anchor': 'middle' }, hm.abbr));
        const col = G.sideColor(side(d.team));
        moving.forEach((p, i) => {
          const x1 = X(xOfPlay(p, p.start)), x2 = X(xOfPlay(p, p.end));
          const pass = /pass|sack/i.test(`${p.type}`); const lift = (pass ? 34 : 14) + Math.min(10, Math.abs(x2 - x1) / 8);
          const d0 = `M${x1},${top + fh / 2} Q${(x1 + x2) / 2},${top + fh / 2 - lift} ${x2},${top + fh / 2}`;
          svg.append(s('path', { d: d0, fill: 'none', stroke: p.penalty ? 'var(--ink-faint)' : p.turnover ? 'var(--bad)' : col, 'stroke-width': 2.2, 'stroke-dasharray': pass ? '5 4' : null, opacity: 0.35 + (0.65 * (i + 1)) / moving.length }));
          svg.append(hoverable(s('path', { d: d0, fill: 'none', stroke: 'transparent', 'stroke-width': 14 }), () => [tipRow(`${p.yds > 0 ? '+' : ''}${p.yds ?? 0} yds`, `${p.downText || p.type} · ${qName(p.period)} ${p.clock}`), tipText(p.text)]));
        });
        const last = moving[moving.length - 1];
        if (last) { const lx = X(xOfPlay(last, last.end)); svg.append(s('line', { x1: lx, x2: lx, y1: top - 6, y2: top + fh + 2, stroke: 'var(--warn)', 'stroke-width': 3 }), s('circle', { cx: lx, cy: top - 18, r: 13, fill: '#fff', stroke: col, 'stroke-width': 2 }), s('image', { href: offense.logo, x: lx - 9, y: top - 27, width: 18, height: 18 })); }
        return h('div', { class: 'chart' }, svg);
      });
      return card({ title: `${offense.abbr} drive · ${d.result}`, scope: `${qName(d.period)} ${d.clock} · ${d.plays} plays, ${d.yards} yds, ${d.time}`, body: h('div', { id: 'drive-detail' }, field, vizLegend([['Run (solid)', G.sideColor(side(d.team))], ['Pass (dashed)', G.sideColor(side(d.team)), true], ['Turnover', 'var(--bad)'], ['Penalty', 'var(--ink-faint)']]),
        h('div', { class: 'scroll-list', style: { maxHeight: '280px', marginTop: '8px' } }, ...plays.map((p) => h('div', { class: `play-row${p.score ? ' key' : ''}` }, h('div', { class: 't-label num' }, p.downText || `${qName(p.period)} ${p.clock}`), h('div', { class: 'ink2' }, p.text), h('span', { class: 't-label num' }, p.yds != null ? `${p.yds > 0 ? '+' : ''}${p.yds}` : ''))))) });
    }

    function drawFlow() {
      const d = drives.find((x) => x.id === selDrive) || drives[0];
      put(flowHost, 
        wpCard({ points: wpPoints, doc, periodOf: (p) => qName(p.play.period), onPick: pick, foot: doc.sport === 'cfb' ? 'ESPN win probability · college model' : 'ESPN win probability' }),
        h('div', { class: 'split-2' },
          card({ title: 'Drive chart', scope: `${drives.length} drives · click one`, info: 'Each bar runs from where a drive started to where it ended. Away team drives right, home team drives left. Solid = scoring drive.', body: h('div', null, h('div', { class: 'team-key' }, h('span', null, h('i', { class: 'sw-dot', style: { background: G.sideColor(0) } }), `${a.abbr} drives →`), h('span', null, `← ${hm.abbr} drives`, h('i', { class: 'sw-dot', style: { background: G.sideColor(1) } }))), driveChart()) }),
          d ? driveField(d) : null));
    }
    drawFlow();

    const scoring = doc.plays.filter((p) => p.score);
    const scoringCard = card({ title: 'Scoring summary', scope: `${scoring.length} scores`, body: h('div', null, ...scoring.map((p) => { const t = G.team(doc, p.team); return h('div', { class: 'play-row' }, h('div', { class: 't-label num' }, `${qName(p.period)} ${p.clock}`), h('div', { class: 'row', style: { flexWrap: 'nowrap', alignItems: 'flex-start' } }, t ? avatar(t.logo, 20, { logo: true, label: t.abbr }) : null, h('span', { class: 'ink2' }, p.text)), h('span', { class: 'score-tag' }, `${p.away}–${p.home}`)); })) });

    // Situational efficiency from team stats (third/fourth down, red zone) as their own compare.
    const ts = doc.teamStats;
    const eff = ts.filter((r) => /Eff|redZone|possession/i.test(r.key));
    const volume = ts.filter((r) => !eff.includes(r));

    const athlete = (id) => { for (const tb of doc.box) for (const g of tb.groups) { const at = g.athletes.find((x) => x.id === id); if (at) return true; } return false; };
    const stat = (id, group, key) => { for (const tb of doc.box) { const g = tb.groups.find((x) => x.name === group); if (!g) continue; const at = g.athletes.find((x) => x.id === id); if (!at) continue; const i = g.keys.indexOf(key); if (i >= 0) return at.stats[i]; const j = g.keys.findIndex((k) => k.split(/[/-]/).includes(key)); if (j >= 0) { const parts = String(at.stats[j]).split(/[/-]/); return parts[g.keys[j].split(/[/-]/).indexOf(key)]; } } return undefined; };
    const nz = (v) => (v == null || v === '' ? 0 : Number(v));
    const resolve = (p) => {
      const id = String(p.id).split(':').pop(); if (!athlete(id)) return null;
      const m = {
        'passing-yards': () => nz(stat(id, 'passing', 'passingYards')), 'passing-tds': () => nz(stat(id, 'passing', 'passingTouchdowns')), completions: () => nz(stat(id, 'passing', 'completions')), 'passing-attempts': () => nz(stat(id, 'passing', 'passingAttempts')), 'pass-attempts': () => nz(stat(id, 'passing', 'passingAttempts')), tackles: () => nz(stat(id, 'defensive', 'totalTackles')), assists: () => nz(stat(id, 'defensive', 'totalTackles')) - nz(stat(id, 'defensive', 'soloTackles')), sacks: () => nz(stat(id, 'defensive', 'sacks')), interceptions: () => nz(stat(id, 'passing', 'interceptions')),
        'rushing-yards': () => nz(stat(id, 'rushing', 'rushingYards')), 'rushing-attempts': () => nz(stat(id, 'rushing', 'rushingAttempts')), 'receiving-yards': () => nz(stat(id, 'receiving', 'receivingYards')), receptions: () => nz(stat(id, 'receiving', 'receptions')), 'longest-reception': () => nz(stat(id, 'receiving', 'longReception')),
        'anytime-td': () => (nz(stat(id, 'rushing', 'rushingTouchdowns')) + nz(stat(id, 'receiving', 'receivingTouchdowns')) > 0 ? 1 : 0), 'rush-rec-yards': () => nz(stat(id, 'rushing', 'rushingYards')) + nz(stat(id, 'receiving', 'receivingYards')), 'pass-rush-yards': () => nz(stat(id, 'passing', 'passingYards')) + nz(stat(id, 'rushing', 'rushingYards')),
      }[p.market];
      return m ? m() : null;
    };

    return buildGameShell(doc, [
      { id: 'flow', label: 'Game flow', node: section('flow', 'Game flow', 'win probability and every drive', flowHost) },
      { id: 'scoring', label: 'Scoring', node: section('scoring', 'Scoring & leaders', null, h('div', { class: 'split-2' }, scoringCard, leadersCard(doc))) },
      { id: 'teams', label: 'Team stats', node: section('teams', 'Team stats', null, h('div', { class: 'split-2' }, teamCompare(doc, volume, { title: 'Volume & yardage', lowerBetter: ['turnovers', 'fumblesLost', 'interceptions', 'totalPenaltiesYards', 'sacksYardsLost'] }), eff.length ? teamCompare(doc, eff, { title: 'Situational', scope: 'third down, fourth down, red zone, time of possession' }) : null)) },
      { id: 'box', label: 'Box score', node: section('box', 'Box score', null, espnBoxCard(doc, { hideGroups: ['kickReturns', 'puntReturns'] })) },
      { id: 'lines', label: 'Lines & props', node: section('lines', 'Lines & props', 'what the market expected, and what happened', h('div', { class: 'split-2' }, linesCard(doc), seasonSeriesCard(doc) || card({ title: 'Research notes', body: h('div', { class: 'stack t-sm ink2' }, statusPill(doc.status.epa), h('div', null, 'Snap counts and routes run are not held; target share comes from the box score.')) })), propsResultCard(doc, resolve)) },
      { id: 'plays', label: 'Play-by-play', node: section('plays', 'Play-by-play', null, playLogCard(doc, doc.plays.map((p) => ({ period: p.period, clock: p.clock, text: p.text, team: p.team, key: p.score || p.turnover, tag: p.score ? `${p.away}–${p.home}` : p.turnover ? 'TO' : null })), { periodName: qName, keyLabel: 'Scores & turnovers' })) },
    ]);
  }

  GAME_SPORTS.nfl = { label: 'NFL', games: [{ slug: 'nfl-dal-nyg', build }] };
  GAME_SPORTS.cfb = { label: 'CFB', games: [{ slug: 'cfb-osu-tex', build }] };
})();
