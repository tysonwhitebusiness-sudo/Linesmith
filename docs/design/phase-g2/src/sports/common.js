/* Shared player page composer. Each sport supplies a spec; the page is the same skeleton everywhere,
   and the cards inside differ where the sport differs. */
const SPORTS = {};
const DATA = {};

function loadData(name) {
  if (!DATA[name]) { const el = document.getElementById(`data-${name}`); DATA[name] = el ? JSON.parse(el.textContent) : null; }
  return DATA[name];
}

const sumK = (gs, k) => U.sum(gs.map((g) => U.st(g, k)));
const perG = (gs, k) => (gs.length ? sumK(gs, k) / gs.length : null);
const col = (key, label, fn, dec = 0) => ({ key, label, fn, dec });
const tot = (k) => (gs) => sumK(gs, k);
const pg = (k) => (gs) => perG(gs, k);
const one = (k) => (g) => U.st(g, k);

function currentSeasonGames(doc) {
  const seasons = [...new Set(doc.games.map((g) => g.season))];
  const cur = seasons[seasons.length - 1];
  const gs = doc.games.filter((g) => g.season === cur);
  // Two games into a new season isn't a season yet: show last season beside it.
  const prev = doc.games.filter((g) => g.season === cur - 1);
  return { cur, gs, prev, early: gs.length < 8 && prev.length > 0 };
}

function playerHero(doc, spec) {
  const b = doc.bio || {};
  const { cur, gs, prev, early } = currentSeasonGames(doc);
  const tiles = spec.tiles ? spec.tiles(early ? prev : gs, doc) : [];
  const record = gs.filter((g) => g.result).length ? `${gs.filter((g) => g.result === 'W').length}-${gs.filter((g) => g.result === 'L').length}${gs.some((g) => g.result === 'D') ? `-${gs.filter((g) => g.result === 'D').length}` : ''} in games played` : null;
  return h('section', { class: 'hero' },
    h('div', { class: 'hero-p' },
      avatar(b.headshot, 96, { color: spec.color || '#3a3f46', label: b.name }),
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'row', style: { gap: '10px' } }, h('div', { class: 't-heading' }, b.name || doc.slug), b.jersey ? h('span', { class: 'chip' }, `#${b.jersey}`) : null, b.posAbbr || b.position ? h('span', { class: 'chip' }, b.posAbbr || b.position) : null),
        h('div', { class: 'row t-sm ink2', style: { marginTop: '6px' } }, b.teamLogo ? avatar(b.teamLogo, 22, { logo: true, label: b.team }) : null, b.team ? h('a', { class: 'lnk', href: '#team' }, b.team) : null, spec.heroLine ? h('span', { class: 'muted' }, spec.heroLine(doc)) : null),
        h('div', { style: { marginTop: '10px' } }, factList(spec.facts ? spec.facts(doc) : []))),
      h('div', { class: 'stack', style: { minWidth: '220px' } },
        cur == null ? h('div', { class: 't-over' }, spec.heroSeason || 'Season') : h('div', { class: 't-over' }, early ? `${U.seasonLabel(doc.sport, cur - 1)} season (${U.seasonLabel(doc.sport, cur)}: ${gs.length} ${gs.length === 1 ? 'game' : 'games'})` : `${U.seasonLabel(doc.sport, cur)} season`),
        record && !early ? h('div', { class: 't-label' }, record) : null,
        statusPill('Next game · from the schedule in the full build'))),
    tiles.length ? h('div', { style: { marginTop: 'var(--s4)', paddingTop: 'var(--s4)', borderTop: '1px solid var(--line-soft)' } }, statGrid(tiles)) : null);
}

function buildPlayerPage(doc, spec, ctx) {
  if (spec.transform) doc = spec.transform(doc);
  const periodLabel = spec.periodLabel || ((g) => U.shortDate(g.date));
  const openGame = (date) => { const g = doc.games.find((x) => x.date === date); if (g) Drill.open(`${g.home ? 'vs' : '@'} ${g.oppAbbr || '—'}`, `${U.longDate(g.date)}${g.result ? ` · ${g.result} ${U.score(g)}` : ''}`, factList(Object.entries(g.stats).map(([k, v]) => [k, fmt.n(v, v % 1 ? 1 : 0)]))); };
  const sections = [];
  sections.push({ id: 'props', label: 'Prop analysis', node: section('props', 'Prop analysis', 'kept from today\'s design', spec.propsNode ? spec.propsNode(doc) : propBlock({ sport: doc.sport, markets: doc.markets || [], periodLabel, onOpenGame: openGame })) });
  if (doc.games.length) {
    sections.push({ id: 'seasons', label: 'Seasons', node: section('seasons', 'Season by season', 'totals and per-game rates from every game held', card({ title: spec.seasonTitle || 'Season stats', scope: `${doc.games.length} games held`, dense: true, body: seasonTable({ sport: doc.sport, games: doc.games, cols: spec.seasonCols }), foot: spec.seasonFoot })) });
    const cmpDoc = spec.compareSlug ? loadData(`player-${spec.compareSlug}`) : null;
    sections.push({ id: 'trends', label: 'Trends', node: section('trends', 'Trends', null, trendCard({ sport: doc.sport, games: doc.games, stats: spec.trendStats, periodLabel, compare: cmpDoc && cmpDoc.games.length ? { name: cmpDoc.bio?.name || spec.compareSlug, games: cmpDoc.games, on: false } : null })) });
    sections.push({ id: 'splits', label: 'Splits', node: section('splits', 'Splits', 'per-game averages', card({ title: 'Situational splits', scope: 'current season', dense: true, body: splitsTable({ games: doc.games, cols: spec.splitCols || spec.seasonCols.slice(0, 6), splits: spec.splits ? spec.splits(doc.games) : standardSplits(doc.games, doc.sport) }), foot: 'Home/away, results, rest and months from game logs; opponent splits sit in the prop analysis chips' })) });
  }
  for (const adv of (spec.advanced ? spec.advanced(doc, ctx) : [])) sections.push(adv);
  if (doc.games.length) sections.push({ id: 'log', label: 'Game log', node: section('log', 'Game log', null, gameLog({ sport: doc.sport, games: doc.games, cols: spec.logCols, periodLabel })) });
  sections.push({ id: 'odds', label: 'Odds', node: section('odds', 'Odds & prices', null, oddsCard(doc.markets || []), card({ title: 'Sources for this page', dense: true, body: h('ul', { class: 't-sm ink2', style: { margin: 0, paddingLeft: '18px' } }, ...doc.sources.map((x) => h('li', null, x)), ...Object.entries(doc.status || {}).map(([k, v]) => h('li', null, `${k}: `, statusPill(v)))) })) });
  return sections;
}
