'use client';

import { heatInk, rankToHeat } from '@/lib/ui/heat';
import { ChartFrame, type PlotArea } from './ChartFrame';
import { GRID, INK1, INK4, INK5, SIZE, SURFACE, type Formatter } from './tokens';
import { fmt as fmts } from './tokens';
import { niceDomain } from './scale';

/**
 * 04 · DensityCurve — where one value sits in a population.
 *
 * The population is the shape; the subject is the marker on it. Answers the
 * question a bare percentile cannot: 83rd percentile in a tightly bunched field
 * is a fraction of a run better than average, while the same percentile in a
 * spread-out field is a real edge. The curve shows which.
 *
 * A HISTOGRAM, SMOOTHED — not a kernel density estimate. A KDE needs a
 * bandwidth choice, and the wrong bandwidth invents modes that are not in the
 * data. Binning and drawing the bin tops is cruder and cannot lie in that
 * particular way; with a few dozen teams or a few hundred players, that is the
 * right trade.
 *
 * The subject marker prints its own value and rank, so the chart is readable
 * without hovering — this is a rail-adjacent block, and the number is the point.
 */
export interface DensityCurveProps {
  /** Every value in the comparison pool, including the subject's. */
  population: readonly number[];
  /** The subject's value. `null` renders the population alone. */
  value: number | null;
  /** Subject's rank in the pool, for the marker label. */
  rank?: number | null;
  format?: Formatter;
  /** Bin count. Sturges-ish by default; override for a small or very large pool. */
  bins?: number;
  width?: number;
  height?: number;
  isLoading?: boolean;
  emptyMessage?: string;
  label: string;
  className?: string;
}

export function DensityCurve({
  population,
  value,
  rank,
  format = fmts.two,
  bins,
  width = 300,
  height = 96,
  isLoading,
  emptyMessage,
  label,
  className,
}: DensityCurveProps) {
  const pop = population.filter((v) => Number.isFinite(v));
  // Below about eight points a histogram is noise wearing a distribution's
  // clothes — better to say so than to draw a shape the data cannot support.
  const isEmpty = pop.length < 8;

  const binCount = bins ?? Math.max(6, Math.min(24, Math.ceil(Math.sqrt(pop.length))));
  const domain = niceDomain(pop, { zeroBased: false, pad: 0.04 });
  const counts = new Array<number>(binCount).fill(0);
  for (const v of pop) {
    const t = (v - domain.lo) / (domain.hi - domain.lo || 1);
    counts[Math.max(0, Math.min(binCount - 1, Math.floor(t * binCount)))] += 1;
  }
  const peak = Math.max(...counts, 1);

  return (
    <ChartFrame
      width={width}
      height={height}
      padding={{ left: 10, right: 10, top: 16, bottom: 18 }}
      isEmpty={isEmpty}
      isLoading={isLoading}
      emptyMessage={emptyMessage ?? 'Too few comparable subjects to plot a distribution.'}
      label={label}
      className={className}
    >
      {(plot: PlotArea) => {
        const x = (v: number) => plot.left + ((v - domain.lo) / (domain.hi - domain.lo || 1)) * plot.width;
        const binX = (i: number) => plot.left + ((i + 0.5) / binCount) * plot.width;
        const binY = (c: number) => plot.top + plot.height - (c / peak) * plot.height;

        const area = [
          `M${plot.left} ${plot.top + plot.height}`,
          ...counts.map((c, i) => `L${binX(i).toFixed(1)} ${binY(c).toFixed(1)}`),
          `L${plot.left + plot.width} ${plot.top + plot.height}`,
          'Z',
        ].join(' ');

        const heat = value != null && pop.length > 1 ? rankToHeat(value, domain.lo, domain.hi) : 0.5;

        return (
          <>
            <line
              x1={plot.left}
              x2={plot.left + plot.width}
              y1={plot.top + plot.height}
              y2={plot.top + plot.height}
              stroke={GRID}
              strokeWidth={1}
            />
            <path d={area} fill={INK5} opacity={0.35} />
            <path
              d={counts.map((c, i) => `${i ? 'L' : 'M'}${binX(i).toFixed(1)} ${binY(c).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={INK4}
              strokeWidth={1.25}
              strokeLinejoin="round"
            />

            {value != null && Number.isFinite(value) ? (
              <g>
                <line x1={x(value)} x2={x(value)} y1={plot.top - 4} y2={plot.top + plot.height} stroke={INK1} strokeWidth={1.25} />
                <circle cx={x(value)} cy={plot.top - 4} r={4.4} fill={SURFACE} />
                <circle cx={x(value)} cy={plot.top - 4} r={3} fill={heatInk(heat)} />
                <text
                  x={x(value)}
                  y={plot.top + plot.height + 13}
                  fill={heatInk(heat)}
                  fontSize={SIZE.tick}
                  fontWeight={600}
                  textAnchor="middle"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {format(value)}
                  {rank != null ? ` · ${rank} of ${pop.length}` : ''}
                </text>
              </g>
            ) : null}

            <text x={plot.left} y={plot.top + plot.height + 13} fill={INK4} fontSize={SIZE.tick} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {format(domain.lo)}
            </text>
            <text
              x={plot.left + plot.width}
              y={plot.top + plot.height + 13}
              fill={INK4}
              fontSize={SIZE.tick}
              textAnchor="end"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {format(domain.hi)}
            </text>
          </>
        );
      }}
    </ChartFrame>
  );
}
