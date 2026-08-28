'use client';

import type { Sport } from '@/lib/core/types';

/**
 * The one place a market gets named.
 *
 * Every card, table row, detail header and slip leg routes through this, so a
 * market reads identically wherever it appears and can never end up buried
 * mid-sentence. The badge names the stat; the number beside it is the line.
 *
 * Two modes:
 *  - `full`    — "Hits", "1st-Inning Runs Allowed". Cards, detail pages, slip.
 *  - `compact` — "H", "1st-Inn R". Dense table cells.
 *
 * The full text is always in `aria-label`, so the compact mode abbreviates for
 * the eye without abbreviating for a screen reader.
 */

export type MarketLabelMode = 'full' | 'compact';

/**
 * Seeded market vocabulary.
 *
 * Deliberately wider than what the MLB adapter emits today: the dimensions
 * below that aren't live yet are the ones the gamelog already carries columns
 * for, so when a dimension is added the label is already correct rather than
 * falling through to a raw key. An unmapped key still renders — it just renders
 * as itself, which is honest and visibly unfinished rather than blank.
 */
const MLB_MARKETS: Record<string, { full: string; compact: string }> = {
  // Live in the adapter today.
  'hit-in-game': { full: 'Hits', compact: 'H' },
  'vs-LHP': { full: 'Hits vs LHP', compact: 'H/LHP' },
  'vs-RHP': { full: 'Hits vs RHP', compact: 'H/RHP' },
  'first-inning': { full: '1st-Inning Runs Allowed', compact: '1st-Inn R' },
  // Seeded ahead of the dimensions that will emit them.
  hits: { full: 'Hits', compact: 'H' },
  'total-bases': { full: 'Total Bases', compact: 'TB' },
  'home-runs': { full: 'Home Runs', compact: 'HR' },
  rbis: { full: 'RBIs', compact: 'RBI' },
  runs: { full: 'Runs', compact: 'R' },
  walks: { full: 'Walks', compact: 'BB' },
  'batter-strikeouts': { full: 'Batter Strikeouts', compact: 'K (bat)' },
  'pitcher-strikeouts': { full: 'Pitcher Strikeouts', compact: 'K' },
  'hits-runs-rbis': { full: 'H+R+RBI', compact: 'H+R+RBI' },
  // Deliberately not "1B"/"2B"/"3B": those collide with the fielding
  // position abbreviations Scan's dense rows show right next to them — a
  // third baseman's Triples prop would otherwise read "3B ... 3B" for two
  // completely different things.
  singles: { full: 'Singles', compact: 'Sngl' },
  doubles: { full: 'Doubles', compact: 'Dbl' },
  triples: { full: 'Triples', compact: 'Trip' },
  'stolen-bases': { full: 'Stolen Bases', compact: 'SB' },
  'earned-runs': { full: 'Earned Runs', compact: 'ER' },
  'pitcher-outs': { full: 'Pitcher Outs', compact: 'Outs' },
  // Game-level markets (Game Detail's picks panel), not player props.
  moneyline: { full: 'Moneyline', compact: 'ML' },
  spread: { full: 'Spread', compact: 'Spread' },
  total: { full: 'Total', compact: 'Total' },
  'game-total': { full: 'Total', compact: 'Total' },
  // Update-09's five-provider prop feed — seeded ahead of `resolveMarketKey`
  // in lib/odds/props/entityResolution.ts, which routes raw provider labels
  // to these same keys.
  'pitcher-hits-allowed': { full: 'Hits Allowed', compact: 'H Allowed' },
  'runs-rbis': { full: 'Runs + RBIs', compact: 'R+RBI' },
  'first-home-run': { full: 'First Home Run', compact: '1st HR' },
  'pitcher-walks-allowed': { full: 'Walks Allowed', compact: 'BB Allowed' },
  'pitcher-win': { full: 'Win', compact: 'Win' },
  // Team-level markets (Game Detail's Team scope), not player props.
  'team-total-runs': { full: 'Team Total Runs', compact: 'Team R' },
};

