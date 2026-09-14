/* Soccer and tennis game pages. */
(() => {
  /* ---------------- Soccer ---------------- */
  const minuteOf = (e) => (e.sec != null ? e.sec / 60 : G.numOf(e.minute) || 0);

  function soccerBuild(doc) {
    const [a, hm] = doc.header.teams;
    const sideOf = (team) => { if (team == null) return null; const t = String(team); return t === String(a.id) || t === a.name ? 0 : t === String(hm.id) || t === hm.name ? 1 : null; };
    const shots = doc.events.filter((e) => e.x != null && /Shot|Goal/.test(e.type || '')).map((e) => ({ ...e, side: sideOf(e.team) }));

    /* Match timeline: one lane per team, 0-90+ minutes. */
    const timelineEvents = [...doc.keyEvents.filter((k) => /Goal|Card|Substitution/.test(k.type || '')).map((k) => ({ ...k, side: sideOf(k.team), kind: /Goal/.test(k.type) ? 'goal' : /Red/.test(k.type) ? 'red' : /Yellow/.test(k.type) ? 'yellow' : 'sub' })),
      ...shots.filter((x) => !/Goal/.test(x.type)).map((x) => ({ ...x, kind: 'shot' }))];
    const timeline = svgHost((W) => {
      const H = 150, m = { l: 56, r: 16 }, maxMin = Math.max(95, ...timelineEvents.map(minuteOf)) + 1;
      const X = (mm) => m.l + (mm / maxMin) * (W - m.l - m.r); const lane = [48, 108];
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Match timeline' });
      svg.append(s('rect', { x: m.l, y: 20, width: X(45) - m.l, height: H - 40, fill: 'var(--card-sunk)', rx: 6 }), s('rect', { x: X(45), y: 20, width: X(maxMin) - X(45), height: H - 40, fill: 'color-mix(in oklch, var(--card-sunk) 55%, var(--card))', rx: 6 }));
      for (const mm of [0, 15, 30, 45, 60, 75, 90]) svg.append(s('text', { class: 'axis-t', x: X(mm), y: H - 4, 'text-anchor': 'middle' }, `${mm}'`), s('line', { x1: X(mm), x2: X(mm), y1: 20, y2: H - 20, stroke: 'var(--line-soft)' }));
      [a, hm].forEach((t, i) => { svg.append(s('image', { href: t.logo, x: 8, y: lane[i] - 12, width: 24, height: 24 }), s('text', { class: 'axis-t', x: 36, y: lane[i] + 4 }, t.abbr), s('line', { x1: m.l, x2: W - m.r, y1: lane[i], y2: lane[i], stroke: 'var(--line)' })); });
      for (const e of timelineEvents) {
        if (e.side == null) continue; const x = X(minuteOf(e)), y = lane[e.side], col = G.sideColor(e.side);
        let mark;
        if (e.kind === 'goal') mark = s('g', null, s('circle', { cx: x, cy: y, r: 10, fill: col, stroke: 'var(--card)', 'stroke-width': 2 }), s('text', { x, y: y + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#fff', 'font-weight': 700 }, 'G'));
        else if (e.kind === 'red' || e.kind === 'yellow') mark = s('rect', { x: x - 4, y: y - 8, width: 8, height: 12, rx: 1.5, fill: e.kind === 'red' ? '#d0312d' : '#e8b90c', stroke: 'var(--card)' });
        else if (e.kind === 'sub') mark = s('path', { d: `M${x - 6},${y - 4} h12 m-3,-3 l3,3 l-3,3 M${x + 6},${y + 5} h-12 m3,-3 l-3,3 l3,3`, stroke: 'var(--ink-muted)', 'stroke-width': 1.5, fill: 'none' });
        else mark = s('circle', { cx: x, cy: y + (e.side ? 14 : -14), r: 3.5, fill: /On Target|Woodwork/.test(e.type) ? col : 'var(--card)', stroke: col, 'stroke-width': 1.5 });
        svg.append(hoverable(mark, () => [tipRow(e.minute || '', e.type), tipText(e.text || '')]));
      }
      return h('div', { class: 'chart' }, svg);
    });

    /* Shot map: full pitch, each team attacking one goal. */
    function pitch() {
      let who = 'all'; const wrap = h('div');
      const draw = () => {
        const rs = shots.filter((x) => who === 'all' || x.side === who);
        put(wrap, h('div', { class: 'row', style: { marginBottom: '8px' } }, segmented([{ value: 'all', label: 'Both teams' }, { value: 0, label: a.abbr }, { value: 1, label: hm.abbr }], who, (v) => { who = v; draw(); }), h('span', { class: 't-label' }, `${rs.length} located shots`)),
          svgHost((W) => {
            const H = W * (68 / 105); const X = (x) => (x / 100) * W; const Y = (y) => (y / 100) * H;
            const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Shot map, full pitch' });
            const L = { fill: 'none', stroke: 'oklch(99% 0 0 / .8)', 'stroke-width': 1.5 };
            svg.append(s('rect', { x: 0, y: 0, width: W, height: H, rx: 8, fill: 'oklch(62% 0.09 150)' }), s('line', { x1: X(50), x2: X(50), y1: 0, y2: H, ...L }), s('circle', { cx: X(50), cy: Y(50), r: (9.15 / 105) * W, ...L }));
            for (const sd of [0, 100]) { const dir = sd ? -1 : 1; svg.append(s('rect', { x: sd ? X(100 - 15.7) : 0, y: Y(20.4), width: X(15.7), height: Y(79.6) - Y(20.4), ...L }), s('rect', { x: sd ? X(100 - 5.2) : 0, y: Y(36.8), width: X(5.2), height: Y(63.2) - Y(36.8), ...L }), s('rect', { x: sd ? X(100) - 4 : 0, y: Y(44.6), width: 4, height: Y(55.4) - Y(44.6), fill: '#fff' })); void dir; }
            svg.append(s('text', { x: X(25), y: 16, 'text-anchor': 'middle', 'font-size': 12, fill: '#fff', 'font-weight': 600 }, `← ${a.abbr} attack`), s('text', { x: X(75), y: 16, 'text-anchor': 'middle', 'font-size': 12, fill: '#fff', 'font-weight': 600 }, `${hm.abbr} attack →`));
            for (const e of rs) {
              const x = e.side === 1 ? e.x : 100 - e.x, y = e.side === 1 ? e.y : 100 - e.y; const col = e.side === 0 ? '#9cc3f0' : '#f4b27a';
              const goal = /Goal/.test(e.type), on = /On Target/.test(e.type), wood = /Woodwork/.test(e.type);
              const mark = goal ? s('circle', { cx: X(x), cy: Y(y), r: 9, fill: '#fff', stroke: G.sideColor(e.side), 'stroke-width': 4 }) : s('circle', { cx: X(x), cy: Y(y), r: on || wood ? 6 : 5, fill: on || wood ? col : 'none', stroke: col, 'stroke-width': 2 });
              svg.append(hoverable(mark, () => [tipRow(e.type, `${e.minute} · ${[a, hm][e.side]?.abbr || ''}`), tipText(e.text)]));
            }
            return h('div', { class: 'chart' }, svg);
          }),
          vizLegend([['Goal (white, team ring)', '#ffffff'], ['On target / woodwork (filled)', 'var(--ink-2)'], ['Off target / blocked (ring)', 'var(--ink-muted)'], [a.abbr, '#9cc3f0'], [hm.abbr, '#f4b27a']]));
      };
      draw();
      return wrap;
    }

    /* Lineups: formation diagram per team, rows from the formation string. */
    const lineRank = (p) => { const x = p.pos || ''; if (x === 'G') return 0; if (/B$|^CD|^D/.test(x)) return 1; if (/^DM/.test(x)) return 2; if (/^(LM|RM|CM|M)/.test(x)) return 3; if (/^AM/.test(x)) return 4; return 5; };
    const lateral = (p) => { const x = p.pos || ''; const w = /B$/.test(x) && !/^CD/.test(x) ? 2 : 1; return /(^L|-L$)/.test(x) ? -w : /(^R|-R$)/.test(x) ? w : 0; };
    function lineup(r) {
      const t = G.team(doc, r.team); const side = sideOf(r.team);
      const starters = r.players.filter((p) => p.starter).sort((x, y) => lineRank(x) - lineRank(y));
      const counts = [1, ...(r.formation || '').split('-').map(Number)];
      const rows = []; let k = 0; for (const c of counts) { rows.push(starters.slice(k, k + c).sort((x, y) => lateral(x) - lateral(y))); k += c; }
      const pitchBox = svgHost((W) => {
        const H = 360; const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${t.name} lineup` });
        svg.append(s('rect', { x: 0, y: 0, width: W, height: H, rx: 10, fill: 'oklch(62% 0.09 150)' }), s('line', { x1: 0, x2: W, y1: 16, y2: 16, stroke: 'rgba(255,255,255,.5)' }), s('rect', { x: W * 0.3, y: H - 60, width: W * 0.4, height: 58, fill: 'none', stroke: 'rgba(255,255,255,.6)' }));
        rows.forEach((row, ri) => { const y = H - 34 - (ri * (H - 70)) / Math.max(1, rows.length - 1); row.forEach((p, pi) => { const x = ((pi + 1) * W) / (row.length + 1);
          const g = s('g'); g.append(s('circle', { cx: x, cy: y, r: 15, fill: G.sideColor(side), stroke: '#fff', 'stroke-width': 2 }), s('text', { x, y: y + 4, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: '#fff' }, p.jersey || ''), s('text', { x, y: y + 29, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 600, fill: '#fff' }, (p.short || p.name).replace(/^\w\. /, '')));
          if (p.stats.totalGoals) g.append(s('circle', { cx: x + 13, cy: y - 12, r: 6, fill: '#fff' }), s('text', { x: x + 13, y: y - 8.5, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 700, fill: 'var(--ink)' }, 'G'));
          if (p.stats.redCards) g.append(s('rect', { x: x - 19, y: y - 19, width: 7, height: 10, rx: 1, fill: '#d0312d' })); else if (p.stats.yellowCards) g.append(s('rect', { x: x - 19, y: y - 19, width: 7, height: 10, rx: 1, fill: '#e8b90c' }));
          if (p.subOut) g.append(s('text', { x: x + 17, y: y + 14, 'font-size': 11, fill: '#fff' }, '↓'));
          svg.append(hoverable(g, () => [tipRow(p.name, `${p.posName} · #${p.jersey}`), tipText(`Shots ${p.stats.totalShots ?? 0} (${p.stats.shotsOnTarget ?? 0} on target) · goals ${p.stats.totalGoals ?? 0} · assists ${p.stats.goalAssists ?? 0}`), tipText(`Fouls ${p.stats.foulsCommitted ?? 0} committed, ${p.stats.foulsSuffered ?? 0} won${p.pos === 'G' ? ` · saves ${p.stats.saves ?? '—'}` : ''}${p.subOut ? ' · subbed off' : ''}`)]));
        }); });
        return h('div', { class: 'chart' }, svg);
      });
      const subs = r.players.filter((p) => p.subIn);
      return card({ title: `${t.name}`, scope: r.formation, body: h('div', null, pitchBox, h('div', { class: 't-label', style: { marginTop: '8px' } }, subs.length ? `Subs used: ${subs.map((p) => p.short || p.name).join(', ')}` : 'No subs used')) });
    }

    let pTeam = hm.id; const playersHost = h('div');
    const drawPlayers = () => { const r = doc.rosters.find((x) => String(x.team) === String(pTeam));
      put(playersHost, segmented([{ value: a.id, label: a.abbr }, { value: hm.id, label: hm.abbr }], pTeam, (v) => { pTeam = v; drawPlayers(); }),
        dataTable([{ key: 'name', label: 'Player', render: (p) => h('span', null, h('a', { class: 'lnk', href: '#player' }, p.name), h('span', { class: 't-label' }, ` ${p.pos || ''}${p.starter ? '' : p.subIn ? ' · sub' : ' · unused'}`)) }, { key: 'sh', label: 'Shots', num: true }, { key: 'sot', label: 'On target', num: true }, { key: 'g', label: 'G', num: true }, { key: 'a', label: 'A', num: true }, { key: 'fc', label: 'Fouls', num: true }, { key: 'fs', label: 'Fouled', num: true }, { key: 'off', label: 'Offside', num: true }, { key: 'sv', label: 'Saves', num: true }, { key: 'cards', label: 'Cards' }],
          r.players.filter((p) => p.starter || p.subIn).map((p) => ({ name: p.name, pos: p.pos, starter: p.starter, subIn: p.subIn, sh: p.stats.totalShots, sot: p.stats.shotsOnTarget, g: p.stats.totalGoals, a: p.stats.goalAssists, fc: p.stats.foulsCommitted, fs: p.stats.foulsSuffered, off: p.stats.offsides, sv: p.pos === 'G' ? p.stats.saves : null, cards: p.stats.redCards ? 'Red' : p.stats.yellowCards ? 'Yellow' : '' })), { sortKey: null })); };
    drawPlayers();

    const form = card({ title: 'Form coming in', scope: 'last five, all competitions', body: h('div', { class: 'stack' }, ...doc.lastFive.map((lf) => { const t = G.team(doc, lf.team); return h('div', null, h('div', { class: 'row', style: { marginBottom: '6px' } }, avatar(t.logo, 22, { logo: true, label: t.abbr }), h('b', null, t.name)), h('div', { class: 'row' }, ...lf.events.map((e) => { const el = h('span', { class: 'mini-form' }, h('span', { style: { background: e.result === 'W' ? 'var(--good)' : e.result === 'L' ? 'var(--bad)' : 'var(--ink-muted)' } }, e.result), h('span', { style: { background: 'transparent', color: 'var(--ink-2)', width: 'auto' } }, `${e.opp} ${e.score}`)); Tip.bind(el, () => [tipRow(e.score, `${e.result} vs ${e.opp}`), tipText(G.when(e.date))]); return el; }))); })) });

    const rosterAll = doc.rosters.flatMap((r) => r.players);
    const resolve = (p) => { const id = String(p.id).split(':').pop(); const pl = rosterAll.find((x) => x.id === id); if (!pl || !(pl.starter || pl.subIn)) return null; const st = pl.stats; return { shots: st.totalShots, 'shots-on-target': st.shotsOnTarget, 'anytime-goalscorer': st.totalGoals, goals: st.totalGoals, assists: st.goalAssists, saves: st.saves, 'goals-conceded': st.goalsConceded, 'fouls-committed': st.foulsCommitted }[p.market] ?? null; };

    const hero = gameHero(doc, { periods: (i) => (i === 0 ? '1H' : '2H'), chips: lineResultChips(doc).slice(-1), sub: doc.keyEvents.filter((k) => /Goal|Red/.test(k.type)).map((k) => `${k.type === 'Goal' ? '⚽' : '🟥'} ${k.who?.[0] || ''} ${k.minute}`).join('  ·  ') });
    let period = 1;
    const log = doc.events.filter((e) => e.text).map((e) => { if (/Second Half begins/i.test(e.text)) period = 2; return { period, clock: e.minute, text: e.text, team: sideOf(e.team) == null ? null : [a, hm][sideOf(e.team)].id, key: /Goal|Card|Woodwork/.test(e.type || ''), tag: /Goal/.test(e.type || '') ? 'GOAL' : null }; });

    return { hero, sections: buildGameShell(doc, [
      { id: 'flow', label: 'Match flow', node: section('flow', 'Match flow', 'no win probability is published for soccer', card({ title: 'Timeline', scope: 'goals, cards, subs and every located shot', body: h('div', null, timeline, vizLegend([['Goal', 'var(--ink)'], ['Yellow card', '#e8b90c'], ['Red card', '#d0312d'], ['Shot (filled = on target)', 'var(--ink-muted)']])) })) },
      { id: 'shots', label: 'Shot map', node: section('shots', 'Shot map', null, h('div', { class: 'split-3-2' }, card({ title: 'Where the shots came from', scope: 'ESPN commentary positions', body: pitch(), foot: `${shots.length} located in commentary · team stats count ${doc.teamStats.find((r) => r.key === 'totalShots')?.away ?? '—'} + ${doc.teamStats.find((r) => r.key === 'totalShots')?.home ?? '—'} shots · xG ${doc.status.xg}` }), teamCompare(doc, doc.teamStats.filter((r) => ['possessionPct', 'totalShots', 'shotsOnTarget', 'wonCorners', 'saves', 'offsides', 'foulsCommitted', 'yellowCards', 'redCards'].includes(r.key)), { title: 'Key numbers', lowerBetter: ['foulsCommitted', 'yellowCards', 'redCards', 'offsides'] }))) },
      { id: 'lineups', label: 'Lineups', node: section('lineups', 'Lineups', 'formation as announced · hover a player', h('div', { class: 'formation' }, ...[a, hm].map((t) => lineup(doc.rosters.find((r) => String(r.team) === String(t.id))))), card({ title: 'Player stats', dense: true, body: playersHost })) },
      { id: 'teams', label: 'Team stats', node: section('teams', 'Team stats', null, h('div', { class: 'split-2' }, teamCompare(doc, doc.teamStats.filter((r) => /Pass|Cross|LongBall|longball|Tackle|tackle|Clearance|interceptions|blocked/i.test(r.key) && !/Pct/.test(r.key)), { title: 'Passing & defending' }), form)) },
      { id: 'lines', label: 'Lines & props', node: section('lines', 'Lines & props', null, linesCard(doc, { threeWay: true }), propsResultCard(doc, resolve)) },
      { id: 'plays', label: 'Commentary', node: section('plays', 'Commentary', null, playLogCard(doc, log, { periodName: (p) => (p === 1 ? '1H' : '2H'), title: 'Commentary', keyLabel: 'Goals, cards, woodwork' })) },
    ]) };
  }

  /* ---------------- Tennis ---------------- */
  function tennisBuild(doc) {
    const T = doc.tennis; const [p1, p2] = T.players;
    const last = (n) => n.split(' ').slice(-1)[0];
    const pseudo = { ...doc, header: { ...doc.header, teams: [{ id: 'p1', abbr: last(p1.name), name: p1.name, logo: null }, { id: 'p2', abbr: last(p2.name), name: p2.name, logo: null }] } };
    const sets = T.score.split(' ').map((st) => { const m = st.match(/^(\d+)-(\d+)(?:\((\d+)\))?/); return m ? { w: Number(m[1]), l: Number(m[2]), tb: m[3] } : null; }).filter(Boolean);
    const games = (p) => sets.map((st) => (p.won ? st.w : st.l));
    const S = (p) => p.stats;
    const opp = (p) => (p === p1 ? p2 : p1);
    const pct = (x, y) => (y ? `${fmt.n((100 * x) / y, 0)}%` : '—');
    const row = (label, f, key) => ({ key: key || label, label, away: f(p1), home: f(p2) });
    const rows = [
      row('Aces', (p) => S(p).ace), row('Double faults', (p) => S(p).df, 'df'),
      row('1st serve in', (p) => pct(S(p)['1stIn'], S(p).svpt)), row('1st serve points won', (p) => pct(S(p)['1stWon'], S(p)['1stIn'])), row('2nd serve points won', (p) => pct(S(p)['2ndWon'], S(p).svpt - S(p)['1stIn'])),
      row('Service points won', (p) => pct(S(p)['1stWon'] + S(p)['2ndWon'], S(p).svpt)), row('Return points won', (p) => pct(S(opp(p)).svpt - S(opp(p))['1stWon'] - S(opp(p))['2ndWon'], S(opp(p)).svpt)),
      row('Break points saved', (p) => `${S(p).bpSaved}/${S(p).bpFaced}`), row('Break points won', (p) => `${S(opp(p)).bpFaced - S(opp(p)).bpSaved}/${S(opp(p)).bpFaced}`),
      row('Total points won', (p) => S(p)['1stWon'] + S(p)['2ndWon'] + (S(opp(p)).svpt - S(opp(p))['1stWon'] - S(opp(p))['2ndWon'])), row('Service games', (p) => S(p).SvGms),
    ];
    const side = (p, right) => h('div', { class: `team-side${right ? ' home' : ''}` }, right ? null : avatar(null, 60, { label: p.name, color: '#1f3a5f' }), h('div', { style: { minWidth: 0 } }, h('a', { class: `lnk t-heading${p.won ? ' won' : ''}`, href: '#player' }, p.name), h('div', { class: 't-label' }, [`No. ${p.rank}`, p.seed ? `seed ${p.seed}` : null, p.ioc, p.hand === 'R' ? 'right-handed' : p.hand === 'L' ? 'left-handed' : null].filter(Boolean).join(' · '))), right ? avatar(null, 60, { label: p.name, color: '#1f3a5f' }) : null);
    const hero = h('section', { class: 'hero' },
      h('div', { class: 'score-hero' }, side(p1, false), h('div', { style: { textAlign: 'center' } }, h('div', { class: 'row', style: { justifyContent: 'center', marginBottom: '6px' } }, h('span', { class: 'chip' }, 'Final')), h('div', { class: 'score num' }, h('span', { class: p1.won ? '' : 'lose' }, String(sets.filter((st, i) => games(p1)[i] > games(p2)[i]).length)), ' – ', h('span', { class: p2.won ? '' : 'lose' }, String(sets.filter((st, i) => games(p2)[i] > games(p1)[i]).length))), h('div', { class: 't-label', style: { marginTop: '8px' } }, `${T.tourney} · ${T.round} · ${T.surface}${T.indoor === 'I' ? ' (indoor)' : ''} · ${fmt.n(T.minutes)} min · best of ${T.bestOf}`)), side(p2, true)),
      h('div', { class: 'ls-wrap' }, h('table', { class: 'ls-table' }, h('thead', null, h('tr', null, h('th', null, ''), ...sets.map((_, i) => h('th', null, `Set ${i + 1}`)))), h('tbody', null, ...[p1, p2].map((p) => h('tr', null, h('td', null, h('b', null, last(p.name))), ...sets.map((st, i) => h('td', { style: { fontWeight: games(p)[i] > games(opp(p))[i] ? 700 : 400 } }, String(games(p)[i]), st.tb && games(p)[i] < games(opp(p))[i] ? h('sup', null, st.tb) : null))))))));

    const formCard = (p) => {
      const season = p.season.slice().sort((x, y) => y.date.localeCompare(x.date));
      const surf = U.groupBy(season, (x) => x.surface);
      const hard = (surf[T.surface] || []).filter((x) => x.me.svpt);
      const avg = (f) => U.avg(hard.map(f).filter((v) => v != null && !Number.isNaN(v)));
      const me = S(p);
      const cmp = [
        { stat: 'Aces', match: me.ace, season: avg((x) => x.me.ace) },
        { stat: '1st serve in %', match: (100 * me['1stIn']) / me.svpt, season: avg((x) => (100 * x.me['1stIn']) / x.me.svpt) },
        { stat: '1st serve won %', match: (100 * me['1stWon']) / me['1stIn'], season: avg((x) => (100 * x.me['1stWon']) / x.me['1stIn']) },
        { stat: 'Return pts won %', match: (100 * (S(opp(p)).svpt - S(opp(p))['1stWon'] - S(opp(p))['2ndWon'])) / S(opp(p)).svpt, season: avg((x) => (100 * (x.them.svpt - x.them['1stWon'] - x.them['2ndWon'])) / x.them.svpt) },
      ];
      return card({ title: p.name, scope: `${season.filter((x) => x.won).length}-${season.filter((x) => !x.won).length} in ${T.date.slice(0, 4)} through this event`, body: h('div', { class: 'stack' },
        h('div', { class: 'row' }, ...season.slice(0, 10).map((x) => { const el = h('span', { class: 'mini-form' }, h('span', { style: { background: x.won ? 'var(--good)' : 'var(--bad)' } }, x.won ? 'W' : 'L')); Tip.bind(el, () => [tipRow(x.score, `${x.won ? 'W' : 'L'} vs ${x.opp}${x.oppRank ? ` (No. ${x.oppRank})` : ''}`), tipText(`${x.tourney} ${x.round} · ${x.surface}`)]); return el; }), h('span', { class: 't-label' }, 'last 10, newest first')),
        h('div', { class: 't-label' }, Object.entries(surf).map(([k, v]) => `${k} ${v.filter((x) => x.won).length}-${v.filter((x) => !x.won).length}`).join(' · ')),
        dataTable([{ key: 'stat', label: 'This match vs season' }, { key: 'match', label: 'This match', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'season', label: `${T.surface} avg`, num: true, fmt: (v) => fmt.n(v, 1) }], cmp, { sortKey: null })) });
    };

    const sections = [
      { id: 'stats', label: 'Match stats', node: section('stats', 'Match stats', 'serve and return, both players', h('div', { class: 'split-2' }, teamCompare(pseudo, rows, { title: 'Head to head in this match', lowerBetter: ['df'] }), card({ title: 'Head-to-head', scope: `${T.h2h.length} meetings since 2024`, dense: true, body: dataTable([{ key: 'date', label: 'Event', fmt: (v, r) => `${r.tourney} ${r.date.slice(0, 4)}` }, { key: 'surface', label: 'Surface' }, { key: 'round', label: 'Rd' }, { key: 'winner', label: 'Winner' }, { key: 'score', label: 'Score' }], T.h2h, { sortKey: null }), foot: 'TennisMyLife results 2024–2026' }))) },
      { id: 'form', label: 'Form', node: section('form', 'Form', `${T.surface}-court season numbers against this match`, h('div', { class: 'split-2' }, formCard(p1), formCard(p2))) },
      { id: 'lines', label: 'Lines', node: section('lines', 'Lines & point-by-point', null, card({ title: 'What isn’t held', body: h('div', { class: 'stack' }, statusPill(`Point-by-point: ${doc.status.pointByPoint}`), statusPill(`Odds: ${doc.status.odds}`), h('div', { class: 't-sm ink2' }, 'Game-by-game momentum and break timing need a point-by-point source. Everything above comes from the match stat line.')) })) },
    ];
    return { hero, sections: buildGameShell(doc, sections) };
  }

  GAME_SPORTS.soccer = { label: 'Soccer', games: [{ slug: 'soccer-mci-mun', build: soccerBuild }] };
  GAME_SPORTS.tennis = { label: 'Tennis', games: [{ slug: 'tennis-paul-zverev', build: tennisBuild }] };
})();
