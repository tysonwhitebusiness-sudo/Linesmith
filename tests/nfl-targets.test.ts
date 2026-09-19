import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { cfbEfficiencySection, nflTargetRole, nflTargetRoleFromKind, nflTargetsSection, type NflTarget, type NflTargetsPayload } from '../lib/sports/nfl/targetShapes';
import { MARKETS_BY_POSITION } from '../lib/sports/nfl/adapter';

/**
 * R6.2 — NFL's "Usage & depth" / "Where he throws", built from G2's own Lamb
 * rows (`player-nfl-lamb.json`: [season, week, airYards, side, band, yac,
 * caught, td, int] per located target, the same nflverse fields
 * `nfl_target_events` stores).
 */
const g2 = JSON.parse(readFileSync('docs/design/phase-g2/data/player-nfl-lamb.json', 'utf8')) as {
  targets: { targets: Array<[number, number, number | null, string | null, string | null, number | null, boolean, boolean, boolean]> };
};
const TARGETS: NflTarget[] = g2.targets.targets.map((t) => [t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7]]);
const SEASONS = [...new Set(TARGETS.map((t) => t[0]))].sort((a, b) => a - b);
const payload = (over: Partial<NflTargetsPayload> = {}): NflTargetsPayload => ({
  gsisId: '00-0036322',
  role: 'receiver',
  seasons: SEASONS,
  targets: TARGETS,
  asOf: '2026-09-15T06:00:00Z',
  ...over,
});
const input = (over: Partial<Parameters<typeof nflTargetsSection>[0]> = {}) => ({ season: null, data: payload(), loading: false, error: null, ...over });

test('a receiver gets the chart, the zone table and the season profile, in G2s order', () => {
  const sec = nflTargetsSection(input());
  assert.equal(sec.state.kind, 'ready');
  assert.equal(sec.id, 'usage');
  assert.equal(sec.title, 'Usage & depth');
  assert.deepEqual(sec.rows.map((r) => r.map((c) => c.key)), [['field', 'zones'], ['bySeason']]);
  // It opens on the latest season held, and offers every one, newest first.
  assert.equal(sec.season?.value, SEASONS[SEASONS.length - 1]);
  assert.deepEqual(sec.season?.options.map((o) => o.value), [...SEASONS].reverse());
});

test('it opens on the page scope season, which falls back while the newest has barely started', () => {
  const newest = SEASONS[SEASONS.length - 1];
  const full = nflTargetsSection(input());
  assert.equal(full.season?.value, newest, 'with no scope it opens on the newest season held');
  // Two weeks in, the hero scopes the page to last season (SEASON_MIN_GAMES);
  // the section follows it rather than counting its own rows (R6 audit).
  const previous = SEASONS[SEASONS.length - 2];
  assert.equal(nflTargetsSection(input({ scopeSeason: previous })).season?.value, previous);
  assert.equal(nflTargetsSection(input({ scopeSeason: previous, season: newest })).season?.value, newest, 'a chosen season wins');
});

test('every located target of the chosen season is a dot, grouped by what happened', () => {
  const season = SEASONS[SEASONS.length - 1];
  const rows = TARGETS.filter((t) => t[0] === season);
  const located = rows.filter((t) => t[2] != null && t[3] != null);
  const chart = nflTargetsSection(input({ season })).rows[0][0];
  assert.ok(chart.kind === 'scatter');
  assert.equal(chart.surface, 'field');
  assert.equal(chart.points.length, located.length);
  assert.equal(chart.points.filter((p) => p[0] === 'touchdown').length, located.filter((t) => t[7]).length);
  assert.equal(chart.points.filter((p) => p[0] === 'incomplete').length, located.filter((t) => !t[6]).length);
  // Air yards are the y value, unclamped and negative for a screen.
  assert.deepEqual(chart.points.map((p) => p[2]).sort((a, b) => a - b)[0], Math.min(...located.map((t) => t[2] as number)));
  assert.ok(chart.points.every((p) => p[1] >= -1 && p[1] <= 1), 'the lateral position stays on the field');
  assert.deepEqual(chart.defaultVisible, chart.groups.map((g) => g.key), 'every group is shown to start');
});

