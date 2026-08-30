'use client';

import { heatFill, heatInk, rankToHeat } from '@/lib/ui/heat';
import { INK3, INK4, SIZE, MIDDOT, type Formatter } from './tokens';
import { fmt as fmts } from './tokens';

/**
 * 06 · HeatGrid — a matrix of cells shaded by value.
 *
 * ONE PRIMITIVE, TWO ASPECTS. A splits matrix (10 rows × 5 columns) and a
 * strike-zone grid (3 × 3) are the same mark at different proportions, so they
 * are the same component. `aspect` picks between them: `'matrix'` gives wide
 * cells sized for a label, `'zone'` gives square cells sized for a number.
 *
 * ============================ THE BUG THIS FIXES ============================
 *
 * The board's `zoneGrid` hardcoded **three MLB things**: the domain
 * (0.20–0.65), the caption ("catcher view · xwOBA by zone"), and the number
 * format (baseball's strip-the-leading-zero). When NFL used it for
 * yards-per-target, **14.8 rendered as "4.800"** — a wrong number, visible on
 * screen, in a board that had been reviewed. It was found by LOOKING at the
 * rendered page, not by reading the code or querying the DOM.
 *
 * Every one of those three is now a required-or-explicit prop: `domain` is
 * derived from the data unless given, `format` defaults to a plain one-decimal
 * (NOT the baseball rate format), and `caption` has no default at all.
 *
 * **The standing rule this earns, and it applies to every file in this
 * directory: the first sport to use a primitive gets to define its defaults,
 * so audit every literal in one before a second sport touches it.** The safe
 * default is the general one; the sport-specific one is passed in.
 * ===========================================================================
 *
 * COLOUR IS NEVER THE ONLY ENCODING. `lib/ui/heat.ts`'s poles clear a deutan
 * CVD check at ΔE 8.4 against a floor of 8.0 — a genuinely well-chosen pair,
 * but clearing by 0.4. Every cell therefore also prints its number, and the
 * text colour comes from `heatInk` (the darker ramp) rather than being assumed
 * legible against the fill.
 */
export interface HeatGridCell {
  /** Stable key, also used in the cell's tooltip. */
  key: string;
  value: number | null;
  /** Sample size behind the value. Shown in the tooltip; `null` renders an empty cell. */
  sampleSize?: number | null;
}

export interface HeatGridProps {
  /** Row-major. Every row must be the same length. */
  rows: ReadonlyArray<ReadonlyArray<HeatGridCell>>;
  rowLabels?: readonly string[];
  columnLabels?: readonly string[];
  /**
   * Value range the colour ramp spans. Omit to derive from the cells — which
   * is right for a splits matrix, where the interesting contrast is within the
   * grid. Pass it explicitly when several grids must be comparable, or when the
   * meaningful range is known and wider than this grid happens to cover.
   */
  domain?: { lo: number; hi: number };
  /**
   * How a cell prints. **Defaults to one decimal, deliberately NOT the
   * baseball rate format** — see this file's bug note. MLB passes
   * `fmt.rate3` explicitly.
   */
  format?: Formatter;
  /** Unit name for the tooltip ("xwOBA", "yards/target"). No default: a unit is never generic. */
  unit?: string;
  /** Line under the grid. No default — the MLB caption being one was half the bug. */
  caption?: string;
  aspect?: 'matrix' | 'zone';
  /** Lower values are better (ERA allowed, turnovers). Inverts the ramp, not the numbers. */
  lowerIsBetter?: boolean;
  label: string;
  className?: string;
}

export function HeatGrid({
  rows,
  rowLabels,
  columnLabels,
  domain,
  format = fmts.one,
  unit,
  caption,
  aspect = 'matrix',
  lowerIsBetter = false,
  label,
  className,
}: HeatGridProps) {
  const flat = rows.flat().filter((c) => c.value != null && Number.isFinite(c.value));
  if (rows.length === 0 || flat.length === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded-[6px] border border-dashed border-line-soft px-4 py-6 ${className ?? ''}`}
        role="img"
        aria-label={`${label}: no data`}
      >
        <p className="text-[11px] text-ink-faint">No splits recorded yet.</p>
      </div>
    );
  }

  const values = flat.map((c) => c.value as number);
  const lo = domain?.lo ?? Math.min(...values);
  const hi = domain?.hi ?? Math.max(...values);

  const cellW = aspect === 'zone' ? 46 : 58;
  const cellH = aspect === 'zone' ? 46 : 26;
  const gap = 2;
  const labelW = rowLabels ? 62 : 0;
  const headerH = columnLabels ? 14 : 0;
  const captionH = caption ? 14 : 0;
  const cols = rows[0]?.length ?? 0;
  const width = labelW + cols * cellW + (cols - 1) * gap;
  const height = headerH + rows.length * cellH + (rows.length - 1) * gap + captionH;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={label}
      className={className}
      style={{ display: 'block', overflow: 'visible', maxWidth: width }}
    >
      {columnLabels?.map((c, ci) => (
        <text
          key={c}
          x={labelW + ci * (cellW + gap) + cellW / 2}
          y={10}
          fill={INK4}
          fontSize={SIZE.label}
          textAnchor="middle"
        >
          {c}
        </text>
      ))}

      {rows.map((row, ri) => {
        const y = headerH + ri * (cellH + gap);
        return (
          <g key={ri}>
            {rowLabels?.[ri] ? (
              <text x={labelW - 6} y={y + cellH / 2 + 3} fill={INK3} fontSize={SIZE.label} textAnchor="end">
                {rowLabels[ri]}
              </text>
            ) : null}
            {row.map((cell, ci) => {
              const x = labelW + ci * (cellW + gap);
              if (cell.value == null || !Number.isFinite(cell.value)) {
                return (
                  <rect key={cell.key} x={x} y={y} width={cellW} height={cellH} rx={3} fill="none" stroke={INK4} strokeWidth={1} opacity={0.35}>
                    <title>{`${cell.key} ${MIDDOT} no data`}</title>
                  </rect>
                );
              }
              const raw = rankToHeat(cell.value, lo, hi);
              const t = lowerIsBetter ? 1 - raw : raw;
              return (
                <g key={cell.key}>
                  <rect x={x} y={y} width={cellW} height={cellH} rx={3} fill={heatFill(t, 0.28)} />
                  <text
                    x={x + cellW / 2}
                    y={y + cellH / 2 + 3.5}
                    fill={heatInk(t)}
                    fontSize={aspect === 'zone' ? SIZE.value + 1 : SIZE.value}
                    fontWeight={600}
                    textAnchor="middle"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {format(cell.value)}
                  </text>
                  <title>
                    {`${cell.key} ${MIDDOT} ${format(cell.value)}${unit ? ` ${unit}` : ''}${
                      cell.sampleSize != null ? ` ${MIDDOT} n=${cell.sampleSize}` : ''
                    }`}
                  </title>
                </g>
              );
            })}
          </g>
        );
      })}

      {caption ? (
        <text x={width / 2} y={height - 3} fill={INK4} fontSize={SIZE.caption} textAnchor="middle">
          {caption}
        </text>
      ) : null}
    </svg>
  );
}
