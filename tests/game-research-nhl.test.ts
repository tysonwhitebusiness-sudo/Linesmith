import test from 'node:test';
import assert from 'node:assert/strict';
import { nhlGameState, nhlMarketValue, type NhlGameResearchPayload } from '../lib/sports/nhl/gameResearch';
import { gameSeconds, goalStrength, nhlLineChips, toGameResearchData } from '../lib/sports/nhl/adapters/nhlGameResearch';
import { BadRequest, entityId, nhlGameId } from '../lib/apiValidation';
import type { NhlEvent } from '../lib/sports/nhl/apiWebParsers';

/**
 * R8.4b — the NHL game page. Refereed against FLA @ TOR (2025021270, 6-2):
 * shots on goal from the events 25 and 19 equal api-web's right rail; the ESPN
 * bridge finds 401803621 and DraftKings' TOR -162; goalies Woll 19 saves on 4
 * goals, Tarasov 17 on 2; the season series 2-2. Strength before the game sits
 * a shootout short of the standings by design: TOR 244 goals for against 245 in
 * the table, 280 against against 284, a shootout decider counting as a goal
 * there and not here.
 */

test('state from api-web game states', () => {
  assert.equal(nhlGameState({ gameState: 'OFF' }), 'final');
  assert.equal(nhlGameState({ gameState: 'CRIT' }), 'live');
  assert.equal(nhlGameState({ gameState: 'FUT' }), 'pre');
  assert.equal(nhlGameState({ gameState: 'FUT', gameScheduleState: 'PPD' }), 'postponed');
  assert.equal(nhlGameState({}), null);
});

test('a goal’s strength: a power play, an empty net, and a pulled goalie’s extra skater that is no penalty', () => {
  assert.equal(goalStrength({ situation: '1551', isHome: true }), null, 'five on five');
  assert.equal(goalStrength({ situation: '1451', isHome: true }), 'power play', 'TOR on the power play (Nylander, P2 10:55)');
  // FLA (away) scores into TOR's empty net while TOR has six skaters: 1560.
  assert.equal(goalStrength({ situation: '1560', isHome: false }), 'empty net', 'not short-handed: the sixth skater replaced the goalie');
  assert.equal(goalStrength({ situation: '1560', isHome: true }), 'extra attacker', 'TOR scoring with its goalie pulled');
  assert.equal(goalStrength({ situation: '1450', isHome: false }), 'empty net', 'four on four skaters: the home side’s fifth replaced its goalie');
  assert.equal(goalStrength({ situation: '1460', isHome: false }), 'short-handed, empty net', 'four against five skaters and an extra attacker');
});

test('prop markets from box lines; a goalie market needs a goalie', () => {
  const skater = { goals: 2, assists: 0, sog: 2, hits: 1, blockedShots: 0 };
  assert.equal(nhlMarketValue('points', skater), 2);
  assert.equal(nhlMarketValue('shots-on-goal', skater), 2);
  assert.equal(nhlMarketValue('anytime-goalscorer', skater), 1);
  assert.equal(nhlMarketValue('saves', skater), null);
  assert.equal(nhlMarketValue('saves', { saves: 19, goalsAgainst: 4 }), 19);
  assert.equal(nhlMarketValue('goals', null), null, 'did not dress');
});

test('an NHL game id is ten digits of a fixed shape; the shared rule still stops at nine', () => {
  assert.equal(nhlGameId('2025021270'), '2025021270');
  assert.throws(() => nhlGameId('9999999999'), BadRequest);
  assert.throws(() => nhlGameId('2025091270'), BadRequest, 'game type 09 does not exist');
  assert.throws(() => entityId('2025021270'), BadRequest);
});

const ev = (e: Partial<NhlEvent>): NhlEvent => ({
  period: 1, periodType: 'REG', timeInPeriod: '00:00', type: 'shot-on-goal', teamId: 13, isHome: false, x: null, y: null, zone: null, shotType: null, shooterId: null, goalieId: null, assist1Id: null, assist2Id: null, homeDefendingSide: null, situation: '1551', penalty: null, penaltyMinutes: null, homeScore: null, awayScore: null, ...e,
});

