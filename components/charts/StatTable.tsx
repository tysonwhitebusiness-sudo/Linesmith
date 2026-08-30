'use client';

import { heatFill, heatInk, rankToHeat } from '@/lib/ui/heat';
import type { Formatter } from './tokens';
import { fmt as fmts } from './tokens';

/**
 * 09 · StatTable — a dense stat block with the heat bar BEHIND the number.
 *
 * Bar-in-cell, not bar-beside-cell. A separate bar column costs horizontal
 * space and splits the reader's attention between two marks that say the same
 * thing; a bar drawn behind the number occupies space the number already needs
 * and reads as one object. That is what lets a block carry twenty rows without
 * becoming a wall of digits, which is the whole point — **depth is the product**
 * here, and a page that shows six numbers nicely has missed the brief.
 *
 * HTML, NOT SVG. Everything else in this directory is SVG because it draws
 * marks at computed positions. A table is a table: real `<table>` markup gets
 * text selection, copy-paste, screen-reader row/column semantics and native
 * wrapping for free, and hand-rolling those in SVG would be strictly worse.
 *
 * The bar is a background gradient stop, and the number sits on top in
 * `heatInk` — the darker ramp — rather than being assumed legible.
 */
export interface StatTableRow {
  key: string;
  label: string;
  value: number | null;
  format?: Formatter;
  /**
   * Drives the bar, and is the ONLY thing that does — the bar length is
   * `1 - (rank-1)/(poolSize-1)`, so a row without a rank renders no bar at all.
   *
   * THERE IS DELIBERATELY NO `lowerIsBetter` HERE, unlike `HeatGrid` and
   * `SplitDumbbell`, whose heat comes from the VALUE and genuinely needs to
   * know which end is good. A rank already carries its direction: every rank
   * source in this codebase counts 1 as best, including the four
   * `teamDefenseAllowed` modules, which rank fewest-allowed first precisely so
   * this stays true. The prop used to exist and did nothing — the line read
   * `r.lowerIsBetter ? raw : raw`, both branches identical, which is worse than
   * absent because callers passed it believing it worked.
   *
   * A source that ranks the other way round must invert its own rank before it
   * gets here, where the inversion is visible next to the data it applies to.
   */
  rank?: number | null;
  poolSize?: number | null;
  /** Small secondary text under the label (sample size, window). */
  sub?: string;
}

export interface StatTableProps {
  rows: readonly StatTableRow[];
  /** Optional group heading rendered above the rows. */
  caption?: string;
  /** Show a right-hand rank column. */
  showRank?: boolean;
  emptyMessage?: string;
  className?: string;
}

export function StatTable({ rows, caption, showRank = true, emptyMessage, className }: StatTableProps) {
  const usable = rows.filter((r) => r.value != null && Number.isFinite(r.value));
  if (usable.length === 0) {
    return (
      <div className={`rounded-[6px] border border-dashed border-line-soft px-4 py-5 text-center ${className ?? ''}`}>
        <p className="text-[11px] text-ink-faint">{emptyMessage ?? 'No stats recorded for this window.'}</p>
      </div>
    );
  }

  return (
    <div className={className}>
      {caption ? (
        <div className="mb-1 text-[9px] font-semibold uppercase tracking-[.18em] text-ink-faint">{caption}</div>
      ) : null}
      <table className="w-full border-collapse">
        <tbody>
          {usable.map((r) => {
            const f = r.format ?? fmts.two;
            const ranked = r.rank != null && r.poolSize != null && r.poolSize > 1;
            // Rank-driven, and rank 1 is best everywhere in this codebase — see
            // `StatTableRow.rank` for why there is no direction flag here.
            const t = ranked ? 1 - (r.rank! - 1) / (r.poolSize! - 1) : null;
            const pct = t == null ? 0 : Math.round(t * 100);
            return (
              <tr key={r.key} className="border-b border-line-hair last:border-b-0">
                <td className="py-[3px] pr-2 align-middle">
                  <span className="block text-[11px] leading-tight text-ink-muted">{r.label}</span>
                  {r.sub ? <span className="block text-[9.5px] leading-tight text-ink-faint">{r.sub}</span> : null}
                </td>
                <td className="w-[92px] py-[3px] align-middle">
                  {/* The bar IS the cell background — see this file's header. */}
                  <div
                    className="relative overflow-hidden rounded-[3px] px-1.5 py-[2px] text-right"
                    style={
                      t == null
                        ? undefined
                        : {
                            backgroundImage: `linear-gradient(to right, ${heatFill(t, 0.3)} ${pct}%, transparent ${pct}%)`,
                          }
                    }
                  >
                    <span
                      className="relative text-[11.5px] font-semibold tabular-nums"
                      style={{ color: t == null ? undefined : heatInk(t) }}
                    >
                      {f(r.value as number)}
                    </span>
                  </div>
                </td>
                {showRank ? (
                  <td className="w-[54px] py-[3px] pl-2 text-right align-middle">
                    <span className="text-[9.5px] tabular-nums text-ink-faint">
                      {ranked ? `${r.rank} of ${r.poolSize}` : '—'}
                    </span>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
