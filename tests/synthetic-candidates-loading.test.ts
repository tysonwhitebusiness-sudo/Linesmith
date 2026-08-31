import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The Players tab's loading gate — 2026-08-31.
 *
 * WHAT WENT WRONG. `useSyntheticPlayerCandidates` seeded its loading flag to
 * `false`, so on the render before its own effect ran it reported "not
 * loading, no candidates". `PlayerDetailPanel` reads exactly that pair to
 * choose between a skeleton and the real card, and `PlayerDetail`'s empty
 * state for zero candidates reads:
 *
 *   "No tracked props for this player right now — that's real, not missing
 *    data."
 *
 * It was missing data. The NHL candidates route takes 1.8-4.7s, so an
 * out-of-season roster page asserted that denial, confidently, for every
 * player it had not finished loading.
 *
 * These are source-level assertions rather than a render test because the bug
 * is in the INITIAL value of a hook's state — the exact thing a test that
 * renders and then waits cannot see.
 */

const HOOK = readFileSync('components/useSyntheticPlayerCandidates.ts', 'utf8');
const PANEL = readFileSync('components/PlayerDetailPanel.tsx', 'utf8');

test('the loading flag is seeded from `enabled`, not hardcoded false', () => {
  assert.ok(
    /useState\(Boolean\(p\.enabled && p\.subjectId\)\)/.test(HOOK),
    'a `useState(false)` here reports "loaded and empty" for the render before the effect runs, ' +
      'which the panel renders as a confident "no props exist" while the fetch is still in flight',
  );
  assert.ok(
    !/const \[loading, setLoading\] = useState\(false\)/.test(HOOK),
    'the old seed is back',
  );
});

test('the panel still gates the real card behind that flag', () => {
  // The seed only helps if something reads it. Both halves have to hold.
  assert.ok(/waitingOnSynthetic\s*\?\s*\(?\s*<PlayerSkeleton/.test(PANEL.replace(/\s+/g, ' ')),
    'the skeleton branch is what the seeded flag buys; without it the fix is inert');
  assert.ok(
    /synthetic\.loading/.test(PANEL),
    'the panel must read the hook loading flag it depends on',
  );
});

test('every sport in the synthetic set is one the panel can actually fetch for', () => {
  // A sport listed here but with no candidates route would hang on the
  // skeleton forever instead of showing the honest empty state.
  const listed = PANEL.match(/SYNTHETIC_CANDIDATES_SPORTS = new Set<Sport>\(\[([^\]]+)\]\)/);
  assert.ok(listed, 'the set moved or was renamed');
  const sports = listed![1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.deepEqual(
    sports.sort(),
    ['cfb', 'nba', 'nhl', 'soccer', 'tennis'],
    'a sport added here needs a `/candidates` route, and one removed leaves its roster pages dead',
  );
});
