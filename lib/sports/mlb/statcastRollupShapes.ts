/**
 * Shapes of the R5a Statcast rollups — the database-free half of
 * `statcastRollups.ts`, so a client component can import them without bundling
 * `pg` (see `pitchProfileShapes.ts` for why that split exists).
 *
 * Written by `python-odds-service/build_statcast_rollups.py` on the operator's
 * machine after each corpus refresh; the formulas are the G2 tools', and
 * `src/statcast_rollups.py` says where each block comes from. Regular season
 * only. Every block says what date it is as of.
 */

import type { PitchProfile } from './pitchProfileShapes';

export type StatcastRole = 'bat' | 'pit';

export interface PitchTypeRow {
  type: string;
  n: number;
  /** 0-100 of this player's pitches. Only types with 25+ pitches are listed. */
  usage: number | null;
  velo: number | null;
  /** Whiffs over swings, 0-100. */
  whiff: number | null;
  /** Called strikes plus whiffs, over pitches, 0-100. */
  csw: number | null;
  bip: number;
  xwoba: number | null;
  ev: number | null;
}

export interface ZoneRow {
  n: number;
  share: number | null;
  swing: number | null;
  whiff: number | null;
  xwoba: number | null;
}

export interface HandSplit {
  pa: number;
  avg: number | null;
  slg: number | null;
  kPct: number | null;
  bbPct: number | null;
  hr: number;
  xwobacon: number | null;
}

export interface HomeRun {
  date: string;
  ev: number | null;
  la: number | null;
  pitch: string | null;
  velo: number | null;
  /** Feet, from Savant's `hit_distance_sc`. */
  distance: number | null;
}

/** One player's season, as a hitter or as a pitcher. */
export interface PlayerStatcastSeason {
  pitches: number;
  bip: number;
  maxEV: number | null;
  avgEV: number | null;
  p90EV: number | null;
  /** Share of balls in play at 95+ mph, 0-100. */
  hardHit: number | null;
  /** Launch angle 8-32 degrees, 0-100. */
  sweetSpot: number | null;
  /** 98+ mph at 26-30 degrees, 0-100. A barrel-style rate, not Savant's barrel definition. */
  barrelish: number | null;
  pitchTypes: PitchTypeRow[];
  /** Savant zones '1'-'14'. */
  zones: Record<string, ZoneRow>;
  /** By the OPPOSING hand. */
  splitsByHand: Partial<Record<'L' | 'R', HandSplit>>;
  /** Hitter: exit velocity by date. Pitcher: four-seam and sinker velocity by date. */
  trend: Array<{ date: string; avg: number | null; max: number | null; n: number }>;
  /** 2-mph bins from 40. */
  evHist: Array<{ lo: number; n: number }>;
  /** Hitters: every home run. */
  hrList: HomeRun[];
  /** Pitchers with 500+ pitches: the latest 500 locations, [type, plate x, plate z] in feet. */
  locations?: Array<[string | null, number, number]>;
  /** Qualified hitters only: 0-100 league percentile, higher is more. */
  percentiles?: {
    pool: number;
    minBip: number;
    maxEV: number;
    avgEV: number;
    p90EV: number;
    hardHit: number;
    sweetSpot: number;
    barrelish: number;
  };
  /** The pitch-mix and strike-zone roles' long-standing shape. */
  profile?: Omit<PitchProfile, 'season' | 'role' | 'subjectId'>;
}

export interface PlayerStatcastRow {
  season: number;
  playerId: number;
  role: StatcastRole;
  asOf: string;
  qualified: boolean;
  payload: PlayerStatcastSeason;
}

export type TeamMetric =
  | 'avgEV'
  | 'hardHit'
  | 'sweetSpot'
  | 'barrelish'
  | 'kPct'
  | 'bbPct'
  | 'whiff'
  | 'chase'
  | 'hrPct'
  | 'ffVelo';

/** One team's lineup ('bat') or staff ('pit') for a season, pitch-weighted. */
export interface TeamStatcastSeason {
  metrics: Record<TeamMetric | 'pitches', number | null>;
  /** Every team's value, ascending, for the distribution strip. */
  league: Partial<Record<TeamMetric | 'pitches', number[]>>;
  /** 0-100, where 100 is best for this side (a staff wants a low exit velocity; a lineup a high one). */
  percentiles: Partial<Record<TeamMetric, number>>;
  teams: number;
  /** Lineup vs RHP/LHP, or staff vs RHH/LHH. */
  vsHand: Partial<
    Record<
      'L' | 'R',
      {
        pa: number;
        avg: number | null;
        kPct: number | null;
        bbPct: number | null;
        hrPct: number | null;
        xwobacon: number | null;
        avgEV: number | null;
        hardHit: number | null;
      }
    >
  >;
  pitchesJoined: number;
  pitchesTotal: number;
}

export interface TeamStatcastRow {
  season: number;
  teamId: string;
  side: StatcastRole;
  asOf: string;
  payload: TeamStatcastSeason;
}

export interface PregameHitter {
  id: number;
  name: string | null;
  pos: string | null;
  bats: string | null;
  /** Always null here: the page orders hitters by the posted lineup when there is one. */
  order: number | null;
  season: { pa: number; avg: number | null; obp: number | null; slg: number | null; hr: number };
  vsHand: { pa: number; avg: number | null; k: number | null; xwobacon: number | null };
  vsPitcher: { pa: number; h: number; hr: number; k: number; bb: number; ab: number };
}

export interface PregameStarter {
  id: number;
  name: string | null;
  hand: string | null;
  season: { gs: number; ip: string; era: number | null; whip: number | null; k: number; bb: number; hr: number };
  /** Last six appearances: [date, opponent id, IP, H, ER, BB, K]. */
  log: Array<[string, string, number, number | null, number | null, number | null, number | null]>;
  mix: Array<{ type: string; n: number; share: number | null; velo: number | null; whiff: number | null }>;
  pitches: number;
  /** The opposing active roster's hitters, not a lineup. */
  vsLineup: PregameHitter[];
}

export interface GamePregameStatcast {
  gamePk: number;
  gameDate: string;
  season: number;
  /** Pitches through this date are included: the day before the game. */
  asOf: string;
  computedAt: string;
  payload: {
    asOf: string;
    season: number;
    /** `null` when no probable starter was listed. */
    starters: { away: PregameStarter | null; home: PregameStarter | null };
  };
}
