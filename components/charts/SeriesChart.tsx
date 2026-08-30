'use client';

import { useState } from 'react';
import { ChartFrame, type PlotArea } from './ChartFrame';
import { CONTEXT, CONTEXT_OPACITY, EMPHASIS, INK4, SIZE, SURFACE, type Formatter } from './tokens';
import { fmt as fmts } from './tokens';
import { linePath, nearestIndex, niceDomain, xScale, yScale } from './scale';
import { NO_CROSSHAIR, type ChartCrosshair } from './useChartCrosshair';

/**
 * 02 · SeriesChart — the one real line chart. Emphasis plus grey context.
 *
 * Used for line movement (the price tape), rolling form, and Elo history: one
 * series is the subject and the rest are the field. The field is drawn first,
 * thin and receded; the subject last, in full ink. That ordering is the whole
 * design — a chart where every line competes says nothing.
 *
 * ============================ THE BUG THIS FIXES ============================
 *
 * The board's `rollingChart` forced `lo = 0`. That is correct for a count stat
 * (hits, receiving yards), which is what it was first written against, and
 * **wrong for a rating**: an Elo series spanning 1460–1590 collapsed into a
 * flat strip at the top of the frame, with ticks reading 0.0 / 590.2 / 1180.5.
 * The entire signal was destroyed and the chart still rendered without error.
 * Found, like `HeatGrid`'s bug, by looking at the built page.
 *
 * So **`zeroBased` is a required prop with no default**. A caller has to decide
 * whether zero belongs on the axis, because the failure mode is a chart that
 * is technically correct and completely unreadable, and nothing catches that
 * except a person looking at it. `scale.ts`'s `DomainOptions` makes the same
 * argument at greater length.
 * ===========================================================================
 */
export interface SeriesChartProps {
  /** The subject series. Non-finite entries break the line rather than being interpolated across. */
  values: readonly number[];
  /** Background series on the same x domain — other books, other teams. */
  context?: ReadonlyArray<readonly number[]>;
  /** X labels, parallel to `values`. Renders an x-axis when present. */
  xLabels?: readonly string[];
  /** See the bug note above. No default, deliberately. */
  zeroBased: boolean;
  /** Hard domain overrides, when several charts must share one scale. */
  min?: number;
  max?: number;
  /** Tick and tooltip format. */
  format?: Formatter;
  /** Shared hover across a panel. Omit for a standalone chart. */
  crosshair?: ChartCrosshair;
  /** Tooltip unit ("consensus", "Elo"). */
  unit?: string;
  width?: number;
  height?: number;
  tickCount?: number;
  isLoading?: boolean;
  emptyMessage?: string;
  label: string;
  className?: string;
}

export function SeriesChart({
  values,
  context,
  xLabels,
  zeroBased,
  min,
  max,
  format = fmts.one,
  crosshair = NO_CROSSHAIR,
  unit,
  width = 640,
  height = 132,
  tickCount = 3,
  isLoading,
  emptyMessage,
  label,
  className,
}: SeriesChartProps) {
  const [localIndex, setLocalIndex] = useState<number | null>(null);
  const hovered = crosshair === NO_CROSSHAIR ? localIndex : crosshair.index;

  const finite = values.filter((v) => Number.isFinite(v));
  const isEmpty = finite.length < 2;

  const all = [...values, ...(context ?? []).flat()];
  const domain = niceDomain(all, { zeroBased, min, max });
  const padB = xLabels ? 24 : 8;

  const publish = (next: number | null) => {
    if (crosshair === NO_CROSSHAIR) setLocalIndex(next);
    else crosshair.setIndex(next);
  };

  return (
    <ChartFrame
      width={width}
      height={height}
      padding={{ bottom: padB }}
      domain={domain}
      tickCount={tickCount}
      tickFormat={format}
      isEmpty={isEmpty}
      isLoading={isLoading}
      emptyMessage={emptyMessage ?? 'Not enough history to plot movement yet.'}
      label={label}
      className={className}
      tooltip={(plot) => {
        if (hovered == null) return null;
        const v = values[hovered];
        if (v == null || !Number.isFinite(v)) return null;
        const x = xScale(values.length, plot.left, plot.width);
        const y = yScale(domain, plot.top, plot.height);
        return { x: x(hovered), y: y(v), rows: [{ value: format(v), label: xLabels?.[hovered] ?? unit }] };
      }}
      onPointerMove={(e, plot) => {
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const scale = rect.width / width || 1;
        const px = (e.clientX - rect.left) / scale;
        publish(nearestIndex(px, values.length, plot.left, plot.width));
      }}
      onPointerLeave={() => publish(null)}
    >
      {(plot: PlotArea) => {
        const x = xScale(values.length, plot.left, plot.width);
        const y = yScale(domain, plot.top, plot.height);

        const hoverValue = hovered != null ? values[hovered] : undefined;

        return (
          <>
            {(context ?? []).map((line, i) => (
              <path
                key={i}
                d={linePath(line, x, y)}
                fill="none"
                stroke={CONTEXT}
                strokeWidth={1}
                opacity={CONTEXT_OPACITY}
                strokeLinejoin="round"
              />
            ))}

            <path
              d={linePath(values, x, y)}
              fill="none"
              stroke={EMPHASIS}
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {hovered != null && hoverValue != null && Number.isFinite(hoverValue) ? (
              <g>
                <line x1={x(hovered)} x2={x(hovered)} y1={plot.top} y2={plot.top + plot.height} stroke={INK4} strokeWidth={1} />
                <circle cx={x(hovered)} cy={y(hoverValue)} r={4.4} fill={SURFACE} />
                <circle cx={x(hovered)} cy={y(hoverValue)} r={3} fill={EMPHASIS} />
              </g>
            ) : null}

            {xLabels
              ? xLabels.map((t, i) =>
                  // Thin the axis rather than overlapping labels — an
                  // unreadable axis is worse than a sparse one.
                  i % Math.ceil(xLabels.length / 7) === 0 ? (
                    <text
                      key={i}
                      x={x(i)}
                      y={plot.top + plot.height + 15}
                      fill={INK4}
                      fontSize={SIZE.tick}
                      textAnchor="middle"
                    >
                      {t}
                    </text>
                  ) : null,
                )
              : null}
          </>
        );
      }}
    </ChartFrame>
  );
}
