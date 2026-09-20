/**
 * Team crests for the Slate, keyed the way each sport's snapshot keys them.
 *
 * These live in `lib/` rather than beside `SubjectAvatar`'s copies because the
 * Slate is built SERVER-side: importing a `.tsx` into an adapter would drag JSX
 * into a route for the sake of two template strings.
 *
 * MLB keys on its own numeric team id; every other sport keys on the ESPN CDN's
 * lower-cased abbreviation, which is what the snapshot's `matchup` carries
 * ("DET @ CWS").
 */

/** "DET @ CWS" -> ["DET", "CWS"]. The one place the matchup string is parsed. */
export function splitMatchup(matchup: string | undefined): [string, string] {
  const parts = (matchup ?? '').split('@').map((p) => p.trim());
  return parts.length === 2 ? [parts[0], parts[1]] : [matchup ?? '', ''];
}

export function mlbLogo(teamId: number | undefined): string | null {
  return teamId ? `https://www.mlbstatic.com/team-logos/${teamId}.svg` : null;
}

/** ESPN's league path: `nfl`, `college-football`, `nba`, `nhl`, `eng.1`, `usa.1`. */
export function espnLogo(league: string, abbr: string | undefined): string | null {
  const a = abbr?.trim().toLowerCase();
  return a ? `https://a.espncdn.com/i/teamlogos/${league}/500/${a}.png` : null;
}
