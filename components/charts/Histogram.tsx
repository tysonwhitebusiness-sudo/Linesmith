'use client';

import { ChartFrame, type PlotArea } from './ChartFrame';
import { MarkTip } from './MarkTip';
import { EMPHASIS, INK3, INK4, SIZE, fmt as fmts } from './tokens';
import { niceDomain, yScale } from './scale';
import { toneFill } from '@/lib/ui/heat';

/**
 * A plain histogram: counts per bin, some bins highlighted — R6.1b (exit
 * velocity, dark from 95 mph). `DistributionBars` is not this: it judges each
 * bar against a prop line in good/bad colors. A distribution has no line to
 * clear, so its bars are volume in grey, with the highlighted bins in ink.
 */
export interface HistogramBin {
  key: string;
  value: number;
  /** Printed under the bar; empty for a thinned axis. */
  axisLabel: string;
  highlight: boolean;
  tip: string;
  /** A bar whose outcome is its colour's meaning (a win or a loss, R7). The tip says it too. */
  tone?: 'good' | 'bad';
}

export function Histogram({ bins, height = 180, width = 420, label, className }: { bins: readonly HistogramBin[]; height?: number; width?: number; label: string; className?: string }) {
  const domain = niceDomain([0, ...bins.map((b) => b.value)], { zeroBased: true });
  return (
    <ChartFrame
      width={width}
      height={height}
      padding={{ bottom: 20 }}
      domain={domain}
      tickCount={3}
      tickFormat={fmts.int}
      isEmpty={bins.every((b) => b.value === 0)}
      emptyMessage="Nothing to count in this season."
      label={label}
      className={className}
    >
      {(plot: PlotArea) => {
        const band = plot.width / Math.max(1, bins.length);
        const barW = Math.max(1, band - (band > 4 ? 1.5 : 0.5));
        const y = yScale(domain, plot.top, plot.height);
        const base = y(0);
        return (
          <>
            {bins.map((b, i) => {
              const x = plot.left + band * i + (band - barW) / 2;
              const top = y(b.value);
              return (
                <MarkTip key={b.key} tip={b.tip}>
                  <rect x={plot.left + band * i} y={plot.top} width={band} height={plot.height} fill="transparent" />
                  <rect x={x} y={top} width={barW} height={Math.max(0, base - top)} rx={1} fill={b.tone ? toneFill(b.tone, 0.75) : b.highlight ? EMPHASIS : INK4} />
                </MarkTip>
              );
            })}
            {bins.map((b, i) =>
              b.axisLabel ? (
                <text key={`l-${b.key}`} x={plot.left + band * i} y={plot.top + plot.height + 14} fill={INK3} fontSize={SIZE.tick} textAnchor="middle">
                  {b.axisLabel}
                </text>
              ) : null,
            )}
          </>
        );
      }}
    </ChartFrame>
  );
}
