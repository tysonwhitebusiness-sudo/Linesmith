import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inGameLinesFrom, mainGameLine, type GameQuote } from '../lib/odds/gameLineHistory';
import { mlbMarketResult, parseMlbBox } from '../lib/sports/mlb/liveFeedParsers';
import { mlbGameState } from '../lib/sports/mlb/gameResearch';
import { gameStates, resolveState } from '../lib/sports/shared/gameResearch';
import { mlbLineChips, toGameResearchData } from '../lib/sports/mlb/adapters/gameDetailAdapter';
import { marketValue, rankOf } from '../lib/sports/mlb/gamePregame';
import type { MlbGameResearchPayload } from '../lib/sports/mlb/gameResearch';

/**
 * R8.1 — MLB's game page. The payload was refereed against the G2 fixture
 * (KC @ BOS, pk 824711: 77 plate appearances, 289 pitches, 77 win-probability
 * points, every pitching line, 3-2 with 10/8 hits and 10/8 left on base); these
 * tests hold the rules behind it.
 */

const q = (bookmaker: string, side: string, point: number | null, americanOdds: number, observedAt = '2026-09-16T16:00:00Z', market = 'total'): GameQuote => ({ market, side, bookmaker, point, americanOdds, observedAt });

test('a total closes at the line nearest even, not the alternate the most books carry (SF @ STL, 823004)', () => {
  const books8 = ['betmgm', 'betonline', 'betus', 'bovada', 'draftkings', 'lowvig', 'mybookie', 'betrivers'];
  const books95 = ['fanatics', 'fliff', 'hardrockbet', 'kalshi', 'marathon', 'matchbook', 'novig', 'pinnacle', 'polymarket', 'prophetx', 'smarkets', 'rebet', 'bovada'];
  const quotes = [
    ...books8.flatMap((b) => [q(b, 'over', 8, -115), q(b, 'under', 8, -105)]),
    ...books95.flatMap((b) => [q(b, 'over', 9.5, 160), q(b, 'under', 9.5, -190)]),
    // DraftKings' 8.5 from the early morning, superseded by its 8.
    q('draftkings', 'over', 8.5, 105, '2026-09-16T05:39:00Z'),
    q('draftkings', 'under', 8.5, -135, '2026-09-16T05:39:00Z'),
  ];
  const main = mainGameLine('total', quotes, { dropSuperseded: true });
  assert.ok(main);
  assert.deepEqual(main.sides.map((s) => [s.side, s.point, s.americanOdds]), [['over', 8, -115], ['under', 8, -105]]);
  assert.equal(main.books, 8);
});

test('between two near-even totals the one most books quote wins (KC @ BOS, 824711)', () => {
  const books85 = Array.from({ length: 11 }, (_, i) => `book${i}`);
  const quotes = [...books85.flatMap((b) => [q(b, 'over', 8.5, -105), q(b, 'under', 8.5, -115)]), q('a', 'over', 8, -125), q('a', 'under', 8, -115), q('b', 'over', 8, -125), q('b', 'under', 8, -115)];
  const main = mainGameLine('total', quotes, { dropSuperseded: true });
  assert.equal(main?.sides[0].point, 8.5);
  assert.equal(main?.books, 11);
});

test('a run line is the one most books quote, whatever its price (824382 opened with two books at +-1)', () => {
  const quotes = [
    ...['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'].flatMap((b) => [q(b, 'away', 1.5, -160, undefined, 'spread'), q(b, 'home', -1.5, 140, undefined, 'spread')]),
    q('x', 'away', 1, -103, undefined, 'spread'),
    q('x', 'home', -1, -120, undefined, 'spread'),
    q('y', 'away', 1, -103, undefined, 'spread'),
    q('y', 'home', -1, -120, undefined, 'spread'),
  ];
  const main = mainGameLine('spread', quotes, { dropSuperseded: false });
  assert.deepEqual(main?.sides.map((s) => s.point), [1.5, -1.5], 'the sides keep their own signs');
  assert.equal(main?.books, 9);
});

