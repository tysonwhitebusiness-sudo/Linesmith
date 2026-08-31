import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnalyticsRoles,
  toGameContext,
  toRollingForm,
  toSituationalSplits,
  toWhereThisSits,
} from '../lib/sports/shared/analyticsRoles';
import type { HistoryEntry } from '../lib/core/types';

/**
 * The four analytics cards — Phase 6.16.
 *
 * EVERY ASSERTION HERE EXISTS BECAUSE OF SOMETHING THAT WENT WRONG ON A REAL
 * PAGE, or would have. The two that were caught by walking rather than by
 * typechecking:
 *
 *  - `isHomeOf` read "vs" in a period label as HOME. Every NFL label says
 *    "vs" whether the game was home or away, so the grid rendered a "Home" row
 *    identical to "All games" and an empty "Away" row — a claim about venue
 *    that was really a claim about the feed.
 *  - `toGameContext` returned null without a line, which deleted the whole
 *    card on soccer's anytime-goalscorer market even though games-in-scope and
 *    season average need no threshold at all.
 */

function h(period: number, result: string, extra?: Partial<HistoryEntry>): HistoryEntry {
  return { period, result, category: 'over', ...extra };
}

/** Ten games: 0,2,1,3,0,2,4,1,0,2 — mean 1.5, median 2, SEVEN of ten over 0.5 (three zeros). */
const TEN = [0, 2, 1, 3, 0, 2, 4, 1, 0, 2].map((v, i) => h(i + 1, String(v)));

// ---------------------------------------------------------------------------
// Rolling form
// ---------------------------------------------------------------------------

test('rolling form returns a mean series the same length as its values', () => {
  const role = toRollingForm(TEN, { title: 'Rolling form' })!;
  assert.ok(role, 'ten real games should produce a rolling form');
  assert.equal(role.mean.length, role.values.length);
  assert.equal(role.labels.length, role.values.length);
});

test('an unparseable result becomes NaN, never 0', () => {
  // 0 would drag the mean down and read as a genuinely bad game.
  const role = toRollingForm([h(1, '1'), h(2, 'DNP'), h(3, '3')], { title: 'x' })!;
  assert.ok(Number.isNaN(role.values[1]), 'DNP must be NaN so the line breaks rather than dipping');
  assert.ok(!role.values.includes(0), 'no zero should have been invented');
  // The mean skips the gap instead of averaging a fabricated zero in. A
  // three-entry history clamps the window to 2, so the last point is the mean
  // of [NaN, 3] with the gap dropped -- 3, not 1.5 and certainly not 2.
  assert.equal(role.mean[2], 3);
});

test('rolling form stands down below two usable values', () => {
  assert.equal(toRollingForm([h(1, '2')], { title: 'x' }), null);
  assert.equal(toRollingForm([h(1, 'DNP'), h(2, 'DNP')], { title: 'x' }), null);
});

test('the window shrinks for a short history rather than flattening it', () => {
  // Four rounds of golf must not use a 5-game window: every point would be the
  // same running mean and the line would be flat by construction.
  const four = toRollingForm([h(1, '0'), h(2, '1'), h(3, '0'), h(4, '2')], { title: 'x' })!;
  assert.ok(four.window <= 2, `window ${four.window} is longer than half a 4-game history`);
});

// ---------------------------------------------------------------------------
// Situational splits
// ---------------------------------------------------------------------------

test('"vs" in a period label is NOT evidence of a home game', () => {
  // The real NFL shape: every label says "vs", and nothing else marks venue.
  const nfl = TEN.map((e, i) => ({ ...e, periodLabel: `25-Wk${i + 1} vs SF` }));
  const role = toSituationalSplits(nfl, 0.5, { title: 'x' });
  assert.equal(
    role,
    null,
    'labels alone must not produce a venue split — this rendered a Home row identical to All games',
  );
});

test('a "vs" label does not become a home game even when @ labels are present', () => {
  // THIS FIXTURE EXISTS BECAUSE MY FIRST VERSION OF IT DID NOT DISCRIMINATE.
  // An all-"vs" fixture cannot catch the heuristic: classifying all ten as
  // home leaves zero away games, so the both-sides guard nulls the card and
  // the test passes either way. Re-introducing the bug proved that.
  //
  // Mixing the labels is what separates them. With `@` marking five away
  // games, the bad heuristic finds five "home" games from "vs" and produces a
  // confident three-row split; the correct code knows only that five were away
  // and refuses.
  const mixed = TEN.map((e, i) => ({
    ...e,
    periodLabel: i % 2 === 0 ? `Wk${i + 1} vs SF` : `Wk${i + 1} @ SF`,
  }));
  assert.equal(
    toSituationalSplits(mixed, 0.5, { title: 'x' }),
    null,
    'five @ games prove five away; nothing proves the other five were home',
  );
});

test('a venue split needs a real sample on BOTH sides', () => {
  // Nine home, one away: an "Away" row of one game is not a split.
  const lopsided = TEN.map((e, i) => ({ ...e, raw: { isHome: i !== 0 } }));
  assert.equal(toSituationalSplits(lopsided, 0.5, { title: 'x' }), null);
});

