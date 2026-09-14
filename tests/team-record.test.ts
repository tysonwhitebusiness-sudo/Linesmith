/**
 * R1b — the team header's record and standing.
 *
 * Every case here is one of the four faults the audit found on a real page
 * (B6, F-B8, F-B11), pinned so they can't come back:
 *   - "0th seed" out of season;
 *   - "4th seed, Eastern Conference **in division**";
 *   - a soccer record that counted draws as losses;
 *   - an NHL record that dropped overtime losses.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordinal, formatTeamRecord, standingPhrase, hasPlayedGames } from '../lib/sports/shared/teamRecord';

test('ordinal formats real ranks', () => {
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(4), '4th');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(13), '13th');
  assert.equal(ordinal(21), '21st');
  assert.equal(ordinal(22), '22nd');
  assert.equal(ordinal(23), '23rd');
  assert.equal(ordinal(101), '101st');
  assert.equal(ordinal(111), '111th');
});

test('ordinal refuses a rank that is not a standing', () => {
  // B6: the NBA header read "0th seed" all offseason.
  assert.equal(ordinal(0), '');
  assert.equal(ordinal('0'), '');
  assert.equal(ordinal(null), '');
  assert.equal(ordinal(undefined), '');
  assert.equal(ordinal(''), '');
  assert.equal(ordinal('not a rank'), '');
  assert.equal(ordinal(-3), '');
  assert.equal(ordinal(Number.NaN), '');
});

test('ordinal accepts the string ranks the standings routes actually send', () => {
  // /api/cfb/teams and /api/soccer/[league]/teams both send `String(s.rank)`.
  assert.equal(ordinal('7'), '7th');
});

test('a two-outcome sport keeps W-L', () => {
  assert.equal(formatTeamRecord({ wins: 88, losses: 60 }), '88-60');
  assert.equal(formatTeamRecord({ wins: 0, losses: 0 }), '0-0');
});

test('soccer is W-D-L, with draws in the middle (F-B8)', () => {
  assert.equal(formatTeamRecord({ wins: 5, losses: 2, draws: 3 }), '5-3-2');
  // A drawn game is not a loss: 10 games played, not 7.
  const r = { wins: 5, losses: 2, draws: 3 };
  assert.equal(r.wins + r.draws + r.losses, 10);
});

test('soccer shows a real 0 draws rather than collapsing to W-L', () => {
  assert.equal(formatTeamRecord({ wins: 4, losses: 1, draws: 0 }), '4-0-1');
});

test('NHL is W-L-OTL, with overtime losses last (F-B11)', () => {
  assert.equal(formatTeamRecord({ wins: 40, losses: 25, otLosses: 7 }), '40-25-7');
  assert.equal(formatTeamRecord({ wins: 40, losses: 25, otLosses: 0 }), '40-25-0');
});

test('standingPhrase names the group the rank was taken in', () => {
  assert.equal(standingPhrase(2, 'AL Central'), '2nd in AL Central');
  assert.equal(standingPhrase('1', 'NFC East'), '1st in NFC East');
  assert.equal(standingPhrase(4, 'Eastern Conference'), '4th in Eastern Conference');
});

test('standingPhrase never emits the old " in division" nonsense', () => {
  // The component used to append " in division" to whatever it was given, so
  // NBA rendered "4th seed, Eastern Conference in division".
  assert.ok(!standingPhrase(4, 'Eastern Conference').includes('in division'));
  assert.ok(!standingPhrase(4, 'Eastern Conference').includes('seed'));
});

test('standingPhrase is empty when there is no real rank', () => {
  // NHL's standings feed publishes no rank at all; the conference name on its
  // own was rendering as "Eastern in division".
  assert.equal(standingPhrase('', 'Eastern Conference'), '');
  assert.equal(standingPhrase(0, 'Eastern Conference'), '');
  assert.equal(standingPhrase(null, 'Eastern Conference'), '');
  assert.equal(standingPhrase(undefined, undefined), '');
});

test('standingPhrase carries a sport suffix, and drops it with the rank', () => {
  assert.equal(standingPhrase(3, 'Premier League', '15 pts'), '3rd in Premier League · 15 pts');
  assert.equal(standingPhrase(0, 'Premier League', '0 pts'), '');
});

test('standingPhrase survives a missing group name', () => {
  assert.equal(standingPhrase(3, null), '3rd');
  assert.equal(standingPhrase(3, '   '), '3rd');
});

test('hasPlayedGames tells a real record from an empty standings row', () => {
  // NBA's offseason standings feed returns 0-0; NHL's keeps last season's real
  // numbers. Only the second is something to label "Last season".
  assert.equal(hasPlayedGames({ wins: 0, losses: 0 }), false);
  assert.equal(hasPlayedGames({ wins: 0, losses: 0, draws: 0 }), false);
  assert.equal(hasPlayedGames({ wins: 0, losses: 0, otLosses: 0 }), false);
  assert.equal(hasPlayedGames({ wins: 55, losses: 16, otLosses: 11 }), true);
  assert.equal(hasPlayedGames({ wins: 0, losses: 1, draws: 3 }), true);
  // A record that is only overtime losses is still a season that happened.
  assert.equal(hasPlayedGames({ wins: 0, losses: 0, otLosses: 2 }), true);
});
