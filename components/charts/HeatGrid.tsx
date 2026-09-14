'use client';

import { heatFill, heatInk, rankToHeat } from '@/lib/ui/heat';
import { INK3, INK4, SIZE, MIDDOT, volumeFill, volumeInk, type Formatter } from './tokens';
import { MarkTip } from './MarkTip';
import { useChartWidth } from './useChartWidth';
import { fmt as fmts } from './tokens';

/**
 * 06 · HeatGrid — a matrix of cells shaded by value.
 *
 * A MATRIX, NOT A PLACE (R3 3c). This used to take `aspect="zone"` and was
 * hardcoded that way for every sport's spatial grid, so an NFL target map drew
 * as a strike zone (design finding D4). Places now draw on their sport's
 * surface through `SpatialSurface`; this primitive is the splits matrix, and
 * the plain fallback for grid data that is not a location (golf by lie). Cells
 * stretch to the real width of the card.
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
  /**
   * `share` is VOLUME (share of attempts): one hue, darker = more, never good
   * or bad (D4). `judged` uses the diverging ramp in the declared direction.
   * Default `judged`, which is what every splits matrix is.
   */
  measure?: 'share' | 'judged';
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
  measure = 'judged',
  lowerIsBetter = false,
  label,
  className,
}: HeatGridProps) {
  const [hostRef, measuredWidth] = useChartWidth(360);
  const flat = rows.flat().filter((c) => c.value != null && Number.isFinite(c.value));
  if (rows.length === 0 || flat.length === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded-[6px] border border-dashed border-line-soft px-4 py-6 ${className ?? ''}`}
        role="img"
        aria-label={`${label}: no data`}
      >
        <p className="text-label text-ink-muted">No splits recorded yet.</p>
      </div>
    );
  }

  const values = flat.map((c) => c.value as number);
  const lo = domain?.lo ?? (measure === 'share' ? 0 : Math.min(...values));
  const hi = domain?.hi ?? Math.max(...values);

  const gap = 2;
  const labelW = rowLabels ? Math.min(110, Math.max(62, Math.max(...rowLabels.map((l) => l.length)) * 6.5)) : 0;
  const headerH = columnLabels ? 16 : 0;
  const captionH = caption ? 16 : 0;
  const cols = rows[0]?.length ?? 0;
  const width = Math.max(labelW + cols * 36, measuredWidth);
  const cellW = Math.max(28, (width - labelW - (cols - 1) * gap) / Math.max(1, cols));
  const cellH = 28;
  const height = headerH + rows.length * cellH + (rows.length - 1) * gap + captionH;

  const tone = (v: number) => {
    const raw = rankToHeat(v, lo, hi);
    if (measure === 'share') return { fill: volumeFill(raw), ink: volumeInk(raw) };
    const t = lowerIsBetter ? 1 - raw : raw;
    return { fill: heatFill(t, 0.28), ink: heatInk(t) };
  };

  return (
    <div ref={hostRef} className={`min-w-0 ${className ?? ''}`}>
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      style={{ display: 'block', overflow: 'visible', maxWidth: '100%' }}
    >
      {columnLabels?.map((c, ci) => (
        <text key={c} x={labelW + ci * (cellW + gap) + cellW / 2} y={11} fill={INK3} fontSize={SIZE.label} textAnchor="middle">
          {c}
        </text>
      ))}

      {rows.map((row, ri) => {
        const y = headerH + ri * (cellH + gap);
        return (
          <g key={ri}>
            {rowLabels?.[ri] ? (
              <text x={labelW - 6} y={y + cellH / 2 + 4} fill={INK3} fontSize={SIZE.label} textAnchor="end">
                {rowLabels[ri]}
              </text>
            ) : null}
            {row.map((cell, ci) => {
              const x = labelW + ci * (cellW + gap);
              const where = [rowLabels?.[ri], columnLabels?.[ci]].filter(Boolean).join(' ') || cell.key;
              if (cell.value == null || !Number.isFinite(cell.value)) {
                return (
                  <MarkTip key={cell.key} tip={`${where} ${MIDDOT} no data`}>
                    <rect x={x} y={y} width={cellW} height={cellH} rx={3} fill="none" stroke={INK4} strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
                  </MarkTip>
                );
              }
              const { fill, ink } = tone(cell.value);
              return (
                <MarkTip key={cell.key} tip={`${where} ${MIDDOT} ${format(cell.value)}${unit ? ` ${unit}` : ''}${cell.sampleSize != null ? ` ${MIDDOT} n=${cell.sampleSize}` : ''}`}>
                  <rect x={x} y={y} width={cellW} height={cellH} rx={3} fill={fill} />
                  <text x={x + cellW / 2} y={y + cellH / 2 + 4} fill={ink} fontSize={SIZE.value} fontWeight={600} textAnchor="middle" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {format(cell.value)}
                  </text>
                </MarkTip>
              );
            })}
          </g>
        );
      })}

      {caption ? (
        <text x={width / 2} y={height - 3} fill={INK3} fontSize={SIZE.caption} textAnchor="middle">
          {caption}
        </text>
      ) : null}
    </svg>
    </div>
  );
}
