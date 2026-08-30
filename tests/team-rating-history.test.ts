import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ELO_SPORT_KEYS,
  eloSportKey,
  toTeamRatingHistory,
  type TeamRatingRow,
} from '../lib/sports/shared/teamRatingShapes';
import { toRatingHistoryRole } from '../lib/sports/shared/ratingHistoryRole';

/**
 * Phase 6.14 — the team rating block.
 *
 * WHAT THIS IS GUARDING. Three of these tests exist because the first working
 * version of this code was wrong on real data and rendered cleanly anyway:
 *
 *  - Taking "the most recent season" literally drew NOTHING for every EPL team
 *    on 2026-08-30, because the 2026 season was one game old and 2025's full
 *    38 sat right behind it.
 *  - `SeriesChart` builds its x scale from `values.length` and reuses it for
 *    every context line, so a context series even one element longer runs off
 *    the frame. Nothing type-checks that.
 *  - `team_elo_history.team_id` is not unique across sports — 43 ids are shared
 *    by up to four leagues — so a query without a sport filter blends them.
 */

const g = (season: number, gamesPlayed: number, elo: number, gameDate = `${season}-04-01`): TeamRatingRow => ({
  season,
  gamesPlayed,
  elo,
  gameDate,
});

function season(seasonYear: number, elos: number[]): TeamRatingRow[] {
  return elos.map((e, i) => g(seasonYear, i + 1, e));
}

test('the sport key uses the TABLE vocabulary, not the app vocabulary', () => {
  // `pick_history` says `soccer`; this table says `soccer_epl`. Getting this
  // wrong returns an empty series that looks exactly like "no history yet".
  assert.equal(eloSportKey('soccer', 'epl'), 'soccer_epl');
  assert.equal(eloSportKey('soccer', 'mls'), 'soccer_mls');
  assert.equal(eloSportKey('mlb'), 'mlb');
  assert.equal(eloSportKey('nhl'), 'nhl');
  // A league is required for soccer — `soccer` alone is not a key this table has.
  assert.equal(eloSportKey('soccer', null), null);
});

test('sports with no team concept get no key, and so never fetch', () => {
  assert.equal(eloSportKey('tennis'), null);
  assert.equal(eloSportKey('golf'), null);
});

test('every key the mapper can produce is one the route accepts', () => {
  // Independent lists: one gates the fetch, the other gates the route. A key
  // the mapper emits and the route rejects is a 400 on a real team page.
  const produced = ['mlb', 'nfl', 'cfb', 'nba', 'nhl'].map((s) => eloSportKey(s as never));
  produced.push(eloSportKey('soccer', 'epl'), eloSportKey('soccer', 'mls'));
  for (const key of produced) {
    assert.ok(key && (ELO_SPORT_KEYS as readonly string[]).includes(key), `${key} is not an accepted sport`);
  }
  assert.equal(new Set(produced).size, ELO_SPORT_KEYS.length, 'no accepted key is unreachable');
});

test('the subject is the latest DRAWABLE season, not simply the latest', () => {
  // The real EPL case: a full prior season, and one game of the new one.
  const history = toTeamRatingHistory([...season(2025, [1500, 1505, 1511]), g(2026, 1, 1509)])!;
  assert.equal(history.season, 2025, 'a one-game season is not a trajectory');
  assert.equal(history.gameCount, 3);
  assert.equal(history.isCurrentSeason, false);
  assert.equal(history.newerSeasonGames, 1, 'the newer season is reported, not silently dropped');
});

test('the axis width is the longest DRAWN season', () => {
  // Deliberately NOT phrased as "a newer thin season does not stretch the
  // axis". That version passed with the guard removed, because an undrawn
  // season has exactly one game by definition and a drawn one has at least
  // two — `max` can never pick it. An assertion that cannot fail is not a
  // test, and the `drawn` filter in the width is honest belt-and-braces
  // rather than a guard against something reachable today.
  const history = toTeamRatingHistory([
    ...season(2023, [1400, 1401, 1402, 1403, 1404]),
    ...season(2024, [1500, 1501, 1502]),
    ...season(2025, [1600, 1601]),
  ])!;
  assert.equal(history.values.length, 5);
});

test('every series is the same length — the constraint SeriesChart cannot express', () => {
  // A context line longer than `values` is drawn with the subject's x scale and
  // runs straight off the frame. Type-checks fine; looks broken.
  //
  // THE FIXTURE NEEDS THREE SEASONS. With two, the only context season is also
  // the one that sets the width, so an unpadded context line comes out the
  // right length by accident and removing the padding changes nothing. The
  // middle season here is shorter than the longest and longer than the
  // subject — the only shape that catches it.
  const history = toTeamRatingHistory([
    ...season(2023, [1400, 1402, 1404, 1406, 1408]),
    ...season(2024, [1500, 1502, 1504]),
    ...season(2025, [1510, 1512]),
  ])!;
  assert.equal(history.values.length, 5, 'the longest drawn season sets the width');
  assert.equal(history.context.length, 2);
  for (const line of history.context) {
    assert.equal(line.length, history.values.length, 'context must match the subject length exactly');
  }
});

