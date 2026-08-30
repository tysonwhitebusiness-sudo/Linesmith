/**
 * The six universal ROLES — Phase 6.3.
 *
 * WHAT THIS REPLACES, AND WHY IT IS NOT A RENAME. The plan described this task
 * as renaming four `PlayerDetailData` fields (`pitchMix` -> `usageMix`,
 * `zoneProfile` -> `spatialGrid`, and so on). **None of those fields exist.**
 * `PlayerDetailData`'s sport-specific slots are `hitterStats`, `liveGame`,
 * `liveMatchup`, `matchupExplorer`, `liveLineTracker`, `seasonStatsCard`,
 * `golfFormHoles`, `nflSeasonStats` and `lineControl`. The four names came from
 * the design mockups, not the codebase. So this is six NEW fields and the
 * adapter work to fill them — materially larger than the plan implied, and
 * accepted as such by the operator on 2026-08-30.
 *
 * THE ARGUMENT. The blocks that looked MLB-only — pitch mix, strike zone,
 * platoon splits, park factors, opposing starter, batter-vs-pitcher — are not
 * MLB *concepts*. They are MLB's instance of six roles every sport fills with
 * its own content:
 *
 * | Role | MLB | NFL / CFB | NBA | NHL | Soccer | Tennis | Golf |
 * |---|---|---|---|---|---|---|---|
 * | `opponentUnit` | Opposing starter | Defence vs position | Defence vs guards | Opposing goalie | Keeper & back line | Opponent profile | The field |
 * | `usageMix` | Pitch mix | Route mix | Shot-type mix | Shot-type mix | Shot-type mix | Serve mix | Approach distance |
 * | `spatialGrid` | Strike zone | Target map | Shot chart | Shot location | Shot location | Serve placement | Proximity by lie |
 * | `binarySplit` | vs LHP/RHP | man / zone | top / bottom D | PP / EV | home / away | hard / clay | par 5 / par 4 |
 * | `conditions` | Park, wind | Roof, wind, surface | Rest, travel | Rest, opp starts | Pitch, weather | Surface, speed | Wind, greens |
 * | `careerH2H` | vs this pitcher | vs this defence | vs this team | vs this goalie | vs this club | vs this opponent | at this course |
 *
 * This is why the "seven empty pages" problem does not exist. `CLAUDE.md`'s
 * sport-adapter §4 rule — a `null` slot renders nothing — stays exactly as
 * written; it simply stops being load-bearing for the common case, because a
 * *role* is fillable by every sport where a *field named after one sport's
 * instance of it* never could be.
 *
 * THE COMPONENT NEVER LEARNS WHAT A STRIKE ZONE IS. Every role below carries
 * its own `title`, its own labels, its own units and its own formatting from
 * the sport's adapter. `PlayerDetail` renders a heading and a shape. There is
 * no `sport === 'mlb'` anywhere in the render path, and the Phase 6 gate greps
 * for exactly that.
 *
 * ON PARTIAL FILLING, WHICH IS THE HONEST STATE TODAY. Several roles need data
 * that is not sourced yet — `spatialGrid` needs the coordinates that 6.6 (MLB
 * pitch-level Statcast), 6.7 (NBA/NHL shots), 6.8 (nflverse play-by-play) and
 * 6.9 (Understat shots) will provide. A sport that cannot fill a role emits
 * `null` and the block does not render. That is the rule working, not a gap
 * being papered over — and it is why these types ship before the sourcing
 * does, so the sourcing tasks have somewhere to land.
 */

import type { OpposingStarterStat } from '@/components/PlayerDetail';
import type { Formatter } from '@/components/charts/tokens';

/** A stat that may or may not carry a league rank. `rank`/`poolSize` absent = show the number alone. */
export interface RoleStat {
  key: string;
  label: string;
  value: number;
  decimals: number;
  rank?: number;
  poolSize?: number;
  /** Fewer is better — flips the heat, never the number. */
  lowerIsBetter?: boolean;
  /** Secondary line: sample size, window, caveat. */
  sub?: string;
}

/**
 * ROLE 1 · `opponentUnit` — who or what this subject faces.
 *
 * MLB names one pitcher; NFL names a defensive unit; golf names the field. The
 * shape is the same either way: a named opponent and its measured numbers. The
 * `subtitle` carries the sport's own framing ("Allows", "vs WR", "Field of 156")
 * rather than the component inventing one.
 */
export interface OpponentUnitRole {
  title: string;
  /** The opponent's display name — a pitcher, a defence, a goalie, a course. */
  name: string;
  subtitle?: string;
  logoUrl?: string;
  headshotUrl?: string;
  stats: RoleStat[];
  /** Shown when `stats` is empty — say what is missing, not "no data". */
  emptyMessage?: string;
}

/**
 * ROLE 2 · `usageMix` — how this subject's work is distributed.
 *
 * Pitch types, route types, shot types, serve types. Shares must be read as
 * shares, so each slice carries its own percentage and the adapter is
 * responsible for them summing sensibly; the component does not renormalise,
 * because silently rescaling a mix that does not add up hides a real data
 * problem.
 */
export interface UsageMixSlice {
  key: string;
  label: string;
  /** 0-100. */
  share: number;
  /** Optional per-slice outcome ("xwOBA against", "yards per target"). */
  value?: number;
  valueLabel?: string;
  decimals?: number;
}

