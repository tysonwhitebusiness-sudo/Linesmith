import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boxStat, footballGameState, footballMarketResult, parseFootballBox, type FootballGameResearchPayload } from '../lib/sports/multiSport/footballGameResearch';
import { parseDrives, parseGameLines } from '../lib/sports/espn/summaryParsers';
import { driveX, footballLineChips, playX, toGameResearchData } from '../lib/sports/nfl/adapters/footballGameResearch';
import { easternDate, footballLogValue, formGameFrom } from '../lib/sports/multiSport/footballPregame';

/**
 * R8.2 — the NFL and CFB game page. Refereed against DAL @ NYG (401872930,
 * 20-28): 14 drives, 175 win-probability points, DraftKings closing DAL -3 and
 * 47.5, every prop result read back against the raw box score. The fixture is
 * the summary trimmed to the header, box score, two drives and pickcenter.
 */

const summary = JSON.parse(readFileSync('tests/fixtures/nfl-summary-401872930.json', 'utf8'));
const box = parseFootballBox(summary);

test('state comes from the summary status', () => {
  const at = (type: object) => footballGameState({ header: { competitions: [{ status: { type } }] } });
  assert.equal(footballGameState(summary), 'final');
  assert.equal(at({ state: 'in', name: 'STATUS_IN_PROGRESS' }), 'live');
  assert.equal(at({ state: 'pre', name: 'STATUS_SCHEDULED' }), 'pre');
  assert.equal(at({ state: 'post', name: 'STATUS_POSTPONED' }), 'postponed');
  assert.equal(footballGameState({}), null);
});

test('box stats read plain and joined keys', () => {
  assert.equal(boxStat(box, '2577417', 'passing', 'completions'), 22, 'Prescott 22/34');
  assert.equal(boxStat(box, '2577417', 'passing', 'passingAttempts'), 34);
  assert.equal(boxStat(box, '2577417', 'passing', 'passingYards'), 175);
});

test('prop markets settle from the box: tackles are solo, assists the rest, a missing group counts zero', () => {
  const id = (name: string) => box.flatMap((t) => t.groups.flatMap((g) => g.athletes)).find((a) => a.name === name)!.id;
  // Overshown: 7 total, 1 solo. DraftKings hung "tackles" at 4.5 for him, a solo line.
  assert.equal(footballMarketResult(box, id('DeMarvion Overshown'), 'tackles'), 1);
  assert.equal(footballMarketResult(box, id('DeMarvion Overshown'), 'assists'), 6);
  assert.equal(footballMarketResult(box, id('Cam Skattebo'), 'rushing-yards'), 81);
  assert.equal(footballMarketResult(box, id('Cam Skattebo'), 'receptions'), 0, 'in the box with no catches');
  assert.equal(footballMarketResult(box, id('Isaiah Likely'), 'anytime-td'), 1);
  assert.equal(footballMarketResult(box, id('CeeDee Lamb'), 'rush-rec-yards'), 44);
  assert.equal(footballMarketResult(box, '999999', 'receptions'), null, 'not in the box: did not play');
  assert.equal(footballMarketResult(box, id('Cam Skattebo'), 'kicking-points'), null, 'a market the box does not settle');
});

test('the field runs from the away goal line: a drive yardLine counts from the home goal line', () => {
  const drives = parseDrives(summary);
  assert.equal(drives[0].startText, 'DAL 28');
  assert.equal(driveX(drives[0].startYardLine), 28);
  assert.equal(drives[1].startText, 'NYG 17');
  assert.equal(driveX(drives[1].startYardLine), 83);
  assert.equal(driveX(drives[1].endYardLine), 0, 'the Giants touchdown ends in the left end zone');
  const rush = drives[1].plays.find((p) => p.type === 'Rush')!;
  assert.equal(playX('home', rush.startYardsToEndzone), 83, 'the home offense attacks the left');
  assert.equal(playX('away', 72), 28);
});

function payload(state: 'final' | 'pre'): FootballGameResearchPayload {
  return {
    sport: 'nfl',
    gameId: '401872930',
    state,
    statusText: 'Final',
    start: '2026-09-14T00:20Z',
    venue: 'MetLife Stadium',
    conditions: null,
    away: { id: '6', name: 'Dallas Cowboys', abbr: 'DAL', logoUrl: null, href: null, score: 20, record: '0-1' },
    home: { id: '19', name: 'New York Giants', abbr: 'NYG', logoUrl: null, href: null, score: 28, record: '1-0' },
    lineScore: null,
    notes: [],
    sources: [],
    fetchedAt: '2026-09-17T00:00:00Z',
    football: {
      league: 'nfl',
      drives: parseDrives(summary),
      winProbability: [],
      box,
      teamStats: [],
      scoring: [],
      lines: parseGameLines(summary),
      storedLines: [],
      props: [],
      propsAltOnly: 0,
      injuries: { teams: [], fetchedAt: '2026-09-17T00:00:00Z' },
      pregame: { strengthSeason: 2025, strengthNote: null, strength: [], form: {}, h2h: [], propHistory: {}, passing: null, teamOf: {} },
    },
  };
}

test('closing-line chips from pickcenter say what the final did against them', () => {
  assert.deepEqual(footballLineChips(payload('final'), 'final').map((c) => c.label), ['ML DAL -166 · NYG +140', 'DAL -3 did not cover', 'Total 47.5 · over (48)']);
  assert.deepEqual(footballLineChips(payload('final'), 'pre').map((c) => c.label), ['ML DAL -166 · NYG +140', 'DAL -3', 'Total 47.5']);
});

