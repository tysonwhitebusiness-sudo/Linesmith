import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { code } from './ui-scope';
import { buildSlateGames, sanePrices } from '../lib/sports/shared/buildSlate';
import { slateSections } from '../lib/sports/shared/slateShapes';
import { buildSpotlights, hitRateLeaders, activeStreaks } from '../lib/slate/spotlights';
import type { PickCandidate } from '../lib/core/types';
import type { SlateGame } from '../lib/odds/matching';
import type { UnifiedGameLine } from '../lib/odds/types';

/**
 * S1's guard — the Slate's shell, its read rules and its frozen neighbours.
 *
 * The rules here are the ones that were WRONG at some point while building it,
 * each caught by rendering rather than by typing: every price on a
 * `BookmakerOdds` is decimal (spreads and totals vanished until that was
 * fixed), a slate is a DAY (NFL showed the week and CFB the season), a live
 * game's `state` is a phrase and not a keyword (five live MLB games sat in the
 * Final bucket), the median of American odds is not a price (a card's
 * consensus read "0"), and one book is not a consensus (a +30.5 NFL spread).
 */

const game = (over: Partial<SlateGame> = {}): SlateGame => ({
  gamePk: '1',
  matchup: 'AAA @ BBB',
  awayTeamName: 'Away Team',
  homeTeamName: 'Home Team',
  firstPitch: '2026-09-20T23:10:00Z',
  state: 'Pre-Game',
  ...over,
});

const line = (books: Array<Record<string, number>>): UnifiedGameLine =>
  ({
    eventId: '1',
    commenceTime: '2026-09-20T23:10:00Z',
    homeTeam: 'Home Team',
    awayTeam: 'Away Team',
    bookmakers: books.map((b, i) => ({ bookmaker: `book${i}`, ...b })),
    bookCount: books.length,
  }) as UnifiedGameLine;

/** A candidate with a run of history, for the spotlight cases. */
const spotCandidate = (id: string, name: string, results: string[], category = 'hit'): PickCandidate =>
  ({
    sport: 'mlb',
    subjectId: id,
    subjectName: name,
    dimension: 'hits',
    dimensionLabel: 'Hits',
    category,
    categoryLabel: 'Records a hit',
    line: 0.5,
    history: results.map((result, i) => ({ period: i + 1, result, category: result })),
    consistent: false,
    sampleSize: results.length,
    liveState: { status: 'pending' },
  }) as unknown as PickCandidate;

/* -------------------------------------------------------------------------- */

test('a price of 0 is not a price, and neither is +10000 on a game line', () => {
  // Both measured live: a `0` and a +10000 moneyline on 2026-09-19/20.
  assert.deepEqual(sanePrices([0, -110, 120]), [-110, 120]);
  assert.deepEqual(sanePrices([10000, -110, 120, -105]), [-110, 120, -105]);
});

test('a quote far from the median is dropped, but only when there is a median', () => {
  // Three or more books: the outlier goes.
  assert.deepEqual(sanePrices([-110, -105, -115, 900]), [-110, -105, -115]);
  // Two books: there is nothing to be far FROM, so both survive the median
  // rule — the absolute bounds are what protect this case.
  assert.deepEqual(sanePrices([-110, 900]), [-110, 900]);
});

test('every price on a bookmaker row is decimal, including spreads and totals', () => {
  // The bug: `overPrice: 1.81` read as an American price is under ±100 and was
  // dropped, so every total on every MLB card disappeared while the moneyline
  // (the one field already being converted) drew fine.
  const out = buildSlateGames({
    games: [game()],
    lines: [
      line([
        { homeOdds: 1.55, awayOdds: 2.49, point: 7, overPrice: 1.81, underPrice: 2.02, spreadHome: -1.5, spreadHomePrice: 2.26 },
        { homeOdds: 1.6, awayOdds: 2.4, point: 7, overPrice: 1.9, underPrice: 1.95, spreadHome: -1.5, spreadHomePrice: 2.2 },
        { homeOdds: 1.58, awayOdds: 2.45, point: 7, overPrice: 1.85, underPrice: 2.0, spreadHome: -1.5, spreadHomePrice: 2.1 },
      ]),
    ],
    spec: {},
  });
  const lines = out.cards[0].lines;
  assert.ok(lines?.total, 'a total must survive the sanity filter');
  assert.ok(lines?.spread, 'a spread must survive the sanity filter');
  assert.equal(lines?.total?.consensus, 'O/U 7');
});

