import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAtBats, parseMlbWinProbability, pitchMix } from '../lib/sports/mlb/liveFeedParsers';

/**
 * R4 steps 3-4 — MLB live feed and win probability, on a real saved game
 * (KC @ BOS, gamePk 824711) compared field by field with the G2 dataset built
 * from the same feed.
 */

const feed = JSON.parse(readFileSync('tests/fixtures/mlb-feed-824711.json', 'utf8'));
const wp = JSON.parse(readFileSync('tests/fixtures/mlb-winprob-824711.json', 'utf8'));
const g2 = JSON.parse(readFileSync('docs/design/phase-g2/data/game-mlb-kc-bos.json', 'utf8'));

test('every at-bat, pitch and batted ball matches G2', () => {
  const mine = parseAtBats(feed);
  assert.equal(mine.length, g2.atBats.length);
  mine.forEach((ab, i) => {
    const t = g2.atBats[i];
    assert.equal(ab.index, t.i);
    assert.equal(ab.batterId, t.batterId);
    assert.equal(ab.pitcherId, t.pitcherId);
    assert.equal(ab.eventType, t.eventType);
    assert.equal(ab.homeScore, t.home);
    assert.equal(ab.pitches.length, t.pitches.length, `pitch count at-bat ${i}`);
    ab.pitches.forEach((p, j) => {
      const [type, speed, pX, pZ, code] = t.pitches[j];
      assert.equal(p.type, type);
      assert.equal(p.speed, speed);
      assert.equal(p.pX, pX);
      assert.equal(p.pZ, pZ);
      assert.equal(p.callCode, code);
    });
    if (t.hit) {
      assert.ok(ab.battedBall, `batted ball at-bat ${i}`);
      assert.equal(ab.battedBall!.distance, t.hit.dist);
      assert.equal(ab.battedBall!.exitVelocity, t.hit.ev);
      assert.equal(ab.battedBall!.coordX, t.hit.x);
    } else assert.equal(ab.battedBall, null);
  });
});

test('win probability matches G2 by plate appearance, as 0-1', () => {
  const mine = parseMlbWinProbability(wp);
  assert.equal(mine.length, g2.wp.length);
  mine.forEach((p, i) => {
    assert.equal(p.atBatIndex, g2.wp[i][0]);
    assert.ok(Math.abs(p.home - g2.wp[i][1]) < 5e-5);
    assert.ok(Math.abs(p.added - g2.wp[i][2]) < 0.01);
  });
});

test('pitch mix sums to the pitcher’s pitches', () => {
  const abs = parseAtBats(feed);
  const starter = abs[0].pitcherId!;
  const mix = pitchMix(abs, starter);
  const thrown = abs.filter((a) => a.pitcherId === starter).reduce((n, a) => n + a.pitches.filter((p) => p.type).length, 0);
  assert.equal(mix.reduce((n, r) => n + r.count, 0), thrown);
  assert.ok(Math.abs(mix.reduce((s, r) => s + r.share, 0) - 100) < 1e-9);
});

test('empty input parses to empty', () => {
  assert.deepEqual(parseAtBats(null), []);
  assert.deepEqual(parseMlbWinProbability(null), []);
});