test('the zone table is the same six cells G2 shows, with catch rate and YAC per catch', () => {
  const season = SEASONS[SEASONS.length - 1];
  const located = TARGETS.filter((t) => t[0] === season && t[2] != null && t[3] != null);
  const zones = nflTargetsSection(input({ season })).rows[0][1];
  assert.ok(zones.kind === 'table');
  assert.deepEqual(zones.rows.map((r) => r.key), ['deep-left', 'deep-middle', 'deep-right', 'short-left', 'short-middle', 'short-right']);
  const sl = zones.rows.find((r) => r.key === 'short-left')!;
  const cell = located.filter((t) => t[4] === 'short' && t[3] === 'left');
  const caught = cell.filter((t) => t[6]);
  assert.equal(sl.values.n, cell.length);
  assert.equal(Math.round(sl.values.share as number), Math.round((100 * cell.length) / located.length));
  assert.equal(Math.round(sl.values.caught as number), Math.round((100 * caught.length) / cell.length));
  const yacs = caught.map((t) => t[5]).filter((v): v is number => v != null);
  assert.equal(Math.round((sl.values.yac as number) * 10), Math.round((yacs.reduce((a, b) => a + b, 0) / yacs.length) * 10), 'YAC is over catches, not over targets');
  assert.equal(zones.columns.some((c) => c.key === 'int'), false, 'interceptions are not held');
});

test('the season table counts every target, located or not, newest first', () => {
  const bySeason = nflTargetsSection(input()).rows[1][0];
  assert.ok(bySeason.kind === 'table');
  assert.deepEqual(bySeason.rows.map((r) => r.key), [...SEASONS].reverse().map(String));
  const top = bySeason.rows[0];
  const rows = TARGETS.filter((t) => t[0] === SEASONS[SEASONS.length - 1]);
  assert.equal(top.values.n, rows.length);
  const air = rows.map((t) => t[2]).filter((v): v is number => v != null);
  assert.equal(Math.round((top.values.adot as number) * 10), Math.round((air.reduce((a, b) => a + b, 0) / air.length) * 10));
  assert.match(bySeason.caption ?? '', /Interceptions: not held/);
});

test('a quarterback gets his own section, wording and role, and never the targets thrown to him', () => {
  const sec = nflTargetsSection(input({ data: payload({ role: 'passer' }) }));
  assert.deepEqual([sec.id, sec.title, sec.navLabel], ['depth', 'Where he throws', 'Where he throws']);
  const chart = sec.rows[0][0];
  assert.ok(chart.kind === 'scatter' && chart.title === 'Pass chart');
  const zones = sec.rows[0][1];
  assert.ok(zones.kind === 'table');
  assert.equal(zones.columns.find((c) => c.key === 'caught')!.label, 'Comp %');
  assert.equal(nflTargetRole('QB'), 'passer');
  assert.deepEqual([nflTargetRole('WR'), nflTargetRole('TE'), nflTargetRole('RB')], ['receiver', 'receiver', 'receiver']);
  assert.equal(nflTargetRole('CB'), null, 'a defender has no chart');
  assert.equal(nflTargetRole(null), null, 'no position, no guess');
});

test('a bio with no position falls back to the box scores, like the page does elsewhere', () => {
  // `footballResearchSpec` already reads the box scores when a bio carries no
  // position; the section follows the same answer instead of showing nothing.
  assert.equal(nflTargetRoleFromKind('quarterback'), 'passer');
  assert.deepEqual([nflTargetRoleFromKind('receiver'), nflTargetRoleFromKind('running back')], ['receiver', 'receiver']);
  assert.equal(nflTargetRoleFromKind('defender'), null);
  assert.equal(nflTargetRoleFromKind('player'), null, 'a generic spec has no chart to show');
  assert.equal(nflTargetRole('HB'), 'receiver', 'the spec counts HB as a back, so the role must too');
});

