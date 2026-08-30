'use client';

import { INK1, INK4, INK5, GRID, SURFACE, SIZE, type Formatter } from './tokens';
import { fmt as defaultFmt } from './tokens';

/**
 * 07 · RangeBar — book dispersion on one axis.
 *
 * The question it answers is not "what is the price" but "how much do the books
 * disagree, and where does this one sit in that disagreement". A wide range
 * with your book at the short end is a different proposition from a tight range
 * at the same number, and a single price cannot show either.
 *
 * Three marks: the span from worst to best, a tick per book, and the
 * highlighted book drawn last so it survives being covered. The consensus is a
 * separate hairline, because "the middle of the range" and "the consensus" are
 * different numbers whenever the books are unevenly spread — which is most of
 * the time.
 *
 * NOT ZERO-BASED, and it must not be: the domain is the observed spread. A
 * range of +112 to +124 anchored at zero is a sliver at the right-hand edge.
 */
export interface RangeBarPoint {
  /** Book name, for the tick's tooltip. */
  book: string;
  value: number;
}

export interface RangeBarProps {
  points: readonly RangeBarPoint[];
  /** Drawn last and in full ink — the book being discussed. Matched on `book`. */
  highlightBook?: string;
  /** A separate hairline. Pass the real consensus, not the midpoint. */
  consensus?: number | null;
  width?: number;
  height?: number;
  /** How the end labels print. Defaults to American odds, the usual case. */
  format?: Formatter;
  /** Higher is better (`false` for a total line where lower is the better side). */
  higherIsBetter?: boolean;
  label: string;
  className?: string;
}

export function RangeBar({
  points,
  highlightBook,
  consensus,
  width = 220,
  height = 34,
  format = defaultFmt.american,
  higherIsBetter = true,
  label,
  className,
}: RangeBarProps) {
  const finite = points.filter((p) => Number.isFinite(p.value));
  if (finite.length === 0) {
    return (
      <div
        className={`flex items-center rounded-[6px] border border-dashed border-line-soft px-2 ${className ?? ''}`}
        style={{ height }}
        role="img"
        aria-label={`${label}: no prices`}
      >
        <span className="text-[11px] text-ink-faint">No book prices yet.</span>
      </div>
    );
  }

  const values = finite.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padL = 34;
  const padR = 34;
  const trackWidth = Math.max(1, width - padL - padR);
  // A single book, or several agreeing exactly, is a real state: one tick in
  // the middle rather than a divide-by-zero.
  const span = max - min;
  const x = (v: number) => (span === 0 ? padL + trackWidth / 2 : padL + ((v - min) / span) * trackWidth);

  const midY = height / 2;
  const best = higherIsBetter ? max : min;
  const worst = higherIsBetter ? min : max;
  const highlighted = highlightBook ? finite.find((p) => p.book === highlightBook) : undefined;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={`${label}: ${finite.length} books, ${format(worst)} to ${format(best)}`}
      className={className}
      style={{ display: 'block', overflow: 'visible', maxWidth: width }}
    >
      <line x1={padL} x2={padL + trackWidth} y1={midY} y2={midY} stroke={GRID} strokeWidth={6} strokeLinecap="round" />

      {consensus != null && Number.isFinite(consensus) ? (
        <line
          x1={x(consensus)}
          x2={x(consensus)}
          y1={midY - 9}
          y2={midY + 9}
          stroke={INK4}
          strokeWidth={1}
          strokeDasharray="2 2"
        >
          <title>Consensus {format(consensus)}</title>
        </line>
      ) : null}

      {finite.map((p, i) => (
        <line
          key={`${p.book}-${i}`}
          x1={x(p.value)}
          x2={x(p.value)}
          y1={midY - 5}
          y2={midY + 5}
          stroke={INK5}
          strokeWidth={1.5}
          strokeLinecap="round"
        >
          <title>{`${p.book} ${format(p.value)}`}</title>
        </line>
      ))}

      {highlighted ? (
        <g>
          <circle cx={x(highlighted.value)} cy={midY} r={5} fill={SURFACE} />
          <circle cx={x(highlighted.value)} cy={midY} r={3.4} fill={INK1}>
            <title>{`${highlighted.book} ${format(highlighted.value)}`}</title>
          </circle>
        </g>
      ) : null}

      <text x={padL - 6} y={midY + 3.5} fill={INK4} fontSize={SIZE.tick} textAnchor="end" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {format(min)}
      </text>
      <text x={padL + trackWidth + 6} y={midY + 3.5} fill={INK4} fontSize={SIZE.tick} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {format(max)}
      </text>
    </svg>
  );
}
