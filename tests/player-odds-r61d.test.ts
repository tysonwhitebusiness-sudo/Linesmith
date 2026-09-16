import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { PickCandidate } from '../lib/core/types';
import type { PropOddsRow } from '../lib/db/client';
import { playerPriceRows } from '../lib/odds/props/playerPrices';
import { repriceAtMainLine } from '../lib/odds/props/mainLine';
import { toPlayerDetailData } from '../lib/sports/mlb/adapters/playerDetailAdapter';

/**
 * R6.1d — the player page's odds: one line on the page (R2's main line, not
 * MLB's board line and not the modal rung), prices as they stood at the start,
 * and the C4 game-state slot.
 */

const NOW = Date.parse('2026-09-15T20:00:00Z');
let id = 0;
const row = (over: Partial<PropOddsRow>): PropOddsRow => ({
  id: ++id,
  providerId: 'sharpapi',
  gameId: '776001',
  subjectId: '669373',
  subjectName: 'Tarik Skubal',
  marketKey: 'pitcher-strikeouts',
  line: 6.5,
  side: 'over',
  bookmaker: 'fanduel',
  americanOdds: -110,
  decimalOdds: null,
  fetchedAt: '2026-09-15T19:50:00Z',
  isDelayed: false,
  delaySeconds: null,
  ...over,
});
const twoSided = (book: string, line: number, over: number, under: number, extra: Partial<PropOddsRow> = {}) => [
  row({ bookmaker: book, line, side: 'over', americanOdds: over, ...extra }),
  row({ bookmaker: book, line, side: 'under', americanOdds: under, ...extra }),
];

// ---------------------------------------------------------------------------
// The price table
// ---------------------------------------------------------------------------

test('the price table shows each market at its main line, with the best price at that line', () => {
  const rows = [
    ...twoSided('fanduel', 6.5, -115, -105),
    ...twoSided('draftkings', 6.5, -110, -110),
    // An alternate rung with a longer over price: never the table's line.
    row({ bookmaker: 'draftkings', line: 8.5, side: 'over', americanOdds: 240 }),
    // A pick'em payout is not a price.
    row({ bookmaker: 'prizepicks', line: 6.5, side: 'over', americanOdds: 100 }),
    // Another player's rows stay out.
    ...twoSided('fanduel', 1.5, -120, 100, { subjectId: '592450', marketKey: 'total-bases' }),
  ];
  const [k] = playerPriceRows(rows, '669373', '2026-09-15T22:40:00Z', NOW);
  assert.equal(k.kind, 'main');
  assert.equal(k.line, 6.5);
  assert.deepEqual([k.over?.americanOdds, k.over?.bookmaker, k.under?.americanOdds, k.under?.bookmaker], [-110, 'draftkings', -105, 'fanduel']);
  assert.equal(k.books, 2, 'pick-em apps do not count as books');
  assert.deepEqual(k.availableLines, [6.5, 8.5]);
});

test('one-sided markets say alternates only, yes/no markets have no line, and nothing after the start counts', () => {
  const rows = [
    row({ marketKey: 'triples', line: 0.5, side: 'over', americanOdds: 900 }),
    row({ marketKey: 'triples', line: 0.5, side: 'over', americanOdds: 850, bookmaker: 'draftkings' }),
    row({ marketKey: 'to-record-win', line: null, side: 'over', americanOdds: 120 }),
    row({ marketKey: 'to-record-win', line: null, side: 'other', americanOdds: 115, bookmaker: 'draftkings' }),
    ...twoSided('fanduel', 5.5, -110, -110, { marketKey: 'pitcher-hits-allowed', fetchedAt: '2026-09-15T23:10:00Z' }),
  ];
  const out = playerPriceRows(rows, '669373', '2026-09-15T22:40:00Z', Date.parse('2026-09-15T23:30:00Z'));
  assert.deepEqual(out.map((r) => [r.marketKey, r.kind, r.line]), [['to-record-win', 'yes-no', null], ['triples', 'alternates-only', null]]);
  assert.equal(out.find((r) => r.kind === 'alternates-only')!.over, null, 'no price is shown for a line that is not a market');
});

test('the table follows the order it is given, then the market key', () => {
  const rows = [...twoSided('fanduel', 1.5, -110, -110, { marketKey: 'total-bases' }), ...twoSided('fanduel', 0.5, -110, -110, { marketKey: 'hits' })];
  const order = (k: string) => (k === 'total-bases' ? 0 : 1);
  assert.deepEqual(playerPriceRows(rows, '669373', null, NOW, order).map((r) => r.marketKey), ['total-bases', 'hits']);
});

