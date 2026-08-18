'use client';

import type { HistoryEntry } from '@/lib/core/types';
import { seriesScale, toSeries } from '@/lib/ui/series';
import { toneFill } from '@/lib/ui/heat';

/**
 * A history strip as bars rather than chips.
 *
 * Chips say what happened; bars say how much, and how the run is shaped. Both
 * are useful, so this supplements the marks row rather than replacing it.
 * Golf's negative values (under par) hang below the baseline, which is how the
 * number is read on a scorecard — colour still carries good vs bad.
 */
export function MicroBars({
  history,
  height = 44,
  showLabels = false,
  className = '',
}: {
  history: HistoryEntry[];
  height?: number;
  /** Print the period label under each bar. Only fits on wide-ish layouts. */
  showLabels?: boolean;
  className?: string;
}) {
  const points = toSeries(history);
  if (points.length === 0) return null;

  // Period labels below ~8 bars are legible; past that they truncate to
  // "05-…" for every column, which is worse than no axis at all.
  const labelled = showLabels && points.length <= 8;

  const { min, max, signed } = seriesScale(points);
  // Every period at zero — a hitless run, say. There is no magnitude to plot,
  // and a row of stub bars would imply there was.
  if (min === 0 && max === 0) return null;

  const span = Math.max(max - min, 1);
  // Where the zero line sits within the plot area.
  const zeroRatio = signed ? max / span : 1;

  return (
    <div className={className}>
      <div className="lb-scroll-x flex items-end gap-[3px]" style={{ height }}>
        {points.map((point, i) => {
          const positive = point.value >= 0;
          const magnitude = Math.abs(point.value) / span;
          const barHeight = point.unknown ? 2 : Math.max(2, magnitude * height);

          return (
            <div
              key={`${point.periodLabel ?? ''}-${i}`}
              // Capped so a short series on a wide screen reads as bars rather
              // than as stretched blocks.
              className="flex min-w-[10px] max-w-[30px] flex-1 flex-col justify-end"
              style={{ height }}
              title={`${point.periodLabel ? `${point.periodLabel}: ` : ''}${point.label}`}
            >
              <div className="relative flex-1">
                <span
                  className="absolute inset-x-0 rounded-[2px]"
                  style={{
                    height: `${barHeight}px`,
                    // Colour by outcome quality, not by sign: an under-par hole
                    // and a multi-hit game are both good while pointing opposite ways.
                    backgroundColor: toneFill(point.tone, point.unknown ? 0.25 : 0.85),
                    ...(signed && !positive
                      ? { top: `${zeroRatio * 100}%` }
                      : { bottom: `${signed ? (1 - zeroRatio) * 100 : 0}%` }),
                  }}
                />
                {signed ? (
                  <span
                    className="absolute inset-x-0 border-t border-dashed border-line"
                    style={{ top: `${zeroRatio * 100}%` }}
                    aria-hidden
                  />
                ) : null}
              </div>
              {labelled ? (
                <span className="mt-1 block truncate text-center text-[9px] leading-none text-ink-faint">
                  {point.periodLabel ?? point.label}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <span className="sr-only">
        {points.map((p) => `${p.periodLabel ?? ''} ${p.label}`).join(', ')}
      </span>
    </div>
  );
}

/**
 * Proportion bar for a set of categories that sum to a whole — the field's
 * birdie/par/bogey split on a hole, for instance.
 */
export function ProportionBar({
  segments,
  height = 6,
}: {
  /** `tone` names the outcome; the bar decides how to colour it. */
  segments: Array<{ label: string; value: number; tone: 'good' | 'neutral' | 'bad' }>;
  height?: number;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;

  return (
    <span className="flex overflow-hidden rounded-full bg-line" style={{ height }}>
      {segments.map((segment) =>
        segment.value === 0 ? null : (
          <span
            key={segment.label}
            className="h-full"
            style={{
              width: `${(segment.value / total) * 100}%`,
              backgroundColor: toneFill(segment.tone, 0.9),
            }}
            title={`${segment.label}: ${Math.round((segment.value / total) * 100)}%`}
          />
        ),
      )}
    </span>
  );
}

export default MicroBars;
