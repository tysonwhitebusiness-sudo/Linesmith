/**
 * Tournament logos for recurring PGA Tour events.
 *
 * ESPN's golf feeds carry no logo field anywhere — checked live against both
 * the leaderboard and scoreboard endpoints (neither `event.logos` nor any
 * sponsor-logo field exists on either payload). Same shape of gap as
 * `venues.ts`'s course coordinates, so the same fix: a small hand-curated
 * static table, keyed by a normalized tournament name.
 *
 * Unlike `venues.ts`, this table starts **empty** rather than partially
 * seeded — a guessed CDN/Wikipedia URL pattern was tried live and every
 * candidate 404'd, and shipping a fabricated URL just shows a broken image,
 * which is worse than showing nothing. `tournamentLogoUrl` already degrades
 * gracefully (returns null, the caller renders nothing) for exactly this
 * reason. Populate real, verified URLs here as they're found — this is a
 * curation task, not a data integration, and coverage should only improve
 * over time the same way `venues.ts` says its own table should.
 */

const TOURNAMENT_LOGOS: Record<string, string> = {
  // 'the masters': 'https://...',
  // 'pga championship': 'https://...',
  // 'u.s. open': 'https://...',
  // 'the open championship': 'https://...',
};

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/presented by.*$/i, '')
    .replace(/pres\.? by.*$/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Looks up a tournament's logo by name — null when not in the table yet (the common case today), never a guess. */
export function tournamentLogoUrl(tournamentName: string): string | null {
  return TOURNAMENT_LOGOS[normalize(tournamentName)] ?? null;
}
