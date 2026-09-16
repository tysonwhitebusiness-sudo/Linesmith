import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  feetFromNet,
  historySeasonOf,
  nhlShotMapSection,
  rotateToAttackingEnd,
  shotSeasonKey,
  type NhlShot,
  type NhlShotsPayload,
} from '../lib/sports/nhl/playerShotMapShapes';
import type { NhlSeasonLine } from '../lib/sports/nhl/apiWebParsers';

/**
 * R6.5 — NHL's shot map. The fixtures follow the real table: x -100..100 with
 * the goals at ±89 and its SIGN meaning the attacking end, y ±42 across the
 * ice, and `event_type` one of goal / shot-on-goal / missed-shot /
 * blocked-shot (`scripts/measure-hoops-hockey.ts`).
 */
const shot = (over: Partial<NhlShot> = {}): NhlShot => ({
  date: '2026-01-15',
  season: '20252026',
  eventType: 'shot-on-goal',
  shotType: 'wrist',
  x: 70,
  y: 10,
  zoneCode: 'O',
  period: 1,
  ...over,
});
const payload = (shots: NhlShot[], role: 'skater' | 'goalie' = 'skater'): NhlShotsPayload => ({
  playerId: 8477492,
  role,
  seasons: [...new Set(shots.map((s) => s.season))].sort(),
  shots,
  asOf: '2026-09-15T06:00:00Z',
});
const input = (shots: NhlShot[], over: Partial<Parameters<typeof nhlShotMapSection>[0]> = {}) => ({
  season: null,
  data: payload(shots),
  loading: false,
  error: null,
  ...over,
});
const season = (over: Partial<NhlSeasonLine> = {}): NhlSeasonLine =>
  ({
    season: 20252026,
    team: 'COL',
    gamesPlayed: 82,
    goals: 51,
    assists: 89,
    points: 140,
    plusMinus: 35,
    pim: 46,
    shots: 350,
    shootingPct: 0.146,
    powerPlayGoals: 15,
    powerPlayPoints: 50,
    gameWinningGoals: 9,
    avgToi: '22:10',
    faceoffPct: 45,
    gamesStarted: null,
    wins: null,
    losses: null,
    otLosses: null,
    goalsAgainstAvg: null,
    savePct: null,
    shutouts: null,
    shotsAgainst: null,
    ...over,
  }) as NhlSeasonLine;

test('normalising is a rotation, not an absolute value', () => {
  // The same shot from the other end: BOTH axes flip, so the wing is preserved.
  assert.deepEqual(rotateToAttackingEnd(shot({ x: -73, y: 11 })), { x: 73, y: -11 });
  assert.deepEqual(rotateToAttackingEnd(shot({ x: 73, y: -11 })), { x: 73, y: -11 });
  // Taking abs(x) alone would have left y at +11 and moved the shot across the ice.
  assert.notDeepEqual(rotateToAttackingEnd(shot({ x: -73, y: 11 })), { x: 73, y: 11 });
  assert.equal(rotateToAttackingEnd(shot({ x: null, y: 4 })), null);
});

test('distance is measured from the goal line, either end', () => {
  assert.equal(Math.round(feetFromNet(89, 0)), 0);
  assert.equal(Math.round(feetFromNet(-89, 0)), 0);
  assert.equal(Math.round(feetFromNet(69, 0)), 20);
});

test('the two season vocabularies convert both ways', () => {
  assert.equal(shotSeasonKey(2025), '20252026');
  assert.equal(historySeasonOf('20252026'), 2025);
});

test('a skater gets the map, the type table and the official totals', () => {
  const sec = nhlShotMapSection(input([shot(), shot({ eventType: 'goal' })], { officialSeasons: [season()] }));
  assert.equal(sec.state.kind, 'ready');
  assert.equal(sec.title, 'Shot map & official totals');
  assert.deepEqual(sec.rows.map((r) => r.map((c) => c.key)), [['map', 'types'], ['official']]);
  assert.match(sec.note ?? '', /Attempts, not shots on goal/);
});