test('a final page: flow with the drive chart, leaders from the box, props only where the box settles them', () => {
  const p = payload('final');
  p.football.props = [
    { playerId: 'espn:football:1', athleteId: '1', name: 'Played', market: 'receptions', line: 2.5, over: { price: 100, book: 'a' }, under: null, books: 3, side: 'home', result: 3 },
    { playerId: 'espn:football:2', athleteId: '2', name: 'Did not play', market: 'receptions', line: 2.5, over: { price: 100, book: 'a' }, under: null, books: 3, side: null, result: null },
    { playerId: 'espn:football:3', athleteId: '3', name: 'One book', market: 'receptions', line: 2.5, over: { price: 100, book: 'a' }, under: null, books: 1, side: 'away', result: 1 },
  ];
  const data = toGameResearchData({ payload: p });
  assert.deepEqual(data.sections.map((s) => s.id), ['flow', 'scoring', 'box', 'lines', 'plays', 'pre-matchup', 'pre-players'], 'the kickoff research stays below the recap');
  const drives = data.sections[0].rows[0][0];
  assert.ok(drives.kind === 'field');
  assert.deepEqual([drives.rows[1].side, drives.rows[1].from, drives.rows[1].to, drives.rows[1].strong], ['home', 83, 0, true]);
  const leaders = data.sections[1].rows[0][1];
  assert.ok(leaders.kind === 'table');
  assert.equal(leaders.rows.find((r) => r.key === 'Passing-away')?.values.line, '22/34, 175 yds, 2 TD, 1 INT');
  const props = data.sections[3].rows[1][0];
  assert.ok(props.kind === 'table');
  assert.deepEqual(props.rows.map((r) => [r.label, r.values.side]), [['Played', 'Over']]);
});

// ---------------------------------------------------------------------------
// R8.2b — the research as of kickoff
// ---------------------------------------------------------------------------

test('a game-log row settles football markets the way the box does', () => {
  // Prescott's row from 401872930 as player_game_history holds it: no receiving or defensive keys.
  const row = { 'passing.completions': 22, 'passing.passingAttempts': 34, 'passing.passingYards': 175, 'rushing.rushingYards': 14 };
  assert.equal(footballLogValue('pass-attempts', row), 34);
  assert.equal(footballLogValue('pass-rush-yards', row), 189);
  assert.equal(footballLogValue('receptions', row), 0, 'an absent group counts zero');
  assert.equal(footballLogValue('tackles', { 'defensive.totalTackles': 7, 'defensive.soloTackles': 1 }), 1, 'solo, as the box settles it');
  assert.equal(footballLogValue('field-goals', row), null);
});

test('form reads a schedule game from either side, dated in US Eastern time', () => {
  const g = {
    id: '401872930',
    start: '2026-09-14T00:20Z',
    postseason: false,
    away: { id: '6', name: 'Dallas Cowboys', abbr: 'DAL', logoUrl: null, score: 20, rank: null },
    home: { id: '19', name: 'New York Giants', abbr: 'NYG', logoUrl: null, score: 28, rank: null },
    state: 'final' as const,
    extra: null,
    label: null,
    venue: null,
    neutral: false,
  };
  assert.equal(easternDate(g.start), '2026-09-13', 'Sunday night, not Monday UTC');
  assert.deepEqual(formGameFrom('6', g), { pk: '401872930', date: '2026-09-13', home: false, opponentId: '19', opponentAbbr: 'NYG', us: 20, them: 28, postseason: false });
  assert.equal(formGameFrom('19', g)?.us, 28);
});

test('before kickoff: matchup with the passing matchup, players, injuries only for a game still to come, lines', () => {
  const p = payload('pre');
  p.state = 'pre';
  p.football.pregame.passing = {
    season: 2025,
    note: null,
    includesLaterGames: false,
    teams: {
      '6': { season: 2025, teamId: '6', offense: { games: 17, cells: { 'deep|left': [30, 12, 900], 'short|middle': [70, 50, 300] } }, defense: null, defenseByPosition: {}, league: { games: 272, cells: { 'deep|left': [100, 40, 3000], 'short|middle': [300, 200, 1200] } } },
      '19': { season: 2025, teamId: '19', offense: null, defense: { games: 17, cells: { 'deep|left': [20, 10, 600], 'short|middle': [80, 60, 320] } }, defenseByPosition: {}, league: null },
    },
  };
  p.football.injuries = { fetchedAt: '2026-09-17T00:00:00Z', teams: [{ teamId: '19', abbr: 'NYG', items: [{ athleteId: '1', name: 'Player', position: 'WR', status: 'Out', type: 'Hamstring', detail: null, date: null }] }] };
  const data = toGameResearchData({ payload: p });
  assert.deepEqual(data.sections.map((s) => s.id), ['matchup', 'injuries', 'lines'], 'no props: no Players section');
  const passing = data.sections[0].rows.at(-1)![0];
  assert.ok(passing.kind === 'table');
  assert.equal(passing.title, 'Passing matchup');
  const deepLeft = passing.rows.find((r) => r.key === 'deep|left')!;
  assert.deepEqual([deepLeft.values.off, deepLeft.values.def, deepLeft.values.league], [30, 20, 25]);

  const reviewed = payload('final');
  const asPre = toGameResearchData({ payload: { ...reviewed, football: { ...reviewed.football, injuries: p.football.injuries } }, requestedState: 'pre' });
  assert.ok(!asPre.sections.some((s) => s.id === 'injuries'), "today's report says nothing about a finished game");
});
