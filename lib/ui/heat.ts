/**
 * Heat scale — the shared language for "how strong is this number".
 *
 * Every percentage-driven surface in the app (hit rates, split rates, hole
 * difficulty, per-book odds) reads off this one ramp so that a given colour
 * always means the same thing. A flat accent applied regardless of magnitude
 * tells the user nothing; strength has to be visible before the number is read.
 *
 * Two ramps, deliberately:
 *  - `fill`  — vivid, for bars, badges and backgrounds.
 *  - `ink`   — darkened, for text on white/tinted surfaces so mid-scale amber
 *              still clears 4.5:1 contrast. Never use `fill` for small text.
 *
 * Tailwind can't generate classes from runtime values, so these return CSS
 * colour strings for inline styles. That's the intended usage.
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Vivid ramp: bad red → caution amber → good green — richer/more saturated
 * than the `masters` brand token on purpose. `masters` is app chrome
 * (buttons, nav, active states) and stays fixed; this ramp is the
 * data-quality signal and is allowed to diverge so it reads with more
 * punch. Matches the `good`/`warn`/`bad` Tailwind tokens exactly.
 */
const FILL_STOPS: Rgb[] = [
  { r: 0xff, g: 0x4d, b: 0x4f }, // bad  #ff4d4f (C0, Electric Turf)
  { r: 0xff, g: 0xb0, b: 0x20 }, // warn #ffb020
  { r: 0x00, g: 0xd2, b: 0x6a }, // good #00d26a
];

/** Text ramp: the `-ink` tokens, legible on paper/white (C0). */
const INK_STOPS: Rgb[] = [
  { r: 0xc4, g: 0x16, b: 0x1c }, // bad-ink  #c4161c
  { r: 0x9a, g: 0x62, b: 0x00 }, // warn-ink #9a6200
  { r: 0x00, g: 0x87, b: 0x3f }, // good-ink #00873f
];

const clamp01 = (t: number) => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.5);

function lerp(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

/** Sample a three-stop ramp at `t` ∈ [0,1]. */
function sample(stops: Rgb[], t: number): Rgb {
  const x = clamp01(t);
  if (x <= 0.5) return lerp(stops[0], stops[1], x / 0.5);
  return lerp(stops[1], stops[2], (x - 0.5) / 0.5);
}

const css = ({ r, g, b }: Rgb, alpha = 1) =>
  alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;

/**
 * Outcomes with no direction — a par, a hitless game — are grey, not amber.
 * The ramp's midpoint means "middling strength", which is a different claim
 * from "this result was neither good nor bad".
 */
const NEUTRAL: Rgb = { r: 0xa8, g: 0xa2, b: 0x9a };

/** Fill for a categorical outcome tone, rather than a position on the ramp. */
export function toneFill(tone: 'good' | 'bad' | 'neutral', alpha = 1): string {
  if (tone === 'neutral') return css(NEUTRAL, alpha);
  return heatFill(tone === 'good' ? 0.92 : 0.08, alpha);
}

/** Vivid colour at strength `t` — bars, dots, filled badges. */
export function heatFill(t: number, alpha = 1): string {
  return css(sample(FILL_STOPS, t), alpha);
}

/** Legible text colour at strength `t`. */
export function heatInk(t: number): string {
  return css(sample(INK_STOPS, t));
}

/**
 * Comparison ramp: red → neutral ink → green.
 *
 * A hit rate of 50% really is middling, which amber says well on a tinted
 * badge. But a price in the middle of six books, or a hole playing its par, is
 * just ordinary — and a column of brown numbers buries the one value that
 * matters. This ramp keeps the middle quiet so only the extremes catch the eye.
 * Use it for bare numerals; use `heatBadge` where there's a tint behind them.
 */
const COMPARE_STOPS: Rgb[] = [
  { r: 0x8f, g: 0x2b, b: 0x20 },
  { r: 0x6d, g: 0x67, b: 0x5e }, // ink-muted
  { r: 0x0b, g: 0x5c, b: 0x3c },
];

export function compareInk(t: number): string {
  return css(sample(COMPARE_STOPS, t));
}

export interface HeatStyle {
  color: string;
  backgroundColor: string;
  borderColor: string;
}

export interface TileStyle {
  backgroundColor: string;
  backgroundImage: string;
  color: string;
}

/**
 * Map a signed delta (e.g. recent rate − season baseline) onto the ramp.
 * `span` is the delta magnitude that counts as fully hot/cold.
 */
export function deltaToHeat(delta: number, span = 0.35): number {
  if (!Number.isFinite(delta) || span <= 0) return 0.5;
  return clamp01(0.5 + delta / (span * 2));
}

/**
 * Rank a value within an observed range, best → 1, worst → 0.
 *
 * Used for the per-bookmaker odds gradient, where "good" is only meaningful
 * relative to the other prices on screen. A single-value range (every book
 * identical) returns neutral-best rather than pretending there's a spread.
 */
export function rankToHeat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0.5;
  if (max === min) return 0.75;
  return clamp01((value - min) / (max - min));
}

// ---------------------------------------------------------------------------
// Gradient cards — the glowing badge treatment (window boxes, card stats)
// ---------------------------------------------------------------------------

/**
 * Hue steps at the same four cut points a reader already treats as "great /
 * good / meh / bad" — a hard swap of colour family reads faster than a hue
 * that slowly rotates through the same boundary.
 */
function gradientHue(t: number): number {
  if (t >= 0.75) return 155; // green
  if (t >= 0.5) return 80; // amber-green
  if (t >= 0.3) return 35; // orange
  return 25; // red
}

