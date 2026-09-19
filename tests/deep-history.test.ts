import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLineage, isExhibition, lineageOf, MLB_AUTHORITY, phaseOf, refineDeepHistory, type DeepRow } from '../lib/history/deepHistory';
import { dedupeGameResults, type GameResultRow } from '../lib/history/gameResults';
import { SEASON_WINDOWS } from '../lib/history/seasonWindows';

/**
 * R12a — the rules deep history adds over R2's merge. Each case is one of the
 * measured failures in `docs/audit-2026-09-13/r12-deep-history-design.md`.
 */

const row = (r: Partial<DeepRow> & { gameDate: string }): DeepRow => ({
  sport: 'nba',
  homeTeamId: '7',
  awayTeamId: '13',
  homeTeamRaw: 'Denver Nuggets',
  awayTeamRaw: 'Los Angeles Lakers',
  homeScore: 110,
  awayScore: 100,
  source: 'espn_core',
  ...r,
});

const W = { nba: { 2025: { regularStart: '2024-10-22', regularEnd: '2025-04-13', postEnd: '2025-06-22' } }, mlb: { 2025: { regularStart: '2025-03-18', regularEnd: '2025-09-28', postEnd: '2025-11-01' } } };

test('lineage: the Thrashers are the Jets, the SuperSonics the Thunder, and Utah is 68 whatever the table says', () => {
  const [atl] = applyLineage([row({ sport: 'nhl', gameDate: '2010-01-02', homeTeamId: null, homeTeamRaw: 'Atlanta', awayTeamId: '21' })]);
  assert.equal(atl.homeTeamId, '52');
  const [sea] = applyLineage([row({ gameDate: '2008-01-02', homeTeamId: null, homeTeamRaw: 'Seattle' })]);
  assert.equal(sea.homeTeamId, '25');
  const [uta] = applyLineage([row({ sport: 'nhl', gameDate: '2025-11-02', homeTeamId: '59', homeTeamRaw: 'Utah Mammoth' })]);
  assert.equal(uta.homeTeamId, '68');
  const [hc] = applyLineage([row({ sport: 'nhl', gameDate: '2024-11-02', homeTeamId: null, homeTeamRaw: 'Utah Hockey Club' })]);
  assert.equal(hc.homeTeamId, '68');
  // Arizona is NOT Utah: the NHL treats Utah as a new franchise.
  const [ari] = applyLineage([row({ sport: 'nhl', gameDate: '2023-11-02', homeTeamId: '53', homeTeamRaw: 'Arizona Coyotes' })]);
  assert.equal(ari.homeTeamId, '53');
  // A raw name only resolves where the id is missing — "Seattle" with an id is someone else.
  const [kraken] = applyLineage([row({ sport: 'nhl', gameDate: '2023-11-02', homeTeamId: '55', homeTeamRaw: 'Seattle' })]);
  assert.equal(kraken.homeTeamId, '55');
  assert.deepEqual(lineageOf('nhl', '68'), { ids: ['68', '59'], raws: ['Utah Hockey Club', 'Utah Mammoth'] });
  assert.deepEqual(lineageOf('nfl', '21'), { ids: ['21'], raws: [] });
});

test('lineage runs before the merge, so an Atlanta row and a Winnipeg-id row of one game merge', () => {
  const a = { ...row({ sport: 'nhl', gameDate: '2010-01-02', homeTeamId: null, homeTeamRaw: 'Atlanta', awayTeamId: '21' }), id: 1, venue: null, eventStart: null, source: 'sbr' } as GameResultRow;
  const b = { ...a, id: 2, homeTeamId: '52', homeTeamRaw: 'Atlanta Thrashers', source: 'espn_core' } as GameResultRow;
  assert.equal(dedupeGameResults(applyLineage([a, b])).length, 1);
});

test('game type: preseason is outside every window, playoffs are marked, and a UTC-dated final still counts', () => {
  assert.equal(phaseOf('nba', '2024-10-10', W), null, 'preseason');
  assert.deepEqual(phaseOf('nba', '2024-12-25', W), { season: 2025, phase: 'regular' });
  assert.deepEqual(phaseOf('nba', '2025-05-10', W), { season: 2025, phase: 'post' });
  assert.deepEqual(phaseOf('nba', '2025-06-23', W), { season: 2025, phase: 'post' }, 'finals at 8:30pm ET is the next UTC day');
  assert.equal(phaseOf('soccer_epl', '2025-01-01', W), null);
  const kept = refineDeepHistory('nba', [row({ gameDate: '2024-10-10' }), row({ gameDate: '2024-12-25' })], W);
  assert.deepEqual(kept.map((r) => r.gameDate), ['2024-12-25']);
  // A sport with no windows keeps every row rather than dropping them all.
  assert.equal(refineDeepHistory('soccer_epl', [row({ sport: 'soccer_epl', gameDate: '2025-01-01' })], W).length, 1);
});

