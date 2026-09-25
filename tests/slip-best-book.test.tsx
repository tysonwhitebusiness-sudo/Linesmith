/**
 * P12 §2 — a slip leg shows the best book right now and how far the reader's
 * book is behind it; "Open at {book}" appears only with a stored book link.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlipLegPrice } from '../components/odds/SlipLegPrice';
import { bookLinkFor, slipBest } from '../lib/odds/slipBest';
import type { OddsMarket, OddsQuote } from '../lib/odds/section/types';

const NOW = Date.parse('2026-09-27T16:00:00Z');
const q = (book: string, side: string, line: number, price: number): OddsQuote =>
  ({ book, side, line, price, since: '2026-09-27T15:00:00Z', checkedAt: '2026-09-27T15:59:20Z', source: `scraper:${book}`, main: true });
const market: OddsMarket = {
  key: 'receptions', hist: {}, open: {},
  cur: [q('draftkings', 'over', 5.5, -104), q('fanatics', 'over', 5.5, -115), q('fanduel', 'over', 5.5, -110),
    q('underdog', 'over', 5.5, 120), q('betmgm', 'over', 6.5, 130), q('draftkings', 'under', 5.5, -118)],
};

test('the best book at the leg line and side, and the cents the reader\'s book is behind', () => {
  const c = slipBest(market, 'over', 5.5, 'fanatics');
  assert.equal(c.best?.book, 'draftkings');          // not Underdog (pick'em) and not BetMGM (another line)
  assert.equal(c.mine?.book, 'fanatics');
  assert.equal(c.centsWorse, 9);                      // 1.962 - 1.870
  assert.equal(slipBest(market, 'over', 5.5, 'draftkings').centsWorse, null);  // your book is the best
  assert.equal(slipBest(market, 'over', 7.5, 'fanatics').best, null);
});

test('the leg renders the best price, the check age and the difference', () => {
  const html = renderToStaticMarkup(createElement(SlipLegPrice, {
    check: slipBest(market, 'over', 5.5, 'fanatics'), link: 'https://sportsbook.draftkings.com/event/1', now: NOW,
  }));
  assert.match(html, /Best right now: <b[^>]*>-104<\/b>/);
  assert.match(html, /DraftKings/);
  assert.match(html, /checked 40 s ago/);
  assert.match(html, /your Fanatics is 9¢ worse/);
  assert.match(html, /Open at DraftKings/);
  assert.match(html, /href="https:\/\/sportsbook\.draftkings\.com\/event\/1"/);
});

test('no book link, no button — and never a guessed URL', () => {
  const check = slipBest(market, 'over', 5.5, 'fanatics');
  const html = renderToStaticMarkup(createElement(SlipLegPrice, { check, link: bookLinkFor({}, check.best?.book), now: NOW }));
  assert.doesNotMatch(html, /Open at/);
  assert.equal(bookLinkFor({ draftkings: 'javascript:alert(1)' }, 'draftkings'), null);
  assert.equal(bookLinkFor({ draftkings: 'https://x.test/e' }, 'draftkings'), 'https://x.test/e');
  assert.equal(bookLinkFor({ draftkings: 'https://x.test/e' }, 'fanduel'), null);
});

test('an outlier (D19) is never the best — the Best price card\'s rule', () => {
  const m: OddsMarket = { ...market, cur: [...market.cur, q('betmgm', 'over', 5.5, -108), q('caesars', 'over', 5.5, -112), q('bet365', 'over', 5.5, 900)] };
  assert.equal(slipBest(m, 'over', 5.5, 'fanatics').best?.book, 'draftkings');
});
