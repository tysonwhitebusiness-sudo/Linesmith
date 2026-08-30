import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toGolfProximityGrid, toGolfUsageMix, type GolfShotRow } from '../lib/sports/golf/shotProfileShapes';

/**
 * Phase 6.13 — golf's `usageMix` and `spatialGrid`, the last two role cells
 * that needed data this app did not have.
 *
 * THE TRAPS THESE GUARD, all measured against the real files before the loader
 * was written:
 *
 * 1. The source has a column named `lie` and it is the string "NA" on all
 *    10,222 rows of a real tournament. The vocabulary is in `from`/`to`.
 * 2. Distances are prose — "311 yds", "5 ft 3 in" — in one column.
 * 3. Putts are ~40% of a round's strokes, and their proximity is feet against
 *    an approach's tens of yards. Counting them in both cards would make every
 *    approach band read as "far"; dropping them from both would misdescribe
 *    where the work happens. So: mix includes them, grid does not.
 */

const shot = (fromLie: string | null, leftYds: number | null, isPutt = false): GolfShotRow => ({
  fromLie,
  leftYds,
  distanceYds: null,
  isPutt,
});

// ---------------------------------------------------------------------------
// usageMix — shots by lie
// ---------------------------------------------------------------------------

test('the mix counts putts, because putts are most of a round', () => {
  const mix = toGolfUsageMix([
    shot('OTB', 150),
    shot('OFW', 8),
    shot('OGR', 0.5, true),
    shot('OGR', 0, true),
  ])!;
  assert.equal(mix.sampleSize, 4, 'a mix that drops putts misdescribes where the work happens');
  const green = mix.slices.find((s) => s.key === 'OGR')!;
  assert.equal(green.share, 50);
});

test('lies read in the order a hole is played, not by volume', () => {
  // Tee before fairway before rough before green is how a reader scans it.
  // Sorting by count would reorder the card between two similar players.
  const mix = toGolfUsageMix([
    shot('OGR', 1, true),
    shot('OGR', 1, true),
    shot('OGR', 1, true),
    shot('OTB', 250),
    shot('OFW', 10),
  ])!;
  assert.deepEqual(mix.slices.map((s) => s.key), ['OTB', 'OFW', 'OGR']);
});

test('an unfamiliar lie code is folded into Other, never dropped', () => {
  // Dropping it would make every other share wrong, which is the quiet kind of
  // wrong: the card still adds to 100 and still lies.
  const mix = toGolfUsageMix([shot('OTB', 200), shot('ZZZ', 5)])!;
  assert.equal(mix.sampleSize, 2);
  const other = mix.slices.find((s) => s.key === 'ZZZ')!;
  assert.equal(other.label, 'Other');
  assert.equal(other.share, 50);
});

test('mean proximity carries its OWN sample, not the shot count', () => {
  // Not every shot records a remaining distance. Quoting the shot count beside
  // the mean overstates it — the same trap MLB's mix documents for xwOBA.
  const mix = toGolfUsageMix([shot('OFW', 10), shot('OFW', 20), shot('OFW', null)])!;
  const fw = mix.slices.find((s) => s.key === 'OFW')!;
  assert.equal(fw.value, 15, '(10 + 20) / 2, not / 3');
  assert.equal(fw.valueSample, 2);
  assert.notEqual(fw.valueSample, 3);
});

test('a shot with no lie is not counted at all', () => {
  // The source writes "NA" as a string; the loader turns it into null. A null
  // lie has no bar to sit in and must not inflate the denominator.
  assert.equal(toGolfUsageMix([shot(null, 10), shot(null, 20)]), null);
  const mix = toGolfUsageMix([shot('OTB', 200), shot(null, 5)])!;
  assert.equal(mix.sampleSize, 1);
});

// ---------------------------------------------------------------------------
// spatialGrid — proximity by lie
// ---------------------------------------------------------------------------

test('the grid excludes putts, and says so', () => {
  const grid = toGolfProximityGrid([
    shot('OFW', 5),
    shot('OFW', 5),
    shot('OGR', 0.4, true),
    shot('OGR', 0.4, true),
  ])!;
  assert.deepEqual(grid.rowLabels, ['Fairway'], 'the green row would be putts only');
  assert.match(grid.caption, /2 approach shots/);
  assert.match(grid.caption, /putts excluded/);
});

test('shares are WITHIN a lie, not of every shot', () => {
  // "From the rough, how often does he finish close" -- a share of the whole
  // round would answer "how often is he in the rough" instead, which the mix
  // beside it already says.
  const grid = toGolfProximityGrid([
    shot('ORO', 1),
    shot('ORO', 1),
    shot('ORO', 50),
    shot('OFW', 1),
  ])!;
  const roughRow = grid.cells[grid.rowLabels!.indexOf('Rough')];
  assert.equal(roughRow[0].value, (2 / 3) * 100, 'two of THIS LIE\'s three shots, not two of four');
  assert.equal(roughRow[0].sampleSize, 2);
});

test('only lies the player actually played from get a row', () => {
  // Nine rows of nothing is not an honest empty state, it is noise.
  const grid = toGolfProximityGrid([shot('OFW', 5), shot('OTB', 200)])!;
  assert.deepEqual(grid.rowLabels, ['Tee', 'Fairway']);
});

test('an empty band in a PLAYED lie is a real zero, not an absence', () => {
  // DELIBERATELY UNLIKE NFL's target map, where an untargeted cell is `null`.
  // The difference is what the row means. There, an empty cell means the ball
  // was never thrown there and we know nothing about it. Here, the row exists
  // only because the player played shots from that lie -- so "0% finished
  // inside 3 yards" is a MEASUREMENT of fifty real shots, and blanking it
  // would hide the most useful thing on the row.
  //
  // `null` is still correct for a lie with no shots at all, which is why such
  // lies get no row rather than an empty one.
  const grid = toGolfProximityGrid([shot('OFW', 1), shot('OFW', 40)])!;
  const row = grid.cells[0];
  assert.equal(row[0].value, 50, 'one of two finished inside 3 yd');
  assert.equal(row[1].value, 0, 'none finished 3-10 yd, and that is a real reading');
  assert.equal(row[1].sampleSize, 0);
  assert.equal(row[3].value, 50);
});

test('nothing approachable yields no card', () => {
  assert.equal(toGolfProximityGrid([]), null);
  assert.equal(toGolfProximityGrid([shot('OGR', 0.5, true)]), null, 'putts alone are not approaches');
  assert.equal(toGolfProximityGrid([shot('OFW', null)]), null, 'no remaining distance, no proximity');
});

test('the grid formats as whole percentages and names its unit', () => {
  // `format` and `unit` carry no defaults on the role — the "4.800" bug.
  const grid = toGolfProximityGrid([shot('OFW', 5)])!;
  assert.equal(grid.format(50), '50%');
  assert.match(grid.unit, /of shots from that lie/);
});
