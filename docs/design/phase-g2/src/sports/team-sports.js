/* Team page specs per sport. */
(() => {
  const k = (p, key) => p.totals[key] ?? 0;
  const per = (p, key) => (p.games ? k(p, key) / p.games : null);
  const pct = (a, b) => (b ? (100 * a) / b : null);

  /* Ranked stats (computed across all teams in the builder), grouped into cards. */
  function rankedCards(doc, season, { note } = {}) {
    const list = (doc.ranked || {})[String(season)] || [];
    if (!list.length) return card({ title: 'Team stats', body: h('div', { class: 'state' }, h('b', null, 'No ranked stats for this season'), 'ESPN has not published team statistics for it yet.') });
    const groups = [...new Set(list.map((x) => x.group))];
    return h('div', { class: groups.length > 1 ? 'split-2' : '' }, ...groups.map((g, gi) => {
      const rows = list.filter((x) => x.group === g);
      return card({ title: g, scope: `rank of ${rows[0].of} · dot strip = every team`, info: 'Ranks are computed across every team from ESPN’s team statistics, with the better direction set per stat.', body: h('div', null, ...rows.map((r) => rankRow({ label: r.label, display: r.display, rank: r.rank, of: r.of, league: r.league, value: r.value, better: r.better }))), foot: gi === groups.length - 1 ? note : null });
    }));
  }

  const base = (o) => ({ ties: false, closeMargin: 3, diffLabel: 'Point differential', unit: 'Points', unitShort: 'Pts', seasonName: (s) => String(s), pgh: (s) => s, minGames: 4, ...o });

  /* ---------------- MLB ---------------- */
  TEAM_SPORTS.mlb = { label: 'MLB', slug: 'mlb-royals', spec: base({
    closeMargin: 1, diffLabel: 'Run differential', unit: 'Runs', unitShort: 'R', minGames: 20, standingSeason: 2026,
    standingCols: [{ key: 'wins', label: 'W', num: true }, { key: 'losses', label: 'L', num: true }, { key: 'winPercent', label: 'PCT', num: true }, { key: 'gamesBehind', label: 'GB', num: true }, { key: 'divisionGamesBehind', label: 'Div GB', num: true }, { key: 'pointDifferential', label: 'Diff', num: true }, { key: 'Home', label: 'Home' }, { key: 'Road', label: 'Road' }, { key: 'Last Ten Games', label: 'L10' }, { key: 'streak', label: 'Strk' }, { key: 'playoffPercent', label: 'Playoff %' }],
    standingOrder: (a, b) => (G.numOf(b.stats.winPercent) || 0) - (G.numOf(a.stats.winPercent) || 0),
    statsNode: (doc, season) => rankedCards(doc, season),
    rosterNode: (doc, season) => rosterCard(doc, season, [
      { id: 'bat', label: 'Hitters', filter: (p) => k(p, 'bat_atBats') > 0, sort: 'pa', cols: [{ key: 'pa', label: 'PA', fn: (p) => k(p, 'bat_plateAppearances') }, { key: 'hh', label: 'H', fn: (p) => k(p, 'bat_hits') }, { key: 'hr', label: 'HR', fn: (p) => k(p, 'bat_homeRuns') }, { key: 'rbi', label: 'RBI', fn: (p) => k(p, 'bat_rbi') }, { key: 'r', label: 'R', fn: (p) => k(p, 'bat_runs') }, { key: 'sb', label: 'SB', fn: (p) => k(p, 'bat_stolenBases') }, { key: 'bb', label: 'BB', fn: (p) => k(p, 'bat_baseOnBalls') }, { key: 'so', label: 'K', fn: (p) => k(p, 'bat_strikeOuts') }, { key: 'avg', label: 'AVG', dec: 3, fn: (p) => (k(p, 'bat_atBats') ? k(p, 'bat_hits') / k(p, 'bat_atBats') : null) }, { key: 'obp', label: 'OBP', dec: 3, fn: (p) => { const d = k(p, 'bat_plateAppearances'); return d ? (k(p, 'bat_hits') + k(p, 'bat_baseOnBalls') + k(p, 'bat_hitByPitch')) / d : null; } }, { key: 'slg', label: 'SLG', dec: 3, fn: (p) => (k(p, 'bat_atBats') ? k(p, 'bat_totalBases') / k(p, 'bat_atBats') : null) }] },
      { id: 'pit', label: 'Pitchers', filter: (p) => k(p, 'pit_outs') > 0, sort: 'ip', cols: [{ key: 'gs', label: 'GS', fn: (p) => k(p, 'pit_gamesStarted') }, { key: 'ip', label: 'IP', dec: 1, fn: (p) => k(p, 'pit_outs') / 3 }, { key: 'era', label: 'ERA', dec: 2, fn: (p) => (k(p, 'pit_outs') ? (27 * k(p, 'pit_earnedRuns')) / k(p, 'pit_outs') : null) }, { key: 'whip', label: 'WHIP', dec: 2, fn: (p) => (k(p, 'pit_outs') ? (3 * (k(p, 'pit_hits') + k(p, 'pit_baseOnBalls'))) / k(p, 'pit_outs') : null) }, { key: 'so', label: 'K', fn: (p) => k(p, 'pit_strikeOuts') }, { key: 'bb', label: 'BB', fn: (p) => k(p, 'pit_baseOnBalls') }, { key: 'hr', label: 'HR', fn: (p) => k(p, 'pit_homeRuns') }, { key: 'k9', label: 'K/9', dec: 1, fn: (p) => (k(p, 'pit_outs') ? (27 * k(p, 'pit_strikeOuts')) / k(p, 'pit_outs') : null) }] },
    ], { note: 'OBP here is (H+BB+HBP)/PA; sacrifice flies are not in the stored logs. IP is rebuilt from outs per game.' }),
    native: (doc, season) => {
      const S = doc.statcast;
      const rows = (side, defs) => defs.map(([key, label, better, f]) => { const v = S[side].team?.[key]; const lg = S[side].league[key] || []; if (v == null || !lg.length) return null; const order = [...lg].sort((a, b) => (better === 'high' ? b - a : a - b)); return rankRow({ label, display: f(v), rank: order.indexOf(v) + 1, of: lg.length, league: lg, value: v, better }); }).filter(Boolean);
      const p1 = (v) => `${fmt.n(v, 1)}%`;
      return [{ id: 'statcast', label: 'Statcast', node: section('statcast', 'Contact & pitch quality', `Statcast ${doc.schedule ? '2026' : ''} · rank among ${S.bat.teams} teams`, String(season) !== '2026' ? statusPill('Team Statcast is built for 2026 only in this mockup') : null,
        h('div', { class: 'split-2' },
          card({ title: 'Hitters', scope: `${fmt.n(S.bat.team?.pitches)} pitches seen`, body: h('div', null, ...rows('bat', [['avgEV', 'Avg exit velocity', 'high', (v) => `${fmt.n(v, 1)} mph`], ['hardHit', 'Hard-hit % (95+ mph)', 'high', p1], ['sweetSpot', 'Sweet-spot % (8–32°)', 'high', p1], ['barrelish', 'EV 98+ at 26–30°', 'high', p1], ['hrPct', 'HR / PA', 'high', p1], ['kPct', 'K %', 'low', p1], ['bbPct', 'BB %', 'high', p1], ['whiff', 'Whiff % (per swing)', 'low', p1], ['chase', 'Chase % (swings outside zone)', 'low', p1]])) }),
          card({ title: 'Pitchers', scope: `${fmt.n(S.pit.team?.pitches)} pitches thrown`, body: h('div', null, ...rows('pit', [['ffVelo', 'Four-seam velocity', 'high', (v) => `${fmt.n(v, 1)} mph`], ['kPct', 'K %', 'high', p1], ['bbPct', 'BB %', 'low', p1], ['whiff', 'Whiff %', 'high', p1], ['chase', 'Chase %', 'high', p1], ['hardHit', 'Hard-hit % allowed', 'low', p1], ['avgEV', 'Avg exit velocity allowed', 'low', (v) => `${fmt.n(v, 1)} mph`], ['hrPct', 'HR / PA allowed', 'low', p1]])) })),
        h('div', { class: 't-label' }, `Corpus pitches joined to a team through the app’s game logs: ${fmt.n(S.pitchesJoined)} of ${fmt.n(S.pitchesTotal)} (${fmt.n((100 * S.pitchesJoined) / S.pitchesTotal, 0)}%). True barrels need the Statcast barrel table, which isn’t held.`)) }];
    },
  }) };

  /* ---------------- NFL / CFB ---------------- */
  const footballRoster = (doc, season) => rosterCard(doc, season, [
    { id: 'pass', label: 'Passing', filter: (p) => k(p, 'passing.passingAttempts') > 0, sort: 'yds', cols: [{ key: 'cmp', label: 'Cmp', fn: (p) => k(p, 'passing.completions') }, { key: 'att', label: 'Att', fn: (p) => k(p, 'passing.passingAttempts') }, { key: 'pct', label: 'Cmp%', dec: 1, fn: (p) => pct(k(p, 'passing.completions'), k(p, 'passing.passingAttempts')) }, { key: 'yds', label: 'Yds', fn: (p) => k(p, 'passing.passingYards') }, { key: 'ya', label: 'Y/A', dec: 1, fn: (p) => (k(p, 'passing.passingAttempts') ? k(p, 'passing.passingYards') / k(p, 'passing.passingAttempts') : null) }, { key: 'td', label: 'TD', fn: (p) => k(p, 'passing.passingTouchdowns') }, { key: 'int', label: 'INT', fn: (p) => k(p, 'passing.interceptions') }, { key: 'sk', label: 'Sacked', fn: (p) => k(p, 'passing.sacks') }] },
    { id: 'rush', label: 'Rushing', filter: (p) => k(p, 'rushing.rushingAttempts') > 0, sort: 'yds', cols: [{ key: 'att', label: 'Att', fn: (p) => k(p, 'rushing.rushingAttempts') }, { key: 'yds', label: 'Yds', fn: (p) => k(p, 'rushing.rushingYards') }, { key: 'ya', label: 'Y/A', dec: 1, fn: (p) => (k(p, 'rushing.rushingAttempts') ? k(p, 'rushing.rushingYards') / k(p, 'rushing.rushingAttempts') : null) }, { key: 'td', label: 'TD', fn: (p) => k(p, 'rushing.rushingTouchdowns') }, { key: 'ypg', label: 'Yds/G', dec: 1, fn: (p) => per(p, 'rushing.rushingYards') }] },
    { id: 'rec', label: 'Receiving', filter: (p) => k(p, 'receiving.receptions') > 0 || k(p, 'receiving.receivingTargets') > 0, sort: 'yds', cols: [{ key: 'tgt', label: 'Tgt', fn: (p) => k(p, 'receiving.receivingTargets') || null }, { key: 'rec', label: 'Rec', fn: (p) => k(p, 'receiving.receptions') }, { key: 'yds', label: 'Yds', fn: (p) => k(p, 'receiving.receivingYards') }, { key: 'ypr', label: 'Y/R', dec: 1, fn: (p) => (k(p, 'receiving.receptions') ? k(p, 'receiving.receivingYards') / k(p, 'receiving.receptions') : null) }, { key: 'td', label: 'TD', fn: (p) => k(p, 'receiving.receivingTouchdowns') }, { key: 'ypg', label: 'Yds/G', dec: 1, fn: (p) => per(p, 'receiving.receivingYards') }] },
    { id: 'def', label: 'Defense', filter: (p) => k(p, 'defensive.totalTackles') > 0, sort: 'tkl', cols: [{ key: 'tkl', label: 'Tkl', fn: (p) => k(p, 'defensive.totalTackles') }, { key: 'solo', label: 'Solo', fn: (p) => k(p, 'defensive.soloTackles') }, { key: 'tfl', label: 'TFL', fn: (p) => k(p, 'defensive.tacklesForLoss') }, { key: 'sk', label: 'Sacks', dec: 1, fn: (p) => k(p, 'defensive.sacks') }, { key: 'qbh', label: 'QB hits', fn: (p) => k(p, 'defensive.QBHits') }, { key: 'pd', label: 'PD', fn: (p) => k(p, 'defensive.passesDefended') }, { key: 'int', label: 'INT', fn: (p) => k(p, 'interceptions.interceptions') }] },
  ], { note: 'Rate stats (QBR, passer rating) are left out: per-game rates can’t be summed into a season.' });

  const footballStandCols = [{ key: 'overall', label: 'Record' }, { key: 'winPercent', label: 'PCT', num: true }, { key: 'pointsFor', label: 'PF', num: true }, { key: 'pointsAgainst', label: 'PA', num: true }, { key: 'pointDifferential', label: 'Diff', num: true }, { key: 'Home', label: 'Home' }, { key: 'Road', label: 'Road' }, { key: 'Away', label: 'Away' }, { key: 'vs. Div.', label: 'Div' }, { key: 'vs. Conf.', label: 'Conf' }, { key: 'vs AP Top 25', label: 'vs Top 25' }, { key: 'streak', label: 'Strk' }, { key: 'playoffSeed', label: 'Seed', num: true }];

  function passingGame(doc, season) {
    const t = (doc.targets || {})[String(season)];
    if (!t) return [{ id: 'passing', label: 'Passing game', node: section('passing', 'Passing game', null, card({ title: 'Targets', body: h('div', { class: 'state' }, `No target data for ${season}`) })) }];
    const maxShare = Math.max(...t.receivers.map((r) => r.share));
    const shareCard = card({ title: 'Target share', scope: `${t.total} targets · ${t.passers.map(([n, c]) => `${n} ${c}`).join(', ')}`, body: h('div', null, ...t.receivers.map((r) => {
      const row = h('div', { class: 'pbar', style: { gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1.5fr) 120px' } },
        h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '8px' } }, avatar(r.headshot, 26, { label: r.name }), h('span', { class: 't-sm' }, h('a', { class: 'lnk', href: '#player' }, r.name), h('span', { class: 't-label' }, ` ${r.pos || ''}`))),
        h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: `${(100 * r.share) / maxShare}%`, background: 'color-mix(in oklch, var(--cmp-a) 45%, transparent)' } })),
        h('div', { class: 't-sm num', style: { textAlign: 'right' } }, h('b', null, `${fmt.n(r.share, 1)}%`), h('span', { class: 't-label' }, ` · ${r.targets} tgt`)));
      Tip.bind(row, () => [tipRow(`${fmt.n(r.share, 1)}%`, `${r.name} target share`), tipText(`${r.catches} catches · ${r.tds} TD · aDOT ${fmt.n(r.adot, 1)} · ${r.deep} deep targets · ${r.yac} YAC`)]);
      return row;
    })), foot: 'aDOT = average depth of target · from nflverse play-by-play' });
    const cells = [['deep', 'left'], ['deep', 'middle'], ['deep', 'right'], ['short', 'left'], ['short', 'middle'], ['short', 'right']];
    const grid = svgHost((W) => {
      const H = 240, cw = W / 3, ch = (H - 30) / 2; const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Where the team throws' });
      svg.append(s('rect', { x: 0, y: 0, width: W, height: H - 30, rx: 8, fill: 'oklch(96% 0.012 150)' }));
      cells.forEach(([len, loc], i) => {
        const key = `${len}|${loc}`; const me = t.grid[key] || {}; const lg = t.leagueGrid[key] || {}; const d = (me.share || 0) - (lg.share || 0);
        const x = (i % 3) * cw, y = Math.floor(i / 3) * ch;
        const fill = Math.abs(d) < 1 ? 'oklch(95% 0 0)' : d > 0 ? `color-mix(in srgb, var(--cmp-a) ${Math.round(Math.min(75, 9 * d + 12))}%, #f2f2f2)` : `color-mix(in srgb, var(--cmp-b) ${Math.round(Math.min(75, -9 * d + 12))}%, #f2f2f2)`;
        const g = s('g'); g.append(s('rect', { x: x + 3, y: y + 3, width: cw - 6, height: ch - 6, rx: 6, fill }), s('text', { x: x + cw / 2, y: y + ch / 2 - 4, 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 700, fill: 'var(--ink)' }, `${fmt.n(me.share, 0)}%`), s('text', { x: x + cw / 2, y: y + ch / 2 + 16, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--ink-2)' }, `league ${fmt.n(lg.share, 0)}% · ${fmt.n(me.comp, 0)}% comp`));
        svg.append(hoverable(g, () => [tipRow(`${fmt.n(me.share, 1)}% of throws`, `${len} ${loc}`), tipText(`League ${fmt.n(lg.share, 1)}% · difference ${d > 0 ? '+' : ''}${fmt.n(d, 1)} pts`), tipText(`${me.att || 0} attempts, ${fmt.n(me.comp, 0)}% completed (league ${fmt.n(lg.comp, 0)}%)`)]));
      });
      svg.append(s('line', { x1: 0, x2: W, y1: ch, y2: ch, stroke: '#fff', 'stroke-width': 3 }), s('text', { class: 'axis-t', x: W / 2, y: H - 10, 'text-anchor': 'middle' }, 'Line of scrimmage · deep = 15+ air yards'));
      return h('div', { class: 'chart' }, svg);
    });
    return [{ id: 'passing', label: 'Passing game', node: section('passing', 'Passing game', 'targets and throw map, nflverse play-by-play', h('div', { class: 'split-2' }, shareCard, card({ title: 'Where they throw', scope: `share of attempts vs the league (${t.leagueTeams} teams)`, body: h('div', null, grid, vizLegend([['More than league', 'var(--cmp-a)'], ['Within 1 point', '#ececec'], ['Less than league', 'var(--cmp-b)']])), foot: `Status: EPA ${doc.status.epa || 'not held'}` }))) }];
  }

  TEAM_SPORTS.nfl = { label: 'NFL', slug: 'nfl-raiders', spec: base({
    closeMargin: 8, minGames: 4, standingSeason: 2026, standingCols: footballStandCols, standingOrder: (a, b) => (G.numOf(a.stats.playoffSeed) || 99) - (G.numOf(b.stats.playoffSeed) || 99),
    standingLine: (doc) => doc.team.standing,
    statsNode: (doc, season) => rankedCards(doc, season, { note: 'Points allowed and yards allowed are not in ESPN’s team statistics feed; points allowed per game is in the header.' }),
    rosterNode: footballRoster, native: passingGame,
  }) };
  TEAM_SPORTS.cfb = { label: 'CFB', slug: 'cfb-ohio-state', spec: base({
    closeMargin: 8, minGames: 4, standingSeason: 2026, standingCols: footballStandCols, standingOrder: () => 0,
    statsNode: (doc, season) => rankedCards(doc, season, { note: 'FBS teams only.' }),
    rosterNode: footballRoster,
    native: (doc, season) => { const gs = T.done(doc.schedule[String(season)]); const ranked = gs.filter((g) => g.oppRank); return [{ id: 'sos', label: 'Ranked opponents', node: section('sos', 'Ranked opponents', 'from the AP poll at kickoff', card({ title: `${T.record(ranked)} vs ranked teams`, dense: true, body: ranked.length ? dataTable([{ key: 'date', label: 'Date', fmt: (v) => U.shortDate(v.slice(0, 10)) }, { key: 'opp', label: 'Opponent', render: (r) => h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, avatar(r.opp.logo, 20, { logo: true, label: r.opp.abbr }), `No. ${r.oppRank} ${r.opp.name}`) }, { key: 'res', label: 'Result', render: (r) => `${r.result} ${fmt.n(r.us)}–${fmt.n(r.them)}` }], ranked, { sortKey: null }) : h('div', { class: 'state' }, 'No ranked opponents played'), foot: `Advanced team stats: ${doc.status.advanced}` })) }]; },
  }) };

  /* ---------------- NBA ---------------- */
  TEAM_SPORTS.nba = { label: 'NBA', slug: 'nba-lakers', spec: base({
    closeMargin: 5, minGames: 15, seasonName: (s) => `${s - 1}-${String(s).slice(2)}`, standingSeason: 2026,
    standingCols: [{ key: 'wins', label: 'W', num: true }, { key: 'losses', label: 'L', num: true }, { key: 'winPercent', label: 'PCT', num: true }, { key: 'gamesBehind', label: 'GB', num: true }, { key: 'avgPointsFor', label: 'PPG', num: true }, { key: 'avgPointsAgainst', label: 'OPP', num: true }, { key: 'differential', label: 'Diff', num: true }, { key: 'Home', label: 'Home' }, { key: 'Road', label: 'Road' }, { key: 'Last Ten Games', label: 'L10' }, { key: 'streak', label: 'Strk' }, { key: 'playoffSeed', label: 'Seed', num: true }],
    standingOrder: (a, b) => (G.numOf(a.stats.playoffSeed) || 99) - (G.numOf(b.stats.playoffSeed) || 99),
    statsNode: (doc, season) => rankedCards(doc, season),
    rosterNode: (doc, season) => rosterCard(doc, season, [{ id: 'all', label: 'Players', filter: (p) => p.games > 0, sort: 'pts', cols: [{ key: 'min', label: 'MIN', dec: 1, fn: (p) => per(p, 'minutes') }, { key: 'pts', label: 'PTS', dec: 1, fn: (p) => per(p, 'points') }, { key: 'reb', label: 'REB', dec: 1, fn: (p) => per(p, 'rebounds') }, { key: 'ast', label: 'AST', dec: 1, fn: (p) => per(p, 'assists') }, { key: 'tpm', label: '3PM', dec: 1, fn: (p) => per(p, 'threePointFieldGoalsMade') }, { key: 'fg', label: 'FG%', dec: 1, fn: (p) => pct(k(p, 'fieldGoalsMade'), k(p, 'fieldGoalsAttempted')) }, { key: 'tp', label: '3P%', dec: 1, fn: (p) => pct(k(p, 'threePointFieldGoalsMade'), k(p, 'threePointFieldGoalsAttempted')) }, { key: 'ft', label: 'FT%', dec: 1, fn: (p) => pct(k(p, 'freeThrowsMade'), k(p, 'freeThrowsAttempted')) }, { key: 'stl', label: 'STL', dec: 1, fn: (p) => per(p, 'steals') }, { key: 'blk', label: 'BLK', dec: 1, fn: (p) => per(p, 'blocks') }, { key: 'tov', label: 'TOV', dec: 1, fn: (p) => per(p, 'turnovers') }, { key: 'pm', label: '+/-', fn: (p) => k(p, 'plusMinus') }] }], { note: 'Per game; +/- is the season total.' }),
    native: (doc) => {
      const S = doc.shots; const zoneRows = S.zones.map((z) => { const lg = S.league[z.zone]; const rk = (key, v) => (v == null ? null : [...lg[key]].sort((a, b) => b - a).indexOf(v) + 1); return { ...z, shareRank: rk('share', z.share), fgRank: rk('fg', z.fg), of: lg.share.length, lgShare: U.avg(lg.share), lgFg: U.avg(lg.fg) }; });
      const court = svgHost((W) => {
        const H = W * (47 / 50), X = (x) => (x / 50) * W, Y = (y) => (y / 47) * H;
        const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Shot frequency versus league' });
        svg.append(s('rect', { x: 0, y: 0, width: W, height: H, rx: 8, fill: 'oklch(97% 0.008 70)' }));
        const league = new Map(S.leagueBins.map(([key, rate]) => [key, rate / Math.max(1, S.teams)]));
        const lgTotal = U.sum([...league.values()]), myTotal = U.sum(S.bins.map((b) => b[1]));
        for (const [key, rate, makes] of S.bins) {
          const [xi, yi] = key.split('|').map(Number); if (yi > 15) continue;
          const share = rate / myTotal, lgShare = (league.get(key) || 0) / lgTotal; if (share < 0.002 && lgShare < 0.002) continue;
          const ratio = lgShare ? share / lgShare : 2; const d = Math.log2(Math.max(0.25, Math.min(4, ratio)));
          const fill = Math.abs(d) < 0.15 ? '#e9e9e9' : d > 0 ? `color-mix(in srgb, var(--cmp-a) ${Math.round(20 + Math.min(1, d / 1.2) * 70)}%, #f2f2f2)` : `color-mix(in srgb, var(--cmp-b) ${Math.round(20 + Math.min(1, -d / 1.2) * 70)}%, #f2f2f2)`;
          const cell = s('rect', { x: X(xi * 3) + 1, y: Y(yi * 3) + 1, width: X(3) - 2, height: Y(3) - 2, rx: 2, fill, opacity: share < 0.004 ? 0.45 : 1 });
          svg.append(hoverable(cell, () => [tipRow(`${fmt.n(rate, 2)} FGA / game`, `${fmt.n(100 * share, 1)}% of shots`), tipText(`League ${fmt.n(100 * lgShare, 1)}% · ${ratio >= 1 ? `${fmt.n(ratio, 1)}× league` : `${fmt.n(1 / ratio, 1)}× less than league`}`), tipText(`${makes} made in ${S.games} games`)]));
        }
        const L = { fill: 'none', stroke: 'var(--ink-faint)', 'stroke-width': 1.2 };
        const ang = Math.acos(22 / 23.75), yC = 5.25 + 23.75 * Math.sin(ang);
        svg.append(s('rect', { x: X(17), y: 0, width: X(16), height: Y(19), ...L }), s('circle', { cx: X(25), cy: Y(5.25), r: X(0.75), ...L }), s('path', { d: `M${X(3)},0 L${X(3)},${Y(yC)} A${X(23.75)},${Y(23.75)} 0 0 0 ${X(47)},${Y(yC)} L${X(47)},0`, ...L }));
        return h('div', { class: 'chart' }, svg);
      });
      return [{ id: 'shots', label: 'Shot profile', node: section('shots', 'Shot profile', `${S.season} — the only season of shot locations held · ${S.games} games`, h('div', { class: 'split-2' },
        card({ title: 'Where they shoot vs the league', scope: '3 ft cells', body: h('div', null, court, vizLegend([['More often than league', 'var(--cmp-a)'], ['About the same', '#e9e9e9'], ['Less often than league', 'var(--cmp-b)']])), foot: 'Rim-origin corrected (the stored coordinates put the rim at ≈1 ft)' }),
        card({ title: 'By zone', scope: `rank of ${zoneRows[0]?.of}`, dense: true, body: dataTable([{ key: 'zone', label: 'Zone' }, { key: 'fga_pg', label: 'FGA/G', num: true, fmt: (v) => fmt.n(v, 1) }, { key: 'share', label: 'Share', num: true, render: (r) => h('span', null, `${fmt.n(r.share, 1)}%`, h('span', { class: 't-label' }, ` · lg ${fmt.n(r.lgShare, 1)}`)) }, { key: 'fg', label: 'FG%', num: true, render: (r) => h('span', null, fmt.n(r.fg, 1), h('span', { class: 't-label' }, ` · ${T.ord(r.fgRank)}`)) }, { key: 'pps', label: 'Pts/shot', num: true, fmt: (v) => fmt.n(v, 2) }], zoneRows, { sortKey: null }), foot: 'Share rank and FG% rank are among all 30 teams' }))) }];
    },
  }) };

  /* ---------------- NHL ---------------- */
  TEAM_SPORTS.nhl = { label: 'NHL', slug: 'nhl-maple-leafs', spec: base({
    ties: true, closeMargin: 1, diffLabel: 'Goal differential', unit: 'Goals', unitShort: 'G', minGames: 15, seasonName: (s) => `${s - 1}-${String(s).slice(2)}`, pgh: (s) => s - 1, standingSeason: 2026,
    standingCols: [{ key: 'gamesPlayed', label: 'GP', num: true }, { key: 'wins', label: 'W', num: true }, { key: 'losses', label: 'L', num: true }, { key: 'otLosses', label: 'OTL', num: true }, { key: 'points', label: 'PTS', num: true }, { key: 'regWins', label: 'RW', num: true }, { key: 'pointsFor', label: 'GF', num: true }, { key: 'pointsAgainst', label: 'GA', num: true }, { key: 'pointDifferential', label: 'Diff', num: true }, { key: 'Home', label: 'Home' }, { key: 'Road', label: 'Road' }, { key: 'Last Ten Games', label: 'L10' }, { key: 'streak', label: 'Strk' }],
    standingOrder: (a, b) => (G.numOf(b.stats.points) || 0) - (G.numOf(a.stats.points) || 0),
    statsNode: (doc, season) => rankedCards(doc, season),
    rosterNode: (doc, season) => rosterCard(doc, season - 1, [
      { id: 'sk', label: 'Skaters', filter: (p) => p.pos !== 'G' && !k(p, 'isGoalie'), sort: 'pts', cols: [{ key: 'g', label: 'G', fn: (p) => k(p, 'goals') }, { key: 'a', label: 'A', fn: (p) => k(p, 'assists') }, { key: 'pts', label: 'P', fn: (p) => k(p, 'points') }, { key: 'pm', label: '+/-', fn: (p) => k(p, 'plusMinus') }, { key: 'sog', label: 'SOG', fn: (p) => k(p, 'sog') }, { key: 'shp', label: 'S%', dec: 1, fn: (p) => pct(k(p, 'goals'), k(p, 'sog')) }, { key: 'ppg', label: 'PPG', fn: (p) => k(p, 'powerPlayGoals') }, { key: 'hits', label: 'Hits', fn: (p) => k(p, 'hits') }, { key: 'blk', label: 'Blk', fn: (p) => k(p, 'blockedShots') }, { key: 'toi', label: 'TOI/G', dec: 1, fn: (p) => per(p, 'toiMinutes') }] },
      { id: 'g', label: 'Goalies', filter: (p) => p.pos === 'G' || k(p, 'isGoalie'), sort: 'gp', cols: [{ key: 'gp', label: 'GP', fn: (p) => p.games }, { key: 'sa', label: 'SA', fn: (p) => k(p, 'shotsAgainst') }, { key: 'sv', label: 'SV', fn: (p) => k(p, 'saves') }, { key: 'svp', label: 'SV%', dec: 1, fn: (p) => pct(k(p, 'saves'), k(p, 'shotsAgainst')) }, { key: 'gaa', label: 'GAA', dec: 2, fn: (p) => (k(p, 'toiMinutes') ? (60 * k(p, 'goalsAgainst')) / k(p, 'toiMinutes') : null) }, { key: 'ppga', label: 'PP GA', fn: (p) => k(p, 'powerPlayGoalsAgainst') }] },
    ]),
    native: (doc) => {
      const S = doc.shots; let side = 'for'; const host = h('div');
      const draw = () => {
        const bins = S.bins[side]; const max = Math.max(...bins.map((b) => b[1]));
        put(host, segmented([{ value: 'for', label: 'Shots for' }, { value: 'against', label: 'Shots against' }], side, (v) => { side = v; draw(); }),
          svgHost((W) => {
            const H = W * (85 / 100); const X = (x) => (x / 100) * W; const Y = (y) => ((42.5 - y) / 85) * H;
            const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Shot attempts ${side}` });
            svg.append(s('rect', { x: 0, y: 0, width: W, height: H, rx: 12, fill: 'oklch(98% 0.006 230)', stroke: 'var(--line)' }));
            for (const [key, rate, goals] of bins) {
              const [xi, yi] = key.split('|').map(Number); const x = xi * 5, y = yi * 5 - 42.5;
              const tone = Math.sqrt(rate / max);
              svg.append(hoverable(s('rect', { x: X(x) + 1, y: Y(y + 5) + 1, width: X(5) - 2, height: Y(0) - Y(5) - 2, rx: 2, fill: `color-mix(in oklch, ${side === 'for' ? 'var(--cmp-a)' : 'var(--cmp-b)'} ${Math.round(tone * 90)}%, oklch(98% 0.006 230))` }), () => [tipRow(`${fmt.n(rate, 2)} / game`, `attempts ${side}`), tipText(`${goals} goals in ${S.games} games`)]));
            }
            svg.append(s('line', { x1: X(25), x2: X(25), y1: 0, y2: H, stroke: 'oklch(55% 0.12 250)', 'stroke-width': 3, opacity: 0.5 }), s('line', { x1: X(89), x2: X(89), y1: Y(36), y2: Y(-36), stroke: 'oklch(62% 0.16 25)', 'stroke-width': 1.5 }), s('rect', { x: X(89), y: Y(3), width: X(3.5), height: Y(-3) - Y(3), fill: 'none', stroke: 'var(--ink-muted)', 'stroke-width': 1.5 }), ...[22, -22].map((y) => s('circle', { cx: X(69), cy: Y(y), r: X(15), fill: 'none', stroke: 'oklch(62% 0.16 25)', opacity: 0.5 })));
            return h('div', { class: 'chart' }, svg);
          }));
      };
      draw();
      const lg = S.attemptsPerGame.league;
      return [{ id: 'shots', label: 'Shot map', node: section('shots', 'Shot map', `${S.season} regular season — the only season of shot locations held`, h('div', { class: 'split-3-2' },
        card({ title: 'Where attempts come from', scope: `per game · ${S.games} games · offensive zone`, body: host, foot: doc.status.xg }),
        h('div', { class: 'stack' }, card({ title: 'Volume', body: rankRow({ label: 'Shot attempts / game', display: fmt.n(S.attemptsPerGame.team, 1), rank: [...lg].sort((a, b) => b - a).indexOf(S.attemptsPerGame.team) + 1, of: lg.length, league: lg, value: S.attemptsPerGame.team, better: 'high' }) }),
          card({ title: 'Shot types', dense: true, body: dataTable([{ key: 'type', label: 'Type' }, { key: 'for', label: 'For', num: true }, { key: 'against', label: 'Against', num: true }], [...new Set([...S.types.for, ...S.types.against].map((x) => x[0]))].map((ty) => ({ type: ty === 'unknown' ? 'not recorded (mostly blocked)' : ty, for: (S.types.for.find((x) => x[0] === ty) || [0, 0])[1], against: (S.types.against.find((x) => x[0] === ty) || [0, 0])[1] })), { sortKey: 'for' }) })))) }];
    },
  }) };

  /* ---------------- Soccer ---------------- */
  TEAM_SPORTS.soccer = { label: 'Soccer', slug: 'soccer-man-city', spec: base({
    ties: true, wdl: true, closeMargin: 1, diffLabel: 'Goal difference', unit: 'Goals', unitShort: 'G', minGames: 6, seasonName: (s) => `${s}-${String(s + 1).slice(2)}`, standingSeason: 2026,
    standingCols: [{ key: 'gamesPlayed', label: 'P', num: true }, { key: 'wins', label: 'W', num: true }, { key: 'ties', label: 'D', num: true }, { key: 'losses', label: 'L', num: true }, { key: 'pointsFor', label: 'GF', num: true }, { key: 'pointsAgainst', label: 'GA', num: true }, { key: 'pointDifferential', label: 'GD', num: true }, { key: 'points', label: 'Pts', num: true }],
    standingOrder: (a, b) => (G.numOf(a.stats.rank) || 99) - (G.numOf(b.stats.rank) || 99),
    statsNode: (doc, season) => { const S = (doc.soccerTotals || {})[String(season)]; if (!S || !S.ranked.length) return card({ title: 'Team stats', body: h('div', { class: 'state' }, 'No team totals for this season') }); return card({ title: 'Per match, from player logs', scope: `${S.games} matches · rank of ${S.ranked[0].of}`, body: h('div', null, ...S.ranked.map((r) => rankRow({ label: r.label, display: fmt.n(r.value, r.name === 'redCards' ? 0 : 2), rank: r.rank, of: r.of, league: r.league, value: r.value, better: r.better }))), foot: `Possession, passing and xG are not held at team level · ${doc.status.xg}` }); },
    rosterNode: (doc, season) => rosterCard(doc, season, [
      { id: 'out', label: 'Outfield', filter: (p) => p.pos !== 'G', sort: 'g', cols: [{ key: 'st', label: 'Starts', fn: (p) => k(p, 'isStarter') }, { key: 'g', label: 'Goals', fn: (p) => k(p, 'totalGoals') }, { key: 'a', label: 'Assists', fn: (p) => k(p, 'goalAssists') }, { key: 'sh', label: 'Shots', fn: (p) => k(p, 'totalShots') }, { key: 'sot', label: 'On target', fn: (p) => k(p, 'shotsOnTarget') }, { key: 'conv', label: 'Conv%', dec: 1, fn: (p) => pct(k(p, 'totalGoals'), k(p, 'totalShots')) }, { key: 'fc', label: 'Fouls', fn: (p) => k(p, 'foulsCommitted') }, { key: 'fs', label: 'Fouled', fn: (p) => k(p, 'foulsSuffered') }, { key: 'yc', label: 'YC', fn: (p) => k(p, 'yellowCards') }, { key: 'rc', label: 'RC', fn: (p) => k(p, 'redCards') }] },
      { id: 'gk', label: 'Goalkeepers', filter: (p) => p.pos === 'G', sort: 'apps', cols: [{ key: 'apps', label: 'Apps', fn: (p) => k(p, 'appearances') }, { key: 'sv', label: 'Saves', fn: (p) => k(p, 'saves') }, { key: 'ga', label: 'Conceded', fn: (p) => k(p, 'goalsConceded') }, { key: 'svp', label: 'Save %', dec: 1, fn: (p) => pct(k(p, 'saves'), k(p, 'saves') + k(p, 'goalsConceded')) }] },
    ]),
  }) };

  /* Sports without a team concept get an explanation, not an empty page. */
  TEAM_SPORTS.tennis = { label: 'Tennis', none: 'Tennis has no teams. Player pages carry the research (surface splits, serve and return, ranking), and the game page carries head-to-head.' };
  TEAM_SPORTS.golf = { label: 'Golf', none: 'Golf has no teams. Player pages carry rounds, hole scoring and shot data; a tournament page would be the equivalent here and is out of scope for this pass.' };
})();
