'use client';

import type { WindowedStat, Delta } from '@/lib/core/windowedStat';
import { gradientCardStyle, deltaGradientStyle } from '@/lib/ui/heat';

/**
 * The numeric cells shared by the Scan table, the detail pages and the cards.
 *
 * The rule these encode, established from the reference audit in
 * `docs/ux-research-notes.md`: a rate that had the games behind it gets a
 * heat-mapped number, and a rate that didn't gets a dash. Never a partial
 * fraction, never a scaled percentage, and never heat colour on a value we
 * declined to compute — the dash has to look like an absence, not like a bad
 * result.
 */

// ---------------------------------------------------------------------------
// Insufficient
// ---------------------------------------------------------------------------

/**
 * The insufficient marker.
 *
 * Deliberately a muted grey em dash, not red: "we don't have ten games yet" and
 * "he's hit in two of ten" are completely different statements, and colouring
 * them alike is the specific mistake this whole rebuild exists to undo. The
 * title carries the real reason so hovering explains the gap.
 */
export function InsufficientMark({
  available,
  required,
  className = '',
}: {
  available: number;
  required: number;
  className?: string;
}) {
  const reason = `Not enough games — ${available} of the ${required} this window needs`;
  return (
    <span className={`text-ink-muted ${className}`} title={reason}>
      <span aria-hidden>–</span>
      <span className="sr-only">{reason}</span>
    </span>
  );
}

