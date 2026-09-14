'use client';

import { toneFill, compareInk } from '@/lib/ui/heat';
import { MarkTip } from './MarkTip';
import { ChartFrame, type PlotArea } from './ChartFrame';
import { GRID, INK1, INK4, SIZE, type Formatter } from './tokens';
import { fmt as fmts } from './tokens';
import { niceDomain, yScale } from './scale';
import { NO_CROSSHAIR, type ChartCrosshair } from './useChartCrosshair';

/**
 * 03 · DistributionBars — per-game results against a line.
 *
 * One bar per game, oldest at the left, with the line drawn across them. The
 * bar's colour is the only thing that says cleared or not; its height is the
 * actual value. Both encodings are needed: "7 of 10 cleared" and "cleared by a
 * mile twice and by a hair five times" are different propositions, and a strip
 * of green and red squares can only tell you the first.
 *
 * **`DistributionChart` in `PlayerDetail.tsx:129` is the ancestor of this
 * primitive and still exists.** This is the general version — it takes plain
 * values rather than a `PickCandidate['history']`, so a team page and a game
 * page can use it too. Migrating the original's call sites is 6.13's work, not
 * this file's; until then the two coexist deliberately rather than by accident.
 *
 * ZERO-BASED, always, and not configurable. A bar's length IS its value — that
 * is what makes it a bar rather than a point — so a non-zero baseline makes
 * every bar lie about its magnitude. A series whose interesting range is far
 * from zero wants `SeriesChart` with `zeroBased: false`, not this.
 */
export interface DistributionBar {
  /** Stable key — a game id, not an index. */
  key: string;
  value: number | null;
  /** Tooltip text: opponent, date, whatever identifies the game. */
  title?: string;
}

export interface DistributionBarsProps {
  bars: readonly DistributionBar[];
  /** The line being cleared. Drawn across the bars. */
  line: number;
  /** `true` = over clears, `false` = under clears. */
  wantOver: boolean;
  format?: Formatter;
  /** Shared hover with other charts of the same games (R3 3c). Omit for a standalone chart. */
  crosshair?: ChartCrosshair;
  width?: number;
  height?: number;
  isLoading?: boolean;
  emptyMessage?: string;
  label: string;
  className?: string;
}

export function DistributionBars({
  bars,
  line,
  wantOver,
  format = fmts.one,
  crosshair = NO_CROSSHAIR,
  width = 420,
  height = 120,
  isLoading,
  emptyMessage,
  label,
  className,
}: DistributionBarsProps) {
  const played = bars.filter((b) => b.value != null && Number.isFinite(b.value));
  const cleared = played.filter((b) => (wantOver ? (b.value as number) > line : (b.value as number) < line)).length;

  // The line has to be inside the domain even when every result is below it,
  // or it renders off the top of the frame and the chart quietly stops
  // answering the question it exists to answer.
  const domain = niceDomain([...played.map((b) => b.value as number), line, 0], { zeroBased: true });

  return (
    <ChartFrame
      width={width}
      height={height}
      padding={{ bottom: 16 }}
      domain={domain}
      tickCount={2}
      tickFormat={format}
      isEmpty={played.length === 0}
      isLoading={isLoading}
      emptyMessage={emptyMessage ?? 'No completed games in this window.'}
      label={`${label}: cleared ${cleared} of ${played.length}`}
      className={className}
      onPointerMove={(e, plot) => {
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const band = plot.width / Math.max(1, bars.length);
        const i = Math.floor((e.clientX - rect.left - plot.left) / band);
        crosshair.setIndex(i >= 0 && i < bars.length ? i : null);
      }}
      onPointerLeave={crosshair.clear}
    >
      {(plot: PlotArea) => {
        // COLUMN LAYOUT (R3 3c): one equal band per game, the bar centred in it,
        // width clamped to max(1, min(24, band - gap)). A few games get fat bars
        // no wider than 24px; a season of games gets thin ones that still fit.
        const band = plot.width / Math.max(1, bars.length);
        const gap = band > 4 ? 2 : 0.5;
        const barW = Math.max(1, Math.min(24, band - gap));
        const x = (i: number) => plot.left + band * (i + 0.5);
        const y = yScale(domain, plot.top, plot.height);
        const baseline = y(Math.max(0, domain.lo));
        const lineY = y(line);

        return (
          <>
            {bars.map((b, i) => {
              if (b.value == null || !Number.isFinite(b.value)) return null;
              const v = b.value;
              const top = y(v);
              const didClear = wantOver ? v > line : v < line;
              return (
                <MarkTip key={b.key} tip={`${b.title ?? b.key} · ${format(v)} · ${didClear ? 'cleared' : 'missed'}`}>
                  {/* Transparent hit area: the whole band, so a short bar is as easy to hover as a tall one. */}
                  <rect x={x(i) - band / 2} y={plot.top} width={band} height={plot.height} fill="transparent" />
                  <rect
                    x={x(i) - barW / 2}
                    y={Math.min(top, baseline)}
                    width={barW}
                    height={Math.max(1, Math.abs(baseline - top))}
                    rx={Math.min(2, barW / 2)}
                    fill={toneFill(didClear ? 'good' : 'bad', crosshair.index == null || crosshair.index === i ? 0.75 : 0.4)}
                  />
                </MarkTip>
              );
            })}

            {/* A ZERO LINE where values go negative (R3 3c), so a bar below it reads as below zero. */}
            {domain.lo < 0 ? <line x1={plot.left} x2={plot.left + plot.width} y1={baseline} y2={baseline} stroke={INK4} strokeWidth={1} /> : null}
            {/* The prop line is a DASHED reference (R3 3c): a threshold, not a data series. */}
            <line
              x1={plot.left}
              x2={plot.left + plot.width}
              y1={lineY}
              y2={lineY}
              stroke={INK1}
              strokeWidth={1.25}
              strokeDasharray="4 4"
            />
            <text
              x={plot.left + plot.width}
              y={lineY - 4}
              fill={INK1}
              fontSize={SIZE.tick}
              textAnchor="end"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {`${wantOver ? 'o' : 'u'}${format(line)}`}
            </text>

            <text
              x={plot.left}
              y={plot.top + plot.height + 13}
              fill={compareInk(played.length ? cleared / played.length : 0.5)}
              fontSize={SIZE.tick}
              fontWeight={600}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {`${cleared}/${played.length} cleared`}
            </text>
          </>
        );
      }}
    </ChartFrame>
  );
}
