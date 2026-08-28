/**
 * NHL live in-game detail — the hero card's Live tab data source, mirroring
 * `lib/sports/mlb/liveGame.ts`'s role but built on NHL's own
 * `api-web.nhle.com` gamecenter endpoints instead of MLB StatsAPI.
 * Deliberately uncached (same `app/api/mlb/game/[gameId]/live/route.ts`
 * contract — this is the one place live-in-progress data goes, a 6h/24h
 * snapshot cache would defeat the point).
 *
 * Two real NHL endpoints combined, both verified live against a completed
 * 2026 Stanley Cup Final game (2025030413) before building this:
 * - `/gamecenter/{id}/landing` → `summary.scoring` (goals per period, each
 *   with scorer/team/strength/headshot — doubles as the scoring-play
 *   timeline) and `summary.penalties`, plus team score/shots-on-goal.
 * - `/gamecenter/{id}/boxscore` → full skater/goalie box score
 *   (`playerByGameStats`), reusing `nhle.ts`'s existing `NhlSkaterGameStat`/
 *   `NhlGoalieGameStat` shapes rather than redeclaring them.
 */

import type { NhlSkaterGameStat, NhlGoalieGameStat } from './nhle';

const BASE = 'https://api-web.nhle.com/v1';

async function fetchJson<T>(url: string, timeoutMs = 10_000): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface NhlLiveGoal {
  period: number;
  strength: string; // 'ev' | 'pp' | 'sh' | ...
  scorerName: string;
  teamAbbr: string;
  headshotUrl?: string;
}

export interface NhlLivePenalty {
  period: number;
  description: string;
  teamAbbr: string;
}

export interface NhlLivePeriodLine {
  period: number;
  periodType: string; // 'REG' | 'OT' | 'SO'
  awayGoals: number | null;
  homeGoals: number | null;
}

export interface NhlLiveGameDetail {
  gameId: string;
  gameState: string;
  period: { number: number; type: string } | null;
  clock: { timeRemaining: string; running: boolean; inIntermission: boolean } | null;
  awayTeamId: string;
  awayAbbr: string;
  awayScore: number;
  awaySog: number;
  homeTeamId: string;
  homeAbbr: string;
  homeScore: number;
  homeSog: number;
  periods: NhlLivePeriodLine[];
  goals: NhlLiveGoal[];
  penalties: NhlLivePenalty[];
  skatersByTeam: Record<string, NhlSkaterGameStat[]>;
  goaliesByTeam: Record<string, NhlGoalieGameStat[]>;
}

interface RawLanding {
  gameState: string;
  periodDescriptor?: { number: number; periodType: string };
  clock?: { timeRemaining: string; running: boolean; inIntermission: boolean };
  awayTeam: { id: number; abbrev: string; score?: number; sog?: number };
  homeTeam: { id: number; abbrev: string; score?: number; sog?: number };
  summary?: {
    scoring?: Array<{
      periodDescriptor: { number: number; periodType: string };
      goals: Array<{ strength?: string; name?: { default?: string }; teamAbbrev?: { default?: string }; headshot?: string }>;
    }>;
    penalties?: Array<{
      periodDescriptor: { number: number };
      penalties: Array<{ descKey?: string; type?: string; teamAbbrev?: { default?: string }; committedByPlayer?: string }>;
    }>;
  };
}

interface RawBoxscoreSkater {
  playerId: number;
  name: { default: string };
  position: string;
  goals: number;
  assists: number;
  points: number;
  sog: number;
  hits: number;
  blockedShots: number;
}
interface RawBoxscoreGoalie {
  playerId: number;
  name: { default: string };
  saves?: number;
  goalsAgainst?: number;
}
interface RawBoxscoreTeamStats {
  forwards?: RawBoxscoreSkater[];
  defense?: RawBoxscoreSkater[];
  goalies?: RawBoxscoreGoalie[];
}
interface RawBoxscore {
  awayTeam: { abbrev: string };
  homeTeam: { abbrev: string };
  playerByGameStats?: { awayTeam: RawBoxscoreTeamStats; homeTeam: RawBoxscoreTeamStats };
}