export interface HitRateCellProps {
  stat: WindowedStat;
  /**
   * Print the supporting fraction beneath the percentage.
   *
   * Only true where the denominator varies — H2H, season, an arbitrary subset.
   * A fixed L10 has a denominator the column header already states, so
   * repeating it is noise; a "0%" over one meeting is meaningless without it.
   */
  showFraction?: boolean;
  /** Print the window's average value beneath instead of the fraction. */
  showAverage?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

/** Whole numbers stay whole; anything else keeps one decimal, as PickFinder does. */
export function formatRate(rate: number): string {
  const pct = rate * 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

function signed(value: number, places: number): string {
  const rounded = value.toFixed(places);
  // `-0.0` is arithmetic noise, not a negative quantity.
  const cleaned = Number(rounded) === 0 ? (0).toFixed(places) : rounded;
  return Number(cleaned) > 0 ? `+${cleaned}` : cleaned;
}

// ---------------------------------------------------------------------------
// Plain numeric
// ---------------------------------------------------------------------------

/** The Avg L10 column: a bare average, or the dash when the window is short. */
export function AverageCell({ stat, places = 2 }: { stat: WindowedStat; places?: number }) {
  if (stat.status === 'insufficient') {
    return <InsufficientMark available={stat.available} required={stat.required} />;
  }
  return <span className="tabular-nums">{stat.average.toFixed(places)}</span>;
}

// ---------------------------------------------------------------------------
// Gradient cells — the same glow/meter badge as everywhere else, applied to
// the `<td>` itself rather than a child span. A table cell's own height
// always equals the row's height, so this is what actually makes the wash
// touch the row's top and bottom rule; a percentage-height child (`h-full`)
// doesn't reliably resolve against a table cell in every browser, which is
// why that approach still left a gap. No border, no shadow, no white
// background peeking around the edges — the `<td>` itself carries the wash.
// ---------------------------------------------------------------------------

/** Dense-table counterpart to `HitRateCell` — renders its own `<td>`, so callers use it in place of the cell, not inside one. */
export function GradientRateCell({
  stat,
  showFraction = false,
  className = '',
}: {
  stat: WindowedStat;
  showFraction?: boolean;
  className?: string;
}) {
  if (stat.status === 'insufficient') {
    return (
      <td className={`bg-ink/5 px-1.5 py-1 text-center align-middle ${className}`}>
        <InsufficientMark available={stat.available} required={stat.required} />
      </td>
    );
  }

  const gradient = gradientCardStyle(stat.rate);

  return (
    <td
      className={`bg-card px-1.5 py-1 text-center align-middle ${className}`}
      style={{ backgroundImage: gradient.tableWash }}
      title={`${stat.hits} of ${stat.total}`}
    >
      <div className="text-[12px] font-bold leading-none tabular-nums" style={{ color: gradient.valueColor }}>
        {formatRate(stat.rate)}
      </div>
      {showFraction ? (
        <div className="text-[8px] leading-none tabular-nums text-ink-muted">
          {stat.hits}/{stat.total}
        </div>
      ) : null}
      <div className="mx-auto mt-0.5 h-[3px] w-full max-w-[64px] rounded-full bg-black/[0.06]">
        <div className="h-full rounded-full" style={{ width: `${Math.round(stat.rate * 100)}%`, background: gradient.fillBackground }} />
      </div>
    </td>
  );
}

/** Dense-table counterpart to `StreakCell` — driven off a pseudo-rate so a hot streak reads green and a cold one reads red on the same ramp as every other gradient cell. */
export function GradientStreakCell({ streak, className = '' }: { streak: number; className?: string }) {
  if (streak === 0) {
    return <td className={`bg-ink/5 px-1.5 py-1 text-center align-middle text-ink-muted ${className}`}>–</td>;
  }

  const magnitude = Math.min(Math.abs(streak), 5) / 5;
  const pseudoRate = streak > 0 ? 0.75 + magnitude * 0.25 : 0.3 - magnitude * 0.3;
  const gradient = gradientCardStyle(Math.min(1, Math.max(0, pseudoRate)));
  const label = streak > 0 ? `${streak} in a row` : `${Math.abs(streak)} straight misses`;

  return (
    <td
      className={`bg-card px-1.5 py-1 text-center align-middle ${className}`}
      style={{ backgroundImage: gradient.tableWash }}
      title={label}
    >
      <div className="text-[12px] font-bold leading-none tabular-nums" style={{ color: gradient.valueColor }}>
        {streak > 0 ? `+${streak}` : streak}
      </div>
      <div className="mx-auto mt-0.5 h-[3px] w-full max-w-[64px] rounded-full bg-black/[0.06]">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.round(Math.min(Math.abs(streak), 10) * 10)}%`, background: gradient.fillBackground }}
        />
      </div>
    </td>
  );
}

/** Dense-table counterpart to `DeltaCell` — green gradient above the line, red below it, plain neutral text when the two are indistinguishable. */
export function GradientDeltaCell({ delta, className = '' }: { delta: Delta | null; className?: string }) {
  if (!delta) {
    return <td className={`bg-ink/5 px-1.5 py-1 text-center align-middle text-ink-muted ${className}`}>–</td>;
  }

  // Arithmetic noise, not a real lean either way — amber, same as a coin-flip
  // rate, with an empty meter rather than a red or green one.
  const flat = Math.abs(delta.absolute) < 0.005;
  if (flat) {
    const neutral = gradientCardStyle(0.5);
    return (
      <td className={`bg-card px-1.5 py-1 text-center align-middle ${className}`} style={{ backgroundImage: neutral.tableWash }}>
        <div className="text-[12px] font-bold leading-none tabular-nums" style={{ color: neutral.valueColor }}>
          {signed(delta.absolute, 1)}
        </div>
        <div className="mx-auto mt-0.5 h-[3px] w-full max-w-[64px] rounded-full bg-black/[0.06]">
          <div className="h-full rounded-full" style={{ width: '0%', background: neutral.fillBackground }} />
        </div>
      </td>
    );
  }

  const gradient = deltaGradientStyle(delta.absolute);

  return (
    <td className={`bg-card px-1.5 py-1 text-center align-middle ${className}`} style={{ backgroundImage: gradient.tableWash }}>
      <div className="text-[12px] font-bold leading-none tabular-nums" style={{ color: gradient.valueColor }}>
        {signed(delta.absolute, 1)}
      </div>
      {delta.percent !== null ? (
        <div className="text-[8px] leading-none tabular-nums text-ink-muted">{signed(delta.percent * 100, 1)}%</div>
      ) : null}
      <div className="mx-auto mt-0.5 h-[3px] w-full max-w-[64px] rounded-full bg-black/[0.06]">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.round(Math.min(Math.abs(delta.absolute) / 2, 1) * 100)}%`, background: gradient.fillBackground }}
        />
      </div>
    </td>
  );
}
