// P1 (odds workstream, 2026-09-24): every non-MLB sport's player page said
// "No game line yet" because only MLB's adapter filled model.todaysLine. Each
// of the six adapters now sets gameLine from /api/odds/lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PickCandidate } from '../lib/core/types';
import type { UnifiedGameLine } from '../lib/odds/types';
import { toPlayerDetailData as nfl } from '../lib/sports/nfl/adapters/playerDetailAdapter';
import { toPlayerDetailData as cfb } from '../lib/sports/cfb/adapters/playerDetailAdapter';
import { toPlayerDetailData as nba } from '../lib/sports/nba/adapters/playerDetailAdapter';
import { toPlayerDetailData as nhl } from '../lib/sports/nhl/adapters/playerDetailAdapter';
import { toPlayerDetailData as soccer } from '../lib/sports/soccer/adapters/playerDetailAdapter';
import { toPlayerDetailData as tennis } from '../lib/sports/tennis/adapters/playerDetailAdapter';
import { toPlayerDetailData as golf } from '../lib/sports/golf/adapters/playerDetailAdapter';

const DIMENSION: Record<string, string> = {
  nfl: 'receiving-yards', cfb: 'receiving-yards', nba: 'points', nhl: 'shots-on-goal', soccer: 'shots', tennis: 'aces',
};

const candidate = (sport: string): PickCandidate =>
  ({
    sport,
    subjectId: 'p1',
    subjectName: 'Test Player',
    subjectMeta: { gamePk: 'G1', team: 'AAA', opponent: 'BBB', isHome: true },
    dimension: DIMENSION[sport],
    dimensionLabel: DIMENSION[sport],
    category: 'over',
    categoryLabel: 'Over',
    line: 4.5,
    history: [5, 7, 3, 6, 9].map((v, i) => ({ period: i + 1, result: String(v), category: v > 4.5 ? 'over' : 'under', periodLabel: `g${i}`, raw: {} })),
    consistent: true,
    sampleSize: 5,
    supportingSplits: [],
  }) as unknown as PickCandidate;

const lines = (eventId: string): UnifiedGameLine[] => [{
  eventId,
  commenceTime: '2026-09-27T17:00:00Z',
  homeTeam: 'Home', awayTeam: 'Away',
  moneyline: { home: -150, away: 130, book: 'fanduel' },
  total: { point: 44.5, overPrice: -108, underPrice: -112, book: 'draftkings' },
  bookmakers: [], bookCount: 2, source: 'game-odds-book-lines',
}];

const ADAPTERS = { nfl, cfb, nba, nhl, soccer, tennis } as const;
const scope = { lineOffset: 0, opponentOnly: false, lastN: 'all' } as never;

for (const [sport, fn] of Object.entries(ADAPTERS)) {
  test(`${sport}: the player's game line comes from the game's lines`, () => {
    const run = (gameLines: UnifiedGameLine[]) =>
      (fn as (i: never) => ReturnType<typeof nfl>)({ candidates: [candidate(sport)], snapshot: null, scope, gameLines } as never);
    const hit = run(lines('G1'));
    assert.deepEqual(hit?.gameLine?.moneyline, { away: 130, home: -150, book: 'fanduel', source: 'game-odds-book-lines' });
    assert.equal(hit?.gameLine?.total?.point, 44.5);
    assert.equal(hit?.gameLine?.playerSide, 'home', 'the fixture player is at home');
    assert.equal(run(lines('OTHER'))?.gameLine, null, 'a line for another game is not this player\'s');
  });
}

test('golf has no game: its adapter sets no gameLine', () => {
  const c = { ...candidate('nfl'), sport: 'golf', dimension: 'hole-7', category: 'birdie' } as PickCandidate;
  const d = golf({ candidates: [c], snapshot: null, scope: { selectedRound: 1, selectedCategory: 'birdie' } } as never);
  assert.equal(d ? 'gameLine' in d : false, false);
});
