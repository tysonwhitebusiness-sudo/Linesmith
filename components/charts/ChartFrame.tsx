'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { GRID, INK4, FONT_STACK, SIZE, type Formatter } from './tokens';
import { ticksFor, yScale, type Domain } from './scale';

/**
 * The frame every chart in `components/charts/` draws inside — Phase 6.4.
 *
 * WHAT IT OWNS, so that no primitive has to: the SVG root and viewBox, the
 * y-axis grid and its tick labels, the empty state, the loading state, and the
 * tooltip. A primitive receives a resolved plot area and draws marks in it.
 *
 * WHY A FRAME AT ALL. `package.json` carries **no chart library** — every mark
 * in this app is hand-rolled SVG, which is the right call for the look but the
 * exact condition under which ten bespoke charts drift apart. This repo has
 * paid for that twice already and written both lessons into `CLAUDE.md`: four
 * hand-written provider job bodies that each had to remember their own
 * rate-limit check (two forgot), and three duplicated page components that
 * drifted until someone read them side by side. A shared frame is the same
 * argument a third time.
 *
 * EMPTY IS A FIRST-CLASS STATE, NOT AN ERROR. Phase 6's gate requires every
 * sport to render every block or an honest empty state, and a blank card with
 * no empty state is a failure. Several blocks genuinely have no source for
 * some sports (NBA/NHL book lines out of season; MLS has no Understat). Those
 * must say so. `emptyMessage` is therefore required whenever `isEmpty` can be
 * true, and the default text is deliberately bland rather than reassuring.
 *
 * GRID LINES ARE SOLID HAIRLINES, one step off the surface. Never dashed —
 * a dashed grid reads as "provisional" and competes with the data.
 */

export interface ChartFrameProps {
  /** Intrinsic width in SVG user units. The chart scales down responsively but never renders above 1:1. */
  width: number;
  height: number;
  /** Plot insets. Left needs room for tick labels; bottom needs room only when an x-axis renders. */
  padding?: { top?: number; right?: number; bottom?: number; left?: number };
  /** Omit to draw no y grid (a sparkline, a dumbbell). */
  domain?: Domain;
  /** Number of grid intervals. Ignored without a `domain`. */
  tickCount?: number;
  /** How a tick value prints. Required with a `domain` — see this file's note on `zoneGrid`. */
  tickFormat?: Formatter;
  /** Renders the empty state instead of children. */
  isEmpty?: boolean;
  /** Shown when `isEmpty`. Say what is actually missing and why, not "no data". */
  emptyMessage?: string;
  /** Renders a skeleton instead of children. Takes precedence over `isEmpty` — unknown is not empty. */
  isLoading?: boolean;
  /** Accessible description. A chart with no text alternative is invisible to a screen reader. */
  label: string;
  /** Receives the resolved plot geometry and the y scale. */
  children: (plot: PlotArea) => ReactNode;
  /**
   * Tooltip rows for the current hover, or `null`.
   *
   * Accepts a FUNCTION of the resolved plot area as well as a plain value,
   * because a tooltip's position almost always depends on the same scales the
   * marks use — and those are only resolved here. Computing it inside
   * `children` and assigning to a captured variable does not work: `children`
   * runs after this prop has already been read, so the tooltip silently never
   * appears. (It does not fail to compile either, which is how it nearly
   * shipped.)
   */
  tooltip?: TooltipContent | null | ((plot: PlotArea) => TooltipContent | null);
  /** Pointer handlers, for a chart that publishes to a shared crosshair. */
  onPointerMove?: (event: React.PointerEvent<SVGSVGElement>, plot: PlotArea) => void;
  onPointerLeave?: () => void;
  className?: string;
}

export interface PlotArea {
  /** Plot rectangle, inside the padding. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Full frame, for anything that draws into the margins. */
  frameWidth: number;
  frameHeight: number;
  /** Value -> y pixel. Identity-ish fallback when no `domain` was given. */
  y: (v: number) => number;
  domain: Domain | null;
}

export interface TooltipContent {
  /** Position in SVG user units; converted to the host element's pixels. */
  x: number;
  y: number;
  rows: Array<{ value: string; label?: string; color?: string }>;
}

const DEFAULT_PADDING = { top: 12, right: 12, bottom: 8, left: 34 };