function payload(): NhlGameResearchPayload {
  return {
    sport: 'nhl',
    gameId: '2025021270',
    state: 'final',
    statusText: 'Final',
    start: '2026-04-11T23:00:00Z',
    venue: 'Scotiabank Arena',
    conditions: null,
    away: { id: '13', name: 'Florida Panthers', abbr: 'FLA', logoUrl: null, href: null, score: 6, record: null },
    home: { id: '10', name: 'Toronto Maple Leafs', abbr: 'TOR', logoUrl: null, href: null, score: 2, record: null },
    lineScore: null,
    notes: [],
    sources: [],
    fetchedAt: '2026-09-17T00:00:00Z',
    nhl: {
      events: [
        ev({ type: 'goal', timeInPeriod: '00:23', x: 89, y: -10, shooterId: 8480185, awayScore: 1, homeScore: 0 }),
        // The same shot taken at the other end in the second period: a half turn, both axes.
        ev({ period: 2, type: 'shot-on-goal', timeInPeriod: '05:00', x: -70, y: 12, isHome: true, teamId: 10 }),
        ev({ period: 2, type: 'penalty', timeInPeriod: '06:00', isHome: true, teamId: 10, penalty: 'hooking', penaltyMinutes: 2 }),
      ],
      roster: { '8480185': { name: 'Eetu Luostarinen', sweater: 27, position: 'C', teamId: 13 } },
      box: null,
      teamStats: [{ key: 'faceoffWinningPctg', away: '0.357143', home: '0.642857' }],
      shotsByPeriod: [],
      seasonSeries: { games: [], awayWins: 2, homeWins: 2 },
      lines: {
        provider: 'DraftKings',
        details: 'TOR -162',
        moneyline: { home: { open: -125, close: -162 }, away: { open: 105, close: 136 }, draw: null },
        spread: { home: { line: { open: -1.5, close: -1.5 }, odds: { open: 215, close: 160 } }, away: { line: { open: 1.5, close: 1.5 }, odds: { open: -260, close: -190 } } },
        total: { over: { line: { open: 6.5, close: 6.5 }, odds: { open: -110, close: -105 } }, under: { line: { open: 6.5, close: 6.5 }, odds: { open: -110, close: -115 } } },
        favoriteAtOpen: 'home',
      },
      storedLines: [],
      props: [],
      propsAltOnly: 0,
      injuries: null,
      pregame: { strengthSeason: 2025, strengthNote: null, strength: [], form: {}, h2h: [], propHistory: {}, teamOf: {} },
      live: null,
    },
  };
}

test('a final: attempts flow, a rink map turned to one net, faceoff share as a percent, chips on the puck line and total', () => {
  const p = payload();
  assert.deepEqual(nhlLineChips(p, 'final').map((c) => c.label), ['ML FLA +136 · TOR -162', 'FLA +1.5 covered', 'Total 6.5 · over (8)']);
  const data = toGameResearchData({ payload: p });
  assert.deepEqual(data.sections.map((s) => s.id), ['flow', 'rink', 'teams', 'lines', 'plays', 'pre-matchup']);
  const rink = data.sections[1].rows[0][0];
  assert.ok(rink.kind === 'scatter' && rink.surface === 'rink');
  assert.deepEqual(rink.points.map((pt) => [pt[0], pt[1], pt[2]]), [['away', -10, 89], ['home', -12, 70]], 'points are [side, y, x] at the positive end');
  const teams = data.sections[2].rows[0][0];
  assert.ok(teams.kind === 'table');
  assert.deepEqual(teams.rows[0].values, { away: '35.7%', home: '64.3%' });
  assert.equal(gameSeconds({ period: 2, timeInPeriod: '05:00' }), 1500);
  const scoring = data.sections[0].rows[1][0];
  assert.ok(scoring.kind === 'table');
  assert.equal(scoring.rows[0].values.goal, 'Eetu Luostarinen');
});
