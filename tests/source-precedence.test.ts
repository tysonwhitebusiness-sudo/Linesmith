import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFirstHand, preferQuote } from '../lib/odds/sourcePrecedence';

/**
 * P5, audit finding F6: which copy of a book's price a page believes. A relay
 * re-confirms a price every few seconds that can be hours old (plan D23), so a
 * later CHECK must never make a relayed copy win.
 */

const q = (providerId: string, bookmaker: string, fetchedAt: string, changedAt: string | null = null) => ({ providerId, bookmaker, fetchedAt, changedAt });

test('first-hand beats a relay even when the relay was checked later', () => {
  const own = q('scraper:draftkings', 'draftkings', '2026-09-25T10:00:00Z', '2026-09-25T10:00:00Z');
  const relay = q('scraper:comparenbet', 'draftkings', '2026-09-25T10:05:00Z', '2026-09-25T10:04:00Z');
  assert.equal(preferQuote(own, relay), own);
  assert.equal(preferQuote(relay, own), own);
});

test('two relays: the later change wins, not the later check', () => {
  const a = q('scraper:comparenbet', 'bet365', '2026-09-25T10:10:00Z', '2026-09-25T01:00:00Z');
  const b = q('scraper:oddsjam', 'bet365', '2026-09-25T10:00:00Z', '2026-09-25T09:30:00Z');
  assert.equal(preferQuote(a, b), b);
  assert.equal(preferQuote(b, a), b);
});

test('rows written before P5 (no changedAt) fall back to fetchedAt', () => {
  const a = q('propline', 'fanduel', '2026-09-25T10:00:00Z');
  const b = q('sharpapi', 'fanduel', '2026-09-25T10:20:00Z');
  assert.equal(preferQuote(a, b), b);
  assert.equal(preferQuote(b, a), b);
});

test('equal on every rule keeps the first', () => {
  const a = q('propline', 'fanduel', '2026-09-25T10:00:00Z');
  const b = q('sharpapi', 'fanduel', '2026-09-25T10:00:00Z');
  assert.equal(preferQuote(a, b), a);
});

test('pg Date objects compare like ISO strings', () => {
  const a = { providerId: 'x', bookmaker: 'fanduel', fetchedAt: new Date('2026-09-25T10:00:00Z'), changedAt: null };
  const b = { providerId: 'y', bookmaker: 'fanduel', fetchedAt: new Date('2026-09-25T10:00:01Z'), changedAt: null };
  assert.equal(preferQuote(a, b), b);
});

test('isFirstHand: the book must be the one the source IS', () => {
  assert.ok(isFirstHand('scraper:vsin', 'Circa'));
  assert.ok(!isFirstHand('scraper:vsin', 'draftkings'));
  assert.ok(!isFirstHand('scraper:comparenbet', 'draftkings'));
  assert.ok(!isFirstHand('propline', 'draftkings'));
});
