import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { code } from './ui-scope';
import { toModelPicks } from '../lib/slate/modelPicks';
import { toYourLines, type BetLeg, type LineLeg } from '../lib/slate/yourLines';
import { slateSections, type SlateData } from '../lib/sports/shared/slateShapes';
import { toSlateData as toMlbSlateData } from '../lib/sports/mlb/adapters/slateAdapter';
import type { GamePickRow } from '../lib/db/client';
import type { SlateGame } from '../lib/odds/matching';
import type { PickCandidate } from '../lib/core/types';

/**
 * S5's guard — the Model section shows picks and nothing that reads as a
 * measured chance, and "Your lines" does not exist for a signed-out reader.
 */

const pick = (over: Partial<GamePickRow> = {}): GamePickRow =>
  ({
    id: 1,
    sport: 'mlb',
    gameId: '100',
    homeTeamName: 'Baltimore Orioles',
    awayTeamName: 'Toronto Blue Jays',
    matchup: 'Toronto Blue Jays @ Baltimore Orioles',
    commenceTime: '2026-09-21T22:35:00Z',
    mlInitialSide: 'home',
    mlInitialProb: 0.51,
    mlInitialPrice: -110,
    mlFinalSide: null,
    mlFinalProb: null,
    mlFinalPrice: null,
    mlFinalCapturedAt: null,
    totalInitialSide: 'under',
    totalInitialLine: 7.5,
    totalInitialPrice: 103,
    totalInitialProb: 0.52,
    totalFinalSide: null,
    totalFinalLine: null,
    totalFinalPrice: null,
    totalFinalCapturedAt: null,
    ...over,
  }) as unknown as GamePickRow;

test("the Model section's rows carry no probability, grade, stake or record", () => {
  const [row] = toModelPicks([pick()], '2026-09-21');
  assert.deepEqual(Object.keys(row).sort(), ['awayLogoUrl', 'gameId', 'homeLogoUrl', 'locked', 'matchup', 'moneyline', 'startsAt', 'total']);
  assert.deepEqual(row.moneyline, { team: 'Baltimore Orioles', price: -110 });
  assert.deepEqual(row.total, { side: 'under', line: 7.5, price: 103 });
  assert.equal(row.locked, false);
  // And the wire and the component never mention one.
  for (const f of ['lib/slate/modelPicks.ts', 'app/api/slate/model/route.ts', 'components/slate/SlateModel.tsx']) {
    const body = code(readFileSync(f, 'utf8')).replace(/GamePickRow|mlInitialPrice|mlFinalPrice|totalInitialPrice|totalFinalPrice/g, '');
    assert.doesNotMatch(body, /Prob\b|prob[A-Z]|confidence|stake|record\b|\bbaseline\b|\bgated\b/, f);
  }
});

test('the locked pick wins over the pre-lock read, and a pick is on its Eastern day', () => {
  const rows = toModelPicks(
    [
      pick({ mlFinalSide: 'away', mlFinalCapturedAt: '2026-09-21T22:30:00Z' } as Partial<GamePickRow>),
      // 02:45 UTC on the 22nd is 22:45 ET on the 21st: still the 21st's slate.
      pick({ gameId: '101', commenceTime: '2026-09-22T02:45:00Z' } as Partial<GamePickRow>),
      pick({ gameId: '102', commenceTime: '2026-09-22T17:00:00Z' } as Partial<GamePickRow>),
    ],
    '2026-09-21',
  );
  assert.deepEqual(rows.map((r) => r.gameId), ['100', '101']);
  assert.equal(rows[0].moneyline?.team, 'Toronto Blue Jays');
  assert.equal(rows[0].locked, true);
});

test('a commence time the driver returns as a Date still sorts and serialises', () => {
  const rows = toModelPicks(
    [
      pick({ gameId: '2', commenceTime: new Date('2026-09-21T23:00:00Z') as unknown as string }),
      pick({ gameId: '1', commenceTime: new Date('2026-09-21T22:00:00Z') as unknown as string }),
    ],
    '2026-09-21',
  );
  assert.deepEqual(rows.map((r) => [r.gameId, r.startsAt]), [
    ['1', '2026-09-21T22:00:00.000Z'],
    ['2', '2026-09-21T23:00:00.000Z'],
  ]);
});

test('the Model nav entry needs the slate to declare a model section', () => {
  const base: SlateData = { sport: 'nfl', date: '2026-09-21', fetchedAt: '', warnings: [] };
  assert.equal(slateSections(base, null, null, null, null, 3).some((s) => s.id === 'model'), false);
  assert.equal(slateSections({ ...base, modelPicks: { note: 'x' } }, null, null, null, null, 3).some((s) => s.id === 'model'), true);
});

test('only MLB declares a model section, and its note uses no internal model words', () => {
  const mlb = toMlbSlateData({ date: '2026-09-21', games: [], lines: [] });
  assert.ok(mlb.modelPicks);
  assert.doesNotMatch(mlb.modelPicks.note, /baseline|gated|simple|advanced|validated|record of|%/i);
  for (const s of ['nfl', 'nba', 'nhl', 'soccer', 'tennis', 'golf']) {
    assert.doesNotMatch(code(readFileSync(`lib/sports/${s}/adapters/slateAdapter.ts`, 'utf8')), /modelPicks/, s);
  }
});

