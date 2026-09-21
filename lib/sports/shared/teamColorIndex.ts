/**
 * C0.2 — builds a league's `TeamColorIndex` from ESPN's team list, with this
 * app's hand tables applied as overrides. Server-side only; read it through
 * `/api/team-colors` (a `cachedRoute`, 7-day TTL: team colours change about
 * once a decade).
 */

import { TEAM_PRIMARY_COLOR as MLB_BY_STATSAPI_ID } from '../mlb/teamColors';
import { TEAM_PRIMARY_COLOR as NFL_BY_ABBR } from '../nfl/teamColors';
import { ESPN_TEAM_LEAGUES, normaliseHex, type TeamColorIndex } from './teamColors';

interface EspnTeam {
  id?: string;
  abbreviation?: string;
  color?: string;
  alternateColor?: string;
}

/**
 * The index for a scope (`nfl`, `mlb`, `soccer_epl`…), or null when the scope
 * has no teams (golf, tennis) or ESPN didn't answer.
 */
export async function buildTeamColorIndex(scope: string): Promise<TeamColorIndex | null> {
  const league = ESPN_TEAM_LEAGUES[scope];
  if (!league) return null;
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${league}/teams?limit=1000`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { sports?: Array<{ leagues?: Array<{ teams?: Array<{ team?: EspnTeam }> }> }> };
  const teams = json.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const index: TeamColorIndex = { byId: {}, byAbbr: {} };
  for (const { team } of teams) {
    const primary = normaliseHex(team?.color);
    if (!team || !primary) continue;
    const color = { primary, secondary: normaliseHex(team.alternateColor) };
    if (team.id) index.byId[team.id] = color;
    if (team.abbreviation) index.byAbbr[team.abbreviation.toUpperCase()] = color;
  }

  // The hand tables win where they exist: they were chosen by eye for this
  // app. MLB's is keyed by the Stats API id the MLB pages carry (108–158, no
  // overlap with ESPN's 1–30); NFL's by abbreviation.
  if (scope === 'mlb') {
    for (const [id, hex] of Object.entries(MLB_BY_STATSAPI_ID)) {
      const primary = normaliseHex(hex);
      if (primary) index.byId[id] = { primary, secondary: null };
    }
  }
  if (scope === 'nfl') {
    for (const [abbr, hex] of Object.entries(NFL_BY_ABBR)) {
      const primary = normaliseHex(hex);
      if (primary) index.byAbbr[abbr] = { primary, secondary: index.byAbbr[abbr]?.secondary ?? null };
    }
  }
  return index;
}
