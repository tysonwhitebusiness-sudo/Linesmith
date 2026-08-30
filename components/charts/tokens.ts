/**
 * Chart tokens — Phase 6.4.
 *
 * The values the design boards (`docs/design/chart-grammar.html` and the three
 * per-sport boards) draw every mark against, resolved from the same
 * `tailwind.config.ts` scale the rest of the app uses. They are literals rather
 * than Tailwind classes because SVG attributes (`stroke`, `fill`) do not take
 * class names, and a chart that half-follows the theme is worse than one that
 * plainly states its palette.
 *
 * COLOUR RAMPS ARE NOT REDEFINED HERE. `lib/ui/heat.ts` already owns them —
 * `heatFill`/`heatInk`/`compareInk`/`deltaToHeat`/`rankToHeat` — and the
 * mockups ported that file verbatim precisely so the two could not drift.
 * Import from `@/lib/ui/heat`; do not add a second copy of a ramp here.
 *
 * ON `card` BEING DARKER THAN `paper`. `card` is oklch 93% and `paper` is 96%,
 * so a card sits *below* the page rather than above it. That inversion is
 * pre-existing (a graphite reskin held paper and dropped card) and is flagged
 * in the handoff notes as worth confirming rather than inheriting. `SURFACE`
 * below follows `card` because that is the ground a chart actually sits on
 * today — if the elevation model is ever corrected, this is the one place that
 * needs to change.
 */

/** The ground every mark sits on — `--card`. Used for the ring that keeps a dot legible where it crosses its own line. */
export const SURFACE = 'oklch(93% 0.003 260)';
/** `--line-soft`. Grid hairlines are SOLID and one step off the surface — never dashed, which reads as "provisional". */
export const GRID = 'oklch(90% 0.004 260)';

export const INK1 = 'oklch(16% 0.004 260)';
export const INK3 = 'oklch(50% 0.005 260)';
export const INK4 = 'oklch(68% 0.004 260)';
export const INK5 = 'oklch(78% 0.004 260)';

/** The emphasis stroke — one series is the subject, everything else is context. */
export const EMPHASIS = INK1;
/** Context threads: the same shape, receded, so the subject reads first. */
export const CONTEXT = INK5;
export const CONTEXT_OPACITY = 0.5;

/** Matches the app's own body stack; SVG does not inherit it from CSS reliably across renderers. */
export const FONT_STACK = 'ui-sans-serif, system-ui, sans-serif';

export const MIDDOT = '·';

/** Default type sizes, in SVG user units. Deliberately small — a chart label is not body copy. */
export const SIZE = { tick: 9, label: 9, value: 10, caption: 9 } as const;

/**
 * Formatters a primitive can be handed. Every primitive that prints a number
 * takes a `fmt` — see `zoneGrid`'s bug in `ChartFrame`'s own header for why
 * this is a parameter and not a constant.
 */
export const fmt = {
  /** Baseball rate convention: .312, not 0.312. Correct for MLB, WRONG for anything above 1.0. */
  rate3: (v: number) => v.toFixed(3).replace(/^(-?)0\./, '$1.'),
  int: (v: number) => Math.round(v).toString(),
  one: (v: number) => v.toFixed(1),
  two: (v: number) => v.toFixed(2),
  pct0: (v: number) => `${Math.round(v)}%`,
  pct1: (v: number) => `${v.toFixed(1)}%`,
  /** American odds always carry their sign. */
  american: (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`),
  signed1: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`,
  signed2: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`,
} as const;

export type Formatter = (v: number) => string;
