'use client';

import { toneFill } from '@/lib/ui/heat';
import { INK4, SIZE } from './tokens';

/**
 * 10 · StreakStrip — a run of binary outcomes, opacity ramping to the present.
 *
 * One cell per game, oldest at the left. The ramp is the point: a 7-3 record is
 * a different proposition depending on whether the three losses were last week
 * or in April, and a flat strip of ten equal squares cannot say which. Opacity
 * rises toward the most recent game so recency reads without a second encoding
 * or a date axis.
 *
 * WIN/LOSS IS NOT THE ONLY BINARY. A prop cleared or did not; a team covered or
 * did not; a goalie started or did not. `outcomes` is therefore
 * `true | false | null`, where `null` is a real third state — a game that
 * happened but has no result for this question (did not play, postponed,
 * ungraded). It renders as a hollow cell rather than being dropped, because
 * dropping it silently shortens the streak and misstates the record.
 */
export interface StreakStripProps {
  /** Oldest first. `null` = played but no result for this question. */
  outcomes: ReadonlyArray<boolean | null>;
  /** Per-cell tooltip text, parallel to `outcomes`. */
  titles?: readonly string[];
  cellWidth?: number;
  height?: number;
  gap?: number;
  /** Prints "7-3" beside the strip. */
  showRecord?: boolean;
  label: string;
  className?: string;
}

/** Oldest cell at this opacity, most recent at 1. Not 0 — an old game still happened. */
const MIN_OPACITY = 0.32;

export function StreakStrip({
  outcomes,
  titles,
  cellWidth = 10,
  height = 16,
  gap = 2,
  showRecord = false,
  label,
  className,
}: StreakStripProps) {
  if (outcomes.length === 0) {
    return <span className={className} role="img" aria-label={`${label}: no games`} />;
  }

  const width = outcomes.length * cellWidth + (outcomes.length - 1) * gap;
  const wins = outcomes.filter((o) => o === true).length;
  const losses = outcomes.filter((o) => o === false).length;

  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`${label}: ${wins} of ${wins + losses}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {outcomes.map((o, i) => {
          const opacity =
            outcomes.length === 1 ? 1 : MIN_OPACITY + (1 - MIN_OPACITY) * (i / (outcomes.length - 1));
          const x = i * (cellWidth + gap);
          const common = { x, y: 0, width: cellWidth, height, rx: 2 };
          return (
            <g key={i}>
              {o == null ? (
                <rect {...common} fill="none" stroke={INK4} strokeWidth={1} opacity={opacity} />
              ) : (
                <rect {...common} fill={toneFill(o ? 'good' : 'bad')} opacity={opacity} />
              )}
              {titles?.[i] ? <title>{titles[i]}</title> : null}
            </g>
          );
        })}
      </svg>
      {showRecord ? (
        <span className="tabular-nums text-ink-faint" style={{ fontSize: SIZE.value }}>
          {wins}-{losses}
        </span>
      ) : null}
    </span>
  );
}
