import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRestConditions } from '../lib/sports/shared/restConditions';
import { toPredicateBinarySplit } from '../lib/sports/shared/predicateSplit';
import { isTeamNameMatch } from '../lib/sports/shared/teamNameMatch';
import { categoriseByLine, OVER } from '../lib/core/windowedStat';
import type { HistoryEntry } from '../lib/core/types';

/**
 * Phase 6.13's two new shared role builders.
 *
 * Both exist because the SAME role means different things in different sports
 * and the differences are real, not cosmetic:
 *
 *  - `restConditions` — NBA and NHL are indoor, so weather is not a condition
 *    anyone bets on; rest is.
 *  - `predicateSplit` — the general sibling of `venueSplit`, deliberately
 *    WITHOUT its 25% share floor. That floor encodes "league teams play a
 *    balanced schedule", which is true of home/away and false of par 4s vs par
 *    5s and hard vs clay.
 */

// ---------------------------------------------------------------------------
// restConditions
// ---------------------------------------------------------------------------

const AS_OF = new Date('2026-03-10T18:00:00Z');

test('days are CALENDAR days, so a late game and a next-day game is a back-to-back', () => {
  // Barely twenty hours can separate them. Counting elapsed hours would call
  // that a rest day; everyone who follows the sport calls it a back-to-back.
  const role = toRestConditions({ gameDates: ['2026-03-08T23:30:00Z', '2026-03-09T00:30:00Z'], asOf: AS_OF })!;
  assert.ok(role.facts.some((f) => f.key === 'b2b'), 'consecutive calendar days is a back-to-back');
});

test('two games a full day apart is not a back-to-back', () => {
  const role = toRestConditions({ gameDates: ['2026-03-06T00:00:00Z', '2026-03-08T00:00:00Z'], asOf: AS_OF })!;
  assert.equal(role.facts.some((f) => f.key === 'b2b'), false);
});

test('rest is counted from the most recent game, whatever order they arrive in', () => {
  const role = toRestConditions({
    gameDates: ['2026-03-01T00:00:00Z', '2026-03-08T00:00:00Z', '2026-03-04T00:00:00Z'],
    asOf: AS_OF,
  })!;
  assert.equal(role.facts.find((f) => f.key === 'rest')!.value, '2', '10th minus the 8th');
});

test('a game today reads as played today, never as zero days rest', () => {
  const role = toRestConditions({ gameDates: ['2026-03-09T00:00:00Z', '2026-03-10T02:00:00Z'], asOf: AS_OF })!;
  assert.equal(role.facts.find((f) => f.key === 'rest')!.value, 'Played today');
});

test('a fixture list running ahead of the clock never prints negative rest', () => {
  const role = toRestConditions({ gameDates: ['2026-03-10T00:00:00Z', '2026-03-12T00:00:00Z'], asOf: AS_OF })!;
  assert.equal(role.facts.find((f) => f.key === 'rest')!.value, 'Played today');
});

test('schedule load counts the trailing seven days inclusive', () => {
  const role = toRestConditions({
    gameDates: [
      '2026-03-09T00:00:00Z',
      '2026-03-07T00:00:00Z',
      '2026-03-05T00:00:00Z',
      // 8 days back — outside the window.
      '2026-03-02T00:00:00Z',
    ],
    asOf: AS_OF,
  })!;
  assert.equal(role.facts.find((f) => f.key === 'load')!.value, '3');
});

test('fewer than two dated games is no card', () => {
  assert.equal(toRestConditions({ gameDates: [], asOf: AS_OF }), null);
  assert.equal(toRestConditions({ gameDates: ['2026-03-09T00:00:00Z'], asOf: AS_OF }), null);
  assert.equal(toRestConditions({ gameDates: [undefined, 'not-a-date'], asOf: AS_OF }), null);
});

test('no fact carries an impact — that would be a fitted number, not arithmetic', () => {
  const role = toRestConditions({ gameDates: ['2026-03-08T00:00:00Z', '2026-03-09T00:00:00Z'], asOf: AS_OF })!;
  for (const f of role.facts) {
    assert.ok(f.impact == null, `${f.key} claims an effect size; counting days is arithmetic, "a back-to-back costs N" is a model`);
  }
});

// ---------------------------------------------------------------------------
// predicateSplit
// ---------------------------------------------------------------------------

const entry = (value: number, tag: string): HistoryEntry =>
  ({ period: 1, result: String(value), category: 'over', periodLabel: 'x', raw: { tag } }) as unknown as HistoryEntry;

