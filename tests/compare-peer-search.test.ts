import test from 'node:test';
import assert from 'node:assert/strict';
import { searchPeers, type ComparePeer } from '../lib/sports/shared/compareShapes';

/**
 * R10.2's peer picker "with search". A position group runs to hundreds of
 * names, so the dropdown is narrowed by what the reader types.
 */

const peer = (athleteId: string, name: string): ComparePeer => ({ athleteId, name, teamId: null, games: 60, score: 1, position: 'G' });

const peers = [
  peer('1', 'Luka Dončić'),
  peer('2', 'Amon-Ra St. Brown'),
  peer('3', "De'Aaron Fox"),
  peer('4', 'Jaren Jackson Jr.'),
  peer('5', 'Brandon Williams'),
  peer('6', 'Brandon Williams'),
];

const ids = (ps: ComparePeer[]) => ps.map((p) => p.athleteId);

test('an empty query lists everyone', () => {
  assert.deepEqual(ids(searchPeers(peers, '')), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(ids(searchPeers(peers, '   ')), ['1', '2', '3', '4', '5', '6']);
});

test('accents, case and punctuation are ignored', () => {
  assert.deepEqual(ids(searchPeers(peers, 'doncic')), ['1']);
  assert.deepEqual(ids(searchPeers(peers, 'St Brown')), ['2']);
  assert.deepEqual(ids(searchPeers(peers, 'amon ra')), ['2']);
  assert.deepEqual(ids(searchPeers(peers, "De'Aaron")), ['3']);
  assert.deepEqual(ids(searchPeers(peers, 'deaaron')), ['3'], 'typed without the apostrophe');
  assert.deepEqual(ids(searchPeers(peers, 'stbrown')), ['2']);
});

test('every word must appear, in any order', () => {
  assert.deepEqual(ids(searchPeers(peers, 'luka d')), ['1']);
  assert.deepEqual(ids(searchPeers(peers, 'jackson jaren')), ['4']);
  assert.deepEqual(ids(searchPeers(peers, 'luka brown')), []);
});

test('two players with one name are both offered', () => {
  assert.deepEqual(ids(searchPeers(peers, 'brandon')), ['5', '6']);
});

test('the chosen peer stays in the list while the search narrows it', () => {
  assert.deepEqual(ids(searchPeers(peers, 'fox', '1')), ['1', '3']);
  assert.deepEqual(ids(searchPeers(peers, 'nobody', '4')), ['4']);
});