test('padding is non-finite, so the line breaks rather than flattening to zero', () => {
  const history = toTeamRatingHistory([...season(2024, [1500, 1502, 1504]), ...season(2025, [1510, 1512])])!;
  assert.equal(history.values[0], 1510);
  assert.equal(history.values[1], 1512);
  // A 0 here would be plotted as a real rating and drag the whole domain down.
  assert.ok(!Number.isFinite(history.values[2]), 'the tail must be non-finite, not 0');
});

test('context is every earlier drawn season, oldest first, and excludes the subject', () => {
  const history = toTeamRatingHistory([
    ...season(2023, [1400, 1401]),
    ...season(2024, [1500, 1501]),
    ...season(2025, [1600, 1601]),
  ])!;
  assert.equal(history.season, 2025);
  assert.equal(history.context.length, 2);
  assert.equal(history.context[0][0], 1400, 'oldest first');
  assert.equal(history.context[1][0], 1500);
  assert.ok(!history.context.some((line) => line[0] === 1600), 'the subject is not also its own context');
});

test('the change is across the season, not against a 1500 baseline', () => {
  // A team that opened at 1580 and sits at 1560 is DOWN, even though it is
  // still well above average. Measuring from 1500 would call that +60.
  const history = toTeamRatingHistory(season(2025, [1580, 1570, 1560]))!;
  assert.equal(history.change, -20);
  assert.equal(history.current, 1560);
});

test('games are ordered by game index, so a doubleheader cannot be reordered', () => {
  // Two games share one date. Sorting on the date alone leaves their order to
  // the query planner, and the trajectory would jitter differently per request.
  const history = toTeamRatingHistory([
    g(2025, 2, 1510, '2025-06-01'),
    g(2025, 1, 1500, '2025-06-01'),
    g(2025, 3, 1520, '2025-06-02'),
  ])!;
  assert.deepEqual(history.values, [1500, 1510, 1520]);
});

test('fewer than two rated games anywhere is no block at all', () => {
  assert.equal(toTeamRatingHistory([]), null);
  assert.equal(toTeamRatingHistory([g(2025, 1, 1500)]), null);
  assert.equal(toTeamRatingHistory([g(2024, 1, 1500), g(2025, 1, 1510)]), null, 'one game each is still no trajectory');
});

test('a non-finite rating is dropped rather than plotted', () => {
  const history = toTeamRatingHistory([g(2025, 1, 1500), g(2025, 2, NaN), g(2025, 3, 1520)])!;
  assert.deepEqual(history.values, [1500, 1520]);
});

// ---------------------------------------------------------------------------
// The role builder — one shared builder for all six sports.
// ---------------------------------------------------------------------------

test('the caption says "now" only when the drawn season IS the current one', () => {
  const current = toRatingHistoryRole({
    state: { history: toTeamRatingHistory(season(2026, [1500, 1515])), loading: false },
  })!;
  assert.match(current.caption, /^1515 now/);
  assert.match(current.caption, /\+15 across 2026/);

  const stale = toRatingHistoryRole({
    state: { history: toTeamRatingHistory([...season(2025, [1500, 1511]), g(2026, 1, 1509)]), loading: false },
  })!;
  assert.match(stale.caption, /^1511 at the end of 2025/, 'calling a year-old rating "now" is a confident lie');
  assert.match(stale.caption, /1 game since, too few to plot/);
});

test('a positive move always carries its sign', () => {
  // "23 across 2026" reads as a rating. The sign is the whole content.
  const role = toRatingHistoryRole({
    state: { history: toTeamRatingHistory(season(2026, [1500, 1523])), loading: false },
  })!;
  assert.match(role.caption, /\+23/);
});

test('the depth clause only appears when there is real depth behind the line', () => {
  const oneSeason = toRatingHistoryRole({
    state: { history: toTeamRatingHistory(season(2025, [1500, 1510])), loading: false },
  })!;
  assert.doesNotMatch(oneSeason.caption, /behind/, 'five of six sports have exactly one season');
  assert.equal(oneSeason.spanLabel, '2025 only');

  const deep = toRatingHistoryRole({
    state: { history: toTeamRatingHistory([...season(2024, [1490, 1495]), ...season(2025, [1500, 1510])]), loading: false },
  })!;
  assert.match(deep.caption, /1 earlier season behind/);
  assert.match(deep.spanLabel, /2024.*2025.*2 seasons/);
});

test('no history, no card — including while it is still loading', () => {
  for (const state of [undefined, { history: null, loading: true }, { history: null, loading: false }]) {
    assert.equal(toRatingHistoryRole({ state }), null);
  }
});
