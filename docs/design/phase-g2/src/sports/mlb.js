/* MLB: hitter and starting pitcher specs. */
(() => {
  const ipOuts = (ip) => { if (ip == null) return 0; const w = Math.trunc(ip); return w * 3 + Math.round((ip - w) * 10); };
  const IP = (gs) => U.sum(gs.map((g) => ipOuts(U.st(g, 'pit_inningsPitched')))) / 3;
  const rate = (n, d, dec = 3) => (d ? n / d : null);
  const AB = (gs) => sumK(gs, 'bat_atBats'), H = (gs) => sumK(gs, 'bat_hits'), PA = (gs) => sumK(gs, 'bat_plateAppearances');
  const OBP = (gs) => rate(H(gs) + sumK(gs, 'bat_baseOnBalls') + sumK(gs, 'bat_hitByPitch'), PA(gs));
  const SLG = (gs) => rate(sumK(gs, 'bat_totalBases'), AB(gs));
  const avg3 = (v) => (v == null ? '—' : fmt.rate3(v));

  const facts = (doc) => { const b = doc.bio; return [['Bats / throws', b.bats && `${b.bats} / ${b.throws}`], ['Age', b.age], ['Height', b.height], ['Weight', b.weight], ['MLB debut', b.debut && U.longDate(b.debut)]]; };

  function statcastSeasonSwitch(doc, render) {
    const sc = doc.statcast || { seasons: {} };
    const seasons = Object.keys(sc.seasons).sort();
    let season = seasons[seasons.length - 1];
    const host = h('div', { class: 'stack' });
    const draw = () => host.replaceChildren(h('div', { class: 'row' }, h('span', { class: 't-label' }, 'Statcast season'), segmented(seasons.map((x) => ({ value: x, label: x })), season, (v) => { season = v; draw(); }), h('span', { class: 't-label' }, sc.source)), ...render(sc.seasons[season], season, sc));
    draw();
    return host;
  }

  const hitter = {
    color: '#004687',
    facts,
    tiles: (gs) => [{ label: 'G', value: gs.length }, { label: 'AVG', value: avg3(rate(H(gs), AB(gs))) }, { label: 'OBP', value: avg3(OBP(gs)) }, { label: 'SLG', value: avg3(SLG(gs)) }, { label: 'OPS', value: avg3((OBP(gs) ?? 0) + (SLG(gs) ?? 0)) }, { label: 'HR', value: sumK(gs, 'bat_homeRuns') }, { label: 'RBI', value: sumK(gs, 'bat_rbi') }, { label: 'R', value: sumK(gs, 'bat_runs') }, { label: 'SB', value: sumK(gs, 'bat_stolenBases') }, { label: 'K%', value: `${fmt.n(U.pct(sumK(gs, 'bat_strikeOuts'), PA(gs)), 1)}%` }, { label: 'BB%', value: `${fmt.n(U.pct(sumK(gs, 'bat_baseOnBalls'), PA(gs)), 1)}%` }],
    seasonCols: [col('pa', 'PA', PA), col('ab', 'AB', AB), col('h', 'H', H), col('d', '2B', tot('bat_doubles')), col('t', '3B', tot('bat_triples')), col('hr', 'HR', tot('bat_homeRuns')), col('r', 'R', tot('bat_runs')), col('rbi', 'RBI', tot('bat_rbi')), col('bb', 'BB', tot('bat_baseOnBalls')), col('k', 'K', tot('bat_strikeOuts')), col('sb', 'SB', tot('bat_stolenBases')), col('avg', 'AVG', (gs) => rate(H(gs), AB(gs)), 3), col('obp', 'OBP', OBP, 3), col('slg', 'SLG', SLG, 3), col('ops', 'OPS', (gs) => (OBP(gs) ?? 0) + (SLG(gs) ?? 0), 3)],
    splitCols: [col('avg', 'AVG', (gs) => rate(H(gs), AB(gs)), 3), col('obp', 'OBP', OBP, 3), col('slg', 'SLG', SLG, 3), col('hrg', 'HR/G', pg('bat_homeRuns'), 2), col('kg', 'K/G', pg('bat_strikeOuts'), 2), col('tbg', 'TB/G', pg('bat_totalBases'), 2)],
    trendStats: [{ key: 'h', label: 'Hits', fn: one('bat_hits') }, { key: 'tb', label: 'Total bases', fn: one('bat_totalBases') }, { key: 'hr', label: 'Home runs', fn: one('bat_homeRuns') }, { key: 'k', label: 'Strikeouts', fn: one('bat_strikeOuts') }, { key: 'bb', label: 'Walks', fn: one('bat_baseOnBalls') }, { key: 'hrr', label: 'H+R+RBI', fn: (g) => U.st(g, 'bat_hits') + U.st(g, 'bat_runs') + U.st(g, 'bat_rbi') }],
    logCols: [col('ab', 'AB', one('bat_atBats')), col('h', 'H', one('bat_hits')), col('d', '2B', one('bat_doubles')), col('hr', 'HR', one('bat_homeRuns')), col('r', 'R', one('bat_runs')), col('rbi', 'RBI', one('bat_rbi')), col('bb', 'BB', one('bat_baseOnBalls')), col('k', 'K', one('bat_strikeOuts')), col('sb', 'SB', one('bat_stolenBases')), col('tb', 'TB', one('bat_totalBases'))],
    advanced: (doc) => [{ id: 'contact', label: 'Contact quality', node: section('contact', 'Contact quality & approach', 'Statcast, full season samples', statcastSeasonSwitch(doc, (S, season, sc) => {
      const pct = sc.percentiles2026;
      const pool = pct ? `among ${pct.pool} hitters with 150+ balls in play` : '';
      return [
        h('div', { class: 'split-2' },
          card({ title: 'Power profile', scope: season === '2026' && pct ? '2026 · league percentile' : `${season} · values`, info: 'Percentiles are 2026 only (league pool from the same corpus).', body: season === '2026' && pct ? h('div', null, pbar('Max exit velo', `${S.maxEV} mph`, pct.maxEV, { info: pool }), pbar('90th pct exit velo', `${S.p90EV} mph`, pct.p90EV, { info: pool }), pbar('Avg exit velo', `${S.avgEV} mph`, pct.avgEV, { info: pool }), pbar('Hard-hit rate', `${S.hardHit}%`, pct.hardHit, { info: `95+ mph · ${pool}` })) : statGrid([{ label: 'Max EV', value: S.maxEV }, { label: '90th pct EV', value: S.p90EV }, { label: 'Avg EV', value: S.avgEV }, { label: 'Hard-hit %', value: S.hardHit }]), foot: `${S.bip} balls in play · ${S.pitches} pitches seen` }),
          card({ title: 'Exit velocity distribution', scope: `${season} · every ball in play`, body: columnChart({ bars: S.evHist.map((b) => ({ label: b.lo % 10 === 0 ? String(b.lo) : '', value: b.n, lo: b.lo, color: b.lo >= 95 ? 'var(--ink)' : 'oklch(72% 0.004 260)' })), height: 180, labelEvery: 1, tooltip: (b) => [tipRow(`${b.value} balls`, `${b.lo}–${b.lo + 2} mph`)] }), foot: 'Dark = hard-hit (95+ mph)' })),
        card({ title: 'Exit velocity by game', scope: `${season} · game average and hardest hit`, body: lineChart({ series: [{ name: 'Hardest', color: 'oklch(66% 0.004 260)', values: S.trend.map((t) => t.max), width: 0.001, dots: true }, { name: 'Game avg (10-game)', color: 'var(--ink)', values: U.rolling(S.trend.map((t) => t.avg), 10) }], labels: S.trend.map((t, i) => (i === 0 || t.date.slice(5, 7) !== S.trend[i - 1].date.slice(5, 7) ? U.day(t.date).toLocaleDateString('en-US', { month: 'short' }) : '')), height: 220, yMin: 60, yMax: 120, refs: [{ y: 95, dash: true, label: '95 mph' }], tooltip: (i) => [tipRow(`${S.trend[i].max} mph`, 'hardest this game'), tipRow(`${S.trend[i].avg} mph`, `avg of ${S.trend[i].n} balls`), tipText(U.longDate(S.trend[i].date))] }) }),
        h('div', { class: 'split-2' },
          card({ title: 'Results by pitch type', scope: `${season} · 25+ pitches`, dense: true, body: dataTable([{ key: 'name', label: 'Pitch' }, { key: 'n', label: 'Seen', num: true }, { key: 'usage', label: 'Share', num: true, fmt: (v) => `${v}%` }, { key: 'whiff', label: 'Whiff %', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'xwoba', label: 'xwOBA', num: true, fmt: avg3 }, { key: 'ev', label: 'EV', num: true, fmt: (v) => fmt.n(v, 1) }], S.pitchTypes.map((p) => ({ ...p, name: PITCH_NAMES[p.type] || p.type })), { sortKey: 'n' }) }),
          card({ title: 'Strike zone', scope: `${season} · full season`, body: mlbZoneMap(S.zones, { perspective: 'hitter' }) })),
        h('div', { class: 'split-2' },
          card({ title: 'vs left- and right-handed pitchers', scope: `${season} · plate appearances`, dense: true, body: dataTable([{ key: 'hand', label: 'vs' }, { key: 'pa', label: 'PA', num: true }, { key: 'avg', label: 'AVG', num: true, fmt: avg3 }, { key: 'slg', label: 'SLG', num: true, fmt: avg3 }, { key: 'hr', label: 'HR', num: true }, { key: 'kPct', label: 'K %', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'bbPct', label: 'BB %', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'xwobacon', label: 'xwOBAcon', num: true, fmt: avg3 }], ['L', 'R'].map((k) => ({ hand: k === 'L' ? 'LHP' : 'RHP', ...S.splitsByHand[k] })), { sortKey: null }) }),
          card({ title: 'Home runs', scope: `${season} · ${S.hrList.length}`, dense: true, body: dataTable([{ key: 'date', label: 'Date', fmt: (v) => U.shortDate(v) }, { key: 'ev', label: 'EV', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'la', label: 'LA', num: true, fmt: (v) => (v == null ? '—' : `${Math.round(v)}°`) }, { key: 'pitch', label: 'Pitch', fmt: (v) => PITCH_NAMES[v] || v }, { key: 'velo', label: 'mph', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'd', label: 'Distance', sort: false, render: () => statusPill('dropped at ingest') }], S.hrList, { sortKey: 'ev' }) })),
      ];
    })) }],
  };

  const pitcher = {
    color: '#0c2340',
    facts,
    heroLine: () => 'Starting pitcher',
    tiles: (gs) => { const ip = IP(gs); return [{ label: 'GS', value: sumK(gs, 'pit_gamesStarted') }, { label: 'IP', value: fmt.n(ip, 1) }, { label: 'ERA', value: fmt.n(ip ? (9 * sumK(gs, 'pit_earnedRuns')) / ip : null, 2) }, { label: 'WHIP', value: fmt.n(ip ? (sumK(gs, 'pit_hits') + sumK(gs, 'pit_baseOnBalls')) / ip : null, 2) }, { label: 'K', value: sumK(gs, 'pit_strikeOuts') }, { label: 'BB', value: sumK(gs, 'pit_baseOnBalls') }, { label: 'K/9', value: fmt.n(ip ? (9 * sumK(gs, 'pit_strikeOuts')) / ip : null, 1) }, { label: 'HR', value: sumK(gs, 'pit_homeRuns') }, { label: 'IP/start', value: fmt.n(sumK(gs, 'pit_gamesStarted') ? ip / sumK(gs, 'pit_gamesStarted') : null, 1) }]; },
    seasonCols: [col('gs', 'GS', tot('pit_gamesStarted')), col('ip', 'IP', IP, 1), col('er', 'ER', tot('pit_earnedRuns')), col('era', 'ERA', (gs) => (IP(gs) ? (9 * sumK(gs, 'pit_earnedRuns')) / IP(gs) : null), 2), col('h', 'H', tot('pit_hits')), col('bb', 'BB', tot('pit_baseOnBalls')), col('k', 'K', tot('pit_strikeOuts')), col('hr', 'HR', tot('pit_homeRuns')), col('whip', 'WHIP', (gs) => (IP(gs) ? (sumK(gs, 'pit_hits') + sumK(gs, 'pit_baseOnBalls')) / IP(gs) : null), 2), col('k9', 'K/9', (gs) => (IP(gs) ? (9 * sumK(gs, 'pit_strikeOuts')) / IP(gs) : null), 1), col('bb9', 'BB/9', (gs) => (IP(gs) ? (9 * sumK(gs, 'pit_baseOnBalls')) / IP(gs) : null), 1)],
    splitCols: [col('ip', 'IP/G', (gs) => IP(gs) / gs.length, 1), col('era', 'ERA', (gs) => (IP(gs) ? (9 * sumK(gs, 'pit_earnedRuns')) / IP(gs) : null), 2), col('k', 'K/G', pg('pit_strikeOuts'), 1), col('bb', 'BB/G', pg('pit_baseOnBalls'), 1), col('h', 'H/G', pg('pit_hits'), 1)],
    trendStats: [{ key: 'k', label: 'Strikeouts', fn: one('pit_strikeOuts') }, { key: 'outs', label: 'Outs recorded', fn: (g) => ipOuts(U.st(g, 'pit_inningsPitched')) }, { key: 'er', label: 'Earned runs', fn: one('pit_earnedRuns') }, { key: 'h', label: 'Hits allowed', fn: one('pit_hits') }, { key: 'bb', label: 'Walks', fn: one('pit_baseOnBalls') }],
    logCols: [col('ip', 'IP', one('pit_inningsPitched'), 1), col('h', 'H', one('pit_hits')), col('er', 'ER', one('pit_earnedRuns')), col('bb', 'BB', one('pit_baseOnBalls')), col('k', 'K', one('pit_strikeOuts')), col('hr', 'HR', one('pit_homeRuns'))],
    advanced: (doc) => [{ id: 'arsenal', label: 'Arsenal', node: section('arsenal', 'Arsenal & command', 'Statcast, every pitch thrown', statcastSeasonSwitch(doc, (S, season) => [
      card({ title: 'Arsenal', scope: `${season} · ${S.pitches} pitches`, dense: true, info: 'CSW = called strikes plus whiffs per pitch.', body: dataTable([{ key: 'name', label: 'Pitch' }, { key: 'usage', label: 'Usage', num: true, fmt: (v) => `${v}%` }, { key: 'velo', label: 'Velo', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'whiff', label: 'Whiff %', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'csw', label: 'CSW %', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'xwoba', label: 'xwOBA', num: true, fmt: avg3 }, { key: 'ev', label: 'EV allowed', num: true, fmt: (v) => fmt.n(v, 1) }], S.pitchTypes.map((p) => ({ ...p, name: PITCH_NAMES[p.type] || p.type })), { sortKey: 'usage' }), foot: 'Spin rate and movement: dropped at ingest' }),
      h('div', { class: 'split-2' }, card({ title: 'Pitch locations', scope: `${season} · by type`, body: S.locations ? mlbPitchLocations(S.locations) : statusPill('no locations') }), card({ title: 'Where he pitches', scope: `${season} · zone map`, body: mlbZoneMap(S.zones, { perspective: 'pitcher' }) })),
      h('div', { class: 'split-2' },
        card({ title: 'Fastball velocity by start', scope: `${season} · four-seam and sinker`, body: lineChart({ series: [{ name: 'Max', color: 'oklch(66% 0.004 260)', values: S.trend.map((t) => t.max), width: 0.001, dots: true }, { name: 'Avg', color: 'var(--ink)', values: S.trend.map((t) => t.avg) }], labels: S.trend.map((t) => U.shortDate(t.date)), height: 200, tooltip: (i) => [tipRow(`${S.trend[i].avg} mph`, 'average'), tipRow(`${S.trend[i].max} mph`, 'max'), tipText(`${U.longDate(S.trend[i].date)} · ${S.trend[i].n} fastballs`)] }) }),
        card({ title: 'vs left- and right-handed hitters', scope: `${season}`, dense: true, body: dataTable([{ key: 'hand', label: 'vs' }, { key: 'pa', label: 'PA', num: true }, { key: 'avg', label: 'AVG', num: true, fmt: avg3 }, { key: 'slg', label: 'SLG', num: true, fmt: avg3 }, { key: 'kPct', label: 'K %', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'bbPct', label: 'BB %', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'hr', label: 'HR', num: true }], ['L', 'R'].map((k) => ({ hand: k === 'L' ? 'LHH' : 'RHH', ...S.splitsByHand[k] })), { sortKey: null }) })),
    ])) }],
  };

  SPORTS.mlb = { label: 'MLB', subjects: [{ slug: 'mlb-witt', label: 'Hitter · Witt Jr.', spec: hitter }, { slug: 'mlb-skubal', label: 'Pitcher · Skubal', spec: pitcher }] };
})();
