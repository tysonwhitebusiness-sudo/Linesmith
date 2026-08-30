import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { niceDomain, ticksFor, linePath, xScale, yScale, nearestIndex, impliedProbability } from '../components/charts/scale';
import { fmt } from '../components/charts/tokens';
import { HeatGrid } from '../components/charts/HeatGrid';
import { SeriesChart } from '../components/charts/SeriesChart';
import { Sparkline } from '../components/charts/Sparkline';
import { DistributionBars } from '../components/charts/DistributionBars';
import { StreakStrip } from '../components/charts/StreakStrip';

/**
 * Phase 6.4 — `components/charts/`.
 *
 * THE TWO TESTS THAT MATTER ARE THE FIRST TWO, and the Phase 6 gate names them:
 * "Both primitive fixes carried across, proven by rendering a non-MLB unit
 * through each: `zoneGrid` with a >1.0 value (NFL yards/target) and
 * `rollingChart` with a non-zero-based series (Elo)."
 *
 * Both original bugs rendered CLEANLY. Neither threw, neither failed a type
 * check, and both produced a chart that looked like a chart — one showing
 * "4.800" where the number was 14.8, the other showing a flat line where a
 * 130-point Elo swing was. They were caught by a person looking at a built
 * page. So these assert the rendered OUTPUT, not the props: they render the
 * component to markup and read the numbers back out.
 */

// ---------------------------------------------------------------------------
// The two carried fixes
// ---------------------------------------------------------------------------

test('HeatGrid renders a >1.0 non-MLB value correctly — the "4.800" bug', () => {
  // NFL yards per target. The board's zoneGrid formatted every cell with
  // baseball's strip-the-leading-zero convention (v.toFixed(3).slice(1)), so
  // 14.8 became "4.800" — a wrong number, on screen, in a reviewed board.
  const markup = renderToStaticMarkup(
    <HeatGrid
      rows={[
        [
          { key: 'short-left', value: 14.8 },
          { key: 'short-right', value: 9.2 },
        ],
        [
          { key: 'deep-left', value: 6.1 },
          { key: 'deep-right', value: 11.4 },
        ],
      ]}
      aspect="zone"
      unit="yards/target"
      label="Target map"
    />,
  );

  assert.ok(markup.includes('>14.8<'), `14.8 did not render as "14.8". Markup: ${markup.slice(0, 400)}`);
  assert.ok(!markup.includes('4.800'), 'the baseball rate format is back — 14.8 rendered as "4.800"');
  assert.ok(!markup.includes('xwOBA'), 'the MLB caption/unit is hardcoded again');
  assert.ok(!markup.includes('catcher view'), 'the MLB caption is hardcoded again');
});

test('HeatGrid still renders MLB rates correctly when asked to', () => {
  // The fix must not break the sport it was written for: MLB passes its own
  // format explicitly rather than getting it by default.
  const markup = renderToStaticMarkup(
    <HeatGrid
      rows={[[{ key: 'up-in', value: 0.412 }]]}
      aspect="zone"
      format={fmt.rate3}
      unit="xwOBA"
      caption="catcher view · xwOBA by zone"
      label="Strike zone"
    />,
  );
  assert.ok(markup.includes('>.412<'), 'MLB rate format broke — .412 did not render');
  assert.ok(markup.includes('catcher view'), 'an explicitly passed caption did not render');
});

