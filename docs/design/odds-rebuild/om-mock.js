/* Track O mockups -- renderer. Reads window.OM (om-data.js, a frozen snapshot of
   real scraper rows). Every component is drawn from that data; values that the
   app does not compute yet (T0 latency, E1 edge) are computed here the way the
   plan describes and marked EXAMPLE. Not app code: a design artefact. */
(function () {
'use strict';
const ORIG = window.OM, BK = ORIG.books;
const END = new Date(ORIG.asof + ':00Z');   // the snapshot: the newest data the mockup holds
let NOW = END;                              // the replay clock (moves; see CLK below)
let O = ORIG;                               // ORIG sliced to NOW (sliceAll)
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ math + format
const dec = a => 1 + (a > 0 ? a / 100 : 100 / -a);
const ip = a => 1 / dec(a);
const toAm = p => p >= 0.5 ? -Math.round(100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
const fa = a => a == null || isNaN(a) ? '—' : (a > 0 ? '+' : '') + Math.round(a);
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
const fl = (l, signed) => l == null ? '' : (signed && l > 0 ? '+' : '') + (Number.isInteger(l) ? l : l.toFixed(1)).toString().replace('.0', '') ;
const fln = l => l == null ? '' : String(+(+l).toFixed(1));
const tms = t => new Date(t.replace(' ', 'T') + (t.length <= 16 ? ':00Z' : 'Z'));
const et = t => tms(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const etd = t => {
  const d = tms(t), day = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  const today = NOW.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  return (day === today ? '' : day + ' ') + et(t);
};
const secs = t => Math.max(0, (NOW - tms(t)) / 1000);
const ago = s => s == null ? '—' : s < 5 ? '<5 s' : s < 60 ? Math.round(s) + ' s' : s < 3600 ? Math.round(s / 60) + ' min' : s < 86400 ? (s / 3600).toFixed(s < 36000 ? 1 : 0).replace('.0', '') + ' h' : Math.round(s / 86400) + ' d';
const money = v => v == null ? '—' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k' : '$' + Math.round(v);
const nfmt = v => v == null ? '—' : Math.round(v).toLocaleString('en-US');
const devig = (a, b) => { const pa = ip(a), pb = ip(b); return pa / (pa + pb); };

// ------------------------------------------------------------------ replay: the data as it stood at NOW
// Each book's main line and price come from its recorded minute-level history (real). A row that last
// changed after NOW and has no history is left out, because its earlier state is unknown. During the
// replay, "checked" follows each source's real poll interval.
const CAD = { pinnacle: 70, kalshi: 70, polymarket: 70, draftkings: 70, fanduel: 70, betmgm: 128, betrivers: 70, sleeper: 80, underdog: 80,
  vsin: 90, dknetwork: 480, sao_consensus: 900, covers: 3600, actionnetwork: 90 };
const cadOf = s => CAD[s] || 50;
const hsh = s => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
const simChecked = (src, t) => (t / 1000 + hsh(src) % cadOf(src)) % cadOf(src);
const TS = {}; const tsm = x => TS[x] ?? (TS[x] = +tms(x));
function sliceMarket(m, t) {
  if (t >= +END || !m || !m.cur) return m;
  const sideA = m.cur.some(c => c[1] === 'home' || c[1] === 'away') ? 'home' : 'over', sideB = sideA === 'home' ? 'away' : 'under';
  const hist = {}, later = {};
  for (const [k, h] of Object.entries(m.hist || {})) {
    let i = h.length; while (i && tsm(h[i - 1][0]) > t) i--;
    if (i) hist[k] = i === h.length ? h : h.slice(0, i);
    later[k] = i < h.length;
  }
  const signed = sideA === 'home' && m.cur.some(c => c[1] === 'home' && c[2] != null);
  const row = (k, side, p, src, x) => { const A = side === sideA; return [k, side, p[1] == null ? null : signed && !A ? -p[1] : p[1], A ? p[2] : p[3], p[0], src, simChecked(src, t), 'main', x]; };
  const cur = [], done = new Set();
  for (const c of m.cur) {
    const k = c[0];
    if (later[k] && c[7] === 'main') {               // this book's main line moved after NOW: take it from history
      if (!hist[k] || done.has(k + c[1])) continue;
      done.add(k + c[1]);
      cur.push(row(k, c[1], hist[k][hist[k].length - 1], c[5], c[8]));
      continue;
    }
    if (tsm(c[4]) > t && !(m.hist && m.hist[k] && c[7] === 'main')) continue;
    const r = c.slice(); r[6] = simChecked(c[5], t); cur.push(r);
  }
  // a book with history but no row at the snapshot was pulled: it is priced until its last recorded change
  for (const [k] of Object.entries(m.hist || {})) {
    if (m.cur.some(c => c[0] === k && c[7] === 'main') || !later[k] || !hist[k]) continue;
    const p = hist[k][hist[k].length - 1];
    cur.push(row(k, sideA, p, 'comparenbet', null), row(k, sideB, p, 'comparenbet', null));
  }
  const open = {}; for (const [k, o] of Object.entries(m.open || {})) if (tsm(o[0]) <= t) open[k] = o;
  return Object.assign({}, m, { cur, hist, open, moves: (m.moves || []).filter(x => tsm(x[0]) <= t),
    steam: (m.steam || []).filter(s => s.times.every(x => tsm(x) <= t)) });
}
function sliceSplits(rows, hist, t) {
  if (t >= +END) return rows;
  return rows.map(s => {
    const h = hist[`${s[1]}|${s[3]}|${s[4]}`];
    if (!h) return tsm(s[0]) <= t ? s : null;
    let p = null; for (const q of h) if (tsm(q[0]) <= t) p = q;
    if (!p) return null;
    const A = s[5] === 'home' || s[5] === 'over', r = s.slice();
    r[0] = p[0]; r[7] = A ? p[2] : 100 - p[2]; r[8] = p[3] == null ? s[8] : A ? p[3] : 100 - p[3];
    return r;
  }).filter(Boolean);
}
function sliceAll(t) {
  if (t >= +END) return ORIG;
  const n = ORIG.nfl;
  const mapM = ms => Object.fromEntries(Object.entries(ms).map(([k, m]) => [k, sliceMarket(m, t)]));
  const players = Object.fromEntries(Object.entries(n.players).map(([k, p]) => [k, Object.assign({}, p, { markets: mapM(p.markets) })]));
  return Object.assign({}, ORIG, {
    nfl: Object.assign({}, n, { markets: mapM(n.markets), players, splits: sliceSplits(n.splits, n.splitHist, t),
      splitHist: Object.fromEntries(Object.entries(n.splitHist).map(([k, h]) => [k, h.filter(p => tsm(p[0]) <= t)])) }),
    mlb: ORIG.mlb.map(g => Object.assign({}, g, { markets: mapM(g.markets),
      kprops: Object.fromEntries(Object.entries(g.kprops || {}).map(([k, v]) => [k, sliceMarket(v, t)])) })) });
}

// ------------------------------------------------------------------ live layer
// CLK.t is market time. The replay runs at CLK.speed until it reaches the snapshot (END), then at 1×.
const CLK = { t: +END - 3600e3, play: true, speed: 20, wall: 0, min: null, openT: +END - 3600e3 };
let LIVE_RENDER = false;          // true while the clock (not a click) is re-rendering: only then do values flash
let PREV = {}, CHG = {}, ROWST = null, EDGE_ST = {}, SEEN = {}, CHART_N = {}, PULLED = {};
const TRAIL_S = 120;              // a change's arrow fades over 2 min of market time
const base = () => Math.min(+NOW, +END);           // ages in the data are relative to this instant
const atS = sec => base() - sec * 1000;             // "checked N s ago" -> the ms it happened
const tick$ = (ms, fmt) => `<span data-at="${Math.round(ms)}">${ago(Math.max(0, (+NOW - ms) / 1000))}</span>`;
const agoS = sec => tick$(atS(sec));                // a ticking "N s" for a relative age
const agoT = ts => tick$(tsm(ts));                  // a ticking "N min" for a timestamp
/** A live value: flashes green (up) or red (down) when it changes, then leaves an arrow that fades. */
function lv(key, v, html, cls) {
  const k = S.surf + '|' + key, c = CHG[k], age = c ? (+NOW - c.t) / 1000 : 1e9;
  const tr = c && age < TRAIL_S ? `<span class="trail ${c.d > 0 ? 'up' : 'dn'}" data-trail="${c.t}" style="opacity:${Math.max(0.15, 1 - age / TRAIL_S).toFixed(2)}">${c.d > 0 ? '▲' : '▼'}<span data-at="${c.t}">${ago(age)}</span></span>` : '';
  return `<span data-lv="${esc(k)}" data-v="${v == null ? '' : esc(v)}" class="${cls || ''}"${c && c.t > CLK.openT ? ' data-recent' : ''}>${html}</span>${tr}`;
}
const liveState = (age, cad) => age <= 2 * cad ? '' : age <= 6 * cad ? 'slow' : 'off';
const liveTxt = (age, st) => st === 'off' ? `no update in ${ago(age)}` : `updated ${ago(age)} ago`;
/** A card header's liveness: a pulsing green dot while the newest reading is inside twice the source's
 *  poll interval, amber once it is late, grey once it is far past it. */
function liveTag(atMs, cad) {
  if (atMs == null || !isFinite(atMs)) return '';
  const age = Math.max(0, (+NOW - atMs) / 1000), st = liveState(age, cad || 70);
  return `<span class="upd ${st === 'slow' ? 'slow' : ''}" data-live="${Math.round(atMs)}" data-cad="${cad || 70}"><i class="ld ${st}"></i><span>${liveTxt(age, st)}</span></span>`;
}
/** Price changes per minute across every book, last 30 minutes. */
function heartbeat(m) {
  const n = 30, t = +NOW, b = new Array(n).fill(0);
  for (const h of Object.values(m.hist || {})) for (let i = h.length - 1; i >= 0; i--) { const d = Math.floor((t - tsm(h[i][0])) / 60000); if (d >= n) break; if (d >= 0) b[n - 1 - d]++; }
  const mx = Math.max(1, ...b), tot = b.reduce((a, x) => a + x, 0);
  return `<span class="hbw" title="Price changes per minute across every book, last 30 minutes"><span class="hb">${b.map((v, i) => `<i class="${i === n - 1 && v ? 'now' : ''}" style="height:${v ? Math.max(3, 16 * v / mx) : 1}px"></i>`).join('')}</span><span>${tot} changes in 30 min</span></span>`;
}
/** "N prices changed since you opened this page" -- clicking it outlines them. */
function sinceOpened() {
  const p = S.surf + '|';
  const n = Object.entries(CHG).filter(([k, c]) => k.startsWith(p) && c.t > CLK.openT).length;
  const np = Object.entries(PULLED).filter(([k, t]) => k.startsWith(p) && t > CLK.openT).length;
  if (!n && !np) return `<span class="small muted">No changes since you opened this page</span>`;
  return `<button class="sinceo" data-recent-toggle="1">${n} price${n === 1 ? '' : 's'} changed since you opened this${np ? ` · ${np} pulled` : ''}${S.showRecent ? ' · hide' : ' · show'}</button>`;
}
/** Market-tab badge: changes in this market since you last looked at it. */
function tabNew(key, m, selected) {
  if (selected) { SEEN[key] = +NOW; return ''; }
  const since = SEEN[key] ?? CLK.openT; let n = 0;
  for (const h of Object.values(m.hist || {})) for (let i = h.length - 1; i >= 0 && tsm(h[i][0]) > since; i--) n++;
  return n ? `<span class="tnew">${n} new</span>` : '';
}
/** When a source was last polled: its real last poll at the snapshot, or its poll rhythm during the replay. */
const srcChecked = src => +NOW < +END || !ORIG.nfl.checked[src] ? atS(simChecked(src, +NOW)) : tsm(ORIG.nfl.checked[src]);
const FAILED = new Set();
window.OMFAIL = el => { FAILED.add(el.getAttribute('src')); el.outerHTML = el.dataset.f || ''; };

const GROUPS = [['sharp', 'Sharp'], ['exchange', 'Exchanges'], ['us', 'US books'], ['nevada', 'Nevada'], ['offshore', 'Offshore'], ['intl', 'International'], ['pickem', "Pick'em"]];
const GORD = Object.fromEntries(GROUPS.map((g, i) => [g[0], i]));
const bn = k => (BK[k] && BK[k].n) || k;
const bg = k => (BK[k] && BK[k].g) || 'intl';
const USER_BOOK = 'fanduel';
const tile = (k, s) => `<span class="bl tile" style="width:${s}px;height:${s}px;font-size:${Math.round(s * .62)}px">${esc(bn(k).replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase())}</span>`;
const logo = (k, s = 16) => {
  const src = BK[k] && BK[k].d ? `https://www.google.com/s2/favicons?domain=${BK[k].d}&sz=${s * 2}` : null;
  return src && !FAILED.has(src) ? `<img class="bl" alt="" width="${s}" height="${s}" style="width:${s}px;height:${s}px" src="${src}" onerror="OMFAIL(this)" data-f='${tile(k, s)}'>` : tile(k, s);
};
const book = (k, s) => `<span class="bk">${logo(k, s)}<span>${esc(bn(k))}</span>${k === USER_BOOK ? '<span class="star" title="Your book">★</span>' : ''}</span>`;
const PAL = ['#2f6fb3', '#c56a1c', '#00873f', '#8e44ad', '#c4161c', '#0f8b8d', '#9a6200', '#5c6bc0', '#6d4c41', '#d81b60', '#546e7a', '#7cb342'];
const note = (tag, html) => `<div class="note"><span class="tag">${tag}</span>${html}</div>`;
const EX = '<span class="ex">example</span>', REAL = '<span class="real">real</span>';

// ------------------------------------------------------------------ state
const S = { surf: 'player', w: 'desk', notes: true, pm: 'rec_yds', pline: null, all: false, gper: 'fg', gmk: 'sp', gline: null, gall: false,
  win: '2h', sel: null, metric: null, hub: 'edges', slateSec: 'games', pf: { team: 'all', pos: 'all', mk: 'all', sort: 'books', view: 'players' }, pfMore: false, fp: { team: 'all', res: 'all', mk: 'all', view: 'players' }, fpMore: false };

// ------------------------------------------------------------------ market model
const PROPS = [['rec_yds', 'Receiving yards', 'receiving_yards'], ['receptions', 'Receptions', 'receptions'], ['longest_rec', 'Longest reception', 'longest_reception'],
  ['anytime_td', 'Anytime TD', 'anytime_touchdowns'], ['targets', 'Targets', null], ['rush_rec_yds', 'Rush + rec yards', 'rushing_and_receiving_yards']];
const G = O.nfl.game;
const TEAM = { home: { abbr: 'GB', name: 'Packers', full: 'Green Bay Packers', color: '#204e32', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/gb.png', rec: '1-1' },
  away: { abbr: 'ATL', name: 'Falcons', full: 'Atlanta Falcons', color: '#a71930', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/atl.png', rec: '0-2' } };

function spec(kind, extra) {
  const s = { kind };
  if (kind === 'sp') Object.assign(s, { sides: ['home', 'away'], signed: true });
  else if (kind === 'ml') Object.assign(s, { sides: ['home', 'away'], noLine: true });
  else Object.assign(s, { sides: ['over', 'under'] });
  return Object.assign(s, extra || {});
}
const atLine = (sp, c, side, L) => sp.noLine ? true : sp.signed ? (side === sp.sides[0] ? c[2] === L : c[2] === -L) : c[2] === L;

/** One row per book: its quotes at line L (if it has them) else its main line. */
function boardRows(m, sp, L) {
  const by = {};
  for (const c of m.cur) (by[c[0]] = by[c[0]] || []).push(c);
  const rows = [];
  for (const k of Object.keys(by)) {
    const qs = by[k], [A, Bs] = sp.sides;
    const pick = (side, pred) => qs.filter(c => c[1] === side && pred(c)).sort((x, y) => (x[7] === 'main' ? -1 : 1) - (y[7] === 'main' ? -1 : 1) || (x[6] ?? 9e9) - (y[6] ?? 9e9))[0];
    let qa = pick(A, c => atLine(sp, c, A, L)), qb = pick(Bs, c => atLine(sp, c, Bs, L));
    const at = !!(qa || qb);
    if (!at) { qa = pick(A, c => c[7] === 'main'); qb = pick(Bs, c => c[7] === 'main'); }
    if (!qa && !qb) continue;
    const q = qa || qb, op = m.open[k];
    const mainA = qs.find(c => c[1] === A && c[7] === 'main');
    rows.push({ k, g: bg(k), qa, qb, at, line: q[2] != null ? (q[1] === A ? q[2] : -q[2]) : null, age: Math.min(qa ? qa[6] ?? 9e9 : 9e9, qb ? qb[6] ?? 9e9 : 9e9),
      since: [qa, qb].filter(Boolean).map(c => c[4]).sort().pop(), src: q[5], x: (qa && qa[8]) || (qb && qb[8]), op, mainLine: mainA ? mainA[2] : null });
  }
  for (const i of [0, 1]) {
    const ps = rows.filter(r => r.at && (i ? r.qb : r.qa) && r.g !== 'pickem').map(r => ip((i ? r.qb : r.qa)[3])).sort((a, b) => a - b);
    const med = ps[Math.floor(ps.length / 2)];
    if (ps.length >= 5) for (const r of rows) { const q = i ? r.qb : r.qa; if (r.at && q && (ip(q[3]) < med * 0.6 || ip(q[3]) > med * 1.6)) r['out' + i] = true; }
  }
  rows.sort((a, b) => GORD[a.g] - GORD[b.g] || (a.k === USER_BOOK ? -1 : b.k === USER_BOOK ? 1 : 0) || bn(a.k).localeCompare(bn(b.k)));
  return rows;
}
const isPriced = r => r.g !== 'pickem';
const noPrice = (k, q) => k === 'prizepicks' || (q && q[3] === 100 && bg(k) === 'pickem' && k !== 'underdog');
function bestOf(rows, side) {
  let b = null;
  for (const r of rows) { const q = side === 0 ? r.qa : r.qb; if (!r.at || !q || !isPriced(r) || r['out' + side]) continue; if (!b || dec(q[3]) > dec(b.q[3])) b = { k: r.k, q, r }; }
  return b;
}
function mainLines(m, sp) {  // consensus (modal) line on side A among books' main quotes
  const cnt = {};
  for (const c of m.cur) if (c[7] === 'main' && c[1] === sp.sides[0] && c[2] != null && bg(c[0]) !== 'pickem') cnt[c[2]] = (cnt[c[2]] || 0) + 1;
  const e = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
  return { modal: e.length ? +e[0][0] : null, counts: cnt };
}
function allLines(m, sp, span) {
  const cen = mainLines(m, sp).modal;
  const s = new Set();
  for (const c of m.cur) if (c[1] === sp.sides[0] && c[2] != null && (cen == null || Math.abs(c[2] - cen) <= span)) s.add(c[2]);
  return [...s].sort((a, b) => a - b);
}
function pinAt(m, sp, L) {
  const a = m.cur.find(c => c[0] === 'pinnacle' && c[1] === sp.sides[0] && atLine(sp, c, sp.sides[0], L));
  const b = m.cur.find(c => c[0] === 'pinnacle' && c[1] === sp.sides[1] && atLine(sp, c, sp.sides[1], L));
  return a && b ? { a, b, fa: devig(a[3], b[3]) } : null;
}
function pinMain(m, sp) {
  const a = m.cur.find(c => c[0] === 'pinnacle' && c[1] === sp.sides[0] && c[7] === 'main');
  return a ? a[2] : null;
}

// ------------------------------------------------------------------ components
function secHead(title, sub, right) {
  return `<div class="sech"><h2>${title}</h2>${sub ? `<span class="sub">${sub}</span>` : ''}<div class="r">${right || ''}<button class="btn ghost">Hide</button></div></div>`;
}
function cardH(title, scope, extra) {
  return `<div class="ch"><h3>${title}</h3>${extra || ''}<span class="scope">${scope || ''}</span><button class="i" aria-label="About">ⓘ</button></div>`;
}

/* O-I freshness strip */
function fresh(m, rows) {
  const ages = rows.filter(r => r.age < 9e9);
  const newest = ages.reduce((a, r) => Math.min(a, r.age), 9e9);
  const oldR = rows.filter(r => r.since).sort((a, b) => a.since.localeCompare(b.since))[0];
  const pulled = Object.keys(m.hist).filter(k => !rows.find(r => r.k === k)).length;
  return `${heartbeat(m)} · ${rows.length} books · newest check ${agoS(newest)} ago · oldest unchanged price ${oldR ? bn(oldR.k) + ' since ' + etd(oldR.since) : '—'}${pulled ? ` · <span class="mv dn">${pulled} pulled</span>` : ''}`;
}

const boardLive = rows => { const a = rows.filter(r => r.age < 9e9).map(r => r.age); return a.length ? liveTag(atS(Math.min(...a)), 70) : ''; };

/* O-S sharp strip -- a normal card ("Sharp prices"): one tile per sharp source, each with its no-vig split */
const PROP_COL = ['#2f6fb3', '#c56a1c'];
function fairBar(p, labels, colors, big) {
  return `<div class="fbar${big ? ' big' : ''}"><i style="width:${(p * 100).toFixed(1)}%;background:${colors[0]}"></i><i style="width:${((1 - p) * 100).toFixed(1)}%;background:${colors[1]}"></i></div>
    <div class="fbar-l"><span>${labels[0]} <b>${pct(p)}</b></span><span><b>${pct(1 - p)}</b> ${labels[1]}</span></div>`;
}
function sharpTile(k, a, b, lab, col, extra) {
  const lim = (a[8] || {}).limit;
  const stale = secs(a[4]) > 6 * 3600;
  const fair = devig(a[3], b[3]);
  return `<div class="stile"><div class="st-h">${logo(k, 20)}<b>${esc(bn(k))}</b></div>
    <div class="st-p"><div><div class="ov">${lab[0]}</div><b class="big px">${lv('sh|' + k + '|a', a[3], fa(a[3]))}</b></div><div><div class="ov">${lab[1]}</div><b class="big px">${lv('sh|' + k + '|b', b[3], fa(b[3]))}</b></div>
      <div style="margin-left:auto;text-align:right"><div class="ov">fair ${lab[0]}</div><b class="big" style="color:var(--good-ink)">${lv('sh|' + k + '|f', toAm(fair), fa(toAm(fair)))}</b></div></div>
    ${fairBar(fair, lab, col)}
    <div class="kvs"><div class="kvr"><span>Checked</span><span>${agoS(a[6])} ago</span></div>
      <div class="kvr"><span>${stale ? 'Unchanged for' : 'Price since'}</span><span class="${stale ? 'st warn' : ''}">${stale ? agoT(a[4]) : etd(a[4])}</span></div>
      ${lim ? `<div class="kvr"><span>Limit</span><span><b>$${nfmt(lim)}</b></span></div>` : ''}${extra || ''}</div></div>`;
}
function sharpStrip(m, sp, L, labels, colors) {
  const lab0 = labels || ['Over', 'Under'];
  const lab = sp.signed ? [lab0[0] + ' ' + fl(L, true), lab0[1] + ' ' + fl(-L, true)] : sp.noLine ? lab0 : [lab0[0] + ' ' + fln(L), lab0[1] + ' ' + fln(L)];
  const col = colors || PROP_COL;
  const find = (k, i) => m.cur.filter(c => c[0] === k && c[1] === sp.sides[i] && (sp.noLine ? true : atLine(sp, c, sp.sides[i], L))).sort((x, y) => (x[7] === 'main' ? -1 : 1) - (y[7] === 'main' ? -1 : 1))[0];
  const tiles = [];
  const pa = find('pinnacle', 0), pb = find('pinnacle', 1);
  if (pa && pb) tiles.push(sharpTile('pinnacle', pa, pb, lab, col));
  else {
    const pm = pinMain(m, sp);
    tiles.push(`<div class="stile none"><div class="st-h">${logo('pinnacle', 20)}<b>Pinnacle</b></div>
      <div class="st-none">No Pinnacle price at ${sp.signed ? fl(L, true) : fln(L)}</div>
      ${pm != null ? `<div class="age">Pinnacle prices ${sp.signed ? fl(pm, true) : fln(pm)} — <button class="lnk" data-goto="${pm}">go to ${sp.signed ? fl(pm, true) : fln(pm)}</button></div>` : '<div class="age">Pinnacle does not price this market.</div>'}</div>`);
  }
  const ca = find('circa', 0), cb = find('circa', 1);
  if (ca && cb) tiles.push(sharpTile('circa', ca, cb, lab, col, `<div class="kvr"><span>Source</span><span>${ca[5] === 'vsin' ? 'VSiN line tracker' : 'comparenbet (relayed)'}</span></div>`));
  // exchanges
  const ex = [];
  for (const k of ['kalshi', 'novig', 'prophetx', 'polymarket']) {
    const q = m.cur.filter(c => c[0] === k && c[1] === sp.sides[0] && (sp.noLine ? true : atLine(sp, c, sp.sides[0], L))).sort((x, y) => (x[5] === k ? -1 : 1))[0];
    if (!q) continue;
    const x = q[8] || {};
    const ba = x.yes_bid != null ? [x.yes_bid, x.yes_ask] : x.bid != null ? [x.bid, x.ask] : null;
    ex.push(`<div class="exr">${logo(k, 16)}<span>${esc(bn(k))}</span><b class="px">${lv('sh|' + k + '|x', q[3], fa(q[3]))}</b>${ba ? `<span class="small soft">${Math.round(ba[0] * 100)}–${Math.round(ba[1] * 100)}¢</span>` : '<span></span>'}<span class="age">${x.volume_24h ? money(x.volume_24h) + ' 24h' : x.liquidity ? money(x.liquidity) + ' liq.' : ''}</span></div>`);
  }
  if (!ex.some(e => e.includes('>Kalshi<'))) {
    const near = m.cur.filter(c => c[0] === 'kalshi' && c[1] === sp.sides[0] && c[2] != null && (c[8] || {}).yes_bid != null && !sp.signed).sort((x, y) => Math.abs(x[2] - L) - Math.abs(y[2] - L)).slice(0, 2).sort((x, y) => x[2] - y[2]);
    if (near.length) ex.push(`<div class="age" style="margin-top:4px">${logo('kalshi', 14)} Kalshi has no contract at ${fln(L)} · nearest ${near.map(c => `<b>${Math.ceil(c[2])}+</b> ${Math.round(c[8].yes_bid * 100)}–${Math.round(c[8].yes_ask * 100)}¢`).join(' · ')}</div>`);
  }
  tiles.push(`<div class="stile"><div class="st-h"><b>Exchanges</b><span class="age" style="margin-left:auto">${lab[0]} · bid–ask · volume</span></div>${ex.length ? ex.join('') : '<div class="st-none">No exchange at this line</div>'}</div>`);
  // header liveness = the newest reading among the sharp sources
  const sharpAges = m.cur.filter(c => ['pinnacle', 'circa', 'kalshi', 'polymarket', 'novig', 'prophetx'].includes(c[0]) && c[6] != null).map(c => c[6]);
  const live = sharpAges.length ? liveTag(atS(Math.min(...sharpAges)), 70) : '';
  return `<section class="card">${cardH('Sharp prices', 'fair = Pinnacle with the vig removed', live)}<div class="cb"><div class="s2-grid">${tiles.join('')}</div></div></section>`;
}

/* O-B best price + hold meter */
function bestCard(m, sp, L, labels, rows) {
  const lab = labels || ['Over', 'Under'];
  const b0 = bestOf(rows, 0), b1 = bestOf(rows, 1);
  const two = rows.filter(r => r.at && r.qa && r.qb && isPriced(r) && r.g !== 'exchange');
  const holds = two.map(r => ({ k: r.k, h: ip(r.qa[3]) + ip(r.qb[3]) - 1 })).sort((a, b) => a.h - b.h);
  const typical = holds.length ? holds[Math.floor(holds.length / 2)] : null;
  const bestHold = b0 && b1 ? ip(b0.q[3]) + ip(b1.q[3]) - 1 : null;
  const me = rows.find(r => r.k === USER_BOOK);
  let meLine = '';
  if (me) {
    if (!me.at) meLine = `${book(USER_BOOK, 14)} is at ${fl(me.line, sp.signed)}, not ${fl(L, sp.signed)}`;
    else {
      const d0 = b0 && me.qa ? Math.round((dec(b0.q[3]) - dec(me.qa[3])) * 100) : null, d1 = b1 && me.qb ? Math.round((dec(b1.q[3]) - dec(me.qb[3])) * 100) : null;
      const lc = x => /^(Over|Under)$/.test(x) ? x.toLowerCase() : x;
      meLine = `${book(USER_BOOK, 14)} ${lc(lab[0])} ${fa(me.qa && me.qa[3])}${d0 ? ` <span class="muted">(${d0}¢ off best)</span>` : ' <span class="st good">best</span>'} · ${lc(lab[1])} ${fa(me.qb && me.qb[3])}${d1 ? ` <span class="muted">(${d1}¢ off best)</span>` : ' <span class="st good">best</span>'}`;
    }
  }
  const within = side => { const b = side ? b1 : b0; if (!b) return 0; return rows.filter(r => r.at && isPriced(r) && (side ? r.qb : r.qa) && dec(b.q[3]) - dec((side ? r.qb : r.qa)[3]) <= 0.05).length; };
  const box = (b, l, i) => b ? `<div class="bpx"><div class="ov">Best ${l.toLowerCase()} ${sp.noLine ? '' : fl(sp.signed && l === lab[1] ? -L : L, sp.signed)}</div><div class="v px">${lv('best|' + L + '|' + i, b.q[3], fa(b.q[3]))}</div>
      <div class="small" style="margin-top:2px">${book(b.k, 14)}</div><div class="age">checked ${agoS(b.q[6])} ago · since ${etd(b.q[4])}</div></div>` : `<div class="bpx"><div class="ov">Best ${l.toLowerCase()}</div><div class="v muted">—</div><div class="age">no book at this line</div></div>`;
  const W = h => Math.max(2, Math.min(100, (h / 0.1) * 100));
  const newest = rows.filter(r => r.age < 9e9).reduce((a, r) => Math.min(a, r.age), 9e9);
  return `<section class="card">${cardH('Best price', sp.noLine ? 'Moneyline' : 'at ' + fl(L, sp.signed), newest < 9e9 ? liveTag(atS(newest), 70) : '')}<div class="cb">
    <div class="bp">${box(b0, lab[0], 0)}${box(b1, lab[1], 1)}</div>
    <div class="small soft" style="margin-top:10px">${meLine}</div>
    <div class="small muted" style="margin-top:2px">${within(0)} books within 5¢ of the best ${/^(Over|Under)$/.test(lab[0]) ? lab[0].toLowerCase() : lab[0]} · ${within(1)} of the best ${/^(Over|Under)$/.test(lab[1]) ? lab[1].toLowerCase() : lab[1]}</div>
    <div style="margin-top:12px"><div class="lbl" style="display:flex;justify-content:space-between"><span>Market hold</span><span class="muted">vig you pay</span></div>
      ${typical ? `<div style="display:grid;grid-template-columns:120px 1fr 54px;gap:8px;align-items:center;margin-top:6px" class="small">
        <span>At one book <span class="muted">(median)</span></span><div class="meter"><i style="width:${W(typical.h)}%;background:var(--warn)"></i></div><b class="r px">${pct(typical.h)}</b>
        <span>At the best prices</span><div class="meter"><i style="width:${W(Math.max(0, bestHold))}%;background:var(--good)"></i></div><b class="r px">${pct(bestHold)}</b></div>
        <div class="age" style="margin-top:4px">${bestHold < 0 ? 'Best prices cross (negative hold) — shown as a fact, never labelled an opportunity.' : `Shopping takes the hold from ${pct(typical.h)} to ${pct(bestHold)}. Lowest single book: ${bn(holds[0].k)} ${pct(holds[0].h)}.`}</div>` : '<div class="age">Needs two-sided prices at this line.</div>'}
    </div></div></section>`;
}

/* O-C edge -- visual: a probability ruler, evidence chips, gate pills */
function ruler(imp, fair, labImp) {
  const lo = Math.min(imp, fair) - 0.025, hi = Math.max(imp, fair) + 0.025, X = v => ((v - lo) / (hi - lo) * 100).toFixed(1);
  const good = fair > imp;
  const ticks = []; for (let v = Math.ceil(lo * 100); v <= Math.floor(hi * 100); v++) ticks.push(v);
  return `<div class="ruler">
    <div class="rl-track"></div>${ticks.map(v => `<i class="rl-t" style="left:${X(v / 100)}%"></i>`).join('')}
    <div class="rl-gap ${good ? 'g' : 'b'}" style="left:${X(Math.min(imp, fair))}%;width:${Math.abs(X(fair) - X(imp))}%"></div>
    <div class="rl-m imp" style="left:${X(imp)}%"><span>${labImp} <b>${pct(imp)}</b></span></div>
    <div class="rl-m fair" style="left:${X(fair)}%"><span>Fair <b>${pct(fair)}</b></span></div>
  </div>`;
}
function edgeCard(e) {
  const sk = S.surf === 'player' ? `p|${S.pm}|${S.pline}` : `g|${S.gper}|${S.gmk}|${S.gline}`, was = EDGE_ST[sk];
  EDGE_ST[sk] = !!e.on;
  const fx = LIVE_RENDER && was != null && was !== !!e.on ? (e.on ? 'eopen' : 'eclose') : '';
  const gates = gs => { const pass = gs.filter(g => g[1]).length;
    return `<div class="glh"><b>Gates</b><span class="st ${pass === gs.length ? 'good' : 'bad'}">${pass} of ${gs.length} pass</span></div><div class="gl">${gs.map(g => `<div class="${g[1] ? 'ok' : 'no'}">${g[0]}</div>`).join('')}</div>`; };
  const ages = (e.refs || []).map(r => r[2]).filter(v => v != null);
  const live = ages.length ? liveTag(atS(Math.min(...ages)), 70) : '';
  if (e.nosharp) return `<section class="card" data-fx="${fx}">${cardH('Edge', e.scope, live)}<div class="cb"><div class="e-top"><span class="e-badge off">NO EDGE</span><b>No sharp price at this line</b></div>
    <div class="e-empty">${logo('pinnacle', 22)}<div><div class="small">${e.why}</div>${e.goto != null ? `<button class="btn" style="margin-top:8px" data-goto="${e.goto}">Compare at ${e.gotoTxt}</button>` : ''}</div></div>
    ${gates(e.gates)}</div></section>`;
  return `<section class="card edge ${e.on ? 'on' : 'off'}" data-fx="${fx}">${cardH('Edge' + (e.on ? ' ' + EX : ''), e.scope, live)}<div class="cb">
    <div class="e-top"><span class="e-badge ${e.on ? 'on' : 'off'}">${e.on ? 'EDGE' : 'NO EDGE'}</span><div class="e-title">${logo(e.k, 20)}<b>${e.title}</b></div>
      <div class="e-ev ${e.ev > 0 ? 'pos' : 'neg'}">${lv('edge|' + e.scope, (e.ev * 100).toFixed(1), (e.ev >= 0 ? '+' : '') + pct(e.ev))}<span>EV</span></div></div>
    ${ruler(e.imp, e.fair, esc(bn(e.k)))}
    <div class="e-stats"><div><div class="ov">${esc(bn(e.k))} price</div><b>${lv('edge|' + e.scope + '|p', e.price, fa(e.price))}</b></div><div><div class="ov">Fair price</div><b style="color:var(--good-ink)">${lv('edge|' + e.scope + '|f', toAm(e.fair), fa(toAm(e.fair)))}</b></div>
      <div><div class="ov">Gap</div><b class="${e.fair > e.imp ? 'mv up' : 'mv dn'}">${e.fair > e.imp ? '+' : ''}${((e.fair - e.imp) * 100).toFixed(1)} pts</b></div></div>
    ${e.on && e.since ? `<div class="e-held"><i class="ld"></i><span>Passing for <b>${agoT(e.since)}</b> · since its last input changed at ${etd(e.since)}</span></div>` : ''}
    ${e.refs && e.refs.length ? `<div class="evl"><div class="glh" style="margin-top:0"><b>Evidence</b><span class="age">checked</span></div>${e.refs.map(r => `<div class="evr">${logo(r[0], 16)}<span>${r[1]}</span><span class="age">${r[2] != null ? agoS(r[2]) + ' ago' : ''}</span></div>`).join('')}</div>` : ''}
    ${e.why ? `<div class="small soft" style="margin-top:8px">${e.why}</div>` : ''}
    ${gates(e.gates)}
    ${e.on ? '<div class="age" style="margin-top:8px">Logged to the edge log · hidden the moment any gate fails · kill switch hides the card</div>' : ''}
  </div></section>`;
}
/** The honest empty state, or the no-sharp state, for any market. */
function edgeEmpty(m, sp, L, labels, scope) {
  const lab = labels || ['Over', 'Under'];
  const p = sp.noLine ? (() => { const a = m.cur.find(c => c[0] === 'pinnacle' && c[1] === sp.sides[0] && c[7] === 'main'), b = m.cur.find(c => c[0] === 'pinnacle' && c[1] === sp.sides[1] && c[7] === 'main'); return a && b ? { a, b, fa: devig(a[3], b[3]) } : null; })() : pinAt(m, sp, L);
  if (!p) {
    const pm = pinMain(m, sp);
    return { nosharp: true, scope, goto: pm, gotoTxt: sp.signed ? fl(pm, true) : fln(pm),
      why: pm != null ? `Pinnacle prices ${sp.signed ? fl(pm, true) : fln(pm)}, not ${sp.signed ? fl(L, true) : fln(L)}. Edge is only ever measured at the sharp book's own line.` : 'Pinnacle does not price this market, so nothing can pass gate 1.',
      gates: [['Sharp two-sided at this line', false]] };
  }
  const rows = boardRows(m, sp, L).filter(r => !['sharp', 'exchange', 'pickem'].includes(r.g));
  const b0 = bestOf(rows, 0), b1 = bestOf(rows, 1);
  const e0 = b0 ? p.fa * dec(b0.q[3]) - 1 : -9, e1 = b1 ? (1 - p.fa) * dec(b1.q[3]) - 1 : -9;
  const side = e0 >= e1 ? 0 : 1, b = side ? b1 : b0;
  if (!b) return { nosharp: true, scope, why: 'No soft book prices this line.', gates: [['A soft price at this line', false]] };
  const lbl = sp.noLine ? lab[side] : sp.signed ? `${lab[side]} ${fl(side ? -L : L, true)}` : `${lab[side]} ${fln(L)}`;
  return { on: false, scope, k: b.k, title: `Best soft price: ${lbl} ${fa(b.q[3])}`, price: b.q[3], imp: ip(b.q[3]), fair: side ? 1 - p.fa : p.fa, ev: side ? e1 : e0,
    refs: [['pinnacle', `Pinnacle ${fa(p.a[3])} / ${fa(p.b[3])}`, p.a[6]]],
    why: 'No soft book beats the no-vig price on either side.', gates: [['Sharp two-sided', true], ['Soft price beats fair', false]] };
}

/* O-A price board */
function boardCard(m, sp, L, labels, rows, opts) {
  const lab = labels || ['Over', 'Under'];
  const b0 = bestOf(rows, 0), b1 = bestOf(rows, 1);
  const lead = {};  // latency badge (EXAMPLE): delay behind Pinnacle on a move Pinnacle led
  for (const c of m.steam || []) if (c.books[0] === 'pinnacle') c.books.forEach((k, i) => { if (i) lead[k] = Math.round((tms(c.times[i]) - tms(c.times[0])) / 60000); });
  const pulled = Object.keys(m.hist).filter(k => !rows.find(r => r.k === k));
  const collapsed = opts.collapse || {};
  const ctx = S.surf === 'player' ? S.pm : S.gper + S.gmk;
  let html = '', grp = null, hidden = {};
  const cell = (r, q, i) => {
    if (!q) return `<span class="px na">—</span>`;
    if (noPrice(r.k, q)) return `<span class="px na" title="Pick'em line, no price">line</span>`;
    const best = r.at && ((i === 0 && b0 && b0.k === r.k) || (i === 1 && b1 && b1.k === r.k));
    if (r['out' + i]) return `<span class="st warn" title="Far from every other book: probably a different market relayed under this name (edge gate 8). Kept, never used as best.">⚠ check</span> <span class="px" style="min-width:0;color:var(--ink3)">${fa(q[3])}</span>`;
    return `${lv(`b|${ctx}|${L}|${r.k}|${i}`, q[3], fa(q[3]), 'px' + (best ? ' best' : ''))}${r.at || sp.noLine ? '' : `<span class="lt">${fl(i === 0 || !sp.signed ? r.line : -r.line, sp.signed)}</span>`}`;
  };
  for (const r of rows) {
    if (collapsed[r.g] && r.k !== USER_BOOK) { hidden[r.g] = (hidden[r.g] || 0) + 1; continue; }
    if (r.g !== grp) { grp = r.g; html += `<tr class="grp"><td colspan="6">${GROUPS[GORD[grp]][1]}</td></tr>`; }
    const mv = (() => {
      if (!r.op) return '<span class="muted">—</span>';
      if (sp.noLine) { const d = Math.round((dec(r.qa ? r.qa[3] : 0) - dec(r.op[2])) * 100); return r.qa ? (d ? `<span class="mv ${d > 0 ? 'up' : 'dn'}">${fa(r.op[2])} → ${fa(r.qa[3])}</span>` : '<span class="muted">unchanged</span>') : '—'; }
      const d = (r.mainLine ?? r.line) - r.op[1];
      return d ? `<span class="mv">${fl(r.op[1], sp.signed)} → ${fl(r.mainLine ?? r.line, sp.signed)}</span>` : '<span class="muted">opened here</span>';
    })();
    const pick = r.g === 'pickem';
    const x = r.x || {};
    let extra = '';
    if (x.yes_bid != null) extra = `<div class="age">bid ${Math.round(x.yes_bid * 100)}¢ · ask ${Math.round(x.yes_ask * 100)}¢${x.volume_24h ? ' · ' + money(x.volume_24h) + ' 24h' : ''}</div>`;
    else if (x.bid != null) extra = `<div class="age">bid ${Math.round(x.bid * 100)}¢ · ask ${Math.round(x.ask * 100)}¢</div>`;
    if (pick && opts.picks && opts.picks[r.k]) extra = `<div class="age">${opts.picks[r.k]}</div>`;
    if (pick && r.k === 'underdog' && x.mult) extra = `<div class="age">payout-implied price${x.mult !== 1 ? ' · ×' + x.mult : ''}</div>`;
    if (pick && r.k === 'prizepicks') extra = `<div class="age">line only — PrizePicks posts no price (via comparenbet)</div>`;
    const lat = lead[r.k] != null ? `<span class="age" title="EXAMPLE, T0 method: minutes behind Pinnacle on the last move Pinnacle led">⏱ follows Pinnacle by ~${lead[r.k]} min</span>` : '';
    const stale = r.since && secs(r.since) > 12 * 3600;
    html += `<tr class="${r.k === USER_BOOK ? 'me' : ''} ${r.at || sp.noLine ? '' : 'dim'}" data-row="${S.surf}|br|${ctx}|${r.k}" data-st="on"><td><div>${book(r.k)}</div>${extra}${lat ? `<div style="margin-top:1px">${lat}</div>` : ''}</td>
      <td class="r">${cell(r, r.qa, 0)}</td><td class="r">${cell(r, r.qb, 1)}</td>
      <td class="hide-ph">${mv}</td>
      <td class="r" style="white-space:nowrap"><span class="age">${r.age < 9e9 ? agoS(r.age) : '—'}</span> <span class="age hide-ph ${stale ? 'stale' : ''}">· since ${etd(r.since)}</span></td></tr>`;
  }
  for (const k of pulled) {
    const h = m.hist[k], last = h[h.length - 1];
    html += `<tr class="pulled" data-row="${S.surf}|br|${ctx}|${k}" data-st="pulled"><td>${book(k)} <span class="st bad">Pulled</span></td><td class="r"><span class="px">${fa(last[2])}</span></td><td class="r"><span class="px">${fa(last[3])}</span></td><td class="hide-ph muted">last at ${fl(last[1], sp.signed)}</td><td class="r age">${PULLED[`${S.surf}|br|${ctx}|${k}`] ? `pulled ${tick$(PULLED[`${S.surf}|br|${ctx}|${k}`])} ago` : 'last seen ' + etd(last[0])}</td></tr>`;
  }
  const more = Object.entries(hidden).map(([g, n]) => `<button class="btn" data-expand="${g}">+ ${n} ${GROUPS[GORD[g]][1].toLowerCase()} books</button>`).join(' ');
  return `<div class="scrollx"><table class="t board"><thead><tr><th>Book</th><th class="r">${lab[0]}</th><th class="r">${lab[1]}</th><th class="hide-ph">Open → now</th><th class="r">Checked</th></tr></thead><tbody>${html}</tbody></table></div>
    ${more ? `<div style="padding:10px 14px;border-top:1px solid var(--line-soft);display:flex;gap:6px;flex-wrap:wrap">${more}</div>` : ''}`;
}

/* O-G alternate-line ladder */
function ladderCard(m, sp, span, labels, curL) {
  const lab = labels || ['Over', 'Under'];
  const lines = allLines(m, sp, span);
  const books = [...new Set(m.cur.filter(c => c[2] != null && lines.includes(c[1] === sp.sides[0] ? c[2] : -c[2])).map(c => c[0]))].filter(k => bg(k) !== 'pickem')
    .sort((a, b) => GORD[bg(a)] - GORD[bg(b)] || bn(a).localeCompare(bn(b)));
  const get = (k, side, L) => m.cur.find(c => c[0] === k && c[1] === sp.sides[side] && atLine(sp, c, sp.sides[side], L));
  let h = `<div class="scrollx"><table class="t" style="font-size:12px"><thead><tr><th>Line</th><th class="r">Pinnacle fair</th>${books.map(k => `<th class="c" title="${esc(bn(k))}">${logo(k, 14)}<div style="font-size:10px;font-weight:500;max-width:62px;overflow:hidden;text-overflow:ellipsis">${esc(bn(k))}</div></th>`).join('')}</tr></thead><tbody>`;
  for (const L of lines) {
    const p = pinAt(m, sp, L);
    const best = [0, 1].map(s => { let b = null; for (const k of books) { const q = get(k, s, L); if (q && (!b || dec(q[3]) > dec(b[3]))) b = q; } return b; });
    h += `<tr style="${L === curL ? 'background:color-mix(in oklab,#fff6d6 60%,var(--card))' : ''}"><td><b>${fl(L, sp.signed)}</b></td><td class="r">${p ? pct(p.fa) : '<span class="muted">—</span>'}</td>`;
    for (const k of books) {
      const a = get(k, 0, L), b = get(k, 1, L);
      h += `<td class="c" style="line-height:1.25">${a || b ? `<div class="${a && best[0] === a ? 'px best' : ''}" style="font-weight:600">${a ? fa(a[3]) : '·'}</div><div class="${b && best[1] === b ? 'px best' : ''}" style="color:var(--ink3)">${b ? fa(b[3]) : '·'}</div>` : '<span style="color:var(--faint)">·</span>'}</td>`;
    }
    h += '</tr>';
  }
  h += `</tbody></table></div><div class="age" style="padding:8px 14px">Each cell: ${lab[0].toLowerCase()} on top, ${lab[1].toLowerCase()} below · filled = best at that line · ${books.length} books · ${lines.length} lines</div>`;
  return h;
}

/* O-D line movement with book picker */
function moveCard(m, sp, id, labels) {
  const lab = labels || ['Over', 'Under'];
  const books = Object.keys(m.hist).sort((a, b) => GORD[bg(a)] - GORD[bg(b)] || bn(a).localeCompare(bn(b)));
  const winStart = { '2h': 2, '6h': 6, '12h': 12, '48h': 48 }[S.win];
  const t0 = winStart ? new Date(NOW - winStart * 3600e3) : new Date(Math.min(...books.map(k => tms(m.hist[k][0][0]))));
  const inWin = (k) => m.hist[k].filter(p => tms(p[0]) >= t0);
  const cnt = k => { const h = m.hist[k]; let n = 0; for (let i = 1; i < h.length; i++) if (tms(h[i][0]) >= t0) n++; return n; };
  if (!S.sel || !S.sel.every(k => books.includes(k))) {
    const top = books.filter(k => k !== 'pinnacle' && bg(k) !== 'pickem').sort((a, b) => cnt(b) - cnt(a)).slice(0, 3);
    S.sel = [...(books.includes('pinnacle') ? ['pinnacle'] : []), ...(books.includes(USER_BOOK) ? [USER_BOOK] : []), ...top.filter(k => k !== USER_BOOK)].slice(0, 5);
  }
  const col = {}; let ci = 0;
  for (const k of books) col[k] = k === 'pinnacle' ? '#1d1f23' : PAL[ci++ % PAL.length];
  const lineMoves = S.sel.some(k => { const h = inWin(k); return h.some((p, i) => i && p[1] !== h[i - 1][1]); });
  const metric = S.metric || (sp.noLine || !lineMoves ? 'price' : 'line');
  const shown = S.allChips ? books : books.filter(k => !['intl', 'offshore'].includes(bg(k)) || S.sel.includes(k));
  const chips = shown.map(k => `<button class="pk" data-bk="${k}" aria-pressed="${S.sel.includes(k)}"><span class="sw" style="background:${S.sel.includes(k) ? col[k] : 'transparent'}"></span>${esc(bn(k))} <span class="ct">${cnt(k)}</span></button>`).join('');
  const steams = (m.steam || []).filter(c => tms(c.t) >= t0);
  let mvList = (m.moves || []).filter(x => tms(x[0]) >= t0).slice(-40).reverse();
  if (sp.noLine) {  // moneylines move in price: list each 5-cent change on the selected books
    mvList = [];
    for (const k of S.sel) { const h = m.hist[k] || []; for (let i = 1; i < h.length; i++) if (tms(h[i][0]) >= t0 && Math.abs(dec(h[i][2]) - dec(h[i - 1][2])) >= 0.05) mvList.push([h[i][0], k, h[i - 1][2], h[i][2]]); }
    mvList = mvList.sort((a, b) => b[0].localeCompare(a[0])).slice(0, 40);
  }
  const starters = new Set(steams.map(c => c.t + c.books[0]));
  const newest = Math.min(...m.cur.map(c => c[6]).filter(v => v != null));
  const just = t => +NOW - tsm(t) < 120e3 ? '<span class="just">just now</span>' : '';
  return `<section class="card">${cardH('Line movement', `${lab[0]} · ${metric === 'line' ? 'the line' : 'implied probability, ' + lab[0]}`, isFinite(newest) && id !== 'f' ? liveTag(atS(newest), 70) : id === 'f' ? '<span class="upd"><i class="ld off"></i><span>closed</span></span>' : '')}
    <div class="cb" style="padding-bottom:6px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <div class="seg">${['2h', '6h', '12h', '48h', 'open'].map(w => `<button data-win="${w}" aria-pressed="${S.win === w}">${w === 'open' ? 'Since open' : w}</button>`).join('')}</div>
        ${sp.noLine ? '' : `<div class="seg"><button data-metric="line" aria-pressed="${metric === 'line'}">Line</button><button data-metric="price" aria-pressed="${metric === 'price'}">Price</button></div>`}
        <div class="seg"><button data-preset="sharp">Sharp</button><button data-preset="mine">My book</button><button data-preset="most">Most moves</button><button data-preset="all">All</button><button data-preset="none">Clear</button></div>
      </div>
      <div class="picker">${chips}${books.length > shown.length ? `<button class="pk" data-allchips="1">+ ${books.length - shown.length} offshore &amp; international</button>` : S.allChips ? '<button class="pk" data-allchips="0">fewer books</button>' : ''}</div>
      <div class="chart" data-chart="${id}" data-metric="${metric}" data-keep="1" style="height:250px;position:relative"></div>
      ${steams.length ? `<div style="margin-top:6px;display:flex;flex-direction:column;gap:4px">${steams.slice(-3).reverse().map(c => {
        const mins = Math.round((tms(c.times[c.times.length - 1]) - tms(c.times[0])) / 60000);
        return `<div class="small" data-row="${S.surf}|fm|${id}|${c.t}|${c.books[0]}"><b>First mover:</b> <b>${esc(bn(c.books[0]))}</b> moved ${fl(c.from, sp.signed)} → ${fl(c.to[0], sp.signed)} at ${etd(c.t)}; ${c.books.length - 1} book${c.books.length > 2 ? 's' : ''} followed within ${mins} min <span class="muted">(${c.books.slice(1).map(bn).join(', ')})</span>${just(c.times[c.times.length - 1])}</div>`;
      }).join('')}</div>` : ''}
      <details style="margin-top:8px"><summary class="small soft" style="cursor:pointer">Every move in this window (${mvList.length} ${sp.noLine ? 'price changes of 5¢+ on the selected books' : 'line changes'})</summary>
        <table class="t" style="margin-top:6px"><thead><tr><th>Time</th><th>Book</th><th>From → to</th><th></th></tr></thead><tbody>
        ${mvList.map(x => `<tr data-row="${S.surf}|mv|${id}|${x[0]}|${x[1]}|${x[3]}"><td class="age">${etd(x[0])}${just(x[0])}</td><td>${book(x[1], 14)}</td><td>${sp.noLine ? `${fa(x[2])} → <b>${fa(x[3])}</b>` : `${fl(x[2], sp.signed)} → <b>${fl(x[3], sp.signed)}</b>`}</td><td>${starters.has(x[0] + x[1]) ? '<span class="st ink">First mover</span>' : ''}</td></tr>`).join('')}
        </tbody></table></details>
    </div></section>`;
}
const CHARTS = {};
function drawChart(el) {
  const { m, sp } = CHARTS[el.dataset.chart]; const metric = el.dataset.metric;
  const W = el.clientWidth || 600, H = el.clientHeight || 250, pl = 44, pr = 10, pt = 10, pb = 26;
  const books = Object.keys(m.hist);
  const winStart = { '2h': 2, '6h': 6, '12h': 12, '48h': 48 }[S.win];
  const t0 = winStart ? +NOW - winStart * 3600e3 : Math.min(...books.map(k => +tms(m.hist[k][0][0])));
  const t1 = +NOW;
  const val = p => metric === 'line' ? p[1] : ip(p[2]) * 100;
  const col = {}; let ci = 0;
  for (const k of books.sort((a, b) => GORD[bg(a)] - GORD[bg(b)] || bn(a).localeCompare(bn(b)))) col[k] = k === 'pinnacle' ? '#1d1f23' : PAL[ci++ % PAL.length];
  const series = S.sel.filter(k => m.hist[k]).map(k => {
    const h = m.hist[k]; const pts = [];
    let before = null;
    for (const p of h) { if (+tms(p[0]) < t0) before = p; else pts.push(p); }
    if (before) pts.unshift([new Date(t0).toISOString().slice(0, 16).replace('T', ' '), ...before.slice(1)]);
    return { k, pts };
  }).filter(s => s.pts.length);
  let vs = series.flatMap(s => s.pts.map(val)).filter(v => v != null && isFinite(v));
  if (!vs.length) { el.innerHTML = '<div class="small muted" style="padding:40px;text-align:center">Pick a book to draw its line.</div>'; return; }
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = metric === 'line' ? 0.5 : 1; lo -= pad; hi += pad;
  const X = t => pl + (W - pl - pr) * (t - t0) / Math.max(1, t1 - t0);
  const Y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  let g = '';
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const v = lo + (hi - lo) * i / ticks;
    g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="oklch(92.5% .003 260)"/><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end" font-size="10" fill="oklch(47% .005 260)">${metric === 'line' ? fl(v, sp.signed) : v.toFixed(0) + '%'}</text>`;
  }
  const nt = W < 420 ? 3 : 6;
  for (let i = 0; i <= nt; i++) {
    const t = t0 + (t1 - t0) * i / nt;
    const lab = new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: (t1 - t0) > 20 * 3600e3 ? 'short' : undefined, hour: 'numeric', minute: (t1 - t0) < 20 * 3600e3 ? '2-digit' : undefined });
    g += `<text x="${X(t)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === nt ? 'end' : 'middle'}" font-size="10" fill="oklch(47% .005 260)">${lab}</text>`;
  }
  // first-mover markers
  let lastLbl = 1e9;
  for (const c of (m.steam || []).filter(c => +tms(c.t) >= t0).slice(-4).reverse()) {
    const t = +tms(c.t); const room = lastLbl - X(t) > 110; if (room) lastLbl = X(t);
    g += `<line x1="${X(t)}" x2="${X(t)}" y1="${pt}" y2="${H - pb}" stroke="#00873f" stroke-dasharray="3 3"/><circle cx="${X(t)}" cy="${pt + 4}" r="4" fill="#00d26a" stroke="#04311a"/>${room ? `<text x="${X(t) - 6}" y="${pt + 8}" text-anchor="end" font-size="10" fill="#04311a" font-weight="600">${esc(bn(c.books[0]))} first</text>` : ''}`;
  }
  // the live edge: a "now" guide at the right; each series' newest point pulses, a point that just arrived pops in
  const liveC = el.dataset.chart !== 'f';   // a finished game's chart is history, not live
  if (liveC) g += `<line x1="${X(t1)}" x2="${X(t1)}" y1="${pt}" y2="${H - pb}" stroke="oklch(72% .004 260)" stroke-dasharray="2 3"/><text x="${X(t1) - 4}" y="${H - pb - 4}" text-anchor="end" font-size="10" fill="oklch(47% .005 260)">now</text>`;
  for (const s of series) {
    let d = '';
    s.pts.forEach((p, i) => { const x = X(+tms(p[0])), y = Y(val(p)); d += i ? `H${x.toFixed(1)}V${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`; });
    const last = s.pts[s.pts.length - 1];
    d += `H${X(t1).toFixed(1)}`;
    const wgt = s.k === 'pinnacle' ? 2.6 : 1.6;
    g += `<path d="${d}" fill="none" stroke="${col[s.k]}" stroke-width="${wgt}" stroke-linejoin="round"/>`;
    const op = s.pts[0];
    g += `<circle cx="${X(+tms(op[0]))}" cy="${Y(val(op))}" r="2.5" fill="${col[s.k]}"/>`;
    const nk = el.dataset.chart + '|' + s.k, n = m.hist[s.k].length, grew = CHART_N[nk] != null && n > CHART_N[nk] && LIVE_RENDER;
    CHART_N[nk] = n;
    const lx = X(+tms(last[0])), ly = Y(val(last));
    if (grew && +tms(last[0]) >= t0) g += `<circle class="svpop" cx="${lx}" cy="${ly}" r="5" fill="${col[s.k]}" opacity=".9"/>`;
    if (liveC) g += `<circle class="svp" cx="${X(t1)}" cy="${Y(val(last))}" r="3.5" fill="${col[s.k]}" opacity=".35"/>`;
    g += `<circle cx="${X(t1)}" cy="${Y(val(last))}" r="3.5" fill="#fff" stroke="${col[s.k]}" stroke-width="2"><title>${esc(bn(s.k))}: ${metric === 'line' ? fl(last[1], sp.signed) + ' ' : ''}${fa(last[2])} / ${fa(last[3])}</title></circle>`;
  }
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Line movement">${g}</svg>`;
}

/* O-E where the money is */
const bar2 = (a, b, la, lb, cA = 'var(--cmp-a)', cB = 'var(--cmp-b)') => `<div class="b2" style="display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--line-soft);margin:4px 0;gap:2px"><i style="width:${a}%;background:${cA}"></i><i style="width:${b}%;background:${cB}"></i></div><div class="age bl2" style="display:flex;justify-content:space-between;align-items:center"><span>${la}</span><span>${lb}</span></div>`;
function moneyGame(mk, sp, labels, colors) {
  const lab = labels, cA = colors ? colors[0] : 'var(--cmp-a)', cB = colors ? colors[1] : 'var(--cmp-b)';
  const tl = i => mk === 'tot' ? '' : `<img class="tlogo" src="${i ? TEAM.away.logo : TEAM.home.logo}" alt="">`;
  const Sx = O.nfl.splits;
  const get = (src, book, side) => Sx.find(s => s[1] === src && s[3] === book && s[4] === mk && s[5] === side);
  const rows = [];
  const add = (name, src, book, note2) => {
    const a = get(src, book, sp.sides[0]), b = get(src, book, sp.sides[1]);
    if (!a || !b) return;
    const split = a[8] != null && a[7] != null && Math.abs(a[8] - a[7]) >= 15;
    const k2 = `mo|${mk}|${src}|${book}`;
    rows.push(`<div style="padding:8px 0;border-bottom:1px solid var(--line-soft)"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><b class="small">${name}</b><span class="age">${note2} · ${agoT(a[0])} ago</span></div>
      <div class="grid2" style="gap:12px;margin-top:2px"><div><div class="age">Money</div>${a[8] != null ? bar2(a[8], b[8], tl(0) + lab[0] + ' <b>' + lv(k2 + '|m', a[8], a[8] + '%') + '</b>', '<b>' + b[8] + '%</b> ' + lab[1] + tl(1), cA, cB) : '<div class="age">not published</div>'}</div>
      <div><div class="age">Bets</div>${bar2(a[7], b[7], tl(0) + lab[0] + ' <b>' + lv(k2 + '|b', a[7], a[7] + '%') + '</b>', '<b>' + b[7] + '%</b> ' + lab[1] + tl(1), cA, cB)}</div></div>
      ${split ? `<div class="small" style="margin-top:4px"><span class="st warn">Money and bets split:</span> ${a[8] > a[7] ? lab[0] : lab[1]} draws ${Math.abs(a[8] - a[7])} pts more of the money than of the bets</div>` : ''}</div>`);
  };
  add('DraftKings customers', 'dknetwork', 'draftkings', 'DK Network');
  if (!get('dknetwork', 'draftkings', sp.sides[0])) add('DraftKings customers', 'vsin', 'draftkings', 'VSiN');
  add('Circa customers', 'vsin', 'circa', 'VSiN');
  add('ScoresAndOdds consensus', 'sao_consensus', 'scoresandodds', 'source does not say whose bets');
  const cv = Sx.filter(s => s[1] === 'covers' && s[4] === mk);
  if (cv.length === 2) { const a = cv.find(s => s[5] === sp.sides[0]), b = cv.find(s => s[5] === sp.sides[1]); if (a && b) rows.push(`<div style="padding:8px 0;border-bottom:1px solid var(--line-soft)"><div style="display:flex;justify-content:space-between"><b class="small">Covers contest picks</b><span class="age">picks, not money · ${nfmt(a[9] + b[9])} picks</span></div>${bar2(a[7], b[7], tl(0) + lab[0] + ' <b>' + a[7] + '%</b>', '<b>' + b[7] + '%</b> ' + lab[1] + tl(1), cA, cB)}</div>`); }
  const an = Sx.find(s => s[1] === 'actionnetwork' && s[2] === 'bet_count');
  if (an) rows.push(`<div style="padding:8px 0;border-bottom:1px solid var(--line-soft)" class="small"><b>Action Network</b> <span class="muted">· ${nfmt(an[9])} tracked bets on this game (all markets) · not split by side</span></div>`);
  const kml = O.nfl.markets.fg_ml.cur.find(c => c[0] === 'kalshi' && c[5] === 'kalshi' && (c[8] || {}).volume_24h);
  const pml = O.nfl.markets.fg_ml.cur.find(c => c[0] === 'polymarket' && (c[8] || {}).volume_24h);
  rows.push(`<div style="padding:8px 0" class="small"><b>Exchanges</b> <span class="muted">· traded, not bets</span><div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:4px">${kml ? `<span>${logo('kalshi', 14)} Kalshi moneyline <b>${money(kml[8].volume_24h)}</b> 24h · ${money(kml[8].open_interest)} open interest</span>` : ''}${pml ? `<span>${logo('polymarket', 14)} Polymarket <b>${money(pml[8].volume_24h)}</b> 24h · ${money(pml[8].liquidity)} liquidity</span>` : ''}</div></div>`);
  // DK money trend
  const hk = `dknetwork|draftkings|${mk}`, h = (O.nfl.splitHist[hk] || []).filter(p => p[3] != null);
  let spark = '';
  if (h.length > 3) {
    const W = 260, H = 40, t0 = +tms(h[0][0]), t1 = +tms(h[h.length - 1][0]);
    const d = h.map((p, i) => `${i ? 'L' : 'M'}${(W * (+tms(p[0]) - t0) / Math.max(1, t1 - t0)).toFixed(1)},${(H - H * p[3] / 100).toFixed(1)}`).join('');
    spark = `<div style="margin-top:6px"><div class="age">DraftKings money on ${lab[0]}: ${h[0][3]}% (${etd(h[0][0])}) → ${h[h.length - 1][3]}% now</div><svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="oklch(89% .004 260)" stroke-dasharray="2 3"/><path d="${d}" fill="none" stroke="#2f6fb3" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg></div>`;
  }
  return `<section class="card">${cardH('Where the money is', 'each row names whose customers', liveTag(srcChecked('dknetwork'), 480))}<div class="cb" style="padding-top:4px">${rows.join('')}${spark}
    <div class="age" style="margin-top:6px">Never called "the public" or "sharp money"; never presented as total handle.</div></div></section>`;
}
function moneyProp(mkKey, m) {
  const slKey = (PROPS.find(p => p[0] === mkKey) || [])[2];
  const sl = O.nfl.propSplits.filter(s => s[4] === slKey);
  const ov = sl.find(s => s[5] === 'over'), un = sl.find(s => s[5] === 'under');
  const kal = m.cur.filter(c => c[0] === 'kalshi' && c[5] === 'kalshi' && c[1] === 'over' && (c[8] || {}).volume_24h != null).sort((a, b) => a[2] - b[2]);
  let h = '';
  if (ov && un) {
    const tot = ov[9] + un[9], po = Math.round(100 * ov[9] / tot);
    h += `<div style="padding:4px 0 10px;border-bottom:1px solid var(--line-soft)"><div style="display:flex;justify-content:space-between"><b class="small">${logo('sleeper', 14)} Sleeper pick counts at ${fln(ov[6])}</b><span class="age">${agoT(ov[0])} ago</span></div>
      ${bar2(po, 100 - po, `Over ${nfmt(ov[9])} (${po}%)`, `${nfmt(un[9])} (${100 - po}%) Under`, 'var(--good)', 'var(--line)')}<div class="age">Entries in Sleeper's pick'em — counts, not money</div></div>`;
  } else h += `<div class="small muted" style="padding:6px 0 10px;border-bottom:1px solid var(--line-soft)">Sleeper pick counts: no data available for this market.</div>`;
  if (kal.length) {
    h += `<div style="padding:8px 0;border-bottom:1px solid var(--line-soft)"><b class="small">${logo('kalshi', 14)} Kalshi contracts</b> <span class="age">traded on Kalshi's own markets</span>
      <table class="t" style="margin-top:4px"><thead><tr><th>Contract</th><th class="r">Yes</th><th class="r">24h volume</th><th class="r">Open interest</th></tr></thead><tbody>
      ${kal.slice(0, 6).map(c => `<tr><td>${Math.ceil(c[2])}+</td><td class="r">${Math.round(c[8].yes_bid * 100)}–${Math.round(c[8].yes_ask * 100)}¢</td><td class="r">${money(c[8].volume_24h)}</td><td class="r">${money(c[8].open_interest)}</td></tr>`).join('')}</tbody></table></div>`;
  } else h += `<div class="small muted" style="padding:8px 0;border-bottom:1px solid var(--line-soft)">Kalshi volume: no Kalshi contract for this market.</div>`;
  h += `<div class="small" style="padding:8px 0"><b>Money % / bets %</b> <span class="muted">— No data available. No source publishes money or bet share for player props.</span></div>`;
  return `<section class="card">${cardH('Where the money is', 'props: pick counts + exchange volume', liveTag(srcChecked('sleeper'), 900))}<div class="cb" style="padding-top:6px">${h}</div></section>`;
}

/* O-F opening → now */
function openCard(m, sp, labels, title) {
  const rows = Object.entries(m.open).filter(([k]) => bg(k) !== 'pickem').sort((a, b) => a[1][0].localeCompare(b[1][0])).slice(0, 14);
  const cur = k => m.cur.find(c => c[0] === k && c[1] === sp.sides[0] && c[7] === 'main');
  const opens = rows.map(r => r[1][1]).filter(v => v != null), nows = rows.map(r => (cur(r[0]) || [])[2]).filter(v => v != null);
  const rng = a => a.length ? (Math.min(...a) === Math.max(...a) ? fl(a[0], sp.signed) : `${fl(Math.min(...a), sp.signed)}–${fl(Math.max(...a), sp.signed)}`) : '—';
  const st = (m.steam || []).slice(-1)[0];
  const sum = sp.noLine ? '' : `<div class="small soft" style="margin-bottom:8px">Opened <b>${rng(opens)}</b> (first seen ${etd(rows[0][1][0])}) → now <b>${rng(nows)}</b>.${st ? ` Latest move led by <b>${esc(bn(st.books[0]))}</b> at ${etd(st.t)}, ${st.books.length - 1} followed.` : ''}</div>`;
  return `<section class="card">${cardH(title || 'Opening → now', 'first seen per book')}<div class="cb">${sum}
    <table class="t"><thead><tr><th>Book</th><th class="hide-ph">Opened</th><th class="r">Open</th><th class="r">Now</th></tr></thead><tbody>
    ${rows.map(([k, o]) => { const c = cur(k); const cb = c && m.cur.find(x => x[0] === k && x[1] === sp.sides[1] && x[7] === 'main');
      return `<tr><td>${book(k, 14)}</td><td class="age hide-ph">${etd(o[0])}</td><td class="r">${sp.noLine ? '' : fl(o[1], sp.signed) + ' '}<span class="muted">${fa(o[2])}/${fa(o[3])}</span></td><td class="r">${c ? `${sp.noLine ? '' : '<b>' + fl(c[2], sp.signed) + '</b> '}<span class="muted">${fa(c[3])}/${fa(cb && cb[3])}</span>` : '<span class="muted">—</span>'}</td></tr>`; }).join('')}
    </tbody></table><div class="age" style="margin-top:6px">"Opened" = the first price any source recorded for that book (scraper history starts Sep 22). VSiN's own opener rows are used for Nevada books on the game page.</div></div></section>`;
}

/* O-H depth + exchange order book */
function depthCard(m, sp, L, labels) {
  const pin = pinAt(m, sp, L) || null;
  const lim = pin ? (pin.a[8] || {}).limit : (m.cur.find(c => c[0] === 'pinnacle' && c[7] === 'main' && (c[8] || {}).limit) || [0, 0, 0, 0, 0, 0, 0, 0, {}])[8].limit;
  const lad = m.cur.filter(c => (c[8] || {}).yes_bids && c[1] === sp.sides[0] && c[2] != null).sort((a, b) => Math.abs(a[2] - L) - Math.abs(b[2] - L))[0]
    || m.cur.filter(c => (c[8] || {}).bids && c[1] === sp.sides[0]).sort((a, b) => Math.abs((a[2] || 0) - L) - Math.abs((b[2] || 0) - L))[0];
  const n = new Set(m.cur.map(c => c[0])).size;
  let ob = '<div class="small muted">No exchange ladder stored for this market yet (depth is stored from Sep 24, 12:45 PM ET, on the next change of each contract).</div>';
  if (lad) {
    const x = lad[8]; const kal = !!x.yes_bids;
    const bids = kal ? x.yes_bids : x.bids, asks = kal ? (x.no_bids || []).map(([p, s]) => [+(1 - p).toFixed(2), s]) : x.asks || [];
    const mx = Math.max(...bids.concat(asks).map(l => l[1]));
    const lv = (l, c) => `<div class="lv"><b class="px" style="min-width:0;text-align:left">${Math.round(l[0] * 100)}¢</b><div class="b" style="width:${Math.max(3, 100 * Math.sqrt(l[1] / mx))}%;background:${c}"></div><span class="r age">${money(l[1] * (kal ? 1 : l[0]))}</span></div>`;
    const name = kal ? `Kalshi · ${sp.signed ? (lad[1] === 'home' ? TEAM.home.abbr : TEAM.away.abbr) + ' ' + fl(lad[2], true) : Math.ceil(lad[2]) + '+'} contract` : `Polymarket · ${fl(lad[2], sp.signed)}`;
    ob = `<div class="lbl" style="margin-bottom:6px">${logo(kal ? 'kalshi' : 'polymarket', 14)} ${name} <span class="age">· price since ${etd(lad[4])}</span></div>
      <div class="ob"><div><div class="ov" style="margin-bottom:2px">Bids (buy yes)</div>${bids.slice(0, 8).map(l => lv(l, 'var(--good)')).join('')}</div>
      <div><div class="ov" style="margin-bottom:2px">Asks (sell yes)</div>${asks.slice(0, 8).map(l => lv(l, 'var(--bad)')).join('')}</div></div>
      <div class="age" style="margin-top:6px">${x.volume_24h != null ? money(x.volume_24h) + ' traded 24h · ' : ''}${x.open_interest != null ? money(x.open_interest) + ' open interest · ' : ''}${x.liquidity != null ? money(x.liquidity) + ' liquidity · ' : ''}top ${bids.length} levels stored</div>`;
  }
  return `<section class="card">${cardH('Depth, limits & order book', 'confidence behind the prices', lad ? liveTag(srcChecked(lad[5] === 'kalshi' ? 'kalshi' : 'polymarket'), 70) : '')}<div class="cb">
    <div class="mstats" style="margin-bottom:12px">
      <div class="mstat"><div class="ov">Pinnacle limit</div><b>${logo('pinnacle', 14)}${lim ? '$' + nfmt(lim) : '—'}</b></div>
      <div class="mstat"><div class="ov">Books pricing it</div><b>${n}</b></div>
      ${lad ? `<div class="mstat"><div class="ov">${lad[5] === 'kalshi' ? 'Kalshi' : 'Polymarket'} spread</div><b>${Math.round(((lad[8].yes_ask ?? lad[8].ask) - (lad[8].yes_bid ?? lad[8].bid)) * 100)}¢</b></div>` : ''}
    </div>${ob}<div class="age" style="margin-top:6px">Bars slide to their new size when a level changes. This snapshot holds one stored ladder per contract, so the replay has no ladder changes to show.</div></div></section>`;
}

/* O-K coverage map */
function coverageCard(P) {
  const mk = PROPS.filter(p => P.markets[p[0]]);
  const gcols = ['sharp', 'exchange', 'us', 'offshore', 'pickem'];
  const rows = mk.map(p => {
    const m = P.markets[p[0]];
    const bks = [...new Set(m.cur.map(c => c[0]))];
    const lines = new Set(m.cur.map(c => c[2]).filter(v => v != null)).size;
    return { name: p[1], n: bks.length, lines, per: Object.fromEntries(gcols.map(g => [g, bks.filter(k => bg(k) === g)])) };
  });
  const unm = Object.entries(P.coverage).filter(([k]) => k.startsWith('~')).map(([k, srcs]) => [k.slice(1), srcs]);
  const heat = n => n === 0 ? 'background:var(--line-hair);color:var(--faint)' : n < 3 ? 'background:#e7f3ec;color:#0b5b2d' : n < 7 ? 'background:#a8e6c3;color:#04311a' : 'background:var(--good);color:var(--good-on)';
  return `<section class="card">${cardH('Coverage', 'every market any source prices for this player')}<div class="scrollx"><table class="t cov">
    <thead><tr><th>Market</th><th class="r">Books</th><th class="r hide-ph">Lines</th>${gcols.map(g => `<th class="c">${GROUPS[GORD[g]][1]}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${r.name}</b></td><td class="r">${r.n}</td><td class="r hide-ph">${r.lines}</td>${gcols.map(g => `<td class="cell"><span class="sq" style="${heat(r.per[g].length)}" title="${esc(r.per[g].map(bn).join(', '))}">${r.per[g].length}</span></td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    <div class="cb" style="border-top:1px solid var(--line-soft)"><div class="lbl">Priced by a source, not in the app yet <span class="muted">(D15 — ${unm.length} markets)</span></div>
    <div class="cols" style="margin-top:8px">${unm.slice(0, 40).map(([s, src]) => `<div title="${esc(src.join(', '))}"><span>${esc(s.replace(/^player_/, '').replace(/_/g, ' '))}</span><span>${src.length} source${src.length === 1 ? '' : 's'}</span></div>`).join('')}</div></div></section>`;
}

/* compact game-line card (player page + team page) */
function gameLineCompact(title) {
  const mk = [['fg_sp', spec('sp'), 'Spread'], ['fg_tot', spec('tot'), 'Total'], ['fg_ml', spec('ml'), 'Moneyline']];
  const AGES = [];
  const rowsH = mk.map(([k, sp, name]) => {
    const m = O.nfl.markets[k]; const L = sp.noLine ? null : mainLines(m, sp).modal;
    const rows = boardRows(m, sp, L); const b0 = bestOf(rows, 0), b1 = bestOf(rows, 1); const p = sp.noLine ? (() => { const a = m.cur.find(c => c[0] === 'pinnacle' && c[1] === 'home' && c[7] === 'main'), b = m.cur.find(c => c[0] === 'pinnacle' && c[1] === 'away' && c[7] === 'main'); return a && b ? { a, b, fa: devig(a[3], b[3]) } : null; })() : pinAt(m, sp, L);
    const sl = sp.kind === 'tot' ? ['O', 'U'] : [TEAM.home.abbr, TEAM.away.abbr];
    const ln = (i) => sp.noLine ? '' : sp.kind === 'tot' ? fln(L) + ' ' : fl(i ? -L : L, true) + ' ';
    AGES.push(...rows.filter(r => r.age < 9e9).map(r => r.age));
    return `<tr><td><b>${name}</b><div class="age">${rows.length} books</div></td>
      <td>${b0 ? `${sl[0]} ${ln(0)}<b class="px" style="min-width:0">${lv('gl|' + k + '|0', b0.q[3], fa(b0.q[3]))}</b> ${logo(b0.k, 14)}` : '—'}<br>${b1 ? `${sl[1]} ${ln(1)}<b class="px" style="min-width:0">${lv('gl|' + k + '|1', b1.q[3], fa(b1.q[3]))}</b> ${logo(b1.k, 14)}` : '—'}</td>
      <td class="hide-ph">${p ? `<span class="small">${lv('gl|' + k + '|pa', p.a[3], fa(p.a[3]))} / ${fa(p.b[3])}</span><div class="age">fair ${pct(p.fa)}</div>` : '<span class="muted small">—</span>'}</td></tr>`;
  }).join('');
  return `<section class="card">${cardH(title || 'Game line', `${TEAM.away.abbr} @ ${TEAM.home.abbr} · ${et(G.start)} ET`, AGES.length ? liveTag(atS(Math.min(...AGES)), 70) : '')}<table class="t"><thead><tr><th>Market</th><th>Best price</th><th class="hide-ph">Pinnacle</th></tr></thead><tbody>${rowsH}</tbody></table>
    <div class="cb" style="border-top:1px solid var(--line-soft);padding:8px 16px"><a href="#" data-go="game" class="small" style="color:var(--ink)">All game lines, movement and splits →</a></div></section>`;
}

// ------------------------------------------------------------------ edge states (gates applied by hand)
function propEdge(mkKey, m, sp, L) {
  const p = pinAt(m, sp, L);
  if (mkKey === 'receptions' && L === 5.5 && p) {
    const ud = m.cur.find(c => c[0] === 'underdog' && c[1] === 'over' && c[2] === 5.5);
    const nv = m.cur.find(c => c[0] === 'novig' && c[1] === 'over' && c[2] === 5.5), nvu = m.cur.find(c => c[0] === 'novig' && c[1] === 'under' && c[2] === 5.5);
    if (ud && p.fa * dec(ud[3]) - 1 > 0) return { on: true, scope: 'Receptions 5.5', k: 'underdog', title: 'Over 5.5 · Underdog (higher)', price: ud[3], imp: ip(ud[3]), fair: p.fa, ev: p.fa * dec(ud[3]) - 1,
      since: [p.a[4], p.b[4], ud[4]].sort().pop(),
      refs: [['pinnacle', `Pinnacle ${fa(p.a[3])} / ${fa(p.b[3])} · limit $${nfmt((p.a[8] || {}).limit || 0)}`, p.a[6]], ...(nv && nvu ? [['novig', `Novig agrees · fair ${pct(devig(nv[3], nvu[3]))}`, nv[6]]] : []), ['underdog', `Underdog unchanged since ${etd(ud[4])}`, ud[6]]],
      gates: [['Pinnacle two-sided at 5.5', 1], ['Second sharp agrees', 1], ['Re-checked < 5 min', 1], ['Not pulled', 1], ['Pre-game', 1], ['Under the 8% cap', 1]] };
  }
  return edgeEmpty(m, sp, L, ['Over', 'Under'], (mkKey === 'anytime_td' ? 'Yes' : 'at ' + fln(L)));
}

// ------------------------------------------------------------------ surfaces
let P = O.nfl.players['drake london'];
function renderPlayer() {
  const mkList = PROPS.filter(p => P.markets[p[0]] && new Set(P.markets[p[0]].cur.map(c => c[0])).size >= 4);
  const mkKey = S.pm, m = P.markets[mkKey], sp = spec('prop');
  if (S.pline == null || !allLines(m, sp, 99).includes(S.pline)) S.pline = pinMain(m, sp) ?? mainLines(m, sp).modal;
  const L = S.pline;
  const rows = boardRows(m, sp, L);
  const lines = allLines(m, sp, mkKey === 'anytime_td' ? 0 : Math.max(4, Math.abs(mainLines(m, sp).modal || 0) * 0.2));
  const li = lines.indexOf(L);
  CHARTS.p = { m, sp };
  const tabs = mkList.map(([k, name]) => {
    const mm = P.markets[k], ml = mainLines(mm, sp).modal, rr = boardRows(mm, sp, ml), b0 = bestOf(rr, 0), b1 = bestOf(rr, 1);
    const pin = pinAt(mm, sp, ml) || pinAt(mm, sp, pinMain(mm, sp));
    const edge = k === 'receptions';
    const nw = tabNew('p|' + k, mm, k === mkKey);
    return `<button class="mtab" data-pm="${k}" aria-pressed="${k === mkKey}"><div class="n">${name}${edge ? '<span class="dot" style="background:var(--good)" title="Edge (example)"></span>' : ''}</div>
      <div class="l">${k === 'anytime_td' ? 'Yes' : fln(ml)} · O ${lv('tab|' + k + '|o', b0 && b0.q[3], fa(b0 && b0.q[3]))} / U ${lv('tab|' + k + '|u', b1 && b1.q[3], fa(b1 && b1.q[3]))}</div>
      <div class="s">${nw || `<span>${new Set(mm.cur.map(c => c[0])).size} books</span>${pin ? `<span>· Pin ${fa(pin.a[3])}/${fa(pin.b[3])}</span>` : '<span>· no sharp</span>'}`}</div></button>`;
  }).join('') + `<button class="mtab" disabled style="opacity:.7"><div class="n">+ ${PROPS.length - mkList.length + Object.keys(P.coverage).filter(k => k.startsWith('~')).length} more</div><div class="l">targets, 1H, 1Q, fantasy, first TD…</div><div class="s">see Coverage</div></button>`;
  const picks = {};
  const sl = O.nfl.propSplits.filter(s => s[4] === (PROPS.find(p => p[0] === mkKey) || [])[2]);
  const so = sl.find(s => s[5] === 'over'), su = sl.find(s => s[5] === 'under');
  if (so && su) picks.sleeper = `${nfmt(so[9])} of ${nfmt(so[9] + su[9])} entries picked over`;
  const collapse = { intl: true };
  if (S.expand) for (const g of S.expand) delete collapse[g];
  const edge = propEdge(mkKey, m, sp, L);
  return `
  <div class="stub hero-stub" style="--tc:${TEAM.away.color}">${head('https://a.espncdn.com/i/headshots/nfl/players/full/4426502.png', 'Drake London', 64, TEAM.away.color)}<div><div style="display:flex;gap:8px;align-items:center"><b style="color:var(--ink);font-size:18px">Drake London</b><img class="tlogo lg" src="${TEAM.away.logo}" alt=""></div>
    <div class="small">WR #5 · Atlanta Falcons — at Green Bay · Tonight ${et(G.start)} ET</div><div class="age">Hero (headshot, team colour, logo), the prop analysis block and the research cards above are unchanged. The prop block's line stepper and this section's are the same control.</div></div></div>
  ${note('PLAYER · ODDS & PRICES', `Replaces "Prices by market", "Line movement", "All books" and "Game line". The section header's subtitle is the freshness strip (O-I). Market tabs carry best O/U, book count and the sharp price; a green dot = an edge passed the gates. Data: ${REAL} ${P.markets[mkKey].cur.length} live quotes for this market from ${new Set(m.cur.map(c => c[5])).size} sources.`)}
  ${note('LIVE (round 4)', `Everything that updates says so. <b>Card headers</b>: a green dot pulses while the newest reading is inside twice its source's poll interval, turns amber when late and grey when well past it, and pings when the card's data changes. <b>Values</b> roll to the new number with a green (up) or red (down) flash, then leave a ▲/▼ with its age that fades over 2 minutes. <b>Section header</b>: a 30-minute heartbeat of price changes across every book, and "N prices changed since you opened this" (click it to outline them). <b>Market tabs</b> count changes you haven't looked at. <b>Board rows</b> flash red and strike through when a book pulls, and fade back in if it returns. <b>Chart</b>: a "now" guide, the newest points pulse, and a new point pops in. <b>Edge</b>: "passing for N min", and the card folds open or shut as the gates change.`)}
  <section class="sec">${secHead('Odds &amp; prices', fresh(m, rows), sinceOpened())}
    <div class="mtabs">${tabs}</div>
    ${note('O-S SHARP STRIP', 'Heads every board. Pinnacle with its no-vig fair %, age and limit; Circa where it prices the market; exchanges at this exact line with bid/ask and volume. When the selected line has no sharp price it says so in the same place — step the line to see it.')}
    <div style="display:flex;gap:10px;align-items:center;margin:0 0 10px;flex-wrap:wrap"><span class="lbl">Line</span>
      <span class="step"><button data-pstep="-1" ${li <= 0 ? 'disabled' : ''}>◀</button><b class="px" style="text-align:center">${mkKey === 'anytime_td' ? 'Yes' : fln(L)}</b><button data-pstep="1" ${li >= lines.length - 1 ? 'disabled' : ''}>▶</button></span>
      <span class="small muted">${lines.length} lines priced · consensus ${fln(mainLines(m, sp).modal)} · Pinnacle ${fln(pinMain(m, sp))}</span></div>
    ${sharpStrip(m, sp, L)}
    <div class="grid2" style="margin-top:14px">${bestCard(m, sp, L, null, rows)}${edgeCard(edge)}</div>
    ${note('O-B / O-C', `Best price shows your book (★ FanDuel) against the best, and the hold meter (approved idea 1). Edge ${EX}: gates applied by hand to real prices — try <b>Receptions</b> for a passing example and <b>Receiving yards</b> for the honest empty state.`)}
    <section class="card" style="margin-top:14px">${cardH('Every book', 'at ' + (mkKey === 'anytime_td' ? 'Yes' : fln(L)), boardLive(rows) + `<span style="margin-left:10px" class="seg"><button data-all="0" aria-pressed="${!S.all}">This line</button><button data-all="1" aria-pressed="${S.all}">All lines</button></span>`)}
      ${S.all ? ladderCard(m, sp, mkKey === 'anytime_td' ? 0 : 8, null, L) : boardCard(m, sp, L, null, rows, { picks, collapse })}</section>
    ${note('O-A PRICE BOARD', `Groups in the fixed order; your book pinned and highlighted. A book that is not at the selected line shows its own line in grey (never dropped). Filled = best price. "Checked" is when we last confirmed the price; "since" is when it last changed. ⏱ badges ${EX}: the T0 method on the last move Pinnacle led. Pick'em rows are shown as prices but never enter "best". International books are collapsed behind a button.`)}
    <div class="g-mv" style="margin-top:14px">${moveCard(m, sp, 'p')}${moneyProp(mkKey, m)}</div>
    ${note('O-D / O-E', `Pick any books (chips show moves in the window); presets Sharp · My book · Most moves · All. Pinnacle is drawn heaviest. The green marker is the first mover (approved idea 3): who moved first and how many followed. Props money: Sleeper pick counts and Kalshi volume only, and "No data available" for money/bets %.`)}
    <div class="grid2" style="margin-top:14px">${openCard(m, sp)}${depthCard(m, sp, L)}</div>
    <div style="margin-top:14px">${coverageCard(P)}</div>
    ${note('O-K COVERAGE', `Markets × book groups (approved idea 5). The list below is every market a source prices that the app does not show yet — the D15 backlog, straight from the data.`)}
    <div style="margin-top:14px">${gameLineCompact()}</div>
    ${note('GAME LINE (O0 fix)', 'Today this card says "No game line yet" while the game page shows DraftKings — a bug. Rebuilt: best price per side across every book plus Pinnacle, linking to the game page.')}
  </section>`;
}

const PER = [['fg', 'Full game'], ['1h', '1st half'], ['1q', '1st quarter']];
const GMK = [['sp', 'Spread'], ['tot', 'Total'], ['ml', 'Moneyline'], ['tt_home', 'GB team total'], ['tt_away', 'ATL team total']];
function gKey(per, mk) { return mk.startsWith('tt') ? (per === 'fg' ? mk : null) : per + '_' + mk; }
function renderGame() {
  const key = gKey(S.gper, S.gmk) && O.nfl.markets[gKey(S.gper, S.gmk)] ? gKey(S.gper, S.gmk) : (S.gmk = 'sp', gKey(S.gper, 'sp'));
  const m = O.nfl.markets[key];
  const kind = S.gmk.startsWith('tt') ? 'tot' : S.gmk;
  const sp = spec(kind);
  const labels = kind === 'tot' ? ['Over', 'Under'] : [TEAM.home.abbr + (kind === 'sp' ? '' : ''), TEAM.away.abbr];
  if (!sp.noLine) { const all = allLines(m, sp, 99); if (S.gline == null || !all.includes(S.gline)) S.gline = pinMain(m, sp) ?? mainLines(m, sp).modal; }
  const L = sp.noLine ? null : S.gline;
  const rows = boardRows(m, sp, L);
  const lines = sp.noLine ? [] : allLines(m, sp, kind === 'sp' ? 4 : 5);
  const li = lines.indexOf(L);
  CHARTS.g = { m, sp };
  const mtabs = GMK.filter(([k]) => gKey(S.gper, k) && O.nfl.markets[gKey(S.gper, k)]).map(([k, name]) => {
    const mm = O.nfl.markets[gKey(S.gper, k)], sp2 = spec(k.startsWith('tt') ? 'tot' : k), ml = sp2.noLine ? null : mainLines(mm, sp2).modal;
    const rr = boardRows(mm, sp2, ml), b0 = bestOf(rr, 0), b1 = bestOf(rr, 1);
    const l2 = sp2.kind === 'tot' ? ['O', 'U'] : [TEAM.home.abbr, TEAM.away.abbr];
    const pn = sp2.noLine ? mm.cur.find(c => c[0] === 'pinnacle' && c[7] === 'main') : pinAt(mm, sp2, ml);
    const nw = tabNew('g|' + S.gper + k, mm, k === S.gmk);
    return `<button class="mtab" data-gmk="${k}" aria-pressed="${k === S.gmk}"><div class="n">${name}${k === 'sp' && S.gper === 'fg' ? '<span class="dot" style="background:var(--good)" title="Edge (example)"></span>' : ''}</div>
      <div class="l">${sp2.noLine ? '' : (sp2.signed ? TEAM.home.abbr + ' ' + fl(ml, true) : fln(ml)) + ' · '}${l2[0]} ${lv('gtab|' + S.gper + k + '|0', b0 && b0.q[3], fa(b0 && b0.q[3]))} / ${l2[1]} ${lv('gtab|' + S.gper + k + '|1', b1 && b1.q[3], fa(b1 && b1.q[3]))}</div>
      <div class="s">${nw || `${new Set(mm.cur.map(c => c[0])).size} books ${pn ? '· sharp ✓' : '· no sharp'}`}</div></button>`;
  }).join('');
  let edge;
  if (key === 'fg_sp' && L === -4.5) {
    const p = pinAt(m, sp, L), q = m.cur.find(c => c[0] === 'betmgm' && c[1] === 'home' && c[2] === -4.5 && c[7] === 'main') || m.cur.find(c => c[0] === 'betmgm' && c[1] === 'home' && c[2] === -4.5);
    const nv = m.cur.find(c => c[0] === 'betmgmnv' && c[1] === 'home' && c[2] === -4.5);
    if (p && q && p.fa * dec(q[3]) - 1 > 0) edge = { on: true, scope: 'GB −4.5', k: 'betmgm', title: `GB −4.5 · BetMGM`, price: q[3], imp: ip(q[3]), fair: p.fa, ev: p.fa * dec(q[3]) - 1,
      since: [p.a[4], p.b[4], q[4]].sort().pop(),
      refs: [['pinnacle', `Pinnacle ${fa(p.a[3])} / ${fa(p.b[3])} · limit $${nfmt((p.a[8] || {}).limit || 0)}`, p.a[6]], ['betmgm', `BetMGM ${fa(q[3])} on 3 sources: own feed, comparenbet${nv ? ', BetMGM NV (VSiN)' : ''}`, q[6]]],
      why: 'Game-line edges should be rare and around 1–3%. This one is.',
      gates: [['Pinnacle two-sided at −4.5', 1], ['Limit above floor', 1], ['Both re-checked < 1 min', 1], ['3 sources agree', 1], ['Pre-game', 1], ['Under the 8% cap', 1]] };
  }
  if (!edge) edge = edgeEmpty(m, sp, L, labels, sp.noLine ? 'Moneyline' : 'at ' + (sp.signed ? TEAM.home.abbr + ' ' + fl(L, true) : fln(L)));
  const collapse = { intl: true, offshore: true };
  if (S.expand) for (const g of S.expand) delete collapse[g];
  const mkShort = kind === 'sp' ? 'sp' : kind === 'tot' ? 'tot' : 'ml';
  return `
  <div class="stub hero-stub"><img class="tlogo xl" src="${TEAM.away.logo}" alt=""><div><b style="color:var(--ink);font-size:18px">Falcons @ Packers</b><div class="small">${TEAM.away.rec} · ${TEAM.home.rec} · Thursday Night Football · ${et(G.start)} ET · Lambeau Field</div><div class="age">Game hero with both logos and the research cards above are unchanged.</div></div><img class="tlogo xl" src="${TEAM.home.logo}" alt="" style="margin-left:auto"></div>
  ${note('GAME · LINES', `Replaces the DraftKings-via-ESPN-only "Game lines" card. ${REAL} ${m.cur.length} live quotes for this market; ${Object.keys(O.nfl.markets).length} game markets across full game, 1st half, 1st quarter and team totals. Market keys are always labelled (O0 fix for raw keys like <code>longest-rush</code>).`)}
  <section class="sec">${secHead('Lines', fresh(m, rows), sinceOpened())}
    <div class="ptabs"><div class="seg">${PER.map(([k, n]) => `<button data-gper="${k}" aria-pressed="${S.gper === k}">${n}</button>`).join('')}</div></div>
    <div class="mtabs">${mtabs}</div>
    ${sp.noLine ? '' : `<div style="display:flex;gap:10px;align-items:center;margin:0 0 10px;flex-wrap:wrap"><span class="lbl">Line</span>
      <span class="step"><button data-gstep="-1" ${li <= 0 ? 'disabled' : ''}>◀</button><b class="px" style="text-align:center">${sp.signed ? TEAM.home.abbr + ' ' + fl(L, true) : fln(L)}</b><button data-gstep="1" ${li >= lines.length - 1 ? 'disabled' : ''}>▶</button></span>
      <span class="small muted">consensus ${sp.signed ? TEAM.home.abbr + ' ' : ''}${fl(mainLines(m, sp).modal, sp.signed)} · Pinnacle ${fl(pinMain(m, sp), sp.signed)}</span></div>`}
    ${sharpStrip(m, sp, L, labels, kind === 'tot' ? PROP_COL : [TEAM.home.color, TEAM.away.color])}
    <div class="grid2" style="margin-top:14px">${bestCard(m, sp, L, labels, rows)}${edgeCard(edge)}</div>
    ${note('O-C EDGE ' + EX, 'Full game spread at GB −4.5 shows a real price that passes every gate when applied by hand (BetMGM −105 vs Pinnacle −113/+102). Step the line or switch markets for the empty states.')}
    <section class="card" style="margin-top:14px">${cardH('Every book', sp.noLine ? 'Moneyline' : 'at ' + (sp.signed ? TEAM.home.abbr + ' ' : '') + fl(L, sp.signed), boardLive(rows) + (sp.noLine ? '' : `<span style="margin-left:10px" class="seg"><button data-gall="0" aria-pressed="${!S.gall}">This line</button><button data-gall="1" aria-pressed="${S.gall}">All lines</button></span>`))}
      ${S.gall && !sp.noLine ? ladderCard(m, sp, kind === 'sp' ? 6 : 6, labels, L) : boardCard(m, sp, L, labels, rows, { collapse })}</section>
    <div class="g-mv" style="margin-top:14px">${moveCard(m, sp, 'g', labels)}${S.gmk.startsWith('tt') || S.gper !== 'fg' ? `<section class="card">${cardH('Where the money is', '')}<div class="cb small muted">No splits source publishes ${S.gper !== 'fg' ? 'period' : 'team-total'} splits. Full-game spread, total and moneyline have them.</div></section>` : moneyGame(mkShort, sp, labels, kind === 'tot' ? null : [TEAM.home.color, TEAM.away.color])}</div>
    ${note('O-E MONEY (game lines)', `Every row is labelled by whose customers it describes: DraftKings (DK Network), Circa (VSiN), ScoresAndOdds (source unstated), Covers contest picks, Action Network's tracked-bet count, exchange volume. A 15+ point gap between money and bets is called out in words. ${REAL}`)}
    <div class="grid2" style="margin-top:14px">${vegasCard(mkShort)}${depthCard(m, sp, L ?? 0, labels)}</div>
    <div style="margin-top:14px">${propsCard()}</div>
    ${note('PLAYER PROPS (rebuilt)', `Was a long unstyled list. Now a card with filters — team, position, market — sort (most books, biggest move, A–Z) and three views: <b>Players</b> (a card per player, headshot and team colour), <b>By market</b> (every player ranked by the line, bars in team colour) and <b>Table</b>. Each market: consensus line, best over/under with its book, the sharp price, books, moved since open, an edge dot where one passes. ${REAL} ${Object.keys(O.nfl.card).length} players, labels from one label map (16 markets; the scraper's sources use ~110 spellings).`)}
  </section>`;
}
function vegasCard(mk) {
  const nv = ['circa', 'westgate', 'southpoint', 'wynn', 'stations', 'boomers', 'caesarsnv', 'betmgmnv'];
  const map = { 'Circa': 'circa', 'Westgate': 'westgate', 'South Point': 'southpoint', 'Wynn': 'wynn', 'Stations': 'stations', 'Boomers': 'boomers', 'Caesars NV': 'caesarsnv', 'BetMGM NV': 'betmgmnv' };
  const ops = {}; for (const o of O.nfl.openers) if (o.period === 'fg' && map[o.book]) ops[map[o.book]] = o;
  const cur = k => { const s = O.nfl.markets.fg_sp.cur.find(c => c[0] === k && c[1] === 'home' && c[5] === 'vsin') || O.nfl.markets.fg_sp.cur.find(c => c[0] === k && c[1] === 'home' && c[7] === 'main');
    const t = O.nfl.markets.fg_tot.cur.find(c => c[0] === k && c[1] === 'over' && c[7] === 'main'); const ml = O.nfl.markets.fg_ml.cur.find(c => c[0] === k && c[1] === 'away' && c[7] === 'main'); return { s, t, ml }; };
  const rows = nv.filter(k => ops[k] || cur(k).s).map(k => {
    const o = ops[k], c = cur(k);
    const oSp = o ? o.spread_away.split(' ')[0] : null;
    const odd = o && (o.spread_away.startsWith('-') || +o.total > 50);
    return `<tr${odd ? ' class="dim"' : ''}><td>${book(k, 14)}${odd ? ' <span class="st warn" title="Opener looks wrong vs every other book">⚠ check</span>' : ''}</td>
      <td class="r">${o ? `ATL ${esc(oSp)}` : '—'}</td><td class="r"><b>${c.s ? 'ATL ' + fl(-c.s[2], true) : '—'}</b></td>
      <td class="r hide-ph">${o ? esc(o.total) : '—'}</td><td class="r hide-ph"><b>${c.t ? fln(c.t[2]) : '—'}</b></td>
      <td class="r hide-ph">${o ? esc(o.ml_away) : '—'}</td><td class="r hide-ph"><b>${c.ml ? fa(c.ml[3]) : '—'}</b></td></tr>`;
  }).join('');
  const pw = O.nfl.power, g = pw['Green Bay Packers'], a = pw['Atlanta Falcons'];
  return `<section class="card">${cardH('Vegas board', 'Circa + Nevada books, via VSiN')}<div class="scrollx"><table class="t"><thead><tr><th>Book</th><th class="r">Spread open</th><th class="r">now</th><th class="r hide-ph">Total open</th><th class="r hide-ph">now</th><th class="r hide-ph">ATL ML open</th><th class="r hide-ph">now</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="cb" style="border-top:1px solid var(--line-soft)"><div class="age">Openers are VSiN's own OPEN row per book. ${g && a ? `VSiN power ratings (research context): GB ${g.PR} (#${g.Rank}) · ATL ${a.PR} (#${a.Rank}), updated ${esc(g._table.replace('Updated on ', ''))}.` : ''} Rows marked "check" are flagged for the bridge's opener sanity check, not hidden.</div></div></section>`;
}
const MK_LABEL = { pass_yds: 'Passing yards', pass_tds: 'Passing TDs', completions: 'Completions', pass_att: 'Pass attempts', ints: 'Interceptions',
  rush_yds: 'Rushing yards', rush_att: 'Rush attempts', rec_yds: 'Receiving yards', receptions: 'Receptions', longest_rec: 'Longest reception',
  anytime_td: 'Anytime TD', rush_rec_yds: 'Rush + rec yards', pass_rush_yds: 'Pass + rush yards', targets: 'Targets', tackles_ast: 'Tackles + assists', sacks: 'Sacks' };
const MK_ORDER = Object.keys(MK_LABEL);
const POSG = p => p === 'QB' ? 'QB' : ['RB', 'FB'].includes(p) ? 'RB' : p === 'WR' ? 'WR' : p === 'TE' ? 'TE' : ['PK', 'K', 'P'].includes(p) ? 'K' : 'DEF';
const TEAMS = { ATL: TEAM.away, GB: TEAM.home };
const head = (url, name, s, tc) => `<span class="hs" style="width:${s}px;height:${s}px;${tc ? `box-shadow:0 0 0 2px ${tc}` : ''}">${url && !FAILED.has(url) ? `<img src="${url}" alt="" onerror="OMFAIL(this)" data-f="">` : ''}<span>${esc(name.split(' ').map(w => w[0]).join('').slice(0, 2))}</span></span>`;
function cardRows() {
  const out = [];
  for (const [name, P2] of Object.entries(O.nfl.card)) for (const [mk, pm] of Object.entries(P2.markets)) {
    if (new Set(pm.cur.map(c => c[0])).size < 5) continue;
    const m = { cur: pm.cur.map(c => [...c, 'main', null]), open: pm.open, hist: {}, steam: [] };
    const sp = spec('prop'), L = mainLines(m, sp).modal, rows = boardRows(m, sp, L), b0 = bestOf(rows, 0), b1 = bestOf(rows, 1), p = pinAt(m, sp, L);
    const ops = Object.values(pm.open).map(o => o[1]).filter(v => v != null).sort((a, b) => a - b);
    const opM = ops.length ? ops[Math.floor(ops.length / 2)] : null;
    out.push({ name, team: P2.team, pos: P2.pos, pg: POSG(P2.pos), head: P2.head, mk, L, b0, b1, p, n: new Set(pm.cur.map(c => c[0])).size,
      mv: mk === 'anytime_td' || opM == null ? 0 : L - opM, opM, first: pm.first, moves: pm.moves, edge: name === 'Drake London' && mk === 'receptions' });
  }
  return out;
}
let CARD_ROWS = null;
function propsCard() {
  CARD_ROWS = CARD_ROWS || cardRows();
  const F = S.pf;
  let rows = CARD_ROWS.filter(r => (F.team === 'all' || r.team === F.team) && (F.pos === 'all' || r.pg === F.pos));
  const mkCount = {}; for (const r of rows) mkCount[r.mk] = (mkCount[r.mk] || 0) + 1;
  if (F.mk !== 'all') rows = rows.filter(r => r.mk === F.mk);
  const sorters = { books: (a, b) => b.n - a.n, move: (a, b) => Math.abs(b.mv) - Math.abs(a.mv) || b.n - a.n, name: (a, b) => a.name.localeCompare(b.name) || MK_ORDER.indexOf(a.mk) - MK_ORDER.indexOf(b.mk) };
  rows.sort(sorters[F.sort]);
  const ln = r => r.mk === 'anytime_td' ? 'Yes' : fln(r.L);
  const pr = (b, u) => b ? `<span class="px" style="min-width:0">${fa(b.q[3])}</span> ${logo(b.k, 14)}` : (u ? '<span class="muted">—</span>' : '<span class="muted">—</span>');
  const mvChip = r => r.mv ? `<span class="small mv ${r.mv > 0 ? 'up' : 'dn'}">${r.mv > 0 ? '↑' : '↓'} ${fln(Math.abs(r.mv))} since open</span>` : '';
  const sharp = r => r.p ? `<span class="shm">Sharp ${fa(r.p.a[3])}/${fa(r.p.b[3])}</span>` : '<span class="muted small">no sharp</span>';
  const teamSeg = `<div class="seg">${[['all', 'Both teams'], ['ATL', 'ATL'], ['GB', 'GB']].map(([k, n]) => `<button data-pft="${k}" aria-pressed="${F.team === k}">${k !== 'all' ? `<img class="tlogo" src="${TEAMS[k].logo}" alt="">` : ''}${n}</button>`).join('')}</div>`;
  const posSeg = `<div class="seg">${['all', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(k => `<button data-pfp="${k}" aria-pressed="${F.pos === k}">${k === 'all' ? 'All' : k}</button>`).join('')}</div>`;
  const mkChips = `<div class="mkchips"><button class="pk" data-pfm="all" aria-pressed="${F.mk === 'all'}">All markets <span class="ct">${Object.values(mkCount).reduce((a, b) => a + b, 0)}</span></button>${MK_ORDER.filter(k => mkCount[k]).map(k => `<button class="pk" data-pfm="${k}" aria-pressed="${F.mk === k}">${MK_LABEL[k]} <span class="ct">${mkCount[k]}</span></button>`).join('')}</div>`;
  const ctl = `<div class="pf-ctl">${teamSeg}${posSeg}
    <div class="seg"><span class="seg-l">Sort</span>${[['books', 'Most books'], ['move', 'Biggest move'], ['name', 'A–Z']].map(([k, n]) => `<button data-pfs="${k}" aria-pressed="${F.sort === k}">${n}</button>`).join('')}</div>
    <div class="seg" style="margin-left:auto"><span class="seg-l">View</span>${[['players', 'Players'], ['market', 'By market'], ['table', 'Table']].map(([k, n]) => `<button data-pfv="${k}" aria-pressed="${F.view === k}">${n}</button>`).join('')}</div></div>${mkChips}`;
  let body = '';
  if (F.view === 'players') {
    const by = {}; for (const r of rows) (by[r.name] = by[r.name] || []).push(r);
    const names = Object.keys(by);
    body = `<div class="pcards">${names.slice(0, S.pfMore ? 99 : S.w === 'phone' ? 4 : 9).map(n => {
      const rr = by[n], r0 = rr[0], T = TEAMS[r0.team];
      const show = rr.slice(0, 5);
      return `<div class="pc" style="--tc:${T.color}"><div class="pc-h">${head(r0.head, n, 44, T.color)}<div style="min-width:0"><b class="pc-n">${esc(n)}</b><div class="age"><img class="tlogo" src="${T.logo}" alt="">${r0.team} · ${r0.pos}</div></div>
        <span class="small muted" style="margin-left:auto;white-space:nowrap">${rr.length} market${rr.length > 1 ? 's' : ''}</span></div>
        <table class="pc-t"><tbody>${show.map(r => `<tr><td><div class="small"><b>${MK_LABEL[r.mk]}</b>${r.edge ? ' <span class="dot" style="background:var(--good)" title="Edge (example)"></span>' : ''}</div><div class="age">${r.n} books · ${sharp(r)}</div></td>
          <td class="r"><b class="lnum">${ln(r)}</b>${r.mv ? `<div class="mv ${r.mv > 0 ? 'up' : 'dn'}" style="font-size:11px">${r.mv > 0 ? '↑' : '↓'}${fln(Math.abs(r.mv))}</div>` : ''}</td>
          <td class="r"><div class="ou"><span class="ov">O</span>${pr(r.b0)}</div>${r.mk !== 'anytime_td' ? `<div class="ou"><span class="ov">U</span>${pr(r.b1)}</div>` : ''}</td></tr>`).join('')}</tbody></table>
        ${rr.length > 5 ? `<div class="pc-more">+ ${rr.length - 5} more markets</div>` : ''}</div>`;
    }).join('')}</div>${names.length > (S.w === 'phone' ? 4 : 9) && !S.pfMore ? `<div style="padding:0 16px 14px"><button class="btn" data-pfmore="1">Show all ${names.length} players</button></div>` : ''}`;
  } else if (F.view === 'market') {
    const mk = F.mk === 'all' ? (mkCount.rec_yds ? 'rec_yds' : Object.keys(mkCount)[0]) : F.mk;
    const rr = rows.filter(r => r.mk === mk).sort((a, b) => b.L - a.L);
    const max = Math.max(...rr.map(r => r.L || 0), 1);
    body = `<div class="cb" style="padding-bottom:4px"><div class="small soft">${MK_LABEL[mk]} — every player priced, ranked by the consensus line${F.mk === 'all' ? ' (pick a market above)' : ''}</div></div>
      <div class="lb">${rr.map((r, i) => { const T = TEAMS[r.team]; return `<div class="lb-r"><span class="lb-i">${i + 1}</span>${head(r.head, r.name, 30, T.color)}<div class="lb-n"><b class="small">${esc(r.name)}</b><div class="age"><img class="tlogo" src="${T.logo}" alt="">${r.team} · ${r.pos} · ${r.n} books</div></div>
        <div class="lb-bar"><i style="width:${mk === 'anytime_td' ? 100 * ip(r.b0 ? r.b0.q[3] : 200) : 100 * (r.L || 0) / max}%;background:${T.color}"></i><b>${mk === 'anytime_td' ? (r.b0 ? pct(ip(r.b0.q[3]), 0) : '—') : ln(r)}</b></div>
        <div class="lb-p"><div class="ou"><span class="ov">O</span>${pr(r.b0)}</div>${mk !== 'anytime_td' ? `<div class="ou"><span class="ov">U</span>${pr(r.b1)}</div>` : ''}</div>
        <div class="lb-x hide-ph">${sharp(r)}${mvChip(r)}</div></div>`; }).join('')}</div>`;
  } else {
    body = `<div class="scrollx"><table class="t"><thead><tr><th>Player</th><th>Market</th><th class="r">Line</th><th class="r">Best over</th><th class="r">Best under</th><th class="r hide-ph">Sharp</th><th class="r hide-ph">Books</th><th class="hide-ph">Open → now</th><th class="c">Edge</th></tr></thead><tbody>
      ${rows.slice(0, S.pfMore ? 400 : 30).map(r => { const T = TEAMS[r.team]; return `<tr><td><span class="bk">${head(r.head, r.name, 24, T.color)}<b class="small">${esc(r.name)}</b><img class="tlogo" src="${T.logo}" alt=""></span></td><td class="small">${MK_LABEL[r.mk]}</td><td class="r"><b>${ln(r)}</b></td><td class="r">${pr(r.b0)}</td><td class="r">${r.mk !== 'anytime_td' ? pr(r.b1) : '—'}</td>
        <td class="r hide-ph">${sharp(r)}</td><td class="r hide-ph">${r.n}</td><td class="hide-ph">${r.mv ? `<span class="mv">${fln(r.opM)} → ${fln(r.L)}</span>` : '<span class="muted">—</span>'}</td><td class="c">${r.edge ? '<span class="dot" style="background:var(--good)"></span>' : ''}</td></tr>`; }).join('')}</tbody></table></div>
      ${rows.length > 30 && !S.pfMore ? `<div class="cb"><button class="btn" data-pfmore="1">Show all ${rows.length}</button></div>` : ''}`;
  }
  const nPl = new Set(rows.map(r => r.name)).size;
  return `<section class="card">${cardH('Player props', `${nPl} players · ${rows.length} markets · every source`)}<div class="pf-wrap">${ctl}</div>${rows.length ? body : '<div class="cb small muted">No props match these filters.</div>'}</section>`;
}

// finished game: player props against the box score
const FMK = { hits: 'Hits', total_bases: 'Total bases', home_runs: 'Home run', rbis: 'RBIs', runs: 'Runs', walks: 'Walks', singles: 'Singles',
  doubles: 'Doubles', triples: 'Triples', hrr: 'Hits + runs + RBIs', runs_rbi: 'Runs + RBIs', stolen_bases: 'Stolen bases',
  p_hits: 'Hits allowed', p_walks: 'Walks allowed', p_outs: 'Outs recorded' };
const FTEAM = { TOR: { color: '#134a8e', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/tor.png' }, BAL: { color: '#df4601', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/bal.png' } };
const mlbHead = id => id ? `https://img.mlbstatic.com/mlb-photos/image/upload/w_120,q_auto:best/v1/people/${id}/headshot/67/current` : '';
function finalRows(g) {
  const pl = Object.fromEntries(g.props.players.map(p => [p.name, p]));
  const out = [];
  for (const fm of g.props.markets) {
    const p = pl[fm.name]; if (!p) continue;
    if (!p.played && fm.q.length < 6) continue;          // a priced name that never appears in this game's box: not shown
    const cnt = {}; for (const q of fm.q) if (q[1] === 'over') cnt[q[2]] = (cnt[q[2]] || 0) + 1;
    const L = +Object.entries(cnt).sort((a, b) => b[1] - a[1] || Math.abs(a[0] - 0.5) - Math.abs(b[0] - 0.5))[0]?.[0];
    if (isNaN(L)) continue;
    const at = fm.q.filter(q => q[2] === L);
    const best = side => at.filter(q => q[1] === side && q[0] !== 'prizepicks').sort((a, b) => dec(b[3]) - dec(a[3]))[0];
    const pin = ['over', 'under'].map(sd => at.find(q => q[0] === 'pinnacle' && q[1] === sd));
    const r = p.played ? p.res[fm.mk] : null;
    const out1 = !p.played || r == null ? 'dnp' : r > L ? 'over' : r < L ? 'under' : 'push';
    out.push({ name: p.name, id: p.id, team: p.team, pos: p.pos, box: p.line, mk: fm.mk, L, r, res: out1, bo: best('over'), bu: best('under'),
      pin: pin[0] && pin[1] ? pin : null, n: new Set(at.map(q => q[0])).size });
  }
  return out;
}
function resTrack(r) {
  if (r.res === 'dnp') return '<span class="muted small">—</span>';
  const max = Math.max(r.L * 2, r.r + 1, 2), X = v => (100 * v / max).toFixed(1);
  return `<span class="rtrack"><i class="rt-l" style="left:${X(r.L)}%"></i><i class="rt-d ${r.res}" style="left:${X(r.r)}%"></i></span>`;
}
const resChip = r => r.res === 'over' ? `<span class="rchip over">OVER ✓</span>` : r.res === 'under' ? `<span class="rchip under">UNDER ✓</span>` : r.res === 'push' ? '<span class="rchip push">PUSH</span>' : '<span class="rchip dnp">DID NOT PLAY</span>';
function finalPropsCard(g) {
  const all = finalRows(g), F = S.fp;
  let rows = all.filter(r => (F.team === 'all' || r.team === F.team) && (F.res === 'all' || r.res === F.res));
  const mkCount = {}; for (const r of rows) mkCount[r.mk] = (mkCount[r.mk] || 0) + 1;
  if (F.mk !== 'all') rows = rows.filter(r => r.mk === F.mk);
  const played = all.filter(r => r.res !== 'dnp');
  const overs = played.filter(r => r.res === 'over').length, unders = played.filter(r => r.res === 'under').length;
  const longest = played.filter(r => r.res === 'over' && r.bo).sort((a, b) => b.bo[3] - a.bo[3])[0];
  const byMk = {}; for (const r of played) { const b = byMk[r.mk] = byMk[r.mk] || [0, 0]; b[0]++; if (r.res === 'over') b[1]++; }
  const pinRows = played.filter(r => r.pin);
  const pinRight = pinRows.filter(r => (devig(r.pin[0][3], r.pin[1][3]) > 0.5) === (r.res === 'over')).length;
  const tiles = `<div class="fr-tiles">
    <div class="frt"><div class="ov">Overs that hit</div><div class="frt-v">${overs}<span>/ ${played.length}</span></div>${fairBar(overs / Math.max(1, overs + unders), ['Over', 'Under'], ['var(--good)', 'oklch(80% .01 260)'])}</div>
    <div class="frt"><div class="ov">Longest price that hit</div>${longest ? `<div class="frt-v sm">${fa(longest.bo[3])} ${logo(longest.bo[0], 16)}</div><div class="small">${esc(longest.name)} · ${FMK[longest.mk]} over ${fln(longest.L)}</div>` : '—'}</div>
    <div class="frt wide"><div class="ov">Pinnacle's favourite side</div><div class="frt-v">${pinRight}<span>/ ${pinRows.length}</span></div><div class="small muted">markets where the side Pinnacle priced above 50% came in</div></div>
    <div class="frt wide"><div class="ov">By market · overs hit</div><div class="frm">${Object.entries(byMk).sort((a, b) => b[1][0] - a[1][0]).slice(0, 5).map(([k, v]) => `<div><span>${FMK[k]}</span><span class="frm-b"><i style="width:${100 * v[1] / v[0]}%"></i></span><b>${v[1]}/${v[0]}</b></div>`).join('')}</div></div></div>`;
  const tseg = `<div class="seg">${[['all', 'Both teams'], ['TOR', 'TOR'], ['BAL', 'BAL']].map(([k, n]) => `<button data-fpt="${k}" aria-pressed="${F.team === k}">${k !== 'all' ? `<img class="tlogo" src="${FTEAM[k].logo}" alt="">` : ''}${n}</button>`).join('')}</div>`;
  const rseg = `<div class="seg">${[['all', 'All results'], ['over', 'Over hit'], ['under', 'Under hit'], ['dnp', 'Did not play']].map(([k, n]) => `<button data-fpr="${k}" aria-pressed="${F.res === k}">${n}</button>`).join('')}</div>`;
  const vseg = `<div class="seg" style="margin-left:auto"><span class="seg-l">View</span>${[['players', 'Players'], ['table', 'Table']].map(([k, n]) => `<button data-fpv="${k}" aria-pressed="${F.view === k}">${n}</button>`).join('')}</div>`;
  const chips = `<div class="mkchips"><button class="pk" data-fpm="all" aria-pressed="${F.mk === 'all'}">All markets <span class="ct">${Object.values(mkCount).reduce((a, b) => a + b, 0)}</span></button>${Object.keys(FMK).filter(k => mkCount[k]).map(k => `<button class="pk" data-fpm="${k}" aria-pressed="${F.mk === k}">${FMK[k]} <span class="ct">${mkCount[k]}</span></button>`).join('')}</div>`;
  const pr = q => q ? `<span class="px" style="min-width:0">${fa(q[3])}</span> ${logo(q[0], 14)}` : '<span class="muted">—</span>';
  let body;
  if (F.view === 'players') {
    const by = {}; for (const r of rows) (by[r.name] = by[r.name] || []).push(r);
    const names = Object.keys(by).sort((a, b) => (by[a][0].res === 'dnp') - (by[b][0].res === 'dnp') || by[b].length - by[a].length);
    body = `<div class="pcards">${names.slice(0, S.fpMore ? 99 : S.w === 'phone' ? 4 : 9).map(n => {
      const rr = by[n].sort((a, b) => Object.keys(FMK).indexOf(a.mk) - Object.keys(FMK).indexOf(b.mk)), r0 = rr[0], T = FTEAM[r0.team] || { color: '#8a8f98', logo: '' };
      const hit = rr.filter(r => r.res === 'over').length;
      return `<div class="pc" style="--tc:${T.color}"><div class="pc-h">${head(mlbHead(r0.id), n, 44, T.color)}<div style="min-width:0"><b class="pc-n">${esc(n)}</b>
        <div class="age">${T.logo ? `<img class="tlogo" src="${T.logo}" alt="">` : ''}${r0.team || '—'}${r0.pos ? ' · ' + r0.pos : ''} · <b style="color:var(--ink)">${esc(r0.box)}</b></div></div>
        ${r0.res === 'dnp' ? '<span class="rchip dnp" style="margin-left:auto">DNP</span>' : `<span class="small" style="margin-left:auto;white-space:nowrap"><b class="${hit ? 'st good' : ''}" style="font-size:13px">${hit}/${rr.length}</b> <span class="muted">overs</span></span>`}</div>
        <table class="pc-t"><tbody>${rr.slice(0, 6).map(r => `<tr class="${r.res === 'dnp' ? 'dim' : ''}"><td><div class="small"><b>${FMK[r.mk]}</b> <span class="muted">${fln(r.L)}</span></div><div class="age">${r.n} books · over ${pr(r.bo)}</div></td>
          <td class="r trk" style="width:74px">${resTrack(r)}</td><td class="r" style="width:54px"><b class="lnum">${r.r ?? '—'}</b></td><td class="r" style="width:96px">${resChip(r)}</td></tr>`).join('')}</tbody></table>
        ${rr.length > 6 ? `<div class="pc-more">+ ${rr.length - 6} more markets</div>` : ''}</div>`;
    }).join('')}</div>${names.length > (S.w === 'phone' ? 4 : 9) && !S.fpMore ? `<div style="padding:0 16px 14px"><button class="btn" data-fpmore="1">Show all ${names.length} players</button></div>` : ''}`;
  } else {
    body = `<div class="scrollx"><table class="t"><thead><tr><th>Player</th><th>Market</th><th class="r">Close</th><th class="r">Result</th><th></th><th class="r">Best over</th><th class="r">Best under</th><th class="r hide-ph">Pinnacle</th><th class="r hide-ph">Books</th></tr></thead><tbody>
      ${rows.slice(0, S.fpMore ? 500 : 40).map(r => { const T = FTEAM[r.team] || {}; return `<tr class="${r.res === 'dnp' ? 'dim' : ''}"><td><span class="bk">${head(mlbHead(r.id), r.name, 24, T.color)}<b class="small">${esc(r.name)}</b>${T.logo ? `<img class="tlogo" src="${T.logo}" alt="">` : ''}</span></td>
        <td class="small">${FMK[r.mk]}</td><td class="r"><b>${fln(r.L)}</b></td><td class="r"><b>${r.r ?? '—'}</b></td><td>${resChip(r)}</td><td class="r">${pr(r.bo)}</td><td class="r">${pr(r.bu)}</td>
        <td class="r hide-ph">${r.pin ? `${fa(r.pin[0][3])}/${fa(r.pin[1][3])}` : '<span class="muted">—</span>'}</td><td class="r hide-ph">${r.n}</td></tr>`; }).join('')}</tbody></table></div>
      ${rows.length > 40 && !S.fpMore ? `<div class="cb"><button class="btn" data-fpmore="1">Show all ${rows.length}</button></div>` : ''}`;
  }
  return `<section class="card" style="margin-top:14px">${cardH('Player props · results', `${new Set(all.map(r => r.name)).size} players · ${all.length} markets · at the closing line`)}
    <div class="cb" style="border-bottom:1px solid var(--line-soft)">${tiles}</div><div class="pf-wrap"><div class="pf-ctl">${tseg}${rseg}${vseg}</div>${chips}</div>${rows.length ? body : '<div class="cb small muted">No props match these filters.</div>'}</section>`;
}

// finished game: closing-line research
function renderFinal() {
  const g = O.mlb.find(x => x.final);
  const res = { away: 'TOR', home: 'BAL', as: 2, hs: 4 };
  const mk = g.markets;
  const pinC = (m, sd) => m.cur.find(c => c[0] === 'pinnacle' && c[1] === sd && c[7] === 'main');
  const ml = mk.ml, spm = mk.sp, tot = mk.tot;
  const pa = pinC(ml, 'home'), pb = pinC(ml, 'away');
  const fairClose = pa && pb ? devig(pa[3], pb[3]) : null;
  const books = [...new Set(ml.cur.map(c => c[0]))].filter(k => ['sharp', 'us', 'exchange', 'nevada'].includes(bg(k))).sort((a, b) => GORD[bg(a)] - GORD[bg(b)] || bn(a).localeCompare(bn(b)));
  const tl = k => tot.cur.find(c => c[0] === k && c[1] === 'over' && c[7] === 'main');
  const rl = k => spm.cur.find(c => c[0] === k && c[1] === 'home' && c[7] === 'main');
  const rows = books.map(k => {
    const h = ml.cur.find(c => c[0] === k && c[1] === 'home' && c[7] === 'main'), a = ml.cur.find(c => c[0] === k && c[1] === 'away' && c[7] === 'main');
    const o = ml.open[k]; const t = tl(k), r = rl(k);
    const clv = o && h && fairClose ? fairClose * dec(o[2]) - 1 : null;
    const vsSharp = h && fairClose ? ip(h[3]) - fairClose : null;
    return `<tr${k === 'pinnacle' ? ' class="me"' : ''}><td>${book(k, 14)}</td><td class="r">${o ? fa(o[2]) : '—'}</td><td class="r"><b>${h ? fa(h[3]) : '—'}</b> <span class="muted">/ ${a ? fa(a[3]) : '—'}</span></td>
      <td class="r hide-ph">${vsSharp != null ? `<span class="${vsSharp > 0.01 ? 'mv dn' : ''}">${vsSharp >= 0 ? '+' : ''}${(vsSharp * 100).toFixed(1)} pts</span>` : '—'}</td>
      <td class="r hide-ph">${clv != null ? `<span class="mv ${clv > 0 ? 'up' : 'dn'}">${clv >= 0 ? '+' : ''}${pct(clv)}</span>` : '—'}</td>
      <td class="r hide-ph">${r ? `BAL ${fl(r[2], true)} ${fa(r[3])}` : '—'}</td><td class="r">${t ? `${fln(t[2])} <span class="muted">${fa(t[3])}</span>` : '—'}</td></tr>`;
  }).join('');
  const tLine = mainLines(tot, spec('tot')).modal;
  const po = ml.open.pinnacle;
  return `
  <div class="stub hero-stub"><img class="tlogo xl" src="https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/tor.png" alt=""><div><b style="color:var(--ink);font-size:18px">Blue Jays 2 @ Orioles 4 · Final</b><div class="small">Sep 23 · 6:35 PM ET</div><div class="age">This is the Lines section of a FINISHED game's page.</div></div><img class="tlogo xl" src="https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/bal.png" alt="" style="margin-left:auto"></div>
  ${note('O-F CLOSING-LINE RESEARCH (approved idea 6)', `After the game the Lines section turns into closing-line research: each book's close against the result, the sharp close vs each book's close, and "if you had taken the opener" CLV per book. ${REAL} closes = the last price recorded before first pitch; the result is ESPN's final. The same numbers feed E3's closing-line test.`)}
  <section class="sec">${secHead('Lines · closing-line research', `closed ${etd(g.start)} · ${books.length} books`)}
    <div class="grid3">
      <section class="card"><div class="cb"><div class="ov">Moneyline</div><div style="font-size:20px;font-weight:650">BAL won</div><div class="small soft">Pinnacle opened BAL ${po ? fa(po[2]) : '—'}, closed <b>${fa(pa && pa[3])}</b> — the close moved ${po && pa && dec(pa[3]) < dec(po[2]) ? '<b class="mv up">toward</b>' : '<b class="mv dn">away from</b>'} the result. Fair close BAL ${fairClose ? pct(fairClose) : '—'}.</div></div></section>
      <section class="card"><div class="cb"><div class="ov">Run line</div><div style="font-size:20px;font-weight:650">BAL −1.5 covered</div><div class="small soft">Won by 2. Closing run line BAL −1.5 ${fa((rl('pinnacle') || [])[3])} at Pinnacle.</div></div></section>
      <section class="card"><div class="cb"><div class="ov">Total</div><div style="font-size:20px;font-weight:650">Under ${fln(tLine)}</div><div class="small soft">6 runs vs a consensus close of ${fln(tLine)}.</div></div></section>
    </div>
    <section class="card" style="margin-top:14px">${cardH('Every book at the close', 'moneyline BAL / TOR, run line, total')}<div class="scrollx"><table class="t"><thead><tr><th>Book</th><th class="r">BAL open</th><th class="r">Close</th><th class="r hide-ph">vs sharp close</th><th class="r hide-ph">Opener CLV</th><th class="r hide-ph">Run line</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="cb" style="border-top:1px solid var(--line-soft)"><div class="age">"vs sharp close" = the book's closing BAL implied probability minus Pinnacle's no-vig close (positive = the book charged more for BAL). "Opener CLV" = value of that book's BAL opener measured at Pinnacle's fair close. Research, not a pick.</div></div></section>
    ${finalPropsCard(g)}
    ${note('PLAYER PROPS · RESULTS', `Every player prop priced before first pitch, graded against the box score. The line is the consensus close (the line most books closed at); the best over and under are the best closing prices with their books; the result is the player's real number, with a track showing it against the line. Filters: team, result, market; views: Players and Table. Players who were priced but did not play are kept and marked (ResultMark's did-not-play). ${REAL} ${finalRows(g).length} player-markets from ${new Set(g.props.markets.flatMap(m => m.q.map(q => q[0]))).size} books; box score from MLB's stats API. Research, not a record of picks.`)}
    <div class="g-mv" style="margin-top:14px">${(CHARTS.f = { m: ml, sp: spec('ml') }, moveCard(ml, spec('ml'), 'f', ['BAL', 'TOR']))}${openCard(tot, spec('tot'), ['Over', 'Under'], 'Total: opening → close')}</div>
  </section>`;
}

// team page
function renderTeam() {
  const tt = O.nfl.markets.tt_home, sp = spec('tot');
  const L = mainLines(tt, sp).modal, rows = boardRows(tt, sp, L), b0 = bestOf(rows, 0), b1 = bestOf(rows, 1), p = pinAt(tt, sp, L);
  CHARTS.t = { m: O.nfl.markets.fg_sp, sp: spec('sp') };
  const hist = [['Sep 13', '@ MIN', 'L 22–39', 'GB +2.5', 'lost ATS', 'O 46.5', 'over (61)'], ['Sep 20', '@ NYJ', 'W 20–17', 'GB −3.5', 'lost ATS (won by 3)', 'O/U 44.5', 'under (37)']];
  return `
  <div class="stub hero-stub"><img class="tlogo xl" src="${TEAM.home.logo}" alt=""><div><b style="color:var(--ink);font-size:18px">Green Bay Packers</b><div class="small">1–1 · NFC North</div><div class="age">Team hero (logo, team colour) and research cards above are unchanged.</div></div></div>
  ${note('TEAM · ODDS', `The team's next game (compact board + movement), its team total, and its record against the closing number. ${REAL} lines from the scraper; closes for past games = DraftKings' close via ESPN (the stored-close table fills this once the bridge runs).`)}
  <section class="sec">${secHead('Odds', 'next game · team total · against the close')}
    <div class="grid2">${gameLineCompact('Next game · vs ATL · tonight')}
      <section class="card">${cardH('GB team total', `${rows.length} books`, boardLive(rows))}<div class="cb"><div class="bp">
        <div class="bpx"><div class="ov">Best over ${fln(L)}</div><div class="v px">${fa(b0 && b0.q[3])}</div><div class="small">${b0 ? book(b0.k, 14) : ''}</div></div>
        <div class="bpx"><div class="ov">Best under ${fln(L)}</div><div class="v px">${fa(b1 && b1.q[3])}</div><div class="small">${b1 ? book(b1.k, 14) : ''}</div></div></div>
        <div class="small soft" style="margin-top:10px">${p ? `Pinnacle ${fa(p.a[3])}/${fa(p.b[3])} · fair over ${pct(p.fa)}` : 'No Pinnacle price at ' + fln(L)} · consensus ${fln(L)}</div></div></section></div>
    <div class="g-mv" style="margin-top:14px">${moveCard(O.nfl.markets.fg_sp, spec('sp'), 't', ['GB', 'ATL'])}
      <section class="card">${cardH('Against the closing number', '2026 season')}<table class="t"><thead><tr><th>Game</th><th>Close</th><th>ATS</th><th class="hide-ph">Total</th></tr></thead><tbody>
      ${hist.map(r => `<tr><td><b>${r[1]}</b> <span class="age">${r[0]}</span><div class="small">${r[2]}</div></td><td>${r[3]}</td><td><span class="st bad" style="font-size:12px">${r[4]}</span></td><td class="hide-ph">${r[5]} · ${r[6]}</td></tr>`).join('')}
      </tbody></table><div class="cb" style="border-top:1px solid var(--line-soft)"><div class="small"><b>0–2 ATS</b> · <b>1–1 O/U</b> against the close <span class="muted">· research, not a pick</span></div></div></section></div>
  </section>`;
}

// ------------------------------------------------------------------ slate
let MLB = O.mlb.filter(g => !g.final && g.espn);
function setTime(t) { NOW = new Date(t); O = sliceAll(t); P = O.nfl.players['drake london']; MLB = O.mlb.filter(g => !g.final && g.espn); }
const slateLive = () => { const a = MLB.flatMap(g => g.markets.ml.cur.map(c => c[6])).filter(v => v != null); return a.length ? liveTag(atS(Math.min(...a)), 70) : ''; };
function mlbView(g) {
  const ml = g.markets.ml, spL = g.markets.sp, tot = g.markets.tot;
  const s = spec('ml'), rows = boardRows(ml, s, null), b0 = bestOf(rows, 0), b1 = bestOf(rows, 1);
  const pa = ml.cur.find(c => c[0] === 'pinnacle' && c[1] === 'home' && c[7] === 'main'), pb = ml.cur.find(c => c[0] === 'pinnacle' && c[1] === 'away' && c[7] === 'main');
  const tl = mainLines(tot, spec('tot')).modal;
  const po = ml.open.pinnacle || ml.open.draftkings;
  const to = Object.values(tot.open).map(o => o[1]).sort((a, b) => a - b); const tOpen = to.length ? to[Math.floor(to.length / 2)] : null;
  const dk = g.splits.find(x => x[1] === 'dknetwork' && x[4] === 'ml' && x[5] === 'home') || g.splits.find(x => x[1] === 'vsin' && x[3] === 'draftkings' && x[4] === 'ml' && x[5] === 'home');
  const nbooks = new Set(ml.cur.map(c => c[0])).size;
  const kal = ml.cur.find(c => c[0] === 'kalshi' && c[5] === 'kalshi' && c[1] === 'home' && (c[8] || {}).volume_24h);
  return { ml, spL, tot, rows, b0, b1, pa, pb, tl, po, tOpen, dk, nbooks, kal };
}
function renderSlate() {
  const secs2 = [['games', 'Games'], ['movers', 'Movers'], ['market', 'Market'], ['props', 'Props'], ['yours', 'Your lines']];
  const nav = `<div class="snav">${['Games', 'Books → Market', 'Spotlights', 'Specials', 'Model', 'Your lines', 'Props'].map((n, i) => `<button class="${['Games', 'Books → Market', 'Props', 'Your lines'].includes(n) && S.slateSec === ({ 'Games': 'games', 'Books → Market': 'market', 'Props': 'props', 'Your lines': 'yours' })[n] ? 'on' : ''}" data-ssec="${({ 'Games': 'games', 'Books → Market': 'market', 'Props': 'props', 'Your lines': 'yours' })[n] || ''}">${n}</button>`).join('')}</div>`;
  return `
  <div class="stub"><b style="color:var(--ink)">MLB · Thursday, Sep 24</b> — the Slate. Sections that don't change (Spotlights, Specials, Model) are not repeated here.</div>
  ${nav}
  ${slateGames()}${slateMovers()}${slateMarket()}${slateProps()}`;
}
function slateGames() {
  const cards = MLB.map((g, gi) => {
    const v = mlbView(g), e = g.espn;
    const live = e.status !== 'Scheduled';
    const mvd = v.po && v.pa ? Math.round((dec(v.po[2]) - dec(v.pa[3])) * 100) : 0;
    const team = (t, q, best, side) => `<img src="${t.logo}" alt="" loading="lazy"><div><div class="nm">${esc(t.name.split(' ').slice(-1)[0] === 'Sox' ? t.name.split(' ').slice(-2).join(' ') : t.name.split(' ').slice(-1)[0])} ${live ? `<b style="margin-left:4px">${t.score}</b>` : ''}</div><div class="spn">${esc(t.sp || 'TBD')} · ${t.rec}</div></div>
      <span style="font-size:14px">${best ? lv(`sl|${g.key}|${side}`, best.q[3], fa(best.q[3]), 'px') : '—'}</span><span>${best ? logo(best.k, 14) : ''}</span>`;
    const edgeDot = gi === 3;
    const split = v.dk && Math.abs(v.dk[8] - v.dk[7]) >= 15;
    const fk = (v.dk ? `<div class="kvr"><span>${logo('draftkings', 12)} DK customers, ${e.home.abbr}${split ? ' <span class="st warn">split</span>' : ''}</span><span><b>${lv(`sl|${g.key}|dkm`, v.dk[8], v.dk[8] + '%')}</b> money · <b>${v.dk[7]}%</b> bets</span></div>` : '')
      + (v.kal ? `<div class="kvr"><span>${logo('kalshi', 12)} Kalshi, traded in 24 h</span><span><b>${money(v.kal[8].volume_24h)}</b></span></div>` : '');
    return `<div class="gc"><div class="top"><span>${live ? `<span class="upd" style="color:var(--bad-ink)"><i class="ld game"></i>Live · ${esc(e.detail || '')}</span>` : et(e.date.replace('T', ' ').replace('Z', ''))}</span><span>${v.nbooks} books${edgeDot ? ' · <span class="dot" style="background:var(--good);vertical-align:0" title="Edge (example)"></span> edge' : ''}</span></div>
      <div class="tm">${team(e.away, null, v.b1, 'a')}${team(e.home, null, v.b0, 'h')}</div>
      <div class="sh"><div class="sh-r"><b>Sharp prices</b>${v.pa ? liveTag(atS(v.pa[6]), 70) : ''}</div>
        ${v.pa ? `<div class="sh-r">${logo('pinnacle', 14)}<span>Pinnacle</span><span style="margin-left:auto">${e.away.abbr} <b>${lv(`sl|${g.key}|pa`, v.pb[3], fa(v.pb[3]))}</b> · ${e.home.abbr} <b>${lv(`sl|${g.key}|ph`, v.pa[3], fa(v.pa[3]))}</b></span></div>
        ${fairBar(1 - devig(v.pa[3], v.pb[3]), [e.away.abbr, e.home.abbr], ['#' + e.away.color, '#' + e.home.color])}` : `<div class="sh-r"><span class="muted">No sharp price${live ? ' — in play' : ''}</span></div>`}</div>
      <div class="ln"><span class="muted">Total</span><span><b>${lv(`sl|${g.key}|t`, v.tl, fln(v.tl))}</b>${v.tOpen != null && v.tOpen !== v.tl ? ` <span class="mv">(opened ${fln(v.tOpen)})</span>` : ''}</span>
        <span class="muted">Moved</span><span>${v.po && v.pa ? `${e.home.abbr} ${fa(v.po[2])} → ${fa(v.pa[3])}${mvd ? ` <span class="mv ${mvd > 0 ? 'dn' : 'up'}">${mvd > 0 ? 'toward' : 'away from'} ${e.home.abbr}</span>` : ' <span class="muted">flat</span>'}` : '—'}</span></div>
      ${fk ? `<div class="fk">${fk}</div>` : ''}</div>`;
  }).join('');
  return `<section class="sec">${secHead('Games', `${MLB.length} games · best moneyline across every book · the sharp line on every card`, sinceOpened())}
    ${note('SLATE · GAMES CARDS', `Each card: best moneyline per side with its book (was: 1–3 books); a <b>Sharp prices</b> row with its own live dot (Pinnacle + the no-vig split in both teams' colours); the consensus total and where it opened; how Pinnacle's price moved since open; then labelled rows for DraftKings customers' money and bets (amber "split" = a 15+ point gap) and Kalshi's 24-hour volume; an edge dot where one passes (${EX} on one card). During the replay, prices flash as they move and the split bar slides. Tap → the game page's Lines. ${REAL} ${MLB.reduce((a, g) => a + g.markets.ml.cur.length + g.markets.tot.cur.length, 0)} live quotes on this slate.`)}
    <div class="gcards">${cards}</div></section>`;
}
function slateMovers() {
  const moves = [];
  for (const g of MLB) {
    const v = mlbView(g), e = g.espn;
    if (v.po && v.pa) moves.push({ g, e, kind: 'ml', d: Math.abs(ip(v.pa[3]) - ip(v.po[2])), txt: `${e.home.abbr} moneyline ${fa(v.po[2])} → <b>${fa(v.pa[3])}</b> at Pinnacle`, since: v.po[0] });
    for (const st of v.tot.steam.slice(-2)) moves.push({ g, e, kind: 'steam', d: 0.05 + Math.abs(st.to[0] - st.from) / 10, txt: `Total ${fln(st.from)} → <b>${fln(st.to[0])}</b>: <b>${esc(bn(st.books[0]))}</b> first at ${etd(st.t)}, ${st.books.length - 1} followed in ${Math.round((tms(st.times[st.times.length - 1]) - tms(st.times[0])) / 60000)} min`, since: st.t, steam: true, last: st.times[st.times.length - 1] });
  }
  moves.sort((a, b) => b.d - a.d);
  const pulls = [];
  for (const g of MLB) for (const [mk, name] of [['ml', 'Moneyline'], ['tot', 'Total'], ['sp', 'Run line']]) {
    const m = g.markets[mk]; const rows = boardRows(m, spec(mk === 'tot' ? 'tot' : mk), mk === 'ml' ? null : mainLines(m, spec(mk === 'tot' ? 'tot' : mk)).modal);
    for (const k of Object.keys(m.hist)) if (!rows.find(r => r.k === k) && ['us', 'sharp', 'exchange'].includes(bg(k))) { const h = m.hist[k]; pulls.push({ g, k, name, t: h[h.length - 1][0] }); }
  }
  pulls.sort((a, b) => b.t.localeCompare(a.t));
  return `<section class="sec">${secHead('Movers', 'minute-level · steam · first mover · pulled')}
    ${note('SLATE · MOVERS', `Was 3 prop moves at 20-minute resolution. Now: the biggest price and line moves, steam (3+ books the same way within 45 min) with its first mover, and pulled lines as their own list. ${REAL}`)}
    <div class="g-mv"><section class="card">${cardH('Biggest moves', 'since open', slateLive())}<table class="t"><tbody>
      <tr class="grp"><td colspan="2">Steam on totals · first mover</td></tr>
      ${moves.filter(x => x.steam).slice(0, 6).map(x => `<tr data-row="slate|steam|${x.g.key}|${x.since}"><td style="white-space:normal"><div class="small"><b>${x.e.away.abbr} @ ${x.e.home.abbr}</b> ${x.steam ? '<span class="st ink">· Steam</span>' : ''}${+NOW - tsm(x.last) < 120e3 ? '<span class="just">just now</span>' : ''}</div><div class="small soft">${x.txt}</div></td><td class="r age">${etd(x.since)}</td></tr>`).join('')}
      <tr class="grp"><td colspan="2">Moneylines that moved most · Pinnacle, open → now</td></tr>
      ${moves.filter(x => !x.steam).slice(0, 6).map(x => `<tr data-row="slate|mlm|${x.g.key}"><td style="white-space:normal"><div class="small"><b>${x.e.away.abbr} @ ${x.e.home.abbr}</b></div><div class="small soft">${x.txt} <span class="muted">(${(x.d * 100).toFixed(1)} pts implied)</span></div></td><td class="r age">opened ${etd(x.since)}</td></tr>`).join('')}
      </tbody></table></section>
      <section class="card">${cardH('Pulled lines', 'US, sharp and exchange books', slateLive())}<table class="t"><tbody>
      ${pulls.slice(0, 10).map(x => `<tr class="pulled" data-row="slate|pull|${x.g.key}|${x.k}|${x.name}"><td>${book(x.k, 14)} <span class="small muted">· ${x.g.espn.away.abbr} @ ${x.g.espn.home.abbr} ${x.name}</span></td><td class="r age">${etd(x.t)}</td></tr>`).join('') || '<tr><td class="small" style="white-space:normal"><b>No book has pulled a main line on this slate right now.</b><div class="age">A line taken down and reposted at a new number is a move and is listed left; a market a book stops offering altogether lands here with the time it went.</div></td></tr>'}
      </tbody></table></section></div></section>`;
}
function slateMarket() {
  const tabs = [['edges', 'Edges'], ['board', 'Best prices'], ['openers', 'Openers vs now'], ['pulled', 'Pulled'], ['money', 'Where the money is'], ['hold', 'Lowest hold'], ['outliers', 'Line disagreements']];
  let body = '';
  const V = MLB.map(g => ({ g, e: g.espn, v: mlbView(g) }));
  if (S.hub === 'edges') {
    body = `<div class="cb"><div class="small soft" style="margin-bottom:8px">Only markets where every gate passes. ${EX} The app computes this in E1; here the gates were applied by hand to real prices.</div>
      <table class="t"><thead><tr><th>Market</th><th>Price</th><th class="r">Fair</th><th class="r">EV</th><th class="r">Ages</th></tr></thead><tbody>
      <tr><td><b>ATL @ GB</b> · spread (NFL, tonight)</td><td>GB −4.5 at ${book('betmgm', 14)} −105</td><td class="r">51.7%</td><td class="r"><b class="mv up">+1.0%</b></td><td class="r age">both &lt; 1 min</td></tr>
      <tr><td><b>Drake London</b> · receptions 5.5</td><td>Over at ${book('underdog', 14)} (implied +110)</td><td class="r">48.5%</td><td class="r"><b class="mv up">+1.8%</b></td><td class="r age">both &lt; 5 min</td></tr>
      </tbody></table><div class="age" style="margin-top:6px">Expect few and small. More than a handful above 5% at once turns edge display off (self-check).</div></div>`;
  } else if (S.hub === 'board') {
    const cols = ['pinnacle', 'circa', 'draftkings', 'fanduel', 'betmgm', 'caesars', 'fanatics', 'bet365', 'hardrockbet', 'betrivers', 'novig', 'kalshi', 'polymarket'];
    body = `<div class="scrollx"><table class="t" style="font-size:12px"><thead><tr><th>Game · moneyline</th>${cols.map(k => `<th class="c">${logo(k, 14)}<div style="font-size:10px">${esc(bn(k))}</div></th>`).join('')}</tr></thead><tbody>
      ${V.map(({ e, v }) => {
        const cell = (k, side) => { const q = v.ml.cur.find(c => c[0] === k && c[1] === side && c[7] === 'main') || v.ml.cur.find(c => c[0] === k && c[1] === side); const b = side === 'home' ? v.b0 : v.b1; return q ? `<span class="${b && b.k === k ? 'px best' : ''}" style="font-weight:600">${fa(q[3])}</span>` : '<span style="color:var(--faint)">·</span>'; };
        return `<tr><td><b>${e.away.abbr}</b><div><b>${e.home.abbr}</b></div></td>${cols.map(k => `<td class="c" style="line-height:1.35">${cell(k, 'away')}<br>${cell(k, 'home')}</td>`).join('')}</tr>`;
      }).join('')}</tbody></table></div>`;
  } else if (S.hub === 'openers') {
    body = `<table class="t"><thead><tr><th>Game</th><th class="r">Circa opener</th><th class="r">Pinnacle open → now</th><th class="r hide-ph">Total open → now</th></tr></thead><tbody>
      ${V.map(({ g, e, v }) => { const c = g.openers.find(o => o.book === 'Circa' && o.period === 'fg'); return `<tr><td><b>${e.away.abbr} @ ${e.home.abbr}</b></td><td class="r">${c ? `${e.away.abbr} ${esc(c.ml_away)} · ${esc(c.total)}` : '—'}</td><td class="r">${v.po && v.pa ? `${e.home.abbr} ${fa(v.po[2])} → <b>${fa(v.pa[3])}</b>` : '—'}</td><td class="r hide-ph">${v.tOpen != null ? `${fln(v.tOpen)} → <b>${fln(v.tl)}</b>` : '—'}</td></tr>`; }).join('')}</tbody></table>`;
  } else if (S.hub === 'pulled') {
    body = slateMovers().match(/<section class="card">.*?Pulled lines[\s\S]*?<\/section>/)[0].replace('<section class="card">', '<div>').replace(/<\/section>$/, '</div>');
  } else if (S.hub === 'money') {
    const L2 = V.map(({ g, e }) => { const d = g.splits.find(x => x[1] === 'dknetwork' && x[4] === 'ml' && x[5] === 'home') || g.splits.find(x => x[1] === 'vsin' && x[3] === 'draftkings' && x[4] === 'ml' && x[5] === 'home'); return d ? { e, d, gap: d[8] - d[7] } : null; }).filter(Boolean).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    body = `<table class="t"><thead><tr><th>Game</th><th class="r">DK money on home</th><th class="r">DK bets on home</th><th class="r">Gap</th></tr></thead><tbody>
      ${L2.map(x => `<tr><td><b>${x.e.away.abbr} @ ${x.e.home.abbr}</b></td><td class="r">${x.d[8]}%</td><td class="r">${x.d[7]}%</td><td class="r">${Math.abs(x.gap) >= 15 ? `<span class="st warn" style="font-size:13px">${x.gap > 0 ? '+' : ''}${x.gap} pts</span>` : (x.gap > 0 ? '+' : '') + x.gap}</td></tr>`).join('')}</tbody></table>
      <div class="cb age">DraftKings customers only (DK Network / VSiN). A gap is a fact about DK's customers, not a signal.</div>`;
  } else if (S.hub === 'hold') {
    const H = V.map(({ e, v }) => { const b0 = v.b0, b1 = v.b1; return b0 && b1 ? { e, h: ip(b0.q[3]) + ip(b1.q[3]) - 1, b0, b1 } : null; }).filter(Boolean).sort((a, b) => a.h - b.h);
    body = `<table class="t"><thead><tr><th>Game · moneyline</th><th>Best away</th><th>Best home</th><th class="r">Hold at best</th></tr></thead><tbody>
      ${H.map(x => `<tr><td><b>${x.e.away.abbr} @ ${x.e.home.abbr}</b></td><td>${fa(x.b1.q[3])} ${logo(x.b1.k, 14)}</td><td>${fa(x.b0.q[3])} ${logo(x.b0.k, 14)}</td><td class="r"><b>${pct(x.h)}</b></td></tr>`).join('')}</tbody></table>`;
  } else {
    const D = V.map(({ e, v }) => { const lines = v.tot.cur.filter(c => c[7] === 'main' && c[1] === 'over' && ['us', 'sharp'].includes(bg(c[0]))); const vals = [...new Set(lines.map(c => c[2]))].sort((a, b) => a - b); return vals.length > 1 ? { e, vals, lines } : null; }).filter(Boolean);
    body = `<table class="t"><thead><tr><th>Game · total</th><th>Books disagree</th></tr></thead><tbody>
      ${D.map(x => `<tr><td><b>${x.e.away.abbr} @ ${x.e.home.abbr}</b></td><td style="white-space:normal">${x.vals.map(v => `<b>${fln(v)}</b>: ${x.lines.filter(c => c[2] === v).map(c => logo(c[0], 14)).join(' ')}`).join(' &nbsp;·&nbsp; ')}</td></tr>`).join('') || '<tr><td class="muted">Every US and sharp book agrees on every total.</td></tr>'}</tbody></table>`;
  }
  return `<section class="sec">${secHead('Market', 'the odds hub — no separate odds page')}
    ${note('SLATE · BOOKS → MARKET', `"Where the books differ" becomes the Market hub: Edges (gated), a games × books best-price board, openers vs now, pulled lines, where-the-money-is leaders, lowest hold (approved idea 1) and line disagreements. Click the tabs. ${REAL} except Edges ${EX}.`)}
    <div class="hubtabs"><div class="seg">${tabs.map(([k, n]) => `<button data-hub="${k}" aria-pressed="${S.hub === k}">${n}</button>`).join('')}</div></div>
    <section class="card"><div class="ch"><h3>${tabs.find(t => t[0] === S.hub)[1]}</h3>${slateLive()}<span class="scope">MLB · today</span></div>${body}</section></section>`;
}
function slateProps() {
  const rows = [];
  const seen = new Set();
  for (const g of MLB) {
    for (const [pl, kp] of Object.entries(g.kprops)) {
      const nm = pl.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      if (seen.has(nm)) { continue; } seen.add(nm);
      const m = { cur: kp.cur, open: kp.open, hist: {} };
      const all = Object.entries(g.kprops).filter(([p]) => p.toLowerCase() === pl.toLowerCase()).flatMap(([, v]) => v.cur);
      m.cur = all;
      const sp = spec('prop'), L = mainLines(m, sp).modal; const br = boardRows(m, sp, L), b0 = bestOf(br, 0), b1 = bestOf(br, 1), p = pinAt(m, sp, L);
      const ops = Object.values(kp.open).map(o => o[1]).filter(v => v != null).sort((a, b) => a - b);
      const opM = ops.length ? ops[Math.floor(ops.length / 2)] : null;
      rows.push({ nm, g, L, b0, b1, p, n: new Set(all.map(c => c[0])).size, age: Math.min(...br.map(r => r.age)), opM, head: Object.entries(g.kprops).filter(([p2]) => p2.toLowerCase() === pl.toLowerCase()).map(([, v]) => v.head).find(Boolean) });
    }
  }
  rows.sort((a, b) => b.n - a.n);
  return `<section class="sec">${secHead('Props', 'pitcher strikeouts · the Scan table with its new columns')}
    ${note('SLATE · PROPS / SCAN', `The Scan table is frozen (D3) — only the columns change. D5 already unfreezes it for <b>Edge</b>; <b>Sharp, Books, Checked, Open → now</b> and the pulled marker need your OK to join it (highlighted). ${REAL} strikeout props from ${new Set(rows.flatMap(r => [])).size || 'up to 17'} books per pitcher.`)}
    <section class="card">${cardH('Pitcher strikeouts', 'Scan', slateLive())}<div class="scrollx"><table class="t"><thead><tr><th>Pitcher</th><th class="r">Line</th><th class="r">Best over</th><th class="r">Best under</th>
      <th class="r" style="background:#fff3dc">Sharp</th><th class="c" style="background:#fff3dc">Edge</th><th class="r" style="background:#fff3dc">Books</th><th class="r" style="background:#fff3dc">Checked</th><th style="background:#fff3dc">Open → now</th></tr></thead><tbody>
      ${rows.slice(0, 16).map((r, i) => `<tr><td><span class="bk">${r.head ? head(r.head, r.nm, 26) : ''}<span><b>${esc(r.nm)}</b> <span class="age">${r.g.espn.away.abbr} @ ${r.g.espn.home.abbr}</span></span></span></td><td class="r"><b>${fln(r.L)}</b></td>
        <td class="r">${r.b0 ? `${lv('scan|' + r.nm + '|o', r.b0.q[3], fa(r.b0.q[3]), 'px')} ${logo(r.b0.k, 14)}` : '—'}</td><td class="r">${r.b1 ? `${lv('scan|' + r.nm + '|u', r.b1.q[3], fa(r.b1.q[3]), 'px')} ${logo(r.b1.k, 14)}` : '—'}</td>
        <td class="r">${r.p ? `${fa(r.p.a[3])}/${fa(r.p.b[3])}` : '<span class="muted">—</span>'}</td><td class="c">${r.p ? '<span class="muted small">gated</span>' : '<span class="muted small">no sharp</span>'}</td>
        <td class="r">${r.n}</td><td class="r age">${isFinite(r.age) ? agoS(r.age) : '—'}</td><td>${r.opM != null && r.opM !== r.L ? `<span class="mv">${fln(r.opM)} → ${fln(r.L)}</span>` : '<span class="muted">—</span>'}</td></tr>`).join('')}
      </tbody></table></div></section></section>`;
}

// ------------------------------------------------------------------ elsewhere
function renderElse() {
  const m = P.markets.rec_yds, dk = (m.moves || []).filter(x => x[1] === 'draftkings').slice(-1)[0];
  const st = (m.steam || []).find(c => c.books[0] === 'pinnacle');
  const nv = P.markets.receptions.cur.find(c => c[0] === 'novig' && c[1] === 'over' && c[2] === 5.5);
  const fd = P.markets.receptions.cur.find(c => c[0] === 'fanduel' && c[1] === 'over' && c[2] === 5.5);
  const sao = O.nfl.splits.find(s => s[1] === 'sao_consensus' && s[4] === 'sp' && s[5] === 'away');
  const g0 = MLB[0];
  return `
  ${note('ELSEWHERE (O8)', `Three surfaces that reuse the same data: Your lines alerts, the bet slip, and odds-derived research flags. Every alert below is a real event from the snapshot. ${REAL}`)}
  <section class="sec">${secHead('Your lines', 'alerts')}
    <div class="grid2"><section class="card">${cardH('Alerts', 'from lines you track', liveTag(srcChecked('draftkings'), 70))}
      <div class="alert"><div class="ic" style="background:var(--sunk)">↗</div><div><div class="small"><b>Drake London receiving yards</b> — your line moved</div><div class="small soft">${book('draftkings', 14)} ${dk ? `${fln(dk[2])} → <b>${fln(dk[3])}</b>` : ''}</div></div><span class="age">${dk ? etd(dk[0]) : ''}</span></div>
      <div class="alert"><div class="ic" style="background:var(--good-tint);color:var(--good-ink)">$</div><div><div class="small"><b>Drake London receptions 5.5 over</b> — a better price appeared</div><div class="small soft">${book('novig', 14)} <b>${fa(nv && nv[3])}</b> vs your ${book('fanduel', 14)} ${fa(fd && fd[3])}</div></div><span class="age">${nv ? etd(nv[4]) : ''}</span></div>
      <div class="alert"><div class="ic" style="background:var(--bad-tint);color:var(--bad-ink)">✕</div><div><div class="small"><b>Drake London receiving yards 66.5</b> — pulled at DraftKings</div><div class="small soft">DraftKings took 66.5 down and reposted at 67.5</div></div><span class="age">${dk ? etd(dk[0]) : ''}</span></div>
      ${st ? `<div class="alert"><div class="ic" style="background:var(--char);color:var(--char-ink)">⚡</div><div><div class="small"><b>Steam on a line you track</b></div><div class="small soft">Pinnacle moved ${fln(st.from)} → ${fln(st.to[0])} first; ${st.books.length - 1} books followed within ${Math.round((tms(st.times[st.times.length - 1]) - tms(st.times[0])) / 60000)} min</div></div><span class="age">${etd(st.t)}</span></div>` : ''}
    </section>
    <section class="card">${cardH('Bet slip', '1 leg')}<div class="cb">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><div class="small"><b>Drake London</b> over 5.5 receptions</div><div class="age">ATL @ GB · tonight ${et(G.start)}</div></div><span class="small" style="text-align:right"><span class="muted">Your book</span><br>${book('fanduel', 12)} <b>${fa(fd && fd[3])}</b></span></div>
      <div class="bpx" style="margin-top:10px;display:flex;justify-content:space-between;align-items:center"><div><div class="ov">Best right now</div><div style="font-size:18px;font-weight:650">${fa(nv && nv[3])} <span class="small">${book('novig', 14)}</span></div><div class="age">checked ${nv ? agoS(nv[6]) : '—'} ago · ${book('fanduel', 12)} is ${nv && fd ? Math.round((dec(nv[3]) - dec(fd[3])) * 100) : '—'}¢ worse</div></div><button class="btn" style="background:var(--char);color:var(--char-ink);border-color:var(--char)">Open at Novig ↗</button></div>
      <div class="age" style="margin-top:8px">"Open at book" deep links come from B5 (comparenbet's per-book event links are already stored).</div></div></section></div>
  </section>
  <section class="sec">${secHead('Research flags', 'odds-derived, shown like every other flag')}
    <section class="card">${cardH('Odds flags', 'ATL @ GB · tonight', liveTag(srcChecked('pinnacle'), 70))}
      ${st ? `<div class="flr"><span class="st ink" style="font-size:12px">Steam</span><span>Drake London receiving yards up ${fln(st.to[0] - st.from)} at ${st.books.length} books after Pinnacle moved first</span><span class="age">${etd(st.t)}</span></div>` : ''}
      ${sao ? `<div class="flr"><span class="st warn" style="font-size:12px">Money and bets split</span><span>ATL +4.5: ${sao[8]}% of the money on ${sao[7]}% of the bets <span class="muted">(ScoresAndOdds)</span></span><span class="age">${etd(sao[0])}</span></div>` : ''}
      <div class="flr"><span class="st bad" style="font-size:12px">Pulled</span><span>DraftKings pulled London 66.5 and reposted at 67.5</span><span class="age">${dk ? etd(dk[0]) : ''}</span></div>
      <div class="flr"><span class="st ink" style="font-size:12px">First mover</span><span>Pinnacle led the London receiving-yards move by 38 min</span><span class="age">${st ? etd(st.t) : ''}</span></div>
    </section>
    <div class="age" style="margin-top:8px">A flag is a <code>slate_rankings</code> row like the others (CLAUDE.md "research flags"). On the player page they sit in the flags area; on the team and game pages, in a card like this one — a labelled row each: the kind of flag, one sentence, and when.</div></section>`;
}

// ------------------------------------------------------------------ shell
const SURF = [['player', 'Player page'], ['game', 'Game page'], ['final', 'Game page · final'], ['team', 'Team page'], ['slate', 'Slate'], ['else', 'Alerts · slip · flags']];
/** Patch `a` to look like `b` without replacing nodes that did not change, so images, scroll positions,
 *  open <details> and CSS transitions survive a live re-render. Rows with data-row are matched by key. */
function syncAttrs(x, y) {
  for (const at of [...x.attributes]) if (!y.hasAttribute(at.name) && !(at.name === 'open' && x.tagName === 'DETAILS')) x.removeAttribute(at.name);
  for (const at of [...y.attributes]) {
    if (at.name === 'class') { const keep = [...x.classList].filter(c => c.startsWith('fx-')); const v = (at.value + ' ' + keep.join(' ')).trim(); if (x.getAttribute('class') !== v) x.setAttribute('class', v); }
    else if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
  }
}
function morphKids(a, b) {
  const byKey = new Map();
  for (const x of a.childNodes) if (x.nodeType === 1 && x.dataset.row) byKey.set(x.dataset.row, x);
  let ref = a.firstChild;
  for (const y of [...b.childNodes]) {
    let x = null;
    if (y.nodeType === 1 && y.dataset.row) { x = byKey.get(y.dataset.row) || null; if (x) byKey.delete(y.dataset.row); }
    else if (ref && !(ref.nodeType === 1 && ref.dataset.row) && ref.nodeName === y.nodeName) x = ref;
    if (x && x.nodeName === y.nodeName) {
      if (x === ref) ref = ref.nextSibling; else a.insertBefore(x, ref);
      if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; }
      else if (x.tagName === 'IMG') syncAttrs(x, y);
      else { syncAttrs(x, y); if (!x.hasAttribute('data-keep')) morphKids(x, y); }
    } else a.insertBefore(y, ref);
  }
  while (ref) { const n = ref.nextSibling; a.removeChild(ref); ref = n; }
}
const fx = (el, c) => { el.classList.remove(c); void el.offsetWidth; el.classList.add(c); };
const ping = card => card && card.querySelectorAll('.ch .ld, .sh-r .ld').forEach(d => { d.classList.remove('ping'); void d.offsetWidth; d.classList.add('ping'); });
/** After a render: on a clock render, flash every value that changed, animate pulls, new rows and edge folds. */
function afterRender(live) {
  const f = $('#frame'), t = +NOW, next = {};
  f.querySelectorAll('[data-lv]').forEach(el => {
    const k = el.dataset.lv, v = el.dataset.v, pv = PREV[k];
    next[k] = v;
    if (!live || pv == null || v === '' || pv === '' || pv === v || isNaN(+v) || isNaN(+pv)) return;
    const d = Math.sign(+v - +pv); if (!d) return;
    CHG[k] = { t, d };
    el.classList.remove(d > 0 ? 'fx-dn' : 'fx-up');
    fx(el, d > 0 ? 'fx-up' : 'fx-dn');
    el.setAttribute('data-recent', '');
    const nx = el.nextElementSibling;
    if (nx && nx.classList.contains('trail')) nx.remove();
    el.insertAdjacentHTML('afterend', `<span class="trail ${d > 0 ? 'up' : 'dn'}" data-trail="${t}">${d > 0 ? '▲' : '▼'}<span data-at="${t}">&lt;5 s</span></span>`);
    ping(el.closest('.card, .gc'));
  });
  PREV = next;
  const rows = {};
  f.querySelectorAll('[data-row]').forEach(el => {
    const k = el.dataset.row, st = el.dataset.st || 'on';
    rows[k] = st;
    if (!live || !ROWST) return;
    const was = ROWST[k];
    if (was == null) fx(el, 'fx-in');
    else if (was === 'on' && st === 'pulled') { fx(el, 'fx-pull'); PULLED[k] = t; ping(el.closest('.card')); }
    else if (was === 'pulled' && st === 'on') { fx(el, 'fx-back'); delete PULLED[k]; }
  });
  ROWST = rows;
  if (live) f.querySelectorAll('[data-fx]').forEach(el => { if (el.dataset.fx) fx(el, 'fx-' + el.dataset.fx); });
}
function render(live) {
  $('#surf').innerHTML = SURF.map(([k, n]) => `<button data-surf="${k}" aria-pressed="${S.surf === k}">${n}</button>`).join('');
  const f = $('#frame');
  f.className = 'frame ' + S.w + (S.notes ? '' : ' hide-notes') + (S.showRecent ? ' show-recent' : '');
  const fn = { player: renderPlayer, game: renderGame, final: renderFinal, team: renderTeam, slate: renderSlate, else: renderElse }[S.surf];
  LIVE_RENDER = !!live;
  let html;
  try { html = fn(); } catch (e) { html = `<pre style="color:#c4161c;white-space:pre-wrap">${esc(e.stack)}</pre>`; console.error(e); }
  const tmp = document.createElement('div'); tmp.innerHTML = html;
  // any table not already in a horizontal scroller gets one (phone widths)
  tmp.querySelectorAll('table.t').forEach(t => { if (!t.parentElement.classList.contains('scrollx')) { const w = document.createElement('div'); w.className = 'scrollx'; t.replaceWith(w); w.appendChild(t); } });
  if (f.dataset.surf === S.surf && f.dataset.w === S.w) morphKids(f, tmp); else { f.innerHTML = ''; f.append(...tmp.childNodes); ROWST = null; }
  f.dataset.surf = S.surf; f.dataset.w = S.w;
  document.querySelectorAll('[data-chart]').forEach(drawChart);
  afterRender(live);
  LIVE_RENDER = false;
  updClock();
}
// ------------------------------------------------------------------ the clock
function updTickers() {
  const t = +NOW;
  document.querySelectorAll('#frame [data-at]').forEach(el => { const txt = ago(Math.max(0, (t - +el.dataset.at) / 1000)); if (el.textContent !== txt) el.textContent = txt; });
  document.querySelectorAll('#frame [data-trail]').forEach(el => { const s = (t - +el.dataset.trail) / 1000; el.style.opacity = s >= TRAIL_S ? 0 : Math.max(0.15, 1 - s / TRAIL_S).toFixed(2); });
  document.querySelectorAll('#frame [data-live]').forEach(el => {
    const s = Math.max(0, (t - +el.dataset.live) / 1000), st = liveState(s, +el.dataset.cad), d = el.querySelector('.ld');
    el.classList.toggle('slow', st === 'slow');
    if (d) { d.classList.toggle('slow', st === 'slow'); d.classList.toggle('off', st === 'off'); }
    const txt = liveTxt(s, st); if (el.lastChild.textContent !== txt) el.lastChild.textContent = txt;
  });
}
function updClock() {
  const t = CLK.t, start = +END - 3600e3, replay = t < +END;
  const clock = new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  $('#rpClock').innerHTML = replay ? `<b>Replaying</b> · ${clock} ET · ${Math.max(1, Math.round((+END - t) / 60000))} min before the snapshot` : `<b>Live</b> · ${clock} ET · past the snapshot, so no newer data arrives`;
  $('#rpBar').style.width = Math.min(100, 100 * (t - start) / (+END - start)) + '%';
  $('#rpPlay').textContent = CLK.play ? '❚❚ Pause' : '▶ Play';
}
function tick() {
  const w = performance.now(), dt = CLK.wall ? Math.min(2, (w - CLK.wall) / 1000) : 0;
  CLK.wall = w;
  if (CLK.play) {
    const before = CLK.t;
    CLK.t += dt * 1000 * (CLK.t < +END ? CLK.speed : 1);
    if (before < +END && CLK.t >= +END) CLK.t = +END;   // land on the snapshot, then run at 1x
  }
  const m = Math.floor(CLK.t / 60000);
  if (m !== CLK.min) { CLK.min = m; setTime(CLK.t); render(true); }
  else NOW = new Date(CLK.t);
  updTickers(); updClock();
}
function restart() {
  CLK.t = +END - 3600e3; CLK.openT = CLK.t; CLK.min = Math.floor(CLK.t / 60000); CLK.play = true;
  PREV = {}; CHG = {}; ROWST = null; EDGE_ST = {}; SEEN = {}; CHART_N = {}; PULLED = {};
  setTime(CLK.t); render(false);
}
document.addEventListener('click', ev => {
  const t = ev.target.closest('button,a'); if (!t) return;
  const d = t.dataset;
  if (d.surf) { S.surf = d.surf; S.sel = null; S.metric = null; S.expand = null; S.showRecent = false; CLK.openT = CLK.t; SEEN = {}; }
  else if (d.recentToggle) S.showRecent = !S.showRecent;
  else if (d.sp) { CLK.speed = +d.sp; document.querySelectorAll('#rpSpeed button').forEach(b => b.setAttribute('aria-pressed', b.dataset.sp === d.sp)); return; }
  else if (d.w) { S.w = d.w; document.querySelectorAll('#width button').forEach(b => b.setAttribute('aria-pressed', b.dataset.w === S.w)); }
  else if (d.pm) { S.pm = d.pm; S.pline = null; S.sel = null; S.metric = null; }
  else if (d.pstep) { const m = P.markets[S.pm], ls = allLines(m, spec('prop'), S.pm === 'anytime_td' ? 0 : Math.max(4, Math.abs(mainLines(m, spec('prop')).modal || 0) * 0.2)); const i = ls.indexOf(S.pline) + +d.pstep; if (ls[i] != null) S.pline = ls[i]; }
  else if (d.all) S.all = d.all === '1';
  else if (d.gall) S.gall = d.gall === '1';
  else if (d.gper) { S.gper = d.gper; S.gline = null; S.sel = null; S.metric = null; }
  else if (d.gmk) { S.gmk = d.gmk; S.gline = null; S.sel = null; S.metric = null; }
  else if (d.gstep) { const key = gKey(S.gper, S.gmk), m = O.nfl.markets[key], k2 = S.gmk.startsWith('tt') ? 'tot' : S.gmk, ls = allLines(m, spec(k2), k2 === 'sp' ? 4 : 5); const i = ls.indexOf(S.gline) + +d.gstep; if (ls[i] != null) S.gline = ls[i]; }
  else if (d.win) S.win = d.win;
  else if (d.metric) S.metric = d.metric;
  else if (d.bk) { S.sel = S.sel.includes(d.bk) ? S.sel.filter(k => k !== d.bk) : [...S.sel, d.bk]; }
  else if (d.preset) {
    const c = CHARTS[Object.keys(CHARTS).find(k => document.querySelector(`[data-chart="${k}"]`))]; const books = Object.keys(c.m.hist);
    const cnt = k => c.m.hist[k].length;
    S.sel = d.preset === 'sharp' ? books.filter(k => ['sharp', 'exchange'].includes(bg(k))) : d.preset === 'mine' ? books.filter(k => k === USER_BOOK || k === 'pinnacle') : d.preset === 'most' ? books.filter(k => bg(k) !== 'pickem').sort((a, b) => cnt(b) - cnt(a)).slice(0, 5) : d.preset === 'all' ? books.filter(k => !['intl', 'offshore'].includes(bg(k))) : [];
  }
  else if (d.allchips) S.allChips = d.allchips === '1';
  else if (d.fpt) S.fp.team = d.fpt;
  else if (d.fpr) S.fp.res = d.fpr;
  else if (d.fpm) S.fp.mk = d.fpm;
  else if (d.fpv) S.fp.view = d.fpv;
  else if (d.fpmore) S.fpMore = true;
  else if (d.pft) S.pf.team = d.pft;
  else if (d.pfp) S.pf.pos = d.pfp;
  else if (d.pfm) S.pf.mk = d.pfm;
  else if (d.pfs) S.pf.sort = d.pfs;
  else if (d.pfv) S.pf.view = d.pfv;
  else if (d.pfmore) S.pfMore = true;
  else if (d.goto != null) { const v = +d.goto; if (S.surf === 'player') S.pline = v; else S.gline = v; }
  else if (d.hub) S.hub = d.hub;
  else if (d.expand) S.expand = [...(S.expand || []), d.expand];
  else if (d.ssec) { const el = document.querySelectorAll('.sec')[['games', 'movers', 'market', 'props'].indexOf(d.ssec)]; if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  else if (d.go) { ev.preventDefault(); S.surf = d.go; S.sel = null; }
  else return;
  render();
});
$('#width').addEventListener('click', () => {});
$('#toTop').addEventListener('click', () => window.scrollTo({ top: 0 }));
$('#toBottom').addEventListener('click', () => window.scrollTo({ top: document.documentElement.scrollHeight }));
$('#notes').addEventListener('change', e => { S.notes = e.target.checked; render(); });
window.addEventListener('resize', () => document.querySelectorAll('[data-chart]').forEach(drawChart));
$('#asof').textContent = END.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
$('#rpPlay').addEventListener('click', () => { CLK.play = !CLK.play; updClock(); });
$('#rpRestart').addEventListener('click', restart);
$('#rm').addEventListener('change', e => document.body.classList.toggle('rm', e.target.checked));
restart();
setInterval(tick, 250);
})();
