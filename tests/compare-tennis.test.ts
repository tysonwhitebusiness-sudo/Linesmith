import test from 'node:test';
import assert from 'node:assert/strict';
import { tennisCompareCards, tennisServeProfile } from '../lib/sports/tennis/adapters/compareCards';
import type { TennisArchiveMatch } from '../lib/sports/tennis/playerArchiveShapes';

/**
 * R10.4d — tennis compare, which is built from the TennisMyLife archive because
 * tennis has no team rollups at all (R10 Step 0).
 *
 * Rendered on prod 2026-09-18 (Samsonova vs Sabalenka). R10-F4, "a tennis page
 * makes no client fetches", was the browser pane's stale-tab quirk, not the app.
 * That render found the head-to-head dates all "Invalid Date": the fixture used
 * a bare day where the archive carries a full ISO timestamp. The fixture now
 * uses the real shape.
 */

const match = (m: Partial<TennisArchiveMatch>): TennisArchiveMatch => ({
  date: '2026-01-15T00:00:00.000Z',
  season: 2026,
  tournamentName: 'Test Open',
  surface: 'Hard',
  level: 'A',
  round: 'R16',
  opponent: 'Rival Player',
  isWinner: true,
  rank: 10,
  aces: 5,
  serve: { points: 100, firstIn: 60, firstWon: 45, secondWon: 20 },
  opponentServe: { points: 80, firstWon: 30, secondWon: 14 },
  ...m,
});

test('a serve profile divides each rate by its own denominator, and the return is the server’s loss', () => {
  const p = tennisServeProfile([match({}), match({ aces: 3 })]);
  assert.equal(p.matches, 2);
  assert.equal(p.acesPerMatch, 4, 'five and three aces');
  assert.equal(p.firstInPct, 60, '120 first serves in of 200 points');
  assert.equal(p.firstWonPct, 75, '90 won of the 120 in — NOT of all points');
  // Second-serve points are the first serves that missed: 200 - 120 = 80.
  assert.equal(p.secondWonPct, 50, '40 won of 80');
  // The opponent won 44 of his own 80 service points, so the returner won 36.
  assert.equal(p.returnWonPct, 45);
});

test('a match with no serve detail is left out of the rates, not counted as zero', () => {
  const p = tennisServeProfile([match({}), match({ serve: null, opponentServe: null, aces: null })]);
  assert.equal(p.firstInPct, 60, 'the second match has no serve row to add');
  assert.equal(p.acesPerMatch, 5, 'and no ace count either');
  assert.equal(p.matches, 2, 'it still happened');
});

test('compare builds the serve dumbbell and the head to head, and needs both players', () => {
  const mine = [match({}), match({ opponent: 'Someone Else', isWinner: false })];
  const theirs = [match({ serve: { points: 100, firstIn: 50, firstWon: 40, secondWon: 25 } })];
  const cards = tennisCompareCards({ subjectName: 'Subject', subjectMatches: mine, peerName: 'Rival Player', peerMatches: theirs });
  assert.deepEqual(cards.map((c) => c.key), ['tennis-serve-vs', 'tennis-h2h']);
  const dumbbell = cards[0];
  assert.ok(dumbbell.kind === 'dumbbell');
  assert.equal(dumbbell.rows.find((r) => r.key === 'firstIn')?.a, 60);
  assert.equal(dumbbell.rows.find((r) => r.key === 'firstIn')?.b, 50);
  const h2h = cards[1];
  assert.ok(h2h.kind === 'table');
  assert.equal(h2h.rows.length, 1, 'only the meetings with that opponent');
  assert.equal(h2h.scope, '1-0 in the seasons held');
  assert.equal(h2h.rows[0].label, 'Jan 15, 2026', 'the archive date is a full ISO timestamp');
  assert.deepEqual(tennisCompareCards({ subjectName: 'Subject', subjectMatches: mine, peerName: null, peerMatches: null }), []);
});

test('no meeting means no head-to-head card, but the profiles still compare', () => {
  const cards = tennisCompareCards({
    subjectName: 'Subject',
    subjectMatches: [match({ opponent: 'Someone Else' })],
    peerName: 'Rival Player',
    peerMatches: [match({})],
  });
  assert.deepEqual(cards.map((c) => c.key), ['tennis-serve-vs']);
});
