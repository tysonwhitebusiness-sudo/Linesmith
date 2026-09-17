'use client';

import { MarkTip } from './MarkTip';
import { FONT_STACK, GRID, INK1, INK3, INK4, SIZE } from './tokens';
import { useChartWidth } from './useChartWidth';

export interface FieldLane {
  key: string;
  side: 'away' | 'home';
  from: number;
  to: number;
  label: string | null;
  strong: boolean;
  dashed?: boolean;
  mark?: 'turnover' | 'penalty' | null;
  tip: string[];
}

/** Team colours for the two sides of a comparison: `--cmp-a` away, `--cmp-b` home (the G2 side colours). */
export const SIDE_COLOR = { away: 'rgb(var(--cmp-a))', home: 'rgb(var(--cmp-b))' } as const;
const MARK_COLOR = { turnover: 'rgb(var(--bad))', penalty: INK4 } as const;

/**
 * A football field with one lane per row — R8.2's drive chart and a drive's
 * plays (G2 `game-football.js`). x is yards from the LEFT goal line; the away
 * team defends the left end zone. Each lane runs from where the movement began
 * to where it ended, a dot at the start, the result beside it.
 */
export function FieldLanes({ rows, ends, label, className }: { rows: readonly FieldLane[]; ends: { left: string; right: string }; label: string; className?: string }) {
  const [hostRef, W] = useChartWidth(320);
  const ez = Math.max(26, Math.round(W * 0.06));
  const fw = W - 2 * ez;
  const lane = rows.length > 24 ? 16 : 20;
  const top = 22;
  const H = top + rows.length * lane + 10;
  const X = (x: number) => ez + (Math.max(0, Math.min(100, x)) / 100) * fw;

  return (
    <div ref={hostRef} className={`min-w-0 ${className ?? ''}`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ display: 'block', fontFamily: FONT_STACK }}>
        <rect x={0} y={top - 6} width={W} height={H - top + 2} rx={8} fill="oklch(96.5% 0.012 150)" />
        <rect x={0} y={top - 6} width={ez} height={H - top + 2} rx={8} fill={SIDE_COLOR.away} opacity={0.18} />
        <rect x={W - ez} y={top - 6} width={ez} height={H - top + 2} rx={8} fill={SIDE_COLOR.home} opacity={0.18} />
        {Array.from({ length: 9 }, (_, i) => (i + 1) * 10).map((yd) => (
          <g key={yd}>
            <line x1={X(yd)} x2={X(yd)} y1={top - 6} y2={H - 4} stroke={yd === 50 ? INK4 : GRID} />
            <text x={X(yd)} y={12} fill={INK3} fontSize={SIZE.tick} textAnchor="middle">
              {yd <= 50 ? yd : 100 - yd}
            </text>
          </g>
        ))}
        <text x={ez / 2} y={12} fill={INK3} fontSize={SIZE.tick} fontWeight={600} textAnchor="middle">
          {ends.left}
        </text>
        <text x={W - ez / 2} y={12} fill={INK3} fontSize={SIZE.tick} fontWeight={600} textAnchor="middle">
          {ends.right}
        </text>
        {rows.map((r, i) => {
          const y = top + i * lane + lane / 2 - 2;
          const x1 = X(r.from);
          const x2 = X(r.to);
          const colour = r.mark ? MARK_COLOR[r.mark] : SIDE_COLOR[r.side];
          // The label sits past where the movement ENDED, in its direction (a home
          // drive runs left, so its "TD" belongs at the left end zone). Where that
          // would run off the chart it is pinned inside the end zone, never moved
          // back to the start, which would put a touchdown at the wrong end.
          const leftward = x2 < x1;
          const labelLeft = leftward;
          const labelX = leftward ? Math.min(x1, x2) - 8 : Math.max(x1, x2) + 8;
          // 44 px is room for a short result ("PUNT", "TD").
          const pinned = leftward ? labelX < 44 : labelX > W - 44;
          return (
            <MarkTip key={r.key} tip={r.tip.join(' · ')}>
              <g>
                <rect x={0} y={y - lane / 2 + 1} width={W} height={lane - 2} fill="transparent" />
                <line x1={x1} x2={x2 === x1 ? x1 + 0.5 : x2} y1={y} y2={y} stroke={colour} strokeWidth={r.strong ? 7 : 5} strokeLinecap="round" strokeDasharray={r.dashed ? '6 4' : undefined} opacity={r.strong ? 1 : 0.6} />
                <circle cx={x1} cy={y} r={3} fill="oklch(var(--card))" stroke={colour} strokeWidth={2} />
                {r.label ? (
                  <text
                    x={pinned ? (leftward ? 4 : W - 4) : labelX}
                    y={y + 3.5}
                    fill={r.strong ? INK1 : INK3}
                    fontSize={SIZE.label}
                    fontWeight={r.strong ? 700 : 500}
                    textAnchor={pinned ? (leftward ? 'start' : 'end') : labelLeft ? 'end' : 'start'}
                  >
                    {r.label}
                  </text>
                ) : null}
              </g>
            </MarkTip>
          );
        })}
      </svg>
    </div>
  );
}
