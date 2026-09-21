'use client';

import { MarkTip } from './MarkTip';
import { CATEGORICAL, FONT_STACK, INK3, SIZE } from './tokens';
import { useChartWidth } from './useChartWidth';

/**
 * Batted balls on a baseball field — R8.1, the game page's spray chart (G2
 * `game-mlb.js`). A point is `[group, x, y]` in FEET from home plate, x toward
 * right field, y toward center.
 *
 * COLOUR IS THE TEAM, FILL IS THE OUTCOME, SIZE IS EXIT VELOCITY. A hit is a
 * filled dot and an out a ring, so the outcome survives without colour.
 * `weights` carries exit velocity in mph. The outline is a generic park: no
 * park's real walls are held.
 */
export function SprayScatter({
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
  const W = Math.min(measured, 520);
  const H = Math.round(Math.min(W * 0.8, 440));
  const S = (H - 24) / 440;
  const cx = W / 2;
  const cy = H - 12;
  const P = (x: number, y: number) => [cx + x * S, cy - y * S] as const;
  const colorOf = new Map(groups.map((g, i) => [g.key, CATEGORICAL[i % CATEGORICAL.length]]));
  const arc = (r: number) => {
    const [x1, y1] = P(-r * Math.SQRT1_2, r * Math.SQRT1_2);
    const [x2, y2] = P(r * Math.SQRT1_2, r * Math.SQRT1_2);
    return `M${cx},${cy} L${x1},${y1} A${r * S},${r * S} 0 0 1 ${x2},${y2} Z`;
  };
  const diamond = [P(0, 0), P(63.6, 63.6), P(0, 127.3), P(-63.6, 63.6)];
  // Softest first, so a hard-hit ball is never hidden under a bloop.
  const order = points
    .map((_, i) => i)
    .filter((i) => points[i][0] == null || visible.has(points[i][0] as string))
    .sort((a, b) => (weights?.[a] ?? 0) - (weights?.[b] ?? 0));

  return (
    <div ref={hostRef} className={`min-w-0 ${className ?? ''}`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ display: 'block', margin: '0 auto', maxWidth: '100%', fontFamily: FONT_STACK }}>
        <path d={arc(400)} fill="oklch(95.5% 0.03 150)" stroke="oklch(80% 0.04 150)" />
        <path d={arc(150)} fill="oklch(92% 0.035 70)" opacity={0.7} />
        <path d={`M${diamond.map(([x, y]) => `${x},${y}`).join(' L')} Z`} fill="none" stroke="white" strokeWidth={2} />
        {[300, 350, 400].map((r) => {
          const [tx, ty] = P(0, r);
          return (
            <text key={r} x={tx} y={ty - 3} fill={INK3} fontSize={SIZE.tick} textAnchor="middle">
              {r} ft
            </text>
          );
        })}
        {order.map((i) => {
          const [group, x, y] = points[i];
          const [px, py] = P(x, y);
          const colour = colorOf.get(group ?? '') ?? INK3;
          const ev = weights?.[i] ?? 70;
          const r = 3 + Math.max(0, (ev - 70) / 8);
          const hit = emphasis?.[i] === true;
          return (
            <MarkTip key={i} tip={tips?.[i]?.join(' · ') ?? ''}>
              <circle cx={px} cy={py} r={r} fill={hit ? colour : 'oklch(var(--card))'} stroke={hit ? 'oklch(var(--card))' : colour} strokeWidth={hit ? 1.5 : 1.8} />
            </MarkTip>
          );
        })}
      </svg>
    </div>
  );
}
