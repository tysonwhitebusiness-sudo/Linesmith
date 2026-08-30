'use client';

import { toneFill, compareInk } from '@/lib/ui/heat';
import { GRID, INK1, INK3, INK4, SIZE, type Formatter } from './tokens';
import { fmt as fmts } from './tokens';

/**
 * 08 · ContributionBars — signed model contributions. "Why the model likes it."
 *
 * A diverging bar per input, zeroed on a centre line: right of centre pushed
 * the number up, left pushed it down, and length is magnitude. Sorted by
 * absolute contribution so the reasons that mattered are at the top.
 *
 * THIS IS THE HONESTY BLOCK, and it is the reason to build the whole thing.
 * The stated position of this product is to publish the model's real record
 * including where it loses, rather than make another unfalsifiable claim. A
 * number with its reasons attached can be argued with; a number alone cannot.
 * If the model likes a prop mostly because of a park factor, the reader should
 * be able to see that and disagree.
 *
 * COLOUR USES `compareInk`, NOT `heatFill`. The fill ramp has AMBER at its
 * midpoint, which asserts "caution" where a contribution of roughly zero only
 * means "this input did not matter". `COMPARE_STOPS` goes red -> neutral grey
 * -> green and is the correct ramp for a signed quantity; its own comment in
 * `lib/ui/heat.ts` reasons this out, and that reasoning was never carried back
 * to the fill ramp. Sign is also encoded by SIDE, so colour is never alone.
 */
export interface Contribution {
  key: string;
  label: string;
  /** Signed. Positive pushes the prediction up. */
  value: number;
  /** Optional plain-language note, shown in the tooltip. */
  note?: string;
}

export interface ContributionBarsProps {
  contributions: readonly Contribution[];
  /** Units of the contribution ("runs", "pp"), for the tooltip. */
  unit?: string;
  format?: Formatter;
  width?: number;
  rowHeight?: number;
  /** Cap the rows shown; the rest are summed into an "other" row rather than dropped. */
  maxRows?: number;
  label: string;
  className?: string;
}

export function ContributionBars({
  contributions,
  unit,
  format = fmts.signed2,
  width = 340,
  rowHeight = 20,
  maxRows = 8,
  label,
  className,
}: ContributionBarsProps) {
  const usable = contributions.filter((c) => Number.isFinite(c.value));
  if (usable.length === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded-[6px] border border-dashed border-line-soft px-4 py-6 ${className ?? ''}`}
        role="img"
        aria-label={`${label}: no model contributions`}
      >
        <p className="text-[11px] text-ink-faint">No fitted model for this sport yet.</p>
      </div>
    );
  }

  const sorted = [...usable].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  // Truncation SUMS the tail rather than hiding it — dropping small
  // contributions silently overstates how much the shown ones explain.
  const shown = sorted.slice(0, maxRows);
  const tail = sorted.slice(maxRows);
  const rows =
    tail.length > 0
      ? [...shown, { key: '__other', label: `${tail.length} smaller inputs`, value: tail.reduce((s, c) => s + c.value, 0) }]
      : shown;

  const labelW = 132;
  const magnitude = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  const half = Math.max(30, (width - labelW - 44) / 2);
  const centre = labelW + half;
  const height = rows.length * rowHeight;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={label}
      className={className}
      style={{ display: 'block', overflow: 'visible', maxWidth: width }}
    >
      <line x1={centre} x2={centre} y1={0} y2={height} stroke={GRID} strokeWidth={1} />
      {rows.map((c, i) => {
        const y = i * rowHeight;
        const barH = Math.max(6, rowHeight - 8);
        const len = (Math.abs(c.value) / magnitude) * half;
        const positive = c.value >= 0;
        return (
          <g key={c.key}>
            <text x={labelW - 8} y={y + rowHeight / 2 + 3} fill={INK3} fontSize={SIZE.label} textAnchor="end">
              {c.label}
            </text>
            <rect
              x={positive ? centre : centre - len}
              y={y + (rowHeight - barH) / 2}
              width={Math.max(1, len)}
              height={barH}
              rx={2}
              fill={toneFill(positive ? 'good' : 'bad', 0.7)}
            />
            <text
              x={width}
              y={y + rowHeight / 2 + 3}
              fill={compareInk(positive ? 0.85 : 0.15)}
              fontSize={SIZE.value}
              fontWeight={600}
              textAnchor="end"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {format(c.value)}
            </text>
            <title>
              {`${c.label}: ${format(c.value)}${unit ? ` ${unit}` : ''}${'note' in c && c.note ? ` — ${c.note}` : ''}`}
            </title>
          </g>
        );
      })}
    </svg>
  );
}
