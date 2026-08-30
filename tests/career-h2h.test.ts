import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCareerH2H } from '../lib/sports/shared/careerH2H';
import { categoriseByLine, OVER } from '../lib/core/windowedStat';
import type { HistoryEntry } from '../lib/core/types';

/**
 * Phase 6.13's last role — head to head.
 *
 * THE THING THIS MUST NOT BE is a second rendering of `windows.h2h`, which
 * every adapter already computes and the window-box row already shows. That
 * would be the duplicate-card mistake this phase caught once with
 * `opponentUnit` for NFL/NBA/NHL/CFB.
 *
 * What it adds is `meetings`: "3 of 5" and "3 of 5, all three in 2019" are
 * different facts and a single rate cannot tell them apart.
 */

function entry(period: number, value: number, opponent: string, label?: string): HistoryEntry {
  return { period, result: String(value), category: '', periodLabel: label, raw: { opponentAbbr: opponent } };
}

const vsNYY = (e: HistoryEntry) => (e.raw as { opponentAbbr?: string })?.opponentAbbr === 'NYY';

function history(): HistoryEntry[] {
  return categoriseByLine(
    [
      entry(1, 2, 'NYY', 'Apr 3 vs NYY'),
      entry(2, 0, 'BOS', 'Apr 8 vs BOS'),
      entry(3, 1, 'NYY', 'May 2 vs NYY'),
      entry(4, 3, 'NYY', 'Jun 7 vs NYY'),
      entry(5, 0, 'TOR', 'Jun 9 vs TOR'),
    ],
    0.5,
  );
}

test('the meetings are what this role adds, oldest first', () => {
  const role = toCareerH2H({
    measured: history(),
    wanted: OVER,
    isVsOpponent: vsNYY,
    opponentLabel: 'vs NYY',
    statLabel: 'Hits',
  })!;
  assert.ok(role);
  assert.equal(role.sampleSize, 3);
  assert.equal(role.sampleLabel, 'meetings');
  assert.deepEqual(
    role.meetings!.map((m) => m.date),
    ['Apr 3 vs NYY', 'May 2 vs NYY', 'Jun 7 vs NYY'],
    'oldest first, matching the ascending-period convention every sport follows',
  );
  assert.deepEqual(role.meetings!.map((m) => m.value), [2, 1, 3]);
});

test('only meetings against THIS opponent are counted', () => {
  const role = toCareerH2H({
    measured: history(),
    wanted: OVER,
    isVsOpponent: vsNYY,
    opponentLabel: 'vs NYY',
    statLabel: 'Hits',
  })!;
  assert.equal(role.meetings!.length, 3, 'BOS and TOR must not leak in');
  // All three NYY games cleared 0.5.
  assert.equal(role.stats.find((s) => s.key === 'hitRate')!.value, 100);
  assert.equal(role.stats.find((s) => s.key === 'hitRate')!.sub, '3 of 3');
});

test('one meeting is not a record', () => {
  // A single prior game under a "vs NYY" heading reads as a trend, and the
  // window box already reports it as a rate. Nothing is gained by a card.
  const single = categoriseByLine([entry(1, 2, 'NYY'), entry(2, 0, 'BOS')], 0.5);
  assert.equal(
    toCareerH2H({ measured: single, wanted: OVER, isVsOpponent: vsNYY, opponentLabel: 'vs NYY', statLabel: 'Hits' }),
    null,
  );
});

test('no meetings at all renders nothing', () => {
  const none = categoriseByLine([entry(1, 2, 'BOS'), entry(2, 0, 'TOR')], 0.5);
  assert.equal(
    toCareerH2H({ measured: none, wanted: OVER, isVsOpponent: vsNYY, opponentLabel: 'vs NYY', statLabel: 'Hits' }),
    null,
  );
});

test('an unparseable meeting keeps its place rather than being dropped', () => {
  // Dropping it would silently shorten the history and misdate every meeting
  // after it in a strip that reads left-to-right as time.
  const withGap = categoriseByLine(
    [entry(1, 2, 'NYY', 'a'), { period: 2, result: '', category: '', periodLabel: 'b', raw: { opponentAbbr: 'NYY' } }, entry(3, 1, 'NYY', 'c')],
    0.5,
  );
  const role = toCareerH2H({ measured: withGap, wanted: OVER, isVsOpponent: vsNYY, opponentLabel: 'vs NYY', statLabel: 'Hits' })!;
  assert.equal(role.meetings!.length, 3);
  assert.equal(role.meetings![1].value, null, 'the gap is null, and still in sequence');
  assert.deepEqual(role.meetings!.map((m) => m.date), ['a', 'b', 'c']);
});

test('sampleSize is required and real — it is the headline for this role', () => {
  const role = toCareerH2H({
    measured: history(),
    wanted: OVER,
    isVsOpponent: vsNYY,
    opponentLabel: 'vs NYY',
    statLabel: 'Hits',
  })!;
  assert.equal(typeof role.sampleSize, 'number');
  assert.equal(role.sampleSize, role.meetings!.length, 'the n and the strip must describe the same set');
});
