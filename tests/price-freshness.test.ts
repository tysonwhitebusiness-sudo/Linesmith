import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIMITS } from '../proxy';
import { STALE_AFTER_MS, coverageLine, priceCoverage, relativeAge } from '../lib/odds/priceFreshness';

/**
 * Phase 6.17 — price freshness, visible.
 *
 * THE MACHINERY ALREADY EXISTED AND NOTHING REACHED IT. `OddsChip` has carried
 * a `priceAge` helper and a 30-minute stale threshold since before this task,
 * and the price board never passed it a `capturedAt` — so every relative
 * timestamp and every stale marker on the grid was dead code. That is the
 * dead-consumer shape this repo keeps hitting, in the producer direction.
 */

const T = Date.parse('2026-08-30T12:00:00.000Z');
const mins = (n: number) => new Date(T - n * 60_000).toISOString();

test('staleness is per BOOK, not per row', () => {
  // A book quoting both sides has two rows and ONE freshness. Counting rows
  // would report a two-sided book as twice as stale as a one-sided one, which
  // describes how many prices it posts rather than how current it is.
  const c = priceCoverage(
    [
      { bookmaker: 'fanduel', fetchedAt: mins(90) },
      { bookmaker: 'fanduel', fetchedAt: mins(90) },
      { bookmaker: 'draftkings', fetchedAt: mins(2) },
    ],
    T,
  );
  assert.equal(c.books, 2);
  assert.equal(c.stale, 1, 'fanduel is one stale book, not two stale rows');
});

test("a book's newest price is what counts, regardless of row order", () => {
  // A book that quoted an hour ago and again a minute ago is current.
  const ascending = priceCoverage(
    [
      { bookmaker: 'fanduel', fetchedAt: mins(90) },
      { bookmaker: 'fanduel', fetchedAt: mins(1) },
    ],
    T,
  );
  assert.equal(ascending.stale, 0);
  assert.equal(ascending.newestAt, mins(1));

  // ROW ORDER IS NOT GUARANTEED, and this is the case that discriminates: with
  // the fresh row FIRST, a "last row wins" implementation reports the book as
  // stale. The version above passes either way, which is why it is not enough
  // on its own — found by fault injection, not by reading the code.
  const descending = priceCoverage(
    [
      { bookmaker: 'fanduel', fetchedAt: mins(1) },
      { bookmaker: 'fanduel', fetchedAt: mins(90) },
    ],
    T,
  );
  assert.equal(descending.stale, 0, 'a live book must not be marked stale by row ordering');
  assert.equal(descending.newestAt, mins(1));
  assert.equal(descending.oldestAt, mins(1), 'one book has one freshness — its newest');
});

test('the threshold is a real boundary in both directions', () => {
  const just = priceCoverage([{ bookmaker: 'a', fetchedAt: new Date(T - STALE_AFTER_MS + 1000).toISOString() }], T);
  const past = priceCoverage([{ bookmaker: 'a', fetchedAt: new Date(T - STALE_AFTER_MS - 1000).toISOString() }], T);
  assert.equal(just.stale, 0);
  assert.equal(past.stale, 1);
});

test('unparseable timestamps are unmeasured, never counted as fresh', () => {
  const c = priceCoverage([{ bookmaker: 'a', fetchedAt: 'not a date' }], T);
  assert.equal(c.newestAt, null);
  assert.equal(c.stale, 0, 'an unreadable timestamp is not evidence of freshness');
  // ...and the line is suppressed entirely rather than claiming the prices were
  // checked. A coverage line that cannot say how old the prices are implies it.
  assert.equal(coverageLine(c, T), null);
});

test('a future timestamp is a clock problem, not a fresh price', () => {
  // "just now" would hide it. Returning null lets the absence be noticed.
  assert.equal(relativeAge(new Date(T + 60_000).toISOString(), T), null);
});

test('the wording is the sentence a reader needs', () => {
  const c = priceCoverage(
    [
      { bookmaker: 'a', fetchedAt: mins(3) },
      { bookmaker: 'b', fetchedAt: mins(3) },
      { bookmaker: 'c', fetchedAt: mins(120) },
    ],
    T,
  );
  assert.equal(coverageLine(c, T), '3 books · updated 3m ago · 1 stale');
  // No stale books, no stale clause — a count that is always present and
  // usually zero stops being read.
  const fresh = priceCoverage([{ bookmaker: 'a', fetchedAt: mins(1) }], T);
  assert.equal(coverageLine(fresh, T), '1 book · updated 1m ago');
});

