'use client';

import { MarkTip } from './MarkTip';
import { CATEGORICAL, FONT_STACK, INK1, INK3, SIZE } from './tokens';
import { useChartWidth } from './useChartWidth';

/**
 * Every attempt in the offensive zone — R6.5 ("Shot map", G2 `nhlRinkMap`).
 *
 * THE SIGN OF `x` IS NOT THE SIDE OF THE ICE, it is which end the shooting team
 * was attacking, and teams switch ends every period. `nhl_shot_events` stores
 * `x` -100..100 with the goals at ±89, so an unnormalised season folds into a
 * blur about the red line — measured in `shotProfileShapes.ts`, where mean `x`
 * by period ran -12, -10, +16, -3, -32 while mean |x| held at 53-70.
 *
 * Normalisation is a 180° ROTATION, not `abs(x)`: switching ends mirrors BOTH
 * axes, so a shot at (-73, 11) is the same shot as (73, -11). Negating only x
 * would move a right-wing shot to the left wing. `playerShotMapShapes.ts` does
 * the rotation; this component receives shots already at the positive end and
 * draws them as feet from the goal line.
 *
 * The lines are real geometry, in feet: rink 85 wide (y ±42.5), goal line 11
 * from the end boards (x 89), blue line at x 25, faceoff dots at (69, ±22),
 * circles r 15, crease 6 deep and 8 wide. The trapezoid is left out — it
 * constrains the goalie, not a shooter, and would only add ink.
 */

/**
 * Feet from the goal line, out towards the blue line at 64. A few attempts come
 * from beyond it (a dump-in, an empty-net shot from the far end) and are
 * clamped to the edge rather than dropped, so the map still counts what the
 * table counts; drawing the full 75 ft left a dead band under the blue line.
 */
const OUT_MAX = 68;
const OUT_MIN = -11;
const HALF_W = 42.5;
const GOAL_X = 89;

export function RinkScatter({
  points,
  emphasis,
  tips,
  groups,
  visible,
  label,
  className,
}: {
  /** `[group, y across the ice (±42.5), x as the table stores it (±100)]`, already rotated to the positive end. */
  points: ReadonlyArray<readonly [string | null, number, number]>;
  /** A goal. Where given, it colours the dot instead of the group. */
  emphasis?: readonly boolean[];
  tips?: ReadonlyArray<readonly string[]>;
  groups: readonly { key: string; label: string }[];
  visible: ReadonlySet<string>;
  label: string;
  className?: string;
}) {
  const [hostRef, measured] = useChartWidth(320);
  const W = Math.min(measured, 560);
  const H = Math.round((W * (OUT_MAX - OUT_MIN)) / (2 * HALF_W));
  /** Across the ice, left to right. */
  const X = (y: number) => ((y + HALF_W) / (2 * HALF_W)) * W;
  /** Out from the goal line, which sits near the top. */
  const Y = (out: number) => ((out - OUT_MIN) / (OUT_MAX - OUT_MIN)) * H;
  const out = (x: number) => GOAL_X - Math.abs(x);
  const ft = W / (2 * HALF_W);
  const colorOf = new Map(groups.map((g, i) => [g.key, CATEGORICAL[i % CATEGORICAL.length]]));
  const line = { fill: 'none', stroke: 'oklch(var(--line))', strokeWidth: 1.5 };

  const order = points.map((_, i) => i).filter((i) => points[i][0] == null || visible.has(points[i][0] as string));

  return (
    <div ref={hostRef} className={`min-w-0 ${className ?? ''}`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ display: 'block', margin: '0 auto', maxWidth: '100%', fontFamily: FONT_STACK }}>
        <rect x={0} y={0} width={W} height={H} rx={8} fill="oklch(var(--card-sunk))" />

        {/* Goal line, crease and net. */}
        <line x1={0} x2={W} y1={Y(0)} y2={Y(0)} stroke="oklch(var(--line))" strokeWidth={1.5} />
        <path d={`M${X(-4)},${Y(0)} A${6 * ft},${6 * ft} 0 0 0 ${X(4)},${Y(0)}`} {...line} />
        <rect x={X(-3)} y={Y(0) - 4 * ft} width={X(3) - X(-3)} height={4 * ft} fill="none" stroke={INK1} strokeWidth={1.5} />

        {/* Faceoff circles and the blue line that closes the zone. */}
        <circle cx={X(-22)} cy={Y(20)} r={15 * ft} {...line} />
        <circle cx={X(22)} cy={Y(20)} r={15 * ft} {...line} />
        <circle cx={X(-22)} cy={Y(20)} r={1.5} fill="oklch(var(--line))" />
        <circle cx={X(22)} cy={Y(20)} r={1.5} fill="oklch(var(--line))" />
        <line x1={0} x2={W} y1={Y(64)} y2={Y(64)} stroke="oklch(var(--line))" strokeWidth={3} />

        {order.map((i) => {
          const [group, across, x] = points[i];
          const goal = emphasis?.[i] === true;
          const colour = emphasis ? (goal ? 'rgb(var(--good))' : INK3) : (colorOf.get(group ?? '') ?? INK3);
          const o = out(x);
          const tip = tips?.[i]?.join(' · ') ?? `${o.toFixed(0)} ft out`;
          return (
            <MarkTip key={i} tip={tip}>
              <circle
                cx={X(Math.max(-HALF_W, Math.min(HALF_W, across)))}
                cy={Y(Math.max(OUT_MIN, Math.min(OUT_MAX, o)))}
                r={3}
                fill={colour}
                fillOpacity={goal ? 0.85 : 0.14}
                stroke={colour}
                strokeOpacity={goal ? 1 : 0.5}
                strokeWidth={1}
              />
            </MarkTip>
          );
        })}

        <text x={W / 2} y={Y(0) - 6 * ft - 4} fill={INK3} fontSize={SIZE.label} textAnchor="middle">
          Net
        </text>
        <text x={4} y={Y(64) - 5} fill={INK3} fontSize={SIZE.label}>
          Blue line
        </text>
      </svg>
    </div>
  );
}