test('the box parser and prop results read the saved KC @ BOS feed', () => {
  const feed = JSON.parse(readFileSync('tests/fixtures/mlb-box-824711.json', 'utf8')); // box score and line score only, trimmed from the live feed on 2026-09-16
  const away = parseMlbBox(feed, 'away');
  const home = parseMlbBox(feed, 'home');
  assert.deepEqual(away.totals, { r: 3, h: 10, e: 0, lob: 10 });
  assert.deepEqual(home.totals, { r: 2, h: 8, e: 0, lob: 8 });
  assert.deepEqual(away.pitching.map((p) => [p.name, p.s.ip, p.s.k]), [['Seth Lugo', '5.0', 7], ['Nolan Hoffman', '1.0', 1], ['Connor Thomas', '1.0', 0], ['Nate Pearson', '1.0', 1], ['Steven Cruz', '1.0', 1]]);
  const jensen = away.batting.find((b) => b.name === 'Carter Jensen')!;
  assert.equal(jensen.order, 1);
  assert.equal(mlbMarketResult('total-bases', jensen, undefined), 4, 'two doubles');
  assert.equal(mlbMarketResult('doubles', jensen, undefined), 2);
  assert.equal(mlbMarketResult('singles', jensen, undefined), 0);
  assert.equal(mlbMarketResult('hits-runs-rbis', jensen, undefined), 2 + 2 + 1);
  const lugo = away.pitching[0];
  assert.equal(mlbMarketResult('pitcher-outs', undefined, lugo), 15);
  assert.equal(mlbMarketResult('pitcher-strikeouts', jensen, undefined), null, 'a batter has no pitcher market');
  assert.ok(away.batting.some((b) => b.sub), 'a substitute is marked');
});

test('state comes from the real status, and a review override only reaches a state the game can show', () => {
  assert.equal(mlbGameState('Final', 'Final'), 'final');
  assert.equal(mlbGameState('Live', 'In Progress'), 'live');
  assert.equal(mlbGameState('Preview', 'Scheduled'), 'pre');
  assert.equal(mlbGameState('Preview', 'Postponed'), 'postponed');
  assert.deepEqual(gameStates('final'), ['pre', 'final']);
  assert.equal(resolveState({ state: 'final' }, 'pre'), 'pre');
  assert.equal(resolveState({ state: 'pre' }, 'final'), 'pre', 'a game that has not started cannot show a recap');
  assert.equal(resolveState({ state: 'live' }, 'final'), 'live');
});

test('result chips say what the final did against the closing lines', () => {
  const payload = {
    away: { abbr: 'KC', score: 3 },
    home: { abbr: 'BOS', score: 2 },
    mlb: {
      lines: [
        { market: 'moneyline', open: null, close: { books: 18, sides: [{ side: 'away', point: null, americanOdds: 170 }, { side: 'home', point: null, americanOdds: -196 }] } },
        { market: 'spread', open: null, close: { books: 10, sides: [{ side: 'away', point: 1.5, americanOdds: -118 }, { side: 'home', point: -1.5, americanOdds: -102 }] } },
        { market: 'total', open: null, close: { books: 12, sides: [{ side: 'over', point: 8.5, americanOdds: -105 }, { side: 'under', point: 8.5, americanOdds: -115 }] } },
      ],
    },
  } as unknown as MlbGameResearchPayload;
  assert.deepEqual(mlbLineChips(payload, 'final').map((c) => c.label), ['ML KC +170 · BOS -196', 'KC +1.5 covered', 'Total 8.5 · under (5)']);
  assert.deepEqual(mlbLineChips(payload, 'pre').map((c) => c.label), ['ML KC +170 · BOS -196', 'KC +1.5', 'Total 8.5']);
});

// ---------------------------------------------------------------------------
// R8.1b — the research as of the start
// ---------------------------------------------------------------------------

test('a rank is 1 for the best side of a stat: most produced, fewest allowed, ties sharing', () => {
  const pool = [5.1, 4.4, 4.4, 3.9];
  assert.deepEqual(rankOf(4.4, pool, true), { value: 4.4, rank: 2, of: 4 });
  assert.equal(rankOf(3.9, pool, false).rank, 1, 'allowing the fewest runs is best');
  assert.equal(rankOf(5.1, pool, false).rank, 4);
});

test('a game-log row gives each market its number, and nothing for the other role', () => {
  const bat = { bat_plateAppearances: 4, bat_hits: 2, bat_doubles: 1, bat_triples: 0, bat_homeRuns: 1, bat_runs: 1, bat_rbi: 3, bat_totalBases: 6 };
  assert.equal(marketValue('singles', bat), 0);
  assert.equal(marketValue('hits-runs-rbis', bat), 6);
  assert.equal(marketValue('pitcher-strikeouts', bat), null);
  const pit = { pit_inningsPitched: '5.2', pit_strikeOuts: 7, pit_earnedRuns: 2 };
  assert.equal(marketValue('pitcher-outs', pit), 17, '5.2 innings is 17 outs, not 5.2');
  assert.equal(marketValue('hits', pit), null);
});

