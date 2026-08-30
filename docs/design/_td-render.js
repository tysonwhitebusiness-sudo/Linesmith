  // ==========================================================================
  // THE RENDERER - same argument as the player board, team side.
  // No `sport` check anywhere below.
  // ==========================================================================
  var ORDER = ['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer', 'golf'];

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

  /** Letter grade -> heat position. A=1, F=0. The chip row that replaces
   *  TeamGrades' nine hardcoded NFL fields: it renders a LIST, so it never
   *  knows what a linebacker is. */
  var GRADE_T = { 'A+': 1.00, 'A': 0.94, 'A\u2212': 0.86, 'B+': 0.76, 'B': 0.66,
                  'B\u2212': 0.58, 'C+': 0.48, 'C': 0.40, 'C\u2212': 0.32,
                  'D+': 0.24, 'D': 0.16, 'F': 0.05 };
  function gradeChips(hostId, grades) {
    var host = document.getElementById(hostId);
    if (!host) return;
    grades.forEach(function (g) {
      var t = GRADE_T[g.g] != null ? GRADE_T[g.g] : 0.5;
      var chip = el('div', 'gchip');
      chip.style.background = divFill(t);
      var lab = el('div', 'gchip-k', g.k);
      var val = el('div', 'gchip-v', g.g);
      var rk = el('div', 'gchip-r', g.r);
      [lab, rk].forEach(function (n) { n.style.color = 'rgba(255,255,255,.78)'; });
      val.style.color = '#fff';
      chip.appendChild(lab); chip.appendChild(val); chip.appendChild(rk);
      host.appendChild(chip);
    });
  }

  function renderTeam(s) {
    clear('td-grades', 'td-herostrip', 'td-windows', 'td-streak', 'td-dist', 'td-rating',
          'td-tape', 'td-grid', 'td-unitA', 'td-unitB', 'td-dumbbell', 'td-zone',
          'td-tendency', 'td-results', 'td-roster', 'td-standings', 'td-density',
          'td-oppunit', 'td-h2h', 'td-qual', 'td-cond', 'td-range', 'td-contrib', 'td-ctx');

    setText('td-initials', s.initials);
    setText('td-name', s.name);
    setText('td-meta', s.meta);
    setText('td-anchor-v', s.anchorV);
    setText('td-anchor-l', s.anchorL);
    var av = document.getElementById('td-anchor-v');
    if (av) av.style.color = heatInk(s.anchorHeat);

    gradeChips('td-grades', s.grades);

    var strip = document.getElementById('td-herostrip');
    if (strip) s.strip.forEach(function (p) {
      var c = el('div', 'hs-cell');
      c.appendChild(el('div', 'hs-k', p[0]));
      c.appendChild(el('div', 'hs-v', p[1]));
      strip.appendChild(c);
    });

    setText('td-form-t', s.formT);
    windowTiles('td-windows', s.windows);
    streakStrip('td-streak', s.streak.map(Boolean));

    setText('td-dist-t', s.distT);
    LB.distributionBars('td-dist', s.dist, s.distLine, { h: 128 });

    setText('td-rating-t', s.ratingT);
    setText('td-rating-m', s.ratingM);
    rollingChart('td-rating', {
      line: s.rating.line, mean: s.rating.mean, upper: s.rating.upper,
      lower: s.rating.lower, labels: s.rating.labels, h: 132,
      zeroBased: false, fmt: s.ratingFmt
    });

    setText('td-tape-m', s.tapeM);
    var tape = LB.seriesChart({ series: s.tape, h: 116, ticks: 3, openAt: s.tape[0], fmt: s.tapeFmt });
    document.getElementById('td-tape').appendChild(tape.svg);

    setText('td-splits-t', s.splitsT);
    LB.heatGrid('td-grid', { seq: true, cellH: 26, labelW: 108, rows: s.gridRows, cols: s.gridCols });

    setText('td-unitA-t', s.unitAT); setText('td-unitA-m', s.unitAM);
    statTable('td-unitA', s.unitA, { valueLabel: '2026' });
    setText('td-unitB-t', s.unitBT); setText('td-unitB-m', s.unitBM);
    statTable('td-unitB', s.unitB, { valueLabel: '2026' });

    setText('td-split-t', s.splitT); setText('td-split-m', s.splitM);
    splitDumbbell('td-dumbbell', s.dumbbell, { w: 300 });

    setText('td-zone-t', s.zoneT); setText('td-zone-m', s.zoneM);
    zoneGrid('td-zone', s.zone, {
      lo: s.zoneLo, hi: s.zoneHi, fmt: s.zoneFmt, unit: s.zoneUnit, caption: s.zoneCap
    });

    setText('td-tend-t', s.tendT); setText('td-tend-m', s.tendM);
    denseTable('td-tendency', s.tendCols, s.tendRows, { leadStrong: true });

    setText('td-log-m', s.logM);
    denseTable('td-results', s.logCols, s.logRows, { leadStrong: true });

    setText('td-roster-t', s.rosterT); setText('td-roster-m', s.rosterM);
    denseTable('td-roster', s.rosterCols, s.rosterRows, { leadStrong: true });

    setText('td-stand-t', s.standT); setText('td-stand-m', s.standM);
    denseTable('td-standings', s.standCols, s.standRows, { leadStrong: true });

    setText('td-dens-m', s.densM);
    LB.densityCurve('td-density', { w: 260, h: 110, pct: s.densPct, label: s.densLabel });

    setText('td-oppunit-t', s.oppUnitT);
    denseTable('td-oppunit', s.oppUnitCols, s.oppUnitRows);

    setText('td-h2h-t', s.h2hT);
    denseTable('td-h2h', s.h2hCols, s.h2hRows);

    setText('td-qual-t', s.qualT);
    LB.percentileRails('td-qual', s.qual);

    setText('td-cond-t', s.condT);
    railRows('td-cond', s.cond);

    setText('td-price-t', s.priceT);
    LB.rangeBar('td-range', { w: 260, rowH: 23, labelW: 62, books: s.books });

    setText('td-contrib-m', s.contribM);
    LB.contributionBars('td-contrib', { w: 258, rowH: 22, labelW: 104, rows: s.contrib });

    setText('td-ctx-t', s.ctxT);
    railRows('td-ctx', s.ctx);

    var n = s.grades.length * 2 + s.strip.length + s.windows.length * 2 + s.streak.length +
      s.dist.length + s.rating.mean.length + s.tape.length +
      s.gridRows.length * s.gridCols.length +
      s.unitA.length * 2 + s.unitB.length * 2 + s.dumbbell.length * 2 + s.zone.length * 2 +
      s.tendRows.length * (s.tendCols.length - 1) +
      s.logRows.length * (s.logCols.length - 2) +
      s.rosterRows.length * (s.rosterCols.length - 1) +
      s.standRows.length * (s.standCols.length - 1) +
      s.oppUnitRows.length * 2 + s.h2hRows.length * 2 + s.qual.length * 2 +
      s.cond.length + s.books.length + s.contrib.length + s.ctx.length;
    setText('td-count',
      s.tab + ': ' + n + ' individual numbers, across the same twenty blocks every other ' +
      'tab renders. Two of them - roster and standings - have no player-page equivalent.');
  }

  (function () {
    var host = document.getElementById('tsporttabs');
    if (!host) return;
    var btns = {};
    ORDER.forEach(function (key) {
      var b = el('button', 'sporttab', TEAMS[key].tab);
      b.setAttribute('type', 'button');
      b.addEventListener('click', function () {
        ORDER.forEach(function (k) { btns[k].className = 'sporttab'; });
        b.className = 'sporttab on';
        renderTeam(TEAMS[key]);
      });
      btns[key] = b;
      host.appendChild(b);
    });
    // Tennis has no team. Say so where the tab would have been, rather than
    // rendering a tab that apologises.
    var note = el('span', 'notab', 'Tennis \u2014 no team concept (team_id is null on all 271,964 rows)');
    host.appendChild(note);
    btns.mlb.className = 'sporttab on';
    renderTeam(TEAMS.mlb);
  })();

  // ---- the two explanatory tables ---------------------------------------
  function buildTable(id, head, body, heatCol, heatMax) {
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
        if (heatCol != null && i === heatCol && /^[\d,]+$/.test(c)) {
          var v = Number(c.replace(/,/g, ''));
          td.style.background = seqFill(Math.sqrt(v / heatMax));
          td.style.color = Math.sqrt(v / heatMax) > 0.55 ? '#fff' : 'inherit';
          td.style.fontVariantNumeric = 'tabular-nums';
        }
        row.appendChild(td);
      });
      t.appendChild(row);
    });
  }

  buildTable('tcov-table',
    ['Sport', 'Team adapter', 'Elo rows', 'Span', 'Teams', 'Game markets priced'],
    [
      ['MLB', 'yes', '78,550', '2010-2026', '30', 'moneyline, total, spread'],
      ['NHL', 'yes', '2,996', '2025-26', '32', 'none yet'],
      ['NBA', 'yes', '2,794', '2025-26', '37', 'none yet'],
      ['CFB', 'yes', '1,916', '2025-26', '236', 'moneyline only (344)'],
      ['Soccer', 'yes', '1,778', '2025-26', '55', 'moneyline, total, spread'],
      ['NFL', 'yes', '736', '2025-26', '34', 'moneyline only (72)'],
      ['Tennis', 'NO - no team concept', '0', '-', '0', 'moneyline (player, not team)'],
      ['Golf', 'NO - no team concept', '0', '-', '0', 'outrights (player, not team)']
    ], 2, 78550);

  buildTable('trole-table',
    ['Role', 'MLB', 'NFL / CFB', 'NBA', 'NHL', 'Soccer', 'Golf (tournament)'],
    [
      ['units', 'Hitting / Pitching', 'Offense / Defense', 'Offense / Defense', 'Offense / D & goaltending', 'Attack / Defence', 'Course / Field'],
      ['unitGrades', 'Hit, Pitch, Field, Pen', 'Off, Def, ST, Pass D', 'Off, Def, Reb, Bench', 'Off, Def, PP, PK', 'Att, Mid, Def, Set pc', 'Field, Course, Spread'],
      ['spatialGrid', 'Team zone profile', 'Down x distance', 'Shot chart allowed', 'Shots allowed by zone', 'Team shot map', 'Hole type x wind'],
      ['tendencies', 'How runs score', 'Play-calling', 'Shot diet allowed', 'Shot-type profile', 'Chance creation', 'Where strokes are won'],
      ['opponentUnit', 'Opposing staff', 'Opposing defence', 'Opposing offense', 'Opposing crease', 'Opposing defence', 'The field'],
      ['roster', 'By WAR', 'By snap grade', 'By minutes', 'By TOI', 'By minutes', 'Leaderboard'],
      ['standings', 'AL East', 'AFC North', 'West conference', 'Atlantic', 'Premier League', 'FedEx Cup']
    ]);
