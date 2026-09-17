import test from 'node:test';
import assert from 'node:assert/strict';
import { nbaBoxStat, nbaGameState, nbaMarketValue, type NbaGameResearchPayload } from '../lib/sports/nba/gameResearch';
import { parseEspnBox } from '../lib/sports/espn/boxscore';
import { parseCourtPlays } from '../lib/sports/espn/summaryParsers';
import { nbaLineChips, toGameResearchData } from '../lib/sports/nba/adapters/nbaGameResearch';

/**
 * R8.4a — the NBA game page. Refereed against OKC @ LAL (401811010, 123-87):
 * ESPN's shot coordinates put the rim at (25, 0) (124 shots with a stated
 * distance, mean error 0.69 ft), located attempts 45/89 for OKC equal its box
 * line, DraftKings closed OKC -17.5 and 221.5.
 */

const summary = {
  header: { competitions: [{ status: { type: { state: 'post', completed: true, name: 'STATUS_FINAL' } } }] },
  boxscore: {
    players: [
      {
        team: { id: '25' },
        statistics: [
          {
            keys: ['minutes', 'points', 'fieldGoalsMade-fieldGoalsAttempted', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'freeThrowsMade-freeThrowsAttempted', 'rebounds', 'assists', 'turnovers', 'steals', 'blocks'],
            labels: ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK'],
            athletes: [
              { athlete: { id: '4278073', displayName: 'Shai Gilgeous-Alexander' }, stats: ['28', '25', '10-15', '2-2', '3-3', '1', '8', '3', '2', '0'] },
              { athlete: { id: '1', displayName: 'Did Not Play' }, stats: [] },
            ],
          },
        ],
      },
    ],
  },
  plays: [
    { id: '1', period: { number: 1 }, clock: { displayValue: '11:47' }, type: { text: 'Jump Shot' }, text: 'Chet Holmgren misses 24-foot three point jumper', team: { id: '25' }, homeScore: 0, awayScore: 0, scoringPlay: false, shootingPlay: true, pointsAttempted: 3, coordinate: { x: 8, y: 19 } },
    { id: '2', period: { number: 1 }, clock: { displayValue: '11:30' }, type: { text: 'Free Throw - 1 of 2' }, text: 'makes free throw 1 of 2', team: { id: '13' }, homeScore: 1, awayScore: 0, scoringPlay: true, scoreValue: 1, shootingPlay: true, coordinate: { x: -214748340, y: -214748365 } },
  ],
};

test('state, joined box keys, and prop markets from the box', () => {
  assert.equal(nbaGameState(summary), 'final');
  const box = parseEspnBox(summary);
  assert.equal(nbaBoxStat(box, '4278073', 'fieldGoalsMade'), 10);
  assert.equal(nbaBoxStat(box, '4278073', 'threePointFieldGoalsAttempted'), 2);
  const stat = (id: string) => (k: string) => nbaBoxStat(box, id, k);
  assert.equal(nbaMarketValue('points-rebounds-assists', stat('4278073')), 34);
  assert.equal(nbaMarketValue('threes', stat('4278073')), 2);
  assert.equal(nbaMarketValue('points', stat('1')), null, 'no minutes: did not play');
  assert.equal(nbaMarketValue('double-double', stat('4278073')), null);
});

test('a free throw’s sentinel coordinate is no location; a jumper keeps the rim-origin feet', () => {
  const plays = parseCourtPlays(summary);
  assert.deepEqual([plays[0].x, plays[0].y], [8, 19]);
  assert.ok(Math.abs(Math.hypot(8 - 25, 19) - 24) < 2, 'the 24-foot three sits 25.5 ft from a rim at (25, 0)');
  assert.deepEqual([plays[1].x, plays[1].y], [null, null]);
});

function payload(): NbaGameResearchPayload {
  const plays = parseCourtPlays(summary);
  return {
    sport: 'nba',
    gameId: '401811010',
    state: 'final',
    statusText: 'Final',
    start: '2026-04-08T02:30Z',
    venue: 'crypto.com Arena',
    conditions: null,
    away: { id: '25', name: 'Oklahoma City Thunder', abbr: 'OKC', logoUrl: null, href: null, score: 123, record: null },
    home: { id: '13', name: 'Los Angeles Lakers', abbr: 'LAL', logoUrl: null, href: null, score: 87, record: null },
    lineScore: null,
    notes: [],
    sources: [],
    fetchedAt: '2026-09-17T00:00:00Z',
    nba: {
      plays,
      winProbability: [],
      lead: [
        { playId: 'start', period: 1, clock: null, margin: 0 },
        { playId: '2', period: 1, clock: '11:30', margin: 1 },
        { playId: '3', period: 1, clock: '11:00', margin: -2 },
      ],
      runs: [],
      box: parseEspnBox(summary),
      teamStats: [],
      seasonSeries: [],
      lines: {
        provider: 'DraftKings',
        details: 'OKC -17.5',
        moneyline: { home: { open: 750, close: 1100 }, away: { open: -1200, close: -2100 }, draw: null },
        spread: { home: { line: { open: 13.5, close: 17.5 }, odds: { open: -105, close: -108 } }, away: { line: { open: -13.5, close: -17.5 }, odds: { open: -115, close: -112 } } },
        total: { over: { line: { open: 224.5, close: 221.5 }, odds: { open: -110, close: -110 } }, under: { line: { open: 224.5, close: 221.5 }, odds: { open: -110, close: -110 } } },
        favoriteAtOpen: 'away',
      },
      storedLines: [],
      props: [],
      propsAltOnly: 0,
      injuries: { teams: [], fetchedAt: '2026-09-17T00:00:00Z' },
      pregame: { strengthSeason: 2026, strengthNote: null, strength: [], form: {}, h2h: [], propHistory: {}, teamOf: {} },
      live: null,
    },
  };
}

test('chips settle the spread and total; the lead tracker counts a change of leader; free throws stay off the shot chart', () => {
  const p = payload();
  assert.deepEqual(nbaLineChips(p, 'final').map((c) => c.label), ['ML OKC -2100 · LAL +1100', 'OKC -17.5 covered', 'Total 221.5 · under (210)']);
  const data = toGameResearchData({ payload: p });
  const flow = data.sections.find((s) => s.id === 'flow')!;
  const lead = flow.rows[0][0];
  assert.ok(lead.kind === 'series');
  assert.match(lead.scope ?? '', /^1 lead change · largest leads OKC 2, LAL 1$/);
  const shots = data.sections.find((s) => s.id === 'shots')!.rows[0][0];
  assert.ok(shots.kind === 'scatter');
  assert.equal(shots.points.length, 1, 'the free throw has no location');
});
