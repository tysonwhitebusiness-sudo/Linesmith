/**
 * C0.2 — one team-colour source for every sport, and the maths that turns a
 * team's colours into a band white text can sit on.
 *
 * WHERE COLOURS COME FROM. ESPN's site API returns `color` and
 * `alternateColor` on its team LIST for every league we show (measured
 * 2026-09-21: NFL 32/32, MLB 30/30, NBA 30/30, NHL 32/32, EPL 20/20, MLS 30/30,
 * CFB 690/762). `lib/sports/nfl/teamColors.ts` said "ESPN has no color field
 * on a team"; that was true of the endpoint it looked at, not of this one.
 * The MLB and NFL hand tables become OVERRIDES on top of ESPN, not a second
 * source (`teamColorIndex.ts`).
 *
 * WHO HAS NONE. Golf has no team; tennis uses flags. `teamColor` returns null
 * there and every caller falls back to charcoal. That's data, not a sport
 * check.
 *
 * Pure: no fetching. The index is built server-side and read through
 * `/api/team-colors` (`components/useTeamColors.ts`).
 */

export interface TeamColor {
  /** `#rrggbb`. */
  primary: string;
  secondary: string | null;
}

/** A league's colours, by ESPN id and by abbreviation (upper-case). */
export interface TeamColorIndex {
  byId: Record<string, TeamColor>;
  byAbbr: Record<string, TeamColor>;
}

/** Look a team up by id first, then abbreviation. Null when the sport has no teams or the team isn't known. */
export function teamColor(index: TeamColorIndex | null | undefined, key: { id?: string | number | null; abbr?: string | null }): TeamColor | null {
  if (!index) return null;
  if (key.id != null && index.byId[String(key.id)]) return index.byId[String(key.id)];
  if (key.abbr && index.byAbbr[key.abbr.toUpperCase()]) return index.byAbbr[key.abbr.toUpperCase()];
  return null;
}

/* ------------------------------------------------------------ colour maths */

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Normalise ESPN's bare `a40227` to `#a40227`; null for anything that isn't a colour. */
export function normaliseHex(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const rgb = hexToRgb(raw);
  return rgb ? rgbToHex(rgb) : null;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours. */
export function contrast(a: string, b: string): number {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return 1;
  const [hi, lo] = [luminance(ra), luminance(rb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Scale each channel toward black by `f` (0 = unchanged, 1 = black). */
export function darken(hex: string, f: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(rgb.map((v) => v * (1 - f)) as Rgb);
}

/**
 * 0–1: how much hue a colour carries, relative to its own brightness (HSV
 * saturation). Relative, so a DARK team colour keeps its hue: Green Bay's
 * `#203731` and San Diego's brown are colours, where an absolute measure
 * called them grey. Black, white and true greys score ~0.
 */
function chroma(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const max = Math.max(...rgb);
  return max === 0 ? 0 : (max - Math.min(...rgb)) / max;
}

/** The charcoal every colourless band falls back to (`--color-masters`). */
export const CHARCOAL = '#1c1e22';

/** White text needs this contrast on the band. */
const MIN_CONTRAST = 4.5;
/** Darkening past this leaves a mud colour, not the team's: fall back instead. */
const MAX_DARKEN = 0.3;
/** Below this a colour is effectively grey/black and says nothing about the team. */
const MIN_CHROMA = 0.25;

/**
 * The least darkening that gets white text to 4.5:1, or null when that would
 * need more than `MAX_DARKEN` or the colour carries no hue (LV's `#000000`,
 * NO's gold `#D3BC8D`).
 */
function carryWhite(hex: string | null): string | null {
  if (!hex || chroma(hex) < MIN_CHROMA) return null;
  for (let f = 0; f <= MAX_DARKEN + 1e-9; f += 0.02) {
    const c = darken(hex, f);
    if (contrast(c, '#ffffff') >= MIN_CONTRAST) return c;
  }
  return null;
}

export interface BandColors {
  /** The mockup's 115° gradient, three stops, all ≥ 4.5:1 against white. */
  stops: [string, string, string];
  /** Which colour the band was built from; `charcoal` when neither team colour could carry white text. */
  source: 'primary' | 'secondary' | 'charcoal';
  /** The accent chip (position): the secondary with an ink picked by contrast, or null. */
  accent: { bg: string; ink: string } | null;
}

/**
 * Band colours for a team. MIN `#4F2683` → `#4f2683 · #3a1c63 · #2a1449`,
 * matching the mockup: each later stop is the first darkened 26% and 47%.
 */
export function bandColors(team: TeamColor | null): BandColors {
  const base = carryWhite(team?.primary ?? null);
  const fallback = base ? null : carryWhite(team?.secondary ?? null);
  const from = base ?? fallback ?? CHARCOAL;
  const source: BandColors['source'] = base ? 'primary' : fallback ? 'secondary' : 'charcoal';
  const stops: [string, string, string] = [from, darken(from, 0.26), darken(from, 0.47)];

  let accent: BandColors['accent'] = null;
  const sec = team?.secondary && source === 'primary' ? team.secondary : null;
  if (sec && chroma(sec) >= MIN_CHROMA) {
    // Light accent (VIKINGS gold #FFC62F) takes a dark ink of its own hue
    // (#3a2a00); a dark one takes white.
    const ink = contrast(sec, '#ffffff') >= MIN_CONTRAST ? '#ffffff' : darken(sec, 0.78);
    if (contrast(sec, ink) >= MIN_CONTRAST) accent = { bg: sec, ink };
  }
  return { stops, source, accent };
}

/** `linear-gradient(115deg, …)` for a band. */
export function bandGradient(b: BandColors): string {
  return `linear-gradient(115deg, ${b.stops[0]} 0%, ${b.stops[1]} 60%, ${b.stops[2]} 100%)`;
}

/** Which ESPN league a slate scope reads colours from. */
export const ESPN_TEAM_LEAGUES: Record<string, string> = {
  nfl: 'football/nfl',
  cfb: 'football/college-football',
  mlb: 'baseball/mlb',
  nba: 'basketball/nba',
  nhl: 'hockey/nhl',
  soccer_epl: 'soccer/eng.1',
  soccer_mls: 'soccer/usa.1',
};
