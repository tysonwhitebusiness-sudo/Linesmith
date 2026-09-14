/* NBA and NHL game pages. */
(() => {
  /* ---------------- NBA ---------------- */
  const qName = (p) => (p > 4 ? (p === 5 ? 'OT' : `${p - 4}OT`) : `Q${p}`);
  const clockSec = (period, clock, len) => { const [m, sec] = String(clock || '0:00').split(':').map(Number); return (period - 1) * len + (len - (m * 60 + (sec || 0))); };

  function nbaCourt(doc, shots) {
    const [a, hm] = doc.header.teams;
    let who = 'all', show = 'all';
    const wrap = h('div');
    const zoneOf = (sh) => { const d = Math.hypot(sh.x - 25, sh.yy - 5.25); if (sh.att === 3) return sh.yy < 14 ? 'Corner 3' : 'Above-break 3'; if (d <= 4) return 'Restricted area'; if (Math.abs(sh.x - 25) <= 8 && sh.yy <= 19) return 'Paint (non-RA)'; return 'Mid-range'; };
    const draw = () => {
      const rs = shots.filter((x) => (who === 'all' || x.team === who) && (show === 'all' || (show === 'made') === x.made));
      const zoneRows = [];
      for (const t of [a, hm]) { const ts = shots.filter((x) => x.team === t.id); const by = U.groupBy(ts, zoneOf); for (const [z, xs] of Object.entries(by)) zoneRows.push({ team: t.abbr, zone: z, fga: xs.length, fg: (100 * xs.filter((x) => x.made).length) / xs.length, pts: U.sum(xs.filter((x) => x.made).map((x) => x.att)) }); }
      put(wrap,
        h('div', { class: 'row', style: { marginBottom: '8px' } }, segmented([{ value: 'all', label: 'Both teams' }, { value: a.id, label: a.abbr }, { value: hm.id, label: hm.abbr }], who, (v) => { who = v; draw(); }), segmented([{ value: 'all', label: 'All' }, { value: 'made', label: 'Makes' }, { value: 'miss', label: 'Misses' }], show, (v) => { show = v; draw(); }), h('span', { class: 't-label' }, `${rs.length} field goal attempts`)),
        h('div', { class: 'split-2' },
          svgHost((W) => {
            const H = W * (47 / 50), X = (x) => (x / 50) * W, Y = (y) => (y / 47) * H;
            const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Shot chart' });
            const L = { fill: 'none', stroke: 'var(--line)', 'stroke-width': 1.5 };
            const ang = Math.acos(22 / 23.75), yC = 5.25 + 23.75 * Math.sin(ang);
            svg.append(s('rect', { x: 0, y: 0, width: W, height: H, rx: 8, fill: 'oklch(97% 0.012 70)' }), s('rect', { x: X(17), y: 0, width: X(16), height: Y(19), ...L }), s('circle', { cx: X(25), cy: Y(19), r: X(6), ...L }), s('circle', { cx: X(25), cy: Y(5.25), r: X(0.75), stroke: 'var(--ink-muted)', fill: 'none', 'stroke-width': 2 }), s('line', { x1: X(22), x2: X(28), y1: Y(4), y2: Y(4), stroke: 'var(--ink)', 'stroke-width': 2 }),
              s('path', { d: `M${X(3)},0 L${X(3)},${Y(yC)} A${X(23.75)},${Y(23.75)} 0 0 0 ${X(47)},${Y(yC)} L${X(47)},0`, ...L }));
            for (const sh of rs) {
              const col = G.sideColor(sh.team === a.id ? 0 : 1);
              const mark = sh.made ? s('circle', { cx: X(sh.x), cy: Y(sh.yy), r: 4.5, fill: col, stroke: 'var(--card)', 'stroke-width': 1.5 }) : s('path', { d: `M${X(sh.x) - 3.5},${Y(sh.yy) - 3.5}l7,7m0,-7l-7,7`, stroke: col, 'stroke-width': 1.8, opacity: 0.7 });
              svg.append(hoverable(mark, () => [tipRow(sh.made ? 'Made' : 'Missed', `${sh.att}-point attempt · ${G.team(doc, sh.team).abbr}`), tipText(sh.text), tipText(`${qName(sh.period)} ${sh.clock} · ${zoneOf(sh)}`)]));
            }
            return svg;
          }),
          dataTable([{ key: 'team', label: 'Team' }, { key: 'zone', label: 'Zone' }, { key: 'fga', label: 'FGA', num: true }, { key: 'fg', label: 'FG%', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'pts', label: 'Pts', num: true }], zoneRows.filter((r) => who === 'all' || r.team === G.team(doc, who).abbr), { sortKey: 'fga' })),
        vizLegend([[`${a.abbr}`, G.sideColor(0)], [`${hm.abbr}`, G.sideColor(1)], ['● made  ✕ missed', 'transparent']]));
    };
    draw();
    return wrap;
  }

  function nbaBuild(doc) {
    const [a, hm] = doc.header.teams;
    const byId = new Map(doc.plays.map((p) => [p.id, p]));
    const wpPoints = doc.wp.map(([id, home]) => { const p = byId.get(id); return p ? { home, play: p, scoring: false, swingable: !/enters the game|timeout|end of|start of|jump ball|delay/i.test(`${p.type} ${p.text}`), text: p.text, ctx: `${qName(p.period)} ${p.clock} · ${a.abbr} ${p.away}–${p.home} ${hm.abbr}` } : null; }).filter(Boolean);
    const plays = doc.plays;
    const margin = plays.map((p) => p.home - p.away);
    const labels = plays.map((p, i) => (i === 0 || p.period !== plays[i - 1].period ? qName(p.period) : ''));
    const hiM = Math.ceil(Math.max(0, ...margin) / 10) * 10, loM = -Math.ceil(Math.max(0, ...margin.map((m) => -m)) / 10) * 10;
    const leadChart = lineChart({ series: [{ name: `${hm.abbr} lead`, color: 'var(--ink)', values: margin, area: 0 }], labels, height: 220, yMin: loM, yMax: hiM, yTicks: Math.max(1, (hiM - loM) / 10), yFmt: (v) => (v === 0 ? 'Tied' : `${v > 0 ? hm.abbr : a.abbr} +${Math.abs(Math.round(v))}`), refs: [{ y: 0, dash: true }],
      tooltip: (i) => [tipRow(margin[i] === 0 ? 'Tied' : `${margin[i] > 0 ? hm.abbr : a.abbr} by ${Math.abs(margin[i])}`, `${a.abbr} ${plays[i].away}–${plays[i].home} ${hm.abbr}`), tipText(`${qName(plays[i].period)} ${plays[i].clock}`), tipText(plays[i].text)] });
    const leadChanges = margin.filter((m, i) => i && Math.sign(m) && Math.sign(m) !== Math.sign(margin.slice(0, i).reverse().find((x) => x !== 0) || 0)).length;
    const biggest = { away: Math.max(0, ...margin.map((m) => -m)), home: Math.max(0, ...margin) };

    // Scoring runs: unanswered points of 8+.
    const runs = []; let cur = null;
    for (const p of plays.filter((x) => x.score && x.pts > 0)) {
      if (!cur || cur.team !== p.team) { if (cur && cur.pts >= 8) runs.push(cur); cur = { team: p.team, pts: 0, start: p, end: p }; }
      cur.pts += p.pts; cur.end = p;
    }
    if (cur && cur.pts >= 8) runs.push(cur);

    const shots = plays.filter((p) => p.shot && p.x != null && !/free throw/i.test(p.type || '')).map((p) => ({ ...p, yy: p.y + 4.25, made: !!p.score }));
    const athleteStat = () => null;

    return [
      { id: 'flow', label: 'Game flow', node: section('flow', 'Game flow', null, wpCard({ points: wpPoints, doc, periodOf: (p) => qName(p.play.period), foot: 'ESPN win probability · substitutions and timeouts are left out of the swings list' }),
        h('div', { class: 'split-3-2' }, card({ title: 'Lead tracker', scope: `${leadChanges} lead changes`, body: leadChart, foot: `Largest leads: ${a.abbr} ${biggest.away} · ${hm.abbr} ${biggest.home}` }),
          card({ title: 'Scoring runs', scope: '8+ unanswered points', body: runs.length ? h('div', null, ...runs.sort((x, y) => y.pts - x.pts).slice(0, 8).map((r) => { const t = G.team(doc, r.team); return h('div', { class: 'play-row' }, h('div', { class: 't-label num' }, `${qName(r.start.period)} ${r.start.clock}`), h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, avatar(t.logo, 20, { logo: true, label: t.abbr }), h('span', { class: 'ink2' }, `${t.abbr} ${r.pts}-0 run`)), h('span', { class: 'score-tag' }, `${r.end.away}–${r.end.home}`)); })) : h('div', { class: 'state' }, 'No runs of 8+') }))) },
      { id: 'shots', label: 'Shot chart', node: section('shots', 'Shot chart', 'every located field goal attempt, both teams', card({ title: 'Where the shots came from', scope: 'hover a shot for the play', body: nbaCourt(doc, shots), foot: 'ESPN play coordinates (rim at ≈1 ft in the raw feed, shifted to the baseline) · free throws excluded' })) },
      { id: 'teams', label: 'Team stats', node: section('teams', 'Team stats', null, h('div', { class: 'split-2' }, teamCompare(doc, doc.teamStats.filter((r) => !/Pct|leadPercentage|technical|flagrant|teamTurnovers/i.test(r.key)), { lowerBetter: ['turnovers', 'totalTurnovers', 'fouls'] }), leadersCard(doc))) },
      { id: 'box', label: 'Box score', node: section('box', 'Box score', null, espnBoxCard(doc)) },
      { id: 'lines', label: 'Lines & props', node: section('lines', 'Lines & props', null, h('div', { class: 'split-2' }, linesCard(doc), seasonSeriesCard(doc)), propsResultCard(doc, athleteStat)) },
      { id: 'plays', label: 'Play-by-play', node: section('plays', 'Play-by-play', null, playLogCard(doc, plays.map((p) => ({ period: p.period, clock: p.clock, text: p.text, team: p.team, key: p.score && p.pts > 0, tag: p.score && p.pts > 0 ? `${p.away}–${p.home}` : null })), { periodName: qName })) },
    ];
  }

  /* ---------------- NHL ---------------- */
  const pName = (p) => (p > 3 ? (p === 4 ? 'OT' : 'SO') : `P${p}`);
  const SHOTS = ['goal', 'shot-on-goal', 'missed-shot', 'blocked-shot'];

  function rink(doc, evs, roster) {
    const [a, hm] = doc.header.teams; const N = doc.nhl;
    let who = 'all', kind = 'all';
    const wrap = h('div');
    const draw = () => {
      const rs = evs.filter((e) => (who === 'all' || e.side === who) && (kind === 'all' || (kind === 'goals' ? e.type === 'goal' : kind === 'ongoal' ? e.type === 'goal' || e.type === 'shot-on-goal' : true)));
      put(wrap, h('div', { class: 'row', style: { marginBottom: '8px' } }, segmented([{ value: 'all', label: 'Both teams' }, { value: 0, label: a.abbr }, { value: 1, label: hm.abbr }], who, (v) => { who = v; draw(); }), segmented([{ value: 'all', label: 'All attempts' }, { value: 'ongoal', label: 'On goal' }, { value: 'goals', label: 'Goals' }], kind, (v) => { kind = v; draw(); }), h('span', { class: 't-label' }, `${rs.length} events`)),
        svgHost((W) => {
          const pad = 22, H = W * (85 / 200) + pad; const X = (x) => ((x + 100) / 200) * W; const Y = (y) => pad + ((42.5 - y) / 85) * (H - pad);
          const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Full rink shot map' });
          svg.append(s('rect', { x: 1, y: pad + 1, width: W - 2, height: H - pad - 2, rx: (H - pad) * 0.33, fill: 'oklch(97.5% 0.008 230)', stroke: 'var(--line)', 'stroke-width': 2 }));
          svg.append(s('line', { x1: X(0), x2: X(0), y1: pad, y2: H, stroke: 'oklch(62% 0.16 25)', 'stroke-width': 3, opacity: 0.55 }), ...[-25, 25].map((x) => s('line', { x1: X(x), x2: X(x), y1: pad, y2: H, stroke: 'oklch(55% 0.12 250)', 'stroke-width': 3, opacity: 0.5 })), ...[-89, 89].map((x) => s('line', { x1: X(x), x2: X(x), y1: Y(36), y2: Y(-36), stroke: 'oklch(62% 0.16 25)', 'stroke-width': 1.5, opacity: 0.6 })));
          svg.append(s('circle', { cx: X(0), cy: Y(0), r: (15 / 200) * W, fill: 'none', stroke: 'oklch(55% 0.12 250)', opacity: 0.5 }), ...[[-69, 22], [-69, -22], [69, 22], [69, -22]].map(([x, y]) => s('circle', { cx: X(x), cy: Y(y), r: (15 / 200) * W, fill: 'none', stroke: 'oklch(62% 0.16 25)', opacity: 0.45 })), ...[-89, 89].map((x) => s('rect', { x: x < 0 ? X(-92.5) : X(89), y: Y(3), width: (3.5 / 200) * W, height: Y(-3) - Y(3), fill: 'none', stroke: 'var(--ink-muted)', 'stroke-width': 1.5 })));
          svg.append(s('text', { class: 'axis-t', x: X(-60), y: 14, 'text-anchor': 'middle' }, `← ${a.abbr} shoots`), s('text', { class: 'axis-t', x: X(60), y: 14, 'text-anchor': 'middle' }, `${hm.abbr} shoots →`));
          for (const e of rs) {
            const col = G.sideColor(e.side); const x = X(e.xn), y = Y(e.yn);
            const mark = e.type === 'goal' ? s('circle', { cx: x, cy: y, r: 7, fill: col, stroke: 'var(--card)', 'stroke-width': 2 }) : e.type === 'shot-on-goal' ? s('circle', { cx: x, cy: y, r: 4, fill: col, opacity: 0.8 }) : s('circle', { cx: x, cy: y, r: 3.5, fill: 'none', stroke: col, 'stroke-width': 1.5, opacity: 0.7 });
            const shooter = roster[String(e.who)];
            svg.append(hoverable(mark, () => [tipRow(e.type === 'goal' ? 'Goal' : e.type.replace(/-/g, ' '), `${shooter?.name || '—'} · ${G.team(doc, e.espnTeam)?.abbr || ''}`), tipText(`${pName(e.period)} ${e.t}${e.shotType ? ` · ${e.shotType}` : ''} · ${e.situationLabel}`)]));
          }
          return h('div', { class: 'chart' }, svg);
        }),
        vizLegend([['Goal (large)', 'var(--ink)'], ['On goal (filled)', 'var(--ink-2)'], ['Missed or blocked (ring)', 'var(--ink-muted)'], [`${a.abbr}`, G.sideColor(0)], [`${hm.abbr}`, G.sideColor(1)]]));
    };
    draw();
    return wrap;
  }

  function nhlBuild(doc) {
    const [a, hm] = doc.header.teams; const N = doc.nhl; const roster = N.roster;
    const sideOfNhlTeam = (tid) => (tid === N.homeId ? 1 : 0);
    const situation = (code, side) => { if (!code || code.length !== 4) return 'even strength'; const awaySk = Number(code[1]), homeSk = Number(code[2]); const oppGoalie = Number(side === 1 ? code[0] : code[3]); if (oppGoalie === 0) return 'empty net'; const mine = side === 1 ? homeSk : awaySk, theirs = side === 1 ? awaySk : homeSk; return mine > theirs ? 'power play' : mine < theirs ? 'short-handed' : 'even strength'; };
    const evs = N.events.filter((e) => SHOTS.includes(e.type) && e.x != null).map((e) => {
      const shooterTeam = roster[String(e.who)]?.team ?? e.team; const side = sideOfNhlTeam(shooterTeam); const flip = e.side === 'left' ? 1 : -1;
      return { ...e, side, xn: e.x * flip, yn: e.y * flip, espnTeam: side === 0 ? a.id : hm.id, situationLabel: situation(e.situation, side) };
    });
    // Shot attempt flow by minute.
    const lastPeriod = Math.max(...N.events.map((e) => e.period)); const minutes = Math.min(lastPeriod, 4) * 20 - (lastPeriod >= 4 ? 15 : 0);
    const cum = [[], []]; const goalsAt = [];
    for (let m = 0; m <= minutes; m++) for (const sd of [0, 1]) cum[sd][m] = 0;
    const secOf = (e) => { const [mm, ss] = e.t.split(':').map(Number); return (e.period - 1) * 1200 + mm * 60 + ss; };
    for (const e of evs) { const m = Math.min(minutes, Math.ceil(secOf(e) / 60)); for (let k = m; k <= minutes; k++) cum[e.side][k] += 1; if (e.type === 'goal') goalsAt.push({ m, side: e.side, e }); }
    const flow = lineChart({ series: [{ name: `${a.abbr} attempts`, color: G.sideColor(0), values: cum[0] }, { name: `${hm.abbr} attempts`, color: G.sideColor(1), values: cum[1] }], labels: cum[0].map((_, m) => (m % 20 === 0 && m < 60 ? pName(m / 20 + 1) : m === 60 && minutes > 60 ? 'OT' : '')), height: 230, yMin: 0,
      markers: goalsAt.map((g) => ({ i: g.m, y: cum[g.side][g.m], color: G.sideColor(g.side) })),
      tooltip: (m) => [tipRow(String(cum[0][m]), `${a.abbr} shot attempts`, G.sideColor(0)), tipRow(String(cum[1][m]), `${hm.abbr} shot attempts`, G.sideColor(1)), tipText(`Minute ${m}${goalsAt.filter((g) => g.m === m).map((g) => ` · GOAL ${roster[String(g.e.who)]?.name || ''}`).join('')}`)] });

    const goals = N.events.filter((e) => e.type === 'goal');
    const scoringCard = card({ title: 'Scoring summary', scope: `${goals.length} goals`, body: h('div', null, ...goals.map((e) => { const sd = sideOfNhlTeam(roster[String(e.who)]?.team ?? e.team); const t = sd ? hm : a; const nm = (id) => roster[String(id)]?.name; return h('div', { class: 'play-row' }, h('div', { class: 't-label num' }, `${pName(e.period)} ${e.t}`), h('div', { class: 'row', style: { flexWrap: 'nowrap', alignItems: 'flex-start' } }, avatar(roster[String(e.who)]?.headshot, 28, { label: nm(e.who) }), h('div', null, h('div', { class: 'ink2', style: { fontWeight: 600 } }, `${nm(e.who)} (${t.abbr})`), h('div', { class: 't-label' }, [e.shotType, e.a1 ? `assists: ${[e.a1, e.a2].filter(Boolean).map(nm).join(', ')}` : 'unassisted', situation(e.situation, sd)].filter(Boolean).join(' · ')))), h('span', { class: 'score-tag' }, `${e.as_}–${e.hs}`)); })) });

    const goalieRows = ['awayTeam', 'homeTeam'].flatMap((k, i) => (N.box[k].goalies || []).filter((g) => g.toi && g.toi !== '00:00').map((g) => ({ team: [a, hm][i].abbr, name: g.name.default, sa: g.shotsAgainst, sv: g.saves, ga: g.goalsAgainst, pct: g.savePctg != null ? g.savePctg * 100 : null, es: g.evenStrengthShotsAgainst, pp: g.powerPlayShotsAgainst, toi: g.toi, dec: g.decision })));
    const goalies = card({ title: 'Goaltending', dense: true, body: dataTable([{ key: 'team', label: 'Team' }, { key: 'name', label: 'Goalie' }, { key: 'sa', label: 'SA', num: true }, { key: 'sv', label: 'SV', num: true }, { key: 'ga', label: 'GA', num: true }, { key: 'pct', label: 'SV%', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'es', label: 'Even str', num: true }, { key: 'pp', label: 'vs PP', num: true }, { key: 'toi', label: 'TOI', num: true }, { key: 'dec', label: 'Dec' }], goalieRows, { sortKey: null }) });

    let boxTeam = 'homeTeam'; const boxHost = h('div');
    const drawBox = () => { const b = N.box[boxTeam]; const rows = [...(b.forwards || []), ...(b.defense || [])].map((p) => ({ id: p.playerId, name: p.name.default, pos: p.position, g: p.goals, a: p.assists, pts: p.points, pm: p.plusMinus, sog: p.sog, hits: p.hits, blk: p.blockedShots, pim: p.pim, toi: p.toi, fo: p.faceoffWinningPctg ? p.faceoffWinningPctg * 100 : null, headshot: roster[String(p.playerId)]?.headshot }));
      put(boxHost, segmented([{ value: 'awayTeam', label: a.abbr }, { value: 'homeTeam', label: hm.abbr }], boxTeam, (v) => { boxTeam = v; drawBox(); }), dataTable([{ key: 'name', label: 'Skater', render: (r) => h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '8px' } }, avatar(r.headshot, 26, { label: r.name }), h('a', { class: 'lnk', href: '#player' }, r.name), h('span', { class: 't-label' }, r.pos)) }, { key: 'g', label: 'G', num: true }, { key: 'a', label: 'A', num: true }, { key: 'pts', label: 'P', num: true }, { key: 'pm', label: '+/-', num: true }, { key: 'sog', label: 'SOG', num: true }, { key: 'hits', label: 'Hits', num: true }, { key: 'blk', label: 'Blk', num: true }, { key: 'pim', label: 'PIM', num: true }, { key: 'toi', label: 'TOI', num: true }, { key: 'fo', label: 'FO%', num: true, fmt: (v) => (v == null ? '—' : fmt.n(v, 0)) }], rows, { sortKey: 'toi' })); };
    drawBox();

    const pens = N.events.filter((e) => e.type === 'penalty');
    const byPeriodShots = [1, 2, 3, 4].filter((p) => p <= lastPeriod).map((p) => ({ period: pName(p), away: evs.filter((e) => e.period === p && e.side === 0 && (e.type === 'goal' || e.type === 'shot-on-goal')).length, home: evs.filter((e) => e.period === p && e.side === 1 && (e.type === 'goal' || e.type === 'shot-on-goal')).length, awayAtt: evs.filter((e) => e.period === p && e.side === 0).length, homeAtt: evs.filter((e) => e.period === p && e.side === 1).length }));

    const hero = gameHero(doc, { periods: (i) => pName(i + 1), extraCols: [{ label: 'SOG', value: (t) => (t === a ? U.sum(byPeriodShots.map((x) => x.away)) : U.sum(byPeriodShots.map((x) => x.home))) }], chips: lineResultChips(doc) });
    return { hero, sections: [
      { id: 'flow', label: 'Game flow', node: section('flow', 'Game flow', 'no win probability is published for hockey, so the flow is shot attempts', h('div', { class: 'split-3-2' }, card({ title: 'Shot attempts', scope: 'cumulative by minute · dots are goals', info: 'Shot attempts = goals + shots on goal + missed + blocked (Corsi). The team taking more attempts usually controlled play.', body: h('div', null, vizLegend([[`${a.abbr}`, G.sideColor(0)], [`${hm.abbr}`, G.sideColor(1)]]), flow) }), scoringCard),
        card({ title: 'By period', dense: true, body: dataTable([{ key: 'period', label: 'Period' }, { key: 'away', label: `${a.abbr} SOG`, num: true }, { key: 'awayAtt', label: `${a.abbr} attempts`, num: true }, { key: 'home', label: `${hm.abbr} SOG`, num: true }, { key: 'homeAtt', label: `${hm.abbr} attempts`, num: true }], byPeriodShots, { sortKey: null }) })) },
      { id: 'rink', label: 'Shot map', node: section('rink', 'Shot map', 'NHL coordinates, every attempt', card({ title: 'Full rink', scope: 'each team shown attacking one end', body: rink(doc, evs, roster), foot: doc.status.xg })) },
      { id: 'teams', label: 'Team stats', node: section('teams', 'Team stats', null, h('div', { class: 'split-2' }, teamCompare(doc, doc.teamStats.filter((r) => !/shootout/i.test(r.key)), { lowerBetter: ['giveaways', 'penalties', 'penaltyMinutes'] }), goalies)) },
      { id: 'box', label: 'Box score', node: section('box', 'Box score', null, card({ title: 'Skaters', scope: 'NHL boxscore', dense: true, body: boxHost }), card({ title: 'Penalties', scope: `${pens.length} called`, body: pens.length ? h('div', null, ...pens.map((e) => { const p = roster[String(e.who)] || {}; return h('div', { class: 'play-row' }, h('div', { class: 't-label num' }, `${pName(e.period)} ${e.t}`), h('span', { class: 'ink2' }, `${e.penalty || 'penalty'}`), h('span', { class: 't-label' }, `${e.pim || ''} min`)); })) : h('div', { class: 'state' }, 'No penalties') })) },
      { id: 'lines', label: 'Lines', node: section('lines', 'Lines', null, h('div', { class: 'split-2' }, linesCard(doc), seasonSeriesCard(doc)), propsResultCard(doc, () => null)) },
      { id: 'plays', label: 'Play-by-play', node: section('plays', 'Play-by-play', 'goals, shots and penalties', playLogCard(doc, N.events.filter((e) => SHOTS.includes(e.type) || e.type === 'penalty').map((e) => { const sd = sideOfNhlTeam(roster[String(e.who)]?.team ?? e.team); return { period: e.period, clock: e.t, text: `${e.type === 'penalty' ? `Penalty: ${e.penalty || ''}` : `${e.type.replace(/-/g, ' ')}${e.who ? ` · ${roster[String(e.who)]?.name || ''}` : ''}${e.shotType ? ` (${e.shotType})` : ''}`}`, team: sd ? hm.id : a.id, key: e.type === 'goal', tag: e.type === 'goal' ? `${e.as_}–${e.hs}` : null }; }), { periodName: pName, keyLabel: 'Goals only' })) },
    ].concat([]) };
  }

  GAME_SPORTS.nba = { label: 'NBA', games: [{ slug: 'nba-okc-lal', build: (doc) => buildGameShell(doc, nbaBuild(doc)) }], hero: { periods: (i) => qName(i + 1) } };
  GAME_SPORTS.nhl = { label: 'NHL', games: [{ slug: 'nhl-fla-tor', build: (doc) => { const r = nhlBuild(doc); return { hero: r.hero, sections: buildGameShell(doc, r.sections) }; } }] };
})();
