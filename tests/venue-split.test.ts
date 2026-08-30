import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toVenueBinarySplit } from '../lib/sports/shared/venueSplit';
import { categoriseByLine, OVER } from '../lib/core/windowedStat';
import type { HistoryEntry } from '../lib/core/types';

/**
 * Phase 6.13 — `binarySplit` as home/away, for the four sports whose history
 * carries `raw.isHome` but which expose no venue filter (CFB, NBA, NHL,
 * soccer).
 *
 * The assertion that matters is the LAST one. `raw.isHome` is a boolean derived
 * from a team-name comparison, so a failed comparison does not throw — it
 * returns false, and the player's whole career reads as away games. Measured on
 * the live EPL slate: 13 of 303 subjects had zero home entries, Harvey Elliott
 * and Frank Onyeka among them, which is what drags the board's aggregate to
 * 3,228 home against 13,013 away.
 */

function entry(period: number, value: number, isHome: boolean | undefined): HistoryEntry {
  return {
    period,
    result: String(value),
    category: '',
    raw: isHome === undefined ? {} : { isHome },
  };
}

/** Six home games averaging 80, six away averaging 40, against a line of 50. */
function balanced(): HistoryEntry[] {
  const rows: HistoryEntry[] = [];
  for (let i = 0; i < 6; i++) rows.push(entry(i + 1, 80, true));
  for (let i = 0; i < 6; i++) rows.push(entry(i + 7, 40, false));
  return categoriseByLine(rows, 50);
}

test('a real split reports both sides with their own samples', () => {
  const role = toVenueBinarySplit({ measured: balanced(), wanted: OVER, statLabel: 'Rush yards' });
  assert.ok(role, 'six games at each venue is a split');
  assert.equal(role.aLabel, 'Home');
  assert.equal(role.bLabel, 'Away');

  const rate = role.rows.find((r) => r.key === 'hitRate')!;
  // Every home game cleared 50, no away game did.
  assert.equal(rate.a, 100);
  assert.equal(rate.b, 0);
  assert.equal(rate.aSample, 6);
  assert.equal(rate.bSample, 6);

  const avg = role.rows.find((r) => r.key === 'average')!;
  assert.equal(avg.a, 80);
  assert.equal(avg.b, 40);
  assert.equal(avg.label, 'Rush yards', 'the row is labelled with what it measures, not "Average"');
});

test('the split is suppressed when one venue has nothing — the resolution defect', () => {
  // THE DEFECT: a player whose team name never matched the fixture's home team.
  // Every entry says away. Rendering "Away .42 (n=331) / Home — (n=0)" states
  // something false with total confidence, and no downstream code can tell.
  const allAway = categoriseByLine(
    Array.from({ length: 20 }, (_, i) => entry(i + 1, 60, false)),
    50,
  );
  assert.equal(
    toVenueBinarySplit({ measured: allAway, wanted: OVER, statLabel: 'Shots' }),
    null,
    'twenty away games and no home games is a broken join, not a home/away split',
  );

  // And the mirror case, so the guard is not one-sided.
  const allHome = categoriseByLine(
    Array.from({ length: 20 }, (_, i) => entry(i + 1, 60, true)),
    50,
  );
  assert.equal(toVenueBinarySplit({ measured: allHome, wanted: OVER, statLabel: 'Shots' }), null);
});

test('a side below the minimum does not count as a side', () => {
  // Two home games is not a venue split, it is two games. The default minimum
  // is 3 — the smallest number that is not obviously noise.
  const thin = categoriseByLine(
    [entry(1, 80, true), entry(2, 80, true), ...Array.from({ length: 8 }, (_, i) => entry(i + 3, 40, false))],
    50,
  );
  assert.equal(toVenueBinarySplit({ measured: thin, wanted: OVER, statLabel: 'Shots' }), null);
  // ...and it does render once the third home game arrives.
  const enough = categoriseByLine(
    [entry(1, 80, true), entry(2, 80, true), entry(3, 80, true), ...Array.from({ length: 8 }, (_, i) => entry(i + 4, 40, false))],
    50,
  );
  assert.ok(toVenueBinarySplit({ measured: enough, wanted: OVER, statLabel: 'Shots' }));
});

test('entries with no isHome at all are counted as neither venue', () => {
  // `undefined` is not `false`. A sport or a row that never recorded the venue
  // must not be silently filed under "away", which is the same mistake the
  // resolution defect makes — just made by us instead of by the provider.
  const missing = categoriseByLine(
    [
      ...Array.from({ length: 4 }, (_, i) => entry(i + 1, 80, true)),
      ...Array.from({ length: 10 }, (_, i) => entry(i + 5, 40, undefined)),
    ],
    50,
  );
  assert.equal(
    toVenueBinarySplit({ measured: missing, wanted: OVER, statLabel: 'Shots' }),
    null,
    'ten venue-less games must not become ten away games',
  );
});

test('a lopsided split is rejected even when both sides pass the minimum', () => {
  // THE DEFECT THIS PINS, and it reached a real page: Callum Wilson's EPL card
  // rendered "Cleared the line — Home 0 (n=5) vs Away 28 (n=267)". Both sides
  // cleared `minimum: 3`, every number was well-formed, and the card was false.
  //
  // Understat compares each historical fixture's home team against the player's
  // CURRENT team title, so every match at a previous club records as away. The
  // longer the career, the more lopsided — and nothing about the output says so.
  const lopsided = categoriseByLine(
    [
      ...Array.from({ length: 5 }, (_, i) => entry(i + 1, 40, true)),
      ...Array.from({ length: 267 }, (_, i) => entry(i + 6, 60, false)),
    ],
    50,
  );
  assert.equal(
    toVenueBinarySplit({ measured: lopsided, wanted: OVER, statLabel: 'Anytime G' }),
    null,
    '5 home against 267 away is 1:53 — teams play a balanced schedule, so this is a join failure',
  );
});

test('an honest mid-season imbalance still renders', () => {
  // The guard must not reject real data. Four home and eight away is 1:2 — an
  // ordinary run of fixtures, not a broken join.
  const uneven = categoriseByLine(
    [
      ...Array.from({ length: 4 }, (_, i) => entry(i + 1, 80, true)),
      ...Array.from({ length: 8 }, (_, i) => entry(i + 5, 40, false)),
    ],
    50,
  );
  const role = toVenueBinarySplit({ measured: uneven, wanted: OVER, statLabel: 'Shots' });
  assert.ok(role, 'a 1:2 schedule imbalance is normal and must survive the ratio guard');
  assert.equal(role.rows[0].aSample, 4);
  assert.equal(role.rows[0].bSample, 8);
});
