/**
 * Scale and domain helpers — Phase 6.4.
 *
 * THIS FILE EXISTS BECAUSE OF TWO REAL BUGS, both of which were a primitive
 * hardcoding the assumptions of whichever sport used it first, and both of
 * which were found by LOOKING at a rendered page rather than by querying the
 * DOM or reading a type:
 *
 * 1. **`zoneGrid`** hardcoded MLB's domain (0.20–0.65), its caption ("catcher
 *    view / xwOBA") and its number format (baseball's strip-the-leading-zero).
 *    NFL's 14.8 yards-per-target rendered as **"4.800"** — a wrong number, on
 *    screen, in a shipped board.
 * 2. **`rollingChart`** forced `lo = 0`. Right for a count stat (hits,
 *    receiving yards), which it was first written against; wrong for a rating.
 *    An Elo series spanning 1460–1590 collapsed into a flat strip with ticks
 *    at 0.0 / 590.2 / 1180.5, destroying the entire signal.
 *
 * **The standing rule this earns: the first sport to use a primitive defines
 * its defaults, so audit every literal in one before a second sport touches
 * it.** `niceDomain` below is the fix generalised — a domain is computed from
 * the data with an explicit, named choice about whether zero belongs in it,
 * rather than assumed.
 *
 * Both fixes live in `docs/design/build-lib.mjs` as patches over
 * `chart-grammar.html`, which still holds the unfixed originals. This file is
 * where they land in real code.
 */

/** A resolved numeric domain. `lo`/`hi` already include padding. */
export interface Domain {
  lo: number;
  hi: number;
}

export interface DomainOptions {
  /**
   * Anchor the axis at zero.
   *
   * `true` is right for a COUNT or a magnitude, where the distance from zero is
   * the thing being read (hits, receiving yards, shots). `false` is right for a
   * RATING or any quantity whose interesting range is far from zero (Elo, a win
   * probability band, a temperature) — anchoring those at zero flattens the
   * whole series into a strip.
   *
   * There is deliberately NO default: a caller has to decide, because getting
   * it wrong renders a chart that is technically correct and completely
   * unreadable, and nothing catches that but looking at it.
   */
  zeroBased: boolean;
  /** Fractional headroom past the data, e.g. 0.12 = 12%. */
  pad?: number;
  /** Hard overrides — useful when several charts must share one scale. */
  min?: number;
  max?: number;
}

/**
 * Domain for a set of values.
 *
 * Degenerate inputs are handled rather than propagated: an empty series, an
 * all-equal series (span 0) and a non-finite value all produce a usable
 * domain instead of `NaN` coordinates, which render as an invisible path with
 * no error anywhere.
 */
export function niceDomain(values: readonly number[], opts: DomainOptions): Domain {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { lo: 0, hi: 1 };

  const dataMin = Math.min(...finite);
  const dataMax = Math.max(...finite);
  const pad = opts.pad ?? (opts.zeroBased ? 0.12 : 0.18);

  let lo: number;
  let hi: number;
  if (opts.zeroBased) {
    lo = Math.min(0, dataMin);
    hi = dataMax * (1 + pad);
    // An all-zero or all-negative series still needs a hi above lo.
    if (hi <= lo) hi = lo + Math.max(Math.abs(lo) * pad, 1);
  } else {
    const span = dataMax - dataMin;
    const padv = span * pad || Math.max(Math.abs(dataMax) * 0.05, 1);
    lo = dataMin - padv;
    hi = dataMax + padv;
  }

  if (opts.min != null) lo = opts.min;
  if (opts.max != null) hi = opts.max;
  if (hi <= lo) hi = lo + 1;
  return { lo, hi };
}

/** Value -> pixel, top-down (SVG y grows downward). */
export function yScale(domain: Domain, top: number, height: number): (v: number) => number {
  const span = domain.hi - domain.lo || 1;
  return (v) => top + height - ((v - domain.lo) / span) * height;
}

/** Index -> pixel across a plot width. A single-point series sits at the left edge rather than dividing by zero. */
export function xScale(count: number, left: number, width: number): (i: number) => number {
  if (count <= 1) return () => left;
  return (i) => left + (i / (count - 1)) * width;
}

/** Evenly spaced tick values across a domain, inclusive of both ends. */
export function ticksFor(domain: Domain, count: number): number[] {
  const n = Math.max(1, count);
  return Array.from({ length: n + 1 }, (_, i) => domain.lo + ((domain.hi - domain.lo) * i) / n);
}

/** An SVG path through a series, skipping non-finite points rather than emitting NaN. */
export function linePath(
  values: readonly number[],
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  const parts: string[] = [];
  let penDown = false;
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) {
      penDown = false;
      return;
    }
    parts.push(`${penDown ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`);
    penDown = true;
  });
  return parts.join(' ');
}

/** Index of the series point nearest an x pixel — the crosshair's snap. */
export function nearestIndex(px: number, count: number, left: number, width: number): number {
  if (count <= 1) return 0;
  const t = (px - left) / (width || 1);
  return Math.max(0, Math.min(count - 1, Math.round(t * (count - 1))));
}

/** American odds -> implied probability, no de-vig. This is the raw book number, not a fair price. */
export function impliedProbability(american: number): number {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}
