'use client';

import { useMemo } from 'react';
import { CONTEXT, CONTEXT_OPACITY, FONT_STACK, GRID, INK3, SIZE } from './tokens';
import { useChartWidth } from './useChartWidth';

/**
 * Several step series on one time axis (odds build P8, the odds section's Line
 * movement: one series per book). A book's price or line holds until it
 * changes, so each series is drawn as steps, not slopes. Unselected books can
 * be drawn as grey CONTEXT behind the selected ones (thin, no markers). A
 * series may carry GAPS — a pulled price is drawn as nothing between the pull
 * and the return, with a tick at the pull. Markers (first movers) are dotted
 * verticals with a label. `liveEdge` draws the "now" guide and (P9) marks
 * each drawn series' newest point, which pulses, and pops in a point that
 * arrived in this refresh. The animation classes come in with `liveEdge`
 * (the odds section owns them and their reduced-motion guard), so a chart
 * without a live edge — a finished game's — draws no motion at all.
 */
export interface StepSeries {
  id: string;
  label: string;
  color: string;
  points: Array<[t: number, v: number]>;
  /** Heavier stroke (Pinnacle). */
  emphasis?: boolean;
  /** Drawn grey, behind, without markers. */
  context?: boolean;
  /** [pulledAt, returnedAt | null] — nothing drawn in between. */
  gaps?: Array<[number, number | null]>;
}

export function StepLines({ series, markers = [], t0, t1, format, liveEdge, height = 240, label, bounds }: {
  series: StepSeries[];
  markers?: Array<{ t: number; label: string }>;
  t0: number;
  t1: number;
  format: (v: number) => string;
  liveEdge?: {
    now: number;
    /** Class on each selected series' newest point (a pulse). */
    pulseClass?: string;
    /** Class on a newest point that arrived in this refresh (a pop), keyed by its time so it plays once. */
    popClass?: string;
    /** Series id -> the time (ms) of a point that just arrived. */
    arrived?: Record<string, number>;
  };
  height?: number;
  label: string;
  /** Hard limits for the value axis (a probability never pads below 0 or above 1). */
  bounds?: [number, number];
}) {
  const [ref, width] = useChartWidth(640);
  const pad = { l: 44, r: 12, t: 16, b: 22 };
  const vals = series.flatMap(s => s.points.map(p => p[1]));
  const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  const span = hi - lo || 1;
  const y0 = Math.max(bounds ? bounds[0] : -Infinity, lo - span * 0.08);
  const y1 = Math.min(bounds ? bounds[1] : Infinity, hi + span * 0.08);
  const X = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (width - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (height - pad.t - pad.b);
  const ticks = useMemo(() => Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4), [y0, y1]);
  const xticks = useMemo(() => Array.from({ length: 6 }, (_, i) => t0 + ((t1 - t0) * i) / 5), [t0, t1]);
  const path = (s: StepSeries) => {
    const pts = s.points.filter(p => p[0] <= t1);
    if (!pts.length) return '';
    const inGap = (t: number) => (s.gaps ?? []).some(([a, b]) => t >= a && (b == null || t < b));
    let d = '', pen = false, last: [number, number] | null = null;
    const start = pts.findIndex(p => p[0] >= t0);
    const from = start <= 0 ? 0 : start - 1;
    for (let i = from; i < pts.length; i++) {
      const [t, v] = pts[i];
      const tt = Math.max(t, t0);
      if (inGap(tt)) { pen = false; last = null; continue; }
      if (!pen || !last) { d += `M${X(tt).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; }
      else d += `H${X(tt).toFixed(1)}V${Y(v).toFixed(1)}`;
      last = [tt, v];
    }
    if (last && !inGap(t1)) d += `H${X(t1).toFixed(1)}`;
    return d;
  };
  const time = (t: number) => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  return (
    <div ref={ref} className="w-full">
      <svg width={width} height={height} role="img" aria-label={label} style={{ fontFamily: FONT_STACK }}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={pad.l} x2={width - pad.r} y1={Y(v)} y2={Y(v)} stroke={GRID} />
            <text x={pad.l - 6} y={Y(v) + 3} textAnchor="end" fontSize={SIZE.tick} fill={INK3}>{format(v)}</text>
          </g>
        ))}
        {xticks.map((t, i) => (
          <text key={i} x={X(t)} y={height - 6} textAnchor="middle" fontSize={SIZE.tick} fill={INK3}>{time(t)}</text>
        ))}
        {series.filter(s => s.context).map(s => (
          <path key={s.id} d={path(s)} fill="none" stroke={CONTEXT} strokeOpacity={CONTEXT_OPACITY} strokeWidth={1} />
        ))}
        {series.filter(s => !s.context).map(s => (
          <g key={s.id}>
            <path d={path(s)} fill="none" stroke={s.color} strokeWidth={s.emphasis ? 2.2 : 1.5} />
            {(s.gaps ?? []).filter(([a]) => a >= t0 && a <= t1).map(([a], i) => {
              const before = [...s.points].reverse().find(p => p[0] <= a);
              return before ? <line key={i} x1={X(a)} x2={X(a)} y1={Y(before[1]) - 5} y2={Y(before[1]) + 5} stroke={s.color} strokeWidth={2} /> : null;
            })}
          </g>
        ))}
        {markers.filter(m => m.t >= t0 && m.t <= t1).map((m, i) => (
          <g key={i}>
            <line x1={X(m.t)} x2={X(m.t)} y1={pad.t} y2={height - pad.b} stroke={INK3} strokeDasharray="3 3" />
            <text x={X(m.t)} y={pad.t - 4} textAnchor="middle" fontSize={SIZE.label} fill={INK3}>{m.label}</text>
          </g>
        ))}
        {liveEdge && liveEdge.now >= t0 && liveEdge.now <= t1 ? (
          <g data-live-edge>
            <line x1={X(liveEdge.now)} x2={X(liveEdge.now)} y1={pad.t} y2={height - pad.b} stroke={INK3} strokeOpacity={0.5} strokeDasharray="2 3" />
            <text x={X(liveEdge.now) - 4} y={height - pad.b - 4} textAnchor="end" fontSize={SIZE.tick} fill={INK3}>now</text>
            {series.filter(s => !s.context && s.points.length).map(s => {
              const last = s.points.filter(p => p[0] <= t1).at(-1);
              if (!last || last[0] < t0) return null;
              const popped = liveEdge.arrived?.[s.id] === last[0];
              return (
                <g key={s.id}>
                  <circle cx={X(t1)} cy={Y(last[1])} r={3.5} fill={s.color} opacity={0.35} className={liveEdge.pulseClass} />
                  <circle key={popped ? `pop-${last[0]}` : 'dot'} cx={X(last[0])} cy={Y(last[1])} r={2.5} fill={s.color}
                    className={popped ? liveEdge.popClass : undefined} data-arrived={popped ? '' : undefined} />
                </g>
              );
            })}
          </g>
        ) : null}
      </svg>
    </div>
  );
}