// ---------------------------------------------------------------------------
// MLB's main line (R2-F4) and the model's own line
// ---------------------------------------------------------------------------

const candidate = (extra: Partial<PickCandidate> = {}): PickCandidate =>
  ({
    sport: 'mlb',
    subjectId: '669373',
    subjectName: 'Tarik Skubal',
    subjectMeta: { gamePk: 776001, team: 'DET', opponent: 'TOR', opponentId: 141, teamId: 116, isHome: false, pitchHand: 'L', modelProb: 0.61, modelStdDev: 0.04 },
    dimension: 'pitcher-strikeouts',
    dimensionLabel: 'Pitcher Strikeouts',
    category: 'over',
    categoryLabel: 'Over',
    line: 4.5,
    history: [5, 7, 8, 6, 9].map((v, i) => ({ period: i + 1, result: String(v), category: v > 4.5 ? 'over' : 'under', periodLabel: `g${i}`, raw: { strikeOuts: v, opponentId: 141, isHome: i % 2 === 0 } })),
    consistent: true,
    sampleSize: 5,
    supportingSplits: [],
    ...extra,
  }) as unknown as PickCandidate;

const snapshot = (state = 'Scheduled') =>
  ({ fetchedAt: '2026-09-15T19:55:00Z', context: { other: { games: [{ gamePk: 776001, matchup: 'DET@TOR', awayTeamId: 116, homeTeamId: 141, state, firstPitch: '2026-09-15T22:40:00Z' }] } } }) as never;

const detail = (rows: PropOddsRow[], extra: Partial<Parameters<typeof toPlayerDetailData>[0]> = {}) =>
  toPlayerDetailData({
    candidates: [candidate()],
    snapshot: snapshot(),
    odds: null,
    scope: { lineOffset: 0, opponentOnly: false, venue: 'all', lastN: 'all' },
    propOdds: { rows, userSportsbook: 'fanatics' },
    ...extra,
  })!;

test('the MLB prop block opens on the main line, not the board line, and the model names its own line', () => {
  const d = detail([...twoSided('fanduel', 6.5, -115, -105), ...twoSided('draftkings', 6.5, -110, -110), ...twoSided('fanduel', 4.5, -300, 220)]);
  assert.ok(d.lineControl?.kind === 'stepper');
  assert.equal(d.lineControl.baseLine, 6.5, 'the line books posted, measured the same way every other sport is');
  assert.equal(d.lineControl.line, 6.5);
  assert.deepEqual(d.lineControl.model, { prob: 0.61, line: 4.5 }, 'the model probability keeps the board line it was computed at');
  assert.equal(d.priceCandidate?.line, 6.5);
  assert.equal((d.priceCandidate?.subjectMeta as Record<string, unknown>).modelProb, undefined, 'a board-line probability must not travel with a main-line bet');
  assert.equal(d.propOddsBoard?.line, 6.5);
  // Hit rates are measured against the line on screen: of 5, 7, 8, 6, 9 only
  // 7, 8 and 9 clear 6.5 (all five cleared the board line's 4.5).
  assert.deepEqual(d.windows?.l5.status === 'ok' ? [d.windows.l5.hits, d.windows.l5.total] : null, [3, 5]);
  assert.equal(d.chart.kind === 'distribution' ? d.chart.line : null, 6.5);
});

test('when the main line is the board line nothing is re-priced, and alternates-only keeps the board line with the status', () => {
  const same = detail([...twoSided('fanduel', 4.5, -110, -110), ...twoSided('draftkings', 4.5, -105, -115)]);
  assert.equal(same.priceCandidate, null);
  assert.ok(same.lineControl?.kind === 'stepper' && same.lineControl.baseLine === 4.5 && same.lineControl.model?.line === 4.5);

  const alt = detail([row({ line: 4.5, side: 'over', americanOdds: 120 }), row({ line: 5.5, side: 'over', americanOdds: 200, bookmaker: 'draftkings' })]);
  assert.equal(alt.priceCandidate?.lineStatus, 'alternates-only');
  assert.equal(alt.priceCandidate?.odds, undefined);
  assert.ok(alt.lineControl?.kind === 'stepper' && alt.lineControl.baseLine === 4.5);

  const none = detail([]);
  assert.equal(none.priceCandidate, null);
  assert.ok(none.lineControl?.kind === 'stepper' && none.lineControl.baseLine === 4.5);
});