test('the consensus line is the modal point, not the median of the points', () => {
  // Measured on one EPL match: twenty-one books quoted totals of 0.5 through
  // 8.5, because the table holds alternative markets beside the main one. The
  // median of that is 3.25 — a number no book is offering. The mode is the
  // line.
  const out = buildSlateGames({
    games: [game()],
    lines: [
      line([
        { point: 2.5, overPrice: 1.9 },
        { point: 2.5, overPrice: 1.95 },
        { point: 2.5, overPrice: 1.85 },
        { point: 8.5, overPrice: 4.8 },
        { point: 0.5, overPrice: 1.2 },
      ]),
    ],
    spec: {},
  });
  const total = out.cards[0].lines?.total;
  assert.equal(total?.consensus, 'O/U 2.5');
  assert.equal(total?.books, 3, 'only the books quoting THAT line count');
});

test('a total is not signed and a spread is', () => {
  const out = buildSlateGames({
    games: [game()],
    lines: [line([{ point: 8.5, overPrice: 1.9 }, { point: 8.5, overPrice: 1.95 }, { point: 8.5, overPrice: 1.85 }])],
    spec: {},
  });
  assert.equal(out.cards[0].lines?.total?.consensus, 'O/U 8.5', '"O/U +8.5" is not a thing');
});

test('the moneyline consensus is a median of probabilities, not of American odds', () => {
  // The middle of -150 and +130 is not -10. Rendering caught it: a card's
  // consensus read "0".
  const out = buildSlateGames({
    games: [game()],
    lines: [line([{ homeOdds: 1.67 }, { homeOdds: 2.3 }, { homeOdds: 1.95 }])],
    spec: {},
  });
  const ml = out.cards[0].lines?.moneyline?.consensus;
  assert.ok(ml && ml !== '0', `consensus must be a real price, got ${ml}`);
});

test('one book is not a consensus', () => {
  const out = buildSlateGames({
    games: [game()],
    lines: [line([{ spreadHome: 30.5, spreadHomePrice: 2.4 }])],
    spec: {},
  });
  const spread = out.cards[0].lines?.spread;
  assert.equal(spread?.consensus, null, 'a single book cannot be the consensus');
  assert.equal(spread?.books, 1);
});

test('a live game is live however its feed spells it', () => {
  // MLB says "In Progress", ESPN says "in", others say "Manager challenge".
  const states: Array<[string, string]> = [
    ['In Progress', 'live'],
    ['in', 'live'],
    ['Manager challenge', 'live'],
    ['Final', 'done'],
    ['Pre-Game', 'pre'],
  ];
  for (const [state, want] of states) {
    const out = buildSlateGames({ games: [game({ state })], lines: [], spec: {} });
    assert.equal(out.cards[0].status, want, `${state} should be ${want}`);
  }
});

test('a slate is a day, and an empty day names the next one', () => {
  const games = [
    game({ gamePk: '1', firstPitch: '2026-09-20T23:10:00Z' }),
    game({ gamePk: '2', firstPitch: '2026-09-21T23:10:00Z' }),
    game({ gamePk: '3', firstPitch: '2026-09-22T23:10:00Z' }),
  ];
  const today = buildSlateGames({ games, lines: [], spec: {}, date: '2026-09-20' });
  assert.equal(today.counts.all, 1, 'NFL showed the week and CFB the season before this');

  const empty = buildSlateGames({ games, lines: [], spec: {}, date: '2026-09-19' });
  assert.equal(empty.counts.all, 0);
  assert.match(empty.note ?? '', /next games are on 2026-09-20/);
});

test('the nav is derived from the data, so a hidden section is hidden in both', () => {
  const none = slateSections(null, null);
  assert.deepEqual(none, []);
  const golf = slateSections({ sport: 'golf', date: '2026-09-20', fetchedAt: '', games: null, warnings: [] }, 42);
  assert.deepEqual(
    golf.map((s) => s.id),
    ['props'],
    'golf has no Games section, so it must not be in the nav',
  );
});

/* -------------------------------------------------------------------------- */

test('the Scan table is frozen (D3)', () => {
  // The columns, cells, colours, heat, rank chips and row layout do not change.
  // U0's mechanical Tailwind conversion was the one allowed edit and it did not
  // touch either file; this pins them from here.
  const hashes: Record<string, number> = {
    'components/ScanTable.tsx': 47266,
    'components/ScanCard.tsx': 17654,
  };
  for (const [file, size] of Object.entries(hashes)) {
    const actual = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').length;
    assert.equal(
      actual,
      size,
      `${file} changed (${actual} chars, expected ${size}). The Scan table is frozen by D3 — if this is a deliberate, approved change, update the number here and say so in the commit.`,
    );
  }
});

