/**
 * R2 — the `game_result` read module's de-duplication rule.
 *
 * Every fixture below is a real row shape taken from the 2026-09-14
 * measurement against production Postgres, not invented. The two cases the
 * measurement said would decide the design get their own tests: sources that
 * spell the same team differently (100% of NFL/CFB/NBA duplicate pairs), and
 * sources that date the same game a day apart (568 MLB, 250 MLS, 98 NBA, 60
 * NFL pairs since 2023).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeGameResults, recordFromResults, type GameResultRow } from '../lib/history/gameResults';

let nextId = 1;
function row(p: Partial<GameResultRow> & Pick<GameResultRow, 'gameDate' | 'homeScore' | 'awayScore'>): GameResultRow {
  return {
    id: p.id ?? nextId++,
    sport: p.sport ?? 'nfl',
    homeTeamId: p.homeTeamId ?? '13',
    awayTeamId: p.awayTeamId ?? '24',
    homeTeamRaw: p.homeTeamRaw ?? 'LV',
    awayTeamRaw: p.awayTeamRaw ?? 'LAC',
    venue: p.venue ?? null,
    source: p.source ?? 'nflverse',
    eventStart: p.eventStart ?? null,
    ...p,
  } as GameResultRow;
}

test('the real duplicate: same game, different source, different date AND different names', () => {
  // Measured verbatim: nflverse 2025-09-15 "LAC @ LV" vs
  // espn_core 2025-09-16 "Los Angeles Chargers @ Las Vegas Raiders".
  const rows = [
    row({ id: 1, gameDate: '2025-09-15', homeScore: 20, awayScore: 9, source: 'nflverse', homeTeamRaw: 'LV', awayTeamRaw: 'LAC' }),
    row({ id: 2, gameDate: '2025-09-16', homeScore: 20, awayScore: 9, source: 'espn_core', homeTeamRaw: 'Las Vegas Raiders', awayTeamRaw: 'Los Angeles Chargers' }),
  ];
  const kept = dedupeGameResults(rows);
  assert.equal(kept.length, 1, 'the two rows are one game');
  assert.equal(kept[0].source, 'nflverse', 'the bulk source outranks espn_core');
});

test('a name-keyed rule would have found nothing here — ids are what match', () => {
  const rows = [
    row({ id: 1, gameDate: '2025-09-15', homeScore: 20, awayScore: 9, homeTeamRaw: 'LV', awayTeamRaw: 'LAC' }),
    row({ id: 2, gameDate: '2025-09-15', homeScore: 20, awayScore: 9, source: 'espn_core', homeTeamRaw: 'Las Vegas Raiders', awayTeamRaw: 'Los Angeles Chargers' }),
  ];
  assert.notEqual(rows[0].homeTeamRaw.toLowerCase(), rows[1].homeTeamRaw.toLowerCase());
  assert.equal(dedupeGameResults(rows).length, 1);
});

test('two days apart is two games, not one', () => {
  const rows = [
    row({ id: 1, gameDate: '2025-09-15', homeScore: 20, awayScore: 9 }),
    row({ id: 2, gameDate: '2025-09-17', homeScore: 20, awayScore: 9, source: 'espn_core' }),
  ];
  assert.equal(dedupeGameResults(rows).length, 2);
});

test('a doubleheader stays two games — same teams, same day, different scores', () => {
  // The trap in collapsing on teams-and-date alone. MLB really does play two.
  const rows = [
    row({ id: 1, sport: 'mlb', gameDate: '2026-07-04', homeScore: 4, awayScore: 3 }),
    row({ id: 2, sport: 'mlb', gameDate: '2026-07-04', homeScore: 1, awayScore: 7 }),
  ];
  assert.equal(dedupeGameResults(rows).length, 2);
});

test('the same fixture played twice in a season stays two games', () => {
  const rows = [
    row({ id: 1, gameDate: '2025-09-15', homeScore: 20, awayScore: 9 }),
    row({ id: 2, gameDate: '2025-12-21', homeScore: 20, awayScore: 9 }),
  ];
  assert.equal(dedupeGameResults(rows).length, 2);
});

test('home and away are not interchangeable', () => {
  // LV 20 - LAC 9 and LAC 20 - LV 9 are different games with mirrored numbers.
  const rows = [
    row({ id: 1, gameDate: '2025-09-15', homeTeamId: '13', awayTeamId: '24', homeScore: 20, awayScore: 9 }),
    row({ id: 2, gameDate: '2025-09-15', homeTeamId: '24', awayTeamId: '13', homeScore: 20, awayScore: 9 }),
  ];
  assert.equal(dedupeGameResults(rows).length, 2);
});

test('live_capture loses to a bulk source — its score can be in-progress', () => {
  const rows = [
    row({ id: 9, gameDate: '2026-09-13', homeScore: 20, awayScore: 9, source: 'live_capture' }),
    row({ id: 1, gameDate: '2026-09-13', homeScore: 20, awayScore: 9, source: 'nflverse' }),
  ];
  const kept = dedupeGameResults(rows);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].source, 'nflverse');
});

test('the answer does not depend on the order rows arrive in', () => {
  const a = row({ id: 5, gameDate: '2025-09-16', homeScore: 20, awayScore: 9, source: 'espn_core' });
  const b = row({ id: 3, gameDate: '2025-09-15', homeScore: 20, awayScore: 9, source: 'nflverse' });
  const c = row({ id: 7, gameDate: '2025-09-15', homeScore: 20, awayScore: 9, source: 'live_capture' });
  const one = dedupeGameResults([a, b, c]);
  const two = dedupeGameResults([c, a, b]);
  const three = dedupeGameResults([b, c, a]);
  assert.equal(one.length, 1);
  assert.deepEqual(one.map((r) => r.id), two.map((r) => r.id));
  assert.deepEqual(one.map((r) => r.id), three.map((r) => r.id));
  assert.equal(one[0].source, 'nflverse');
});

test('tennis falls back to names, because tennis_data has no team ids at all', () => {
  // Measured: tennis_data fill rate is 0.0%.
  const rows = [
    row({ id: 1, sport: 'tennis_atp', gameDate: '2026-09-07', homeScore: 3, awayScore: 1, homeTeamId: null, awayTeamId: null, homeTeamRaw: 'Carlos Alcaraz', awayTeamRaw: 'Jannik Sinner', source: 'tennis_data' }),
    row({ id: 2, sport: 'tennis_atp', gameDate: '2026-09-07', homeScore: 3, awayScore: 1, homeTeamId: null, awayTeamId: null, homeTeamRaw: 'carlos alcaraz', awayTeamRaw: 'Jannik  Sinner', source: 'live_capture' }),
  ];
  const kept = dedupeGameResults(rows);
  assert.equal(kept.length, 1, 'normalization collapses spacing and case');
  assert.equal(kept[0].source, 'tennis_data');
});

test('different players are different matches even without ids', () => {
  const rows = [
    row({ id: 1, sport: 'tennis_atp', gameDate: '2026-09-07', homeScore: 3, awayScore: 1, homeTeamId: null, awayTeamId: null, homeTeamRaw: 'Carlos Alcaraz', awayTeamRaw: 'Jannik Sinner' }),
    row({ id: 2, sport: 'tennis_atp', gameDate: '2026-09-07', homeScore: 3, awayScore: 1, homeTeamId: null, awayTeamId: null, homeTeamRaw: 'Taylor Fritz', awayTeamRaw: 'Alexander Zverev' }),
  ];
  assert.equal(dedupeGameResults(rows).length, 2);
});

test('a row with no ids does not collapse into one that has them', () => {
  // Identity keys are namespaced (`id:` vs `nm:`) so the two never compare equal.
  const rows = [
    row({ id: 1, gameDate: '2025-09-15', homeScore: 20, awayScore: 9, homeTeamId: '13', awayTeamId: '24' }),
    row({ id: 2, gameDate: '2025-09-15', homeScore: 20, awayScore: 9, homeTeamId: null, awayTeamId: null }),
  ];
  assert.equal(dedupeGameResults(rows).length, 2);
});

test('an empty input is an empty record, not a 0-0 one', () => {
  assert.deepEqual(dedupeGameResults([]), []);
  assert.deepEqual(recordFromResults([], '13'), { wins: 0, losses: 0, draws: 0 });
});

test('recordFromResults counts from both sides and keeps draws out of losses', () => {
  const rows = [
    row({ id: 1, sport: 'soccer_epl', gameDate: '2026-08-16', homeTeamId: '361', awayTeamId: '357', homeScore: 2, awayScore: 0 }),
    row({ id: 2, sport: 'soccer_epl', gameDate: '2026-08-23', homeTeamId: '357', awayTeamId: '361', homeScore: 1, awayScore: 1 }),
    row({ id: 3, sport: 'soccer_epl', gameDate: '2026-08-30', homeTeamId: '357', awayTeamId: '361', homeScore: 3, awayScore: 1 }),
  ];
  // 361: won at home, drew away, lost away.
  assert.deepEqual(recordFromResults(rows, '361'), { wins: 1, losses: 1, draws: 1 });
  // 357: lost away, drew at home, won at home.
  assert.deepEqual(recordFromResults(rows, '357'), { wins: 1, losses: 1, draws: 1 });
  // A team that didn't play in any of them.
  assert.deepEqual(recordFromResults(rows, '999'), { wins: 0, losses: 0, draws: 0 });
});
