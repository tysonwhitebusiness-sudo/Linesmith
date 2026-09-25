import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flagScope, groupFlags, selectFlags, type ResearchFlag } from '../lib/slate/flags';
import { flagSpotlightCards, weatherSpotlight } from '../lib/slate/spotlights';
import type { SlateGameCard } from '../lib/sports/shared/slateShapes';

/**
 * F0's guard — the research flags.
 *
 * The rows are the Python job's, so nothing here tests a ranking. What it
 * tests is the part TypeScript owns: which page a row belongs to, how a rank
 * reads, and that a GAME-subject row (MLB's HR parks, N5's weather) is never
 * drawn as if it were a person.
 *
 * The id shapes are the ones measured on the real table on 2026-09-22:
 * `mlb-platoon-spots` ranks players with a numeric MLB athlete id, and
 * `mlb-hr-parks` ranks GAMES — its `subject_id` IS the `game_id` and its name
 * is "AZ @ COL".
 */

function flag(over: Partial<ResearchFlag> = {}): ResearchFlag {
  return {
    rankingId: 'mlb-platoon-spots',
    title: 'Platoon spots',
    promo: 'Batters facing their good side',
    rank: 1,
    of: 10,
    subjectId: '656876',
    subjectName: 'Drew Rasmussen',
    subjectKind: 'player',
    team: 'TB',
    teamId: '139',
    opponent: 'NYY',
    opponentId: '147',
    gameId: '823494',
    read: 'Faces a lineup striking out 24.5% of the time.',
    factors: [{ key: 'slg_vs_hand', label: 'SLG vs hand', info: 'Slugging against the hand this starter throws.', value: 0.612, percentile: 94 }],
    score: 71.7,
    frozen: true,
    ...over,
  };
}

function gameCard(over: Partial<SlateGameCard> = {}): SlateGameCard {
  const team = (name: string) => ({ name, logoUrl: null, record: null, rank: null, note: null, score: null });
  return {
    id: '824785',
    status: 'pre',
    statusText: '7:05 PM',
    startsAt: '2026-09-22T23:05:00Z',
    venue: 'Truist Park',
    away: team('Cincinnati Reds'),
    home: team('Atlanta Braves'),
    lines: null,
    model: null,
    context: [],
    href: '/mlb/game/824785',
    propCount: null,
    ...over,
  };
}

test('the scope is the key the ranking job writes, whatever a page holds', () => {
  assert.equal(flagScope('mlb', null), 'mlb');
  // Soccer is granular in the table; a page holds it either way round.
  assert.equal(flagScope('soccer', 'mls'), 'soccer_mls');
  assert.equal(flagScope('soccer', null), 'soccer_epl');
  assert.equal(flagScope('soccer_mls', null), 'soccer_mls');
  // Tennis IS granular, and this test asserted the opposite until SP-TEN
  // wrote the first tennis spotlight and every tennis page showed none. The
  // writer stores `tennis_atp`/`tennis_wta`; 'tennis' matches no row at all.
  assert.equal(flagScope('tennis_atp', null), 'tennis_atp');
  assert.equal(flagScope('tennis_wta', null), 'tennis_wta');
  assert.equal(flagScope('tennis', 'wta'), 'tennis_wta');
  assert.equal(flagScope('tennis', null), 'tennis_atp');
});

test('a page gets its own rows, and only its own', () => {
  const mine = flag();
  const teammate = flag({ subjectId: '111', subjectName: 'Someone Else', rank: 4 });
  const elsewhere = flag({ subjectId: '222', teamId: '121', opponentId: '119', gameId: '900000', team: 'NYM', opponent: 'LAD' });
  const all = [mine, teammate, elsewhere];

  assert.deepEqual(selectFlags(all, { subject: '656876' }), [mine]);
  assert.deepEqual(selectFlags(all, { game: '823494' }), [mine, teammate]);
  assert.deepEqual(selectFlags(all, { team: '139' }), [mine, teammate]);
  // The OPPONENT's page shows it too: a platoon spot against you is a fact
  // about your pitcher, and the park flag is about the game you are both in.
  assert.deepEqual(selectFlags(all, { team: '147' }), [mine, teammate]);
  assert.deepEqual(selectFlags(all, { subject: 'nobody' }), []);
  // Nothing asked for is the whole slate — what the Slate itself renders.
  assert.equal(selectFlags(all, {}).length, 3);
});

test('a card is one ranking, in the rank order the job wrote', () => {
  const groups = groupFlags([flag({ rank: 3, subjectId: 'c' }), flag({ rankingId: 'mlb-hr-parks', title: 'HR-friendly parks today', subjectId: 'g' }), flag({ rank: 1, subjectId: 'a' })]);
  assert.deepEqual(groups.map((g) => g.rankingId), ['mlb-platoon-spots', 'mlb-hr-parks']);
  assert.deepEqual(groups[0].flags.map((f) => f.rank), [1, 3]);
});