test('a goalie gets the same shape, renamed, because he faces shots rather than taking them', () => {
  const sec = nhlShotMapSection({
    ...input([shot(), shot({ eventType: 'goal' })]),
    data: payload([shot(), shot({ eventType: 'goal' })], 'goalie'),
    officialSeasons: [season({ gamesStarted: 60, wins: 37, savePct: 0.925, goalsAgainstAvg: 2.3, shutouts: 5 })],
  });
  assert.equal(sec.title, 'Shots faced & official totals');
  assert.equal(sec.navLabel, 'Shots faced');
  const official = sec.rows[1][0];
  assert.ok(official.kind === 'table');
  assert.deepEqual(official.columns.map((c) => c.key), ['gp', 'gs', 'w', 'l', 'otl', 'svp', 'gaa', 'so']);
  assert.equal(official.rows[0].values.svp, 0.925);
});

test('the map counts every attempt and picks out the goals', () => {
  const shots = [shot(), shot({ eventType: 'goal' }), shot({ eventType: 'blocked-shot', shotType: null }), shot({ eventType: 'missed-shot' })];
  const card = nhlShotMapSection(input(shots)).rows[0][0];
  assert.ok(card.kind === 'scatter');
  assert.equal(card.surface, 'rink');
  assert.equal(card.points.length, 4);
  assert.deepEqual(card.emphasis, [false, true, false, false]);
  assert.deepEqual(card.groups.map((g) => g.key).sort(), ['blocked-shot', 'goal', 'missed-shot', 'shot-on-goal']);
});

test('a blocked attempt with no type is counted, not dropped', () => {
  const shots = [shot({ shotType: 'wrist' }), shot({ eventType: 'blocked-shot', shotType: null }), shot({ eventType: 'blocked-shot', shotType: null })];
  const card = nhlShotMapSection(input(shots)).rows[0][1];
  assert.ok(card.kind === 'table');
  const blank = card.rows.find((r) => r.key === 'Not given')!;
  assert.equal(blank.values.n, 2);
  assert.equal(
    card.rows.reduce((a, r) => a + (r.values.n as number), 0),
    3,
  );
});

test('the season control filters the map to one season', () => {
  const shots = [shot({ season: '20242025' }), shot({ season: '20252026' }), shot({ season: '20252026' })];
  const sec = nhlShotMapSection(input(shots, { season: 2025 }));
  assert.deepEqual(sec.season?.options.map((o) => o.label), ['2025-26', '2024-25']);
  const card = sec.rows[0][0];
  assert.ok(card.kind === 'scatter' && card.points.length === 2);
});

test("no shots is not empty when the league's own totals are there", () => {
  const sec = nhlShotMapSection({ ...input([]), data: null, officialSeasons: [season()] });
  assert.equal(sec.state.kind, 'ready');
  assert.deepEqual(sec.rows.map((r) => r.map((c) => c.key)), [['official']]);
  assert.match(sec.note ?? '', /official totals below are unaffected/);
  // With neither, it says so rather than showing an empty table.
  const nothing = nhlShotMapSection({ ...input([]), data: null, officialSeasons: null });
  assert.equal(nothing.state.kind, 'empty');
});

test("the landing's shooting rate is rendered as a percentage, not as .146", () => {
  const sec = nhlShotMapSection(input([shot()], { officialSeasons: [season({ shootingPct: 0.146 })] }));
  const official = sec.rows[1][0];
  assert.ok(official.kind === 'table');
  assert.equal(Math.round((official.rows[0].values.shp as number) * 10) / 10, 14.6);
});

test('loading and error each say which they are', () => {
  assert.equal(nhlShotMapSection(input([], { loading: true })).state.kind, 'loading');
  assert.equal(nhlShotMapSection(input([], { error: 'nope' })).state.kind, 'error');
});
