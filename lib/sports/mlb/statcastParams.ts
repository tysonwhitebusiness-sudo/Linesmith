/**
 * Query-parameter guards shared by the Statcast rollup routes.
 */

/** A StatsAPI person, team or game id. Bounded, per task 3.5: an unbounded id accepted 1e9 and 2.5 alike. */
export function parseMlbId(raw: string | null): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 99_999_999) return null;
  return n;
}

/**
 * The rollups are built for this season and last (`build_statcast_rollups.py`),
 * and the corpus they read starts at 2025, so an earlier season gets a 400 rather
 * than a 404 that reads as "this player did nothing".
 */
export const FIRST_STATCAST_SEASON = 2025;

export function parseStatcastSeason(raw: string | null): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < FIRST_STATCAST_SEASON || n > 2100) return null;
  return n;
}
