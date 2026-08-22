/**
 * Shared vocabulary for every sport in Linesmith.
 *
 * Rule of the house: sport adapters normalise INTO these types. Nothing in
 * `lib/core/*` may branch on `sport`. If a sport needs something this shape
 * cannot express, widen the type here — never fork the engine.
 */

import type { WindowedStat } from './windowedStat';

export type Sport = 'golf' | 'mlb' | 'nfl' | 'soccer' | 'cfb' | 'nba';

export const SPORTS: Sport[] = ['golf', 'mlb', 'nfl', 'soccer', 'cfb', 'nba'];

export const SPORT_LABEL: Record<Sport, string> = {
  golf: 'Golf',
  mlb: 'MLB',
  nfl: 'NFL',
  soccer: 'Soccer',
  cfb: 'CFB',
  nba: 'NBA',
};

/** Soccer is the first sport with more than one competition — a real, closed
 * union per docs/soccer-gameplan-2026-08-22.md §6a, not an open string, so a
 * new league is a deliberate type-level addition, not silently possible by
 * typo. Scope for this build: EPL + MLS (§8's final scope note). */
export type SoccerLeague = 'epl' | 'mls';

export const SOCCER_LEAGUES: SoccerLeague[] = ['epl', 'mls'];

export const SOCCER_LEAGUE_LABEL: Record<SoccerLeague, string> = {
  epl: 'Premier League',
  mls: 'MLS',
};

/** Which real-world unit `liveState.distanceToSubject` is counted in. */
export type DistanceUnit = 'holes' | 'batters' | 'innings' | 'games';

export const DISTANCE_UNIT_LABEL: Record<DistanceUnit, [singular: string, plural: string]> = {
  holes: ['hole', 'holes'],
  batters: ['batter', 'batters'],
  innings: ['inning', 'innings'],
  games: ['game', 'games'],
};

export type LiveStatus = 'live' | 'pre' | 'done' | 'unknown';

/**
 * How an ETA was arrived at.
 *  - `measured`  — derived from this subject's own observed pace.
 *  - `fallback`  — derived from a peer/field median, or a league constant.
 *  - `null`      — we do not know. Render "unknown", never a number.
 */
export type EtaConfidence = 'measured' | 'fallback' | null;

export interface HistoryEntry {
  /** Round number (golf) or game number (MLB). Ascending = older → newer. */
  period: number;
  /** Sport-specific result token, e.g. '-1' | 'E' | '+2' | 'hit' | 'no-hit'. */
  result: string;
  /** Which category bucket this entry fell into. Lets the engine stay generic. */
  category: string;
  /** Human label for the period, e.g. 'R2' or 'Aug 4 @ WSH'. */
  periodLabel?: string;
  /**
   * Optional because MLB's list-view payload dedupes this (and periodLabel)
   * out of every candidate but the first seen per subject — see
   * lib/sports/mlb/historyTrim.ts. useSnapshot.ts's client-side rehydration
   * merges it back in immediately after fetch, so any code running after
   * that point can still treat it as present; only the raw wire payload
   * (and code that reads it before rehydration runs) sees it missing.
   */
  raw?: unknown;
}

export interface LiveState {
  status: LiveStatus;
  /**
   * Exact count of units until the subject reaches the thing being bet on.
   * `null` means we genuinely do not know — the UI must say so rather than
   * showing a confident-looking guess.
   */
  distanceToSubject: number | null;
  distanceUnit: DistanceUnit;
  /** Secondary, advisory only. Never sort on this ahead of distance. */
  etaMinutes: number | null;
  etaConfidence: EtaConfidence;
  /** Free-text explanation shown on hover/expand, e.g. why ETA is unknown. */
  note?: string;
}

export interface WeatherForecastHour {
  /** ISO timestamp for this hour's reading. */
  time: string;
  windMph: number;
  windDir: string;
  rainPct: number;
  tempF?: number;
}

export interface WeatherContext {
  windMph: number;
  windDir: string;
  rainPct: number;
  tempF?: number;
  /** Where the reading came from, so the UI can be honest about precision. */
  source: string;
  /** True when the coordinates are approximate (e.g. city-level geocode). */
  approximateLocation?: boolean;
  /** The next few hours, current reading first — the hourly forecast was already being fetched for the single `windMph`/etc. reading above; this just keeps the rest of it instead of discarding it. */
  forecast?: WeatherForecastHour[];
}

