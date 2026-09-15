import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  biggestSwings,
  leadTracker,
  parseCommentary,
  parseCourtPlays,
  parseDrives,
  parseGameLines,
  parseInjuries,
  parseLastFive,
  parseLineups,
  parseSeasonSeries,
  parseWinProbability,
  resultVsLine,
  scoringRuns,
  summaryTeams,
} from '../lib/sports/espn/summaryParsers';

/**
 * R4 step 2 — ESPN summary parsers, run on REAL saved summaries for the seven G2
 * reference games (tests/fixtures/espn, trimmed of links and logos only) and
 * checked FIELD BY FIELD against the G2 datasets, which the mockup's Python tools
 * built from the same documents (plan §R4 verify).
 */

const fixture = (k: string) => JSON.parse(readFileSync(`tests/fixtures/espn/summary-${k}.json`, 'utf8'));
const g2 = (slug: string) => JSON.parse(readFileSync(`docs/design/phase-g2/data/game-${slug}.json`, 'utf8'));

const nfl = fixture('nfl');
const cfb = fixture('cfb');
const nba = fixture('nba');
const nhl = fixture('nhl');
const soccer = fixture('soccer');

test('win probability matches the G2 series point for point (NFL, CFB, NBA)', () => {
  for (const [json, slug] of [[nfl, 'nfl-dal-nyg'], [cfb, 'cfb-osu-tex'], [nba, 'nba-okc-lal']] as const) {
    const mine = parseWinProbability(json);
    const theirs: Array<[string, number]> = g2(slug).wp;
    assert.equal(mine.length, theirs.length, `${slug}: point count`);
    mine.forEach((p, i) => {
      assert.equal(p.playId, theirs[i][0], `${slug}: play id ${i}`);
      assert.ok(Math.abs(p.home - theirs[i][1]) < 5e-5, `${slug}: probability ${i}`);
    });
  }
});

test('win-probability points carry their play, and swings are the largest moves', () => {
  const series = parseWinProbability(nfl);
  assert.ok(series.filter((p) => p.text).length > series.length * 0.9, 'most points join to a play with text');
  const swings = biggestSwings(series, 3);
  assert.equal(swings.length, 3);
  assert.ok(Math.abs(swings[0].delta) >= Math.abs(swings[1].delta) && Math.abs(swings[1].delta) >= Math.abs(swings[2].delta));
});

test('drives and their plays match G2 (NFL, CFB)', () => {
  for (const [json, slug] of [[nfl, 'nfl-dal-nyg'], [cfb, 'cfb-osu-tex']] as const) {
    const mine = parseDrives(json);
    const theirs = g2(slug);
    assert.equal(mine.length, theirs.drives.length, `${slug}: drives`);
    mine.forEach((d, i) => {
      const t = theirs.drives[i];
      assert.equal(d.id, t.id);
      assert.equal(d.teamId, t.team);
      assert.equal(d.result, t.result);
      assert.equal(d.yards, t.yards);
      assert.equal(d.startYardLine, t.start);
      assert.equal(d.isScore, t.score);
    });
    const plays = mine.flatMap((d) => d.plays);
    assert.equal(plays.length, theirs.plays.length, `${slug}: plays`);
    plays.forEach((p, i) => {
      const t = theirs.plays[i];
      assert.equal(p.id, t.id);
      assert.equal(p.down, t.down ?? null);
      assert.equal(p.startYardsToEndzone, t.start ?? null);
      assert.equal(p.scoring, t.score === true);
    });
  }
});

test('NBA plays match G2, sentinel coordinates become null, and scoring runs add up', () => {
  const mine = parseCourtPlays(nba);
  const theirs = g2('nba-okc-lal').plays;
  assert.equal(mine.length, theirs.length);
  mine.forEach((p, i) => {
    assert.equal(p.id, theirs[i].id);
    assert.equal(p.x, theirs[i].x ?? null, `x at ${i}`);
    assert.equal(p.y, theirs[i].y ?? null, `y at ${i}`);
    assert.equal(p.athleteId, theirs[i].who ?? null);
  });
  assert.equal(mine.find((p) => p.type === 'End Game')?.x, null, 'the -2^31 sentinel is not a location');
  const lead = leadTracker(mine);
  const last = mine[mine.length - 1];
  assert.equal(lead[lead.length - 1].margin, (last.homeScore ?? 0) - (last.awayScore ?? 0), 'the lead tracker ends on the final margin');
  for (const run of scoringRuns(mine, 8)) assert.ok(run.points >= 8);
});

