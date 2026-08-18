'use client';

import type { InsightKind, SplitEvidence } from '@/lib/core/types';
import { compareInk } from '@/lib/ui/heat';
import { InsufficientMark } from './StatCells';

/**
 * One evidence bullet: icon, label, right-aligned figure.
 *
 * The icon is the load-bearing part. A column of bullets all reading "Hit in N
 * of last M…" is a wall of near-identical sentences; a fixed glyph per *kind* of
 * signal lets someone see "recent form, head-to-head, venue" without reading any
 * of them. That only works if the mapping never varies, so it is defined here
 * once and no view is allowed to choose its own.
 *
 * Glyphs are drawn here from primitives rather than lifted from any product —
 * the project has no icon library dependency, and the semantic mapping is the
 * part worth borrowing, not the artwork. Each carries an accessible label
 * naming its type, because the glyph genuinely carries meaning rather than
 * decorating text that already says the same thing.
 */

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

export const INSIGHT_LABEL: Record<InsightKind, string> = {
  'recent-form': 'Recent form',
  'head-to-head': 'Versus this opponent',
  'venue-split': 'Home / away split',
  weather: 'Weather and conditions',
  'opponent-rank': 'Opponent defensive rank',
  handedness: 'Handedness split',
  streak: 'Streak',
  rest: 'Rest and schedule',
};

/**
 * Concept per kind, per the audit:
 *   recent form → bolt · head-to-head → shield · venue → map pin ·
 *   weather → cloud · opponent rank → bars · handedness → split arrow ·
 *   streak → flame · rest → calendar
 *
 * Home and away share the pin deliberately: it means "venue split", and the
 * label says which side.
 */
