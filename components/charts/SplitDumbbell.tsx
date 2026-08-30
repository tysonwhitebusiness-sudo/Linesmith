'use client';

import { compareInk } from '@/lib/ui/heat';
import { GRID, INK3, INK4, SIZE, SURFACE, type Formatter } from './tokens';
import { fmt as fmts } from './tokens';

/**
 * 11 · SplitDumbbell — A vs B on one shared scale.
 *
 * Two dots joined by a line, one row per stat. The dots' positions are the two
 * values; the connector's LENGTH is the split, which is the thing being read.
 * Two bars side by side encode the same numbers but make the reader do the
 * subtraction; a dumbbell shows the gap directly.
 *
 * ONE SCALE PER ROW, not one across the grid. Rows are usually different units
 * (a rate beside a count), so each row scales to its own pair plus padding. The
 * comparison being made is always within a row — "how different are A and B on
 * this stat" — never across rows.
 *
 * THE ROLE, NOT THE SPORT. This is `binarySplit` in the six-role vocabulary: MLB
 * vs LHP/RHP, NFL man/zone, NHL power play/even strength, soccer home/away,
 * tennis hard/clay. The component never learns which — it takes two labels and
 * two numbers.
 */
export interface SplitDumbbellRow {
  key: string;
  label: string;
  a: number | null;
  b: number | null;
  format?: Formatter;
  /** Sample sizes, shown in the tooltip. A split off three games is not a split. */
  aSample?: number | null;
  bSample?: number | null;
  /** Lower is better for this stat, so the colour of the gap flips. */
  lowerIsBetter?: boolean;
}

export interface SplitDumbbellProps {
  rows: readonly SplitDumbbellRow[];
  /** Legend labels for the two sides, e.g. "vs LHP" / "vs RHP". */
  aLabel: string;
  bLabel: string;
  width?: number;
  rowHeight?: number;
  label: string;
  className?: string;
}

export function SplitDumbbell({
  rows,
  aLabel,
  bLabel,
  width = 340,
  rowHeight = 26,
  label,
  className,
}: SplitDumbbellProps) {
  const usable = rows.filter((r) => r.a != null && r.b != null && Number.isFinite(r.a) && Number.isFinite(r.b));
  if (usable.length === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded-[6px] border border-dashed border-line-soft px-4 py-6 ${className ?? ''}`}
        role="img"
        aria-label={`${label}: no split recorded`}
      >
        <p className="text-[11px] text-ink-faint">No split data for this subject yet.</p>
      </div>
    );
  }

  const labelW = 96;
  const numW = 42;
  const trackLeft = labelW + numW;
  const trackWidth = Math.max(40, width - labelW - numW * 2);
  const height = usable.length * rowHeight + 14;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={`${label}: ${aLabel} versus ${bLabel}`}
      className={className}
      style={{ display: 'block', overflow: 'visible', maxWidth: width }}
    >
      <text x={trackLeft} y={9} fill={INK4} fontSize={SIZE.tick}>
        {aLabel}
      </text>
      <text x={trackLeft + trackWidth} y={9} fill={INK4} fontSize={SIZE.tick} textAnchor="end">
        {bLabel}
      </text>

      {usable.map((r, i) => {
        const a = r.a as number;
        const b = r.b as number;
        const f = r.format ?? fmts.two;
        // Per-row scale: rows carry different units, so a shared domain would
        // squash every rate row against one count row.
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const pad = (hi - lo) * 0.35 || Math.max(Math.abs(hi) * 0.1, 0.5);
        const dLo = lo - pad;
        const dHi = hi + pad;
        const x = (v: number) => trackLeft + ((v - dLo) / (dHi - dLo || 1)) * trackWidth;
        const y = 14 + i * rowHeight + rowHeight / 2;

        const bBetter = r.lowerIsBetter ? b < a : b > a;
        const gapHeat = bBetter ? 0.82 : 0.18;

        return (
          <g key={r.key}>
            <text x={0} y={y + 3} fill={INK3} fontSize={SIZE.label}>
              {r.label}
            </text>
            <line x1={trackLeft} x2={trackLeft + trackWidth} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
            <line x1={x(a)} x2={x(b)} y1={y} y2={y} stroke={compareInk(gapHeat)} strokeWidth={2.5} strokeLinecap="round" />

            <circle cx={x(a)} cy={y} r={4.6} fill={SURFACE} />
            <circle cx={x(a)} cy={y} r={3.2} fill={INK4} />
            <circle cx={x(b)} cy={y} r={4.6} fill={SURFACE} />
            <circle cx={x(b)} cy={y} r={3.2} fill={compareInk(gapHeat)} />

            <text x={labelW + numW - 8} y={y + 3} fill={INK4} fontSize={SIZE.tick} textAnchor="end" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {f(a)}
            </text>
            <text x={width} y={y + 3} fill={INK3} fontSize={SIZE.tick} textAnchor="end" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {f(b)}
            </text>
            <title>
              {`${r.label} — ${aLabel} ${f(a)}${r.aSample != null ? ` (n=${r.aSample})` : ''} vs ${bLabel} ${f(b)}${
                r.bSample != null ? ` (n=${r.bSample})` : ''
              }`}
            </title>
          </g>
        );
      })}
    </svg>
  );
}