function pregamePayload(state: 'pre' | 'final'): MlbGameResearchPayload {
  const g = (pk: number, date: string, home: boolean, us: number, them: number) => ({ pk, date, home, opponentId: '111', opponentAbbr: 'BOS', us, them });
  const lugo = {
    id: 7,
    name: 'Seth Lugo',
    hand: 'R',
    season: { gs: 29, ip: '159.0', era: 5.04, whip: 1.44, k: 119, bb: 51, hr: 18 },
    log: [],
    mix: [
      { type: '?', n: 1, share: 0.2, velo: null, whiff: null },
      { type: 'SI', n: 511, share: 19.4, velo: 91.4, whiff: 10.3 },
    ],
    pitches: 512,
    vsLineup: [{ id: 9, name: 'Hitter', pos: 'C', bats: 'L', order: null, season: { pa: 300, avg: 0.25, obp: 0.3, slg: 0.4, hr: 10 }, vsHand: { pa: 200, avg: 0.26, k: 17.4, xwobacon: 0.37 }, vsPitcher: { pa: 3, h: 1, hr: 0, k: 0, bb: 0, ab: 3 } }],
  };
  return {
    sport: 'mlb',
    gameId: '1',
    state,
    statusText: state === 'final' ? 'Final' : 'Scheduled',
    start: '2026-09-11T23:10:00Z',
    venue: 'Fenway Park',
    conditions: null,
    away: { id: '118', name: 'Kansas City Royals', abbr: 'KC', logoUrl: null, href: null, score: state === 'final' ? 3 : null, record: null },
    home: { id: '111', name: 'Boston Red Sox', abbr: 'BOS', logoUrl: null, href: null, score: state === 'final' ? 2 : null, record: null },
    lineScore: null,
    notes: [],
    sources: [],
    fetchedAt: '2026-09-16T00:00:00Z',
    mlb: {
      atBats: [],
      winProbability: [],
      box: null,
      lines: [],
      props: [{ playerId: '9', name: 'Hitter', side: null, market: 'hits', line: 0.5, over: { price: -150, book: 'a' }, under: { price: 120, book: 'b' }, books: 5, result: null }],
      propsAltOnly: 0,
      pitchDataHeld: false,
      pregame: {
        strengthSeason: 2026,
        strengthNote: null,
        strength: [
          {
            key: 'runs',
            label: 'Runs / game',
            decimals: 2,
            higherIsBetter: true,
            teams: {
              '118': { produced: { value: 4.28, rank: 22, of: 30 }, allowed: { value: 4.88, rank: 25, of: 30 } },
              '111': { produced: { value: 4.44, rank: 17, of: 30 }, allowed: { value: 3.88, rank: 4, of: 30 } },
            },
          },
        ],
        form: { '118': { games: [] }, '111': { games: [] } },
        h2h: [g(1, '2025-05-09', true, 2, 1), g(2, '2025-05-10', true, 1, 10), g(3, '2026-05-18', true, 1, 3)],
        starters: { gamePk: 1, gameDate: '2026-09-11', season: 2026, asOf: '2026-09-10', computedAt: '2026-09-11T12:00:00Z', payload: { asOf: '2026-09-10', season: 2026, starters: { away: lugo, home: null } } },
        // Hitter 9 is BOS (he is in Lugo's opposing roster); two of his four games came against KC.
        propHistory: { '9|hits': [['2026-09-01', 1, '110'], ['2026-09-02', 0, '118'], ['2026-09-03', 2, '118'], ['2026-09-04', 0, '110']] },
        injuries: { '118': [], '111': [{ teamId: 111, playerId: 5, playerName: 'Garrett Crochet', position: 'P', injury: null, status: 'Injured 60-Day' }] },
      },
    },
  } as unknown as MlbGameResearchPayload;
}