function IconPath({ kind }: { kind: InsightKind }) {
  switch (kind) {
    case 'recent-form':
      // Bolt.
      return <path d="M9 1 3.5 8.5H7L6 15l5.5-7.5H8L9 1Z" />;
    case 'head-to-head':
      // Shield.
      return <path d="M8 1.5 13.5 3.5v4.2c0 3.2-2.2 5.6-5.5 6.8-3.3-1.2-5.5-3.6-5.5-6.8V3.5L8 1.5Z" />;
    case 'venue-split':
      // Map pin.
      return <path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 3.4 4.5 8.5 4.5 8.5s4.5-5.1 4.5-8.5A4.5 4.5 0 0 0 8 1.5Zm0 6.2A1.7 1.7 0 1 1 8 4.3a1.7 1.7 0 0 1 0 3.4Z" />;
    case 'weather':
      // Cloud with a wind stroke.
      return (
        <>
          <path d="M4.8 11.5a3 3 0 0 1-.3-6 4 4 0 0 1 7.6 1.1 2.5 2.5 0 0 1-.4 4.9H4.8Z" />
          <path d="M2 13.6h7.5" strokeWidth="1.4" stroke="currentColor" fill="none" strokeLinecap="round" />
        </>
      );
    case 'opponent-rank':
      // Ranked bars, ascending.
      return (
        <>
          <rect x="2" y="9.5" width="3" height="5" rx="0.6" />
          <rect x="6.5" y="6" width="3" height="8.5" rx="0.6" />
          <rect x="11" y="2.5" width="3" height="12" rx="0.6" />
        </>
      );
    case 'handedness':
      // Arrows splitting left and right.
      return (
        <>
          <path d="M8 2v12" strokeWidth="1.4" stroke="currentColor" fill="none" strokeLinecap="round" />
          <path d="M4.8 5.6 2.2 8.2l2.6 2.6" strokeWidth="1.4" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M11.2 5.6l2.6 2.6-2.6 2.6" strokeWidth="1.4" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case 'streak':
      // Flame.
      return <path d="M8 1.2s.9 2.3-.6 4c-1.4 1.6-3.3 2.6-3.3 5.2A3.9 3.9 0 0 0 8 14.8a3.9 3.9 0 0 0 3.9-4.4c-.2-2-1.5-2.8-2.2-4.2-.4 1-1 1.4-1.6 1.7.5-1.6.4-4-.1-6.7Z" />;
    case 'rest':
      // Calendar.
      return (
        <>
          <rect x="2" y="3" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M2 6.5h12" stroke="currentColor" strokeWidth="1.4" fill="none" />
          <path d="M5.5 1.6v2.4M10.5 1.6v2.4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </>
      );
    default:
      return <circle cx="8" cy="8" r="3" />;
  }
}

/**
 * The glyph on its own, at the one size it is ever drawn.
 *
 * Muted by default so the figure at the end of the row stays the element the
 * eye lands on — the icon classifies, the number decides.
 */
export function InsightIcon({ kind, className = '' }: { kind: InsightKind; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={14}
      height={14}
      fill="currentColor"
      role="img"
      aria-label={INSIGHT_LABEL[kind]}
      className={`shrink-0 text-ink-faint ${className}`}
    >
      <IconPath kind={kind} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

export interface InsightRowProps {
  kind: InsightKind;
  /** The claim, e.g. "Hit in 9 of last 10 away games". */
  label: string;
  /**
   * The right-aligned figure. A percentage most of the time, but the audit
   * found weather rows carrying "7MPH" and rank rows carrying "27th" — the slot
   * holds whatever that signal measures, so it takes a string.
   */
  figure?: string;
  /** Position on the heat ramp, when the figure is a rate worth colouring. */
  heat?: number;
  className?: string;
}

export function InsightRow({ kind, label, figure, heat, className = '' }: InsightRowProps) {
  return (
    <li className={`flex items-center gap-1.5 text-[12px] leading-tight ${className}`}>
      <InsightIcon kind={kind} />
      <span className="min-w-0 flex-1 truncate text-ink-muted">{label}</span>
      {figure ? (
        <span
          className="shrink-0 font-medium tabular-nums text-ink"
          style={heat != null ? { color: compareInk(heat) } : undefined}
        >
          {figure}
        </span>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Driving it from evidence
// ---------------------------------------------------------------------------

function heatFor(rate: number): number {
  if (rate >= 0.65) return 0.95;
  if (rate >= 0.55) return 0.72;
  if (rate > 0.45) return 0.5;
  if (rate > 0.35) return 0.3;
  return 0.06;
}

/**
 * A `SplitEvidence` as a row.
 *
 * An insufficient split still renders — it says "this angle exists, and it
 * hasn't got the games behind it" — which is more useful than silently omitting
 * it and leaving the reader to wonder whether it was checked.
 */
export function SplitInsightRow({ split, className = '' }: { split: SplitEvidence; className?: string }) {
  if (split.stat.status === 'insufficient') {
    return (
      <li className={`flex items-center gap-1.5 text-[12px] leading-tight ${className}`}>
        <InsightIcon kind={split.kind} />
        <span className="min-w-0 flex-1 truncate text-ink-faint">{split.label}</span>
        <InsufficientMark available={split.stat.available} required={split.stat.required} />
      </li>
    );
  }

  const { hits, total, rate } = split.stat;
  return (
    <InsightRow
      kind={split.kind}
      // A split carrying its own figure isn't a rate, so it doesn't get the
      // "n of m" suffix either — "PHI rank poorly in hits allowed — 0 of 30"
      // would be nonsense.
      label={split.figure ? split.label : `${split.label} — ${hits} of ${total}`}
      figure={split.figure ?? `${Math.round(rate * 100)}%`}
      heat={heatFor(rate)}
      className={className}
    />
  );
}

/** A list of evidence, ordered as the adapter supplied it. */
export function InsightList({
  splits,
  limit,
  className = '',
}: {
  splits: SplitEvidence[];
  /** Cap the visible rows — collapsed candidate rows show 2–3. */
  limit?: number;
  className?: string;
}) {
  const shown = limit != null ? splits.slice(0, limit) : splits;
  if (shown.length === 0) return null;

  return (
    <ul className={`space-y-1 ${className}`}>
      {shown.map((split) => (
        <SplitInsightRow key={`${split.kind}-${split.label}`} split={split} />
      ))}
    </ul>
  );
}

export default InsightRow;
