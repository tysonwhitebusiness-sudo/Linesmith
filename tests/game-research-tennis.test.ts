import test from 'node:test';
import assert from 'node:assert/strict';
import { tennisGameState, tennisLogValue, tennisMarketValue, tennisSets, type TennisGameResearchPayload } from '../lib/sports/tennis/gameResearch';
import { toGameResearchData } from '../lib/sports/tennis/adapters/tennisGameResearch';

/**
 * R8.3b — the tennis match page. Refereed against G2's Paul v Zverev
 * (Cincinnati R16, ESPN 181891: 4-6 7-6(8-6) 6-4): the archive's serve stats
 * match G2's exactly (Paul 9 aces, 63 of 96 first serves in, 3/5 break points
 * saved; Zverev 14 aces, 9 double faults), 171 minutes, ranks 24 and 3. The live
 * case is Samsonova v Day (183799), read mid-second-set on 2026-09-17.
 */

// ESPN scoreboard competitors, trimmed to what the reader uses.
const paulZverev = {
  status: { type: { state: 'post', completed: true, name: 'STATUS_FINAL', detail: 'Final' } },
  competitors: [
    { homeAway: 'away', id: '2964', linescores: [{ value: 4, winner: false }, { value: 7, tiebreak: 8, winner: true }, { value: 6, winner: true }] },
    { homeAway: 'home', id: '2375', linescores: [{ value: 6, winner: true }, { value: 6, tiebreak: 6, winner: false }, { value: 4, winner: false }] },
  ],
};
const samsonovaDayLive = {
  status: { type: { state: 'in', completed: false, name: 'STATUS_IN_PROGRESS', detail: '2nd Set' } },
  competitors: [
    { homeAway: 'away', id: '1', linescores: [{ value: 7, tiebreak: 7, winner: true }, { value: 0 }] },
    { homeAway: 'home', id: '2', linescores: [{ value: 6, tiebreak: 4, winner: false }, { value: 1 }] },
  ],
};

test('state and set scores come from the scoreboard, tiebreak points included', () => {
  assert.equal(tennisGameState(paulZverev), 'final');
  assert.equal(tennisGameState(samsonovaDayLive), 'live');
  assert.deepEqual(tennisSets(paulZverev)[1], { away: 7, home: 6, awayTiebreak: 8, homeTiebreak: 6, winner: 'away' });
});

test('a set counts only once ESPN names its winner: a lead in the set being played is not a set', () => {
  const sets = tennisSets(samsonovaDayLive);
  assert.equal(sets[1].winner, null, 'Day leads the second set 1-0');
  assert.equal(tennisMarketValue('to-win-a-set', sets, 'home', null), 0, 'so Day has not won a set (the page showed 1-1 in sets before this)');
  assert.equal(tennisMarketValue('to-win-a-set', sets, 'away', null), 1);
  assert.equal(tennisMarketValue('games-won', tennisSets(paulZverev), 'away', null), 17, '4 + 7 + 6');
  assert.equal(tennisMarketValue('aces', tennisSets(paulZverev), 'away', 9), 9, 'aces only from the archive');
  assert.equal(tennisMarketValue('aces', tennisSets(paulZverev), 'away', null), null);
});

test('game-log rows settle games won and to win a set; they hold no serve stats, so no aces', () => {
  // Zverev's row for 181891 as player_game_history holds it.
  const row = { is_major: 0, sets_won: 1, games_won: 16, match_won: 0, sets_lost: 2, games_lost: 17 };
  assert.equal(tennisLogValue('games-won', row), 16);
  assert.equal(tennisLogValue('to-win-a-set', row), 1);
  assert.equal(tennisLogValue('aces', row), null);
});

function payload(state: 'final' | 'pre', archive: boolean): TennisGameResearchPayload {
  const serve = (aces: number, df: number, svpt: number, firstIn: number, firstWon: number, secondWon: number, bpSaved: number, bpFaced: number) => ({ aces, doubleFaults: df, servePoints: svpt, firstIn, firstWon, secondWon, serviceGames: 16, breakPointsSaved: bpSaved, breakPointsFaced: bpFaced });
  const paul = serve(9, 1, 96, 63, 47, 20, 3, 5);
  const zverev = serve(14, 9, 102, 70, 52, 17, 1, 3);
  return {
    sport: 'tennis_atp',
    gameId: '181891',
    state,
    statusText: 'Final',
    start: '2026-08-19T18:00Z',
    venue: 'Cincinnati Open · Round 4',
    conditions: null,
    away: { id: '2964', name: 'Tommy Paul', abbr: 'Paul', logoUrl: null, href: null, score: 2, record: null, sideLabel: 'No. 24 · seed 18' },
    home: { id: '2375', name: 'Alexander Zverev', abbr: 'Zverev', logoUrl: null, href: null, score: 1, record: null, sideLabel: 'No. 3 · seed 1' },
    lineScore: null,
    notes: [],
    sources: [],
    fetchedAt: '2026-09-17T00:00:00Z',
    tennis: {
      tour: 'atp',
      tournament: 'Cincinnati Open',
      round: 'Round 4',
      sets: tennisSets(paulZverev),
      resultNote: '(18) Tommy Paul (USA) bt (1) Alexander Zverev (GER) 4-6 7-6 (8-6) 6-4',
      archive: archive ? { surface: 'Hard', level: 'M', bestOf: 3, minutes: 171, away: { rank: 24, seed: 18, serve: paul, opponentServe: zverev }, home: { rank: 3, seed: 1, serve: zverev, opponentServe: paul } } : null,
      archiveThrough: '2026-08-30',
      surface: {},
      form: {},
      h2h: [{ eventId: '1', date: '2025-01-21', opponentId: '2375', opponentName: 'Alexander Zverev', won: false, setsWon: 1, setsLost: 3, gamesWon: 19, gamesLost: 22 }],
      storedLines: [],
      props: [],
      propsAltOnly: 0,
      propHistory: {},
      live: null,
    },
  };
}

test('a final: score with tiebreaks, match stats from the archive, form, head to head, lines; no home side', () => {
  const data = toGameResearchData({ payload: payload('final', true) });
  assert.deepEqual(data.sections.map((s) => s.id), ['score', 'stats', 'form', 'h2h', 'lines']);
  const sets = data.sections[0].rows[0][0];
  assert.ok(sets.kind === 'table');
  assert.deepEqual(sets.rows.map((r) => [r.values.away, r.values.home]), [['4', '6'], ['7', '6 (6)'], ['6', '4']]);
  const stats = data.sections[1].rows[0][0];
  assert.ok(stats.kind === 'table');
  const v = (key: string) => stats.rows.find((r) => r.key === key)!.values;
  assert.deepEqual(v('first-in'), { away: '66%', home: '69%' });
  assert.deepEqual(v('return-won'), { away: '32%', home: '30%' }, 'Paul won 33 of Zverev’s 102 serve points');
  assert.deepEqual(v('bp-won'), { away: '2/3', home: '2/5' });
  assert.deepEqual(v('points'), { away: 100, home: 98 });
  assert.equal(data.hero.away.sideLabel, 'No. 24 · seed 18', 'rank and seed where a team sport says Away');
  assert.doesNotMatch(data.stateNote, /kept at the bottom/);
});

test('a match not in the archive yet says so, with the date the archive reaches', () => {
  const data = toGameResearchData({ payload: payload('final', false) });
  const stats = data.sections.find((s) => s.id === 'stats')!;
  assert.equal(stats.state.kind, 'empty');
  assert.ok(stats.state.kind === 'empty' && /2026-08-30/.test(stats.state.reason));
});