const NFL_MARKETS: Record<string, { full: string; compact: string }> = {
  'passing-yards': { full: 'Passing Yards', compact: 'Pass Yds' },
  'passing-tds': { full: 'Passing TDs', compact: 'Pass TD' },
  'rushing-yards': { full: 'Rushing Yards', compact: 'Rush Yds' },
  'rushing-tds': { full: 'Rushing TDs', compact: 'Rush TD' },
  'receiving-yards': { full: 'Receiving Yards', compact: 'Rec Yds' },
  receptions: { full: 'Receptions', compact: 'Rec' },
  'receiving-tds': { full: 'Receiving TDs', compact: 'Rec TD' },
  'interceptions-thrown': { full: 'Interceptions Thrown', compact: 'INT' },
  'longest-rush': { full: 'Longest Rush', compact: 'Lng Rush' },
  'longest-reception': { full: 'Longest Reception', compact: 'Lng Rec' },
  'longest-completion': { full: 'Longest Completion', compact: 'Lng Cmp' },
  'field-goals-made': { full: 'Field Goals Made', compact: 'FG' },
  'kicking-points': { full: 'Kicking Points', compact: 'Kick Pts' },
  'rush-rec-tds': { full: 'Rush + Rec TDs', compact: 'Rush+Rec TD' },
  'rush-rec-yards': { full: 'Rush + Rec Yards', compact: 'Rush+Rec Yds' },
  sacks: { full: 'Sacks', compact: 'Sacks' },
  'anytime-td': { full: 'Anytime TD', compact: 'Any TD' },
  'first-td-scorer': { full: 'First TD Scorer', compact: '1st TD' },
  'passing-completions': { full: 'Passing Completions', compact: 'Cmp' },
  'pass-attempts': { full: 'Pass Attempts', compact: 'Att' },
  'rushing-attempts': { full: 'Rushing Attempts', compact: 'Rush Att' },
  // Game/team-level, shared vocabulary with MLB's own moneyline/spread/total keys below.
  'team-total-points': { full: 'Team Total Points', compact: 'Team Pts' },
  // CFB's teamFormCandidates.ts uses this exact key (not NFL's own
  // 'team-total-points') for the identical "this team's own score" market —
  // both point here rather than duplicating the label.
  'team-points-for': { full: 'Team Points', compact: 'Team Pts' },
};

const NHL_MARKETS: Record<string, { full: string; compact: string }> = {
  goals: { full: 'Goals', compact: 'G' },
  assists: { full: 'Assists', compact: 'A' },
  points: { full: 'Points', compact: 'PTS' },
  'shots-on-goal': { full: 'Shots on Goal', compact: 'SOG' },
  hits: { full: 'Hits', compact: 'HITS' },
  'blocked-shots': { full: 'Blocked Shots', compact: 'BLK' },
  saves: { full: 'Saves', compact: 'SV' },
  'goals-against': { full: 'Goals Against', compact: 'GA' },
  'team-goals-for': { full: 'Team Goals', compact: 'Team G' },
};

const NBA_MARKETS: Record<string, { full: string; compact: string }> = {
  points: { full: 'Points', compact: 'PTS' },
  rebounds: { full: 'Rebounds', compact: 'REB' },
  assists: { full: 'Assists', compact: 'AST' },
  'three-pointers-made': { full: '3-Pointers Made', compact: '3PM' },
  steals: { full: 'Steals', compact: 'STL' },
  blocks: { full: 'Blocks', compact: 'BLK' },
  turnovers: { full: 'Turnovers', compact: 'TO' },
  'points-rebounds-assists': { full: 'Pts + Reb + Ast', compact: 'PRA' },
  'points-rebounds': { full: 'Pts + Reb', compact: 'PR' },
  'points-assists': { full: 'Pts + Ast', compact: 'PA' },
  'rebounds-assists': { full: 'Reb + Ast', compact: 'RA' },
  'team-points-for': { full: 'Team Points', compact: 'Team Pts' },
};