test('the Players/Games toggle and its views are gone', () => {
  for (const f of ['components/GameLinesView.tsx', 'components/GameLine.tsx']) {
    assert.ok(!existsSync(f), `${f} was replaced by the Games section and must be deleted`);
  }
  const shell = readFileSync('components/AppShell.tsx', 'utf8');
  assert.doesNotMatch(shell, /ScanScopeToggle/, 'the Players/Games toggle is gone: games are always a section');
});

test('every sport has a slate adapter, and they all export the same name', () => {
  // One adapter file per sport, the same export in each, different import
  // path — the sport-adapter rule from CLAUDE.md.
  const sports = readdirSync('lib/sports', { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `lib/sports/${e.name}/adapters/slateAdapter.ts`)
    .filter((p) => existsSync(p));
  assert.ok(sports.length >= 7, `expected an adapter per sport, found ${sports.length}`);
  for (const f of sports) {
    assert.match(readFileSync(f, 'utf8'), /export function toSlateData\(/, `${f} must export toSlateData`);
  }
});

test('the Slate page never branches on sport', () => {
  for (const f of ['components/slate/GameCard.tsx', 'components/slate/SlateSections.tsx']) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /sport === '/, `${f} must not branch on sport`);
  }
});

/* -------------------------------------------------------------------------- */
/* S2                                                                         */
/* -------------------------------------------------------------------------- */

test('the Slate never says "since open" — the opener is not held', () => {
  // `odds_archive.open_line` / `open_price` were null on every live row when
  // measured: 0 of 21,476 since 2026-09-08. What the Slate reads is the first
  // OBSERVATION of a book's price, which is a weaker claim and must be worded
  // as one.
  const files = [
    'components/slate/SlateMarket.tsx',
    'components/slate/SlateSections.tsx',
    'components/slate/GameCard.tsx',
    'lib/slate/marketMoves.ts',
    'app/api/slate/market/route.ts',
  ];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    // The phrase is allowed only where the doc comment explains WHY it is
    // never used — matched case-insensitively in the code itself.
    assert.doesNotMatch(code(src), /since open/i, `${f} must say "since first seen", not "since open"`);
  }
});

test('the market cards call a price gap a price gap, not an edge', () => {
  const src = readFileSync('components/slate/SlateMarket.tsx', 'utf8');
  assert.match(src, /not a model edge/, 'both captions must say what the number is not');
  // Nothing may compute or name a difference against a model.
  assert.doesNotMatch(code(src), /\bedge\b(?!\.)/i.source ? /edgePts|modelEdge|\bEdge\b/ : /$^/, 'no edge column');
});

test('Movers is not built, and the reason is written down', () => {
  // S2's third card. The movement data is real; the signal is not extractable
  // from it yet. If someone builds it, they must remove this test and say why.
  const route = readFileSync('app/api/slate/market/route.ts', 'utf8');
  assert.match(route, /WHAT IS NOT HERE: Movers/, 'the absence must stay explained');
  assert.ok(!existsSync('components/slate/SlateMovers.tsx'));
});

test('the slate day defaults to Eastern, not UTC', () => {
  // At 03:00 UTC it is 23:00 the previous evening in New York and the same
  // slate is still being played. Defaulting to `toISOString()` emptied every
  // Games section the moment the clock passed midnight UTC — found by
  // rendering at 23:06 ET, with fifteen MLB games still on the page above.
  for (const f of ['app/api/slate/route.ts', 'app/api/slate/market/route.ts']) {
    const src = readFileSync(f, 'utf8');
    assert.match(src, /if \(raw == null\) return easternDate\(\);/, `${f} must default the slate day to Eastern`);
    assert.doesNotMatch(code(src), /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/, `${f} must not default the slate day to UTC`);
  }
});

/* -------------------------------------------------------------------------- */
/* S3                                                                         */
/* -------------------------------------------------------------------------- */

