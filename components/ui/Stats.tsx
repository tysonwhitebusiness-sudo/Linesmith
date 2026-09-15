'use client';

import type { ReactNode } from 'react';
import { cx } from './cx';
import { Tooltip, TipRow } from './Tooltip';

/**
 * StatValue, StatGrid, RankRow, FactList — R3 3b. Replace the ad hoc
 * value + rank + bar combinations F2 found in every page.
 *
 * DIRECTION IS DECLARED, NEVER INFERRED. `good`/`bad` color only appears when a
 * stat says which way is better (`higher` or `lower`). A `neutral` stat — fouls,
 * offsides, hits in hockey (R2) — ranks but is never colored. Phase F found
 * "more fouls" and "more saves" both shown as green.
 */
export type StatDirection = 'higher' | 'lower' | 'neutral';

/** 0-100 where 100 is BETTER, given a direction. `null` for neutral: nothing is better. */
export function goodness(percentile: number, direction: StatDirection): number | null {
  if (direction === 'neutral') return null;
  return direction === 'higher' ? percentile : 100 - percentile;
}

/** A muted-to-semantic fill for a percentile. Neutral stats stay gray. */
export function percentileColor(percentile: number, direction: StatDirection): string {
  const g = goodness(percentile, direction);
  if (g == null) return 'oklch(var(--ink-muted))';
  const strength = Math.round(30 + Math.abs(g - 50) * 1.4);
  const hue = g >= 50 ? 'rgb(var(--good))' : 'rgb(var(--bad))';
  return `color-mix(in srgb, ${hue} ${strength}%, oklch(70% 0.004 260))`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export interface StatValueProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  /** League rank, 1 = best in the stat's direction. */
  rank?: { rank: number; of: number };
  /** 0-100, higher = more of the stat (not "better"; `direction` decides that). */
  percentile?: number;
  /** A change against a baseline, e.g. vs season: `{ value: '+1.2', better: true }`. */
  delta?: { value: ReactNode; better: boolean | null };
  direction?: StatDirection;
  /** `display` for the one headline number on a card. */
  size?: 'display' | 'default' | 'compact';
  info?: ReactNode;
  className?: string;
}

export function StatValue({ label, value, unit, rank, percentile, delta, direction = 'neutral', size = 'default', info, className }: StatValueProps) {
  const valueClass = size === 'display' ? 'text-display' : size === 'compact' ? 'text-body font-semibold' : 'text-[22px] font-semibold leading-[1.15] tracking-[-0.01em]';
  const tile = (
    <div className={cx('min-w-0 rounded-ctl px-2 py-1.5 transition-colors duration-instant hover:bg-card-sunk', className)}>
      <div className="truncate text-label text-ink-muted">{label}</div>
      <div className={cx('proportional-nums text-ink', valueClass)}>
        {value}
        {unit ? <span className="ml-0.5 text-label font-medium text-ink-muted">{unit}</span> : null}
      </div>
      {rank || delta ? (
        <div className="flex flex-wrap items-center gap-x-2 text-label">
          {rank ? <span className="tabular-nums text-ink-secondary">{ordinal(rank.rank)} of {rank.of}</span> : null}
          {delta ? (
            <span className={cx('font-semibold tabular-nums', delta.better == null ? 'text-ink-muted' : delta.better ? 'text-good' : 'text-bad')}>{delta.value}</span>
          ) : null}
        </div>
      ) : null}
      {percentile != null ? (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-card-sunk" aria-hidden>
          <div className="h-full rounded-full transition-[width] duration-data ease-emphasized" style={{ width: `${percentile}%`, background: percentileColor(percentile, direction) }} />
        </div>
      ) : null}
    </div>
  );
  return info ? (
    <Tooltip content={<><TipRow value={value} label={label} /><div className="mt-0.5 text-white/70">{info}</div></>}>{tile}</Tooltip>
  ) : (
    tile
  );
}

export function StatGrid({ children, className, min = 118 }: { children: ReactNode; className?: string; min?: number }) {
  return (
    <div className={cx('grid gap-x-3 gap-y-2', className)} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}>
      {children}
    </div>
  );
}

export interface RankRowProps {
  label: ReactNode;
  /** Formatted value, shown at the right. */
  valueText: ReactNode;
  /** 0-100, higher = more of the stat. Drives the dot's position. */
  percentile: number;
  direction: StatDirection;
  rank?: { rank: number; of: number };
  /** Extra line for the tooltip: what the stat is, the pool. */
  info?: ReactNode;
}

/**
 * A ranked stat as a percentile track with a dot carrying the number (Savant
 * style), replacing today's ranked bars. The dot's COLOR is the judgment and
 * follows the declared direction; its POSITION is the percentile of the raw
 * stat, so "most fouls" sits at the right in gray, not in green.
 */
export function RankRow({ label, valueText, percentile, direction, rank, info }: RankRowProps) {
  const p = Math.max(0, Math.min(100, Math.round(percentile)));
  const color = percentileColor(p, direction);
  return (
    <Tooltip
      content={
        <>
          <TipRow value={valueText} label={label} />
          <div className="mt-0.5 text-white/70">
            {ordinal(p)} percentile{rank ? ` · ${ordinal(rank.rank)} of ${rank.of}` : ''}
            {direction === 'neutral' ? ' · no better or worse' : ''}
            {info ? <> · {info}</> : null}
          </div>
        </>
      }
    >
      {/* The track keeps a 48px floor and the value column is only as wide as its text:
          in a half-width column (the NFL matchup card) fixed label + value columns
          squeezed the track to ~6px and the dot sat on the label. */}
      <div className="grid grid-cols-[minmax(64px,140px)_minmax(48px,1fr)_auto] items-center gap-x-3 rounded-md px-1 py-1.5 hover:bg-card-sunk">
        <div className="truncate text-body-sm text-ink-secondary">{label}</div>
        <div className="relative h-2 rounded-full border border-line-soft bg-card-sunk" aria-hidden>
          <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-data ease-emphasized" style={{ width: `${p}%`, background: `color-mix(in oklch, ${color} 35%, transparent)` }} />
          <div
            className="absolute top-1/2 grid h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[10px] font-bold leading-none text-white shadow-[0_0_0_2px_oklch(var(--card))] transition-[left] duration-data ease-emphasized"
            style={{ left: `${p}%`, background: color }}
          >
            {p}
          </div>
        </div>
        <div className="min-w-[3ch] text-right text-body-sm font-semibold tabular-nums text-ink">{valueText}</div>
      </div>
    </Tooltip>
  );
}

/** Label/value pairs. Entries with no value are dropped rather than shown as blanks. */
export function FactList({ items, className }: { items: Array<[ReactNode, ReactNode]>; className?: string }) {
  const shown = items.filter(([, v]) => v != null && v !== '');
  return (
    <dl className={cx('grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 text-body-sm', className)}>
      {shown.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="text-right font-medium tabular-nums text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A chart legend: color swatch (or a dashed line for a reference) and label. */
export function VizLegend({ items, className }: { items: Array<{ label: ReactNode; color: string; dashed?: boolean }>; className?: string }) {
  return (
    <div className={cx('mt-2 flex flex-wrap gap-3 text-label text-ink-secondary', className)}>
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {it.dashed ? (
            <span aria-hidden className="inline-block w-3 border-t-2 border-dashed" style={{ borderColor: it.color }} />
          ) : (
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}