test('the role gate matches the markets a position gets at all', () => {
  const receiving = Object.entries(MARKETS_BY_POSITION)
    .filter(([, markets]) => markets.includes('receptions'))
    .map(([position]) => position)
    .sort();
  assert.deepEqual(receiving.filter((p) => nflTargetRole(p) === 'receiver'), receiving, 'every position with receiving markets has a target chart');
  assert.equal(nflTargetRole('QB'), 'passer');
});

test('loading, error and no-rows each say which they are', () => {
  assert.equal(nflTargetsSection(input({ loading: true })).state.kind, 'loading');
  assert.equal(nflTargetsSection(input({ error: 'nope' })).state.kind, 'error');
  const empty = nflTargetsSection(input({ data: payload({ targets: [], seasons: [] }) }));
  assert.equal(empty.state.kind, 'empty');
  assert.match(empty.state.kind === 'empty' ? empty.state.reason : '', /2024 onwards/);
  const none = nflTargetsSection(input({ data: null, emptyReason: 'no crosswalk row' }));
  assert.equal(none.state.kind === 'empty' ? none.state.reason : '', 'no crosswalk row');
});

test('unlocated targets are counted in a note rather than dropped silently', () => {
  const season = SEASONS[SEASONS.length - 1];
  const extra: NflTarget = [season, 9, null, null, null, null, false, false];
  const sec = nflTargetsSection(input({ season, data: payload({ targets: [...TARGETS, extra] }) }));
  assert.match(sec.note ?? '', /carry no location/);
  assert.equal(nflTargetsSection(input({ season })).note, undefined, 'no note when every target is located');
});

test('CFB says what is not held instead of showing an empty card', () => {
  const sec = cfbEfficiencySection();
  assert.equal(sec.state.kind, 'empty');
  assert.equal(sec.state.kind === 'empty' ? sec.state.title : '', 'Not held for college football');
  assert.match(sec.state.kind === 'empty' ? sec.state.reason : '', /CFBD/);
  assert.deepEqual(sec.rows, []);
});

// ---------------------------------------------------------------------------
// What R6.2 removed from the prop block
// ---------------------------------------------------------------------------

const NFL_ADAPTER = readFileSync('lib/sports/nfl/adapters/playerDetailAdapter.ts', 'utf8');

test('the prop block no longer repeats the target map or one season of the Seasons table', () => {
  // The 2x3 share grid and the ranked "Season stats" rail card both said less
  // than the sections that replaced them; the rows behind them are unchanged.
  assert.match(NFL_ADAPTER, /const spatialGrid = null;/, 'NFL rebuilt a prop-block target grid beside the section');
  // R11b-F1: the rail "Season stats" card is gone for every sport, not just NFL.
  for (const sport of ['nfl', 'cfb', 'nba', 'nhl', 'soccer']) {
    const src = readFileSync(`lib/sports/${sport}/adapters/playerDetailAdapter.ts`, 'utf8');
    assert.doesNotMatch(src, /railSeasonStats|\n\s+seasonStats:/,`${sport} rebuilt the rail season card beside "Season by season"`);
  }
  assert.doesNotMatch(readFileSync('components/PlayerDetail.tsx', 'utf8'), /data\.seasonStats/, 'PlayerDetail renders the rail season card again');
  assert.doesNotMatch(NFL_ADAPTER, /toNflTargetMap|targetMapShapes/, 'the deleted grid is still referenced');
});

test('the target map route, read, grid and hook are gone', () => {
  for (const path of [
    'app/api/nfl/target-map/route.ts',
    'lib/sports/nfl/targetMap.ts',
    'lib/sports/nfl/targetMapShapes.ts',
    'components/useNflTargetMap.ts',
  ]) {
    assert.equal(existsSync(path), false, `${path} still exists`);
  }
});