const SOCCER_MARKETS: Record<string, { full: string; compact: string }> = {
  'anytime-goalscorer': { full: 'Anytime Goalscorer', compact: 'Anytime G' },
  'first-goalscorer': { full: 'First Goalscorer', compact: '1st Gscorer' },
  'last-goalscorer': { full: 'Last Goalscorer', compact: 'Last Gscorer' },
  'two-plus-goals': { full: '2+ Goals', compact: '2+ G' },
  assists: { full: 'Assists', compact: 'A' },
  shots: { full: 'Shots', compact: 'SH' },
  'shots-on-target': { full: 'Shots on Target', compact: 'SOT' },
  'goals-assists': { full: 'Goals + Assists', compact: 'G+A' },
  tackles: { full: 'Tackles', compact: 'TKL' },
  'passes-attempted': { full: 'Passes Attempted', compact: 'Pass Att' },
  'team-goals-for': { full: 'Team Goals', compact: 'Team G' },
};

const TENNIS_MARKETS: Record<string, { full: string; compact: string }> = {
  aces: { full: 'Aces', compact: 'Aces' },
  'games-won': { full: 'Games Won', compact: 'Gms Won' },
  'to-win-a-set': { full: 'To Win a Set', compact: 'Win Set' },
};

const NFL_CATEGORY_LABELS: Record<string, string> = {
  over: 'Over',
  under: 'Under',
  unknown: 'Unrecorded',
};

const MLB_CATEGORY_LABELS: Record<string, string> = {
  hit: 'Hit',
  'no-hit': 'No hit',
  run: 'Run allowed',
  'no-run': 'No run',
  over: 'Over',
  under: 'Under',
  unknown: 'Unrecorded',
};

const GOLF_CATEGORY_LABELS: Record<string, string> = {
  birdie: 'Birdie or better',
  'birdie-or-better': 'Birdie or better',
  par: 'Par',
  bogey: 'Bogey or worse',
  'bogey-or-worse': 'Bogey or worse',
  over: 'Over',
  under: 'Under',
  unknown: 'Unrecorded',
};

/**
 * Golf's richest label ("Hole 7 (Par 3)") lives on the candidate's own
 * `dimensionLabel`, which this function never sees — it only gets the raw
 * `dimension` key. So full mode formats that key directly rather than
 * printing it verbatim ("hole-7"), and compact mode shortens the same way.
 * Falls back to a generic kebab-case → Title Case for any future dimension
 * this hasn't been taught about yet, so a new market never prints a raw key.
 */
function golfLabel(dimension: string, mode: MarketLabelMode): string {
  const hole = dimension.match(/^hole-(\d+)$/);
  if (hole) return mode === 'compact' ? `H${hole[1]}` : `Hole ${hole[1]}`;
  if (dimension === 'round-score') return mode === 'compact' ? 'Rd Score' : 'Round Score';
  return titleCase(dimension);
}

/** Generic kebab-case → Title Case, the last-resort fallback below — an unmapped
 * dimension still renders cleanly ("Shots On Target") instead of printing its raw
 * wire key ("shots-on-target") verbatim. Every sport's table exists so its real
 * markets get a hand-tuned label instead of relying on this, but this is what
 * keeps a brand-new/unmapped market from ever looking "sloppy behind the scenes". */
