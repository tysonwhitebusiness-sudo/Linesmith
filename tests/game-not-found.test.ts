import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clearEspnSummaryCache, fetchEspnSummaryStrict } from '../lib/sports/espn/summary';

/**
 * R12d — a game page says "not found" only when the source says the game does
 * not exist; a source that did not answer is "couldn't load" (R11-F3). Each
 * reader's null means "no such game", and a failed fetch throws, which the
 * cached route turns into its error ("Couldn't load this game's page").
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  clearEspnSummaryCache();
});

/** A fetch that answers with each status in turn (0 = network failure). */
function fetchSequence(statuses: number[]) {
  let i = 0;
  globalThis.fetch = (async () => {
    const status = statuses[Math.min(i++, statuses.length - 1)];
    if (status === 0) throw new Error('network down');
    return new Response(status === 200 ? JSON.stringify({ header: { competitions: [{}] } }) : 'x', { status });
  }) as typeof fetch;
  return () => i;
}

test('ESPN: its own 404 is "no such game"', async () => {
  fetchSequence([404, 404]);
  assert.equal(await fetchEspnSummaryStrict('football/nfl', '999999999'), null);
});

test('ESPN: a timeout, then a failed probe, throws — "couldn\'t load", not "not found"', async () => {
  fetchSequence([0, 503]);
  await assert.rejects(fetchEspnSummaryStrict('basketball/nba', '401811052'), /ESPN summary unavailable/);
});

test('ESPN: a failure that recovers on the probe is used, not thrown', async () => {
  const calls = fetchSequence([500, 200]);
  const json = await fetchEspnSummaryStrict<{ header: unknown }>('soccer/eng.1', '401879283');
  assert.ok(json?.header);
  assert.equal(calls(), 2);
});

test('MLB: a failed live feed throws; an answer with no game in it is "not found"', async () => {
  const { readMlbGameResearch } = await import('../lib/sports/mlb/gameResearch');
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  await assert.rejects(readMlbGameResearch(823902), /MLB live feed unavailable/);
  // StatsAPI answers 200 for a game that does not exist, with no game data.
  globalThis.fetch = (async () => new Response(JSON.stringify({ gameData: {}, liveData: {} }), { status: 200 })) as typeof fetch;
  assert.equal(await readMlbGameResearch(999999999), null);
  // The real placeholder (measured): pk 0 and zero team ids, which DOES carry a teams object.
  const placeholder = { gamePk: 999999999, gameData: { game: { pk: 0 }, teams: { away: { id: 0 }, home: { id: 0 } }, status: { abstractGameState: 'Other', detailedState: 'Unknown' } }, liveData: {} };
  globalThis.fetch = (async () => new Response(JSON.stringify(placeholder), { status: 200 })) as typeof fetch;
  assert.equal(await readMlbGameResearch(999999999), null);
});

test('the three ESPN readers use the strict fetch; tennis throws when no scoreboard answered', () => {
  for (const f of ['lib/sports/nba/gameResearch.ts', 'lib/sports/multiSport/footballGameResearch.ts', 'lib/sports/soccer/gameResearch.ts']) {
    assert.match(readFileSync(f, 'utf8'), /const summary: J = await fetchEspnSummaryStrict\(/, `${f} reads its game with the lenient fetch again`);
  }
  const tennis = readFileSync('lib/sports/tennis/gameResearch.ts', 'utf8');
  assert.match(tennis, /if \(!value && answered === 0\) throw/, 'tennis reads "no scoreboard answered" as "not found" again');
  assert.match(tennis, /findCompetition\(tourOf\(sport\), matchId\)\.catch\(\(\) => null\)/, 'the route\'s state lookup must not throw');
  assert.match(readFileSync('lib/sports/nhl/gameResearch.ts', 'utf8'), /if \(probe\?\.status === 404\) return null;/, 'NHL (R11) keeps its probe');
});

test('the route: an outage during the state lookup is 502 ("couldn\'t load"), the source\'s own 404 stays 404', async () => {
  // The state lookups use lenient fetches; the route used to answer their null
  // with 404 before the strict reader ever ran (found checking R12d).
  const { GET } = await import('../app/api/game-research/route');
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  const down = await GET(new Request('http://localhost/api/game-research?sport=nfl&gameId=401772890'));
  assert.equal(down.status, 502);
  clearEspnSummaryCache();
  globalThis.fetch = (async () => new Response('not found', { status: 404 })) as typeof fetch;
  const missing = await GET(new Request('http://localhost/api/game-research?sport=nba&gameId=999999999'));
  assert.equal(missing.status, 404);
});
