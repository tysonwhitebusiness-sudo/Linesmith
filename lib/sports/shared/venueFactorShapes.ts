/**
 * The database-free half of the venue factor — Phase 6.10.
 *
 * SPLIT OUT FOR THE REASON `pitchProfileShapes.ts` AND `seasonAggregateShapes.ts`
 * WERE. `venueFactor.ts` value-imports `pgAll`, which pulls in `pg`, which needs
 * `dns`/`fs`/`net`/`tls`. Any `'use client'` component reaching a formatter that
 * lives beside that import drags the whole driver into the browser bundle and
 * the page dies with `Module not found: Can't resolve 'dns'`.
 *
 * `tsc --noEmit` passes that happily — it is a bundling boundary, not a type
 * error. `tests/client-bundle-boundary.test.ts` is what catches it, and it
 * caught this file being written the wrong way round on its first run.
 */

export interface VenueFactor {
  sport: string;
  teamId: string;
  season: number;
  statKey: string;
  factor: number;
  homeGames: number;
  awayGames: number;
}

/**
 * The plain-language line a card shows.
 *
 * A FACTOR WITHIN A COUPLE OF PERCENT OF EVEN IS REPORTED AS NEUTRAL, not as
 * "+1%". At twenty to forty games a side the noise is larger than that, and
 * printing a signed one-percent difference invites a reader to act on a number
 * indistinguishable from nothing.
 *
 * The wording is deliberately "at home" rather than "at this venue". The factor
 * cannot separate a building effect from ordinary home advantage — travel, rest
 * and refereeing all sit inside it — and calling it a park factor for football
 * would borrow baseball's precision without baseball's venue key.
 */
export function describeVenueFactor(f: VenueFactor | null, statLabel: string): string | null {
  if (!f || !Number.isFinite(f.factor) || f.factor <= 0) return null;
  const pct = (f.factor - 1) * 100;
  const sample = `${f.homeGames}H/${f.awayGames}A · ${f.season}`;
  if (Math.abs(pct) < 2) return `Neutral for ${statLabel} (${sample})`;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(0)}% ${statLabel} at home (${sample})`;
}
