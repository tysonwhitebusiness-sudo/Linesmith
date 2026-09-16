'use client';

import { MarkTip } from './MarkTip';
import { CATEGORICAL, FONT_STACK, INK1, INK3, SIZE } from './tokens';
import { useChartWidth } from './useChartWidth';

/**
 * Shots on the attacking half — R6.3 ("Shot map", G2 `soccerShotMap`).
 *
 * Understat normalises a shot to `X` (0 at the player's own goal line, 1 at the
 * goal he is attacking) and `Y` (0-1 across the pitch), so the attacking half is
 * X 0.5-1 and this draws it with that goal at the TOP: the picture a viewer
 * behind the net sees, and the one a shot map is always drawn as.
 *
 * THE BOX IS REAL GEOMETRY, not a rounded rectangle: a penalty area is 16.5m
 * deep on a 105m pitch (X 0.843) and 40.3m wide on a 68m one (Y 0.204-0.796);
 * the six-yard box is 5.5m by 18.3m (X 0.948, Y 0.366-0.634) and the spot is
 * 11m out (X 0.895). A shot map on arbitrary thirds puts the penalty spot on a
 * boundary.
 *
 * SIZE IS THE CHANCE, COLOUR IS THE OUTCOME. `weights` is xG, and the radius
 * grows with its square root so area — what the eye compares — is proportional
 * to it. `emphasis` (a goal) fills the dot; everything else is a light outline,
 * so a hundred misses never hide the goals. Where no emphasis is given, the
 * point's group colours it, as on the other surfaces.
 */
export function PitchScatter({
  points,
  weights,
  emphasis,
  tips,
  groups,
  visible,
  label,
  className,
}: {
  points: ReadonlyArray<readonly [string | null, number, number]>;
  weights?: readonly number[];
  emphasis?: readonly boolean[];
  tips?: ReadonlyArray<readonly string[]>;
  groups: readonly { key: string; label: string }[];
  visible: ReadonlySet<string>;
  label: string;
  className?: string;
}) {
  const [hostRef, measured] = useChartWidth(320);
  const W = Math.min(measured, 460);
  const H = Math.round(W * 0.78);
  const X = (y: number) => y * W;
  const Y = (x: number) => H - ((x - 0.5) / 0.5) * H;
  const colorOf = new Map(groups.map((g, i) => [g.key, CATEGORICAL[i % CATEGORICAL.length]]));
  const line = { fill: 'none', stroke: 'oklch(var(--line))', strokeWidth: 1.5 };

  // Biggest first, so a small chance is never hidden under a penalty.
  const order = points
    .map((p, i) => i)
    .filter((i) => points[i][0] == null || visible.has(points[i][0] as string))
    .sort((a, b) => (weights?.[b] ?? 0) - (weights?.[a] ?? 0));

  return (
    <div ref={hostRef} className={`min-w-0 ${className ?? ''}`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ display: 'block', margin: '0 auto', maxWidth: '100%', fontFamily: FONT_STACK }}>
        <rect x={0} y={0} width={W} height={H} rx={8} fill="oklch(var(--card-sunk))" />
        <rect x={X(0.204)} y={Y(1)} width={X(0.796) - X(0.204)} height={Y(0.843) - Y(1)} {...line} />
        <rect x={X(0.366)} y={Y(1)} width={X(0.634) - X(0.366)} height={Y(0.948) - Y(1)} {...line} />
        <path d={`M${X(0.4)},${Y(0.843)} A${W * 0.087},${W * 0.087} 0 0 0 ${X(0.6)},${Y(0.843)}`} {...line} />
        <circle cx={X(0.5)} cy={Y(0.895)} r={2.5} fill="oklch(var(--line))" />
        <rect x={X(0.45)} y={Y(1) - 4} width={X(0.55) - X(0.45)} height={4} fill={INK1} />
        <line x1={0} x2={W} y1={H - 1} y2={H - 1} {...line} />
        {order.map((i) => {
          const [group, y, x] = points[i];
          const w = weights?.[i] ?? 0;
          const goal = emphasis?.[i] === true;
          const colour = emphasis ? (goal ? 'rgb(var(--good))' : INK3) : (colorOf.get(group ?? '') ?? INK3);
          const tip = tips?.[i]?.join(' · ') ?? `${(w * 100).toFixed(0)}% chance`;
          return (
            <MarkTip key={i} tip={tip}>
              <circle
                cx={X(y)}
                cy={Y(x)}
                r={3 + Math.sqrt(Math.max(0, w)) * 13}
                fill={colour}
                fillOpacity={goal ? 0.85 : 0.18}
                stroke={colour}
                strokeOpacity={goal ? 1 : 0.55}
                strokeWidth={1}
              />
            </MarkTip>
          );
        })}
        <text x={W / 2} y={14} fill={INK3} fontSize={SIZE.label} textAnchor="middle">
          Attacking goal
        </text>
      </svg>
    </div>
  );
}
