/**
 * Where a face or a crest comes from, per sport — R9a.
 *
 * The research cards have always been able to show one: `TableRow.imageUrl`
 * renders an `Avatar` in the label cell, and `ResearchColumn.imageUrl` does the
 * same in a header. R9's audit found the slot filled on 11 rows in the whole
 * repo, which is why so much of a rebuilt page reads as plain text. These are
 * the URL builders those rows need, in one place rather than re-derived in each
 * adapter (four copies of the ESPN headshot path existed before this file).
 *
 * EVERY ONE RETURNS A URL WITHOUT ASKING WHETHER IT RESOLVES. A missing image
 * is not a missing fact: `Avatar` falls back to initials, so a wrong id costs a
 * monogram, never a broken layout or an empty cell. Callers pass `null` through
 * when they have no id at all.
 *
 * Pure string building: no fetching, safe on the server and in the client
 * bundle.
 */

/** ESPN's league path for headshots and team logos. Not a display name. */
export type EspnLeague = 'nfl' | 'college-football' | 'nba' | 'nhl' | 'mlb' | 'soccer' | 'tennis' | 'golf';

const ESPN_CDN = 'https://a.espncdn.com/i';

/**
 * ESPN's athlete photo. `id` is an ESPN athlete id — NOT an MLB, NHL or
 * provider id.
 *
 * NOT EVERY LEAGUE IS STOCKED. Measured 2026-09-17 against this path: nba 3/3,
 * tennis 2/3, nfl fine, and **soccer 1 of 12** — Manchester United's and City's
 * XI came back 404 apart from Lisandro Martínez, and the ESPN summary carries
 * no `headshot` href to fall back on. So the soccer pages show crests and no
 * faces: a column of identical grey silhouettes is noise, not identity. Check
 * a sport's real hit rate before filling a face slot from here.
 */
export function espnHeadshot(league: EspnLeague, id: string | number | null | undefined): string | null {
  return id == null || id === '' ? null : `${ESPN_CDN}/headshots/${league}/players/full/${id}.png`;
}

/** MLB's own photo service, keyed by MLB people id (ESPN ids do not work here). */
export function mlbHeadshot(id: string | number | null | undefined): string | null {
  return id == null || id === ''
    ? null
    : `https://img.mlbstatic.com/mlb-photos/image/upload/c_thumb,g_face,w_213,h_213,d_people:generic:headshot:67:current.png,q_auto:best,f_auto/v1/people/${id}/headshot/67/current`;
}

/**
 * A player face for a sport: the one shared dispatcher the Slate cards use.
 *
 * TAKES EITHER ID SHAPE. A candidate's `subjectId` is namespaced
 * (`espn:football:4361050`); a ranking row's is bare. The market cards passed
 * the namespaced one straight through, so every NFL face on them requested
 * `.../full/espn:football:4361050.png` and 404'd — thirteen per page load,
 * found in the C8 closeout sweep. Stripping here fixes every caller at once.
 */
export function headshotFor(sport: string, rawId: string | number | null | undefined): string | null {
  if (rawId == null || rawId === '') return null;
  const id = String(rawId).split(':').pop() ?? '';
  if (id === '') return null;
  if (sport === 'mlb') return mlbHeadshot(id);
  if (sport === 'nfl') return espnHeadshot('nfl', id);
  if (sport === 'cfb') return espnHeadshot('college-football', id);
  if (sport === 'nba') return espnHeadshot('nba', id);
  if (sport === 'tennis') return espnHeadshot('tennis', id);
  return null;
}

/** A team mark from the id/abbreviation a ranking row carries. MLB keys on the numeric id; NFL on the abbreviation. */
export function teamLogoFor(sport: string, teamId: string | number | null | undefined, abbr: string | null | undefined): string | null {
  if (sport === 'mlb') return mlbTeamLogo(teamId);
  if (sport === 'nfl' && abbr) return `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png`;
  return null;
}

/** MLB's own crest, keyed by StatsAPI team id. */
export function mlbTeamLogo(id: string | number | null | undefined): string | null {
  return id == null || id === '' ? null : `https://www.mlbstatic.com/team-logos/${id}.svg`;
}

/**
 * The NHL mugshot, which needs all three of season, team and player —
 * `.../mugs/nhl/20252026/TOR/8479318.png`. `season` is the four-digit start
 * year the game page already carries (2025 for 2025-26).
 */
export function nhlHeadshot(season: number | null | undefined, teamAbbr: string | null | undefined, id: string | number | null | undefined): string | null {
  if (season == null || !teamAbbr || id == null || id === '') return null;
  return `https://assets.nhle.com/mugs/nhl/${season}${season + 1}/${teamAbbr.toUpperCase()}/${id}.png`;
}