test('before the start: matchup, starters, players, injuries, lines, each rule held', () => {
  const data = toGameResearchData({ payload: pregamePayload('pre') });
  assert.deepEqual(data.sections.map((s) => s.id), ['matchup', 'starters', 'players', 'injuries', 'lines']);
  const matchup = data.sections[0];
  const strength = matchup.rows[0][0];
  assert.ok(strength.kind === 'table');
  assert.deepEqual(strength.rows[0].values, { prod: '4.28', prodRank: '22nd', allow: '3.88', allowRank: '4th' }, 'KC bats against BOS arms');
  assert.deepEqual(strength.rows[0].tones, { prodRank: 'bad', allowRank: 'good' }, '22nd of 30 is in the bottom ten, 4th in the top ten');
  const h2h = matchup.rows[2][0];
  assert.ok(h2h.kind === 'table');
  assert.match(h2h.scope ?? '', /KC 1-2 against BOS since last season, runs -10/);
  assert.equal(h2h.rows[0].label, 'May 18, 2026', 'newest first');

  const starters = data.sections[1];
  const mix = starters.rows[1][1];
  assert.ok(mix.kind === 'table');
  assert.deepEqual(mix.rows.map((r) => r.label), ['Sinker'], 'an unclassified pitch is not in the mix');
  assert.equal(starters.note, 'Only KC had named a starter when the research was kept.');

  const players = data.sections[2].rows[0][0];
  assert.ok(players.kind === 'table');
  assert.equal(players.rows[0].labelNote, 'BOS', 'his team comes from the starters card before there is a box');
  assert.equal(players.rows[0].values.l10Over, '2 of 4');
  assert.equal(players.rows[0].values.vs, '1 of 2', 'against KC only');

  const injuries = data.sections[3].rows[0][0];
  assert.ok(injuries.kind === 'table');
  assert.deepEqual(injuries.columns.map((c) => c.key), ['pos', 'status'], 'no Injury column when no entry names one');
});

test('a final game keeps the research below the recap without injuries, and a game with no starter card says so', () => {
  const final = toGameResearchData({ payload: pregamePayload('final') });
  const ids = final.sections.map((s) => s.id);
  assert.ok(ids.includes('pre-matchup') && ids.includes('pre-starters') && ids.includes('pre-players'));
  assert.ok(!ids.some((id) => id.endsWith('injuries')), 'rosters as they read now say nothing about a finished game');
  assert.equal(final.sections.find((s) => s.id === 'pre-matchup')?.title, 'Matchup · at the start');
  const reviewed = toGameResearchData({ payload: pregamePayload('final'), requestedState: 'pre' });
  assert.ok(!reviewed.sections.some((s) => s.id === 'injuries'), 'nor when the finished game is reviewed as before the start');

  const old = pregamePayload('pre');
  old.mlb.pregame.starters = null;
  const starters = toGameResearchData({ payload: old }).sections.find((s) => s.id === 'starters');
  assert.equal(starters?.state.kind, 'empty');
});

// ---------------------------------------------------------------------------
// R8.1c — while the game is on
// ---------------------------------------------------------------------------

test('in-game "now" is the latest capture only: NYY @ MIN, 823655, after the Yankees tied it', () => {
  const ml = (bookmaker: string, away: number, home: number, at: string) => [q(bookmaker, 'away', null, away, at, 'moneyline'), q(bookmaker, 'home', null, home, at, 'moneyline')];
  const quotes = [
    ...ml('draftkings', 680, -1440, '2026-09-16T20:15:00Z'),
    ...ml('fanduel', 750, -1600, '2026-09-16T20:15:00Z'),
    ...ml('draftkings', -148, 108, '2026-09-16T20:25:57Z'),
  ];
  const { now, moneyline } = inGameLinesFrom(quotes);
  const line = now.find((n) => n.market === 'moneyline')!;
  assert.deepEqual(line.line?.sides.map((s) => s.americanOdds), [-148, 108], 'FanDuel from ten minutes earlier is not blended in (it printed -148 / -1600)');
  assert.equal(line.line?.books, 1);
  assert.equal(line.asOf, '2026-09-16T20:25:57.000Z');
  assert.equal(moneyline.length, 2);
  assert.ok(moneyline[0].homePct > 85 && moneyline[1].homePct < 50, 'the trend turns at the tie');
});

test('in a capture, a line two books share beats a nearer-even line from one book', () => {
  const at = '2026-09-16T19:48:37Z';
  const quotes = [q('pinnacle', 'over', 6, 260, at), q('pinnacle', 'under', 6, -367, at), q('draftkings', 'over', 6.5, 450, at), q('draftkings', 'under', 6.5, -725, at), q('fanduel', 'over', 6.5, 410, at), q('fanduel', 'under', 6.5, -700, at)];
  const total = inGameLinesFrom(quotes).now.find((n) => n.market === 'total')!;
  assert.equal(total.line?.sides[0].point, 6.5);
  assert.equal(total.line?.books, 2);
});

