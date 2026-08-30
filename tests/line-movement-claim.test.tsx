import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { LineMovementCard } from '../components/LineMovementCard';
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

test('PlayerDetail actually renders the movement card', () => {
  // The claim being gone is not the same as the feature being there — deleting
  // the paragraph alone would pass the test above and leave a blank rail.
  assert.match(SRC, /<LineMovementCard/, 'the movement card is no longer rendered');
  assert.match(SRC, /useLineHistory\(/, 'nothing fetches the movement data');
});

// ---------------------------------------------------------------------------
// The card ALWAYS renders — operator decision, 2026-08-30, and a Phase 6 gate
// requirement in its own right: "every sport's page renders every block or an
// honest empty state. A blank card with no empty state is a failure."
// ---------------------------------------------------------------------------

test('the movement card renders an empty state instead of vanishing', () => {
  // It used to `return null` when there were fewer than two buckets or no
  // series — which is the ordinary state of every prop early in a game's life
  // and every sport out of season. The `emptyMessage` written for exactly this
  // case sat unreachable behind that early return, so the commonest outcome was
  // a block that silently did not exist. Verified live on an NFL player page:
  // no price on record, and no card at all.
  for (const [label, data] of [
    ['no data at all', null],
    ['no series', { buckets: [], series: [], availableLines: [], resolvedLine: null }],
    [
      'a single bucket',
      {
        buckets: ['2026-08-30T12:00:00Z'],
        series: [{ bookmaker: 'fanduel', points: [{ t: '2026-08-30T12:00:00Z', americanOdds: -110, line: 0.5 }] }],
        availableLines: [0.5],
        resolvedLine: 0.5,
      },
    ],
  ] as const) {
    const html = renderToStaticMarkup(
      <LineMovementCard data={data as never} loading={false} userSportsbook="fanduel" marketLabel="hits" />,
    );
    assert.match(html, /Line movement/, `${label}: the card itself disappeared`);
    assert.match(html, /No price history recorded|Only one price on record/, `${label}: no honest empty state`);
  }
});

test('the empty state distinguishes "never recorded" from "has not moved yet"', () => {
  // Two genuinely different situations a reader can act on differently. Folding
  // them into one "no data" string would be the smaller lie, not the honest one.
  const never = renderToStaticMarkup(
    <LineMovementCard data={null} loading={false} userSportsbook="fanduel" marketLabel="hits" />,
  );
  const stable = renderToStaticMarkup(
    <LineMovementCard
      data={{
        buckets: ['2026-08-30T12:00:00Z'],
        series: [{ bookmaker: 'fanduel', points: [{ t: '2026-08-30T12:00:00Z', americanOdds: -110, line: 0.5 }] }],
        availableLines: [0.5],
        resolvedLine: 0.5,
      } as never}
      loading={false}
      userSportsbook="fanduel"
      marketLabel="hits"
    />,
  );
  assert.match(never, /No price history recorded for this prop yet/);
  assert.match(stable, /Only one price on record so far/);
  assert.notEqual(
    never.includes('No price history recorded'),
    stable.includes('No price history recorded'),
    'both states print the same message — the distinction is not reaching the page',
  );
});

test('a real series still draws, and the empty state does not swallow it', () => {
  // The guard above must not be satisfiable by always showing the empty state.
  const html = renderToStaticMarkup(
    <LineMovementCard
      data={{
        buckets: ['2026-08-30T12:00:00Z', '2026-08-30T13:00:00Z', '2026-08-30T14:00:00Z'],
        series: [
          {
            bookmaker: 'fanduel',
            points: [
              { t: '2026-08-30T12:00:00Z', americanOdds: -110, line: 0.5 },
              { t: '2026-08-30T14:00:00Z', americanOdds: -140, line: 0.5 },
            ],
          },
        ],
        availableLines: [0.5],
        resolvedLine: 0.5,
      } as never}
      loading={false}
      userSportsbook="fanduel"
      marketLabel="hits"
    />,
  );
  assert.doesNotMatch(html, /No price history recorded|Only one price on record/);
  assert.match(html, /<path/, 'a drawable series produced no line');
});