test('relative ages read naturally at every scale', () => {
  assert.equal(relativeAge(mins(0), T), 'just now');
  assert.equal(relativeAge(mins(45), T), '45m ago');
  assert.equal(relativeAge(mins(60 * 5), T), '5h ago');
  assert.equal(relativeAge(mins(60 * 24 * 3), T), '3d ago');
});

test('the board actually passes a capture time to every chip', () => {
  // The whole defect was a working helper nothing reached. A test on the helper
  // alone would have passed throughout.
  const src = readFileSync('components/PropOddsPanel.tsx', 'utf8');
  const chips = src.match(/<OddsChip[\s\S]*?\/>/g) ?? [];
  assert.ok(chips.length >= 5, `expected the board's chips, found ${chips.length}`);
  for (const chip of chips) {
    assert.match(chip, /capturedAt=/, `an OddsChip on the board renders no age:\n${chip}`);
  }
});

test('OddsChip does not redeclare the threshold', () => {
  // Two copies drift, and then a chip shows a stale marker while the coverage
  // line above it reports everything fresh.
  const src = readFileSync('components/OddsChip.tsx', 'utf8');
  assert.match(src, /from '@\/lib\/odds\/priceFreshness'/, 'OddsChip must import the shared threshold');
  assert.ok(
    !/const STALE_AFTER_MS\s*=/.test(src),
    'OddsChip declares its own STALE_AFTER_MS again — that is how two numbers on one screen disagree',
  );
});

test('page-load reads are not rate-limited as if they hit a vendor', () => {
  // 6.16's line-history is fetched on EVERY player page view, alongside
  // `lines`, `calibration` and `user-sportsbook`. Four calls against the
  // 10-per-minute "provider" budget meant roughly two page views a minute
  // before 429s — which is exactly what happened the first time the movement
  // chart was opened in a browser.
  //
  // These reach no vendor and run no model: they are indexed Postgres reads on
  // tables the Python worker keeps fresh.
  const proxy = readFileSync('proxy.ts', 'utf8');
  const pageRead = proxy.match(/\{[^}]*label: 'page-read'[^}]*\}/);
  assert.ok(pageRead, "proxy.ts has no 'page-read' rate-limit class");
  assert.match(pageRead[0], /line-history/, 'line-history must be in the page-read class');
  assert.match(pageRead[0], /limit: 60/, 'a page-load read needs the default budget, not the provider one');

  // Order matters: the provider rule also matches `/api/props/`, so a
  // page-read rule declared after it would never fire.
  assert.ok(
    proxy.indexOf("label: 'page-read'") < proxy.indexOf("label: 'provider'"),
    'the page-read class must be tested BEFORE the provider class or it is dead',
  );
});

test('every route a page load fires is classed page-read, not provider', () => {
  // THE PREVIOUS VERSION OF THIS TEST ONLY CHECKED `line-history` WAS PRESENT,
  // and the rule shipped with four more routes missing. Measured 2026-08-30 by
  // opening one MLB game page: `odds/lines`, `odds/game-line`,
  // `props/user-sportsbook` and `props/calibration` all returned 429 on a
  // single load, and the blocks depending on them rendered without their data.
  //
  // The comment above that rule already NAMED calibration and user-sportsbook
  // as page-load reads. The predicate matched neither. A guard whose prose is
  // right and whose code is incomplete passes every test that reads the prose.
  //
  // This classifies through the REAL exported rules rather than regexing the
  // file, so a path added to the comment but not the predicate still fails.
  const classify = (path: string) => LIMITS.find((r) => r.test(path))?.label;

  const pageLoadReads = [
    '/api/props/line-history?gameId=1&subjectId=2',
    '/api/props/lines?sport=mlb',
    '/api/props/user-sportsbook',
    '/api/props/calibration?sport=mlb',
    '/api/odds/lines?sport=mlb',
    '/api/odds/game-line?sport=mlb&gameId=1',
  ];
  for (const path of pageLoadReads) {
    assert.equal(classify(path), 'page-read', `${path} is fetched on page load and must not sit in the provider budget`);
  }

  // The provider class must still exist and still catch things that DO reach a
  // vendor — widening page-read must not have swallowed everything.
  assert.equal(classify('/api/props/scan-player'), 'provider');
  assert.equal(classify('/api/diagnostics/anything'), 'provider');
  assert.equal(classify('/api/props/fit-weights'), 'fit/backfill');
});
