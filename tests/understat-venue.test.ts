import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveMatchVenue as resolve } from '../lib/sports/soccer/understat';

/**
 * `understat.ts`'s home/away resolution — the defect and its fix.
 *
 * `/getPlayerData/{id}` returns a player's WHOLE CAREER across every club. The
 * old code asked `m.h_team === understatTeamTitle`, comparing every historical
 * fixture against the player's CURRENT club, so every match before their latest
 * transfer recorded as away and `opponent` resolved to the player's own former
 * club.
 *
 * Measured against Understat directly, before and after:
 *
 *   Harry Wilson    157 matches — 2 marked home  ->  77 (49%)
 *   Raheem Sterling 336 matches — 18 marked home -> 166 (49%)
 *   Mohamed Salah   399 matches — 161            -> 203 (51%)
 *   Erling Haaland  201 matches — n/a            -> 101 (50%)
 *
 * The network is not reachable from a unit test, so these call the REAL
 * `resolveMatchVenue` against the shape Understat actually returns (captured
 * from live responses).
 *
 * An earlier version of this file re-implemented that rule alongside the code
 * instead of importing it. Reverting the fix did not fail a single test —
 * the mirror agreed with the bug. That is the whole reason the function is
 * exported.
 */

const SRC = readFileSync('lib/sports/soccer/understat.ts', 'utf8');
/**
 * Comments stripped: this file's own header quotes the defective comparison to
 * explain it, and a grep that cannot tell code from prose would fail on the
 * documentation rather than on a regression.
 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Harry Wilson's real club history, as `groups.season` returns it. */
function wilsonSeasons(): Map<string, Set<string>> {
  return new Map([
    ['2019', new Set(['Bournemouth'])],
    ['2022', new Set(['Fulham'])],
    ['2023', new Set(['Fulham'])],
    ['2024', new Set(['Fulham'])],
    ['2025', new Set(['Fulham'])],
    ['2026', new Set(['Leeds'])],
  ]);
}

test('a match at a FORMER club resolves against that season, not the current one', () => {
  // THE DEFECT, in one row. Wilson was at Bournemouth in 2019 and is at Leeds
  // now. This is a Bournemouth HOME game.
  const r = resolve({ season: '2019', h_team: 'Bournemouth', a_team: 'Everton' }, wilsonSeasons(), 'Leeds');
  assert.equal(r.isHome, true, 'the old code compared against "Leeds" and called this an away game');
  assert.equal(r.opponent, 'Everton', 'the old code reported the opponent as Bournemouth — his own club');
});

test('a mid-season transfer needs a SET per season, not one team', () => {
  // Salah's 2014 lists Fiorentina AND Chelsea. Taking a single value left 16 of
  // his 399 matches unresolved; the set resolves all of them.
  const salah = new Map([['2014', new Set(['Fiorentina', 'Chelsea'])]]);
  assert.equal(resolve({ season: '2014', h_team: 'Chelsea', a_team: 'Arsenal' }, salah, 'Liverpool').isHome, true);
  assert.equal(resolve({ season: '2014', h_team: 'Milan', a_team: 'Fiorentina' }, salah, 'Liverpool').isHome, false);
});

test('an unresolvable season is null — NOT away, and NOT the current club', () => {
  const r = resolve({ season: '2011', h_team: 'Wigan', a_team: 'Stoke' }, wilsonSeasons(), 'Leeds');
  assert.equal(r.isHome, null, 'unknown must stay unknown; false is a claim');
  assert.equal(r.opponent, null, 'guessing an opponent from an unresolved row is how the old code named his own club');
});

test('an unresolvable season does NOT fall back to the current club, even when that club is playing', () => {
  // This case is the one that discriminates, and the first version of this file
  // did not have it — so reverting the fix to a per-season fallback passed every
  // test. Wilson is at Leeds NOW. This is a 2011 Leeds fixture he had nothing to
  // do with, and 2011 is absent from his season groups.
  //
  // A per-season fallback to the current club reports isHome TRUE here, which is
  // the original defect wearing a different coat.
  const r = resolve({ season: '2011', h_team: 'Leeds', a_team: 'Wigan' }, wilsonSeasons(), 'Leeds');
  assert.equal(r.isHome, null, 'the fallback club must not resolve a season the groups do not cover');
  assert.equal(r.opponent, null);
});

test('with no season groups at all it falls back to the passed title, and only then', () => {
  const empty = new Map<string, Set<string>>();
  assert.equal(resolve({ season: '2026', h_team: 'Leeds', a_team: 'Burnley' }, empty, 'Leeds').isHome, true);
  // But the fallback must NOT apply per-season when groups DO exist — that is
  // precisely the old bug, reintroduced.
  assert.equal(
    resolve({ season: '2019', h_team: 'Leeds', a_team: 'Burnley' }, wilsonSeasons(), 'Leeds').isHome,
    null,
    'a season present in the groups must be resolved from the groups, never from the current club',
  );
});

test("Wilson's real career comes out near 50/50, which is what a balanced schedule means", () => {
  // Fixtures are balanced by construction, so any resolution that produces a
  // wildly lopsided career is wrong on its face. The old code produced 2/157.
  const fixtures = [
    ...Array.from({ length: 10 }, () => ({ season: '2019', h_team: 'Bournemouth', a_team: 'Everton' })),
    ...Array.from({ length: 10 }, () => ({ season: '2019', h_team: 'Everton', a_team: 'Bournemouth' })),
    ...Array.from({ length: 12 }, () => ({ season: '2024', h_team: 'Fulham', a_team: 'Brentford' })),
    ...Array.from({ length: 12 }, () => ({ season: '2024', h_team: 'Brentford', a_team: 'Fulham' })),
  ];
  const seasons = wilsonSeasons();
  let home = 0;
  let away = 0;
  for (const f of fixtures) {
    const r = resolve(f, seasons, 'Leeds');
    if (r.isHome === true) home++;
    else if (r.isHome === false) away++;
  }
  assert.equal(home, 22);
  assert.equal(away, 22);
});

test('the source does not compare a match against the current club, and bumped its cache key', () => {
  assert.ok(
    !/m\.h_team === understatTeamTitle/.test(CODE),
    'the exact comparison that caused the defect is back in the source',
  );
  assert.match(CODE, /groups\?\.season/, 'the fix reads the per-season club groups');
  // The stored payload shape changed AND every cached entry held wrong values,
  // so serving the ORIGINAL key would keep the defect live for 6 hours after
  // deploy. Asserted as "versioned, at v2 or later" rather than pinned to v2:
  // 6.9 bumped it to v3 when the payload gained `shots`, and a legitimate bump
  // must not read as this defect returning.
  const key = CODE.match(/soccer:understat:player:v(\d+):/);
  assert.ok(key, 'the player cache key must carry a version marker');
  assert.ok(Number(key[1]) >= 2, `cache key is at v${key[1]} — it must stay past the unversioned, wrong payloads`);
});