test('a snapshot line that has gone stale is re-priced at the current main line (Allen, 2026-09-15)', () => {
  // The rung the snapshot chose (249.5) is 40 minutes older than FanDuel's
  // newest quote, so it no longer counts; the current main line is 248.5.
  const stale = { fetchedAt: '2026-09-15T19:10:00Z' };
  const rows = [
    ...twoSided('fanduel', 249.5, -110, -110, { marketKey: 'passing-yards', ...stale }),
    ...twoSided('fanduel', 248.5, -114, -114, { marketKey: 'passing-yards' }),
  ];
  const nfl = { ...candidate(), sport: 'nfl', dimension: 'passing-yards', line: 249.5, subjectMeta: { modelProb: 0.5 } } as PickCandidate;
  const out = repriceAtMainLine(nfl, rows, '2026-09-18T00:15:00Z', NOW);
  assert.equal(out.marketLine, 248.5);
  assert.equal(out.priced?.line, 248.5);
  assert.equal(out.priced?.odds?.americanOdds, '-114');
  assert.equal((out.priced?.subjectMeta as Record<string, unknown>).modelProb, undefined);
  assert.deepEqual(repriceAtMainLine({ ...nfl, line: 248.5 }, rows, null, NOW), { marketLine: 248.5, priced: null });
});

// ---------------------------------------------------------------------------
// C4 — the game-state slot
// ---------------------------------------------------------------------------

const liveData = {
  inning: { number: 5, half: 'bottom', ordinal: '5th' },
  outs: 1,
  count: { balls: 2, strikes: 1 },
  score: { home: 3, away: 2 },
  bases: { first: true, second: false, third: true },
  batter: { id: 1, name: 'Bo Bichette', todayLine: '1-for-2' },
  currentPitcher: { id: 669373, name: 'Tarik Skubal', ip: '4.1', h: 4, r: 3, k: 7, pitches: 81 },
  player: { id: 669373, batting: { hits: 0, atBats: 0, runs: 0, rbi: 0, walks: 0, strikeOuts: 0 }, pitching: { inningsPitched: '4.1', hits: 4, runs: 3, earnedRuns: 3, walks: 1, strikeOuts: 7, pitches: 81 }, isCurrentBatter: false, isCurrentPitcher: true },
  liveValues: { 'pitcher-strikeouts': 7 },
  subjectPlays: [],
};

test('the game state is the live game, measured against the main line, with baseball as its own block', () => {
  const rows = [...twoSided('fanduel', 6.5, -115, -105), ...twoSided('draftkings', 6.5, -110, -110)];
  const d = detail(rows, { snapshot: snapshot('In Progress'), live: { data: liveData as never, loading: false, error: null } });
  const g = d.gameState!;
  assert.equal(g.status, 'live');
  assert.deepEqual([g.away.abbr, g.away.score, g.home.abbr, g.home.score, g.periodLabel], ['DET', 2, 'TOR', 3, 'Bot 5th']);
  assert.equal(g.subjectLine?.headline, '4.1 IP', "a pitcher's zeroed batting stub is not his line");
  assert.equal(g.subjectLine?.now, 'Pitching');
  const batting = detail(rows, { snapshot: snapshot('In Progress'), live: { data: { ...liveData, currentPitcher: { ...liveData.currentPitcher, id: 999, name: 'Other starter' } } as never, loading: false, error: null } });
  assert.equal(batting.gameState?.subjectLine?.now, null, 'his team is batting: someone else is on the mound');
  // The line carries what the card shows: the main line, the live value, whether
  // it has cleared, and the best price on that side at that line (R6.3).
  assert.deepEqual(g.lines, [
    {
      key: 'pitcher-strikeouts:over',
      label: 'Pitcher Strikeouts',
      direction: 'O',
      line: 6.5,
      value: 7,
      cleared: true,
      price: { americanOdds: -110, bookmaker: 'draftkings' },
    },
  ]);
  assert.deepEqual(g.events.map((e) => e.clock), [], 'this feed carries no plays');
  assert.equal(g.gameHref, '/mlb/game/776001');
  assert.deepEqual([g.baseball?.balls, g.baseball?.strikes, g.baseball?.outs, g.baseball?.bases.third], [2, 1, 1, true]);
});

test('an under is never marked as hit while the game is on, and the feed reads newest first', () => {
  const rows = [...twoSided('fanduel', 6.5, -115, -105), ...twoSided('draftkings', 6.5, -110, -110)];
  const under = candidate({ category: 'under', categoryLabel: 'Under' });
  const withPlays = {
    ...liveData,
    plays: [
      { inning: 4, half: 'top', battingSide: 'away', batter: 'Riley Greene', event: 'Single', description: 'singles', rbi: 0 },
      { inning: 5, half: 'bottom', battingSide: 'home', batter: 'Bo Bichette', event: 'Home Run', description: 'homers', rbi: 2 },
    ],
  };
  const d = toPlayerDetailData({
    candidates: [under],
    snapshot: snapshot('In Progress'),
    odds: null,
    scope: { lineOffset: 0, opponentOnly: false, venue: 'all', lastN: 'all' },
    propOdds: { rows, userSportsbook: 'fanatics' },
    live: { data: withPlays as never, loading: false, error: null },
  })!;
  const line = d.gameState!.lines[0];
  assert.equal(line.direction, 'U');
  assert.equal(line.cleared, false, '7 strikeouts is already past an under 6.5');
  assert.deepEqual(d.gameState!.events.map((e) => `${e.clock} ${e.text}`), ['B5 Bo Bichette home run', 'T4 Riley Greene single']);
});

