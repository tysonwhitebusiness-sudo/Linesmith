  // ==========================================================================
  // THE RENDERER
  //
  // This is the whole argument in one function. There is no `sport` check
  // anywhere below: every block reads a named field off the data object, and
  // each sport's adapter decides what goes in that field. Swap the object,
  // get a different sport's page at identical depth.
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

  function renderSport(s) {
    clear('ps-herostrip', 'ps-windows', 'ps-streak', 'ps-dist', 'ps-rolling', 'ps-tape',
          'ps-grid', 'ps-season', 'ps-adv', 'ps-dumbbell', 'ps-zone', 'ps-usage',
          'ps-gamelog', 'ps-density', 'ps-oppunit', 'ps-h2h', 'ps-qual', 'ps-cond',
          'ps-range', 'ps-contrib', 'ps-ctx');

    // ---- identity -------------------------------------------------------
    setText('ps-initials', s.initials);
    setText('ps-name', s.name);
    setText('ps-meta', s.meta);
    setText('ps-anchor-v', s.anchorV);
    setText('ps-anchor-l', s.anchorL);
    var av = document.getElementById('ps-anchor-v');
    if (av) av.style.color = heatInk(s.anchorHeat);

    var strip = document.getElementById('ps-herostrip');
    if (strip) s.strip.forEach(function (p) {
      var c = el('div', 'hs-cell');
      c.appendChild(el('div', 'hs-k', p[0]));
      c.appendChild(el('div', 'hs-v', p[1]));
      strip.appendChild(c);
    });

    // ---- form -----------------------------------------------------------
    setText('ps-form-t', s.formT);
    windowTiles('ps-windows', s.windows);
    streakStrip('ps-streak', s.streak.map(Boolean));

    // ---- distribution / rolling / tape ----------------------------------
    setText('ps-dist-t', s.distT);
    LB.distributionBars('ps-dist', s.dist, s.distLine, { h: 128, unit: s.distUnit });

    setText('ps-roll-m', s.rollM);
    rollingChart('ps-rolling', {
      line: s.roll.line, mean: s.roll.mean, upper: s.roll.upper, lower: s.roll.lower,
      labels: s.roll.labels, h: 128
    });

    var tape = LB.seriesChart({
      series: s.tape, h: 116, ticks: 3, openAt: s.tape[0], fmt: s.tapeFmt
    });
    document.getElementById('ps-tape').appendChild(tape.svg);

    // ---- splits ---------------------------------------------------------
    setText('ps-splits-t', s.splitsT);
    LB.heatGrid('ps-grid', { seq: true, cellH: 26, labelW: 100, rows: s.gridRows, cols: s.gridCols });

    // ---- stat tables ----------------------------------------------------
    setText('ps-season-m', s.seasonM);
    statTable('ps-season', s.season, { valueLabel: '2026' });
    setText('ps-adv-t', s.advT);
    statTable('ps-adv', s.adv, { valueLabel: 'Value' });

    // ---- binary split + spatial grid ------------------------------------
    setText('ps-split-t', s.splitT);
    setText('ps-split-m', s.splitM);
    splitDumbbell('ps-dumbbell', s.dumbbell, { w: 300 });

    setText('ps-zone-t', s.zoneT);
    setText('ps-zone-m', s.zoneM);
    zoneGrid('ps-zone', s.zone, {
      lo: s.zoneLo, hi: s.zoneHi, fmt: s.zoneFmt, unit: s.zoneUnit, caption: s.zoneCap
    });

    // ---- usage mix + game log -------------------------------------------
    setText('ps-usage-t', s.usageT);
    setText('ps-usage-m', s.usageM);
    denseTable('ps-usage', s.usageCols, s.usageRows, { leadStrong: true });

    setText('ps-log-m', s.logM);
    denseTable('ps-gamelog', s.logCols, s.logRows, { leadStrong: true });

    // ---- rail -----------------------------------------------------------
    setText('ps-dens-m', s.densM);
    LB.densityCurve('ps-density', { w: 260, h: 110, pct: s.densPct, label: s.densLabel });

    setText('ps-oppunit-t', s.oppUnitT);
    denseTable('ps-oppunit', s.oppUnitCols, s.oppUnitRows);

    setText('ps-h2h-t', s.h2hT);
    denseTable('ps-h2h', s.h2hCols, s.h2hRows);

    setText('ps-qual-t', s.qualT);
    LB.percentileRails('ps-qual', s.qual);

    railRows('ps-cond', s.cond);
    LB.rangeBar('ps-range', { w: 260, rowH: 23, labelW: 62, books: s.books });

    setText('ps-contrib-m', s.contribM);
    LB.contributionBars('ps-contrib', { w: 258, rowH: 22, labelW: 104, rows: s.contrib });

    railRows('ps-ctx', s.ctx);

    // ---- the honest count -----------------------------------------------
    var n = s.strip.length + s.windows.length * 2 + s.streak.length +
      s.dist.length + s.roll.mean.length + s.tape.length +
      s.gridRows.length * s.gridCols.length +
      s.season.length * 2 + s.adv.length * 2 + s.dumbbell.length * 2 +
      s.zone.length * 2 + s.usageRows.length * (s.usageCols.length - 1) +
      s.logRows.length * (s.logCols.length - 2) +
      s.oppUnitRows.length * 2 + s.h2hRows.length * 2 + s.qual.length * 2 +
      s.cond.length + s.books.length + s.contrib.length + s.ctx.length;
    setText('ps-count',
      s.tab + ': ' + n + ' individual numbers on the page, across the same eighteen blocks ' +
      'every other tab renders. Nothing is hidden, nothing is padded.');
  }

  // ---- tabs -------------------------------------------------------------
  (function () {
    var host = document.getElementById('sporttabs');
    if (!host) return;
    var btns = {};
    ORDER.forEach(function (key) {
      var b = el('button', 'sporttab', SPORTS[key].tab);
      b.setAttribute('type', 'button');
      b.addEventListener('click', function () {
        ORDER.forEach(function (k) { btns[k].className = 'sporttab'; });
        b.className = 'sporttab on';
        renderSport(SPORTS[key]);
      });
      btns[key] = b;
      host.appendChild(b);
    });
    btns.mlb.className = 'sporttab on';
    renderSport(SPORTS.mlb);
  })();

  // ---- the two explanatory tables ---------------------------------------
  (function () {
    var t = document.getElementById('cov-table');
    if (!t) return;
    var head = ['Sport', 'Rows', 'Athletes', 'Stat keys', 'Depth this page reaches'];
    var body = [
      ['NFL', '226,629', '6,740', '57', 'Richest vocabulary measured. Route mix and target map are real data, not analogy.'],
      ['CFB', '273,649', '33,868', '53', 'Same ESPN shape as NFL, plus SP+ for the opponent block.'],
      ['MLB', '727,613', '4,003', '27', 'Most rows, mid-table vocabulary. Its extra depth comes from Statcast, a separate source.'],
      ['NHL', '674,003', '2,972', '21', 'Goalie, strength-state and shot-location blocks all fill cleanly.'],
      ['NBA', '279,661', '1,567', '17', 'ptsAllowedGuards/Forwards/Centers already exists - the opponent block is already built.'],
      ['Soccer', '302,539', '5,361', '16', 'EPL + MLS combined. Shot-location and keeper blocks fill; usage mix is thinner.'],
      ['Tennis', '271,964', '17,846', '8', 'The real constraint. Its page here is fed by match structure, not the game-log JSONB.'],
      ['Golf', 'separate schema', '-', '-', 'Not in this table at all. Own tables, own blocks, already partly built.']
    ];
    var tr = document.createElement('tr');
    head.forEach(function (h) { var th = document.createElement('th'); th.textContent = h; tr.appendChild(th); });
    t.appendChild(tr);
    body.forEach(function (r) {
      var row = document.createElement('tr');
      r.forEach(function (c, i) {
        var td = document.createElement('td');
        td.textContent = c;
        if (i === 0) td.style.fontWeight = '600';
        if (i === 3 && c !== '-') {
          td.style.background = seqFill(Number(c) / 57);
          td.style.color = Number(c) / 57 > 0.55 ? '#fff' : 'inherit';
          td.style.fontVariantNumeric = 'tabular-nums';
        }
        if (i === 4) td.style.color = 'var(--ink-3)';
        row.appendChild(td);
      });
      t.appendChild(row);
    });
  })();

  (function () {
    var t = document.getElementById('role-table');
    if (!t) return;
    var head = ['Role', 'MLB', 'NFL / CFB', 'NBA', 'NHL', 'Soccer', 'Tennis', 'Golf'];
    var body = [
      ['Opponent unit', 'Opposing starter', 'Defence vs position', 'Defence vs guards', 'Opposing goalie', 'Keeper & back line', 'Opponent profile', 'The field'],
      ['Usage mix', 'Pitch mix', 'Route mix', 'Shot-zone mix', 'Shot-type mix', 'Shot-type mix', 'Serve mix', 'Approach distance'],
      ['Spatial grid', 'Strike zone', 'Target map', 'Shot chart', 'Shot location', 'Shot location', 'Serve placement', 'Proximity by lie'],
      ['Binary split', 'vs LHP / RHP', 'man / zone', 'top / bottom D', 'PP / EV', 'home / away', 'hard / clay', 'par 5 / par 4'],
      ['Conditions', 'Park, wind', 'Roof, wind, surface', 'Rest, travel', 'Rest, opp starts', 'Pitch, weather', 'Surface, speed', 'Wind, greens'],
      ['Career H2H', 'vs this pitcher', 'vs this defence', 'vs this team', 'vs this goalie', 'vs this club', 'vs this opponent', 'at this course']
    ];
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
        row.appendChild(td);
      });
      t.appendChild(row);
    });
  })();
