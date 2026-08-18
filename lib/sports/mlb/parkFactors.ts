/**
 * Park factors — how much a specific venue inflates or deflates run scoring
 * relative to league average, computed straight from this season's own
 * completed games. No external park-factor dataset needed: the same
 * schedule data already used for backfill and team splits has everything
 * required. Cached in SQLite (park_factors table) since a park's character
 * doesn't change mid-season and recomputing it from the full schedule on
 * every request would be wasteful.
 */

import { getScheduleRange, easternDate } from './statsapi';
import { readParkFactors, writeParkFactors } from '../../db/client';

/** Below this many games at a venue this season, the sample's too thin to trust — neutral 1.0 instead of extrapolating from a handful of games. */
const MIN_GAMES_FOR_PARK_FACTOR = 15;
/** Same "don't let one adjustment dominate" discipline as gameModel.ts's ±0.08 split cap — bounds the factor to [0.75, 1.25]. */
const MAX_PARK_FACTOR_DEVIATION = 0.25;

export interface ParkFactorResult {
  venueId: number;
  venueName: string;
  factor: number;
  games: number;
}

/** Walks this season's completed games and computes each venue's combined-runs average against the league average. Pure computation — callers decide whether/when to cache it. */
export async function computeParkFactors(season: number): Promise<ParkFactorResult[]> {
  const today = easternDate();
  const games = await getScheduleRange(`${season}-03-01`, today);
  const finals = games.filter(
    (g) => g.abstractState === 'Final' && g.teams.home.score != null && g.teams.away.score != null && g.venue?.id != null,
  );

  const byVenue = new Map<number, { name: string; totalRuns: number; games: number }>();
  let leagueTotalRuns = 0;
  let leagueGames = 0;

  for (const g of finals) {
    const runs = (g.teams.home.score as number) + (g.teams.away.score as number);
    leagueTotalRuns += runs;
    leagueGames += 1;
    const entry = byVenue.get(g.venue!.id) ?? { name: g.venue!.name, totalRuns: 0, games: 0 };
    entry.totalRuns += runs;
    entry.games += 1;
    byVenue.set(g.venue!.id, entry);
  }

  if (leagueGames === 0) return [];
  const leagueAvg = leagueTotalRuns / leagueGames;

  const results: ParkFactorResult[] = [];
  for (const [venueId, entry] of byVenue) {
    if (entry.games < MIN_GAMES_FOR_PARK_FACTOR) {
      results.push({ venueId, venueName: entry.name, factor: 1, games: entry.games });
      continue;
    }
    const venueAvg = entry.totalRuns / entry.games;
    const rawFactor = venueAvg / leagueAvg;
    const factor = Math.min(1 + MAX_PARK_FACTOR_DEVIATION, Math.max(1 - MAX_PARK_FACTOR_DEVIATION, rawFactor));
    results.push({ venueId, venueName: entry.name, factor, games: entry.games });
  }
  return results;
}

/** Recomputes and persists — the diagnostics-triggered refresh path. */
export async function refreshParkFactors(season: number): Promise<ParkFactorResult[]> {
  const results = await computeParkFactors(season);
  writeParkFactors(season, results);
  return results;
}

/** Live-path lookup table, read once per snapshot build rather than per game. */
export function loadParkFactorCache(season: number): Map<number, number> {
  const rows = readParkFactors(season);
  return new Map(rows.map((r) => [r.venueId, r.factor]));
}