interface GradientStop {
  rate: number;
  val: [number, number]; // L, C
  fill: [number, number, number, number]; // L1, C1 -> L2, C2
  glow: [number, number]; // L, C
  shadow: [number, number, number]; // L, C, alpha
}

/** Anchors sampled directly off the design reference; hue is layered on separately via `gradientHue`. */
const GRADIENT_STOPS: GradientStop[] = [
  { rate: 0.2, val: [0.46, 0.15], fill: [0.7, 0.12, 0.48, 0.17], glow: [0.93, 0.07], shadow: [0.52, 0.15, 0.5] },
  { rate: 0.4, val: [0.48, 0.13], fill: [0.74, 0.1, 0.55, 0.15], glow: [0.95, 0.05], shadow: [0.58, 0.13, 0.4] },
  { rate: 0.667, val: [0.48, 0.12], fill: [0.78, 0.09, 0.58, 0.14], glow: [0.95, 0.06], shadow: [0.63, 0.12, 0.4] },
  { rate: 0.7, val: [0.46, 0.11], fill: [0.76, 0.08, 0.55, 0.13], glow: [0.95, 0.05], shadow: [0.6, 0.11, 0.35] },
  { rate: 1, val: [0.42, 0.13], fill: [0.72, 0.1, 0.5, 0.15], glow: [0.94, 0.06], shadow: [0.55, 0.14, 0.45] },
];

function lerp2(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface GradientCardStyle {
  valueColor: string;
  labelGlow: string;
  boxShadow: string;
  fillBackground: string;
  tableWash: string;
}

/**
 * The gradient-badge treatment: a colour-matched glow, a tinted meter fill,
 * and a heat-mapped value — the look from the "Gradient Card Final" design
 * reference, driven off the same `rate` every other surface already uses.
 */
/** Shared stop-interpolation: hue by bucket, every other channel smoothly blended between the two nearest sampled anchors. */
function gradientSample(rate: number) {
  const t = clamp01(rate);
  const hue = gradientHue(t);

  let lo = GRADIENT_STOPS[0];
  let hi = GRADIENT_STOPS[GRADIENT_STOPS.length - 1];
  for (let i = 0; i < GRADIENT_STOPS.length - 1; i++) {
    if (t >= GRADIENT_STOPS[i].rate && t <= GRADIENT_STOPS[i + 1].rate) {
      lo = GRADIENT_STOPS[i];
      hi = GRADIENT_STOPS[i + 1];
      break;
    }
  }
  const span = hi.rate - lo.rate || 1;
  const f = clamp01((t - lo.rate) / span);

  const val: [number, number] = [lerp2(lo.val[0], hi.val[0], f), lerp2(lo.val[1], hi.val[1], f)];
  const fill: [number, number, number, number] = [
    lerp2(lo.fill[0], hi.fill[0], f),
    lerp2(lo.fill[1], hi.fill[1], f),
    lerp2(lo.fill[2], hi.fill[2], f),
    lerp2(lo.fill[3], hi.fill[3], f),
  ];
  const glow: [number, number] = [lerp2(lo.glow[0], hi.glow[0], f), lerp2(lo.glow[1], hi.glow[1], f)];
  const shadow: [number, number, number] = [
    lerp2(lo.shadow[0], hi.shadow[0], f),
    lerp2(lo.shadow[1], hi.shadow[1], f),
    lerp2(lo.shadow[2], hi.shadow[2], f),
  ];

  return { hue, val, fill, glow, shadow };
}

export function gradientCardStyle(rate: number): GradientCardStyle {
  const { hue, val, fill, glow, shadow } = gradientSample(rate);

  return {
    valueColor: `oklch(${val[0].toFixed(3)} ${val[1].toFixed(3)} ${hue})`,
    // Radial — for the floating card badges (window boxes, headline boxes),
    // matching the original design reference exactly.
    labelGlow: `radial-gradient(circle at 50% 25%, oklch(${glow[0].toFixed(3)} ${glow[1].toFixed(3)} ${hue}), transparent 70%)`,
    boxShadow: `0 5px 14px -5px oklch(${shadow[0].toFixed(3)} ${shadow[1].toFixed(3)} ${hue} / ${shadow[2].toFixed(2)})`,
    fillBackground: `linear-gradient(90deg, oklch(${fill[0].toFixed(3)} ${fill[1].toFixed(3)} ${hue}), oklch(${fill[2].toFixed(3)} ${fill[3].toFixed(3)} ${hue}))`,
    // Straight top-to-bottom band — for the dense table's full-bleed cells.
    // A linear gradient's colour is uniform across the whole width at any
    // given height, so adjacent cells' top edges line up with no falloff
    // toward the corners the way a centred radial glow would leave.
    tableWash: `linear-gradient(to bottom, oklch(${glow[0].toFixed(3)} ${glow[1].toFixed(3)} ${hue}), transparent)`,
  };
}

/**
 * The same glow/meter treatment for a signed delta rather than a rate: green
 * above the line, red below it — never the amber/orange middle, since a delta
 * only has two sides. `span` is the magnitude that counts as fully saturated;
 * anything past it just stays at full intensity rather than going brighter.
 */
function deltaPseudoRate(delta: number, span: number): number {
  const magnitude = clamp01(Math.abs(delta) / span);
  // Pinned inside gradientHue's green (>=0.75) and red (<0.3) bands so a
  // delta can never land on the amber/orange steps meant for rates.
  return delta >= 0 ? 0.75 + magnitude * 0.25 : 0.29 - magnitude * 0.29;
}

export function deltaGradientStyle(delta: number, span = 2): GradientCardStyle {
  return gradientCardStyle(deltaPseudoRate(delta, span));
}