export interface PickContext {
  weather?: WeatherContext;
  other?: Record<string, unknown>;
}

export type OddsSource = 'manual' | 'screenshot' | 'odds-api';

export interface OddsInfo {
  americanOdds: string;
  source: OddsSource;
  capturedAt: string;
}

/**
 * What kind of signal a piece of evidence represents.
 *
 * This is the semantic layer under the insight-icon vocabulary: a consumer
 * picks the glyph from the `kind`, never from parsing the label. Establishing
 * it here means every surface that shows evidence bullets — Scan cards, Game
 * Detail candidate rows, Player Detail — agrees on what a bolt means without
 * coordinating.
 *
 * `venue-split` covers home and away deliberately: it is one concept measured
 * two ways, and the label says which.
 */
export type InsightKind =
  | 'recent-form'
  | 'head-to-head'
  | 'venue-split'
  | 'weather'
  | 'opponent-rank'
  | 'handedness'
  | 'streak'
  | 'rest';

/**
 * One corroborating angle on the same pattern, e.g. "8 of last 10 vs LHP".
 *
 * A single sample is weak evidence on its own; showing the same claim measured
 * several independent ways is what makes a pattern worth acting on. Adapters
 * populate only the splits that are genuinely meaningful for their sport —
 * an empty list is honest, an invented split is not.
 *
 * The measurement is a `WindowedStat`, so a split that didn't have the games
 * behind it arrives as `insufficient` and is rendered as such rather than
 * silently dropped or, worse, shown as a rate over a short sample.
 */
export interface SplitEvidence {
  kind: InsightKind;
  label: string;
  stat: WindowedStat;
  /**
   * Overrides the right-aligned figure.
   *
   * Not every signal measures a rate. A defensive-rank bullet ends in an
   * ordinal ("27th") and a weather bullet in a magnitude ("7 mph"); forcing
   * those through a percentage would misreport them. When set, `stat` is
   * carried only for sorting and may be `insufficient`.
   */
  figure?: string;
}

export interface PickCandidate {
  sport: Sport;

  subjectId: string;
  subjectName: string;
  subjectMeta?: Record<string, unknown>;

  /** Machine key for the thing being measured: 'hole-7' | 'vs-LHP' | ... */
  dimension: string;
  dimensionLabel: string;

  /** Result bucket: golf 'birdie' | 'par' | 'bogey'; MLB 'hit' | 'no-hit' | ... */
  category: string;
  categoryLabel: string;

  /**
   * The threshold this pattern is measured against, when the dimension has one.
   *
   * "Records a hit" is really "over 0.5 hits", and saying so explicitly is what
   * lets the same candidate be re-measured at 1.5 by the detail page's line
   * stepper, compared against its own average by the Diff column, and drawn
   * with a baseline on the distribution chart.
   *
   * Undefined for genuinely categorical dimensions — a birdie is not a
   * threshold on a scale, and inventing one would make the arithmetic above
   * produce numbers that mean nothing.
   */
  line?: number;

  history: HistoryEntry[];
  /** True when every history entry falls in `category`. */
  consistent: boolean;
  sampleSize: number;
  /** Independent angles corroborating the same pattern. May be empty. */
  supportingSplits?: SplitEvidence[];

  liveState: LiveState;
  context?: PickContext;
  odds?: OddsInfo;
}

/** Stable identity for a candidate, used as a React key and a slip-leg key. */
export function candidateKey(c: Pick<PickCandidate, 'sport' | 'subjectId' | 'dimension' | 'category'>): string {
  return `${c.sport}:${c.subjectId}:${c.dimension}:${c.category}`;
}

/** What an adapter returns for a whole sport on a given day. */
export interface SportSnapshot {
  sport: Sport;
  /** Tournament / slate name shown in the header. */
  eventName: string | null;
  /** Round number (golf) or slate date (MLB), for display. */
  eventDetail: string | null;
  status: LiveStatus;
  candidates: PickCandidate[];
  /** Everyone in the field/slate, for the player filter drawer + odds matching. */
  subjects: SubjectSummary[];
  context?: PickContext;
  /** Non-fatal problems worth surfacing rather than hiding. */
  warnings: string[];
  fetchedAt: string;
}

export interface SubjectSummary {
  subjectId: string;
  subjectName: string;
  meta?: Record<string, unknown>;
  /** Short status line, e.g. '-4 thru 12' or '2-4, 1 HR'. */
  statusLine?: string;
  liveState?: LiveState;
}