function titleCase(dimension: string): string {
  return dimension
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const SPORT_MARKETS: Partial<Record<Sport, Record<string, { full: string; compact: string }>>> = {
  nfl: NFL_MARKETS,
  cfb: NFL_MARKETS,
  nhl: NHL_MARKETS,
  nba: NBA_MARKETS,
  soccer: SOCCER_MARKETS,
  tennis: TENNIS_MARKETS,
};

/** Resolve a dimension key to its display text. Exported for sorting and aria. */
export function marketText(sport: Sport, dimension: string, mode: MarketLabelMode = 'full'): string {
  if (sport === 'golf') return golfLabel(dimension, mode);
  // Sport-specific table first (its own real markets), then MLB's table as a
  // fallback for the shared game/team-level vocabulary every sport reuses
  // (moneyline, game-total, spread) — mirrors the reuse CFB already gets from
  // NFL_MARKETS in SPORT_MARKETS above — then a clean generic fallback rather
  // than ever printing the raw dimension key.
  const entry = SPORT_MARKETS[sport]?.[dimension] ?? MLB_MARKETS[dimension];
  if (!entry) return titleCase(dimension);
  return mode === 'compact' ? entry.compact : entry.full;
}

const SHARED_CATEGORY_LABELS: Record<string, string> = {
  over: 'Over',
  under: 'Under',
  yes: 'Yes',
  no: 'No',
  unknown: 'Unrecorded',
};

export function categoryText(sport: Sport, category: string): string {
  const labels =
    sport === 'golf' ? GOLF_CATEGORY_LABELS : sport === 'nfl' ? NFL_CATEGORY_LABELS : sport === 'mlb' ? MLB_CATEGORY_LABELS : SHARED_CATEGORY_LABELS;
  return labels[category] ?? category;
}

/** Full spoken form: "Hits — Hit", used as the accessible name everywhere. */
export function marketAriaLabel(sport: Sport, dimension: string, category: string, line?: number): string {
  const market = marketText(sport, dimension, 'full');
  const bucket = categoryText(sport, category);
  return line != null ? `${bucket} ${line} ${market}` : `${market} — ${bucket}`;
}

export interface MarketLabelProps {
  sport: Sport;
  dimension: string;
  category: string;
  mode?: MarketLabelMode;
  /** Included in the accessible name when present. */
  line?: number;
  className?: string;
}

export function MarketLabel({
  sport,
  dimension,
  category,
  mode = 'full',
  line,
  className = '',
}: MarketLabelProps) {
  return (
    <span
      className={`lb-chip bg-ink/5 text-ink-muted ${className}`}
      aria-label={marketAriaLabel(sport, dimension, category, line)}
    >
      <span aria-hidden>{marketText(sport, dimension, mode)}</span>
    </span>
  );
}

/**
 * The market as it reads on a betting slip: "Over 0.5 Hits".
 *
 * This is the phrasing both reference products use everywhere a prop is named,
 * and it's meaningfully clearer than a bare stat badge — the direction is the
 * whole claim. Falls back to the category label for dimensions with no line.
 */
export interface MarketLineProps extends MarketLabelProps {
  /** Overrides `line` for display, e.g. while the stepper is mid-adjust. */
  threshold?: number;
  /** Larger type for detail-page headers. */
  size?: 'sm' | 'md';
}

export function MarketLine({
  sport,
  dimension,
  category,
  mode = 'full',
  line,
  threshold,
  size = 'sm',
  className = '',
}: MarketLineProps) {
  const value = threshold ?? line;
  const market = marketText(sport, dimension, mode);
  const bucket = categoryText(sport, category);

  // A dimension with a threshold reads as a directional bet; one without reads
  // as the outcome it actually is.
  const text = value != null ? `${directionOf(category, bucket)} ${value} ${market}` : `${bucket} · ${market}`;

  return (
    <span
      className={`inline-flex items-baseline gap-1 font-medium tabular-nums ${
        size === 'md' ? 'text-[15px]' : 'text-[13px]'
      } ${className}`}
      aria-label={text}
    >
      <span aria-hidden>{text}</span>
    </span>
  );
}

/**
 * Which side of the line a result bucket sits on, as a one-character token.
 *
 * Dense cells have no room for "Under", but they absolutely cannot omit the
 * direction: a row reading "Hits 0.5 — 100%" for a player who has *not* hit in
 * ten straight games is precisely backwards, and the hit rate alone can't
 * disambiguate it. Returns null when the dimension has no direction.
 */
export function directionMark(category: string): 'O' | 'U' | null {
  switch (category) {
    case 'hit':
    case 'run':
    case 'over':
      return 'O';
    case 'no-hit':
    case 'no-run':
    case 'under':
      return 'U';
    default:
      return null;
  }
}

/**
 * Which side of the line a result bucket sits on.
 *
 * 'hit' / 'no-run' aren't literally "over" and "under", but against a 0.5 line
 * that is exactly what they are, and naming them that way is what lets an MLB
 * pattern and a stepped alternate line read in one consistent voice.
 */
function directionOf(category: string, fallback: string): string {
  switch (category) {
    case 'hit':
    case 'run':
    case 'over':
      return 'Over';
    case 'no-hit':
    case 'no-run':
    case 'under':
      return 'Under';
    default:
      return fallback;
  }
}

export default MarketLabel;