const split = (entries: HistoryEntry[], minimum = 3) =>
  toPredicateBinarySplit({
    measured: categoriseByLine(entries, 1.5),
    wanted: OVER,
    title: 'Surface',
    aLabel: 'Hard',
    bLabel: 'Clay',
    isA: (e) => (e.raw as Record<string, unknown>).tag === 'hard',
    isB: (e) => (e.raw as Record<string, unknown>).tag === 'clay',
    statLabel: 'Aces',
    minimum,
  });

test('a LOPSIDED split is kept — that is the whole reason this is not venueSplit', () => {
  // 12:3 would be rejected by `toVenueBinarySplit`'s 25% share floor. Here it
  // is the correct answer: a hard-court specialist genuinely plays that ratio,
  // and so does a golfer facing ten par 4s and four par 5s.
  const entries = [
    ...Array.from({ length: 12 }, () => entry(3, 'hard')),
    ...Array.from({ length: 3 }, () => entry(1, 'clay')),
  ];
  const role = split(entries)!;
  assert.ok(role, 'a real imbalance was rejected as if it were a broken join');
  assert.equal(role.rows[0].aSample, 12);
  assert.equal(role.rows[0].bSample, 3);
});

test('both sides or nothing', () => {
  assert.equal(split(Array.from({ length: 12 }, () => entry(3, 'hard'))), null);
  assert.equal(split([]), null);
});

test('a side below the minimum does not count as a side', () => {
  const entries = [
    ...Array.from({ length: 12 }, () => entry(3, 'hard')),
    entry(1, 'clay'),
    entry(1, 'clay'),
  ];
  assert.equal(split(entries), null, 'two entries is not a split');
});

test('the average row carries the sport’s own stat label and its lowerIsBetter flag', () => {
  const entries = [
    ...Array.from({ length: 4 }, () => entry(3, 'hard')),
    ...Array.from({ length: 4 }, () => entry(1, 'clay')),
  ];
  const role = toPredicateBinarySplit({
    measured: categoriseByLine(entries, 1.5),
    wanted: OVER,
    title: 'Par',
    aLabel: 'Par 5',
    bLabel: 'Par 4',
    isA: (e) => (e.raw as Record<string, unknown>).tag === 'hard',
    isB: (e) => (e.raw as Record<string, unknown>).tag === 'clay',
    statLabel: 'Strokes to par',
    lowerIsBetter: true,
  })!;
  const avg = role.rows.find((r) => r.key === 'average')!;
  assert.equal(avg.label, 'Strokes to par');
  assert.equal(avg.lowerIsBetter, true, 'without this the heat reads backwards for a scoring stat');
  assert.equal(role.rows.find((r) => r.key === 'hitRate')!.lowerIsBetter, undefined);
});

// ---------------------------------------------------------------------------
// teamNameMatch — the exact-equality bug, found on a real page three times.
// ---------------------------------------------------------------------------

test('two feeds naming the same club differently still match', () => {
  // The real 2026-08-30 failure: a player's Understat history says "Leeds",
  // ESPN's subjectMeta says "Leeds United". 0 of 273 entries matched under
  // `===`, so the h2h window, the careerH2H card and the opponent filter chip
  // were all silently dead.
  assert.equal(isTeamNameMatch('Leeds', 'Leeds United'), true);
  assert.equal(isTeamNameMatch('Leeds United', 'Leeds'), true, 'neither feed is reliably the longer one');
  assert.equal(isTeamNameMatch('Tottenham', 'Tottenham Hotspur'), true);
  assert.equal(isTeamNameMatch('Alabama', 'Alabama Crimson Tide'), true, "CFB's original case");
  assert.equal(isTeamNameMatch('Wolverhampton Wanderers', 'Wolverhampton Wanderers'), true);
});

test('different clubs do not match', () => {
  // The substring test is loose on purpose; it must still separate real teams.
  assert.equal(isTeamNameMatch('Manchester City', 'Manchester United'), false);
  assert.equal(isTeamNameMatch('Sheffield United', 'Leeds United'), false);
  assert.equal(isTeamNameMatch('Everton', 'Liverpool'), false);
});

test('an absent opponent matches nothing', () => {
  // An empty string is a substring of everything. If that counted as a match,
  // a subject with no opponent would report its FULL season as head-to-head.
  assert.equal(isTeamNameMatch('', 'Leeds United'), false);
  assert.equal(isTeamNameMatch('Leeds', ''), false);
  assert.equal(isTeamNameMatch(undefined, 'Leeds'), false);
  assert.equal(isTeamNameMatch('Leeds', null), false);
});

test('punctuation and accents do not defeat a match', () => {
  assert.equal(isTeamNameMatch("Nott'm Forest", 'Nottm Forest'), true);
  assert.equal(isTeamNameMatch('Atlético Madrid', 'Atletico Madrid'), true);
});