export function ChartFrame({
  width,
  height,
  padding,
  domain,
  tickCount = 3,
  tickFormat,
  isEmpty,
  emptyMessage = 'Not available for this matchup yet.',
  isLoading,
  label,
  children,
  tooltip,
  onPointerMove,
  onPointerLeave,
  className,
}: ChartFrameProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [hostWidth, setHostWidth] = useState<number>(width);

  const pad = { ...DEFAULT_PADDING, ...padding };
  const plotWidth = Math.max(0, width - pad.left - pad.right);
  const plotHeight = Math.max(0, height - pad.top - pad.bottom);
  const plot: PlotArea = {
    left: pad.left,
    top: pad.top,
    width: plotWidth,
    height: plotHeight,
    frameWidth: width,
    frameHeight: height,
    y: domain ? yScale(domain, pad.top, plotHeight) : (v) => v,
    domain: domain ?? null,
  };

  const measure = useCallback((node: HTMLDivElement | null) => {
    if (node) setHostWidth(node.clientWidth || width);
  }, [width]);

  // Loading takes precedence over empty: "we do not know yet" and "there is
  // nothing" are different claims, and showing the second while the first is
  // true is how a page tells the reader something false.
  if (isLoading) {
    return (
      <div className={className} style={{ height }} aria-label={`${label} (loading)`} aria-busy="true">
        <div className="h-full w-full animate-pulse rounded-[6px] bg-line/25" />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div
        className={`flex items-center justify-center rounded-[6px] border border-dashed border-line-soft px-4 text-center ${className ?? ''}`}
        style={{ height }}
        role="img"
        aria-label={`${label}: ${emptyMessage}`}
      >
        <p className="text-[11px] leading-snug text-ink-faint">{emptyMessage}</p>
      </div>
    );
  }

  const scale = hostWidth > 0 ? Math.min(1, hostWidth / width) : 1;
  const resolvedTooltip = typeof tooltip === 'function' ? tooltip(plot) : tooltip;

  return (
    <div
      ref={(n) => {
        hostRef.current = n;
        measure(n);
      }}
      className={`relative ${className ?? ''}`}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={label}
        style={{ display: 'block', overflow: 'visible', maxWidth: width, fontFamily: FONT_STACK }}
        onPointerMove={onPointerMove ? (e) => onPointerMove(e, plot) : undefined}
        onPointerLeave={onPointerLeave}
      >
        {domain
          ? ticksFor(domain, tickCount).map((v, i) => {
              const y = plot.y(v);
              return (
                <g key={i}>
                  <line x1={plot.left} x2={width - pad.right} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
                  <text
                    x={plot.left - 7}
                    y={y + 3}
                    fill={INK4}
                    fontSize={SIZE.tick}
                    textAnchor="end"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {(tickFormat ?? ((n: number) => n.toFixed(1)))(v)}
                  </text>
                </g>
              );
            })
          : null}
        {children(plot)}
      </svg>
      {resolvedTooltip ? <ChartTooltip content={resolvedTooltip} scale={scale} hostWidth={hostWidth} /> : null}
    </div>
  );
}

/**
 * The shared tooltip.
 *
 * Values go in as text nodes, never as markup — the same untrusted-data
 * discipline the mockup's own tooltip kept. Positioned in host pixels, so the
 * SVG user-unit coordinates are scaled by the frame's own responsive factor.
 */
function ChartTooltip({ content, scale, hostWidth }: { content: TooltipContent; scale: number; hostWidth: number }) {
  const px = content.x * scale;
  const py = content.y * scale;
  // Clamp so a tooltip near either edge stays inside the card.
  const left = Math.max(0, Math.min(hostWidth - 120, px - 60));
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-[6px] border border-line bg-paper px-2 py-1 shadow-card"
      style={{ left, top: Math.max(0, py - 44), minWidth: 96 }}
      role="status"
    >
      {content.rows.map((r, i) => (
        <div key={i} className="flex items-baseline gap-1.5 whitespace-nowrap text-[10.5px] leading-tight">
          {r.color ? <span className="inline-block h-2 w-2 shrink-0 rounded-[2px]" style={{ background: r.color }} /> : null}
          <span className="font-semibold tabular-nums text-ink">{r.value}</span>
          {r.label ? <span className="text-ink-faint">{r.label}</span> : null}
        </div>
      ))}
    </div>
  );
}
