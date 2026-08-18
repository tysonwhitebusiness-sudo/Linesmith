'use client';

import type { WindowedStat, Delta } from '@/lib/core/windowedStat';
import { compareInk, heatBadge, heatTile, gradientCardStyle, deltaGradientStyle } from '@/lib/ui/heat';

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
    <span className={`text-ink-faint ${className}`} title={reason}>
      <span aria-hidden>–</span>
      <span className="sr-only">{reason}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hit rate
// ---------------------------------------------------------------------------

/**
 * Five buckets rather than a continuous ramp.
 *
 * A continuous gradient makes 61% and 64% look meaningfully different when they
 * aren't; buckets make the reader's actual question ("is this good?") answerable
 * at a glance. The midpoint is neutral grey rather than amber because a coin-flip
 * rate carries no signal, and amber implies it carries a weak one.
 */
function rateHeat(rate: number): number {
  if (rate >= 0.65) return 0.95;
  if (rate >= 0.55) return 0.72;
  if (rate > 0.45) return 0.5;
  if (rate > 0.35) return 0.3;
  return 0.06;
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

export function HitRateCell({
  stat,
  showFraction = false,
  showAverage = false,
  align = 'center',
  className = '',
}: HitRateCellProps) {
  const alignment =
    align === 'right' ? 'text-right items-end' : align === 'center' ? 'text-center items-center' : 'text-left items-start';

  if (stat.status === 'insufficient') {
    return (
      <span className={`flex min-h-[42px] min-w-[58px] flex-col justify-center rounded-md px-1.5 py-1 leading-tight ${alignment} ${className}`}>
        <InsufficientMark available={stat.available} required={stat.required} />
      </span>
    );
  }

  return (
    <span
      className={`flex min-h-[42px] min-w-[58px] flex-col justify-center rounded-md px-1.5 py-1 leading-tight ${alignment} ${className}`}
      style={heatTile(stat.rate)}
      title={`${stat.hits} of ${stat.total}`}
    >
      <span className="font-semibold tabular-nums">{formatRate(stat.rate)}</span>
      {showFraction ? (
        <span className="text-[10px] tabular-nums opacity-75">
          {stat.hits}/{stat.total}
        </span>
      ) : null}
      {showAverage ? <span className="text-[10px] tabular-nums opacity-75">Avg {stat.average.toFixed(2)}</span> : null}
    </span>
  );
}

/** Whole numbers stay whole; anything else keeps one decimal, as PickFinder does. */
export function formatRate(rate: number): string {
  const pct = rate * 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

/**
 * A rate as a tinted badge rather than a bare numeral — for cards, where there
 * is room for emphasis and no column of neighbours to compare against.
 */
export function HitRateBadge({ stat, size = 'sm' }: { stat: WindowedStat; size?: 'sm' | 'md' }) {
  if (stat.status === 'insufficient') {
    return (
      <span
        className={`inline-flex items-baseline rounded-md border border-line text-ink-faint ${
          size === 'md' ? 'px-2 py-1 text-sm' : 'px-1.5 py-0.5 text-xs'
        }`}
      >
        <InsufficientMark available={stat.available} required={stat.required} />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-baseline gap-1 rounded-md border font-semibold tabular-nums ${
        size === 'md' ? 'px-2 py-1 text-sm' : 'px-1.5 py-0.5 text-xs'
      }`}
      style={heatBadge(rateHeat(stat.rate))}
      title={`${stat.hits} of ${stat.total}`}
    >
      {formatRate(stat.rate)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Delta
// ---------------------------------------------------------------------------

/**
 * The Diff column: how far the window's average sits from the line.
 *
 * Its colour scale is deliberately **not** `HitRateCell`'s. A delta is a signed
 * quantity, so what matters is which side of the line it falls on — the audit
 * confirmed the reference treats a +1.6% edge and a +120% edge identically, and
 * that is the right call: both mean "the average clears the line", and ramping
 * by magnitude would imply a confidence the number doesn't carry.
 */
export function DeltaCell({
  delta,
  align = 'center',
  className = '',
}: {
  delta: Delta | null;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  const alignment =
    align === 'right' ? 'text-right items-end' : align === 'center' ? 'text-center items-center' : 'text-left items-start';

  if (!delta) {
    return (
      <span className={`flex flex-col ${alignment} ${className}`}>
        <span className="text-ink-faint" title="No filled window to compare against the line">
          <span aria-hidden>–</span>
          <span className="sr-only">No filled window to compare against the line</span>
        </span>
      </span>
    );
  }

  // Sign only. `toneInk` maps to the ramp's extremes, never its middle.
  const positive = delta.absolute > 0;
  const flat = Math.abs(delta.absolute) < 0.005;
  const color = flat ? undefined : compareInk(positive ? 0.95 : 0.06);

  return (
    <span className={`flex flex-col leading-tight ${alignment} ${className}`}>
      <span className="font-semibold tabular-nums" style={color ? { color } : undefined}>
        {signed(delta.absolute, 1)}
      </span>
      {delta.percent !== null ? (
        <span className="text-[10px] tabular-nums" style={color ? { color } : undefined}>
          {signed(delta.percent * 100, 1)}%
        </span>
      ) : null}
    </span>
  );
}

function signed(value: number, places: number): string {
  const rounded = value.toFixed(places);
  // `-0.0` is arithmetic noise, not a negative quantity.
  const cleaned = Number(rounded) === 0 ? (0).toFixed(places) : rounded;
  return Number(cleaned) > 0 ? `+${cleaned}` : cleaned;
}

// ---------------------------------------------------------------------------
// Streak
// ---------------------------------------------------------------------------

/**
 * A signed run length, coloured by sign and magnitude.
 *
 * Unlike a rate, a streak has no natural ceiling, so the ramp saturates at five
 * — past that the run is simply "long" and a deeper green says nothing more.
 */
export function StreakCell({ streak, className = '' }: { streak: number; className?: string }) {
  if (streak === 0) {
    return <span className={`text-ink-faint ${className}`}>–</span>;
  }

  const magnitude = Math.min(Math.abs(streak), 5) / 5;
  const heat = streak > 0 ? 0.5 + magnitude * 0.45 : 0.5 - magnitude * 0.45;
  const label = streak > 0 ? `${streak} in a row` : `${Math.abs(streak)} straight misses`;

  return (
    <span
      className={`font-semibold tabular-nums ${className}`}
      style={{ color: compareInk(heat) }}
      title={label}
    >
      <span aria-hidden>{streak > 0 ? `+${streak}` : streak}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
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
        <div className="text-[8px] leading-none tabular-nums text-ink-faint">
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
    return <td className={`bg-ink/5 px-1.5 py-1 text-center align-middle text-ink-faint ${className}`}>–</td>;
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
    return <td className={`bg-ink/5 px-1.5 py-1 text-center align-middle text-ink-faint ${className}`}>–</td>;
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
        <div className="text-[8px] leading-none tabular-nums text-ink-faint">{signed(delta.percent * 100, 1)}%</div>
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
