/* Compare control for the player and team pages: pick an opponent team (default: next opponent) and/or a peer player.
   Every matchup card reads the per-sport matchup dataset (rollups for / allowed / allowed by position, results, key
   players, and each sport's extras). */
const CMP = (() => {
  const FILE = { mlb: 'mlb', nfl: 'nfl', cfb: 'cfb', nba: 'nba', nhl: 'nhl', soccer: 'soccer', soccer_epl: 'soccer', tennis_atp: 'tennis', tennis: 'tennis', golf: 'golf' };
  const data = (sport) => loadData(`matchup-${FILE[sport]}`);
  const perGame = (row, key) => (row && row.g ? (row.s[key] || 0) / row.g : null);
  const ord = (n) => fmt.ord(n);
  const seasonName = (sport, s) => (sport === 'nba' ? `${s - 1}-${String(s).slice(2)}` : ['nhl', 'soccer', 'soccer_epl'].includes(sport) ? `${s}-${String(s + 1).slice(2)}` : String(s));

  /* Rank a team among the league for one per-game value (1 = highest). */
  function leagueRank(rows, id, fn, minG = 1) {
    const most = Math.max(0, ...Object.values(rows).map((r) => r.g));
    const vals = Object.entries(rows).filter(([, r]) => r.g >= Math.max(minG, most * 0.3)).map(([t, r]) => [t, fn(r)]).filter(([, v]) => v != null && !Number.isNaN(v));
    const sorted = [...vals].sort((a, b) => b[1] - a[1]);
    const i = sorted.findIndex(([t]) => t === id);
    return { value: i >= 0 ? sorted[i][1] : null, rank: i + 1, of: sorted.length, league: vals.map((v) => v[1]).sort((a, b) => a - b) };
  }

  /* What an opponent gives up, per player kind. side: allowedPos:<group> | allowed | for (opponent's own production). */
  const ALLOW = {
    receiver: { title: 'to wide receivers', side: 'allowedPos:WR', stats: [['receiving.receivingTargets', 'Targets'], ['receiving.receptions', 'Receptions'], ['receiving.receivingYards', 'Receiving yards'], ['receiving.receivingTouchdowns', 'Receiving TDs']] },
    quarterback: { title: 'to quarterbacks', side: 'allowedPos:QB', stats: [['passing.passingYards', 'Passing yards'], ['passing.passingTouchdowns', 'Passing TDs'], ['passing.completions', 'Completions'], ['passing.interceptions', 'Interceptions (lower helps the QB)'], ['passing.sacks', 'Sacks taken']] },
    cfbquarterback: { title: 'through the air (all passers)', side: 'allowed', stats: [['passing.passingYards', 'Passing yards'], ['passing.passingTouchdowns', 'Passing TDs'], ['passing.interceptions', 'Interceptions'], ['rushing.rushingYards', 'Rushing yards']] },
    guard: { title: 'to guards', side: 'allowedPos:G', stats: [['points', 'Points'], ['assists', 'Assists'], ['threePointFieldGoalsMade', '3-pointers made'], ['rebounds', 'Rebounds'], ['freeThrowsAttempted', 'Free throw attempts']] },
    big: { title: 'to centers', side: 'allowedPos:C', stats: [['points', 'Points'], ['rebounds', 'Rebounds'], ['blocks', 'Blocks'], ['assists', 'Assists'], ['freeThrowsAttempted', 'Free throw attempts']] },
    skater: { title: 'to skaters', side: 'allowed', stats: [['goals', 'Goals'], ['assists', 'Assists'], ['sog', 'Shots on goal'], ['powerPlayGoals', 'Power-play goals']] },
    goalie: { title: 'on offense (what the goalie will face)', side: 'for', stats: [['sog', 'Shots on goal'], ['goals', 'Goals'], ['powerPlayGoals', 'Power-play goals']] },
    hitter: { title: 'from its pitching staff', side: 'allowed', stats: [['bat_runs', 'Runs'], ['bat_hits', 'Hits'], ['bat_homeRuns', 'Home runs'], ['bat_baseOnBalls', 'Walks'], ['bat_strikeOuts', 'Strikeouts (lower helps the hitter)']] },
    pitcher: { title: 'on offense (the lineup the pitcher will face)', side: 'for', stats: [['bat_runs', 'Runs'], ['bat_hits', 'Hits'], ['bat_homeRuns', 'Home runs'], ['bat_strikeOuts', 'Strikeouts (higher helps the pitcher)'], ['bat_baseOnBalls', 'Walks']] },
    forward: { title: 'to forwards', side: 'allowedPos:FWD', stats: [['totalGoals', 'Goals'], ['totalShots', 'Shots'], ['shotsOnTarget', 'Shots on target']] },
    goalkeeper: { title: 'on attack (what the keeper will face)', side: 'for', stats: [['totalShots', 'Shots'], ['shotsOnTarget', 'Shots on target'], ['totalGoals', 'Goals']] },
  };

  function rollSide(M, season, side) {
    const r = M.rollup[String(season)]; if (!r) return null;
    if (side.startsWith('allowedPos:')) return r.allowedPos?.[side.split(':')[1]] || null;
    return r[side];
  }

  function teamOptions(M) {
    return Object.entries(M.teams).filter(([id]) => Object.values(M.rollup).some((r) => r.for[id])).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, t]) => ({ value: id, label: `${t.name}` }));
  }

  function allowCard(M, kind, teamId, seasons, sport) {
    const A = ALLOW[kind]; if (!A) return null;
    let season = seasons.find((s) => rollSide(M, s, A.side)?.[teamId]?.g >= 3) || seasons[0];
    const host = h('div'); const t = M.teams[teamId];
    const draw = () => {
      const rows = rollSide(M, season, A.side);
      const my = rows?.[teamId];
      put(host, segmented(seasons.map((s) => ({ value: s, label: `${seasonName(sport, s)}${rollSide(M, s, A.side)?.[teamId] ? ` (${rollSide(M, s, A.side)[teamId].g} gp)` : ''}` })), season, (v) => { season = Number(v); draw(); }),
        !my ? h('div', { class: 'state' }, `No ${seasonName(sport, season)} games for ${t.name}`) : h('div', { style: { marginTop: '8px' } }, ...A.stats.map(([key, label]) => { const rk = leagueRank(rows, teamId, (r) => perGame(r, key)); return rankRow({ label: `${label} / game`, display: fmt.n(rk.value, rk.value < 10 ? 2 : 1), rank: rk.rank, of: rk.of, league: rk.league, value: rk.value, better: 'high' }); }),
          h('div', { class: 't-label', style: { marginTop: '6px' } }, `${A.side === 'for' ? 'Rank 1st = the most productive offense (the most volume this player will face).' : 'Rank 1st = gives up the most.'} ${my.g} games.`)));
    };
    draw();
    return card({ title: `What ${t.abbr} gives up ${A.title}`, scope: 'per game, league rank', info: 'From the app’s game logs rolled up by opponent (and by the scoring player’s position where noted).', body: host });
  }

  function historyVsCard(doc, spec, teamId, M) {
    const t = M.teams[teamId];
    const gs = doc.games.filter((g) => String(g.opp) === String(teamId));
    const stats = (spec.trendStats || []).slice(0, 5);
    const lastSeason = doc.games[doc.games.length - 1]?.season;
    let seasonGs = doc.games.filter((g) => g.season === lastSeason);
    const seasonName2 = seasonGs.length < 8 ? lastSeason - 1 : lastSeason;
    if (seasonGs.length < 8) seasonGs = doc.games.filter((g) => g.season === lastSeason - 1);
    if (!gs.length) return card({ title: `${doc.bio?.name || 'Player'} vs ${t.abbr}`, body: h('div', { class: 'state' }, h('b', null, 'No games against this team held'), `The app’s game logs don’t include a meeting with ${t.name}.`) });
    return card({ title: `${doc.bio?.name} vs ${t.abbr}`, scope: `${gs.length} ${gs.length === 1 ? 'game' : 'games'} held`, dense: true, body: h('div', { class: 'stack' },
      statGrid(stats.map((st) => { const vs = U.avg(gs.map(st.fn).filter((v) => v != null)); const all = U.avg(seasonGs.map(st.fn).filter((v) => v != null)); return { label: st.label, value: fmt.n(vs, st.dec || 1), sub: `${seasonName2} avg ${fmt.n(all, st.dec || 1)}` }; })),
      dataTable([{ key: 'date', label: 'Date', fmt: (v) => `${U.shortDate(v)} ’${String(v).slice(2, 4)}` }, { key: 'res', label: 'Result', render: (g) => (g.result ? `${g.result} ${U.score(g)}` : '—') }, ...(spec.logCols || []).slice(0, 6).map((c) => ({ key: c.key, label: c.label, num: true, render: (g) => { const v = c.fn(g); return v == null ? '—' : typeof v === 'string' ? v : fmt.n(v, c.dec || 0); } }))], gs.slice().reverse(), { sortKey: null })), foot: 'Averages against this team; under each, the season average (last season when this one has fewer than 8 games)' });
  }

  /* NFL: where this defense is thrown at (to the position) against where this player is targeted. */
  function nflGridCard(doc, M, teamId, kind) {
    const rows = doc.targets?.targets; if (!rows) return null;
    const seasons = Object.keys(M.targets || {}).sort().reverse();
    const season = seasons.find((s) => (kind === 'receiver' ? M.targets[s].defPos?.WR?.[teamId] : M.targets[s].def?.[teamId])) ; if (!season) return null;
    const T = M.targets[season];
    const cells = [['deep', 'left'], ['deep', 'middle'], ['deep', 'right'], ['short', 'left'], ['short', 'middle'], ['short', 'right']];
    const defCells = (kind === 'receiver' ? T.defPos.WR[teamId] : T.def[teamId]).cells;
    const defTot = U.sum(Object.values(defCells).map((v) => v[0]));
    const mine = rows.filter((r) => String(r[0]) === season);
    const use = mine.length >= 20 ? mine : rows.filter((r) => String(r[0]) === String(Math.max(...rows.map((x) => x[0]))));
    const myTot = use.length;
    const grid = (share, title, sub) => svgHost((W) => { const H = 150, cw = W / 3, ch = (H - 16) / 2; const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title });
      cells.forEach(([l, sd], i) => { const k = `${l}|${sd}`; const v = share(k); const x = (i % 3) * cw, y = Math.floor(i / 3) * ch; svg.append(hoverable(s('g', null, s('rect', { x: x + 3, y: y + 3, width: cw - 6, height: ch - 6, rx: 6, fill: `color-mix(in srgb, var(--cmp-a) ${Math.round(Math.min(80, v * 2.2))}%, #f2f2f2)` }), s('text', { x: x + cw / 2, y: y + ch / 2 + 6, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 700, fill: 'var(--ink)' }, `${fmt.n(v, 0)}%`)), () => [tipRow(`${fmt.n(v, 1)}%`, `${l} ${sd}`), tipText(sub)])); });
      svg.append(s('text', { class: 'axis-t', x: W / 2, y: H - 2, 'text-anchor': 'middle' }, 'line of scrimmage below')); return h('div', { class: 'chart' }, svg); });
    return card({ title: kind === 'receiver' ? `Where ${M.teams[teamId].abbr} is thrown at by receivers vs where ${doc.bio.name.split(' ').pop()} is targeted` : `Where ${M.teams[teamId].abbr} is thrown at vs where ${doc.bio.name.split(' ').pop()} throws`, scope: `${season} · share of targets by depth and side`, body: h('div', { class: 'split-2' },
      h('div', null, h('div', { class: 't-over', style: { margin: '4px 0' } }, `${M.teams[teamId].abbr} defense (${defTot} targets${kind === 'receiver' ? ' to WRs' : ''})`), grid((k) => (defTot ? (100 * (defCells[k]?.[0] || 0)) / defTot : 0), 'defense', 'Share of targets against this defense')),
      h('div', null, h('div', { class: 't-over', style: { margin: '4px 0' } }, `${doc.bio.name} (${myTot} targets, ${use[0]?.[0]})`), grid((k) => { const [l, sd] = k.split('|'); return myTot ? (100 * use.filter((r) => r[4] === l && r[3] === sd).length) / myTot : 0; }, 'player', 'Share of this player’s targets'))),
      foot: 'Where the two maps line up, the player’s usual targets meet what this defense gives up' });
  }

  function nbaZonesVsCard(doc, M, teamId, kind) {
    const S = M.shots; const grp = kind === 'guard' ? 'G' : 'C'; const allowed = S?.allowedPos?.[grp]?.[teamId]; if (!allowed || !doc.shots?.rows) return null;
    const zones = ['Restricted area', 'Paint (non-RA)', 'Mid-range', 'Corner 3', 'Above-break 3'];
    const zoneOf = ([x, y, made, , pv]) => { const yy = y + 4.25; const three = Math.hypot(x - 25, yy - 5.25) >= 23.25 || (Math.abs(x - 25) >= 21.5 && yy <= 14); const val = made ? pv : three ? 3 : 2; if (val === 3) return yy < 14 ? 'Corner 3' : 'Above-break 3'; if (Math.hypot(x - 25, yy - 5.25) <= 4) return 'Restricted area'; if (Math.abs(x - 25) <= 8 && yy <= 19) return 'Paint (non-RA)'; return 'Mid-range'; };
    const mine = U.groupBy(doc.shots.rows.filter((r) => r[1] <= 43), zoneOf); const myTot = U.sum(Object.values(mine).map((v) => v.length));
    const aTot = U.sum(Object.values(allowed.zones).map((v) => v[0]));
    const rankOf = (zone) => { const vals = Object.entries(S.allowedPos[grp]).map(([t, v]) => { const z = v.zones[zone]; return [t, z && z[0] ? (100 * z[1]) / z[0] : null]; }).filter((x) => x[1] != null).sort((a, b) => b[1] - a[1]); return `${ord(vals.findIndex((x) => x[0] === teamId) + 1)}/${vals.length}`; };
    return card({ title: `${doc.bio.name.split(' ').pop()}’s shots vs what ${M.teams[teamId].abbr} allows ${grp === 'G' ? 'guards' : 'centers'}`, scope: `${S.season} — the only season of shot locations held`, dense: true,
      body: dataTable([{ key: 'zone', label: 'Zone' }, { key: 'me', label: 'Player share', num: true, fmt: (v) => `${fmt.n(v, 1)}%` }, { key: 'myfg', label: 'Player FG%', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'ash', label: `${M.teams[teamId].abbr} allows share`, num: true, fmt: (v) => `${fmt.n(v, 1)}%` }, { key: 'afg', label: 'Allowed FG%', num: true, render: (r) => h('span', null, fmt.n(r.afg, 1), h('span', { class: 't-label' }, ` ${r.rank}`)) }],
        zones.map((z) => { const m2 = mine[z] || []; const a = allowed.zones[z] || [0, 0, 0]; return { zone: z, me: myTot ? (100 * m2.length) / myTot : null, myfg: m2.length ? (100 * m2.filter((r) => r[2]).length) / m2.length : null, ash: aTot ? (100 * a[0]) / aTot : null, afg: a[0] ? (100 * a[1]) / a[0] : null, rank: rankOf(z) }; }), { sortKey: null }), foot: 'Allowed FG% rank: 1st = opponents shoot best against this team from that zone' });
  }

  function mlbHandCard(M, teamId, kind) {
    const H = M.hand; if (!H) return null;
    const side = kind === 'hitter' ? 'pit' : 'bat';
    const rowsFor = (hand) => { const all = Object.entries(H[side]).map(([t, v]) => [t, v[hand]]).filter(([, v]) => v && v.pa >= 50); const me = H[side][teamId]?.[hand]; if (!me) return null;
      const rk = (k, better) => { const vals = all.map(([t, v]) => [t, v[k]]).filter((x) => x[1] != null).sort((a, b) => (better === 'high' ? b[1] - a[1] : a[1] - b[1])); return [vals.findIndex((x) => x[0] === teamId) + 1, vals.length, vals.map((x) => x[1]).sort((a, b) => a - b)]; };
      return { hand, me, rk }; };
    const defs = kind === 'hitter' ? [['kPct', 'K%', 'low'], ['bbPct', 'BB%', 'high'], ['hrPct', 'HR / PA', 'high'], ['hardHit', 'Hard-hit %', 'high'], ['xwobacon', 'xwOBA on contact', 'high'], ['whiff', 'Whiff %', 'low']] : [['kPct', 'K%', 'high'], ['bbPct', 'BB%', 'low'], ['hrPct', 'HR / PA', 'low'], ['hardHit', 'Hard-hit %', 'low'], ['xwobacon', 'xwOBA on contact', 'low'], ['whiff', 'Whiff %', 'high']];
    const hands = kind === 'hitter' ? ['R', 'L'] : ['R', 'L'];
    const blocks = hands.map(rowsFor).filter(Boolean);
    return card({ title: kind === 'hitter' ? `${M.teams[teamId].abbr} pitching against right- and left-handed hitters` : `${M.teams[teamId].abbr} hitting against right- and left-handed pitchers`, scope: `${H.season} Statcast · rank among 30`, body: h('div', { class: 'split-2' }, ...blocks.map((b) => h('div', null, h('div', { class: 't-over', style: { margin: '4px 0' } }, kind === 'hitter' ? `vs ${b.hand}HH (${b.me.pa} PA)` : `vs ${b.hand}HP (${b.me.pa} PA)`),
      ...defs.map(([k, label, better]) => { const [rank, of, league] = b.rk(k, better); const v = b.me[k]; return rankRow({ label, display: k === 'xwobacon' ? fmt.rate3(v) : `${fmt.n(v, 1)}%`, rank, of, league, value: v, better }); })))),
      foot: `Green = friendly for the ${kind === 'hitter' ? 'hitter' : 'pitcher'} (1st = most friendly). The hand the player uses isn’t in the stored data, so both are shown.` });
  }

  /* Peer comparison: season tiles side by side and trend overlay. */
  function peerSection(doc, spec, peerDoc) {
    const curA = doc.games.length ? doc.games[doc.games.length - 1].season : null;
    const pick = (d) => { const seasons = [...new Set(d.games.map((g) => g.season))]; const cur = seasons[seasons.length - 1]; const gs = d.games.filter((g) => g.season === cur); return gs.length >= 8 ? { gs, cur } : { gs: d.games.filter((g) => g.season === cur - 1), cur: cur - 1 }; };
    const A = pick(doc), B = pick(peerDoc);
    const ta = spec.tiles ? spec.tiles(A.gs, doc) : [], tb = spec.tiles ? spec.tiles(B.gs, peerDoc) : [];
    const rows = ta.map((t, i) => ({ label: t.label, a: t.value, b: tb[i]?.value }));
    const table = h('div', null, h('div', { class: 'team-key' }, h('span', null, h('i', { class: 'sw-dot', style: { background: G.sideColor(0) } }), `${doc.bio.name} · ${A.cur}`), h('span', null, `${peerDoc.bio.name} · ${B.cur}`, h('i', { class: 'sw-dot', style: { background: G.sideColor(1) } }))),
      ...rows.map((r) => { const av = G.numOf(r.a), bv = G.numOf(r.b); const tot = Math.abs(av || 0) + Math.abs(bv || 0); return h('div', { class: 'cmp-row2' }, h('div', { class: `v ${av > bv ? 'lead' : 'trail'}` }, r.a ?? '—'), h('div', { class: 'cmp-mid' }, h('div', { class: 'lab' }, r.label), h('div', { class: 'cmp-bars2' }, h('div', null, h('span', { style: { width: `${tot ? (100 * Math.abs(av || 0)) / tot : 0}%`, background: G.sideColor(0) } })), h('div', null, h('span', { style: { width: `${tot ? (100 * Math.abs(bv || 0)) / tot : 0}%`, background: G.sideColor(1) } })))), h('div', { class: `v r ${bv > av ? 'lead' : 'trail'}` }, r.b ?? '—')); }));
    const trend = trendCard({ sport: doc.sport, games: doc.games, stats: spec.trendStats, periodLabel: spec.periodLabel || ((g) => U.shortDate(g.date)), compare: { name: peerDoc.bio.name, games: peerDoc.games, on: true }, title: `Trend · ${doc.bio.name.split(' ').pop()} vs ${peerDoc.bio.name.split(' ').pop()}` });
    return section('peer', `vs ${peerDoc.bio.name}`, 'same position, same stats, side by side', h('div', { class: 'split-2' }, card({ title: 'Season side by side', scope: 'larger value in bold', body: table, foot: 'Each uses their current season, or last season when the current one has fewer than 8 games' }), trend));
  }

  /* Player page: bar + sections. */
  function playerCompare(doc, spec, subject, state, onChange) {
    const sport = doc.sport; const M = data(sport);
    const kind = { hitter: 'hitter', pitcher: 'pitcher', receiver: 'receiver', quarterback: sport === 'cfb' ? 'cfbquarterback' : 'quarterback', guard: 'guard', big: 'big', skater: 'skater', goalie: 'goalie', forward: 'forward', goalkeeper: 'goalkeeper' }[doc.kind];
    const peers = Object.keys(DATA).length ? [] : [];
    const peerSlugs = [...document.querySelectorAll('script[id^="data-player-"]')].map((e) => e.id.replace('data-player-', '')).filter((sl) => sl !== subject && sl.split('-')[0] === subject.split('-')[0]);
    const peerDocs = peerSlugs.map((sl) => [sl, loadData(`player-${sl}`)]).filter(([, d]) => d && d.kind === doc.kind);
    const bar = h('div', { class: 'scope-bar', style: { marginTop: 'var(--s4)' } }, h('span', { class: 't-over' }, 'Compare against'));
    const sections = [];
    if (sport === 'tennis_atp') return tennisCompare(doc, bar, state, onChange);
    if (sport === 'golf') return golfCompare(doc, bar);
    if (M && kind) {
      const myTeam = doc.games.length ? String(doc.games[doc.games.length - 1].team) : null;
      const nxt = M.next?.[myTeam];
      const lastOpp = doc.games.length ? String(doc.games[doc.games.length - 1].opp) : '';
      if (state.vs === undefined) state.vs = nxt && M.teams[nxt.opp] ? nxt.opp : M.teams[lastOpp] ? lastOpp : '';
      const opts = teamOptions(M).filter((o) => o.value !== myTeam);
      bar.append(selectBox([{ value: '', label: 'No team' }, ...opts.map((o) => ({ ...o, label: `${o.label}${nxt && o.value === nxt.opp ? ' · next opponent' : ''}` }))], state.vs || '', (v) => { state.vs = v; onChange(); }, 'Opponent team'));
      if (nxt && !M.teams[nxt.opp]) bar.append(h('span', { class: 't-label' }, `Next opponent (${new Date(nxt.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}) is outside this league's team list, so the page defaults to the last opponent.`));
      if (nxt && state.vs === nxt.opp) bar.append(h('span', { class: 't-label' }, `Next: ${nxt.home ? 'vs' : '@'} ${M.teams[nxt.opp]?.abbr} · ${new Date(nxt.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${nxt.note ? ` (${nxt.note === '2026-27 opener' ? 'next scheduled' : nxt.note})` : ''}`));
      window.__cmpOppAbbr = state.vs && M.teams[state.vs] ? M.teams[state.vs].abbr : null;
      if (state.vs && M.teams[state.vs]) {
        const native = sport === 'nfl' ? nflGridCard(doc, M, state.vs, doc.kind) : sport === 'nba' ? nbaZonesVsCard(doc, M, state.vs, doc.kind) : sport === 'mlb' ? mlbHandCard(M, state.vs, doc.kind) : null;
        sections.push({ id: 'matchup', label: `vs ${M.teams[state.vs].abbr}`, node: section('matchup', `Matchup: vs ${M.teams[state.vs].name}`, 'history against them, and what they give up', h('div', { class: 'split-2' }, historyVsCard(doc, spec, state.vs, M), allowCard(M, kind, state.vs, M.seasons, sport)), native) });
      }
    }
    if (peerDocs.length) {
      bar.append(selectBox([{ value: '', label: 'No player' }, ...peerDocs.map(([sl, d]) => ({ value: sl, label: d.bio.name }))], state.peer || '', (v) => { state.peer = v; onChange(); }, 'Compare player'));
      const pd = peerDocs.find(([sl]) => sl === state.peer)?.[1];
      if (pd) sections.push({ id: 'peer', label: `vs ${pd.bio.name.split(' ').pop()}`, node: peerSection(doc, spec, pd) });
    }
    bar.append(h('span', { class: 't-label' }, 'Adds matchup sections below the prop analysis; the prop block’s "vs" chip follows the team.'));
    return { bar, sections };
  }

  function tennisCompare(doc, bar, state, onChange) {
    const M = data('tennis'); const me = doc.bio.name; const names = Object.keys(M.players).filter((n) => n !== me).sort((a, b) => (M.players[a].rank || 999) - (M.players[b].rank || 999));
    if (state.vs === undefined) state.vs = names[0];
    bar.append(selectBox([{ value: '', label: 'No player' }, ...names.map((n) => ({ value: n, label: `${n} (No. ${M.players[n].rank})` }))], state.vs || '', (v) => { state.vs = v; onChange(); }, 'Opponent'));
    const sections = [];
    if (state.vs) {
      const yr = String(Math.max(...Object.keys(M.players[me] || {}).filter((k) => /^\d{4}$/.test(k)).map(Number)));
      const a = M.players[me]?.[yr], b = M.players[state.vs]?.[yr];
      const key = [me, state.vs].sort().join('|'); const h2h = (M.h2h[key] || []).slice().sort((x, y) => y[0].localeCompare(x[0]));
      const rows = [['Win %', (p) => (100 * p.wins) / p.matches], ['Aces per match', (p) => p.acesPerMatch], ['1st serve in %', (p) => p.firstIn], ['1st serve won %', (p) => p.firstWon], ['2nd serve won %', (p) => p.secondWon], ['Break points saved %', (p) => p.bpSaved], ['Return points won %', (p) => p.returnWon], ['Break points converted %', (p) => p.bpConverted]];
      const cmpBody = a && b ? h('div', null, h('div', { class: 'team-key' }, h('span', null, h('i', { class: 'sw-dot', style: { background: G.sideColor(0) } }), me), h('span', null, state.vs, h('i', { class: 'sw-dot', style: { background: G.sideColor(1) } }))), ...rows.map(([label, f]) => { const x = f(a), y = f(b); const tot = (x || 0) + (y || 0); return h('div', { class: 'cmp-row2' }, h('div', { class: `v ${x > y ? 'lead' : 'trail'}` }, fmt.n(x, 1)), h('div', { class: 'cmp-mid' }, h('div', { class: 'lab' }, label), h('div', { class: 'cmp-bars2' }, h('div', null, h('span', { style: { width: `${tot ? (100 * x) / tot : 0}%`, background: G.sideColor(0) } })), h('div', null, h('span', { style: { width: `${tot ? (100 * y) / tot : 0}%`, background: G.sideColor(1) } })))), h('div', { class: `v r ${y > x ? 'lead' : 'trail'}` }, fmt.n(y, 1))); }),
        h('div', { class: 't-label', style: { marginTop: '6px' } }, `Surfaces ${yr}: ${me.split(' ').pop()} hard ${a.hard.join('/')}, clay ${a.clay.join('/')}, grass ${a.grass.join('/')} · ${state.vs.split(' ').pop()} hard ${b.hard.join('/')}, clay ${b.clay.join('/')}, grass ${b.grass.join('/')} (wins/matches)`)) : h('div', { class: 'state' }, 'No season profile for one of the players');
      sections.push({ id: 'matchup', label: `vs ${state.vs.split(' ').pop()}`, node: section('matchup', `vs ${state.vs}`, 'serve and return profiles, head-to-head', h('div', { class: 'split-2' }, card({ title: 'Season profiles', scope: `${yr} · TennisMyLife`, body: cmpBody }), card({ title: 'Head-to-head', scope: `${h2h.length} meetings in 2025–26`, dense: true, body: h2h.length ? dataTable([{ key: 'd', label: 'Event', render: (r) => `${r[1]} ${r[0].slice(0, 4)}` }, { key: 's', label: 'Surface', render: (r) => r[2] }, { key: 'r', label: 'Rd', render: (r) => r[3] }, { key: 'w', label: 'Winner', render: (r) => h('b', null, r[4]) }, { key: 'sc', label: 'Score', render: (r) => r[5] }], h2h, { sortKey: null }) : h('div', { class: 'state' }, 'No meetings in 2025–26') }))) });
    }
    return { bar, sections };
  }

  function golfCompare(doc, bar) {
    const M = data('golf'); const me = '9478';
    const events = Object.keys(M.events);
    const tables = events.map((eid) => {
      const field = Object.entries(M.rounds).map(([pid, evs]) => [pid, evs[eid]]).filter(([, rs]) => rs && rs.length >= 4).map(([pid, rs]) => ({ pid, name: M.names[pid]?.name, total: U.sum(rs.map((r) => r[2])), rounds: rs.slice().sort((a, b) => a[0] - b[0]).map((r) => r[2]) })).sort((a, b) => a.total - b.total);
      const pos = field.findIndex((f) => f.pid === me) + 1;
      const avgRound = (i) => U.avg(field.map((f) => f.rounds[i]).filter((v) => v != null));
      const mine = field.find((f) => f.pid === me);
      return card({ title: M.events[eid].name, scope: `${M.events[eid].course} · finished ${ord(pos)} of ${field.length} who played all rounds`, dense: true, body: h('div', { class: 'stack' },
        mine ? dataTable([{ key: 'r', label: 'Round' }, { key: 'me', label: doc.bio.name.split(' ').pop(), num: true, fmt: (v) => (v > 0 ? `+${v}` : v === 0 ? 'E' : String(v)) }, { key: 'field', label: 'Field average', num: true, fmt: (v) => `${v > 0 ? '+' : ''}${fmt.n(v, 2)}` }, { key: 'diff', label: 'Strokes gained on field', num: true, render: (r) => h('b', { style: { color: r.field - r.me > 0 ? 'var(--good)' : 'var(--bad)' } }, fmt.n(r.field - r.me, 2)) }], mine.rounds.map((v, i) => ({ r: i + 1, me: v, field: avgRound(i) })), { sortKey: null }) : h('div', { class: 'state' }, 'Did not complete four rounds'),
        dataTable([{ key: 'pos', label: 'Pos', num: true }, { key: 'name', label: 'Player', render: (f) => h('span', { style: { fontWeight: f.pid === me ? 700 : 400 } }, f.name || `ESPN ${f.pid}`) }, { key: 'total', label: 'To par', num: true, fmt: (v) => (v > 0 ? `+${v}` : v === 0 ? 'E' : String(v)) }], field.slice(0, 8).map((f, i) => ({ ...f, pos: i + 1 })), { sortKey: null })) });
    });
    return { bar: h('div', { class: 'scope-bar', style: { marginTop: 'var(--s4)' } }, h('span', { class: 't-over' }, 'Compare against'), h('span', { class: 'chip' }, 'The field in each event'), h('span', { class: 't-label' }, 'Golf has no single opponent: each round is measured against everyone who played it.')), sections: [{ id: 'matchup', label: 'vs the field', node: section('matchup', 'Against the field', 'every round, against the average of the players who completed the event', h('div', { class: 'split-2' }, ...tables)) }] };
  }

  /* Team page: opponent bar + matchup section. */
  const STRENGTH = {
    nfl: [['Pass yards', 'passing.passingYards', null], ['Rush yards', 'rushing.rushingYards', null], ['Yards per pass attempt', 'passing.passingYards', 'passing.passingAttempts'], ['Yards per carry', 'rushing.rushingYards', 'rushing.rushingAttempts'], ['Pass TDs', 'passing.passingTouchdowns', null], ['Interceptions thrown', 'passing.interceptions', null, 'low'], ['Sacks taken', 'passing.sacks', null, 'low']],
    mlb: [['Runs', 'bat_runs', null], ['Home runs', 'bat_homeRuns', null], ['AVG', 'bat_hits', 'bat_atBats'], ['SLG', 'bat_totalBases', 'bat_atBats'], ['Strikeout %', 'bat_strikeOuts', 'bat_plateAppearances', 'low', 100], ['Walk %', 'bat_baseOnBalls', 'bat_plateAppearances', 'high', 100]],
    nba: [['Points', 'points', null], ['FG%', 'fieldGoalsMade', 'fieldGoalsAttempted', 'high', 100], ['3-pointers made', 'threePointFieldGoalsMade', null], ['3P%', 'threePointFieldGoalsMade', 'threePointFieldGoalsAttempted', 'high', 100], ['Free throw attempts', 'freeThrowsAttempted', null], ['Assists', 'assists', null], ['Turnovers', 'turnovers', null, 'low']],
    nhl: [['Goals', 'goals', null], ['Shots on goal', 'sog', null], ['Shooting %', 'goals', 'sog', 'high', 100], ['Power-play goals', 'powerPlayGoals', null], ['Hits', 'hits', null], ['Blocked shots', 'blockedShots', null]],
    soccer: [['Goals', 'totalGoals', null], ['Shots', 'totalShots', null], ['Shots on target', 'shotsOnTarget', null], ['Goals per shot %', 'totalGoals', 'totalShots', 'high', 100], ['Fouls', 'foulsCommitted', null, 'low'], ['Yellow cards', 'yellowCards', null, 'low']],
  };
  STRENGTH.cfb = STRENGTH.nfl;

  function strengthRows(sport, roll, a, b) {
    const most = Math.max(0, ...Object.values(roll.for).map((r) => r.g));
    const real = (rows) => Object.entries(rows).filter(([t, r]) => r.g >= Math.max(1, most * 0.3));
    return STRENGTH[sport].map(([label, num, den, better = 'high', mult = 1]) => {
      const val = (r) => (den ? (r.s[den] ? (mult * (r.s[num] || 0)) / r.s[den] : null) : r.g ? (r.s[num] || 0) / r.g : null);
      const out = { label, better, teams: {} };
      for (const side of ['for', 'allowed']) {
        const vals = real(roll[side]).map(([t, r]) => [t, val(r)]).filter(([, v]) => v != null);
        const rev = side === 'for' ? better === 'high' : better === 'low';
        const order = vals.map((v) => v[1]).sort((x, y) => (rev ? y - x : x - y));
        for (const t of [a, b]) { const v = vals.find((x) => x[0] === t); if (v) (out.teams[t] = out.teams[t] || {})[side] = [v[1], order.indexOf(v[1]) + 1, order.length]; }
      }
      return out;
    });
  }

  function teamCompare(doc, spec, season, state, onChange, dbTeam, sportKey) {
    const M = data(sportKey); if (!M) return { bar: null, sections: [] };
    const me = String(dbTeam);
    const nextOpp = M.next?.[me]?.opp || (doc.team.next?.opp?.abbr ? Object.entries(M.teams).find(([, t]) => t.abbr === doc.team.next.opp.abbr)?.[0] : null);
    const lastRes = (M.results[me] || []).slice(-1)[0];
    if (state.vs === undefined) state.vs = nextOpp && M.teams[nextOpp] ? nextOpp : lastRes && M.teams[lastRes[1]] ? lastRes[1] : '';
    const opts = teamOptions(M).filter((o) => o.value !== me);
    const bar = h('div', { class: 'scope-bar' }, h('span', { class: 't-over' }, 'Compare against'), selectBox([{ value: '', label: 'No team' }, ...opts.map((o) => ({ ...o, label: `${o.label}${o.value === nextOpp ? ' · next opponent' : ''}` }))], state.vs || '', (v) => { state.vs = v; onChange(); }, 'Opponent'), h('span', { class: 't-label' }, 'Adds a matchup section: strength vs strength, head-to-head, form and key players.'));
    if (!state.vs || !M.teams[state.vs]) return { bar, sections: [] };
    const opp = state.vs; const T = M.teams; const ids = [me, opp];
    const pSeason = spec.pgh(season);
    const roll = M.rollup[String(pSeason)] || M.rollup[String(M.seasons[0])];
    const rows = strengthRows(sportKey, roll, me, opp);
    let attack = 0; const host = h('div');
    const draw = () => {
      const off = ids[attack], def = ids[1 - attack];
      put(host, segmented([{ value: 0, label: `${T[me].abbr} offense vs ${T[opp].abbr} defense` }, { value: 1, label: `${T[opp].abbr} offense vs ${T[me].abbr} defense` }], attack, (v) => { attack = Number(v); draw(); }),
        h('div', { class: 'team-key', style: { marginTop: '8px' } }, h('span', null, avatar(T[off].logo, 18, { logo: true, label: T[off].abbr }), `${T[off].abbr} produces`), h('span', null, `${T[def].abbr} allows`, avatar(T[def].logo, 18, { logo: true, label: T[def].abbr }))),
        ...rows.map((r) => { const o = r.teams[off]?.for, d = r.teams[def]?.allowed; if (!o || !d) return null; const po = o[2] > 1 ? Math.round(100 * (1 - (o[1] - 1) / (o[2] - 1))) : 50, pd = d[2] > 1 ? Math.round(100 * (1 - (d[1] - 1) / (d[2] - 1))) : 50;
          return h('div', { class: 'cmp-row2', style: { gridTemplateColumns: '92px minmax(0,1fr) 92px' } }, h('div', { class: 'v' }, fmt.n(o[0], o[0] < 20 ? 2 : 1), h('div', { class: 't-label' }, `${ord(o[1])} of ${o[2]}`)), h('div', { class: 'cmp-mid' }, h('div', { class: 'lab' }, `${r.label}${po - pd >= 35 ? ` · edge ${T[off].abbr}` : pd - po >= 35 ? ` · edge ${T[def].abbr}` : ''}`), h('div', { class: 'cmp-bars2' }, h('div', null, h('span', { style: { width: `${po}%`, background: G.sideColor(attack) } })), h('div', null, h('span', { style: { width: `${100 - pd}%`, background: G.sideColor(1 - attack) } })))), h('div', { class: 'v r' }, fmt.n(d[0], d[0] < 20 ? 2 : 1), h('div', { class: 't-label' }, `${ord(d[1])} of ${d[2]}`))); }));
    };
    draw();
    const res = (M.results[me] || []).filter((r) => r[1] === opp).slice().reverse();
    const formOf = (id) => (M.results[id] || []).slice(-10);
    const formBlock = (id) => h('div', null, h('div', { class: 'row', style: { marginBottom: '4px' } }, avatar(T[id].logo, 20, { logo: true, label: T[id].abbr }), h('b', null, T[id].abbr)), h('div', { class: 'row' }, ...formOf(id).map(([d, o, home, pf, pa]) => { const el = h('span', { class: 'mini-form' }, h('span', { style: { background: pf > pa ? 'var(--good)' : pf < pa ? 'var(--bad)' : 'var(--ink-muted)' } }, pf > pa ? 'W' : pf < pa ? 'L' : 'D')); Tip.bind(el, () => [tipRow(`${pf}–${pa}`, `${home ? 'vs' : '@'} ${T[o]?.abbr || o}`), tipText(U.shortDate(d))]); return el; })));
    const KEY = { nfl: [['passing.passingYards', 'Pass yds'], ['rushing.rushingYards', 'Rush yds'], ['receiving.receivingYards', 'Rec yds']], cfb: [['passing.passingYards', 'Pass yds'], ['rushing.rushingYards', 'Rush yds'], ['receiving.receivingYards', 'Rec yds']], nba: [['points', 'PTS'], ['rebounds', 'REB'], ['assists', 'AST']], nhl: [['goals', 'G'], ['assists', 'A'], ['sog', 'SOG']], mlb: [['bat_homeRuns', 'HR'], ['bat_hits', 'H'], ['pit_strikeOuts', 'K (pitching)']], soccer: [['totalGoals', 'G'], ['totalShots', 'SH'], ['goalAssists', 'A']] }[sportKey];
    const players = (id) => { const ps = (M.players[String(pSeason)] || {})[id] || []; return dataTable([{ key: 'name', label: T[id].abbr, render: (p) => h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, avatar(p.headshot, 24, { label: p.name }), h('a', { class: 'lnk', href: '#player' }, p.name), h('span', { class: 't-label' }, p.pos || '')) }, { key: 'g', label: 'G', num: true }, ...KEY.map(([k, lab]) => ({ key: k, label: `${lab}/G`, num: true, render: (p) => fmt.n((p.s[k] || 0) / p.g, 1) }))], ps.slice().sort((x, y) => (y.s[KEY[0][0]] || 0) / y.g - (x.s[KEY[0][0]] || 0) / x.g), { sortKey: null }); };
    const native = sportKey === 'mlb' ? h('div', { class: 'split-2' }, mlbHandCard(M, me, 'pitcher'), mlbHandCard(M, opp, 'pitcher')) : null;
    return { bar, sections: [{ id: 'matchup', label: `vs ${T[opp].abbr}`, node: section('matchup', `Matchup: ${T[me].abbr} vs ${T[opp].abbr}`, `${seasonName(sportKey, pSeason)} season, from the app’s game logs`,
      card({ title: 'Strength vs strength', scope: 'league ranks', body: host }),
      h('div', { class: 'split-2' }, card({ title: 'Head-to-head', scope: res.length ? `${res.filter((r) => r[3] > r[4]).length}-${res.filter((r) => r[3] < r[4]).length} since ${res[res.length - 1][0].slice(0, 4)}` : 'no meetings held', dense: true, body: res.length ? dataTable([{ key: 'd', label: 'Date', render: (r) => U.shortDate(r[0]) }, { key: 'w', label: 'Where', render: (r) => (r[2] ? `at ${T[me].abbr}` : `at ${T[opp].abbr}`) }, { key: 's', label: 'Score', render: (r) => h('b', { style: { color: r[3] > r[4] ? 'var(--good)' : r[3] < r[4] ? 'var(--bad)' : 'var(--ink-2)' } }, `${T[me].abbr} ${r[3]}–${r[4]} ${T[opp].abbr}`) }], res, { sortKey: null }) : h('div', { class: 'state' }, 'No meetings in the results held') }),
        card({ title: 'Form', scope: 'last 10 results each', body: h('div', { class: 'stack' }, formBlock(me), formBlock(opp)) })),
      h('div', { class: 'split-2' }, card({ title: `${T[me].abbr} key players`, scope: 'most production per game', dense: true, body: players(me) }), card({ title: `${T[opp].abbr} key players`, scope: 'most production per game', dense: true, body: players(opp) })),
      native) }] };
  }

  return { playerCompare, teamCompare };
})();