test("MLB's card names the LOCKED pick, so the card and the Model section agree", () => {
  const g = {
    gamePk: '100',
    matchup: 'TOR @ BAL',
    awayTeamName: 'Toronto Blue Jays',
    homeTeamName: 'Baltimore Orioles',
    firstPitch: '2026-09-21T22:35:00Z',
    state: 'Pre-Game',
    // The snapshot leans home; the locked pick is away.
    gameModel: { homeWinProb: 0.51, awayWinProb: 0.49, homeExpectedRuns: 4.0, awayExpectedRuns: 4.1 },
  } as unknown as SlateGame;
  const withPick = toMlbSlateData({ date: '2026-09-21', games: [g], lines: [], picks: new Map([['100', { gameId: '100', side: 'away', prob: 0.51 }]]) });
  assert.equal(withPick.games?.cards[0]?.model?.pick, 'TOR');
  const without = toMlbSlateData({ date: '2026-09-21', games: [g], lines: [] });
  assert.equal(without.games?.cards[0]?.model?.pick, 'BAL');
});

test('TodaysPicksModal and the on-page record are gone', () => {
  assert.equal(existsSync('components/TodaysPicksModal.tsx'), false);
  assert.equal(existsSync('components/useGamePickRecord.ts'), false);
  const shell = code(readFileSync('components/AppShell.tsx', 'utf8'));
  assert.doesNotMatch(shell, /TodaysPicks|RecordChip|LinesmithRecordBar/);
});

/* ---------------------------------------------------------------- Your lines */

const cand = (id: string, name: string, status: 'pre' | 'live' | 'done' = 'pre', odds?: string): PickCandidate =>
  ({
    sport: 'mlb',
    subjectId: id,
    subjectName: name,
    dimension: 'hits',
    dimensionLabel: 'Hits',
    category: 'over',
    categoryLabel: 'Over 1.5',
    line: 1.5,
    liveState: { status },
    odds: odds ? { americanOdds: odds, source: 'odds-api', capturedAt: '' } : undefined,
  }) as unknown as PickCandidate;

const leg = (id: number, subjectId: string, name: string, odds: string | null = '-110'): LineLeg => ({
  id,
  sport: 'mlb',
  subjectId,
  subjectName: name,
  dimension: 'hits',
  dimensionLabel: 'Hits',
  category: 'over',
  categoryLabel: 'Over 1.5',
  americanOdds: odds,
});

const bet = (id: number, subjectId: string, name: string, status: BetLeg['status'], submittedAt = '2026-09-21T15:00:00Z'): BetLeg => ({
  ...leg(id, subjectId, name),
  status,
  submittedAt,
});

test("Your lines keeps only today's slate, prices then and now side by side", () => {
  const rows = toYourLines({
    sport: 'mlb',
    date: '2026-09-21',
    candidates: [cand('a', 'Alpha', 'live', '+120'), cand('b', 'Bravo')],
    bets: [bet(1, 'a', 'Alpha', 'pending'), bet(2, 'z', 'Zulu', 'pending'), bet(3, 'b', 'Bravo', 'won', '2026-09-19T15:00:00Z')],
    slip: [leg(4, 'b', 'Bravo', '+100'), leg(5, 'z', 'Zulu')],
    tracked: [{ id: 6, subjectId: 'b', subjectName: 'Bravo', statKey: 'hits', statLabel: 'Hits', side: 'over', line: 0.5 }],
    watchlist: [
      { id: 7, subjectId: 'a', subjectName: 'Alpha' },
      { id: 8, subjectId: 'c', subjectName: 'Charlie' },
    ],
  });
  assert.deepEqual(
    rows.map((r) => `${r.kind}:${r.subjectName}`),
    // Zulu is not on the slate; Bravo's win was two days ago; Alpha is
    // already listed with a line; Charlie has no candidate today.
    ['Bet:Alpha', 'Slip:Bravo', 'Tracked:Bravo'],
  );
  const alpha = rows[0];
  assert.equal(alpha.priceThen, '-110');
  assert.equal(alpha.priceNow, '+120');
  assert.equal(alpha.status, 'live');
  assert.equal(rows[2].market, 'Hits · Over 0.5');
  // No difference between the two prices exists anywhere in the row.
  assert.deepEqual(Object.keys(alpha).sort(), ['href', 'key', 'kind', 'market', 'priceNow', 'priceThen', 'status', 'subjectName']);
});

test('a settled bet from today shows its result', () => {
  const [row] = toYourLines({
    sport: 'mlb',
    date: '2026-09-21',
    candidates: [cand('a', 'Alpha', 'done')],
    bets: [bet(1, 'a', 'Alpha', 'lost')],
    slip: [],
    tracked: [],
    watchlist: [],
  });
  assert.equal(row.status, 'lost');
  assert.equal(row.priceNow, null);
});

test('signed out, Your lines fetches nothing and renders nothing', () => {
  const src = code(readFileSync('components/slate/SlateYourLines.tsx', 'utf8'));
  // Sources fetch only behind the signed-in check...
  assert.match(src, /if \(!signedIn\) \{\s*setBets\(\[\]\);/);
  // ...and the shell hands the section `null` rather than an empty list.
  const shell = code(readFileSync('components/AppShell.tsx', 'utf8'));
  assert.match(shell, /signedIn\s*\?\s*toYourLines\(/);
  assert.match(src, /if \(!rows \|\| rows\.length === 0\) return null;/);
});
