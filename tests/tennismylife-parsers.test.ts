import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { breakPointsConverted, buildTennisSeasonContext, parseTennisCsv, returnPointsWon } from '../lib/sports/tennis/tennismylife';

/**
 * R4 step 5 — TennisMyLife rows keep serve, return, break-point, minutes and
 * rank columns. Real rows from the 2026 ATP CSV (tests/fixtures), checked
 * against the G2 tennis dataset built from the same archive.
 */

const rows = parseTennisCsv(readFileSync('tests/fixtures/tennismylife-sample.csv', 'utf8'));
const context = buildTennisSeasonContext(rows);
const g2 = JSON.parse(readFileSync('docs/design/phase-g2/data/game-tennis-paul-zverev.json', 'utf8')).tennis;
const paul = context.byName.get([...context.byName.keys()].find((k) => context.byName.get(k)!.realName === 'Tommy Paul')!)!;

const g2Serve = (s: Record<string, number>) => ({
  aces: s.ace, doubleFaults: s.df, servePoints: s.svpt, firstIn: s['1stIn'], firstWon: s['1stWon'],
  secondWon: s['2ndWon'], serviceGames: s.SvGms, breakPointsSaved: s.bpSaved, breakPointsFaced: s.bpFaced,
});

test('the match row matches G2: level, minutes, ranks and both sides of serve', () => {
  const m = paul.matches.find((x) => x.tournamentName === 'Cincinnati Masters')!;
  assert.equal(m.level, g2.level);
  assert.equal(m.minutes, g2.minutes);
  assert.equal(m.bestOf, g2.bestOf);
  assert.equal(m.round, g2.round);
  assert.equal(m.indoor, false);
  const [me, them] = g2.players;
  assert.equal(m.rank, me.rank);
  assert.equal(m.rankPoints, me.points);
  assert.equal(m.seed, Number(me.seed));
  assert.equal(m.opponentRank, them.rank);
  assert.deepEqual(m.serve, g2Serve(me.stats));
  assert.deepEqual(m.opponentServe, g2Serve(them.stats));
});

test("a loss puts this player's numbers on the loser's columns (G2 season row)", () => {
  const m = paul.matches.find((x) => x.tournamentName === 'Brisbane')!;
  const t = g2.players[0].season.find((r: { tourney: string }) => r.tourney === 'Brisbane');
  assert.equal(m.isWinner, t.won);
  assert.equal(m.opponentRank, t.oppRank);
  assert.deepEqual(m.serve, g2Serve(t.me));
  assert.deepEqual(m.opponentServe, g2Serve(t.them));
  // 110 opponent serve points, 60 + 19 won by the server: 31 returned.
  assert.deepEqual(returnPointsWon(m), { won: 31, of: 110 });
  assert.deepEqual(breakPointsConverted(m), { won: 1, of: 3 });
});

test('rounds order a run through one event; walkovers are skipped', () => {
  assert.deepEqual(paul.matches.map((m) => m.tournamentName), ['Brisbane', 'Cincinnati Masters']);
  assert.ok(rows.some((r) => r.score === 'W/O'), 'the fixture holds a walkover');
  assert.ok(![...context.byName.values()].some((e) => e.matches.some((m) => m.matchId.startsWith('Adelaide'))));
});

test('blank cells are null, not zero', () => {
  const [row] = parseTennisCsv('winner_name,loser_name,score,minutes,w_svpt,w_ace\nA B,C D,6-0 6-0,,,\n');
  const m = buildTennisSeasonContext([row]).byName.values().next().value!.matches[0];
  assert.equal(m.minutes, null);
  assert.equal(m.serve, null);
  assert.equal(m.rank, null);
  assert.equal(returnPointsWon(m), null);
});
