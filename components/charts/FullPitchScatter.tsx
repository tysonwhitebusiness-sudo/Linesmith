'use client';

import { MarkTip } from './MarkTip';
import { SIDE_COLOR } from './FieldLanes';
import { CATEGORICAL, FONT_STACK, SIZE } from './tokens';
import { useChartWidth } from './useChartWidth';

/**
 * Every located shot of a match on the whole pitch — R8.3's soccer shot map
 * (G2 `game-soccer-tennis.js`). A point is `[group, x, y]`, 0-100 each, with x
 * running from the LEFT goal line: the away team attacks the left goal and the
 * home team the right. ESPN's commentary normalises every event to the team in
 * possession attacking x = 100, so the reader mirrors the away side before it
 * gets here.
 *
 * Geometry is real: a 105 by 68 m pitch, the 16.5 m box (40.3 m wide), the
 * 5.5 m six-yard box and the centre circle's 9.15 m radius. A goal is a large
 * filled dot; a shot on target or off the woodwork is filled; a miss or a block
 * is a ring. Groups named `away` and `home` take the two side colours.
 */
export function FullPitchScatter({
  points,
  emphasis,
  filled,
  tips,
  groups,
  visible,
  ends,
  label,
  className,
}: {
  points: ReadonlyArray<readonly [string | null, number, number]>;
  emphasis?: readonly boolean[];
  /** Per point: a shot on target, drawn filled. */
  filled?: readonly boolean[];
  tips?: ReadonlyArray<readonly string[]>;
  groups: readonly { key: string; label: string }[];
  visible: ReadonlySet<string>;
  ends?: { left: string; right: string };
  label: string;
  className?: string;
}) {
  const [hostRef, W] = useChartWidth(320);
  const H = Math.round(W * (68 / 105));
  const X = (x: number) => (x / 100) * W;
  const Y = (y: number) => (y / 100) * H;
  const colorOf = (key: string | null) => {
    if (key === 'away' || key === 'home') return SIDE_COLOR[key];
    const i = groups.findIndex((g) => g.key === key);
    return CATEGORICAL[Math.max(0, i) % CATEGORICAL.length];
  };
  const line = { fill: 'none', stroke: 'oklch(99% 0 0 / 0.85)', strokeWidth: 1.5 };
  const boxDepth = (16.5 / 105) * 100;
  const sixDepth = (5.5 / 105) * 100;
  const order = points.map((_, i) => i).filter((i) => points[i][0] == null || visible.has(points[i][0] as string));
  // Goals last, so no miss is drawn over one.
  order.sort((a, b) => Number(emphasis?.[a] ?? false) - Number(emphasis?.[b] ?? false));

  return (
    <div ref={hostRef} className={`min-w-0 ${className ?? ''}`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ display: 'block', fontFamily: FONT_STACK }}>
        <rect x={0} y={0} width={W} height={H} rx={8} fill="oklch(62% 0.09 150)" />
        <line x1={X(50)} x2={X(50)} y1={0} y2={H} {...line} />
        <circle cx={X(50)} cy={Y(50)} r={(9.15 / 105) * W} {...line} />
        {[0, 100].map((side) => (
          <g key={side}>
            <rect x={side ? X(100 - boxDepth) : 0} y={Y(20.4)} width={X(boxDepth)} height={Y(79.6) - Y(20.4)} {...line} />
            <rect x={side ? X(100 - sixDepth) : 0} y={Y(36.8)} width={X(sixDepth)} height={Y(63.2) - Y(36.8)} {...line} />
            <rect x={side ? W - 4 : 0} y={Y(44.6)} width={4} height={Y(55.4) - Y(44.6)} fill="white" />
          </g>
        ))}
        {ends ? (
          <>
            <text x={X(25)} y={16} fill="white" fontSize={SIZE.label} fontWeight={600} textAnchor="middle">
              ← {ends.left}
            </text>
            <text x={X(75)} y={16} fill="white" fontSize={SIZE.label} fontWeight={600} textAnchor="middle">
              {ends.right} →
            </text>
          </>
        ) : null}
        {order.map((i) => {
          const [group, x, y] = points[i];
          const colour = colorOf(group);
          const goal = emphasis?.[i] === true;
          const on = filled?.[i] === true;
          return (
            <MarkTip key={i} tip={tips?.[i]?.join(' · ') ?? ''}>
              {goal ? (
                <circle cx={X(x)} cy={Y(y)} r={8} fill="white" stroke={colour} strokeWidth={4} />
              ) : (
                <circle cx={X(x)} cy={Y(y)} r={on ? 5.5 : 5} fill={on ? colour : 'none'} stroke={colour} strokeWidth={2} />
              )}
            </MarkTip>
          );
        })}
      </svg>
    </div>
  );
}
