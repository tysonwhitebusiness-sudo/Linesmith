import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPlayerResearch, col, count, games, perGame, ratio, total } from '../lib/sports/shared/playerResearch';
import { rankTiles, rankable, type PlayerPool } from '../lib/sports/shared/playerPool';
import { FORM_LINE_KEYS, hitterLine, pitcherLine, quarterbackLine, receiverLine, rusherLine, skaterLine } from '../lib/sports/shared/formLine';
import type { PlayerGame, PlayerHistory } from '../lib/sports/shared/playerResearchShapes';
import { footballResearchSpec } from '../lib/sports/nfl/adapters/playerResearchSpec';

/**
 * C2.1 — the hero's new data: tile ranks from the season pool, the form rows'
 * stat lines, and the season-scope chip.
 */

function game(i: number, stats: PlayerGame['stats'], season = 2025): PlayerGame {
  return {
    eventId: `e${i}`,
    date: `${season}-10-${String(10 + i).padStart(2, '0')}`,
    season,
    teamId: '1',
    opponentId: String(100 + i),
    isHome: i % 2 === 0,
    stats,
    result: i % 3 === 0 ? 'L' : 'W',
    teamScore: 24,
    opponentScore: 17,
    opponent: { name: `Opp ${i}`, abbr: `O${i}`, logoUrl: `https://x/o${i}.png` },
  };
}

const POOL: PlayerPool = {
  group: 'RB',
  label: 'RB',
  seasons: {
    2025: [
      { athleteId: 'me', games: 10, stats: { 'rushing.rushingYards': 900, 'rushing.rushingAttempts': 180, 'rushing.rushingTouchdowns': 8 } },
      { athleteId: 'a', games: 10, stats: { 'rushing.rushingYards': 1200, 'rushing.rushingAttempts': 200, 'rushing.rushingTouchdowns': 4 } },
      { athleteId: 'b', games: 10, stats: { 'rushing.rushingYards': 500, 'rushing.rushingAttempts': 150, 'rushing.rushingTouchdowns': 2 } },
      { athleteId: 'c', games: 9, stats: { 'rushing.rushingYards': 700, 'rushing.rushingAttempts': 100, 'rushing.rushingTouchdowns': 12 } },
      // Two games: below the floor, neither ranked nor ranked against.
      { athleteId: 'thin', games: 2, stats: { 'rushing.rushingYards': 400, 'rushing.rushingAttempts': 20, 'rushing.rushingTouchdowns': 3 } },
    ],
  },
};

test('a total tile is ranked against the pool, and the thin player is left out', () => {
  const [r] = rankTiles([col('y', 'Rush yds', total('rushing.rushingYards'))], POOL, 2025, 'me');
  assert.deepEqual(r, { rank: 2, of: 4, pool: 'RB', percentile: 67 });
});

test('a ratio of totals is ranked by its own math', () => {
  // YPC: me 5.0, a 6.0, b 3.33, c 7.0 -> 3rd of 4.
  const [r] = rankTiles([col('ypc', 'YPC', ratio(total('rushing.rushingYards'), total('rushing.rushingAttempts')), 1)], POOL, 2025, 'me');
  assert.equal(r?.rank, 3);
});

test('per-game rates survive the even split', () => {
  const [r] = rankTiles([col('ypg', 'Yds/G', perGame('rushing.rushingYards'), 1)], POOL, 2025, 'c');
  // c: 700/9 = 77.8; a 120, me 90, b 50 -> 3rd.
  assert.equal(r?.rank, 3);
});

test('lower-is-better rates rank the smallest first', () => {
  // TD per carry as a stand-in rate: c 0.12, me 0.044, a 0.02, b 0.013.
  const [r] = rankTiles([col('tdc', 'TD/carry', ratio(total('rushing.rushingTouchdowns'), total('rushing.rushingAttempts')), 3, { leader: 'low' })], POOL, 2025, 'c');
  assert.equal(r?.rank, 4, 'c has the highest rate, so with leader low it is last');
});

test('a lower-is-better TOTAL is not ranked: fewest is whoever played least', () => {
  const [r] = rankTiles([col('td', 'TD', total('rushing.rushingTouchdowns'), 0, { leader: 'low' })], POOL, 2025, 'c');
  assert.equal(r, undefined);
});

test('tiles that cannot be ranked honestly get no rank', () => {
  const tiles = [
    col('g', 'G', games()),
    col('tdg', 'TD games', count((g) => (Number(g.stats['rushing.rushingTouchdowns']) || 0) > 0)),
    col('rec', 'Rec', total('receiving.receptions')),
  ];
  assert.deepEqual(rankTiles(tiles, POOL, 2025, 'me'), [undefined, undefined, undefined]);
});

test('the rankability checks, one by one', () => {
  const me = POOL.seasons[2025][0];
  const keys = new Set(Object.keys(me.stats));
  assert.equal(rankable(total('rushing.rushingYards'), me, keys), true);
  assert.equal(rankable(games(), me, keys), false, 'reads no stat');
  assert.equal(rankable(total('bat_rbi'), me, keys), false, 'a key the pool lacks');
  assert.equal(rankable(count((g) => (Number(g.stats['rushing.rushingYards']) || 0) > 50), me, keys), false, 'a count of games');
});

