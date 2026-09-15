/**
 * MLB Stats API live feed and win probability — R4 steps 3 and 4.
 *
 * `statsapi.getLiveFeed` already downloads `liveData.plays.allPlays`, and the app
 * kept only the linescore and box score. Every pitch's location, velocity and
 * type, and every batted ball's exit velocity, launch angle, distance and
 * landing spot, were in hand and discarded. These parsers keep them, for the
 * spray chart with distance, the at-bat explorer, the pitch mix per pitcher and
 * the last pitch / batted ball on the live game (R6, R8).
 *
 * Pure functions over the raw JSON, tested on a real saved game (KC @ BOS,
 * gamePk 824711) against the G2 dataset built from the same feed.
 */

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export interface Pitch {
  /** Statcast pitch type code: FF, SL, CH… */
  type: string | null;
  typeName: string | null;
  speed: number | null;
  /** Plate location in feet, catcher's view: pX from the plate's centre, pZ above the ground. */
  pX: number | null;
  pZ: number | null;
  /** Call code (B, C, S, X…) and its description ("Called Strike"). */
  callCode: string | null;
  call: string | null;
  /** This batter's own strike zone, feet. */
  zoneTop: number | null;
  zoneBottom: number | null;
  /** The count AFTER this pitch. */
  balls: number | null;
  strikes: number | null;
}

export interface BattedBall {
  exitVelocity: number | null;
  launchAngle: number | null;
  distance: number | null;
  trajectory: string | null;
  /** Stats API field coordinates (home plate near 125, 204; y grows toward the plate). */
  coordX: number | null;
  coordY: number | null;
}

export interface AtBat {
  index: number;
  startTime: string | null;
  inning: number | null;
  half: 'top' | 'bottom' | null;
  batterId: number | null;
  batter: string | null;
  bats: string | null;
  pitcherId: number | null;
  pitcher: string | null;
  throws: string | null;
  event: string | null;
  eventType: string | null;
  description: string | null;
  rbi: number | null;
  awayScore: number | null;
  homeScore: number | null;
  scoring: boolean;
  outs: number | null;
  pitches: Pitch[];
  /** The ball put in play, when there was one. */
  battedBall: BattedBall | null;
}

export function parseAtBats(feed: J | null): AtBat[] {
  return arr(feed?.liveData?.plays?.allPlays).map((p) => {
    const pitches: Pitch[] = [];
    let battedBall: BattedBall | null = null;
    for (const e of arr(p.playEvents)) {
      if (e.isPitch) {
        const pd = e.pitchData ?? {};
        pitches.push({
          type: str(e.details?.type?.code),
          typeName: str(e.details?.type?.description),
          speed: num(pd.startSpeed),
          pX: num(pd.coordinates?.pX),
          pZ: num(pd.coordinates?.pZ),
          callCode: str(e.details?.code),
          call: str(e.details?.call?.description),
          zoneTop: num(pd.strikeZoneTop),
          zoneBottom: num(pd.strikeZoneBottom),
          balls: num(e.count?.balls),
          strikes: num(e.count?.strikes),
        });
      }
      if (e.hitData) {
        const h = e.hitData;
        battedBall = {
          exitVelocity: num(h.launchSpeed),
          launchAngle: num(h.launchAngle),
          distance: num(h.totalDistance),
          trajectory: str(h.trajectory),
          coordX: num(h.coordinates?.coordX),
          coordY: num(h.coordinates?.coordY),
        };
      }
    }
    const half = p.about?.halfInning;
    return {
      index: num(p.about?.atBatIndex) ?? -1,
      startTime: str(p.about?.startTime),
      inning: num(p.about?.inning),
      half: half === 'top' || half === 'bottom' ? half : null,
      batterId: num(p.matchup?.batter?.id),
      batter: str(p.matchup?.batter?.fullName),
      bats: str(p.matchup?.batSide?.code),
      pitcherId: num(p.matchup?.pitcher?.id),
      pitcher: str(p.matchup?.pitcher?.fullName),
      throws: str(p.matchup?.pitchHand?.code),
      event: str(p.result?.event),
      eventType: str(p.result?.eventType),
      description: str(p.result?.description),
      rbi: num(p.result?.rbi),
      awayScore: num(p.result?.awayScore),
      homeScore: num(p.result?.homeScore),
      scoring: p.about?.isScoringPlay === true,
      outs: num(p.count?.outs),
      pitches,
      battedBall,
    };
  });
}

export interface PitchMixRow {
  type: string;
  typeName: string | null;
  count: number;
  /** Share of this pitcher's pitches, 0-100. */
  share: number;
  avgSpeed: number | null;
  /** Called strikes plus swinging strikes plus fouls, over pitches. */
  strikeRate: number;
}

/** One pitcher's mix in THIS game, most-thrown first. */
export function pitchMix(atBats: readonly AtBat[], pitcherId: number): PitchMixRow[] {
  const byType = new Map<string, { name: string | null; n: number; speed: number[]; strikes: number }>();
  let total = 0;
  for (const ab of atBats) {
    if (ab.pitcherId !== pitcherId) continue;
    for (const p of ab.pitches) {
      if (!p.type) continue;
      total++;
      const t = byType.get(p.type) ?? { name: p.typeName, n: 0, speed: [], strikes: 0 };
      t.n++;
      if (p.speed != null) t.speed.push(p.speed);
      if (p.callCode && p.callCode !== 'B' && p.callCode !== '*B' && p.callCode !== 'P' && p.callCode !== 'I') t.strikes++;
      byType.set(p.type, t);
    }
  }
  return [...byType.entries()]
    .map(([type, t]) => ({
      type,
      typeName: t.name,
      count: t.n,
      share: total ? (100 * t.n) / total : 0,
      avgSpeed: t.speed.length ? t.speed.reduce((a, b) => a + b, 0) / t.speed.length : null,
      strikeRate: t.n ? t.strikes / t.n : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export interface MlbWinProbabilityPoint {
  atBatIndex: number;
  /** 0-1, the HOME team's chance after this plate appearance. */
  home: number;
  /** Percentage points this plate appearance added to the home side. */
  added: number;
  leverage: number | null;
}

/** `/api/v1/game/{pk}/winProbability` — one point per plate appearance. The endpoint reports percentages; this returns 0-1. */
export function parseMlbWinProbability(json: unknown): MlbWinProbabilityPoint[] {
  return arr(json)
    .filter((w) => num(w.atBatIndex) != null && num(w.homeTeamWinProbability) != null)
    .map((w) => ({
      atBatIndex: w.atBatIndex,
      home: w.homeTeamWinProbability / 100,
      added: num(w.homeTeamWinProbabilityAdded) ?? 0,
      leverage: num(w.leverageIndex),
    }));
}
