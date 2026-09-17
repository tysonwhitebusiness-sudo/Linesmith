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
 *
 * R9b — A BAR TOO THIN TO READ IS NOT A CHART. Every bin used to share the
 * host's width however many there were: a team's 153-game "Margin by game" drew
 * 2.7px bars in a half-width card, which the operator could not read and which
 * left no room for the opponent each bar stands for. So `minBand` sets the
 * width one bin is entitled to; past that the chart draws wider than its host
 * and the host scrolls, rather than shrinking the bars further. `imageUrl`
 * turns the axis label into that opponent's crest once a band is wide enough to
 * hold one — the identity R9a put in the tables, in the charts.
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
  /** The opponent's crest, drawn in place of the label where the band holds it (R9b). */
  imageUrl?: string | null;
}

/** Below this a crest is a smudge, so the axis keeps its text. */
const LOGO_BAND = 17;
const LOGO = 14;

export function Histogram({
  bins,
  height = 180,
  width = 420,
  minBand = 0,
  label,
  className,
}: {
  bins: readonly HistogramBin[];
  height?: number;
  width?: number;
  /** Least width one bin may have before the chart scrolls instead of shrinking (R9b). */
  minBand?: number;
  label: string;
  className?: string;
}) {
  const domain = niceDomain([0, ...bins.map((b) => b.value)], { zeroBased: true });
  // The plot's own insets, which the frame applies: the content has to carry
  // them too or the last bar sits under the right edge.
  const minContentWidth = minBand ? bins.length * minBand + 34 + 12 : 0;
  return (
    <ChartFrame
      width={width}
      height={height}
      padding={{ bottom: 20 }}
      domain={domain}
      tickCount={3}
      tickFormat={fmts.int}
      minContentWidth={minContentWidth}
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
        const withLogos = band >= LOGO_BAND && bins.some((b) => b.imageUrl);
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
              withLogos && b.imageUrl ? (
                // The crest replaces the text, so "@" — the one fact the text
                // carried besides the name — is drawn beside it rather than lost.
                <g key={`i-${b.key}`}>
                  {b.axisLabel.startsWith('@') ? (
                    <text x={plot.left + band * i + (band - LOGO) / 2 - 1} y={plot.top + plot.height + 13} fill={INK3} fontSize={SIZE.tick} textAnchor="end">
                      @
                    </text>
                  ) : null}
                  <image
                    href={b.imageUrl}
                    x={plot.left + band * i + (band - LOGO) / 2}
                    y={plot.top + plot.height + 3}
                    width={LOGO}
                    height={LOGO}
                    preserveAspectRatio="xMidYMid meet"
                  />
                </g>
              ) : b.axisLabel ? (
                <text key={`l-${b.key}`} x={plot.left + band * i + band / 2} y={plot.top + plot.height + 14} fill={INK3} fontSize={SIZE.tick} textAnchor="middle">
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