test('one outlier row does not set the floor', () => {
  // MLB's pitcher pool holds position players who pitched once, with a full
  // season of games each. The floor must not follow them up.
  const starters = Array.from({ length: 40 }, (_, i) => ({ athleteId: `s${i}`, games: 30, stats: { pit_strikeOuts: 100 + i } }));
  const pool: PlayerPool = { group: 'pitcher', label: 'pitchers', seasons: { 2026: [...starters, { athleteId: 'ss', games: 142, stats: { pit_strikeOuts: 0 } }] } };
  const [r] = rankTiles([col('k', 'K', total('pit_strikeOuts'))], pool, 2026, 's39');
  assert.equal(r?.rank, 1);
});

test('a player missing from the pool, or below its floor, has no ranks', () => {
  const t = [col('y', 'Rush yds', total('rushing.rushingYards'))];
  assert.deepEqual(rankTiles(t, POOL, 2025, 'nobody'), [undefined]);
  assert.deepEqual(rankTiles(t, POOL, 2025, 'thin'), [undefined]);
  assert.deepEqual(rankTiles(t, POOL, 2024, 'me'), [undefined]);
  assert.deepEqual(rankTiles(t, null, 2025, 'me'), [undefined]);
});

test('buildPlayerResearch carries ranks, form lines and the opponent onto the hero', () => {
  const history: PlayerHistory = {
    sport: 'nfl',
    athleteId: 'me',
    games: Array.from({ length: 10 }, (_, i) =>
      game(i, { 'rushing.rushingYards': 90, 'rushing.rushingAttempts': 18, 'rushing.rushingTouchdowns': i < 8 ? 1 : 0 }),
    ),
    asOf: null,
    resultsSource: 'test',
  };
  const spec = footballResearchSpec('nfl', { positionAbbr: 'RB' } as never, history.games);
  const out = buildPlayerResearch({ sport: 'nfl', history, spec, now: new Date('2025-12-01T12:00:00Z'), pool: POOL });
  assert.ok(out);
  const yds = out.hero.tiles.find((t) => t.label === 'Rush yds');
  assert.equal(yds?.rank?.rank, 2);
  assert.equal(out.hero.tiles.find((t) => t.label === 'G')?.rank, undefined);
  const last = out.hero.lastFive[out.hero.lastFive.length - 1];
  assert.equal(last.line, '18 car · 90 yds');
  assert.equal(last.opponentAbbr, 'O9');
  assert.equal(last.opponentLogo, 'https://x/o9.png');
  assert.equal(out.hero.scopeChip, null, 'on the current season, no chip');
});

test('the scope chip says which season is under way and how little of it there is', () => {
  const history: PlayerHistory = {
    sport: 'nfl',
    athleteId: 'me',
    games: [...Array.from({ length: 10 }, (_, i) => game(i, { 'rushing.rushingYards': 50 })), game(20, { 'rushing.rushingYards': 10 }, 2026)],
    asOf: null,
    resultsSource: 'test',
  };
  const spec = footballResearchSpec('nfl', { positionAbbr: 'RB' } as never, history.games);
  const out = buildPlayerResearch({ sport: 'nfl', history, spec, now: new Date('2026-09-15T12:00:00Z') });
  assert.match(out?.hero.scopeChip ?? '', /^2026-27: 1 game so far$/);
});

test('form lines print each sport shorthand, and nothing for a game that recorded none of it', () => {
  const g = (stats: PlayerGame['stats']) => game(1, stats);
  assert.equal(rusherLine(g({ 'rushing.rushingAttempts': 14, 'rushing.rushingYards': 38 })), '14 car · 38 yds');
  assert.equal(rusherLine(g({ 'rushing.rushingAttempts': 22, 'rushing.rushingYards': 118, 'rushing.rushingTouchdowns': 1 })), '22 car · 118 yds · 1 TD');
  assert.equal(receiverLine(g({ 'receiving.receptions': 7, 'receiving.receivingYards': 88 })), '7 rec · 88 yds');
  assert.equal(quarterbackLine(g({ 'passing.completions': 24, 'passing.passingAttempts': 35, 'passing.passingYards': 281, 'passing.passingTouchdowns': 2 })), '24/35 · 281 yds · 2 TD');
  assert.equal(hitterLine(g({ bat_hits: 2, bat_atBats: 4, bat_homeRuns: 1, bat_rbi: 3 })), '2-4 · HR · 3 RBI');
  assert.equal(pitcherLine(g({ pit_inningsPitched: 6.1, pit_strikeOuts: 8, pit_earnedRuns: 2 })), '6.1 IP · 8 K · 2 ER');
  assert.equal(skaterLine(g({ goals: 1, assists: 2, sog: 5 })), '1-2 · 5 SOG');
  assert.equal(rusherLine(g({ 'receiving.receptions': 3 })), null);
});

test('the form-line keys are the keys the Python receipts print from', () => {
  const py = readFileSync('python-odds-service/src/slate_rankings.py', 'utf8');
  const body = py.slice(py.indexOf('def detail_line('), py.indexOf('DID_NOT_PLAY ='));
  for (const key of [...FORM_LINE_KEYS.rusher, ...FORM_LINE_KEYS.receiver, ...FORM_LINE_KEYS.skater.filter((k) => k !== 'assists'), 'bat_hits', 'bat_atBats', 'bat_homeRuns', 'bat_rbi', 'pit_strikeOuts', 'pit_earnedRuns', 'pit_inningsPitched']) {
    assert.ok(body.includes(`'${key}'`) || body.includes(`"${key}"`), `${key} is printed by detail_line too`);
  }
});
