'use client';

import { heatFill, heatInk, rankToHeat } from '@/lib/ui/heat';
import { GRID, INK3, INK4, SIZE, SURFACE, type Formatter } from './tokens';
import { fmt as fmts } from './tokens';

/**
 * 05 · PercentileRail — ranked stats. The radar-chart replacement.
 *
 * WHY NOT A RADAR. A radar chart's area is a function of the arbitrary order
 * its axes happen to be in — reorder them and the same player's shape changes
 * completely — and its axes almost never share a unit. A stack of rails is
 * boring and honest: one row per stat, every row on the same 0–100 percentile
 * scale, sorted however the caller means them to be read.
 *
 * Each row carries the real value AND the percentile position, because a
 * percentile alone is unfalsifiable to a reader: "83rd percentile" means
 * nothing without knowing that it is 4.6 runs per game out of 30 teams.
 *
 * COLOUR IS A SECOND ENCODING, NEVER THE ONLY ONE. Position along the rail is
 * primary; the fill reinforces it. `lib/ui/heat.ts`'s poles pass a deutan check
 * by 0.4 ΔE, which is a pass and not a margin worth relying on alone.
 */
export interface PercentileRailRow {
  key: string;
  label: string;
  value: number;
  /** 1 = best. */
  rank: number;
  poolSize: number;
  format?: Formatter;
}

export interface PercentileRailProps {
  rows: readonly PercentileRailRow[];
  /** Row height in px. */
  rowHeight?: number;
  width?: number;
  /** Show "4th of 30" beside each row. */
  showRank?: boolean;
  label: string;
  className?: string;
}

export function PercentileRail({
  rows,
  rowHeight = 22,
  width = 320,
  showRank = true,
  label,
  className,
}: PercentileRailProps) {
  const usable = rows.filter((r) => Number.isFinite(r.value) && r.poolSize > 1);
  if (usable.length === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded-[6px] border border-dashed border-line-soft px-4 py-6 ${className ?? ''}`}
        role="img"
        aria-label={`${label}: no ranked stats`}
      >
        <p className="text-[11px] text-ink-faint">No league-ranked stats for this sport yet.</p>
      </div>
    );
  }

  const labelW = 108;
  const valueW = 46;
  const rankW = showRank ? 54 : 0;
  const railLeft = labelW;
  const railWidth = Math.max(40, width - labelW - valueW - rankW);
  const height = usable.length * rowHeight;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={label}
      className={className}
      style={{ display: 'block', overflow: 'visible', maxWidth: width }}
    >
      {usable.map((r, i) => {
        // Percentile from rank, so a rail and a unit grade never disagree —
        // `unitGrades.ts` uses the identical formula.
        const pct = 100 * (1 - (r.rank - 1) / (r.poolSize - 1));
        const t = rankToHeat(pct, 0, 100);
        const y = i * rowHeight + rowHeight / 2;
        const railY = y - 3;
        const dotX = railLeft + (pct / 100) * railWidth;
        const f = r.format ?? fmts.one;
        return (
          <g key={r.key}>
            <text x={0} y={y + 3} fill={INK3} fontSize={SIZE.label}>
              {r.label}
            </text>
            <rect x={railLeft} y={railY} width={railWidth} height={6} rx={3} fill={GRID} />
            <rect x={railLeft} y={railY} width={Math.max(2, (pct / 100) * railWidth)} height={6} rx={3} fill={heatFill(t, 0.5)} />
            <circle cx={dotX} cy={railY + 3} r={4.4} fill={SURFACE} />
            <circle cx={dotX} cy={railY + 3} r={3} fill={heatInk(t)} />
            <text
              x={railLeft + railWidth + valueW - 6}
              y={y + 3}
              fill={heatInk(t)}
              fontSize={SIZE.value}
              fontWeight={600}
              textAnchor="end"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {f(r.value)}
            </text>
            {showRank ? (
              <text
                x={width}
                y={y + 3}
                fill={INK4}
                fontSize={SIZE.tick}
                textAnchor="end"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {`${r.rank} of ${r.poolSize}`}
              </text>
            ) : null}
            <title>{`${r.label}: ${f(r.value)}, ${r.rank} of ${r.poolSize}`}</title>
          </g>
        );
      })}
    </svg>
  );
}
