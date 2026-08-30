  // ==========================================================================
  // THE RENDERER - third and last of the three. No `sport` check below.
  // ==========================================================================
  var ORDER = ['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer', 'tennis', 'golf'];

  function clear() {
    for (var i = 0; i < arguments.length; i++) {
      var n = document.getElementById(arguments[i]);
      if (n) n.innerHTML = '';
    }
  }
  function setText(id, s) { var n = document.getElementById(id); if (n) n.textContent = s; }
  function railRows(hostId, pairs) {
    var host = document.getElementById(hostId);
    if (!host) return;
    pairs.forEach(function (p) {
      var row = el('div', 'rail-stat');
      row.appendChild(el('span', 'k', p[0]));
      row.appendChild(el('span', 'v', p[1]));
      host.appendChild(row);
    });
  }

  function renderGame(s) {
    clear('gd-herostrip', 'gd-windows', 'gd-streak', 'gd-dist', 'gd-wp', 'gd-tape',
          'gd-grid', 'gd-unitA', 'gd-unitB', 'gd-dumbbell', 'gd-zone', 'gd-key',
          'gd-books', 'gd-lastfive', 'gd-injuries', 'gd-density',
          'gd-h2h', 'gd-rank', 'gd-cond', 'gd-range', 'gd-contrib', 'gd-ctx');

    setText('gd-away-badge', s.awayBadge);
    setText('gd-home-badge', s.homeBadge);
    setText('gd-away-name', s.awayName);
    setText('gd-away-rec', s.awayRec);
    setText('gd-home-name', s.homeName);
    setText('gd-home-rec', s.homeRec);
    setText('gd-status', s.status);
    setText('gd-score', s.score);
    setText('gd-when', s.when);

    var strip = document.getElementById('gd-herostrip');
    if (strip) s.strip.forEach(function (p) {
      var c = el('div', 'hs-cell');
      c.appendChild(el('div', 'hs-k', p[0]));
      c.appendChild(el('div', 'hs-v', p[1]));
      strip.appendChild(c);
    });

    setText('gd-form-t', s.formT);
    windowTiles('gd-windows', s.windows);
    streakStrip('gd-streak', s.streak.map(Boolean));

    setText('gd-dist-t', s.distT);
    LB.distributionBars('gd-dist', s.dist, s.distLine, { h: 128 });

    setText('gd-wp-t', s.wpT);
    setText('gd-wp-m', s.wpM);
    rollingChart('gd-wp', {
      line: s.wp.line, mean: s.wp.mean, upper: s.wp.upper, lower: s.wp.lower,
      labels: s.wp.labels, h: 132, zeroBased: false, fmt: s.wpFmt
    });

    setText('gd-tape-m', s.tapeM);
    var tape = LB.seriesChart({ series: s.tape, h: 116, ticks: 3, openAt: s.tape[0], fmt: s.tapeFmt });
    document.getElementById('gd-tape').appendChild(tape.svg);

    setText('gd-splits-t', s.splitsT);
    LB.heatGrid('gd-grid', { seq: true, cellH: 26, labelW: 108, rows: s.gridRows, cols: s.gridCols });

    setText('gd-unitA-t', s.unitAT); setText('gd-unitA-m', s.unitAM);
    statTable('gd-unitA', s.unitA, { valueLabel: '2026' });
    setText('gd-unitB-t', s.unitBT); setText('gd-unitB-m', s.unitBM);
    statTable('gd-unitB', s.unitB, { valueLabel: '2026' });

    setText('gd-cmp-t', s.cmpT); setText('gd-cmp-m', s.cmpM);
    splitDumbbell('gd-dumbbell', s.dumbbell, { w: 300 });

    setText('gd-zone-t', s.zoneT); setText('gd-zone-m', s.zoneM);
    zoneGrid('gd-zone', s.zone, {
      lo: s.zoneLo, hi: s.zoneHi, fmt: s.zoneFmt, unit: s.zoneUnit, caption: s.zoneCap
    });

    setText('gd-key-t', s.keyT); setText('gd-key-m', s.keyM);
    denseTable('gd-key', s.keyCols, s.keyRows, { leadStrong: true });

    setText('gd-book-m', s.bookM);
    denseTable('gd-books', s.bookCols, s.bookRows, { leadStrong: true });

    setText('gd-last-m', s.lastM);
    denseTable('gd-lastfive', s.lastCols, s.lastRows, { leadStrong: true });

    setText('gd-inj-t', s.injT); setText('gd-inj-m', s.injM);
    denseTable('gd-injuries', s.injCols, s.injRows, { leadStrong: true });

    setText('gd-sim-t', s.simT); setText('gd-sim-m', s.simM);
    LB.densityCurve('gd-density', { w: 260, h: 110, pct: s.simPct, label: s.simLabel });

    setText('gd-h2h-t', s.h2hT);
    denseTable('gd-h2h', s.h2hCols, s.h2hRows);

    setText('gd-rank-t', s.rankT);
    LB.percentileRails('gd-rank', s.rank);

    setText('gd-cond-t', s.condT);
    railRows('gd-cond', s.cond);

    setText('gd-price-t', s.priceT);
    LB.rangeBar('gd-range', { w: 260, rowH: 23, labelW: 62, books: s.books });

    setText('gd-contrib-m', s.contribM);
    LB.contributionBars('gd-contrib', { w: 258, rowH: 22, labelW: 104, rows: s.contrib });

    railRows('gd-ctx', s.ctx);

    var n = s.strip.length + s.windows.length * 2 + s.streak.length + s.dist.length +
      s.wp.mean.length + s.tape.length + s.gridRows.length * s.gridCols.length +
      s.unitA.length * 2 + s.unitB.length * 2 + s.dumbbell.length * 2 + s.zone.length * 2 +
      s.keyRows.length * (s.keyCols.length - 1) +
      s.bookRows.length * (s.bookCols.length - 1) +
      s.lastRows.length * (s.lastCols.length - 2) +
      s.injRows.length * (s.injCols.length - 2) +
      s.h2hRows.length * 2 + s.rank.length * 2 +
      s.cond.length + s.books.length + s.contrib.length + s.ctx.length;
    setText('gd-count',
      s.tab + ': ' + n + ' individual numbers, across the same nineteen blocks every other tab ' +
      'renders. Four of them - book grid, injuries, the deciding matchup and the officials - ' +
      'exist on neither the player nor the team page.');
  }

  (function () {
    var host = document.getElementById('gsporttabs');
    if (!host) return;
    var btns = {};
    ORDER.forEach(function (key) {
      var b = el('button', 'sporttab', GAMES[key].tab);
      b.setAttribute('type', 'button');
      b.addEventListener('click', function () {
        ORDER.forEach(function (k) { btns[k].className = 'sporttab'; });
        b.className = 'sporttab on';
        renderGame(GAMES[key]);
      });
      btns[key] = b;
      host.appendChild(b);
    });
    btns.mlb.className = 'sporttab on';
    renderGame(GAMES.mlb);
  })();

  // ---- the three explanatory tables --------------------------------------
  function buildTable(id, head, body, markCol) {
    var t = document.getElementById(id);
    if (!t) return;
    var tr = document.createElement('tr');
    head.forEach(function (h) { var th = document.createElement('th'); th.textContent = h; tr.appendChild(th); });
    t.appendChild(tr);
    body.forEach(function (r) {
      var row = document.createElement('tr');
      r.forEach(function (c, i) {
        var td = document.createElement('td');
        td.textContent = c;
        if (i === 0) { td.style.fontWeight = '600'; td.style.whiteSpace = 'nowrap'; }
        else td.style.color = 'var(--ink-3)';
        // A "no" / "none" / "0" cell is the finding, so let it read as one.
        if (markCol != null && i >= markCol && /^(no|none|0|not sourced)/i.test(c)) {
          td.style.color = compareInk(0.08);
          td.style.fontWeight = '600';
        }
        row.appendChild(td);
      });
      t.appendChild(row);
    });
  }

  buildTable('gcov-table',
    ['Sport', 'Player page', 'Team page', 'Game page', 'Why'],
    [
      ['MLB', 'yes', 'yes', 'yes', 'All three entities exist.'],
      ['NFL', 'yes', 'yes', 'yes', 'All three entities exist.'],
      ['CFB', 'yes', 'yes', 'yes', 'All three entities exist.'],
      ['NBA', 'yes', 'yes', 'yes', 'All three entities exist.'],
      ['NHL', 'yes', 'yes', 'yes', 'All three entities exist.'],
      ['Soccer', 'yes', 'yes', 'yes', 'All three entities exist.'],
      ['Tennis', 'yes', 'no team', 'yes', 'No team -- team_id null on all 271,964 rows. But a match IS a game.'],
      ['Golf', 'yes', 'no team', 'no adapter', 'No team and no gameDetailAdapter -- but liveMatchup already models a tee-time pairing.']
    ], 1);

  buildTable('gbook-table',
    ['Sport', 'Books', 'Markets', 'Games priced', 'What the grid can actually show'],
    [
      ['Soccer', '19-23', '3', '41-47', 'A real grid: home/draw/away, total, spread, 23 books.'],
      ['MLB', '21-22', '3', '32-33', 'A real grid: moneyline, run line, total, 22 books.'],
      ['CFB', '4', '1', '54', 'Moneyline only. Four columns is not a grid.'],
      ['Tennis', '3', '1', '88', 'Moneyline only, most games priced but least depth.'],
      ['NFL', '3', '1', '12', 'Moneyline only, 72 rows in the entire table.'],
      ['NBA', '0', '0', '0', 'No rows at all. The block ships empty.'],
      ['NHL', '0', '0', '0', 'No rows at all. The block ships empty.'],
      ['Golf', '0', '0', '0', 'Outrights and matchups live elsewhere, not in this table.']
    ], 1);

  buildTable('grole-table',
    ['Role', 'MLB', 'NFL / CFB', 'NBA', 'NHL', 'Soccer', 'Tennis', 'Golf'],
    [
      ['matchupKey', 'Starter vs lineup', 'Pass game vs secondary', 'Rim, and who protects it', 'Power play vs kill', 'Build-up vs the block', 'Serve vs return', 'Approach play'],
      ['spatialGrid', 'Lineup vs starter zone', 'Down x distance', 'Shot chart', 'Shot location', 'Shot map', 'Games won by set', 'Holes remaining'],
      ['units', 'Team hit / pitch', 'Offense / defense', 'Off / def rating', 'Off / def & goalie', 'Attack / defence', 'Serve / return', 'SG by category'],
      ['bookGrid', '22 books, 3 markets', '3-4 books, ML only', 'none', 'none', '23 books, 3 markets', '3 books, ML only', 'outrights elsewhere'],
      ['injuries', 'IL and day-to-day', 'Game status report', 'Injury report', 'Injury report', 'Team news', 'Fitness notes', 'Form & fitness']
    ]);
