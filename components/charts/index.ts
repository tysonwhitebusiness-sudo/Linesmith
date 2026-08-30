/**
 * The chart grammar — Phase 6.4.
 *
 * A shared primitives library, built BEFORE any Phase 6 feature chart and for
 * the same reason `CLAUDE.md` already gives twice: four hand-written provider
 * job bodies each had to remember their own rate-limit check and two forgot;
 * three duplicated page components drifted until someone read them side by
 * side. Ten bespoke SVG charts would be that a third time. `package.json`
 * carries no chart library — hand-rolled SVG is the right call for the look,
 * and a shared frame is what stops it becoming ten dialects.
 *
 * TWO PRIMITIVES ALREADY SHIPPED WITH THEIR FIRST SPORT BAKED IN, in the design
 * boards, and both were found by LOOKING at a rendered page rather than by
 * reading code or querying the DOM:
 *
 * - `zoneGrid` hardcoded MLB's domain, caption and number format. NFL's 14.8
 *   yards-per-target rendered as **"4.800"**. Fixed here in `HeatGrid`, where
 *   all three are props and the default format is deliberately NOT baseball's.
 * - `rollingChart` forced a zero-based y-axis. An Elo series spanning
 *   1460–1590 collapsed to a flat strip with ticks at 0.0 / 590.2 / 1180.5.
 *   Fixed here in `SeriesChart`, where `zeroBased` is a REQUIRED prop with no
 *   default, because the failure renders cleanly and only a person looking at
 *   it will notice.
 *
 * **The standing rule both of those earn: the first sport to use a primitive
 * gets to define its defaults, so audit every literal in one before a second
 * sport touches it.** When in doubt the default is the general case and the
 * sport-specific value is passed in.
 *
 * Reference implementations, all committed and self-contained:
 * `docs/design/chart-grammar.html` (the primitives board, holding the two
 * UNFIXED originals — harmless there, it is MLB-only) plus the three per-sport
 * boards. The fixes live as asserted patches in `docs/design/build-lib.mjs`.
 */

export { ChartFrame, type ChartFrameProps, type PlotArea, type TooltipContent } from './ChartFrame';
export { useChartCrosshair, NO_CROSSHAIR, type ChartCrosshair } from './useChartCrosshair';

export * from './tokens';
export * from './scale';

// 01 trend at table-row scale
export { Sparkline, type SparklineProps } from './Sparkline';
// 02 the one real line chart — emphasis + grey context
export { SeriesChart, type SeriesChartProps } from './SeriesChart';
// 03 per-game results against a line
export { DistributionBars, type DistributionBarsProps, type DistributionBar } from './DistributionBars';
// 04 where one value sits in a population
export { DensityCurve, type DensityCurveProps } from './DensityCurve';
// 05 ranked stats — the radar-chart replacement
export { PercentileRail, type PercentileRailProps, type PercentileRailRow } from './PercentileRail';
// 06 splits matrix; the strike-zone grid is the same primitive at a different aspect
export { HeatGrid, type HeatGridProps, type HeatGridCell } from './HeatGrid';
// 07 book dispersion
export { RangeBar, type RangeBarProps, type RangeBarPoint } from './RangeBar';
// 08 signed model contributions — "why the model likes this"
export { ContributionBars, type ContributionBarsProps, type Contribution } from './ContributionBars';
// 09 dense stat block, heat bar behind the number
export { StatTable, type StatTableProps, type StatTableRow } from './StatTable';
// 10 run of binary outcomes, opacity ramping to the present
export { StreakStrip, type StreakStripProps } from './StreakStrip';
// 11 A vs B on one shared scale
export { SplitDumbbell, type SplitDumbbellProps, type SplitDumbbellRow } from './SplitDumbbell';