test('a real home/away split renders both rows and they differ', () => {
  const split = TEN.map((e, i) => ({ ...e, raw: { isHome: i % 2 === 0 } }));
  const role = toSituationalSplits(split, 0.5, { title: 'x' })!;
  assert.ok(role, 'five and five should split');
  assert.deepEqual(role.rowLabels, ['All games', 'Home', 'Away']);
});

test('a cell below the sample floor renders null rather than a percentage', () => {
  const three = [h(1, '2'), h(2, '0'), h(3, '2'), h(4, '1')].map((e, i) => ({ ...e, raw: { isHome: i < 2 } }));
  const role = toSituationalSplits(three, 0.5, { title: 'x' });
  // Two per side is below the floor, so no venue rows, so no grid at all.
  assert.equal(role, null);
});

test('an @ in the label proves away, and away alone still does not split', () => {
  const away = TEN.map((e, i) => ({ ...e, periodLabel: `Aug ${i + 1} @ WSH` }));
  // Every game away, no home games: correctly refuses rather than showing one row.
  assert.equal(toSituationalSplits(away, 0.5, { title: 'x' }), null);
});

// ---------------------------------------------------------------------------
// Where this sits
// ---------------------------------------------------------------------------

test('where-this-sits needs a real pool before drawing a distribution', () => {
  const peers = Array.from({ length: 5 }, () => ({ history: TEN }));
  assert.equal(toWhereThisSits(TEN, peers, { title: 'x', label: 'y' }), null, 'five peers is a spike, not a curve');
});

test('the subject is ranked against the pool, best first', () => {
  const weak = Array.from({ length: 10 }, () => ({ history: [h(1, '0'), h(2, '0'), h(3, '0')] }));
  const role = toWhereThisSits(TEN, weak, { title: 'x', label: 'y' })!;
  assert.equal(role.rank, 1, 'a subject above every peer must rank first');
  assert.equal(role.poolSize, 10);
});

test('a peer with too few games is excluded from the pool, not counted as zero', () => {
  const mixed = [
    ...Array.from({ length: 10 }, () => ({ history: TEN })),
    { history: [h(1, '5')] },
  ];
  const role = toWhereThisSits(TEN, mixed, { title: 'x', label: 'y' })!;
  assert.equal(role.poolSize, 10, 'the one-game peer must not enter the pool');
});

// ---------------------------------------------------------------------------
// Game context
// ---------------------------------------------------------------------------

test('game context renders without a line, minus the line-dependent rows', () => {
  const role = toGameContext(TEN, null, { title: 'x' })!;
  assert.ok(role, 'a no-line market still has games, an average and a median');
  const keys = role.rows.map((r) => r.key);
  assert.deepEqual(keys, ['games', 'mean', 'median']);
  assert.ok(!keys.includes('rate'), 'a cover rate against no line would be a fabricated number');
});

test('game context with a line adds the rate and the gap to it', () => {
  const role = toGameContext(TEN, 0.5, { title: 'x' })!;
  const by = Object.fromEntries(role.rows.map((r) => [r.key, r.value]));
  assert.equal(by.games, '10');
  assert.equal(by.mean, '1.50');
  assert.equal(by.rate, '7 of 10 · 70%', 'three of the ten values are 0, so seven clear 0.5');
  assert.equal(by.edge, '+1.00', 'mean 1.5 against a line of 0.5');
});

test('under markets grade the other way', () => {
  const role = toGameContext(TEN, 2.5, { title: 'x', wantOver: false })!;
  const by = Object.fromEntries(role.rows.map((r) => [r.key, r.value]));
  assert.equal(by.rate, '8 of 10 · 80%', 'eight of ten games came in under 2.5');
});

// ---------------------------------------------------------------------------
// The one call every adapter makes
// ---------------------------------------------------------------------------

test('buildAnalyticsRoles returns all four keys so a sport cannot wire three', () => {
  const roles = buildAnalyticsRoles({ history: TEN, line: 0.5, statLabel: 'Hits' });
  assert.deepEqual(Object.keys(roles).sort(), ['gameContext', 'rollingForm', 'situationalSplits', 'whereThisSits']);
});

test('a market with no line still builds the three cards that do not need one', () => {
  const roles = buildAnalyticsRoles({ history: TEN, statLabel: 'Anytime Goalscorer' });
  assert.ok(roles.rollingForm, 'a trend needs no threshold');
  assert.ok(roles.gameContext, 'games and an average need no threshold');
  assert.equal(roles.situationalSplits, null, 'a cover rate genuinely does need one');
});

test('peers are optional and their absence only nulls the population card', () => {
  const roles = buildAnalyticsRoles({ history: TEN, line: 0.5, statLabel: 'Hits' });
  assert.equal(roles.whereThisSits, null);
  assert.ok(roles.rollingForm && roles.gameContext, 'the other cards must not depend on a pool');
});
