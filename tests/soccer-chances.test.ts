import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  soccerChancesSection,
  soccerKeeperSection,
  type SoccerUnderstatPayload,
  type UnderstatShotRow,
} from '../lib/sports/soccer/playerUnderstatShapes';
import { preferredSoccerMarket } from '../lib/sports/soccer/adapters/playerDetailAdapter';

/**
 * R6.3 — soccer's "Chances & finishing", from G2's own Haaland block (the same
 * Understat fields `/getPlayerData` returns: X, Y, xG, result, situation and
 * shot type per shot, minutes and xG per match).
 */
const g2 = JSON.parse(readFileSync('docs/design/phase-g2/data/player-soccer-haaland.json', 'utf8')) as {
  understat: {
    shots: Array<[number, number, number, string, string, string, number, number]>;
    matches: Array<{ date: string; season: string | number; opponent: string | null; isHome: boolean | null; minutes: number; goals: number; shots: number; xG: number; assists: number; xA: number; keyPasses: number }>;
  };
};

// G2 stores a shot as [X, Y, xG, result, situation, shotType, season, minute];
// the app's row order is the one the page draws from.
const SHOTS: UnderstatShotRow[] = g2.understat.shots.map((s) => [Number(s[6]), Number(s[7]), Number(s[0]), Number(s[1]), Number(s[2]), String(s[3]), String(s[4]), String(s[5])]);
const SEASONS = [...new Set(SHOTS.map((s) => s[0]))].sort((a, b) => a - b);
const payload = (over: Partial<SoccerUnderstatPayload> = {}): SoccerUnderstatPayload => ({
  understatId: '8260',
  name: 'Erling Haaland',
  teamTitle: 'Manchester City',
  seasons: SEASONS,
  shots: SHOTS,
  matches: g2.understat.matches.map((m) => ({ ...m, season: Number(m.season) })),
  asOf: '2026-09-15T06:00:00Z',
  ...over,
});
const input = (over: Partial<Parameters<typeof soccerChancesSection>[0]> = {}) => ({ season: null, data: payload(), loading: false, error: null, ...over });

test('a forward gets the shot map, the finishing table and the two season cards, in G2s order', () => {
  const sec = soccerChancesSection(input());
  assert.equal(sec.state.kind, 'ready');
  assert.deepEqual([sec.id, sec.title], ['chances', 'Chances & finishing']);
  assert.deepEqual(sec.rows.map((r) => r.map((c) => c.key)), [['shots', 'finishing'], ['goalsVsXg'], ['per90']]);
  assert.equal(sec.season?.value, SEASONS[SEASONS.length - 1]);
});

test('every shot of the chosen season is a dot, sized by xG and flagged when it scored', () => {
  const season = SEASONS[SEASONS.length - 1];
  const shots = SHOTS.filter((s) => s[0] === season);
  const map = soccerChancesSection(input({ season })).rows[0][0];
  assert.ok(map.kind === 'scatter');
  assert.equal(map.surface, 'pitch');
  assert.equal(map.points.length, shots.length);
  assert.deepEqual(map.weights, shots.map((s) => s[4]), 'the dot is the chance it was worth');
  assert.deepEqual(map.emphasis, shots.map((s) => s[5] === 'Goal'));
  assert.equal(map.emphasis!.filter(Boolean).length, shots.filter((s) => s[5] === 'Goal').length);
  // The point carries Understat's own coordinates: y across the pitch, x depth.
  assert.deepEqual(map.points[0].slice(1), [shots[0][3], shots[0][2]]);
  assert.ok(map.groups.every((g) => g.count > 0), 'a situation with no shots is not offered');
  assert.deepEqual(map.defaultVisible, map.groups.map((g) => g.key));
});

test('finishing is xG against goals, by body part, with the totals in the caption', () => {
  const season = SEASONS[SEASONS.length - 1];
  const shots = SHOTS.filter((s) => s[0] === season);
  const card = soccerChancesSection(input({ season })).rows[0][1];
  assert.ok(card.kind === 'table');
  const goals = shots.filter((s) => s[5] === 'Goal').length;
  const xg = shots.reduce((a, s) => a + s[4], 0);
  assert.match(card.caption ?? '', new RegExp(`${shots.length} shots`));
  assert.match(card.caption ?? '', new RegExp(`${goals} goals`));
  assert.match(card.caption ?? '', new RegExp(`${xg.toFixed(1)} xG`));
  const top = card.rows[0];
  assert.ok((top.values.n as number) >= (card.rows[card.rows.length - 1].values.n as number), 'most-used body part first');
  assert.equal(card.rows.reduce((a, r) => a + (r.values.n as number), 0), shots.length, 'every shot is in a row');
});

