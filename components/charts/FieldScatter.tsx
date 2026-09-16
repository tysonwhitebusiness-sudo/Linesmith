'use client';

import { MarkTip } from './MarkTip';
import { CATEGORICAL, FONT_STACK, INK1, INK3, SIZE } from './tokens';
import { useChartWidth } from './useChartWidth';

/**
 * Passes as points on the field, seen from behind the quarterback — R6.2
 * ("Target chart" / "Pass chart", G2 `nflTargetField`). The vertical axis is
 * air yards from the line of scrimmage, which the play-by-play carries per
 * pass; the three columns are nflverse's own `pass_location` (left, middle,
 * right).
 *
 * THE LINE OF SCRIMMAGE IS DRAWN, AND NEGATIVE AIR YARDS SIT BELOW IT. A
 * screen is a real pass with negative air yards (3,192 in one season); clamping
 * it to zero would draw a different play from the one that happened.
 *
 * Colour is the point's group (caught, incomplete, touchdown), assigned in
 * `groups` order from `CATEGORICAL`; groups not in `visible` are not drawn.
 */
export function FieldScatter({
  points,
  groups,
  visible,
  label,
  className,
}: {
  points: ReadonlyArray<readonly [string | null, number, number]>;
  groups: readonly { key: string; label: string }[];
  visible: ReadonlySet<string>;
  label: string;
  className?: string;
}) {
  const [hostRef, measured] = useChartWidth(320);
  const W = Math.min(measured, 460);
  const H = Math.round(Math.min(380, Math.max(260, W * 0.85)));
  const TOP = 14;
  const LOS = H - 34;
  const MIN_YD = -8;
  const MAX_YD = 45;
  const shown = points.filter(([g]) => g && visible.has(g));
  // Clamped so a 60-yard bomb stays on the field rather than stretching every
  // other dot into a line; the tip still says its real air yards.
  const Y = (air: number) => LOS - ((Math.max(MIN_YD, Math.min(MAX_YD, air)) - 0) / MAX_YD) * (LOS - TOP);
  const X = (lat: number) => W / 2 + lat * (W / 2) * 0.86;
  const colorOf = new Map(groups.map((g, i) => [g.key, CATEGORICAL[i % CATEGORICAL.length]]));
  const nameOf = new Map(groups.map((g) => [g.key, g.label]));
  const yardLines = [-5, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45];

  return (
    <div ref={hostRef} className={`min-w-0 ${className ?? ''}`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ display: 'block', margin: '0 auto', maxWidth: '100%', fontFamily: FONT_STACK }}>
        <rect x={0} y={TOP - 6} width={W} height={H - TOP - 8} rx={8} fill="oklch(var(--card-sunk))" />
        {yardLines.map((yd) => (
          <g key={yd}>
            <line x1={0} x2={W} y1={Y(yd)} y2={Y(yd)} stroke={yd === 0 ? INK1 : 'oklch(var(--line))'} strokeWidth={yd === 0 ? 1.5 : 1} />
            {yd % 10 === 0 ? (
              <text x={5} y={Y(yd) - 3} fill={INK3} fontSize={SIZE.label}>
                {yd === 0 ? 'Line of scrimmage' : `${yd} yds`}
              </text>
            ) : null}
          </g>
        ))}
        {[1, 2].map((i) => (
          <line key={i} x1={(W * i) / 3} x2={(W * i) / 3} y1={TOP - 6} y2={H - 20} stroke="oklch(var(--line))" strokeDasharray="4 4" />
        ))}
        {shown.map(([group, lat, air], i) => (
          <MarkTip key={i} tip={`${nameOf.get(group!) ?? group} · ${Math.round(air)} air yards`}>
            <circle cx={X(lat)} cy={Y(air)} r={group === 'touchdown' ? 4.6 : 3.6} fill={colorOf.get(group!) ?? INK3} fillOpacity={group === 'incomplete' ? 0.35 : 0.7} stroke={group === 'incomplete' ? colorOf.get(group!) ?? INK3 : 'none'} />
          </MarkTip>
        ))}
        {['Left', 'Middle', 'Right'].map((side, i) => (
          <text key={side} x={(W * (i + 0.5)) / 3} y={H - 6} fill={INK3} fontSize={SIZE.label} textAnchor="middle">
            {side}
          </text>
        ))}
      </svg>
    </div>
  );
}
