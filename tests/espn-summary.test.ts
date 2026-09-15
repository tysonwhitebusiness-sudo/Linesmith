import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearEspnSummaryCache, fetchEspnSummary } from '../lib/sports/espn/summary';

/**
 * R4 step 1 — one ESPN summary fetch shared by every parser. Before R4 eight
 * modules fetched the same document separately; R4 parses far more of it, so
 * the caching rules are what keep that from multiplying requests.
 */

const summary = (completed: boolean) => ({ header: { competitions: [{ status: { type: { completed } } }] } });

let calls = 0;
function mockFetch(body: unknown, ok = true, delayMs = 0) {
  calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return { ok, json: async () => body } as Response;
  }) as typeof fetch;
}

beforeEach(() => clearEspnSummaryCache());

test('parsers running at once share one request', async () => {
  mockFetch(summary(false), true, 20);
  const results = await Promise.all([1, 2, 3].map(() => fetchEspnSummary('football/nfl', '401')));
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r !== null));
});

test('a final game is reused for 10 minutes; an open game for 5 seconds', async () => {
  let t = 0;
  const now = () => t;
  mockFetch(summary(true));
  await fetchEspnSummary('football/nfl', 'final', now);
  t = 9 * 60_000;
  await fetchEspnSummary('football/nfl', 'final', now);
  assert.equal(calls, 1, 'final game served from memory inside 10 minutes');

  mockFetch(summary(false));
  t = 0;
  await fetchEspnSummary('football/nfl', 'live', now);
  t = 4_000;
  await fetchEspnSummary('football/nfl', 'live', now);
  assert.equal(calls, 1, 'open game reused within 5 seconds');
  t = 6_000;
  await fetchEspnSummary('football/nfl', 'live', now);
  assert.equal(calls, 2, 'open game refetched after 5 seconds — live play-by-play must not go stale');
});

test('a failure returns null and is never cached', async () => {
  mockFetch({}, false);
  assert.equal(await fetchEspnSummary('basketball/nba', 'x'), null);
  mockFetch(summary(true));
  assert.notEqual(await fetchEspnSummary('basketball/nba', 'x'), null, 'the next call fetches again');
});

test('different leagues with the same event id do not collide', async () => {
  mockFetch(summary(true));
  await fetchEspnSummary('soccer/eng.1', '7');
  await fetchEspnSummary('soccer/usa.1', '7');
  assert.equal(calls, 2);
});
