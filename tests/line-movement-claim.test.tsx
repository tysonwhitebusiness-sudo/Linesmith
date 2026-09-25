import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The page must not tell users that line movement is untracked.
 *
 * `PlayerDetail.tsx` carried a card reading "Movement history isn't tracked.
 * Prices are recorded when you enter or import them, so only the current value
 * is known", above a source comment asserting "no history is retained anywhere
 * in the odds layer — there are no price snapshots to draw a series from".
 *
 * Both were true when written and stopped being true on 2026-08-11, when the
 * Python worker's jobs began writing `prop_odds_history`. By the time anyone
 * noticed, the table held 670,478 observations across 2,294 subjects and 26
 * books — and the page had been telling users the feature was impossible the
 * whole time.
 *
 * A STALE CLAIM IN PROSE IS INVISIBLE TO `tsc` AND TO EVERY OTHER TEST. It has
 * no type, nothing imports it, and it never throws. This is the only kind of
 * check that catches one.
 */

/**
 * Comments stripped, so this checks what a USER can read rather than what the
 * file documents. The replacement card quotes the old wording verbatim to
 * explain why it is gone — a check that could not tell prose from documentation
 * would fail on the explanation and pass on a regression.
 */
const RENDERED = readFileSync('components/PlayerDetail.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*$/gm, '');
const SRC = readFileSync('components/PlayerDetail.tsx', 'utf8');

test('PlayerDetail does not claim movement history is untracked', () => {
  for (const claim of [
    /Movement history isn/,
    /no price snapshots to draw a series from/i,
    /No history is retained anywhere in the odds layer/i,
  ]) {
    assert.doesNotMatch(
      RENDERED,
      claim,
      `PlayerDetail.tsx still carries a claim that line movement is not tracked. ` +
        `\`prop_odds_history\` has been accumulating since 2026-08-11 and ` +
        `/api/props/line-history serves it.`,
    );
  }
});

// The render tests of the old LineMovementCard went with it (odds build P8,
// 2026-09-25): the player page's movement chart is `components/odds/LineMovement`,
// on /kit and covered by tests/odds-ui.test.ts and the lib/odds/section tests.
test('PlayerDetail mounts the odds section, whose Line movement replaced the old card', () => {
  assert.match(SRC, /<PlayerOddsSection2/);
});
