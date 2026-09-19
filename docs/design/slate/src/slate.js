/* Slate Sheet mockup. One shared page, every sport drawn from the same
   renderers — the sport-adapter rule: no per-sport branch decides layout; the
   data says which sections exist. Spec: docs/design/slate-sheet-cards.md. */
(function () {
  'use strict';
  const DATA = window.__SLATE__ || {};
  const ORDER = ['mlb', 'nfl', 'cfb', 'epl', 'mls', 'nhl', 'nba', 'atp', 'wta', 'golf'];
  const PICTO = {
    mlb: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-5 4c2 1.5 2 8.5 0 10m10-10c-2 1.5-2 8.5 0 10',
    nfl: 'M4 20c0-9 7-16 16-16 0 9-7 16-16 16Zm4-4 8-8m-6 2 2 2m0-4 2 2',
    cfb: 'M4 20c0-9 7-16 16-16 0 9-7 16-16 16Zm4-4 8-8m-6 2 2 2m0-4 2 2',
    epl: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5 3.5 2.5-1.3 4h-4.4l-1.3-4Z',
    mls: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5 3.5 2.5-1.3 4h-4.4l-1.3-4Z',
    nhl: 'M5 4l6 12h7m-13 3h14',
    nba: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3v18M5.6 5.6c3.5 3 3.5 9.8 0 12.8m12.8-12.8c-3.5 3-3.5 9.8 0 12.8',
    atp: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM5.5 6c3 2.5 3 9.5 0 12m13-12c-3 2.5-3 9.5 0 12',
    wta: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM5.5 6c3 2.5 3 9.5 0 12m13-12c-3 2.5-3 9.5 0 12',
    golf: 'M9 20V4l8 3.5L9 11m-3 9h9',
  };
  const ICON = {
    chev: 'm9 6 6 6-6 6', down: 'm6 9 6 6 6-6', left: 'm15 6-6 6 6 6', right: 'm9 6 6 6-6 6',
    sort: 'M8 9l4-4 4 4M16 15l-4 4-4-4', up: 'M12 19V5m-6 6 6-6 6 6', dn: 'M12 5v14m6-6-6 6-6-6',
    help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.5-11.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.6-.8 1.1V14m0 3h.01',
    search: 'M21 21l-4.3-4.3M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z', check: 'M20 6 9 17l-5-5',
    alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
    cal: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9m-4.3 13a2 2 0 0 1-3.4 0',
    user: 'M20 21a8 8 0 1 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z', expand: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
    track: 'M12 5v14m-7-7h14', filter: 'M3 5h18l-7 8v6l-4 2v-8Z', trend: 'M3 17l6-6 4 4 8-8m0 0h-6m6 0v6',
  };
  const icon = (n, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON[n] || PICTO[n]}"/></svg>`;
  const SILHOUETTE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="5"/><path d="M3 23c0-5 4-8 9-8s9 3 9 8Z"/></svg>';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const odds = (a) => (a == null ? '—' : (a = Math.round(a)) > 0 ? `+${a}` : `${a}`);
  const pctOf = (hr) => (hr && hr[1] ? Math.round((100 * hr[0]) / hr[1]) : null);
  const f1 = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));
  const signed = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`);
  const lineTxt = (r) => (r.yesNo ? 'Yes' : r.line == null ? '—' : `O ${r.line}`);
  const MKT = {};
  const avatar = (url, lg) => `<span class="avatar${lg ? ' lg' : ''}">${url ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.replaceWith(document.createRange().createContextualFragment('${SILHOUETTE.replace(/"/g, '&quot;')}'))">` : SILHOUETTE}</span>`;
  const logo = (url, lg) => (url ? `<img class="logo${lg ? ' lg' : ''}" src="${esc(url)}" alt="" loading="lazy">` : `<span class="logo${lg ? ' lg' : ''}"></span>`);
  const avlabel = (face, name, sub) => `<span class="avlabel">${avatar(face)}<span class="txt"><span class="nm">${esc(name)}</span>${sub ? `<span class="sb">${esc(sub)}</span>` : ''}</span></span>`;
  const count = (n) => (n == null ? '' : `<span class="count">${Number(n).toLocaleString()}</span>`);
  const tipAttr = (t) => (t ? ` data-tip="${esc(t)}"` : '');
  const help = (label, t) => `<button class="help" type="button" aria-label="About ${esc(label)}" data-tip="${esc(t)}">${icon('help')}</button>`;
  const streakSq = (arr) => `<span class="streak" aria-hidden="true">${(arr || []).map((v) => `<i class="${v ? 'h' : ''}"></i>`).join('')}</span>`;
  const rankChip = (n) => (n == null ? '' : `<span class="rank ${n <= 3 ? 'top' : n <= 10 ? 'mid' : 'low'}">${n}</span>`);
  const mktLabel = (k) => MKT[k] || String(k).replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const fmtDate = (iso, opts) => new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', opts || { weekday: 'short', month: 'short', day: 'numeric' });
  const clockET = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

  // ------------------------------------------------------------------ state
  const st = {
    sport: (() => { try { return localStorage.getItem('slate.sport') || 'mlb'; } catch (e) { return 'mlb'; } })(),
    gameFilter: 'all', moversTab: 'props', market: null, page: 1, per: 25, q: '', game: '', minBooks: 0, minL10: 0,
    sort: {}, open: new Set(), spot: {}, special: 0, selectOpen: false,
  };
  if (!DATA[st.sport]) st.sport = 'mlb';

  // ------------------------------------------------------------------ generic table
  // cols: {key, label, num, info, sort:false, cell(row) -> html, val(row) -> sortable}
  function table(id, cols, rows, opt = {}) {
    const s = st.sort[id];
    let list = rows.slice();
    if (s) {
      const c = cols.find((x) => x.key === s.key);
      const v = c.val || ((r) => r[c.key]);
      list.sort((a, b) => {
        const x = v(a), y = v(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1; if (y == null) return -1; // blanks always sink
        return (x < y ? -1 : x > y ? 1 : 0) * (s.dir === 'desc' ? -1 : 1);
      });
    }
    const total = list.length;
    let pageRows = list;
    if (opt.paged) pageRows = list.slice((st.page - 1) * st.per, st.page * st.per);
    const head = cols.map((c) => {
      const sorted = s && s.key === c.key;
      const aria = sorted ? ` aria-sort="${s.dir === 'desc' ? 'descending' : 'ascending'}"` : '';
      const lab = c.sort === false ? esc(c.label)
        : `<button class="sortbtn" type="button" data-act="sort" data-t="${id}" data-k="${c.key}" data-num="${c.num ? 1 : 0}">${esc(c.label)}${icon(sorted ? (s.dir === 'desc' ? 'dn' : 'up') : 'sort', 'si')}</button>`;
      return `<th class="${c.num ? 'n' : ''}"${aria} scope="col">${lab}${c.info ? ' ' + help(c.label, c.info) : ''}</th>`;
    }).join('');
    const body = pageRows.map((r, i) => {
      const rid = `${id}:${r.id || r.sid || i}`;
      const open = opt.expand && st.open.has(rid);
      const tds = cols.map((c, j) => {
        let html = c.cell ? c.cell(r) : esc(r[c.key] == null ? '—' : r[c.key]);
        if (j === 0 && opt.expand) {
          html = `<span class="lblcell"><button class="xbtn" type="button" data-act="expand" data-r="${esc(rid)}" aria-expanded="${open}" aria-controls="p-${esc(rid)}" aria-label="Show detail">${icon('chev')}</button>${html}</span>`;
        }
        return `<td class="${c.num ? 'n' : ''}${j === 0 ? ' lbl' : ''}${c.wrap ? ' wrap' : ''}${c.cls ? ' ' + c.cls(r) : ''}"${c.style ? ` style="${c.style(r)}"` : ''}>${html}</td>`;
      }).join('');
      const panel = open ? `<tr class="panel" id="p-${esc(rid)}"><td colspan="${cols.length}">${opt.expand(r)}</td></tr>` : '';
      return `<tr class="${open ? 'expanded' : ''}${opt.hl && opt.hl(r) ? ' hl' : ''}">${tds}</tr>${panel}`;
    }).join('');
    const empty = !total ? `<tr><td colspan="${cols.length}" style="position:static">${emptyState(opt.empty || { title: 'Nothing here yet', body: '' })}</td></tr>` : '';
    let pager = '';
    if (opt.paged && total) {
      const pages = Math.max(1, Math.ceil(total / st.per));
      const a = (st.page - 1) * st.per + 1, b = Math.min(total, st.page * st.per);
      pager = `<div class="pager"><span class="range num">${a}–${b} of ${total.toLocaleString()} ${esc(opt.noun || 'rows')}</span><span class="grow"></span>
        <label class="rows" for="per">Rows <select id="per" data-act="per">${[10, 25, 50].map((n) => `<option ${n === st.per ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <button class="btn btn-secondary btn-sm" type="button" data-act="page" data-d="-1" ${st.page <= 1 ? 'disabled' : ''}>${icon('left')} Prev</button>
        <button class="btn btn-secondary btn-sm" type="button" data-act="page" data-d="1" ${st.page >= pages ? 'disabled' : ''}>Next ${icon('right')}</button></div>`;
    }
    return `<div class="dt-wrap"><table class="dt${opt.compact ? ' compact' : ''}"><thead><tr>${head}</tr></thead><tbody>${body}${empty}</tbody></table></div>${pager}`;
  }

  function emptyState(e) {
    return `<div class="empty"><span class="ficon${e.warn ? ' warn' : ''}">${icon(e.icon || 'list')}</span><div class="t-card-title">${esc(e.title)}</div>${e.body ? `<p>${e.body}</p>` : ''}${e.action ? `<button class="btn btn-secondary btn-sm" type="button" ${e.actAttr || ''}>${esc(e.action)}</button>` : ''}</div>`;
  }

  function card({ title, n, scope, controls = '', body, sub, caption, flush, id, extra = '' }) {
    return `<section class="card"${id ? ` id="${id}"` : ''}>
      <div class="card-head"><span class="t-card-title">${esc(title)}${n != null ? count(n) : ''}</span>${scope ? `<span class="scope">${esc(scope)}</span>` : '<span class="scope"></span>'}${controls ? `<span class="controls">${controls}</span>` : ''}
      <button class="btn btn-tertiary icon-btn card-h" type="button" aria-label="Expand ${esc(title)}"${tipAttr('Open full screen')}>${icon('expand')}</button></div>
      ${sub ? `<div class="card-sub">${sub}</div>` : ''}${extra}
      ${flush ? body : `<div class="card-body">${body}</div>`}
      ${caption ? `<div class="card-caption">${caption}</div>` : ''}</section>`;
  }

  // ------------------------------------------------------------------ app chrome (TopBar + strip), copied from the app
  // TopBar.tsx: mark + wordmark + sport select (+ league / tour select), nav, utilities.
  // The one change: the nav's "Scan" tab is now "Slate". Nothing else in the chrome changes.
  const APP_SPORTS = [['golf', 'Golf'], ['mlb', 'MLB'], ['nfl', 'NFL'], ['soccer', 'Soccer'], ['cfb', 'CFB'], ['nba', 'NBA'], ['nhl', 'NHL'], ['tennis', 'Tennis']];
  const appSport = (k) => (k === 'epl' || k === 'mls' ? 'soccer' : k === 'atp' || k === 'wta' ? 'tennis' : k);
  const TB = {
    diag: '<path d="M8 1.5v3M8 11.5v3M2.6 4.6l2.1 2.1M11.3 9.3l2.1 2.1M1.5 8h3M11.5 8h3M2.6 11.4l2.1-2.1M11.3 6.7l2.1-2.1" stroke-linecap="round"/><circle cx="8" cy="8" r="2.2"/>',
    bets: '<path d="M2 5.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 14 5.5v1a1 1 0 0 0 0 2v1a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 9.5v-1a1 1 0 0 0 0-2v-1Z" stroke-linejoin="round"/><path d="M6 4v8" stroke-dasharray="1.6 1.6" stroke-linecap="round"/>',
    search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14" stroke-linecap="round"/>',
    refresh: '<path d="M13.5 8a5.5 5.5 0 1 1-1.7-4" stroke-linecap="round"/><path d="M13 1.5V4h-2.5" stroke-linecap="round" stroke-linejoin="round"/>',
    cal: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke-linecap="round"/>',
    left: '<path d="M10 3.5 5.5 8l4.5 4.5" stroke-linecap="round" stroke-linejoin="round"/>',
    pause: '<path d="M5.5 3.5v9M10.5 3.5v9" stroke-linecap="round"/>',
  };
  const tbIcon = (n, size = 15) => `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${TB[n]}</svg>`;

  function topBar(d) {
    const as = appSport(st.sport);
    const opts = APP_SPORTS.map(([k, l]) => `<option value="${k}" ${k === as ? 'selected' : ''}>${l}</option>`).join('');
    const league = as === 'soccer' ? `<label class="sr-only" for="lb-league">League</label><select id="lb-league" class="tb-sel" data-act="tbleague"><option value="epl" ${st.sport === 'epl' ? 'selected' : ''}>Premier League</option><option value="mls" ${st.sport === 'mls' ? 'selected' : ''}>MLS</option></select>`
      : as === 'tennis' ? `<label class="sr-only" for="lb-tour">Tour</label><select id="lb-tour" class="tb-sel" data-act="tbtour"><option value="atp" ${st.sport === 'atp' ? 'selected' : ''}>ATP (Men's)</option><option value="wta" ${st.sport === 'wta' ? 'selected' : ''}>WTA (Women's)</option></select>` : '';
    const third = as === 'golf' || as === 'tennis' ? 'Schedule' : 'Teams';
    const tabs = ['Slate', 'Players', third].map((t, i) => `<button type="button" class="tb-tab" ${i === 0 ? 'aria-current="page"' : ''}${i ? tipAttr(`Opens ${t}`) : ''}>${t}</button>`).join('');
    const upd = new Date(d.builtAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `<div class="tb">
      <div class="tb-left"><img class="tb-mark" src="${window.__MARK__ || ''}" alt="" width="28" height="18"><span class="tb-word">Linesmith</span>
        <label class="sr-only" for="lb-sport">Sport</label><select id="lb-sport" class="tb-sel" data-act="tbsport">${opts}</select>${league}</div>
      <nav class="tb-nav" aria-label="Sections">${tabs}</nav>
      <div class="tb-right">
        <button type="button" class="tb-ic hide-sm" aria-label="Diagnostics">${tbIcon('diag')}</button>
        <button type="button" class="tb-ic" aria-label="Live Bets">${tbIcon('bets')}</button>
        <button type="button" class="tb-ic" aria-label="Search players">${tbIcon('search')}</button>
        <button type="button" class="tb-ic tb-refresh hide-sm" aria-label="Refresh data">${tbIcon('refresh', 13)}<span class="num">${upd}</span></button>
        <button type="button" class="tb-slip">Slip<span class="num">0</span></button>
        <button type="button" class="tb-signin">Sign in</button>
      </div></div>`;
  }

  // DateGameStrip.tsx (team sports), GolferStrip.tsx, TennisMatchStrip.tsx — unchanged.
  function strip(d) {
    const as = appSport(st.sport);
    const pause = `<button type="button" class="strip-play" aria-label="Pause game strip auto-scroll">${tbIcon('pause', 11)}</button>`;
    if (as === 'golf') {
      const rows = d.leaderboard.slice().sort((a, b) => (a.total ?? 99) - (b.total ?? 99)).slice(0, 30);
      const tp = (v) => (v == null ? '—' : v === 0 ? 'E' : v > 0 ? `+${v}` : `${v}`);
      return `<div class="strip"><div class="strip-scroll"><button type="button" class="strip-all" aria-pressed="true">All</button>${rows.map((r) => `<button type="button" class="strip-golfer"><span class="sg-top">${avatar(r.face)}<span class="sg-nm">${esc(r.name)}</span></span><span class="sg-bot"><span class="sg-pos">${esc(r.pos || '—')}</span><span class="sg-sc num">${tp(r.total)}</span><span class="sg-th">${r.thru ? esc(r.thru) : r.tee ? clockET(r.tee) : ''}</span></span></button>`).join('')}</div>${pause}</div>`;
    }
    if (as === 'tennis') {
      const g = d.games || [];
      if (!g.length) return `<div class="strip strip-empty">No matches scheduled today</div>`;
      return `<div class="strip"><div class="strip-scroll">${g.map((m) => `<button type="button" class="strip-match"><span class="sm-top"><span class="t-overline muted" style="font-size:9px">${esc(m.round || m.time + ' ET')}</span></span><span class="sm-nm">${esc(m.home.name)}</span><span class="sm-nm">${esc(m.away.name)}</span></button>`).join('')}</div></div>`;
    }
    const games = d.games || [];
    const chips = games.length ? games.map((g) => {
      const when = g.status === 'live' ? `<span class="live"><i></i>${esc(g.away.score)}–${esc(g.home.score)} <span style="opacity:.7;font-weight:400">${esc(g.statusText)}</span></span>`
        : g.status === 'final' ? `<span>${g.away.score != null ? `${esc(g.away.score)}–${esc(g.home.score)} ` : ''}Final</span>` : `<span>${esc(g.time)}</span>`;
      return `<button type="button" class="strip-game"${tipAttr('Opens the game page')}><span class="sg-teams">${g.away.logo ? `<img src="${esc(g.away.logo)}" alt="" class="tm">` : ''}<span>${esc(g.away.abbr)}</span><span class="at">@</span><span>${esc(g.home.abbr)}</span>${g.home.logo ? `<img src="${esc(g.home.logo)}" alt="" class="tm">` : ''}</span><span class="sg-when">${when}</span></button>`;
    }).join('') : '<span class="strip-none">No games scheduled</span>';
    return `<div class="strip"><button type="button" class="strip-btn on" aria-pressed="true">Today</button><button type="button" class="strip-btn" aria-pressed="false">Tomorrow</button>
      <span class="strip-ic" aria-label="Pick a date">${tbIcon('cal', 16)}</span><button type="button" class="strip-ic" aria-label="Hide date controls">${tbIcon('left', 14)}</button>
      <div class="strip-scroll"><button type="button" class="strip-all" aria-pressed="true">All</button>${chips}</div>${pause}</div>`;
  }

  function sectionsFor(d) {
    if (d.offseason) return [];
    const s = [];
    if (st.sport === 'golf') s.push(['games', 'Leaderboard', d.leaderboard.length]);
    else s.push(['games', 'Games', (d.games || []).length]);
    if (st.sport !== 'golf') s.push(['movers', 'Movers', null]);
    if (st.sport !== 'golf') s.push(['props', 'Props', d.board?.total || 0]);
    s.push(['spotlights', 'Spotlights', (d.spotlights || []).length]);
    if ((d.specials || []).length) s.push(['specials', 'Specials', d.specials.length]);
    if (d.model) s.push(['model', 'Model', null]);
    s.push(['yours', 'Your lines', 0]);
    return s;
  }

  // ------------------------------------------------------------------ games
  function lineCell(h, v, disp) {
    if (!v) return `<div class="gc-line"><span class="h">${h}</span><span class="v muted">—</span><span class="b">no line</span></div>`;
    const mv = v.movePts;
    const mvHtml = mv != null && Math.abs(mv) >= 0.5 ? `<span class="mv ${mv > 0 ? 'neg' : 'pos'}"${tipAttr(`Implied probability ${mv > 0 ? 'up' : 'down'} ${Math.abs(mv).toFixed(1)} points since we first saw it (median across books). Movement is market information, not a prediction.`)}>${mv > 0 ? '▲' : '▼'} ${Math.abs(mv).toFixed(1)}</span>` : '';
    const best = v.bestBook ? `best ${odds(v.bestPrice)} ${esc(v.bestBook)}` : v.source === 'archive' ? 'archive price' : '';
    return `<div class="gc-line"><span class="h">${h}</span><span class="v">${disp}</span><span class="b">${best}</span><span class="b">${v.books} book${v.books === 1 ? '' : 's'} ${mvHtml}</span></div>`;
  }

  function gameCard(g, d) {
    const L = g.lines || {};
    const soccer = st.sport === 'epl' || st.sport === 'mls';
    const tennis = d.unit === 'matches' && !soccer;
    const status = g.status === 'live' ? `<span class="chip live"><span class="dot"></span>Live · ${esc(g.statusText)}</span>`
      : g.status === 'final' ? `<span class="chip final"><span class="dot"></span>${esc(g.statusText || 'Final')}</span>`
      : `<span class="chip upcoming"><span class="dot"></span>${esc(g.time)} ET</span>`;
    const team = (t, side) => {
      const inj = t.injuries != null ? t.injuries : null;
      return `<div class="gc-team">${t.logo ? logo(t.logo, true) : avatar(null)}<span class="nm">${t.rank ? `<span class="rk">${t.rank}</span>` : ''}${esc(t.short || t.name)}${t.record ? `<span class="rec">${esc(t.record)}</span>` : ''}</span><span class="score">${t.score != null && g.status !== 'upcoming' ? esc(t.score) : ''}</span>
        ${t.starter ? `<span class="starter">${esc(t.starter)}${t.starterLine ? ` · ${esc(t.starterLine)}` : ''}</span>` : ''}</div>`;
    };
    let lines = '';
    const has = Object.keys(L).length;
    if (!has) lines = `<div class="gc-nolines">No lines yet${g.status === 'final' ? ' — the game is over' : ''}.</div>`;
    else if (tennis) {
      const a = L.moneyline?.away, h = L.moneyline?.home;
      lines = `<div class="gc-lines" style="grid-template-columns:repeat(2,minmax(0,1fr))">${lineCell(esc(g.away.abbr), a, odds(a?.price))}${lineCell(esc(g.home.abbr), h, odds(h?.price))}</div>`;
    } else if (soccer) {
      const m = L.moneyline || {}, t = L.total?.over;
      lines = `<div class="gc-lines four">${lineCell('Home', m.home, odds(m.home?.price))}${m.draw ? lineCell('Draw', m.draw, odds(m.draw.price)) : `<div class="gc-line"><span class="h">Draw</span><span class="v muted">—</span><span class="b"${tipAttr('The live per-book feed carries no draw price; the archive has one only where the harvester scraped it.')}>not in the live feed</span></div>`}${lineCell('Away', m.away, odds(m.away?.price))}${lineCell('Total', t, t ? `${t.point} · ${odds(t.price)}` : '—')}</div>`;
    } else {
      const sp = L.spread?.home, t = L.total?.over, mh = L.moneyline?.home, ma = L.moneyline?.away;
      lines = `<div class="gc-lines">${lineCell('Spread', sp, sp ? `${esc(g.home.abbr)} ${sp.point > 0 ? '+' : ''}${sp.point}` : '—')}${lineCell('Total', t, t ? `O/U ${t.point}` : '—')}${lineCell('Moneyline', mh, mh ? `${esc(g.home.abbr)} ${odds(mh.price)}` : '—')}</div>`;
    }
    const model = g.model ? `<div class="gc-model"${tipAttr('The MLB game model: win probability and expected runs. Not compared with the price.')}><span class="chip sm ink">Model</span><b>${g.model.home >= g.model.away ? `${esc(g.home.abbr)} ${Math.round(100 * g.model.home)}%` : `${esc(g.away.abbr)} ${Math.round(100 * g.model.away)}%`}</b> · ${f1(g.model.awayRuns)}–${f1(g.model.homeRuns)} runs</div>` : '';
    const chips = [...(g.chips || []).map((c) => `<span class="chip"${tipAttr(c.tip)}>${esc(c.text)}</span>`)];
    const inj = (g.away.injuries || 0) + (g.home.injuries || 0);
    if (g.away.injuries != null) chips.push(`<span class="chip"${tipAttr(`${g.away.abbr} ${g.away.injuries} · ${g.home.abbr} ${g.home.injuries} on today's injury report`)}>${inj} injuries</span>`);
    return `<article class="card gc">
      <div class="gc-top">${status}<span class="t-label muted">${esc(g.venue || g.tournament || '')}</span></div>
      <div class="gc-teams">${team(g.away)}${team(g.home)}</div>
      ${lines}${model}
      ${chips.length ? `<div class="gc-chips">${chips.join('')}</div>` : ''}
      <div class="gc-foot"><a class="btn btn-link" href="#games" data-tip="Opens the game page">Game page →</a>${st.sport !== 'golf' ? `<button class="btn btn-link" type="button" data-act="gameprops" data-g="${esc(g.id)}">${g.props || 0} props →</button>` : ''}</div>
    </article>`;
  }

  function gamesSection(d) {
    if (st.sport === 'golf') return golfBoard(d);
    const g = d.games || [];
    const n = { all: g.length, upcoming: 0, live: 0, final: 0 };
    g.forEach((x) => n[x.status]++);
    const list = st.gameFilter === 'all' ? g : g.filter((x) => x.status === st.gameFilter);
    const seg = `<span class="seg" role="group" aria-label="Game status">${['all', 'upcoming', 'live', 'final'].map((k) => `<button type="button" data-act="gf" data-v="${k}" aria-pressed="${st.gameFilter === k}">${k[0].toUpperCase() + k.slice(1)} ${count(n[k])}</button>`).join('')}</span>`;
    const body = list.length ? `<div class="games-grid">${list.map((x) => gameCard(x, d)).join('')}</div>`
      : `<div class="card">${emptyState(g.length ? { title: `No ${st.gameFilter} ${d.unit}`, body: 'Try another status.' } : { icon: 'cal', title: `No ${d.label} ${d.unit} on ${fmtDate(d.date)}`, body: d.nextDate ? `The next ${d.unit} are on ${fmtDate(d.nextDate, { weekday: 'long', month: 'long', day: 'numeric' })}.` : '', action: d.nextDate ? `Go to ${fmtDate(d.nextDate)}` : null })}</div>`;
    return `<section class="section" id="games"><div class="section-head"><h2 class="t-heading">Games</h2>${seg}</div>${body}</section>`;
  }

  function golfBoard(d) {
    const rows = d.leaderboard.slice().sort((a, b) => (a.total ?? 99) - (b.total ?? 99));
    const toPar = (v) => (v == null ? '—' : v === 0 ? 'E' : v > 0 ? `+${v}` : `${v}`);
    const cols = [
      { key: 'pos', label: 'Pos', cell: (r) => esc(r.pos || '—'), val: (r) => r.total },
      { key: 'name', label: 'Player', cell: (r) => avlabel(r.face, r.name, null), val: (r) => r.name },
      { key: 'total', label: 'To par', num: true, cell: (r) => `<b>${toPar(r.total)}</b>` },
      ...[1, 2, 3, 4].map((n) => ({ key: 'r' + n, label: 'R' + n, num: true, cell: (r) => (r.rounds[n] ? esc(r.rounds[n].strokes) : '—'), val: (r) => r.rounds[n]?.strokes })),
      { key: 'thru', label: 'Thru', num: true, cell: (r) => esc(r.thru ?? (r.tee ? clockET(r.tee) : '—')) },
    ];
    const lines = (d.lines?.lines || []).slice().sort((a, b) => b.impliedProb - a.impliedProb).slice(0, 12);
    const lcols = [
      { key: 'golferName', label: 'Player', cell: (r) => esc(r.golferName) },
      { key: 'best', label: 'Best price', num: true, cell: (r) => `${odds(r.bestPrice.americanOdds)} <span class="muted">${esc(bookTitle(r.bestPrice.bookmaker))}</span>`, val: (r) => r.impliedProb },
      { key: 'impliedProb', label: 'IP', num: true, info: 'Implied probability from the best price, vig included. Not a model number.', cell: (r) => `${(100 * r.impliedProb).toFixed(1)}%` },
      { key: 'books', label: 'Books', num: true, cell: (r) => r.prices.length, val: (r) => r.prices.length },
    ];
    return `<section class="section" id="games"><div class="section-head"><h2 class="t-heading">Leaderboard</h2><p>${esc(d.event.name)} · ${esc(d.event.detail)}</p></div>
      <div class="grid-2" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
      ${card({ title: 'Leaderboard', n: rows.length, scope: 'Round 3 in progress', flush: true, body: table('golf', cols, rows.map((r) => ({ ...r, id: r.sid })), { compact: true, paged: false }).replace('<div class="dt-wrap">', '<div class="dt-wrap" style="max-height:560px">'),
        caption: Object.keys(d.weather || {}).length ? 'Round weather is stored per round.' : 'No weather is stored for this event yet (golf_round_scores has none for these rounds).' })}
      ${card({ title: 'Winner prices', n: (d.lines?.lines || []).length, scope: 'SharpAPI', flush: true, body: table('golflines', lcols, lines.map((r) => ({ ...r, id: r.espnId }))), caption: 'Prices are cached, not stored as history, so golf has no Movers section.' })}
      </div></section>`;
  }
  const bookTitle = (b) => ({ fanduel: 'FanDuel', draftkings: 'DraftKings', betmgm: 'BetMGM', caesars: 'Caesars', bet365: 'bet365', betrivers: 'BetRivers', espnbet: 'ESPN BET' }[b] || b);

  // ------------------------------------------------------------------ movers
  function spark(vals) {
    if (!vals || vals.length < 2) return '<span class="muted">—</span>';
    const lo = Math.min(...vals), hi = Math.max(...vals), w = 72, h = 20, p = 2;
    const pts = vals.map((v, i) => `${(p + (i * (w - 2 * p)) / (vals.length - 1)).toFixed(1)},${(h - p - ((v - lo) / (hi - lo || 1)) * (h - 2 * p)).toFixed(1)}`);
    const last = pts[pts.length - 1].split(',');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Implied probability from ${vals[0]}% to ${vals[vals.length - 1]}%"><polyline fill="none" stroke="oklch(47% 0.005 260)" stroke-width="1.4" points="${pts.join(' ')}"/><circle cx="${last[0]}" cy="${last[1]}" r="2" fill="oklch(18% 0.005 260)"/></svg>`;
  }

  function moversSection(d) {
    const props = d.movers?.props || [], games = d.movers?.games || [];
    const maxP = Math.max(1, ...props.map((m) => Math.abs(m.move)));
    const maxG = Math.max(1, ...games.map((m) => Math.abs(m.move)));
    const pcols = [
      { key: 'name', label: 'Player', cell: (r) => `<span class="lblcell">${avlabel(r.face, r.name, r.team || '')}${r.steam ? `<span class="chip sm warn"${tipAttr('Steam: three or more books moved the same way.')}>Steam</span>` : ''}</span>`, val: (r) => r.name },
      { key: 'market', label: 'Market', cell: (r) => esc(mktLabel(r.market)) },
      { key: 'line', label: 'Line', num: true, cell: (r) => (r.line == null ? 'Yes' : `O ${r.line}`) },
      { key: 'now', label: 'Price', num: true, info: 'Median across books: the first price we saw, then now.', cell: (r) => `<span class="muted">${odds(r.first)} →</span> ${odds(r.now)}` },
      { key: 'move', label: 'Move', num: true, info: 'Change in implied probability, in points, since we first saw this line. The sort key.', cls: () => 'bar', style: (r) => `--w:${Math.round((100 * Math.abs(r.move)) / maxP)}%`, cell: (r) => `<span class="${r.move > 0 ? 'neg' : 'pos'}">${signed(r.move)}</span>`, val: (r) => Math.abs(r.move) },
      { key: 'moved', label: 'Books', num: true, info: 'Books that moved / books quoting.', cell: (r) => `${r.moved}/${r.books}` },
      { key: 'firstAt', label: 'First seen', num: true, cell: (r) => clockET(r.firstAt) },
      { key: 'spark', label: 'Trend', sort: false, cell: (r) => spark(r.spark) },
    ];
    const gcols = [
      { key: 'game', label: 'Game', cell: (r) => `<span class="avlabel">${logo(r.logoA)}${logo(r.logoH)}<span class="nm">${esc(r.game)}</span></span>` },
      { key: 'market', label: 'Market' },
      { key: 'side', label: 'Side' },
      { key: 'point', label: 'Line', num: true, cell: (r) => (r.point == null ? '—' : `${r.point}${r.pointMove ? ` <span class="muted">(${signed(r.pointMove)})</span>` : ''}`) },
      { key: 'price', label: 'Price now', num: true, cell: (r) => odds(r.price) },
      { key: 'move', label: 'Move', num: true, info: 'Change in implied probability, in points, since we first saw it (median across books).', cls: () => 'bar', style: (r) => `--w:${Math.round((100 * Math.abs(r.move)) / maxG)}%`, cell: (r) => `<span class="${r.move > 0 ? 'neg' : 'pos'}">${signed(r.move)}</span>`, val: (r) => Math.abs(r.move) },
      { key: 'books', label: 'Books', num: true },
    ];
    if (!st.sort.movp) st.sort.movp = { key: 'move', dir: 'desc' };
    if (!st.sort.movg) st.sort.movg = { key: 'move', dir: 'desc' };
    const tabs = `<span class="tabs" role="tablist">${[['games', 'Game lines', games.length], ['props', 'Props', props.length]].map(([k, l, n]) => `<button class="tab" role="tab" type="button" data-act="mt" data-v="${k}" aria-selected="${st.moversTab === k}">${l} ${count(n)}</button>`).join('')}</span>`;
    const win = `<span class="seg" role="group" aria-label="Window"><button type="button" aria-pressed="true">Since first seen</button><button type="button" aria-pressed="false" data-tip="Same data, a narrower window; the mockup holds one.">3h</button><button type="button" aria-pressed="false" data-tip="Same data, a narrower window; the mockup holds one.">1h</button></span>`;
    const body = st.moversTab === 'props'
      ? table('movp', pcols, props.map((r) => ({ ...r, id: r.sid + r.market })), { empty: { icon: 'trend', title: 'No prop has moved yet', body: 'A line shows here once three or more books have quoted it and at least one has moved by a point.' } })
      : table('movg', gcols, games.map((r, i) => ({ ...r, id: 'g' + i })), { empty: { icon: 'trend', title: 'No game line has moved', body: 'Moves are measured from the first price we saw for each book.' } });
    return `<section class="section" id="movers"><div class="section-head"><h2 class="t-heading">Movers</h2><p>Biggest moves since we first saw each line.</p></div>
      ${card({ title: 'Line movement', controls: tabs + win, flush: true, body, caption: 'Movement is market information, not a prediction. "First seen" is our first observation of that book, not the book’s opening line (the opener is not held).' })}</section>`;
  }

  // ------------------------------------------------------------------ props board
  function propsSection(d) {
    const b = d.board || { rows: [], markets: [] };
    if (!b.markets.length) {
      return `<section class="section" id="props"><div class="section-head"><h2 class="t-heading">Props</h2></div>${card({ title: 'Props board', n: 0, body: emptyState({ icon: 'list', title: `No ${d.label} props yet`, body: st.sport === 'nhl' ? 'Books have not posted NHL player props for preseason games. They usually appear for the regular season, which starts in October.' : 'Player props usually post the day before a game.' }) })}</section>`;
    }
    // Scan's table, kept (operator 2026-09-19): every market in one ranked list,
    // Scan's own filter pills, heat on the hit-rate columns, + to the slip.
    if (!st.market) st.market = 'all';
    const all = b.rows;
    // global rank like Scan: delta (model prob - league baseline) desc, then projection
    const ranked = all.slice().sort((x, y) => (x.delta == null) - (y.delta == null) || (y.delta || 0) - (x.delta || 0) || (y.proj || 0) - (x.proj || 0) || (pctOf(y.l10) || 0) - (pctOf(x.l10) || 0));
    ranked.forEach((r, i) => { r.grank = i + 1; });
    const anyModel = all.some((r) => r.model != null), anyProj = all.some((r) => r.proj != null), anyDvp = all.some((r) => r.dvp != null);
    let rows = st.market === 'all' ? ranked : ranked.filter((r) => r.market === st.market);
    if (st.q) rows = rows.filter((r) => r.name.toLowerCase().includes(st.q.toLowerCase()));
    if (st.game) rows = rows.filter((r) => r.gameId === st.game);
    if (st.team) rows = rows.filter((r) => r.team === st.team);
    if (st.minL10) rows = rows.filter((r) => (pctOf(r.l10) || 0) >= st.minL10);
    if (st.streakF === 'over') rows = rows.filter((r) => r.strk && r.strk[0] === 'O' && Number(r.strk.slice(1)) >= 3);
    if (st.oddsF === 'plus') rows = rows.filter((r) => r.over > 0);
    if (st.oddsF === 'fav') rows = rows.filter((r) => r.over < 0);
    const mktModel = rows.some((r) => r.model != null), mktProj = rows.some((r) => r.proj != null);
    // heat (lib/ui/heat.ts): fill alpha 0.34*|2t-1| so the midpoint stays clear; heat ink past 0.45
    const FILL = [[0xc2, 0x3b, 0x2c], [0xc9, 0x8a, 0x1f], [0x0f, 0x7a, 0x4f]], INK = [[0x8f, 0x2b, 0x20], [0x8f, 0x62, 0x15], [0x0b, 0x5c, 0x3c]];
    const ramp = (S, t) => { const x = Math.min(1, Math.max(0, t)); const [a0, b0, u] = x <= 0.5 ? [S[0], S[1], x / 0.5] : [S[1], S[2], (x - 0.5) / 0.5]; return a0.map((v, i) => Math.round(v + (b0[i] - v) * u)); };
    const heat = (t) => { const k = Math.abs(2 * t - 1); const f = ramp(FILL, t); const ink = k > 0.45 ? `color:rgb(${ramp(INK, t).join(' ')});font-weight:600;` : ''; return `background:rgb(${f.join(' ')} / ${(0.34 * k).toFixed(3)});${ink}`; };
    const hr = (k, lab, info) => ({ key: k, label: lab, num: true, info, style: (r) => (r[k] ? heat(r[k][0] / r[k][1]) : ''), cell: (r) => (r[k] ? `<span class="hrc"><span>${pctOf(r[k])}%</span><span class="hrn">${r[k][0]}/${r[k][1]}</span></span>` : '<span class="muted">—</span>'), val: (r) => pctOf(r[k]) });
    const noModel = (t) => `<span class="muted"${tipAttr(t)}>—</span>`;
    const unit = (m) => ({ 'home-runs': 'HR', 'stolen-bases': 'SB', 'total-bases': 'TB', singles: 'singles', hits: 'hits', rbis: 'RBI', runs: 'runs', 'hits-runs-rbis': 'H+R+RBI', 'pitcher-strikeouts': 'K', 'pitcher-outs': 'outs', 'pitcher-hits-allowed': 'H', receptions: 'rec', 'receiving-yards': 'yds', 'rushing-yards': 'yds', 'anytime-td': 'TD', 'shots-on-goal': 'SOG' }[m] || '');
    const cols = [
      { key: 'grank', label: '#', info: 'Rank across every market: model probability minus the league baseline where a probability exists, then the projection. Not an edge.', cell: (r) => rankChip(r.grank) },
      { key: 'name', label: 'Player', cell: (r) => `<span class="avlabel">${avatar(r.face)}<span class="txt"><span class="nm">${esc(r.name)} ${r.logo ? `<img class="logo sm" src="${esc(r.logo)}" alt="">` : ''}<span class="tmv">${esc(r.team || '')}</span></span><span class="sb">${r.opp ? `${r.home ? 'vs' : '@'} ${esc(r.opp)} · ` : ''}${r.yesNo ? 'Yes' : `Over ${r.line}`} ${esc(mktLabel(r.market))}</span></span></span>`, val: (r) => r.name },
      { key: 'over', label: 'Odds', num: true, info: 'Best over price and its book (Book filter: best available).', cell: (r) => `<span class="oddpill"><span class="muted">${esc(r.overBook)}</span> <b>${odds(r.over)}</b></span>`, val: (r) => r.ip == null ? null : -r.ip },
      { key: 'ip', label: 'IP', num: true, info: 'Implied probability, from the book price.', cell: (r) => `${f1(r.ip)}%` },
      ...(anyModel ? [{ key: 'model', label: 'Model %', num: true, info: "Our model's probability of going over this line. It sits beside IP; nothing computes or colors the difference.", cell: (r) => (r.model != null ? `${f1(r.model)}%` : noModel(mktModel ? 'No model probability for this player.' : 'No model for this market.')) }] : []),
      ...(anyDvp ? [{ key: 'dvp', label: 'DVP', num: true, info: "Opponent's rank in this row's matchup stat.", cell: (r) => (r.dvp != null ? esc(r.dvp) : '<span class="muted">—</span>') }] : []),
      ...(anyProj ? [
        { key: 'proj', label: 'Proj', num: true, info: 'What the model projects for this market.', cell: (r) => (r.proj != null ? `${f1(r.proj, 2)} <span class="muted t-label">${unit(r.market)}</span>` : noModel(mktProj ? 'No projection for this player.' : 'No projection for this market.')) },
        { key: 'diff', label: 'Diff', num: true, info: 'Projection versus the line.', style: (r) => (r.diff != null ? heat(0.5 + Math.max(-0.5, Math.min(0.5, r.diff / (Math.abs(r.line || 1) * 1.2)))) : ''), cell: (r) => (r.diff != null ? signed(r.diff, 2) : '<span class="muted">—</span>') },
        { key: 'conf', label: 'Conf', info: 'How much history the projection rests on: Thin under 20 games, Some under 100, else Deep.', cell: (r) => (r.conf ? `<span class="muted">${r.conf} history</span>` : '<span class="muted">—</span>'), val: (r) => ({ Thin: 1, Some: 2, Deep: 3 }[r.conf]) },
      ] : []),
      hr('l5', 'L5', 'Hit rate, last 5 games.'), hr('l10', 'L10', 'Hit rate, last 10 games.'), hr('l15', 'L15', 'Hit rate, last 15 games.'), hr('h2h', 'H2H', 'Hit rate versus this opponent.'),
      { key: 'strk', label: 'Strk', num: true, info: 'Current streak against today\u2019s line.', cell: (r) => (r.strk ? `<span class="${r.strk[0] === 'O' ? 'pos' : 'neg'}">${r.strk[0] === 'O' ? '+' : '−'}${r.strk.slice(1)}</span>` : '<span class="muted">—</span>'), val: (r) => (r.strk ? (r.strk[0] === 'O' ? 1 : -1) * Number(r.strk.slice(1)) : null) },
      hr('szn', 'SZN', 'Hit rate this season.'),
      { key: 'add', label: '', sort: false, cell: () => `<button type="button" class="btn btn-secondary icon-btn addbtn" aria-label="Add to slip"${tipAttr('Add to slip')}>${icon('track')}</button>` },
    ];
    const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
    const teams = [...new Set(all.map((r) => r.team).filter(Boolean))].sort();
    const pill = (id, act, ic, label, options) => `<label class="pill" for="${id}">${icon(ic)}<span class="sr-only">${label}</span><select id="${id}" data-act="${act}">${options}</select>${icon('down', 'icon chev')}</label>`;
    const filters = `<div class="scanbar">
      <label class="input wide" for="q">${icon('search')}<input id="q" type="search" placeholder="Search players" value="${esc(st.q)}" data-act="q" autocomplete="off"></label>
      <span class="grow"></span>
      <div class="pills">
        ${pill('fgame', 'fgame', 'list', 'Games', opt('', `Games`, st.game) + (d.games || []).filter((g) => g.props).map((g) => opt(g.id, `${g.away.abbr} @ ${g.home.abbr}`, st.game)).join(''))}
        ${pill('fmkt', 'fmkt', 'trend', 'Market', opt('all', 'Market', st.market) + b.markets.map((m) => opt(m.key, `${mktLabel(m.key)} (${m.count})`, st.market)).join(''))}
        ${pill('fteam', 'fteam', 'user', 'Team', opt('', 'Team', st.team || '') + teams.map((t) => opt(t, t, st.team || '')).join(''))}
        ${pill('fl10', 'fl10', 'filter', 'Hit rate', [0, 50, 60, 70, 80].map((n) => opt(String(n), n ? `Hit rate L10 ${n}%+` : 'Hit rate', String(st.minL10))).join(''))}
        ${pill('fodds', 'fodds', 'filter', 'Odds', opt('', 'Odds', st.oddsF || '') + opt('plus', 'Plus money', st.oddsF || '') + opt('fav', 'Favorites', st.oddsF || ''))}
        ${pill('fstreak', 'fstreak', 'alert', 'Streak', opt('', 'Streak', st.streakF || '') + opt('over', 'Over 3+ in a row', st.streakF || ''))}
        ${pill('fbook', 'fbook', 'list', 'Book', opt('best', 'Book: Best available', 'best'))}
      </div></div>`;
    const expand = (r) => {
      const vals = r.last10 || [];
      const hi = Math.max(r.line || 1, ...vals, 1);
      const bars = vals.length ? `<div class="bars" role="img" aria-label="Last ${vals.length} games against the line ${r.line}">${vals.map((v) => `<div class="b ${v > (r.line ?? 0.5) ? 'h' : ''}" style="height:${Math.max(4, (100 * v) / hi)}%"><span>${Number(v)}</span></div>`).join('')}<div class="line" style="bottom:${(100 * (r.line ?? 0.5)) / hi}%"><em>${esc(lineTxt(r))}</em></div></div>` : '<p class="muted">No game history held for this player.</p>';
      const lad = r.ladder ? `<table class="ladder"><thead><tr><th>Line</th><th>Book</th><th class="n">${r.yesNo ? 'Yes' : 'Over'}</th><th class="n">${r.yesNo ? 'No' : 'Under'}</th></tr></thead><tbody>${r.ladder.slice(0, 14).map((x) => `<tr><td class="num">${x[0] == null ? '—' : x[0]}</td><td>${esc(x[1])}</td><td class="n ${x[0] === r.line && x[2] === r.over ? 'best' : ''}">${odds(x[2])}</td><td class="n">${odds(x[3])}</td></tr>`).join('')}</tbody></table>${r.ladder.length > 14 ? `<p class="t-label muted">${r.ladder.length - 14} more prices</p>` : ''}` : '<p class="muted">Every book\u2019s price loads with the row in the product.</p>';
      return `<div class="xp"><div><h4>Last ${vals.length} games against ${esc(lineTxt(r))} ${esc(mktLabel(r.market))}</h4>${bars}<div class="xp-actions"><button class="btn btn-primary btn-sm" type="button">${icon('track')} Add to slip</button><button class="btn btn-secondary btn-sm" type="button">Track line</button><a class="btn btn-secondary btn-sm" href="#props">Player page →</a></div></div><div><h4>Every book</h4>${lad}</div></div>`;
    };
    if (!st.sort.props) st.sort.props = { key: 'grank', dir: 'asc' };
    const main = card({ title: 'Props board', n: b.total, scope: st.market === 'all' ? `All markets · ${rows.length.toLocaleString()} props` : `${mktLabel(st.market)} · ${rows.length.toLocaleString()} props`, flush: true, extra: filters,
      body: table('props', cols, rows.map((r) => ({ ...r, id: r.id })), { paged: true, expand, noun: 'props', empty: { title: 'No props match', body: 'Clear a filter to see more.' } }),
      caption: anyModel ? 'Model % sits beside IP; nothing here computes, sorts by or colors the difference between them.' : 'No model is fitted for this sport, so the board shows prices and history only.' });
    const oCols = [
      { key: 'name', label: 'Player', cell: (r) => avlabel(r.face, r.name, `${mktLabel(r.market)} ${r.side} ${r.line}`), val: (r) => r.name },
      { key: 'book', label: 'Book' },
      { key: 'price', label: 'Price', num: true, cell: (r) => `<b>${odds(r.price)}</b>` },
      { key: 'median', label: 'Others', num: true, info: 'Median price of every other book at this line.', cell: (r) => odds(r.median) },
      { key: 'gap', label: 'Gap', num: true, info: 'Implied-probability points between this book and the median of the rest. 4 to 15 points; larger gaps are stale quotes and dropped.', cell: (r) => `${f1(r.gap)} pts` },
    ];
    const sCols = [
      { key: 'name', label: 'Player', cell: (r) => avlabel(r.face, r.name, mktLabel(r.market)), val: (r) => r.name },
      { key: 'main', label: 'Most books', num: true, cell: (r) => `${r.main} <span class="muted">(${r.mainBooks})</span>` },
      { key: 'alt', label: 'Others', num: true, cell: (r) => `${r.alt} <span class="muted">(${r.altBooks})</span>` },
      { key: 'altList', label: 'At the other line', sort: false, cell: (r) => esc((r.altList || []).join(', ')) },
    ];
    const outl = card({ title: 'Price outliers', n: b.outliers.length, scope: 'Min 5 books', flush: true, body: table('outl', oCols, b.outliers.map((r, i) => ({ ...r, id: 'o' + i })), { empty: { title: 'No outliers', body: `No book is 4+ points off the rest on a line quoted by 5 or more books (${(b.outlierPool || 0).toLocaleString()} such lines today).` } }), caption: 'A price gap between books, not a model edge.' });
    const spl = card({ title: 'Line disagreements', n: b.splits.length, scope: 'Books split on the line', flush: true, body: table('splits', sCols, b.splits.map((r, i) => ({ ...r, id: 's' + i })), { empty: { title: 'Books agree', body: 'Every prop with 3+ books is quoted at one line.' } }), caption: 'Where books disagree on the line itself. A price gap, not a model edge.' });
    return `<section class="section" id="props"><div class="section-head"><h2 class="t-heading">Props</h2><p>Every player prop on the slate, best price first.</p></div><div class="grid-2">${outl}${spl}</div>${main}</section>`;
  }

  // ------------------------------------------------------------------ rankings (spotlights + specials)
  const P = (r, k) => (r.pct && r.pct[k] != null ? r.pct[k] : null);
  const scoreCol = { key: 'score', label: 'Score', num: true, info: 'The mean of each factor’s percentile across today’s pool, equal weights. A ranking of the factors, not a probability.', cls: () => 'bar', style: (r) => `--w:${r.score || 0}%`, cell: (r) => `<b>${f1(r.score, 0)}</b>` };
  const who = (r) => avlabel(r.face, r.name, [r.team, r.opp ? `vs ${r.opp}` : ''].filter(Boolean).join(' '));
  function whyCol(labels) {
    return { key: 'why', label: 'Why', sort: false, wrap: true, cell: (r) => {
      const top = Object.entries(r.pct || {}).filter(([k]) => labels[k]).sort((a, b) => b[1] - a[1]).slice(0, 2);
      return top.length ? esc(top.map(([k, v]) => `${labels[k]} (${ordinal(v)} pct)`).join(' · ')) : '<span class="muted">—</span>';
    } };
  }
  const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const N = (k, lab, d = 1, info, suffix = '') => ({ key: k, label: lab, num: true, info, cell: (r) => (r[k] == null ? '<span class="muted">—</span>' : `${Number(r[k]).toFixed(d)}${suffix}`) });
  const HR = (k, lab) => ({ key: k, label: lab, num: true, cell: (r) => (r[k] ? `${pctOf(r[k])}%` : '—'), val: (r) => pctOf(r[k]) });
  const lineC = { key: 'line', label: 'Line', num: true, cell: (r) => (r.line == null ? '—' : esc(r.line)) };
  const priceC = { key: 'over', label: 'Best', num: true, cell: (r) => (r.over == null ? '—' : `${odds(r.over)} <span class="muted">${esc(r.overBook || '')}</span>`) };
  const vsHand = { key: 'hand', label: 'vs', cell: (r) => (r.starter ? `${esc(r.starter)} <span class="muted">${esc(r.hand || '')}HP</span>` : '—') };
  const parkC = { key: 'park', label: 'Park', num: true, info: 'Park run factor this season: +25 = 25% more runs than average.', cell: (r) => (r.park == null ? '—' : `${r.park > 0 ? '+' : ''}${r.park}%`) };

  const KINDS = {
    hitrate: [{ key: 'name', label: 'Player', cell: who, val: (r) => r.name }, { key: 'market', label: 'Market', cell: (r) => esc(mktLabel(r.market)) }, lineC, HR('l10', 'L10'), HR('l15', 'L15'), HR('szn', 'SZN'), { key: 'books', label: 'Books', num: true }, priceC],
    streaks: [{ key: 'name', label: 'Player', cell: who, val: (r) => r.name }, { key: 'market', label: 'Market', cell: (r) => esc(mktLabel(r.market)) }, lineC, { key: 'strk', label: 'Streak', cell: (r) => `${streakSq(r.streak)} <b>${esc(r.strk)}</b>`, val: (r) => Number((r.strk || 'x0').slice(1)) }, HR('l10', 'L10'), priceC],
    platoon: [{ key: 'name', label: 'Batter', cell: (r) => avlabel(r.face, r.name, `${r.team} · bats ${r.bats}`), val: (r) => r.name }, vsHand, N('pa', 'PA vs hand', 0), N('xwobacon', 'xwOBAcon', 3, 'Expected wOBA on contact against this hand (Statcast).'), N('slg', 'SLG', 3), N('kPct', 'K%', 1, null, '%'), N('hrVs', 'HR', 0)],
    kspots: [{ key: 'name', label: 'Pitcher', cell: (r) => avlabel(r.face, r.name, `${r.team} vs ${r.opp}`), val: (r) => r.name }, N('proj', 'Proj K', 2, 'Projected strikeouts (the MLB prop model).'), lineC, N('k', 'K', 0, 'Season strikeouts.'), N('kbb', 'K-BB%', 1, null, '%'), N('whiff', 'Whiff%', 1, null, '%'), N('oppK', 'Opp K/G', 2, "Opponent's strikeouts per game this season. The split by pitcher hand comes with the ranking job.")],
    parks: [{ key: 'game', label: 'Game', cell: (r) => `<span class="avlabel">${logo(r.logoA)}${logo(r.logoH)}<span class="txt"><span class="nm">${esc(r.game)}</span><span class="sb">${esc(r.venue || '')}</span></span></span>` }, parkC, N('awayRate', 'Home staff HR%', 0, "Share of games the HOME team's pitchers allowed a HR — faced by the away hitters.", '%'), N('homeRate', 'Away staff HR%', 0, "Share of games the AWAY team's pitchers allowed a HR.", '%'), { key: 'weather', label: 'Forecast', cell: (r) => esc(r.weather) }, scoreCol],
    rushers: [{ key: 'name', label: 'Rusher', cell: who, val: (r) => r.name }, lineC, HR('l10', 'L10'), N('oppAllowed', 'Opp allows/G', 1, 'Rushing yards the opponent allows per game this season.'), N('oppG', 'Games', 0), priceC],
    receivers: [{ key: 'name', label: 'Receiver', cell: who, val: (r) => r.name }, lineC, HR('l10', 'L10'), N('oppWrYds', 'Opp WR yds/G', 1, 'Yards the opponent allows to wide receivers per game, from targets.'), N('oppDeepYds', 'Deep yds/G', 1, 'The part of it on deep targets (20+ air yards).'), priceC],
    soccershots: [{ key: 'name', label: 'Player', cell: who, val: (r) => r.name }, N('shG', 'Shots/G', 2), N('sotG', 'On target/G', 2), N('oppShots', 'Opp allows/G', 1, 'Shots the opponent allows per game this season.'), N('g', 'Games', 0)],
    form: [{ key: 'name', label: 'Player', cell: (r) => avlabel(null, r.name, r.opp ? `vs ${r.opp}` : ''), val: (r) => r.name }, { key: 'w', label: 'Last 10', num: true, cell: (r) => `${r.w}–${r.n - r.w}`, val: (r) => r.w / r.n }],
    serve: [{ key: 'name', label: 'Player', cell: (r) => avlabel(null, r.name, `vs ${r.opp}`), val: (r) => r.name }, N('aceRate', 'Ace rate', 1, 'Aces per service point, 2026.', '%'), N('aceM', 'Aces/match', 1), N('oppAceAg', 'Opp concedes', 1, "Aces the opponent concedes per return point.", '%'), N('m', 'Matches', 0)],
    golflow: [{ key: 'name', label: 'Player', cell: (r) => avlabel(r.face, r.name, r.pos ? `Pos ${r.pos}` : ''), val: (r) => r.name }, N('r3', 'R3', 0), { key: 'r3par', label: 'To par', num: true, cell: (r) => (r.r3par == null ? '—' : r.r3par === 0 ? 'E' : `${r.r3par > 0 ? '+' : ''}${r.r3par}`) }],
    longhr: [{ key: 'name', label: 'Batter', cell: who, val: (r) => r.name }, vsHand, N('hr', 'HR', 0), N('avgDist', 'Avg dist', 0, 'Average distance of his home runs this season (Statcast), feet.', ' ft'), N('maxDist', 'Max', 0, null, ' ft'), N('maxEV', 'Max EV', 1, 'Hardest-hit ball this season, mph.'), N('barrel', 'Barrel pct', 0, 'Barrel-ish rate, as a percentile of qualified batters.'), parkC, N('starterHr', 'SP HR allowed', 0, "Opposing starter's home runs allowed this season."), scoreCol, whyCol({ avgDist: 'avg HR distance', maxEV: 'max EV', barrel: 'barrel rate', park: 'park', starterHr: 'starter HR allowed' })],
    hrday: [{ key: 'name', label: 'Batter', cell: who, val: (r) => r.name }, vsHand, N('hrPa', 'HR/PA', 2, 'Home runs per plate appearance this season.', '%'), N('vsHandHrPa', 'vs hand', 2, 'HR per PA against this starter’s hand.', '%'), N('hrSeason', 'HR', 0), N('starterHr', 'SP HR allowed', 0), parkC, scoreCol, whyCol({ hrPa: 'HR rate', vsHandHrPa: 'HR rate vs hand', starterHr: 'starter HR allowed', park: 'park' })],
    mostk: [{ key: 'name', label: 'Pitcher', cell: (r) => avlabel(r.face, r.name, `${r.team} vs ${r.opp}`), val: (r) => r.name }, N('proj', 'Proj K', 2), lineC, N('kbb', 'K-BB%', 1, null, '%'), N('whiff', 'Whiff%', 1, null, '%'), N('oppK', 'Opp K/G', 2), scoreCol, whyCol({ proj: 'projection', kbb: 'K-BB%', whiff: 'whiff rate', oppK: 'opponent strikeouts' })],
    mosttb: [{ key: 'name', label: 'Batter', cell: who, val: (r) => r.name }, vsHand, N('tbL10', 'TB L10', 2, 'Total bases per game, last 10.'), N('tbG', 'TB/G', 2, 'Total bases per game this season.'), N('vsHandSlg', 'SLG vs hand', 3), parkC, scoreCol, whyCol({ tbL10: 'recent total bases', tbG: 'season total bases', vsHandSlg: 'slugging vs hand', park: 'park' })],
    anytd: [{ key: 'name', label: 'Player', cell: who, val: (r) => r.name }, N('tdG', 'TD/G', 2, 'Rushing + receiving TDs per game, last two seasons.'), N('share', 'Team TD share', 0, "His share of his team's rushing + receiving TDs.", '%'), N('implied', 'Team pts', 1, "The team's implied points from today's spread and total."), N('oppTdAllowed', 'Opp TD/G', 2, 'TDs the opponent allows to running backs per game (NFL); per game overall (CFB).'), N('g', 'Games', 0), scoreCol, whyCol({ tdG: 'TD rate', share: 'team TD share', implied: 'team implied points', oppTdAllowed: 'opponent TDs allowed' })],
    firsttd: null, longrec: [{ key: 'name', label: 'Receiver', cell: who, val: (r) => r.name }, N('avgLong', 'Avg long', 1, 'Average of his longest reception per game.'), N('maxLong', 'Max', 0), N('g', 'Games', 0), scoreCol, whyCol({ avgLong: 'average long', maxLong: 'longest catch' })],
    anygoal: [{ key: 'name', label: 'Player', cell: who, val: (r) => r.name }, N('shG', 'Shots/G', 2), N('sotG', 'On target/G', 2), N('glG', 'Goals/G', 2), N('starts', 'Starts', 0), N('oppGoals', 'Opp allows/G', 2, 'Goals the opponent concedes per game this season.'), scoreCol, whyCol({ shG: 'shot volume', sotG: 'shots on target', glG: 'goal rate', oppGoals: 'opponent goals allowed' })],
    aces: [{ key: 'name', label: 'Player', cell: (r) => avlabel(null, r.name, `vs ${r.opp}`), val: (r) => r.name }, N('aceRate', 'Ace rate', 1, null, '%'), N('aceM', 'Aces/match', 1), N('oppAceAg', 'Opp concedes', 1, null, '%'), N('m', 'Matches', 0), scoreCol, whyCol({ aceRate: 'ace rate', aceM: 'aces per match', oppAceAg: 'opponent concedes aces' })],
    golfround: [{ key: 'name', label: 'Player', cell: (r) => avlabel(r.face, r.name, r.pos ? `Pos ${r.pos}` : ''), val: (r) => r.name }, N('avg', 'Round avg', 2), N('best', 'Best round', 0)],
  };
  KINDS.firsttd = KINDS.anytd;

  function spotlightsSection(d) {
    const sp = d.spotlights || [];
    const cards = sp.map((s) => {
      const cols = KINDS[s.kind];
      const tid = 'sp-' + s.id;
      return card({ title: s.title, n: s.rows.length, sub: esc(s.desc), flush: true, body: table(tid, cols, s.rows.map((r, i) => ({ ...r, id: (r.sid || r.game || r.name) + i })), {
        empty: s.kind === 'hitrate' || s.kind === 'streaks'
          ? { title: 'Not enough history yet', body: st.sport === 'mls' ? 'MLS game logs start on Aug 15, so no player has 10 games at today’s line yet.' : 'No player has 10 games of history at today’s line.' }
          : { title: 'Nothing to rank today', body: 'This spotlight fills once today’s markets post.' } }) });
    });
    return `<section class="section" id="spotlights"><div class="section-head"><h2 class="t-heading">Spotlights</h2><p>Research rankings for today. Every factor is a column.</p></div>${cards.length ? `<div class="grid-2">${cards.join('')}</div>` : card({ title: 'Spotlights', body: emptyState({ title: 'No spotlights today' }) })}</section>`;
  }

  function specialsSection(d) {
    const sp = d.specials || [];
    if (!sp.length) return '';
    if (st.special >= sp.length) st.special = 0;
    const s = sp[st.special];
    const tabs = `<div class="tabs" role="tablist" style="padding:0 12px 10px 16px">${sp.map((x, i) => `<button class="tab" role="tab" type="button" data-act="spc" data-v="${i}" aria-selected="${i === st.special}">${esc(x.title)} ${count(x.rows.length)}</button>`).join('')}</div>`;
    const cols = KINDS[s.kind];
    const tid = 'spc-' + s.id;
    if (!st.sort[tid] && cols.some((c) => c.key === 'score')) st.sort[tid] = { key: 'score', dir: 'desc' };
    const nh = s.notHeld ? `<div class="notheld">${icon('alert')}<span>${esc(s.notHeld)}</span></div>` : '';
    const rc = s.receipts;
    let receipts = `<div class="receipts"><span class="t-overline muted">Receipts</span><span class="t-body-sm muted">Yesterday's top five and what happened, from the day the ranking starts running before first pitch.</span></div>`;
    if (rc) {
      const inner = rc.rows ? `<div class="rows">${rc.rows.map((x) => `<span class="chip">${esc(x.name)} <b>${esc(x.value)}</b>${x.sub ? ` <span class="muted">${esc(x.sub)}</span>` : ''}</span>`).join('')}</div>` : `<span class="t-body-sm">${rc.count} players homered on ${fmtDate(rc.date)}.</span>`;
      receipts = `<div class="receipts"><span class="t-overline muted">Receipts · ${esc(rc.label)} (${fmtDate(rc.date)})</span>${inner}<span class="t-label muted">What the ranking will be graded against. Its own top five is frozen before first pitch from the day it starts running.</span></div>`;
    }
    const body = table(tid, cols, s.rows.map((r, i) => ({ ...r, id: (r.sid || r.name) + i })), { empty: { title: 'Nothing to rank', body: 'This ranking fills once today’s players are known.' } });
    return `<section class="section" id="specials"><div class="section-head"><h2 class="t-heading">Specials</h2><p>Odds-free rankings for the books' common promos.</p></div>
      <section class="card"><div class="card-head"><span class="t-card-title">${esc(s.title)}${count(s.rows.length)}</span><span class="scope">For: ${esc(s.promo)}</span></div>${tabs}${nh}${body}<div class="card-caption">A ranking of the factors, not a probability. Weights are equal until the pre-registered backtest sets them.</div>${receipts}</section></section>`;
  }

  // ------------------------------------------------------------------ model card (MLB only)
  function modelSection(d) {
    const m = d.model;
    if (!m) return '';
    const cols = [
      { key: 'matchup', label: 'Game', cell: (r) => `<span class="avlabel"><span class="txt"><span class="nm">${esc(r.matchup)}</span><span class="sb">${esc(r.time)} ET</span></span></span>` },
      { key: 'team', label: 'Moneyline pick', cell: (r) => esc(r.team) },
      { key: 'prob', label: 'Model %', num: true, info: "The game model's win probability for its pick.", cell: (r) => `${(100 * r.prob).toFixed(1)}%` },
      { key: 'price', label: 'Price', num: true, cell: (r) => odds(r.price) },
      { key: 'ip', label: 'IP', num: true, info: 'Implied probability from that price. The difference is not computed.', cell: (r) => (r.ip == null ? '—' : `${f1(r.ip)}%`) },
      { key: 'total', label: 'Total pick', cell: (r) => (r.total ? `${r.total.side === 'over' ? 'Over' : 'Under'} ${r.total.line} · ${(100 * r.total.prob).toFixed(1)}% · ${odds(r.total.price)}` : '—'), val: (r) => r.total?.prob },
    ];
    const rec = (o) => `${o.win || 0}–${o.loss || 0}${o.push ? `–${o.push}` : ''}`;
    const yd = (m.yesterday || []).map((p) => `<span class="chip ${p.outcome === 'win' ? 'good' : p.outcome === 'loss' ? 'bad' : ''}"${tipAttr(`${p.matchup}: ${p.score}`)}>${p.outcome === 'win' ? 'W' : p.outcome === 'loss' ? 'L' : 'P'}</span>`).join('');
    const methods = [...new Set(m.calibration.map((c) => c.method))].join(', ');
    const fitted = m.calibration.map((c) => c.fitted).sort();
    return `<section class="section" id="model"><div class="section-head"><h2 class="t-heading">Model</h2><p>MLB only: the one sport with a fitted, calibrated model.</p></div>
      <div class="grid-2" style="grid-template-columns:minmax(0,1.7fr) minmax(0,1fr)">
        ${card({ title: "Today's model picks", n: m.today.length, scope: 'Moneyline and total', flush: true, body: table('model', cols, m.today.map((r, i) => ({ ...r, id: 'm' + i }))), caption: 'Model % and IP sit side by side. Nothing here computes, sorts by or colors their difference.' })}
        ${card({ title: 'Record', body: `<div style="display:grid;gap:14px">
          <div><div class="t-overline muted">Yesterday · moneyline</div><div class="gc-chips" style="margin-top:6px">${yd || '<span class="muted">No graded picks.</span>'}</div></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><div class="t-overline muted">Last 7 days</div><div class="t-heading num">${rec(m.record['7'])}</div></div><div><div class="t-overline muted">Last 30 days</div><div class="t-heading num">${rec(m.record['30'])}</div></div></div>
          <div class="t-body-sm muted">Calibrated with ${esc(methods)} on ${m.calibration.length} prop markets, fitted ${fmtDate(fitted[0])} – ${fmtDate(fitted[fitted.length - 1])}.</div></div>` })}
      </div></section>`;
  }

  function yoursSection() {
    return `<section class="section" id="yours"><div class="section-head"><h2 class="t-heading">Your lines</h2></div>${card({ title: 'Your lines', n: 0, body: emptyState({ icon: 'bell', title: 'Nothing tracked on today’s slate', body: 'Track a line from the Props board and it shows here with its live status and today’s best price against the price when you tracked it. Signed-out visitors don’t see this section.', action: 'Browse props', actAttr: 'data-act="goprops"' }) })}</section>`;
  }

  function offseason(d) {
    const o = d.offseason;
    return `<div class="offseason">${card({ title: `${d.label} season`, body: emptyState({ icon: 'cal', title: `The ${d.label} season starts ${fmtDate(o.next.slice(0, 10), { weekday: 'long', month: 'long', day: 'numeric' })} (preseason)`, body: 'The slate fills in once games are on the schedule. Last season’s research is on every player and team page.', action: 'Browse teams' }) })}
      ${o.firstGames.length ? card({ title: 'First games', n: o.firstGames.length, flush: true, body: table('pre', [{ key: 'name', label: 'Game' }, { key: 'date', label: 'Date', cell: (r) => fmtDate(r.date.slice(0, 10)) }, { key: 'time', label: 'Tip-off', num: true, cell: (r) => esc(r.time) + ' ET' }], o.firstGames.map((r, i) => ({ ...r, id: 'f' + i }))) }) : ''}</div>`;
  }

  // ------------------------------------------------------------------ page
  function render() {
    const d = DATA[st.sport];
    const secs = sectionsFor(d);
    const nav = secs.length ? `<nav class="section-nav" aria-label="Slate sections"><div class="tabs">${secs.map(([id, l, n], i) => `<a class="tab" href="#${id}" data-act="nav" aria-current="${i === 0}">${esc(l)}${n != null ? ' ' + count(n) : ''}</a>`).join('')}</div></nav>` : '';
    let body = '';
    if (d.offseason) body = offseason(d);
    else {
      body += gamesSection(d);
      if (st.sport !== 'golf') body += moversSection(d) + propsSection(d);
      body += spotlightsSection(d) + specialsSection(d) + modelSection(d) + yoursSection();
    }
    document.getElementById('app').innerHTML = `
      <header class="app-head" id="apphead">${topBar(d)}${strip(d)}</header>
      <main class="page">${nav}${body}</main>
      <div class="mock-foot">Slate mockup · real data captured ${new Date(d.builtAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · spec docs/design/slate-sheet-cards.md</div>`;
    const h = document.getElementById('apphead');
    if (h) document.documentElement.style.setProperty('--hdr', h.offsetHeight + 'px');
  }

  // ------------------------------------------------------------------ events
  const app = document.getElementById('app');
  function rerender(keepScroll = true) { const y = window.scrollY; render(); if (keepScroll) window.scrollTo(0, y); }
  app.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) { if (st.selectOpen && !e.target.closest('.select')) { st.selectOpen = false; rerender(); } return; }
    const a = t.dataset.act;
    if (a === 'sel') { st.selectOpen = !st.selectOpen; rerender(); }
    else if (a === 'sport') { e.preventDefault(); st.sport = t.dataset.s; st.selectOpen = false; st.market = null; st.page = 1; st.game = ''; st.q = ''; st.open.clear(); st.special = 0; try { localStorage.setItem('slate.sport', st.sport); } catch (err) {} rerender(false); window.scrollTo(0, 0); }
    else if (a === 'gf') { st.gameFilter = t.dataset.v; rerender(); }
    else if (a === 'mt') { st.moversTab = t.dataset.v; rerender(); }
    else if (a === 'mkt') { st.market = t.dataset.v; st.page = 1; st.open.clear(); rerender(); }
    else if (a === 'spc') { st.special = Number(t.dataset.v); rerender(); }
    else if (a === 'page') { st.page += Number(t.dataset.d); rerender(); }
    else if (a === 'expand') { const r = t.dataset.r; st.open.has(r) ? st.open.delete(r) : st.open.add(r); rerender(); }
    else if (a === 'sort') {
      const id = t.dataset.t, k = t.dataset.k, cur = st.sort[id];
      const first = t.dataset.num === '1' ? 'desc' : 'asc'; // numeric columns sort high-first on the first click
      st.sort[id] = cur && cur.key === k ? { key: k, dir: cur.dir === 'desc' ? 'asc' : 'desc' } : { key: k, dir: first };
      if (id === 'props') st.page = 1;
      rerender();
    } else if (a === 'gameprops') {
      st.game = t.dataset.g; st.page = 1; rerender();
      document.getElementById('props')?.scrollIntoView({ behavior: 'smooth' });
    } else if (a === 'goprops') document.getElementById('props')?.scrollIntoView({ behavior: 'smooth' });
    else if (a === 'nav') {
      e.preventDefault();
      document.getElementById(t.getAttribute('href').slice(1))?.scrollIntoView({ behavior: 'smooth' });
      app.querySelectorAll('.section-nav .tab').forEach((x) => x.setAttribute('aria-current', String(x === t)));
    }
  });
  const switchSport = (k) => { st.sport = k; st.market = null; st.page = 1; st.game = ''; st.q = ''; st.open.clear(); st.special = 0; st.team = ''; try { localStorage.setItem('slate.sport', k); } catch (err) {} rerender(false); window.scrollTo(0, 0); };
  app.addEventListener('change', (e) => {
    const t = e.target, a = t.dataset.act;
    if (a === 'tbsport') { const v = t.value; return switchSport(v === 'soccer' ? 'epl' : v === 'tennis' ? 'atp' : v); }
    if (a === 'tbleague' || a === 'tbtour') return switchSport(t.value);
    if (a === 'fmkt') { st.market = t.value; st.page = 1; st.open.clear(); }
    else if (a === 'fteam') { st.team = t.value; st.page = 1; }
    else if (a === 'fstreak') { st.streakF = t.value; st.page = 1; }
    else if (a === 'fodds') { st.oddsF = t.value; st.page = 1; }
    else if (a === 'per') { st.per = Number(t.value); st.page = 1; }
    else if (a === 'fgame') { st.game = t.value; st.page = 1; }
    else if (a === 'fbooks') { st.minBooks = Number(t.value); st.page = 1; }
    else if (a === 'fl10') { st.minL10 = Number(t.value); st.page = 1; }
    else return;
    rerender();
  });
  let qTimer;
  app.addEventListener('input', (e) => {
    if (e.target.dataset.act !== 'q') return;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { st.q = e.target.value; st.page = 1; rerender(); const i = document.getElementById('q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 180);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.selectOpen) { st.selectOpen = false; rerender(); } });

  // Tooltip: hover, focus and tap (ours, UI spec §1b)
  const tip = document.createElement('div');
  tip.className = 'tip'; tip.hidden = true; tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  function showTip(el) {
    const text = el.getAttribute('data-tip'); if (!text) return;
    tip.textContent = text; tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    let x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    let y = r.top - h - 8; if (y < 8) y = r.bottom + 8;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  document.addEventListener('mouseover', (e) => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); else hideTip(); });
  document.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('touchstart', (e) => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); else hideTip(); }, { passive: true });
  window.addEventListener('scroll', hideTip, { passive: true });

  render();
})();