test('lines parse open and close as numbers, with the soccer draw', () => {
  const l = parseGameLines(nfl)!;
  assert.deepEqual(l.moneyline.home, { open: 110, close: 140 });
  assert.deepEqual(l.moneyline.away, { open: -130, close: -166 });
  assert.equal(l.spread.home.line.close, 3);
  assert.equal(l.total.over.line.open, 48.5, '"o48.5" parses to 48.5');
  assert.equal(l.moneyline.draw, null, 'no draw in a two-way sport');
  assert.equal(l.favoriteAtOpen, 'away');
  const s = parseGameLines(soccer)!;
  assert.deepEqual(s.moneyline.draw, { open: 280, close: 275 });
  // Same numbers the G2 dataset carries for every sport with lines.
  for (const [json, slug] of [[nfl, 'nfl-dal-nyg'], [cfb, 'cfb-osu-tex'], [nba, 'nba-okc-lal'], [nhl, 'nhl-fla-tor'], [soccer, 'soccer-mci-mun']] as const) {
    const t = g2(slug).lines.moneyline;
    const m = parseGameLines(json)!;
    assert.equal(m.moneyline.home.close, Number(t.home.close.odds.replace('+', '')), `${slug} home close`);
    assert.equal(m.moneyline.away.open, Number(t.away.open.odds.replace('+', '')), `${slug} away open`);
  }
});

test('result vs the closing line', () => {
  const lines = parseGameLines(nfl)!;
  // Home +3 closing: losing by 2 covers, losing by 4 does not, losing by 3 pushes.
  assert.equal(resultVsLine(lines, 20, 22).covered, 'home');
  assert.equal(resultVsLine(lines, 20, 24).covered, 'away');
  assert.equal(resultVsLine(lines, 20, 23).covered, 'push');
  assert.equal(resultVsLine(lines, 30, 20).total, 'over', '50 against 47.5');
  assert.equal(resultVsLine(lines, null, 20).covered, null);
});

test('season series and injuries match G2', () => {
  const series = parseSeasonSeries(nba);
  assert.equal(series[0].seriesScore, '4-0');
  assert.equal(series[0].games.length, 4);
  assert.equal(parseSeasonSeries(soccer)[0].type, 'head-to-head');
  const inj = parseInjuries(nfl, '2026-09-14T00:00:00Z');
  const theirs = g2('nfl-dal-nyg').injuries;
  assert.equal(inj.teams.length, theirs.length);
  inj.teams.forEach((t, i) => assert.equal(t.items.length, theirs[i].items.length, `team ${i} injury count`));
  assert.equal(inj.fetchedAt, '2026-09-14T00:00:00Z', 'the report says when it was fetched');
});

test('soccer lineups, commentary positions and form match G2', () => {
  const t = g2('soccer-mci-mun');
  const lineups = parseLineups(soccer);
  assert.equal(lineups.length, 2);
  lineups.forEach((l, i) => {
    assert.equal(l.formation, t.rosters[i].formation);
    assert.equal(l.players.length, t.rosters[i].players.length);
    assert.equal(l.players.filter((p) => p.starter).length, 11, 'eleven starters');
  });
  const events = parseCommentary(soccer);
  assert.equal(events.length, t.events.length);
  events.forEach((e, i) => {
    assert.equal(e.x, t.events[i].x ?? null);
    assert.equal(e.y, t.events[i].y ?? null);
  });
  assert.ok(events.some((e) => e.x != null), 'some events carry a pitch position');
  const form = parseLastFive(soccer);
  form.forEach((f, i) => assert.deepEqual(f.games.map((g) => g.result), t.lastFive[i].events.map((e: { result: string }) => e.result)));
});

test('a summary with nothing in it parses to empty, not a crash', () => {
  for (const empty of [null, {}]) {
    assert.deepEqual(parseWinProbability(empty), []);
    assert.deepEqual(parseDrives(empty), []);
    assert.deepEqual(parseCourtPlays(empty), []);
    assert.equal(parseGameLines(empty), null);
    assert.deepEqual(parseSeasonSeries(empty), []);
    assert.deepEqual(parseLineups(empty), []);
    assert.deepEqual(summaryTeams(empty), { home: null, away: null });
  }
});
