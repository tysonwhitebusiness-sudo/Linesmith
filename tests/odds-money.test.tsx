/**
 * Odds build P10 — "Where the money is" (`lib/odds/section/money.ts`,
 * `components/odds/MoneyCard.tsx`) on the approved mockup's own data: ATL @ GB
 * from `docs/design/odds-rebuild/om-data.js` (Sep 24). DraftKings customers
 * 83% of the moneyline bets and 68% of the money on GB; Circa's row present;
 * the split line at a 15-point gap and not at 14; the prop card's Sleeper
 * pick counts, Kalshi table and the standing "No data available" line.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MoneyCard } from '../components/odds/MoneyCard';
import { dkMoneyTrend, gameMoneyRows, moneySplit, propMoneyRows, slateMoneyGaps, type ExchangeObs, type MoneyPayload, type SplitObs } from '../lib/odds/section/money';
import type { SlateOddsGame } from '../lib/odds/section/slate';

type Row = [string, string, string, string | null, string | null, string | null, number | null, number | null, number | null, number | null, number | null, ...unknown[]];
const w: { OM?: { nfl: { splits: Row[]; splitHist: Record<string, [string, number | null, number | null, number | null][]>; propSplits: Row[];
  markets: Record<string, { cur: [string, string, number | null, number, string, string, number, string, Record<string, number> | null][] }> } } } = {};
new Function('window', 'self', readFileSync(join(process.cwd(), 'docs', 'design', 'odds-rebuild', 'om-data.js'), 'utf8'))(w, w);
const N = w.OM!.nfl;
const iso = (s: string) => s.replace(' ', 'T') + ':00.000Z';
const obs = (s: Row, market?: string): SplitObs => ({ at: iso(s[0]), source: s[1], kind: s[2], book: s[3], market: market ?? s[4] ?? 'game', side: s[5] ?? '',
  line: s[6], pctBets: s[7], pctMoney: s[8], count: s[9], countTotal: s[10] });
const exchanges: ExchangeObs[] = N.markets.fg_ml.cur.filter(c => (c[0] === 'kalshi' || c[0] === 'polymarket') && c[5] === c[0] && c[8])
  .map(c => ({ exchange: c[0], market: 'ml', side: c[1], point: null, bestBid: c[8]!.yes_bid ?? null, bestAsk: c[8]!.yes_ask ?? null,
    volume24h: c[8]!.volume_24h ?? null, openInterest: c[8]!.open_interest ?? null, liquidity: c[8]!.liquidity ?? null, at: iso(c[4]) }));
const GAME: MoneyPayload = {
  splits: N.splits.map(s => obs(s)),
  splitHist: Object.fromEntries(Object.entries(N.splitHist).map(([k, h]) => [k, h.map(p => [iso(p[0]), p[1], p[2], p[3]] as [string, number | null, number | null, number | null])])),
  exchanges,
};
const NOW = Date.parse('2026-09-24T17:20:00.000Z');

test('ATL @ GB moneyline: DraftKings customers 83% of the bets and 68% of the money on GB, from DK Network', () => {
  const rows = gameMoneyRows(GAME, 'ml', ['home', 'away']);
  const dk = rows.find(r => r.key === 'dknetwork|draftkings');
  assert.ok(dk && dk.kind === 'split');
  assert.deepEqual([dk.a.bets, dk.a.money, dk.b.bets, dk.b.money], [83, 68, 17, 32]);
  assert.equal(rows.some(r => r.key === 'vsin|draftkings'), false, "VSiN's DraftKings row is the fallback, not a second row");
  assert.deepEqual(rows.map(r => r.key), ['dknetwork|draftkings', 'vsin|circa', 'sao_consensus|scoresandodds', 'actionnetwork', 'exchanges']);
});

test('the Circa row is present, and Covers contest picks appear on the spread', () => {
  const ml = gameMoneyRows(GAME, 'ml', ['home', 'away']);
  const circa = ml.find(r => r.key === 'vsin|circa');
  assert.ok(circa && circa.kind === 'split' && circa.name === 'Circa customers');
  const sp = gameMoneyRows(GAME, 'sp', ['home', 'away']);
  const cov = sp.find(r => r.key === 'covers');
  assert.ok(cov && cov.kind === 'picks');
  assert.deepEqual([cov.a, cov.b, cov.picks], [66, 34, 1124]);
});

test('money and bets split at 15 points, not at 14', () => {
  const dk = gameMoneyRows(GAME, 'ml', ['home', 'away']).find(r => r.key === 'dknetwork|draftkings');
  assert.ok(dk && dk.kind === 'split');
  assert.deepEqual(dk.split, { side: 1, pts: 15 }, 'ATL draws 15 pts more of the money than of the bets');
  assert.equal(moneySplit({ bets: 83, money: 69 }), null);
  assert.deepEqual(moneySplit({ bets: 40, money: 55 }), { side: 0, pts: 15 });
  const html = renderToStaticMarkup(<MoneyCard money={GAME} view={{ kind: 'game', sport: 'nfl', marketKey: 'fg_ml', teams: { home: { abbr: 'GB' }, away: { abbr: 'ATL' } } }} now={NOW} />);
  assert.match(html, /Money and bets split:<\/span> ATL draws 15 pts more of the money than of the bets/);
  const fourteen: MoneyPayload = { ...GAME, splits: GAME.splits.map(s => (s.source === 'dknetwork' && s.market === 'ml' ? { ...s, pctMoney: s.side === 'home' ? 69 : 31 } : s)) };
  const h14 = renderToStaticMarkup(<MoneyCard money={fourteen} view={{ kind: 'game', sport: 'nfl', marketKey: 'fg_ml', teams: { home: { abbr: 'GB' }, away: { abbr: 'ATL' } } }} now={NOW} />);
  assert.equal((h14.match(/data-split/g) ?? []).length, (html.match(/data-split/g) ?? []).length - 1, 'the DK row loses its split line at 14 points');
});

test('the game card: every row named, the exchanges as traded volume, the DK money trend, and period tabs honest', () => {
  const html = renderToStaticMarkup(<MoneyCard money={GAME} view={{ kind: 'game', sport: 'nfl', marketKey: 'fg_ml', teams: { home: { abbr: 'GB' }, away: { abbr: 'ATL' } } }} now={NOW} />);
  for (const s of ['DraftKings customers', 'Circa customers', 'ScoresAndOdds consensus', 'source does not say whose bets', 'Action Network',
    '96,910 tracked bets on this game (all markets), not split by side', 'traded, not bets', 'Kalshi moneyline', 'open interest']) assert.ok(html.includes(s), s);
  assert.match(html, /DraftKings money on GB: 79% \(.*\) → <b[^>]*>68%<\/b> now/);
  assert.deepEqual(dkMoneyTrend(GAME, 'ml')?.points.length, 7);
  const period = renderToStaticMarkup(<MoneyCard money={GAME} view={{ kind: 'game', sport: 'nfl', marketKey: '1h_sp', teams: { home: { abbr: 'GB' }, away: { abbr: 'ATL' } } }} now={NOW} />);
  assert.match(period, /No splits source publishes period or team-total splits\. Full-game spread, total and moneyline have them\./);
});

test('props: Sleeper pick counts bar, Kalshi table, and "No data available" for money and bet share', () => {
  const P: MoneyPayload = {
    splits: N.propSplits.filter(s => s[4] === 'receptions').map(s => obs(s, 'receptions')),
    splitHist: {},
    exchanges: [
      { exchange: 'kalshi', market: 'receptions', side: 'over', point: 4.5, bestBid: 0.61, bestAsk: 0.63, volume24h: 1840, openInterest: 5200, liquidity: null, at: iso('2026-09-24 17:14') },
      { exchange: 'kalshi', market: 'receptions', side: 'over', point: 5.5, bestBid: 0.44, bestAsk: 0.46, volume24h: 2210, openInterest: 6400, liquidity: null, at: iso('2026-09-24 17:14') },
    ],
  };
  const line = P.splits[0].line;
  const pm = propMoneyRows(P, 'receptions', line);
  assert.ok(pm.sleeper, 'Sleeper pick counts at the line in view');
  assert.equal(pm.sleeper!.over + pm.sleeper!.under, P.splits.reduce((a, s) => a + (s.count ?? 0), 0));
  assert.deepEqual(pm.kalshi.map(k => k.contract), ['5+', '6+']);
  const html = renderToStaticMarkup(<MoneyCard money={P} view={{ kind: 'prop', marketKey: 'receptions', line }} now={NOW} />);
  assert.match(html, new RegExp(`Sleeper pick counts at ${line}`));
  assert.match(html, /counts, not money/);
  assert.match(html, /Kalshi contracts/);
  assert.match(html, /61–63¢/);
  assert.match(html, /No data available\.<\/b> No source publishes money or bet share for player props\./);
  // No Sleeper line at a line nobody picks, and the fact still stands.
  const off = renderToStaticMarkup(<MoneyCard money={P} view={{ kind: 'prop', marketKey: 'receptions', line: 99.5 }} now={NOW} />);
  assert.match(off, /Sleeper pick counts: no data available/);
  assert.match(off, /No data available\./);
});

test("a Kalshi contract the bridge labels 'under' is read as its yes price, never inverted (Henry's rushing ladder, 2026-09-25)", () => {
  const e = (side: string, point: number, bid: number, ask: number): ExchangeObs =>
    ({ exchange: 'kalshi', market: 'rushing-yards', side, point, bestBid: bid, bestAsk: ask, volume24h: 1, openInterest: 1, liquidity: null, at: iso('2026-09-25 18:00') });
  const pm = propMoneyRows({ splits: [], splitHist: {}, exchanges: [e('over', 49.5, 0.84, 0.86), e('under', 59.5, 0.77, 0.78), e('over', 69.5, 0.68, 0.69)] }, 'rushing-yards', 90.5);
  assert.deepEqual(pm.kalshi.map(k => [k.contract, k.bid, k.ask]), [['50+', 0.84, 0.86], ['60+', 0.77, 0.78], ['70+', 0.68, 0.69]]);
});

test('the Slate hub sorts by the DraftKings money/bets gap and flags 15+', () => {
  const g = (id: string, money: number, bets: number) => ({ gameId: id, dk: { money, bets } }) as unknown as SlateOddsGame;
  const out = slateMoneyGaps([g('a', 55, 50), g('b', 30, 50), g('c', 64, 50), { gameId: 'd', dk: null } as unknown as SlateOddsGame]);
  assert.deepEqual(out.map(r => [r.gameId, r.gap, r.split]), [['b', -20, true], ['c', 14, false], ['a', 5, false]]);
});
