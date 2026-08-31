import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toGameTeamForm } from '../lib/sports/shared/gameTeamForm';
import type { RecentResultRow } from '../lib/sports/mlb/adapters/gameDetailAdapter';

/**
 * The game page's team-form cards — Phase 6.21.
 *
 * The point of this builder is that ONE of it serves all seven sports, off the
 * `RecentResultRow` every game adapter already produces for its last-five
 * block. The alternative was five differently-named per-sport team-candidate
 * functions and a card MLB could not have at all.
 */

function row(i: number, scoreFor: number, scoreAgainst: number, isHome: boolean, opp = 'OPP'): RecentResultRow {
  return {
    gameId: String(i),
    // Ascending dates so a shuffled input can be caught below.
    date: `2026-04-${String(i + 1).padStart(2, '0')}`,
    win: scoreFor > scoreAgainst,
    opponentAbbr: opp,
    isHome,
    scoreFor,
    scoreAgainst,
  };
}

/** Twelve games, alternating venue, margins from -3 to +8. */
const ROWS = Array.from({ length: 12 }, (_, i) => row(i, 4 + (i % 5), 4 + ((i + 2) % 4), i % 2 === 0));

test('a favourite and a dog use the same threshold expression, opposite signs', () => {
  // -1.5 means cover above +1.5; +1.5 means cover above -1.5. One expression.
  const fav = toGameTeamForm({ rows: ROWS, teamAbbr: 'NYY', spreadPoint: -1.5 });
  const dog = toGameTeamForm({ rows: ROWS, teamAbbr: 'BOS', spreadPoint: 1.5 });
  const favRate = fav.gameContext!.rows.find((r) => r.key === 'rate')!.value;
  const dogRate = dog.gameContext!.rows.find((r) => r.key === 'rate')!.value;
  assert.notEqual(favRate, dogRate, 'the same games against opposite spreads cannot cover at the same rate');
  assert.equal(fav.gameContext!.rows.find((r) => r.key === 'line')!.value, '1.5');
  assert.equal(dog.gameContext!.rows.find((r) => r.key === 'line')!.value, '-1.5');
});

test('with no spread priced it grades the result, not the margin', () => {
  const r = toGameTeamForm({ rows: ROWS, teamAbbr: 'NYY', spreadPoint: null });
  assert.match(r.gameContext!.title, /Game context/);
  // A win/loss series only ever takes 0 or 1, so its average cannot exceed 1.
  const mean = Number(r.gameContext!.rows.find((x) => x.key === 'mean')!.value);
  assert.ok(mean >= 0 && mean <= 1, `a result series averaged ${mean}, which is a margin not a result`);
});

test('rows are sorted by date here, not trusted from the caller', () => {
  // Several adapters slice a newest-first list for their last-five block. A
  // rolling mean and a recency window both read the sequence as time.
  const shuffled = [...ROWS].reverse();
  const a = toGameTeamForm({ rows: ROWS, teamAbbr: 'NYY', spreadPoint: -1.5 });
  const b = toGameTeamForm({ rows: shuffled, teamAbbr: 'NYY', spreadPoint: -1.5 });
  assert.deepEqual(
    a.rollingForm!.labels,
    b.rollingForm!.labels,
    'a reversed input must produce the same timeline, or the card depends on API order',
  );
});

test('a negative margin survives — it is a real loss, not an unparseable row', () => {
  const blowouts = Array.from({ length: 8 }, (_, i) => row(i, 1, 9, i % 2 === 0));
  const r = toGameTeamForm({ rows: blowouts, teamAbbr: 'NYY', spreadPoint: -1.5 });
  const mean = Number(r.gameContext!.rows.find((x) => x.key === 'mean')!.value);
  assert.equal(mean, -8, 'eight-point losses must average -8, not be dropped as unreadable');
});

test('fewer than four results builds nothing rather than a claim off three games', () => {
  assert.deepEqual(toGameTeamForm({ rows: ROWS.slice(0, 3), teamAbbr: 'NYY', spreadPoint: -1.5 }), {});
  assert.deepEqual(toGameTeamForm({ rows: [], teamAbbr: 'NYY', spreadPoint: null }), {});
});

test('the venue split needs both sides, and these rows have them', () => {
  const r = toGameTeamForm({ rows: ROWS, teamAbbr: 'NYY', spreadPoint: -1.5 });
  assert.ok(r.binarySplit, 'six home and six away is a real split');
  assert.deepEqual([r.binarySplit!.aLabel, r.binarySplit!.bLabel], ['Home', 'Away']);

  const allHome = ROWS.map((x) => ({ ...x, isHome: true }));
  assert.equal(
    toGameTeamForm({ rows: allHome, teamAbbr: 'NYY', spreadPoint: -1.5 }).binarySplit,
    null,
    'twelve home games and no away games is not a venue split',
  );
});

test('head to head counts only the named opponent', () => {
  const mixed = ROWS.map((x, i) => ({ ...x, opponentAbbr: i < 5 ? 'BOS' : 'TOR' }));
  const r = toGameTeamForm({ rows: mixed, teamAbbr: 'NYY', opponentAbbr: 'BOS', spreadPoint: -1.5 });
  assert.equal(r.careerH2H!.sampleSize, 5, 'the seven TOR games must not leak in');
  assert.equal(r.careerH2H!.opponentLabel, 'vs BOS');
});
