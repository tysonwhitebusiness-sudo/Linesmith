import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { firstScorer, soccerGameState, soccerMarketValue, soccerPlayerStats, type SoccerGameResearchPayload, type SoccerKeyEvent } from '../lib/sports/soccer/gameResearch';
import { parseCommentary, parseGameLines, parseLineups } from '../lib/sports/espn/summaryParsers';
import { soccerLineChips, toGameResearchData } from '../lib/sports/soccer/adapters/soccerGameResearch';

/**
 * R8.3a — the soccer game page. Refereed against MUN v MCI (401879278, 0-1,
 * Haaland 60'): 116 commentary entries, 91 located; City's red card at 23';
 * located shots 16 and 6 equal ESPN's team shot totals; DraftKings' three-way
 * close +200 / +275 / +125. The fixture is the summary trimmed to the header,
 * key events, commentary, rosters and pickcenter.
 */

const summary = JSON.parse(readFileSync('tests/fixtures/soccer-summary-401879278.json', 'utf8'));
const keyEvents: SoccerKeyEvent[] = summary.keyEvents.map((k: any) => ({
  id: String(k.id),
  type: String(k.type?.text ?? ''),
  teamId: k.team?.id != null ? String(k.team.id) : null,
  minute: k.clock?.displayValue || null,
  seconds: k.clock?.value ?? null,
  text: k.text ?? null,
  athleteIds: (k.participants ?? []).map((p: any) => String(p.athlete?.id ?? '')),
}));

test('state reads the summary status, full time included', () => {
  assert.equal(soccerGameState(summary), 'final');
  assert.equal(soccerGameState({ header: { competitions: [{ status: { type: { state: 'in', name: 'STATUS_SECOND_HALF' } } }] } }), 'live');
  assert.equal(soccerGameState({ header: { competitions: [{ status: { type: { state: 'post', name: 'STATUS_POSTPONED' } } }] } }), 'postponed');
});

test('player markets settle from the rosters; yes/no markets are 1 or 0; the first scorer comes from key events', () => {
  const players = soccerPlayerStats(summary);
  const haaland = Object.entries(players).find(([, p]) => p.stats.totalGoals === 1)!;
  assert.equal(firstScorer(keyEvents), haaland[0], 'Haaland scored the only goal');
  assert.equal(soccerMarketValue('goals', haaland[1].stats), 1);
  assert.equal(soccerMarketValue('anytime-goalscorer', haaland[1].stats), 1);
  assert.equal(soccerMarketValue('two-plus-goals', haaland[1].stats), 0, 'one goal is not two: the value decides it, the line is 0.5');
  assert.equal(soccerMarketValue('first-goalscorer', haaland[1].stats, true), 1);
  assert.equal(soccerMarketValue('shots', haaland[1].stats), 2);
  assert.equal(soccerMarketValue('corners', haaland[1].stats), null);
  assert.equal(firstScorer([{ id: '1', type: 'Own Goal', teamId: '382', minute: "5'", seconds: 300, text: null, athleteIds: ['9'] }]), null, 'an own goal is nobody’s first goal');
});

function payload(state: 'final' | 'pre' | 'live'): SoccerGameResearchPayload {
  return {
    sport: 'soccer_epl',
    gameId: '401879278',
    state,
    statusText: 'FT',
    start: '2026-09-13T15:30Z',
    venue: 'Old Trafford',
    conditions: null,
    away: { id: '382', name: 'Manchester City', abbr: 'MNC', logoUrl: null, href: null, score: 1, record: null },
    home: { id: '360', name: 'Manchester United', abbr: 'MAN', logoUrl: null, href: null, score: 0, record: null },
    lineScore: null,
    notes: [],
    sources: [],
    fetchedAt: '2026-09-17T00:00:00Z',
    soccer: {
      sport: 'soccer_epl',
      league: 'epl',
      keyEvents,
      commentary: parseCommentary(summary),
      lineups: parseLineups(summary),
      teamStats: [],
      lines: parseGameLines(summary),
      storedLines: [],
      props: [],
      propsAltOnly: 0,
      injuries: { teams: [], fetchedAt: '2026-09-17T00:00:00Z' },
      pregame: { strengthSeason: 2025, strengthNote: null, strength: [], form: {}, h2h: [], propHistory: {}, teamOf: {} },
      live: null,
    },
  };
}

test('three-way chips name the draw, and a final says who won', () => {
  assert.deepEqual(soccerLineChips(payload('final'), 'final').map((c) => c.label), ['MAN +200 · Draw +275 · MNC +125', 'MNC won', 'Total 3.5 · under (1)']);
});

test('a final: the timeline, a shot map with the away side mirrored, lineups, lines with the draw, yes/no props', () => {
  const p = payload('final');
  const haalandId = Object.entries(soccerPlayerStats(summary)).find(([, x]) => x.stats.totalGoals === 1)![0];
  p.soccer.props = [
    { athleteId: haalandId, name: 'Erling Haaland', market: 'anytime-goalscorer', line: null, over: { price: 105, book: 'a' }, under: null, books: 10, side: 'away', result: 1 },
    { athleteId: haalandId, name: 'Erling Haaland', market: 'shots', line: 2.5, over: { price: -120, book: 'a' }, under: { price: 100, book: 'b' }, books: 4, side: 'away', result: 2 },
  ];
  const data = toGameResearchData({ payload: p });
  assert.deepEqual(data.sections.map((s) => s.id), ['flow', 'shots', 'lineups', 'lines', 'plays', 'pre-matchup', 'pre-players']);

  const timeline = data.sections[0].rows[0][0];
  assert.ok(timeline.kind === 'timeline');
  const red = timeline.events.find((e) => e.kind === 'red')!;
  assert.deepEqual([red.side, Math.floor(red.minute) + 1], ['away', 23], "City's red card at 22:23, the 23rd minute");
  assert.equal(timeline.events.filter((e) => e.kind === 'goal').length, 1);

  const shots = data.sections[1].rows[0][0];
  assert.ok(shots.kind === 'scatter' && shots.surface === 'fullpitch');
  assert.deepEqual(shots.groups.map((g) => [g.key, g.count]), [['away', 6], ['home', 16]], 'located shots equal the team totals');
  const goalAt = shots.emphasis!.indexOf(true);
  assert.equal(shots.points[goalAt][0], 'away');
  assert.ok(shots.points[goalAt][1] < 5, "Haaland's goal (x 97.5 attacking right in the feed) is mirrored to City's left-hand goal");

  // P8 O3: exactly one odds card leads the lines section; a final keeps the open/close table under it.
  assert.equal(data.sections[3].rows.flat().filter((c) => c.kind === 'odds').length, 1);
  assert.equal(data.sections[3].rows[0][0].kind, 'odds');
  const lines = data.sections[3].rows[1][0];
  assert.ok(lines.kind === 'table');
  assert.equal(lines.rows.find((r) => r.key === 'ml-draw')?.values.close, '+275');
  const props = data.sections[3].rows[2][0];
  assert.ok(props.kind === 'table');
  assert.deepEqual(props.rows.map((r) => [r.values.market, r.values.result, r.values.went]), [['Anytime scorer', 'Yes', 'Yes'], ['Shots', 2, 'Under']]);
});

test('commentary names the team without an id; sides match on the full name', () => {
  const located = parseCommentary(summary).filter((c) => c.x != null);
  assert.equal(located.length, 91);
  assert.ok(located.every((c) => c.teamId == null), 'soccer commentary carries no team id');
  assert.ok(located.some((c) => c.teamName === 'Manchester City') && located.some((c) => c.teamName === 'Manchester United'));
});
