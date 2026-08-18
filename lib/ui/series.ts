/**
 * Turning a history of result tokens into something chartable.
 *
 * The engine stores results as sport-authored strings ('-1', 'E', '2-4', '3 R')
 * because that's what a human wants to read. A bar chart needs a number, so
 * this reads one back out — by the shape of the token, never by branching on
 * sport. A token this can't parse contributes a zero-height bar rather than a
 * made-up value.
 */

import type { HistoryEntry } from '@/lib/core/types';
import { entryValue } from '@/lib/core/windowedStat';
import { markFor, type MarkTone } from './marks';

export interface SeriesPoint {
  /** Numeric magnitude: relative-to-par for golf, hits or runs for MLB. */
  value: number;
  /** True when the token carried no number we could trust. */
  unknown: boolean;
  tone: MarkTone;
  /** The original token, shown on the axis and in the tooltip. */
  label: string;
  periodLabel?: string;
}

export function toSeries(history: HistoryEntry[]): SeriesPoint[] {
  return history.map((entry) => {
    // Parsed by `windowedStat.entryValue` so the chart and the average it sits
    // beside can never disagree about what a token was worth.
    const value = entryValue(entry);
    return {
      value: value ?? 0,
      unknown: value === null,
      tone: markFor(entry.category).tone,
      label: entry.result,
      periodLabel: entry.periodLabel,
    };
  });
}

export interface SeriesScale {
  min: number;
  max: number;
  /** True when the series crosses zero and needs a mid-height baseline. */
  signed: boolean;
}

export function seriesScale(points: SeriesPoint[]): SeriesScale {
  const values = points.filter((p) => !p.unknown).map((p) => p.value);
  const min = values.length ? Math.min(0, ...values) : 0;
  const max = values.length ? Math.max(0, ...values) : 0;
  return { min, max, signed: min < 0 };
}