test('exhibitions: All-Star teams and unresolved pro opponents drop; a CFB row with no id stays', () => {
  assert.ok(isExhibition(row({ gameDate: '2024-02-18', homeTeamRaw: 'Eastern Conf All-Stars', homeTeamId: '31' })));
  assert.ok(isExhibition(row({ gameDate: '2025-02-16', homeTeamRaw: 'Team Chuck', homeTeamId: '130579' })));
  assert.ok(isExhibition(row({ sport: 'nhl', gameDate: '2025-02-15', homeTeamRaw: 'Sweden', homeTeamId: null })));
  assert.ok(!isExhibition(row({ sport: 'cfb', gameDate: '2023-09-02', homeTeamRaw: 'South Alabama Jaguars', homeTeamId: null })));
  assert.ok(!isExhibition(row({ gameDate: '2024-12-25' })), 'a real game');
});

test('NBA/NHL: a same-date score disagreement between sources is one game, and ESPN\'s score stands', () => {
  // Measured: espn_core 106-108 (the official score) against sbr 102-82, PHX v POR 2022-11-05.
  const w = { nba: { 2023: { regularStart: '2022-10-18', regularEnd: '2023-04-09', postEnd: '2023-06-12' } } };
  const kept = refineDeepHistory('nba', [row({ gameDate: '2022-11-05', homeScore: 102, awayScore: 82, source: 'sbr' }), row({ gameDate: '2022-11-05', homeScore: 106, awayScore: 108 })], w);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].source, 'espn_core');
  // Two games on consecutive days (the NBA's two-game series) are NOT a conflict.
  assert.equal(refineDeepHistory('nba', [row({ gameDate: '2022-11-05', source: 'sbr', homeScore: 90 }), row({ gameDate: '2022-11-06' })], w).length, 2);
});

test('MLB: a doubleheader from one source stays two games, and StatsAPI settles a season it covers', () => {
  const mlb = (d: string, hs: number, source: string) => row({ sport: 'mlb', gameDate: d, homeTeamId: '147', awayTeamId: '111', homeScore: hs, awayScore: 1, source });
  assert.equal(refineDeepHistory('mlb', [mlb('2025-05-10', 3, 'espn_core'), mlb('2025-05-10', 5, 'espn_core')], W).length, 2);
  // Once the backfill has written a season, the other sources' rows for it go —
  // including the spring training that sits inside a Tokyo-opener window.
  const season = [mlb('2025-03-20', 2, 'espn_core'), mlb('2025-05-10', 3, MLB_AUTHORITY), mlb('2025-05-10', 3, 'mlb_long_csv')];
  const kept = refineDeepHistory('mlb', season, W);
  assert.deepEqual(kept.map((r) => r.source), [MLB_AUTHORITY]);
});

test('the generated windows cover every windowed sport back to its first season held', () => {
  assert.ok(SEASON_WINDOWS.mlb[2010] && SEASON_WINDOWS.mlb[2025]);
  assert.equal(SEASON_WINDOWS.mlb[2025].regularStart, '2025-03-18', 'MLB 2025 opens with the Tokyo Series, not ESPN\'s 03-26');
  assert.equal(SEASON_WINDOWS.nba[2012].regularStart, '2011-12-25', 'the lockout season');
  assert.ok(SEASON_WINDOWS.nfl[1999] && SEASON_WINDOWS.nhl[2007] && SEASON_WINDOWS.cfb[2013]);
});

test('a league that opens abroad: a game is preseason until both teams have opened', () => {
  // Measured: NHL 2024-25 opened in Prague on Oct 4; Winnipeg's Oct 5 game at
  // Calgary was preseason (the Jets opened Oct 9), and counted as an 83rd game.
  const w = { nhl: { 2024: { regularStart: '2024-10-04', regularEnd: '2025-04-17', postEnd: '2025-06-18', teamStart: { '52': '2024-10-09', '20': '2024-10-09', '1': '2024-10-04' } } } };
  const g = (d: string, home: string, away: string) => row({ sport: 'nhl', gameDate: d, homeTeamId: home, awayTeamId: away });
  assert.equal(phaseOf('nhl', '2024-10-05', w, ['20', '52']), null, 'CGY v WPG before either opened');
  assert.deepEqual(phaseOf('nhl', '2024-10-04', w, ['1', '7']), { season: 2024, phase: 'regular' }, 'the Prague opener; team 7 is not listed, so not held back');
  assert.deepEqual(phaseOf('nhl', '2024-10-09', w, ['52', '20']), { season: 2024, phase: 'regular' });
  assert.equal(refineDeepHistory('nhl', [g('2024-10-05', '20', '52'), g('2024-10-09', '52', '20')], w).length, 1);
});