test('a GAME-subject ranking is not drawn as a person', () => {
  const park = flag({
    rankingId: 'mlb-hr-parks',
    title: 'HR-friendly parks today',
    subjectId: '824302',
    subjectName: 'AZ @ COL',
    subjectKind: 'game',
    gameId: '824302',
  });
  const [card] = flagSpotlightCards([park], { sport: 'mlb' });
  assert.equal(card.subjectLabel, 'Game');
  assert.equal(card.rows[0].href, '/mlb/game/824302');
  // No face on a game, and no team badge either — the card is not about a team.
  assert.equal(card.rows[0].headshotUrl, null);
  assert.equal(card.rows[0].teamLogoUrl, null);
  // And no "AZ vs COL" under a row already called "AZ @ COL".
  assert.equal(card.rows[0].context, null);

  const [playerCard] = flagSpotlightCards([flag()], { sport: 'mlb' });
  assert.equal(playerCard.subjectLabel, 'Player');
  assert.equal(playerCard.rows[0].context, 'TB vs NYY');
  assert.equal(playerCard.rows[0].href, '/mlb/player/656876');
  assert.ok(playerCard.rows[0].headshotUrl, 'a player row carries a face');
});

test("a factor's bar is its percentile, and a factor nobody measured prints as a dash", () => {
  const [card] = flagSpotlightCards([flag({ factors: [{ key: 'slg_vs_hand', label: 'SLG vs hand', info: 'x', value: 0.612, percentile: 94 }, { key: 'park_factor', label: 'Park', info: 'y', value: null, percentile: null }] })], { sport: 'mlb' });
  assert.equal(card.rows[0].values.slg_vs_hand.bar, 0.94);
  assert.equal(card.rows[0].values.park_factor.text, '—');
  assert.equal(card.rows[0].values.park_factor.bar, undefined);
  assert.deepEqual(card.columns.map((c) => c.key), ['slg_vs_hand', 'park_factor']);
});

test('N5: the weather list is the games worth naming, and nothing else', () => {
  // Measured on the real slate: 16 MLB games, one over 50% rain, none over
  // 15 mph. The thresholds are exclusive, so a 15 mph day is an ordinary day.
  const cards = [
    gameCard({ id: 'rain', weatherFlag: 'rain 79%' }),
    gameCard({ id: 'calm', weatherFlag: null }),
    gameCard({ id: 'wind', weatherFlag: 'wind 18 mph WNW' }),
  ];
  const card = weatherSpotlight(cards);
  assert.ok(card);
  assert.equal(card.subjectLabel, 'Game');
  assert.deepEqual(card.rows.map((r) => r.subjectId), ['rain', 'wind']);
  assert.equal(card.rows[0].values.forecast.text, 'rain 79%');
  // A flag, not a ranking: no score, no bar, no order but the slate's own.
  assert.equal(card.rows[0].values.forecast.bar, undefined);
  assert.equal(weatherSpotlight([gameCard({ weatherFlag: null })]), null);
});

test('N5: the thresholds are the gameplan’s, and they are read from the forecast', () => {
  const src = readFileSync('lib/sports/shared/buildSlate.ts', 'utf8');
  assert.match(src, /w\.windMph > 15/);
  assert.match(src, /w\.rainPct > 50/);
  // No sport check: a roofed park and a sport with no forecast both fall out
  // of `game.weather` being absent.
  const fn = src.slice(src.indexOf('function weatherFlag('), src.indexOf('The Games section, for any sport'));
  assert.doesNotMatch(fn, /sport ===/);
});

test('the flags route reads and never writes, and shares one cache entry per sport-day', () => {
  const src = readFileSync('app/api/slate/flags/route.ts', 'utf8');
  assert.match(src, /cachedRoute</);
  // The slice is in `transform`, so a player page and the Slate hit the same key.
  assert.match(src, /cacheKey: `slate:flags:route:\$\{scope\}:\$\{date\}`/);
  assert.match(src, /transform: \(payload\)/);
  assert.doesNotMatch(src, /writeSnapshotCache|INSERT|UPDATE/);
  const read = readFileSync('lib/slate/flagsRead.ts', 'utf8');
  assert.match(read, /kind = 'spotlight'/);
  assert.doesNotMatch(read, /INSERT|UPDATE|DELETE/);
});

test('the browser never imports the query', () => {
  // `flags.ts` goes into the client bundle through `spotlights.ts` and
  // `ResearchFlags.tsx`; `pgClient` pulls `pg` in with it.
  const pure = readFileSync('lib/slate/flags.ts', 'utf8');
  assert.doesNotMatch(pure, /from '\.\.\/db\/pgClient'/);
  assert.match(pure, /import type \{ SpecialFactorDef \}/);
});

test('P12: the four odds flags render through the flags path; the money split is a GAME', () => {
  const { SPOTLIGHT_RANKINGS } = require('../lib/slate/specials') as typeof import('../lib/slate/specials');
  for (const id of ['odds-steam', 'odds-pulled', 'odds-money-split', 'odds-first-mover']) {
    const def = SPOTLIGHT_RANKINGS[id];
    assert.ok(def, `${id} has words (flagsRead drops a ranking it cannot label)`);
    const [card] = flagSpotlightCards([flag({ rankingId: id, title: def.title, promo: def.promo })], { sport: 'nfl' });
    assert.equal(card.title, def.title);
    assert.equal(card.rows.length, 1);
  }
  const split = flag({
    rankingId: 'odds-money-split', title: 'Money vs bets', subjectId: '401872954', subjectName: 'MIN @ TB',
    subjectKind: 'game', gameId: '401872954', read: "Draws 50 points more of DraftKings customers' bets than money on the MIN moneyline.",
  });
  const [card] = flagSpotlightCards([split], { sport: 'nfl' });
  assert.equal(card.subjectLabel, 'Game');
  assert.equal(card.rows[0].href, '/nfl/game/401872954');
  assert.equal(card.rows[0].headshotUrl, null);
});