test('Spotlights are derived from candidates, not from slate_rankings', () => {
  // S3's own premise was wrong and this is the correction. Measured
  // 2026-09-20: `slate_rankings` holds four rankings across three sports —
  // mlb-hr-of-the-day, mlb-most-strikeouts, nfl-anytime-td and
  // soccer-anytime-goalscorer. Those are the SPECIALS pilot set (S4). The two
  // spotlights the spec asks every sport for have no rows there and never did.
  const src = readFileSync('lib/slate/spotlights.ts', 'utf8');
  assert.doesNotMatch(code(src), /slate_rankings/, 'spotlights must read the candidates the board already holds');
  assert.match(src, /THE PHASE'S OWN PREMISE WAS WRONG/, 'the correction must stay explained');
});

test('a hit rate needs a real sample, and says how big it is', () => {
  // "100% in 2 of 2" outranks "80% in 8 of 10" on rate alone and says far
  // less. The sample is a filter AND a column.
  const card = hitRateLeaders(
    [
      spotCandidate('short', 'Two Games', ['hit', 'hit']),
      spotCandidate('long', 'Ten Games', ['hit', 'hit', 'hit', 'hit', 'hit', 'hit', 'hit', 'hit', 'miss', 'hit']),
    ],
    { sport: 'mlb' },
  );
  assert.deepEqual(
    card.rows.map((r) => r.subjectName),
    ['Ten Games'],
    'a two-game record is not a hit rate',
  );
  assert.ok(card.columns.some((c) => c.key === 'sample'), 'the sample must be a column');
});

test('every spotlight factor names its source', () => {
  const cards = buildSpotlights([], { sport: 'mlb' });
  for (const card of cards) {
    assert.ok(card.columns.length > 0, `${card.id} has no factor columns`);
    for (const c of card.columns) {
      assert.ok(c.info && c.info.length > 20, `${card.id}.${c.key} must say where the number came from`);
    }
    // An empty state always says WHY, never just "nothing".
    assert.ok(card.empty && card.empty.length > 20, `${card.id} needs a real empty state`);
    assert.match(card.caption, /not a prediction|says nothing about the next one/);
  }
});

test('one row per player, and both streak directions get half the card', () => {
  // Each record is MIXED, with the run at the end: a candidate that never
  // goes the other way is filtered out by the rule below, because a run that
  // is the whole record is the shape of the data rather than form.
  const many = [
    spotCandidate('a', 'Player A', ['miss', ...Array(11).fill('hit')], 'hit'),
    spotCandidate('b', 'Player B', ['hit', ...Array(9).fill('miss')], 'hit'),
    spotCandidate('c', 'Player C', ['hit', ...Array(8).fill('miss')], 'hit'),
  ];
  // Same subjectId twice -> one row.
  const dupHistory = ['miss', ...Array(11).fill('hit')];
  const dup = [spotCandidate('x', 'Dup', dupHistory, 'hit'), spotCandidate('x', 'Dup', dupHistory, 'hit')];
  assert.equal(hitRateLeaders(dup, { sport: 'mlb' }).rows.length, 1, 'three of the top five rows were one relief pitcher before this');

  const streaks = activeStreaks(many, { sport: 'mlb', limit: 4 });
  const directions = new Set(streaks.rows.map((r) => r.values.direction.text));
  assert.ok(directions.has('Cleared') && directions.has('Missed'), 'sorting on magnitude alone filled the card with misses');
});

test('a run that IS the whole record is not a streak', () => {
  // WTA's card came back as eight rows of "Missed this line in each of the
  // last 91 matches" on "To Win a Set · Yes" — the category never matches in
  // that sport's history, so every period is a miss and the "run" is the
  // record. A miss-run needs the player to have cleared the line at least
  // once, ever.
  const never = [spotCandidate('n', 'Never', Array(20).fill('miss'), 'hit')];
  assert.equal(activeStreaks(never, { sport: 'tennis' }).rows.length, 0);
  const always = [spotCandidate('a', 'Always', Array(20).fill('hit'), 'hit')];
  assert.equal(activeStreaks(always, { sport: 'tennis' }).rows.length, 0);
  const real = [spotCandidate('r', 'Real', ['hit', ...Array(9).fill('miss')], 'hit')];
  assert.equal(activeStreaks(real, { sport: 'tennis' }).rows.length, 1);
});

test('the period is a round in golf and a match in tennis', () => {
  // `readForm` counts periods. Calling a golf round a "game" in the empty
  // state would explain the wrong thing — golf has 2,489 candidates today and
  // no spotlight rows, because a golfer rarely has ten rounds of one hole.
  assert.match(hitRateLeaders([], { sport: 'golf' }).empty ?? '', /rounds/);
  assert.match(hitRateLeaders([], { sport: 'tennis' }).empty ?? '', /matches/);
  assert.match(hitRateLeaders([], { sport: 'mlb' }).empty ?? '', /games/);
  // And the singular is a real singular: stripping an "s" gives "matche".
  const tennisSeason = hitRateLeaders([], { sport: 'tennis' }).columns.find((c) => c.key === 'season');
  assert.match(tennisSeason?.info ?? '', /every match held/);
  assert.doesNotMatch(tennisSeason?.info ?? '', /matche /);
});
