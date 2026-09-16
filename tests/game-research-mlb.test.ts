import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mainGameLine, type GameQuote } from '../lib/odds/gameLineHistory';
import { mlbMarketResult, parseMlbBox } from '../lib/sports/mlb/liveFeedParsers';
import { mlbGameState } from '../lib/sports/mlb/gameResearch';
import { gameStates, resolveState } from '../lib/sports/shared/gameResearch';
import { mlbLineChips } from '../lib/sports/mlb/adapters/gameDetailAdapter';
import type { MlbGameResearchPayload } from '../lib/sports/mlb/gameResearch';

/**
 * R8.1 — MLB's game page. The payload was refereed against the G2 fixture
 * (KC @ BOS, pk 824711: 77 plate appearances, 289 pitches, 77 win-probability
 * points, every pitching line, 3-2 with 10/8 hits and 10/8 left on base); these
 * tests hold the rules behind it.
 */

const q = (bookmaker: string, side: string, point: number | null, americanOdds: number, observedAt = '2026-09-16T16:00:00Z', market = 'total'): GameQuote => ({ market, side, bookmaker, point, americanOdds, observedAt });

test('a total closes at the line nearest even, not the alternate the most books carry (SF @ STL, 823004)', () => {
  const books8 = ['betmgm', 'betonline', 'betus', 'bovada', 'draftkings', 'lowvig', 'mybookie', 'betrivers'];
  const books95 = ['fanatics', 'fliff', 'hardrockbet', 'kalshi', 'marathon', 'matchbook', 'novig', 'pinnacle', 'polymarket', 'prophetx', 'smarkets', 'rebet', 'bovada'];
  const quotes = [
    ...books8.flatMap((b) => [q(b, 'over', 8, -115), q(b, 'under', 8, -105)]),
    ...books95.flatMap((b) => [q(b, 'over', 9.5, 160), q(b, 'under', 9.5, -190)]),
    // DraftKings' 8.5 from the early morning, superseded by its 8.
    q('draftkings', 'over', 8.5, 105, '2026-09-16T05:39:00Z'),
    q('draftkings', 'under', 8.5, -135, '2026-09-16T05:39:00Z'),
  ];
  const main = mainGameLine('total', quotes, { dropSuperseded: true });
  assert.ok(main);
  assert.deepEqual(main.sides.map((s) => [s.side, s.point, s.americanOdds]), [['over', 8, -115], ['under', 8, -105]]);
  assert.equal(main.books, 8);
});

test('between two near-even totals the one most books quote wins (KC @ BOS, 824711)', () => {
  const books85 = Array.from({ length: 11 }, (_, i) => `book${i}`);
  const quotes = [...books85.flatMap((b) => [q(b, 'over', 8.5, -105), q(b, 'under', 8.5, -115)]), q('a', 'over', 8, -125), q('a', 'under', 8, -115), q('b', 'over', 8, -125), q('b', 'under', 8, -115)];
  const main = mainGameLine('total', quotes, { dropSuperseded: true });
  assert.equal(main?.sides[0].point, 8.5);
  assert.equal(main?.books, 11);
});

test('a run line is the one most books quote, whatever its price (824382 opened with two books at +-1)', () => {
  const quotes = [
    ...['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'].flatMap((b) => [q(b, 'away', 1.5, -160, undefined, 'spread'), q(b, 'home', -1.5, 140, undefined, 'spread')]),
    q('x', 'away', 1, -103, undefined, 'spread'),
    q('x', 'home', -1, -120, undefined, 'spread'),
    q('y', 'away', 1, -103, undefined, 'spread'),
    q('y', 'home', -1, -120, undefined, 'spread'),
  ];
  const main = mainGameLine('spread', quotes, { dropSuperseded: false });
  assert.deepEqual(main?.sides.map((s) => s.point), [1.5, -1.5], 'the sides keep their own signs');
  assert.equal(main?.books, 9);
});

test('the box parser and prop results read the saved KC @ BOS feed', () => {
  const feed = JSON.parse(readFileSync('tests/fixtures/mlb-box-824711.json', 'utf8')); // box score and line score only, trimmed from the live feed on 2026-09-16
  const away = parseMlbBox(feed, 'away');
  const home = parseMlbBox(feed, 'home');
  assert.deepEqual(away.totals, { r: 3, h: 10, e: 0, lob: 10 });
  assert.deepEqual(home.totals, { r: 2, h: 8, e: 0, lob: 8 });
  assert.deepEqual(away.pitching.map((p) => [p.name, p.s.ip, p.s.k]), [['Seth Lugo', '5.0', 7], ['Nolan Hoffman', '1.0', 1], ['Connor Thomas', '1.0', 0], ['Nate Pearson', '1.0', 1], ['Steven Cruz', '1.0', 1]]);
  const jensen = away.batting.find((b) => b.name === 'Carter Jensen')!;
  assert.equal(jensen.order, 1);
  assert.equal(mlbMarketResult('total-bases', jensen, undefined), 4, 'two doubles');
  assert.equal(mlbMarketResult('doubles', jensen, undefined), 2);
  assert.equal(mlbMarketResult('singles', jensen, undefined), 0);
  assert.equal(mlbMarketResult('hits-runs-rbis', jensen, undefined), 2 + 2 + 1);
  const lugo = away.pitching[0];
  assert.equal(mlbMarketResult('pitcher-outs', undefined, lugo), 15);
  assert.equal(mlbMarketResult('pitcher-strikeouts', jensen, undefined), null, 'a batter has no pitcher market');
  assert.ok(away.batting.some((b) => b.sub), 'a substitute is marked');
});

test('state comes from the real status, and a review override only reaches a state the game can show', () => {
  assert.equal(mlbGameState('Final', 'Final'), 'final');
  assert.equal(mlbGameState('Live', 'In Progress'), 'live');
  assert.equal(mlbGameState('Preview', 'Scheduled'), 'pre');
  assert.equal(mlbGameState('Preview', 'Postponed'), 'postponed');
  assert.deepEqual(gameStates('final'), ['pre', 'final']);
  assert.equal(resolveState({ state: 'final' }, 'pre'), 'pre');
  assert.equal(resolveState({ state: 'pre' }, 'final'), 'pre', 'a game that has not started cannot show a recap');
  assert.equal(resolveState({ state: 'live' }, 'final'), 'live');
});

test('result chips say what the final did against the closing lines', () => {
  const payload = {
    away: { abbr: 'KC', score: 3 },
    home: { abbr: 'BOS', score: 2 },
    mlb: {
      lines: [
        { market: 'moneyline', open: null, close: { books: 18, sides: [{ side: 'away', point: null, americanOdds: 170 }, { side: 'home', point: null, americanOdds: -196 }] } },
        { market: 'spread', open: null, close: { books: 10, sides: [{ side: 'away', point: 1.5, americanOdds: -118 }, { side: 'home', point: -1.5, americanOdds: -102 }] } },
        { market: 'total', open: null, close: { books: 12, sides: [{ side: 'over', point: 8.5, americanOdds: -105 }, { side: 'under', point: 8.5, americanOdds: -115 }] } },
      ],
    },
  } as unknown as MlbGameResearchPayload;
  assert.deepEqual(mlbLineChips(payload, 'final').map((c) => c.label), ['ML KC +170 · BOS -196', 'KC +1.5 covered', 'Total 8.5 · under (5)']);
  assert.deepEqual(mlbLineChips(payload, 'pre').map((c) => c.label), ['ML KC +170 · BOS -196', 'KC +1.5', 'Total 8.5']);
});