test('an in-game run line keeps each team on its own sign (DET @ TOR, 822763)', () => {
  const at = '2026-09-16T19:48:37Z';
  const rl = (bookmaker: string, away: number, awayPrice: number, homePrice: number) => [q(bookmaker, 'away', away, awayPrice, at, 'spread'), q(bookmaker, 'home', -away, homePrice, at, 'spread')];
  const quotes = [...rl('betmgm', 1.5, -300, 225), ...rl('matchbook', 1.5, -333, 192), ...rl('betrivers', -1.5, 130, -190), ...rl('fanduel', -1.5, 132, -178), ...rl('unibet', -1.5, 135, -177)];
  const main = mainGameLine('spread', quotes, { dropSuperseded: false });
  assert.deepEqual(main?.sides.map((s) => [s.point, s.americanOdds]), [[-1.5, 132], [1.5, -178]], 'DET -1.5 from three books, not pooled with DET +1.5');
  assert.equal(main?.books, 3);
});

test('while live: Right now leads, the tracker marks only an over, and Lines & props waits for the final', () => {
  const payload = pregamePayload('final');
  payload.state = 'live';
  payload.mlb.props = [
    { playerId: '9', name: 'Hitter', side: 'home', market: 'hits', line: 0.5, over: null, under: null, books: 5, result: 2 },
    { playerId: '9', name: 'Hitter', side: 'home', market: 'total-bases', line: 3.5, over: null, under: null, books: 5, result: 2 },
    { playerId: '8', name: 'Bench', side: null, market: 'hits', line: 0.5, over: null, under: null, books: 5, result: null },
  ];
  payload.mlb.live = {
    inning: { number: 7, half: 'top', ordinal: '7th' },
    outs: 1,
    count: { balls: 2, strikes: 1 },
    bases: { first: true, second: false, third: true },
    batter: { id: 1, name: 'Batter', todayLine: '1-for-3' },
    onDeck: null,
    pitcher: { id: 2, name: 'Pitcher', ip: '6.0', h: 4, r: 2, k: 7, pitches: 91 },
    inGame: { now: [{ market: 'moneyline', line: { market: 'moneyline', sides: [{ side: 'away', point: null, americanOdds: -118 }, { side: 'home', point: null, americanOdds: -108 }], books: 1 }, asOf: '2026-09-16T20:15:00Z' }], moneyline: [] },
  };
  // KC 1-0 when the price was captured at 20:15; 3-2 now. The home run's at-bat began at 20:14 and ended
  // when the next one began at 20:21, after the capture, so its runs came after the price.
  payload.mlb.atBats = [
    { index: 0, startTime: '2026-09-16T19:12:00Z', awayScore: 1, homeScore: 0, pitches: [], event: 'Single' },
    { index: 1, startTime: '2026-09-16T20:14:00Z', awayScore: 1, homeScore: 2, pitches: [], event: 'Home Run' },
    { index: 2, startTime: '2026-09-16T20:21:00Z', awayScore: 1, homeScore: 2, pitches: [], event: 'Flyout' },
  ] as unknown as typeof payload.mlb.atBats;
  const data = toGameResearchData({ payload });
  const ids = data.sections.map((s) => s.id);
  assert.equal(ids[0], 'now');
  assert.ok(!ids.includes('lines'));
  assert.ok(!ids.includes('injuries'));
  const now = data.sections[0];
  const situation = now.rows[0][0];
  assert.ok(situation.kind === 'table');
  assert.equal(situation.rows.find((r) => r.key === 'bases')?.values.value, 'Runners on 1st and 3rd');
  const tracker = now.rows[1][0];
  assert.ok(tracker.kind === 'table');
  assert.equal(tracker.scope, '2 of 3 markets have played');
  assert.deepEqual(
    tracker.rows.map((r) => [r.values.market, r.values.status, r.tones?.status ?? null]),
    [
      ['Hits', 'Over already', 'good'],
      ['Total bases', '2 more to go over', null],
    ],
  );
  const linesNow = now.rows[2][0];
  assert.ok(linesNow.kind === 'table');
  assert.match(linesNow.scope ?? '', /4 runs have scored since$/, 'a fifteen-minute-old price says the game has moved on');
});