test('no game state without a successful poll, after a failed one, or once the slate says final', () => {
  assert.equal(detail([], { live: { data: null, loading: false, error: 'HTTP 404' } }).gameState, null);
  // The slate lags StatsAPI ("Warmup" minutes into the game): a successful poll is the proof.
  assert.equal(detail([], { snapshot: snapshot('Warmup'), live: { data: liveData as never, loading: false, error: null } }).gameState?.status, 'live');
  assert.equal(detail([], { snapshot: snapshot('In Progress'), live: { data: liveData as never, loading: false, error: 'HTTP 404' } }).gameState, null);
  assert.equal(detail([], { snapshot: snapshot('Final'), live: { data: liveData as never, loading: false, error: null } }).gameState, null);
  assert.equal(detail([], { snapshot: snapshot('In Progress'), live: { data: null, loading: true, error: null } }).gameState?.status, 'loading');
});

// ---------------------------------------------------------------------------
// One line on the page, and no in-play price beside it
// ---------------------------------------------------------------------------

const PD = readFileSync('components/PlayerDetail.tsx', 'utf8');

test('the page prices, charts and slips the same candidate at the same line', () => {
  assert.match(PD, /const priced = data\.priceCandidate \?\? active;/);
  assert.match(PD, /resolveCandidateEdge\(priced,/);
  assert.match(PD, /onAdd\(priced, addOdds\)/);
  assert.match(PD, /data\?\.priceCandidate\?\.line \?\? active\?\.line \?\? null,\s*started \? startIso : null,/, 'line movement is pinned to the line on screen and cut at the start');
  assert.match(PD, /usePropOdds\(gamePkStr, snapshot\?\.fetchedAt, !sharedPropOdds, startIso\)/, 'a started game reads the rows that stood at the start');
});

test('the rail no longer carries the odds cards the section replaced, and the old MLB live block is gone', () => {
  for (const gone of [/Recorded price<\/h3>/, /Today&apos;s line/, /Live today/, /function LineTrackerRow/, /data\.liveGame/]) assert.doesNotMatch(PD, gone);
  assert.match(PD, /<Section id="odds" title="Odds & prices"/);
  assert.match(PD, /<GameStateCard state=\{data\.gameState\}/);
});

test('the lines route serves pre-game rows for a started game, and line history can stop at the start', () => {
  assert.match(readFileSync('app/api/props/lines/route.ts', 'utf8'), /readPreGamePropOddsForGame\(gameId, start\)/);
  const lh = readFileSync('lib/odds/props/lineHistory.ts', 'utf8');
  assert.equal((lh.match(/observed_at <= \?::timestamptz/g) ?? []).length, 2, 'both the line count and the series stop at the start');
});

test('an over hits once it passes the line; an under below its line has not hit yet (R6 audit)', async () => {
  const { liveLineHit } = await import('../lib/sports/shared/liveLine');
  assert.equal(liveLineHit('O', 7, 6.5), true);
  assert.equal(liveLineHit('O', 6, 6.5), false);
  // Three strikeouts in the fourth, under 6.5: still live, not won.
  assert.equal(liveLineHit('U', 3, 6.5), false);
  assert.equal(liveLineHit('U', 7, 6.5), false);
});

test('re-lining an under prices the under, not the over (R6 audit)', () => {
  const rows = [...twoSided('fanduel', 6.5, -125, 105), ...twoSided('draftkings', 6.5, -120, 100)];
  const under = candidate({ category: 'under', categoryLabel: 'Under', line: 4.5 });
  const { marketLine, priced } = repriceAtMainLine(under, rows, '2026-09-15T22:40:00Z', NOW);
  assert.equal(marketLine, 6.5);
  assert.equal(priced?.odds?.americanOdds, '105', 'the best UNDER price at 6.5, not the over');
  // An over re-lined at the same rows still gets the best over price.
  const over = repriceAtMainLine(candidate({ line: 4.5 }), rows, '2026-09-15T22:40:00Z', NOW);
  assert.equal(over.priced?.odds?.americanOdds, '-120');
});
