import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHeadToHead, buildTeamHistory, type TeamHistory } from '../lib/history/teamHistoryShapes';
import { teamHistorySection } from '../lib/history/teamHistorySection';
import type { GameResultRow } from '../lib/history/gameResults';

/** R12b — the team page's History section, built from the `view=history` payload. */

const NOW = new Date('2026-09-19T12:00:00Z');

function season(season: number, w: number, l: number, post: [number, number] | null = null, d = 0): TeamHistory['seasons'][number] {
  return {
    season,
    regular: { w, l, d },
    home: { w: Math.ceil(w / 2), l: Math.floor(l / 2), d: 0 },
    away: { w: Math.floor(w / 2), l: Math.ceil(l / 2), d: 0 },
    post: post ? { w: post[0], l: post[1], d: 0 } : null,
    pointsFor: 400,
    pointsAgainst: 380,
  };
}

const history = (sport: string, seasons: TeamHistory['seasons']): TeamHistory => ({ sport, teamId: '21', seasons, allTime: { regular: { w: 0, l: 0, d: 0 }, post: { w: 0, l: 0, d: 0 }, seasons: seasons.length } });

test('the current season is left out, the last 10 open, and every season is one switch away', () => {
  // NFL 2026 is under way on 2026-09-19; 2025 is finished.
  const seasons = [season(2026, 1, 0), ...Array.from({ length: 14 }, (_, i) => season(2025 - i, 10, 7, i === 0 ? [2, 1] : null))];
  const sec = teamHistorySection({ sport: 'nfl', teamAbbr: 'PHI', history: history('nfl', seasons), loading: false, error: null, now: NOW })!;
  assert.equal(sec.state.kind, 'ready');
  const table = sec.rows.flat().find((c) => c.key === 'history-seasons')!;
  assert.ok(table.kind === 'table');
  assert.equal(table.rows.length, 10, 'last 10 by default');
  assert.equal(table.rows[0].label, '2025-26', 'newest completed first; 2026 is in progress');
  assert.deepEqual(table.views?.map((v) => v.label), ['Last 10', 'All 14']);
  assert.equal(table.rows[0].values.post, '2-1');
  assert.match(sec.note ?? '', /^PHI 140-98 \(\.588\) over 14 completed seasons since 2012-13; 100-70 \(\.588\) over the last 10; postseason 2-1\.$/);
});

test('soccer reads W-D-L and ranks on points; the NHL says what its records leave out', () => {
  const epl = teamHistorySection({ sport: 'soccer_epl', teamAbbr: 'ARS', history: history('soccer_epl', [season(2024, 20, 4, null, 14)]), loading: false, error: null, now: NOW })!;
  const t = epl.rows.flat().find((c) => c.key === 'history-seasons')!;
  assert.ok(t.kind === 'table');
  assert.equal(t.rows[0].values.rec, '20-14-4');
  assert.equal(t.rows[0].values.pts, 74);
  assert.ok(!t.columns.some((c) => c.key === 'pct'));
  const nhl = teamHistorySection({ sport: 'nhl', teamAbbr: 'WPG', history: history('nhl', [season(2007, 34, 48)]), loading: false, error: null, now: NOW })!;
  assert.match(nhl.note ?? '', /overtime or shootout loss counts as a loss/);
});

test('states: loading, error, nothing completed, and a sport with no history', () => {
  assert.equal(teamHistorySection({ sport: 'nfl', teamAbbr: 'PHI', history: null, loading: true, error: null, now: NOW })!.state.kind, 'loading');
  assert.equal(teamHistorySection({ sport: 'nfl', teamAbbr: 'PHI', history: null, loading: false, error: "Couldn't load", now: NOW })!.state.kind, 'error');
  assert.equal(teamHistorySection({ sport: 'nfl', teamAbbr: 'PHI', history: history('nfl', [season(2026, 1, 0)]), loading: false, error: null, now: NOW })!.state.kind, 'empty');
  assert.equal(teamHistorySection({ sport: 'tennis_atp', teamAbbr: 'X', history: null, loading: false, error: null, now: NOW }), null);
});

test('the shapes: playoffs apart from the regular season, head to head from team a\'s side', () => {
  const g = (d: string, home: string, away: string, hs: number, as: number, phase: 'regular' | 'post' = 'regular') =>
    ({ id: 0, sport: 'nfl', gameDate: d, homeTeamId: home, awayTeamId: away, homeTeamRaw: '', awayTeamRaw: '', homeScore: hs, awayScore: as, venue: null, source: 'nflverse', eventStart: null, phase, season: 2024 }) as GameResultRow;
  const rows = [g('2024-09-08', '21', '6', 20, 17), g('2024-12-01', '6', '21', 10, 24), g('2025-01-12', '21', '6', 14, 28, 'post'), g('2024-10-01', '21', '9', 30, 3)];
  const h = buildTeamHistory('nfl', '21', rows);
  assert.deepEqual(h.seasons[0].regular, { w: 3, l: 0, d: 0 });
  assert.deepEqual(h.seasons[0].post, { w: 0, l: 1, d: 0 });
  assert.deepEqual(h.seasons[0].home, { w: 2, l: 0, d: 0 });
  const hh = buildHeadToHead('nfl', '21', '6', rows);
  assert.deepEqual(hh.record, { w: 2, l: 1, d: 0 });
  assert.deepEqual(hh.atHome, { w: 1, l: 1, d: 0 });
  assert.deepEqual(hh.playoffs, { w: 0, l: 1, d: 0 });
  assert.equal(hh.meetings[0].date, '2025-01-12', 'newest first');
});

test('no playoffs anywhere, no Playoffs column', () => {
  const epl = teamHistorySection({ sport: 'soccer_epl', teamAbbr: 'ARS', history: history('soccer_epl', [season(2024, 20, 4, null, 14)]), loading: false, error: null, now: NOW })!;
  const t = epl.rows.flat().find((c) => c.key === 'history-seasons')!;
  assert.ok(t.kind === 'table' && !t.columns.some((c) => c.key === 'post'));
});