export interface UsageMixRole {
  title: string;
  slices: UsageMixSlice[];
  /** Total observations behind the mix. A mix off twelve pitches is not a mix. */
  sampleSize?: number | null;
  emptyMessage?: string;
}

/**
 * ROLE 3 · `spatialGrid` — where things happen, as a grid.
 *
 * A strike zone, a target map, a shot chart. Maps directly onto the `HeatGrid`
 * primitive, and **every one of the fields that primitive got burned on is
 * required here**: `format`, `unit` and `caption` have no defaults, because
 * `zoneGrid` hardcoding MLB's versions is what rendered NFL's 14.8 as "4.800".
 * See `components/charts/HeatGrid.tsx`.
 */
export interface SpatialGridRole {
  title: string;
  /** Row-major. Every row the same length. */
  cells: Array<Array<{ key: string; value: number | null; sampleSize?: number | null }>>;
  rowLabels?: string[];
  columnLabels?: string[];
  /** Explicit, so several grids can share a scale. Omit to fit the data. */
  domain?: { lo: number; hi: number };
  /** No default — see this role's own note. */
  format: Formatter;
  unit: string;
  caption: string;
  lowerIsBetter?: boolean;
  emptyMessage?: string;
}

/**
 * ROLE 4 · `binarySplit` — this subject under two mutually exclusive conditions.
 *
 * vs LHP/RHP, man/zone, power play/even strength, home/away, hard/clay. Maps
 * onto `SplitDumbbell`. Sample sizes are part of the shape rather than an
 * afterthought: a platoon split off nine plate appearances is noise, and the
 * page has to be able to say so.
 */
export interface BinarySplitRole {
  title: string;
  aLabel: string;
  bLabel: string;
  rows: Array<{
    key: string;
    label: string;
    a: number | null;
    b: number | null;
    decimals: number;
    aSample?: number | null;
    bSample?: number | null;
    lowerIsBetter?: boolean;
  }>;
  emptyMessage?: string;
}

/**
 * ROLE 5 · `conditions` — the environment this game is played in.
 *
 * Park and wind, roof and surface, rest and travel, greens speed. Deliberately
 * a list of labelled facts rather than a fixed struct: the conditions that move
 * a baseball total and the ones that move an NBA total have nothing in common
 * except being conditions.
 *
 * `impact` is optional and should only be set where a real measured factor
 * exists (MLB's `park_factors` is computed in-house from the schedule). **Do
 * not populate it with a guess** — an unquantified "wind blowing out" is
 * information; a made-up "+4% runs" is a fabrication.
 */
export interface ConditionFact {
  key: string;
  label: string;
  /** Already formatted — "12 mph, out to LF", "Indoors", "68°F". */
  value: string;
  /** A real measured multiplier or delta, where one exists. Never a guess. */
  impact?: { value: number; decimals: number; label: string } | null;
}

export interface ConditionsRole {
  title: string;
  facts: ConditionFact[];
  emptyMessage?: string;
}

/**
 * ROLE 6 · `careerH2H` — this subject's history against this specific opponent.
 *
 * vs this pitcher, this defence, this club, this course. The one role where
 * sample size is usually the headline: most head-to-head records are small
 * enough that the honest presentation leads with how many meetings there were,
 * which is why `sampleSize` is required rather than optional.
 */
export interface CareerH2HRole {
  title: string;
  /** "vs Gerrit Cole", "at Augusta National". */
  opponentLabel: string;
  /** Required — a head-to-head line without its n is unreadable. */
  sampleSize: number;
  sampleLabel: string;
  stats: RoleStat[];
  /** Per-meeting history, oldest first, for a strip or a distribution. */
  meetings?: Array<{ key: string; date: string; value: number | null; title?: string }>;
  emptyMessage?: string;
}

/**
 * All six, as they hang off `PlayerDetailData`.
 *
 * Every one is `null`-able and every one defaults to absent. A sport fills what
 * it has; the component renders what is filled.
 */
export interface PlayerRoles {
  opponentUnit?: OpponentUnitRole | null;
  usageMix?: UsageMixRole | null;
  spatialGrid?: SpatialGridRole | null;
  binarySplit?: BinarySplitRole | null;
  conditions?: ConditionsRole | null;
  careerH2H?: CareerH2HRole | null;
}

/** The six keys, for tests and for iterating roles generically. */
export const PLAYER_ROLE_KEYS = [
  'opponentUnit',
  'usageMix',
  'spatialGrid',
  'binarySplit',
  'conditions',
  'careerH2H',
] as const;

export type PlayerRoleKey = (typeof PLAYER_ROLE_KEYS)[number];

/** `OpposingStarterStat` (the existing ranked-stat shape) -> `RoleStat`. Adapters already produce the former in quantity. */
export function toRoleStat(s: OpposingStarterStat, extra?: { lowerIsBetter?: boolean; sub?: string }): RoleStat {
  return {
    key: s.key,
    label: s.label,
    value: s.value,
    decimals: s.decimals,
    rank: s.rank,
    poolSize: s.poolSize,
    ...(extra?.lowerIsBetter != null ? { lowerIsBetter: extra.lowerIsBetter } : {}),
    ...(extra?.sub ? { sub: extra.sub } : {}),
  };
}