export async function fetchNhlLiveGame(gameId: string): Promise<NhlLiveGameDetail | null> {
  const [landing, box] = await Promise.all([
    fetchJson<RawLanding>(`${BASE}/gamecenter/${gameId}/landing`),
    fetchJson<RawBoxscore>(`${BASE}/gamecenter/${gameId}/boxscore`),
  ]);
  if (!landing) return null;

  const periods: NhlLivePeriodLine[] = (landing.summary?.scoring ?? []).map((p) => ({
    period: p.periodDescriptor.number,
    periodType: p.periodDescriptor.periodType,
    awayGoals: p.goals.filter((g) => g.teamAbbrev?.default === landing.awayTeam.abbrev).length,
    homeGoals: p.goals.filter((g) => g.teamAbbrev?.default === landing.homeTeam.abbrev).length,
  }));

  const goals: NhlLiveGoal[] = (landing.summary?.scoring ?? []).flatMap((p) =>
    p.goals.map((g) => ({
      period: p.periodDescriptor.number,
      strength: g.strength ?? 'ev',
      scorerName: g.name?.default ?? 'Unknown',
      teamAbbr: g.teamAbbrev?.default ?? '',
      headshotUrl: g.headshot,
    })),
  );

  const penalties: NhlLivePenalty[] = (landing.summary?.penalties ?? []).flatMap((p) =>
    p.penalties.map((pen) => ({
      period: p.periodDescriptor.number,
      description: pen.type ?? pen.descKey ?? 'Penalty',
      teamAbbr: pen.teamAbbrev?.default ?? '',
    })),
  );

  const toSkaters = (t: RawBoxscoreTeamStats | undefined): NhlSkaterGameStat[] =>
    [...(t?.forwards ?? []), ...(t?.defense ?? [])].map((p) => ({
      playerId: p.playerId,
      name: p.name.default,
      position: p.position,
      goals: p.goals ?? 0,
      assists: p.assists ?? 0,
      points: p.points ?? 0,
      shots: p.sog ?? 0,
      hits: p.hits ?? 0,
      blockedShots: p.blockedShots ?? 0,
    }));
  const toGoalies = (t: RawBoxscoreTeamStats | undefined): NhlGoalieGameStat[] =>
    (t?.goalies ?? []).map((p) => ({
      playerId: p.playerId,
      name: p.name.default,
      saves: p.saves ?? 0,
      goalsAgainst: p.goalsAgainst ?? 0,
    }));

  return {
    gameId,
    gameState: landing.gameState,
    period: landing.periodDescriptor ? { number: landing.periodDescriptor.number, type: landing.periodDescriptor.periodType } : null,
    clock: landing.clock ?? null,
    awayTeamId: String(landing.awayTeam.id),
    awayAbbr: landing.awayTeam.abbrev,
    awayScore: landing.awayTeam.score ?? 0,
    awaySog: landing.awayTeam.sog ?? 0,
    homeTeamId: String(landing.homeTeam.id),
    homeAbbr: landing.homeTeam.abbrev,
    homeScore: landing.homeTeam.score ?? 0,
    homeSog: landing.homeTeam.sog ?? 0,
    periods,
    goals,
    penalties,
    skatersByTeam: box
      ? { [box.awayTeam.abbrev]: toSkaters(box.playerByGameStats?.awayTeam), [box.homeTeam.abbrev]: toSkaters(box.playerByGameStats?.homeTeam) }
      : {},
    goaliesByTeam: box
      ? { [box.awayTeam.abbrev]: toGoalies(box.playerByGameStats?.awayTeam), [box.homeTeam.abbrev]: toGoalies(box.playerByGameStats?.homeTeam) }
      : {},
  };
}