test('goals against xG is a rolling average over the last matches, not one season', () => {
  const sec = soccerChancesSection(input());
  const card = sec.rows[1][0];
  assert.ok(card.kind === 'series');
  // G2 stores matches newest first; the card reads them oldest first.
  const matches = [...payload().matches].sort((a, b) => a.date.localeCompare(b.date)).slice(-60);
  assert.equal(card.values.length, matches.length);
  assert.equal(card.context?.length, matches.length);
  // The first nine points of a ten-match average do not exist.
  assert.ok(Number.isNaN(card.values[0]) && Number.isNaN(card.values[8]));
  assert.ok(Number.isFinite(card.values[9]));
  const window = matches.slice(0, 10);
  assert.equal(Math.round(card.values[9] * 1000), Math.round((window.reduce((a, m) => a + m.goals, 0) / 10) * 1000));
});

test('per 90 divides by the minutes Understat holds, season by season, newest first', () => {
  const card = soccerChancesSection(input()).rows[2][0];
  assert.ok(card.kind === 'table');
  assert.deepEqual(card.rows.map((r) => Number(r.key)), [...SEASONS].reverse().filter((s) => payload().matches.some((m) => m.season === s)));
  const newest = card.rows[0];
  const ms = payload().matches.filter((m) => m.season === Number(newest.key));
  const min = ms.reduce((a, m) => a + m.minutes, 0);
  assert.equal(newest.values.apps, ms.length);
  assert.equal(newest.values.min, min);
  assert.equal(
    Math.round((newest.values.g90 as number) * 100),
    Math.round(((90 * ms.reduce((a, m) => a + m.goals, 0)) / min) * 100),
  );
});

test('a keeper is told what shot-stopping needs, rather than shown his own shots', () => {
  const sec = soccerKeeperSection();
  assert.deepEqual([sec.id, sec.title], ['keeping', 'Shot-stopping']);
  assert.equal(sec.state.kind, 'empty');
  assert.match(sec.state.kind === 'empty' ? sec.state.reason : '', /Post-shot xG/);
  assert.deepEqual(sec.rows, []);
});

test('loading, error, and a player Understat does not cover each say which they are', () => {
  assert.equal(soccerChancesSection(input({ loading: true })).state.kind, 'loading');
  assert.equal(soccerChancesSection(input({ error: 'nope' })).state.kind, 'error');
  const mls = soccerChancesSection(input({ data: null, emptyReason: 'Understat covers the big five leagues; MLS is not one of them.' }));
  assert.equal(mls.state.kind === 'empty' ? mls.state.reason : '', 'Understat covers the big five leagues; MLS is not one of them.');
  const noShots = soccerChancesSection(input({ data: payload({ shots: [], seasons: [] }) }));
  assert.equal(noShots.state.kind, 'empty');
});

test('the name Understat matched is stated, because the join is by name', () => {
  const sec = soccerChancesSection(input());
  assert.match(sec.note ?? '', /Erling Haaland \(Manchester City\)/);
  assert.match(sec.note ?? '', /by name/);
});

// ---------------------------------------------------------------------------
// C8 — the market a soccer page opens on (operator decision 4)
// ---------------------------------------------------------------------------

test('a soccer page opens on the market the position plays for', () => {
  const all = ['passes-attempted', 'tackles', 'shots', 'shots-on-target', 'anytime-goalscorer', 'saves'];
  assert.equal(preferredSoccerMarket('F', all), 'anytime-goalscorer');
  assert.equal(preferredSoccerMarket('M', all), 'shots-on-target');
  assert.equal(preferredSoccerMarket('D', all), 'tackles');
  assert.equal(preferredSoccerMarket('G', all), 'saves');
  // Falls through to the next one the books actually priced.
  assert.equal(preferredSoccerMarket('F', ['passes-attempted', 'shots']), 'shots');
  // No position, or a market nobody priced: the slate's own order stands.
  assert.equal(preferredSoccerMarket(null, all), undefined);
  assert.equal(preferredSoccerMarket('D', ['passes-attempted']), undefined);
});
