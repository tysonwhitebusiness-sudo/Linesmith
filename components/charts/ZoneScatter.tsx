'use client';

import { MarkTip } from './MarkTip';
import { CATEGORICAL, FONT_STACK, INK1, INK3, SIZE } from './tokens';
import { useChartWidth } from './useChartWidth';

/**
 * Pitches as points on the strike zone, catcher's view — R6.1c ("Pitch
 * locations", G2 `mlbPitchLocations`). Coordinates are Statcast's `plate_x`
 * (feet from the middle of the plate, catcher's view) and `plate_z` (feet above
 * the ground). The zone is drawn at the rule-book width (17 in plate plus a ball
 * either side, ±0.83 ft) and a typical 1.5-3.5 ft height, with its thirds.
 *
 * Colour is the point's group (pitch type), assigned in `groups` order from
 * `CATEGORICAL`; groups not in `visible` are not drawn.
 */
export interface ZoneScatterGroup {
  key: string;
  label: string;
}

export function ZoneScatter({
  points,
  groups,
  visible,
  label,
  className,
}: {
  points: ReadonlyArray<readonly [string | null, number, number]>;
  groups: readonly ZoneScatterGroup[];
  visible: ReadonlySet<string>;
  label: string;
  className?: string;
}) {
  const [hostRef, measured] = useChartWidth(320);
  const W = Math.min(measured, 420);
  const H = Math.round(Math.min(420, W * 0.95));
  // ±2.2 ft across, 0-5 ft up: enough for balls well off the plate.
  const X = (x: number) => W / 2 + (x / 2.2) * (W / 2) * 0.92;
  const Y = (z: number) => H - 18 - (z / 5) * (H - 30);
  const colorOf = new Map(groups.map((g, i) => [g.key, CATEGORICAL[i % CATEGORICAL.length]]));
  const nameOf = new Map(groups.map((g) => [g.key, g.label]));
  const zx0 = X(-0.83);
  const zx1 = X(0.83);
  const zy0 = Y(3.5);
  const zy1 = Y(1.5);
  const plateW = X(0.71) - X(-0.71);
  return (
    <div ref={hostRef} className={`min-w-0 ${className ?? ''}`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ display: 'block', margin: '0 auto', maxWidth: '100%', fontFamily: FONT_STACK }}>
        <rect x={zx0} y={zy0} width={zx1 - zx0} height={zy1 - zy0} fill="oklch(var(--card-sunk))" />
        {[1, 2].map((i) => (
          <g key={i}>
            <line x1={zx0 + ((zx1 - zx0) * i) / 3} x2={zx0 + ((zx1 - zx0) * i) / 3} y1={zy0} y2={zy1} stroke="oklch(var(--line))" />
            <line x1={zx0} x2={zx1} y1={zy0 + ((zy1 - zy0) * i) / 3} y2={zy0 + ((zy1 - zy0) * i) / 3} stroke="oklch(var(--line))" />
          </g>
        ))}
        {points.map((p, i) => {
          const [group, x, z] = p;
          if (!group || !visible.has(group)) return null;
          return (
            <MarkTip key={i} tip={`${nameOf.get(group) ?? group} · ${x.toFixed(2)} ft across · ${z.toFixed(2)} ft up`}>
              <circle cx={X(x)} cy={Y(z)} r={3.4} fill={colorOf.get(group) ?? INK3} fillOpacity={0.55} />
            </MarkTip>
          );
        })}
        <rect x={zx0} y={zy0} width={zx1 - zx0} height={zy1 - zy0} fill="none" stroke={INK1} strokeWidth={1.5} />
        <path d={`M${X(-0.71)},${Y(0.25)}h${plateW}l-6,8l${-(plateW - 12) / 2},6l${-(plateW - 12) / 2},-6Z`} fill="oklch(var(--card-sunk))" stroke="oklch(var(--line))" />
        <text x={W / 2} y={H - 2} fill={INK3} fontSize={SIZE.label} textAnchor="middle">
          Catcher&apos;s view
        </text>
      </svg>
    </div>
  );
}

