import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePlayByPlay, parsePlayerLanding } from '../lib/sports/nhl/apiWebParsers';

/**
 * R4 step 4 — NHL api-web landing and play-by-play, on real saved responses,
 * compared with the G2 datasets built from the same endpoints.
 */

const read = (f: string) => JSON.parse(readFileSync(f, 'utf8'));

test('official season totals match G2 (skater and goalie)', () => {
  for (const [id, slug] of [['8477492', 'mackinnon'], ['8476883', 'vasilevskiy']] as const) {
    const mine = parsePlayerLanding(read(`tests/fixtures/nhl-landing-${id}.json`))!;
    const theirs = read(`docs/design/phase-g2/data/player-nhl-${slug}.json`);
    const last4 = mine.seasons.slice(-4);
    assert.equal(last4.length, theirs.nhlSeasons.length, `${slug}: seasons`);
    last4.forEach((s, i) => {
      const t = theirs.nhlSeasons[i];
      assert.equal(s.season, t.season);
      assert.equal(s.gamesPlayed, t.gamesPlayed);
      if (mine.isGoalie) {
        assert.equal(s.savePct, t.savePctg);
        assert.equal(s.shutouts, t.shutouts);
      } else {
        assert.equal(s.goals, t.goals);
        assert.equal(s.points, t.points);
        assert.equal(s.avgToi, t.avgToi);
      }
    });
    assert.equal(mine.careerRegularSeason?.gamesPlayed, theirs.nhlCareer.gamesPlayed);
  }
  assert.equal(parsePlayerLanding(read('tests/fixtures/nhl-landing-8476883.json'))!.isGoalie, true);
});

test('play-by-play events match G2 event for event', () => {
  const mine = parsePlayByPlay(read('tests/fixtures/nhl-pbp-2025021270.json'))!;
  const theirs = read('docs/design/phase-g2/data/game-nhl-fla-tor.json').nhl;
  assert.equal(mine.homeTeamId, theirs.homeId);
  assert.equal(mine.events.length, theirs.events.length);
  mine.events.forEach((e, i) => {
    const t = theirs.events[i];
    assert.equal(e.type, t.type);
    assert.equal(e.x, t.x ?? null);
    assert.equal(e.y, t.y ?? null);
    assert.equal(e.shooterId, t.who ?? null);
    assert.equal(e.goalieId, t.goalie ?? null);
    assert.equal(e.situation, t.situation ?? null);
    assert.equal(e.isHome, t.home ?? null);
  });
  assert.equal(Object.keys(mine.roster).length, Object.keys(theirs.roster).length);
});

test('empty input parses to null', () => {
  assert.equal(parsePlayerLanding(null), null);
  assert.equal(parsePlayByPlay({}), null);
});