test('SeriesChart plots a non-zero-based Elo series without flattening it', () => {
  // The board's rollingChart forced lo = 0. An Elo series spanning 1460-1590
  // collapsed into a flat strip with ticks at 0.0 / 590.2 / 1180.5.
  const elo = [1460, 1478, 1502, 1495, 1530, 1548, 1567, 1590];
  const markup = renderToStaticMarkup(
    <SeriesChart values={elo} zeroBased={false} format={fmt.int} label="Elo history" />,
  );

  // The giveaway was a tick at 0. A correct axis has no tick anywhere near it.
  assert.ok(!markup.includes('>0<'), 'a zero tick is back — the axis is zero-based again');
  assert.ok(!markup.includes('590'), 'ticks look zero-based (590 was the middle tick of the bug)');
  // Ticks must sit inside the data range, not start from the origin.
  const ticks = [...markup.matchAll(/text-anchor="end"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
  assert.ok(ticks.length > 0, 'no y ticks rendered at all');
  assert.ok(Math.min(...ticks) > 1300, `lowest tick was ${Math.min(...ticks)}; a zero-based axis is back`);
  assert.ok(Math.max(...ticks) < 1700, `highest tick was ${Math.max(...ticks)}; the domain is not fitted to the data`);
});

test('SeriesChart still anchors a count series at zero when asked to', () => {
  const markup = renderToStaticMarkup(
    <SeriesChart values={[4, 9, 2, 11, 6]} zeroBased format={fmt.int} label="Receiving yards" />,
  );
  assert.ok(markup.includes('>0<'), 'zeroBased:true no longer anchors at zero');
});

test('the domain helper refuses to guess whether zero belongs on the axis', () => {
  // `zeroBased` has no default anywhere in this library. Getting it wrong
  // renders a technically-correct, completely unreadable chart, and nothing
  // catches that but a person looking at it — so a caller must decide.
  const src = readFileSync('components/charts/scale.ts', 'utf8');
  assert.match(src, /zeroBased: boolean;/, 'zeroBased became optional — the Elo bug can return silently');
  assert.doesNotMatch(src, /zeroBased\s*=\s*(true|false)/, 'zeroBased gained a default');

  const elo = niceDomain([1460, 1590], { zeroBased: false });
  assert.ok(elo.lo > 1300 && elo.hi < 1760, `fitted domain was ${elo.lo}-${elo.hi}`);
  const counts = niceDomain([4, 11], { zeroBased: true });
  assert.equal(counts.lo, 0);
});

// ---------------------------------------------------------------------------
// Degenerate inputs — the cases that render NaN coordinates silently
// ---------------------------------------------------------------------------

test('scale helpers survive empty, flat and non-finite series', () => {
  // A NaN coordinate produces an invisible path and no error anywhere.
  assert.deepEqual(niceDomain([], { zeroBased: true }), { lo: 0, hi: 1 });
  const flat = niceDomain([5, 5, 5], { zeroBased: false });
  assert.ok(flat.hi > flat.lo, 'an all-equal series produced a zero-width domain');
  const withNaN = niceDomain([1, Number.NaN, 3], { zeroBased: true });
  assert.ok(Number.isFinite(withNaN.lo) && Number.isFinite(withNaN.hi));

  // A one-point series must not divide by zero in the x scale.
  assert.equal(xScale(1, 10, 100)(0), 10);

  const path = linePath([1, Number.NaN, 3], xScale(3, 0, 100), yScale({ lo: 0, hi: 4 }, 0, 50));
  assert.ok(!path.includes('NaN'), `path contained NaN: ${path}`);
  // The gap breaks the line rather than interpolating across missing data.
  assert.equal((path.match(/M/g) ?? []).length, 2, 'a non-finite point should break the line, not be skipped over');
});

test('ticksFor spans the domain inclusively', () => {
  const t = ticksFor({ lo: 0, hi: 30 }, 3);
  assert.deepEqual(t, [0, 10, 20, 30]);
});

test('nearestIndex clamps to the series rather than running off either end', () => {
  assert.equal(nearestIndex(-500, 10, 0, 100), 0);
  assert.equal(nearestIndex(9999, 10, 0, 100), 9);
});

test('impliedProbability handles both signs of American odds', () => {
  assert.ok(Math.abs(impliedProbability(100) - 0.5) < 1e-9);
  assert.ok(Math.abs(impliedProbability(-110) - 110 / 210) < 1e-9);
});

// ---------------------------------------------------------------------------
// Empty states — the gate requires an honest one, never a blank card
// ---------------------------------------------------------------------------

test('every primitive renders an honest empty state rather than a blank card', () => {
  const cases: Array<[string, string]> = [
    ['HeatGrid', renderToStaticMarkup(<HeatGrid rows={[]} label="Splits" />)],
    [
      'SeriesChart',
      renderToStaticMarkup(<SeriesChart values={[]} zeroBased label="Movement" />),
    ],
    [
      'DistributionBars',
      renderToStaticMarkup(<DistributionBars bars={[]} line={1.5} wantOver label="Results" />),
    ],
  ];
  for (const [name, markup] of cases) {
    assert.ok(markup.trim().length > 0, `${name} rendered literally nothing for empty input`);
    assert.match(markup, /aria-label|<p/, `${name}'s empty state has no text alternative`);
  }
});

test('loading outranks empty — unknown is not the same claim as nothing', () => {
  const markup = renderToStaticMarkup(
    <SeriesChart values={[]} zeroBased isLoading label="Movement" />,
  );
  assert.match(markup, /aria-busy="true"/, 'a loading chart claimed to be empty');
});

test('Sparkline declines to draw a trend from a single point', () => {
  // One point is a dot pretending to be a trend; a flat line would read as
  // "no movement" when the truth is "no history".
  const one = renderToStaticMarkup(<Sparkline values={[5]} label="Trend" />);
  assert.ok(!one.includes('<path'), 'a one-point sparkline drew a line');
  const two = renderToStaticMarkup(<Sparkline values={[5, 9]} label="Trend" />);
  assert.ok(two.includes('<path'), 'a two-point sparkline drew nothing');
});

test('StreakStrip keeps a no-result game as a real third state', () => {
  // Dropping it silently shortens the streak and misstates the record.
  const markup = renderToStaticMarkup(
    <StreakStrip outcomes={[true, null, false]} showRecord label="Last 3" />,
  );
  assert.match(markup, /fill="none"/, 'the null outcome was not rendered as a hollow cell');
  assert.ok(markup.includes('1-1'), 'the record counted the null game as a win or a loss');
});

test('DistributionBars keeps the line inside the domain even when nothing reached it', () => {
  // Otherwise the line renders off the top of the frame and the chart stops
  // answering the only question it exists to answer.
  const markup = renderToStaticMarkup(
    <DistributionBars
      bars={[
        { key: 'g1', value: 0 },
        { key: 'g2', value: 1 },
      ]}
      line={8.5}
      wantOver
      label="Strikeouts"
    />,
  );
  assert.ok(markup.includes('o8.5'), 'the line label did not render');
  assert.ok(markup.includes('0/2 cleared'), 'the cleared count is wrong or missing');
});

// ---------------------------------------------------------------------------
// The library-wide rule
// ---------------------------------------------------------------------------

test('no primitive hardcodes a sport-specific literal', () => {
  // The standing rule this phase earned twice over: the first sport to use a
  // primitive gets to define its defaults. Both shipped bugs were an MLB
  // literal sitting in a shared file.
  const dir = 'components/charts';
  const SPORT_WORDS = ['xwOBA', 'catcher view', 'strike zone', 'yards per target', 'plate_x', 'pitcher', 'batter'];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))) {
    const src = readFileSync(`${dir}/${file}`, 'utf8')
      // Comments explain the bugs by name and must stay.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const word of SPORT_WORDS) {
      assert.ok(
        !src.includes(word),
        `${file} contains the sport-specific literal "${word}" outside a comment. ` +
          `A primitive takes that as a prop — this is exactly how 14.8 rendered as "4.800".`,
      );
    }
  }
});

test('the default number format is not baseballs rate convention', () => {
  // fmt.rate3 strips the leading zero (.312), which is correct for MLB and
  // wrong for every value above 1.0. It must never be a default.
  assert.equal(fmt.rate3(0.312), '.312');
  assert.equal(fmt.one(14.8), '14.8');
  const heatGridSrc = readFileSync('components/charts/HeatGrid.tsx', 'utf8');
  assert.match(heatGridSrc, /format = fmts\.one/, 'HeatGrid default format changed — check it is not a rate format');
});
