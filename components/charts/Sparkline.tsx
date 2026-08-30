'use client';

import { compareInk, deltaToHeat } from '@/lib/ui/heat';
import { SURFACE, INK4 } from './tokens';
import { linePath, niceDomain, xScale, yScale } from './scale';

/**
 * 01 · Sparkline — trend at table-row scale, no axes.
 *
 * Deliberately axis-less and label-less: at 46×15 there is no room for a tick
 * that would be legible, and a chart that prints an illegible number is worse
 * than one that prints none. The row it sits in already carries the current
 * value; the sparkline's whole job is the SHAPE that got there.
 *
 * NOT ZERO-BASED, and this is the one primitive where that is unambiguously
 * right: a sparkline shows movement, so it scales to the series' own range.
 * Anchoring it at zero would flatten every line-movement row in the app into a
 * horizontal rule. Contrast `RollingChart`, where the choice is genuinely the
 * caller's — see `scale.ts`.
 *
 * The end dot carries a two-layer ring: a surface-coloured circle under the
 * coloured one, so the dot stays visible where the line crosses back over
 * itself. Its colour is the direction of travel over the whole window, through
 * `compareInk` (red -> neutral grey -> green), NOT `heatFill` — the fill ramp
 * puts amber at its midpoint, which asserts "caution" where the data only says
 * "flat". See the ramp finding in the handoff notes.
 */
export interface SparklineProps {
  values: readonly number[];
  width?: number;
  height?: number;
  /**
   * Direction that counts as good. Line movement toward the bettor is a
   * shortening price, so a falling series is favourable — pass `'down'` there.
   * Defaults to `'up'`, the ordinary "more is better" reading.
   */
  goodDirection?: 'up' | 'down';
  /** Accessible description — required, since there is no visible label. */
  label: string;
  className?: string;
}

export function Sparkline({
  values,
  width = 46,
  height = 15,
  goodDirection = 'up',
  label,
  className,
}: SparklineProps) {
  const finite = values.filter((v) => Number.isFinite(v));
  // Two points is the minimum that can show a direction. One point is a dot
  // pretending to be a trend, so it renders nothing rather than a flat line
  // that reads as "no movement" when the truth is "no history".
  if (finite.length < 2) {
    return <span className={className} aria-label={`${label}: not enough history`} role="img" />;
  }

  const pad = 3;
  const domain = niceDomain(values, { zeroBased: false, pad: 0 });
  const x = xScale(values.length, pad, width - pad * 2);
  const y = yScale(domain, pad, height - pad * 2);

  const first = finite[0];
  const last = finite[finite.length - 1];
  const change = (last - first) / (Math.abs(first) || 1);
  const heat = deltaToHeat(goodDirection === 'down' ? -change : change, 0.25);

  const lastIndex = values.length - 1 - [...values].reverse().findIndex((v) => Number.isFinite(v));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className={className}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <path
        d={linePath(values, x, y)}
        fill="none"
        stroke={INK4}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={x(lastIndex)} cy={y(last)} r={3.6} fill={SURFACE} />
      <circle cx={x(lastIndex)} cy={y(last)} r={2.4} fill={compareInk(heat)} />
    </svg>
  );
}
