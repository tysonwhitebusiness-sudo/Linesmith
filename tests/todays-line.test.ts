// P1 (odds workstream, 2026-09-24): the player page's game line from
// /api/odds/lines, for every sport without a game model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PickCandidate } from '../lib/core/types';
import type { UnifiedGameLine } from '../lib/odds/types';
import { gamePkOf, gameSideOf, todaysLineFromGameLines } from '../lib/sports/shared/todaysLine';

const line = (extra: Partial<UnifiedGameLine> = {}): UnifiedGameLine => ({
  eventId: 'G1',
  commenceTime: '2026-09-27T17:00:00Z',
  homeTeam: 'Green Bay Packers',
  awayTeam: 'Dallas Cowboys',
  moneyline: { home: -180, away: 155, book: 'draftkings' },
  total: { point: 47.5, overPrice: -110, underPrice: -110, book: 'fanduel' },
  bookmakers: [],
  bookCount: 2,
  source: 'game-odds-book-lines',
  ...extra,
});

test('the line is found by eventId, with the book on both halves', () => {
  const t = todaysLineFromGameLines([line({ eventId: 'OTHER' }), line()], 'G1');
  assert.deepEqual(t?.moneyline, { away: 155, home: -180, book: 'draftkings', source: 'game-odds-book-lines' });
  assert.deepEqual(t?.total, { point: 47.5, overPrice: -110, underPrice: -110, book: 'fanduel', source: 'game-odds-book-lines' });
});

test('a moneyline needs home, away and a book', () => {
  assert.equal(todaysLineFromGameLines([line({ moneyline: { home: -180, book: 'dk' } })], 'G1')?.moneyline, null);
  assert.equal(todaysLineFromGameLines([line({ moneyline: { home: -180, away: 155 } })], 'G1')?.moneyline, null);
});

test('a total needs its point, both prices and a book', () => {
  assert.equal(todaysLineFromGameLines([line({ total: { overPrice: -110, underPrice: -110, book: 'fd' } })], 'G1')?.total, null);
  assert.equal(todaysLineFromGameLines([line({ total: { point: 47.5, overPrice: -110, book: 'fd' } })], 'G1')?.total, null);
  assert.equal(todaysLineFromGameLines([line({ total: { point: 47.5, overPrice: -110, underPrice: -110 } })], 'G1')?.total, null);
});

test('neither half priced -> null; no game id or no matching line -> null', () => {
  assert.equal(todaysLineFromGameLines([line({ moneyline: {}, total: {} })], 'G1'), null);
  assert.equal(todaysLineFromGameLines([line()], undefined), null);
  assert.equal(todaysLineFromGameLines([line()], 'G2'), null);
  assert.equal(todaysLineFromGameLines(null, 'G1'), null);
});

test('the live score and period are carried over', () => {
  const t = todaysLineFromGameLines([line({ liveScore: { home: '14', away: '7' }, livePeriod: 'Q2' })], 'G1');
  assert.deepEqual(t?.liveScore, { home: '14', away: '7' });
  assert.equal(t?.livePeriod, 'Q2');
});

test('the source is the line’s own writer (OddsChip reads it as provenance)', () => {
  assert.equal(todaysLineFromGameLines([line({ source: 'oddsharvester' })], 'G1')?.moneyline?.source, 'oddsharvester');
});

test('gamePkOf reads a number or a string gamePk', () => {
  const c = (gamePk: unknown) => ({ subjectMeta: { gamePk } }) as unknown as PickCandidate;
  assert.equal(gamePkOf(c(776001)), '776001');
  assert.equal(gamePkOf(c('401772')), '401772');
  assert.equal(gamePkOf(c(null)), undefined);
  assert.equal(gamePkOf(undefined), undefined);
});

test('the player’s side travels with the line, so the card labels each price correctly', () => {
  const c = (isHome: unknown) => ({ subjectMeta: { isHome } }) as unknown as PickCandidate;
  assert.equal(gameSideOf(c(true)), 'home');
  assert.equal(gameSideOf(c(false)), 'away');
  assert.equal(gameSideOf(c(undefined)), null, 'tennis: no side, the card says Away / Home');
  assert.equal(todaysLineFromGameLines([line()], 'G1', 'away')?.playerSide, 'away');
  assert.equal(todaysLineFromGameLines([line()], 'G1')?.playerSide, null);
});
