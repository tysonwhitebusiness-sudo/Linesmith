/**
 * Fetches one player's bio from their league's athlete endpoint — the server
 * half of `playerBio.ts` (R6.1a). Called only by `/api/player-bio`, which
 * caches the parsed result through `cachedRoute()`.
 */

import { bioFromNhlLanding, parseEspnAthlete, parseMlbPerson } from './playerBio';
import type { HistorySport, PlayerBio } from './playerResearchShapes';
import { parsePlayerLanding } from '@/lib/sports/nhl/apiWebParsers';
import { fetchPlayerLanding } from '@/lib/sports/nhl/nhle';

export type BioSport = HistorySport | 'golf';

/** ESPN's path per league. MLB and NHL are not ESPN here: their history is keyed by league ids. */
const ESPN_PATH: Partial<Record<BioSport, string>> = {
  nfl: 'football/nfl',
  cfb: 'football/college-football',
  nba: 'basketball/nba',
  soccer_epl: 'soccer/eng.1',
  soccer_mls: 'soccer/usa.1',
  tennis_atp: 'tennis/atp',
  tennis_wta: 'tennis/wta',
  golf: 'golf/pga',
};

// ESPN 403s some scripted user agents (R1); a browser UA gets 200.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`bio source ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** `null` when the source does not know the id. Throws when the source is unreachable, so the cache keeps the last good bio. */
export async function fetchPlayerBio(sport: BioSport, athleteId: string): Promise<PlayerBio | null> {
  const fetchedAt = new Date().toISOString();
  if (sport === 'mlb') {
    return parseMlbPerson(await getJson(`https://statsapi.mlb.com/api/v1/people/${encodeURIComponent(athleteId)}?hydrate=currentTeam,rosterEntries`), fetchedAt);
  }
  if (sport === 'nhl') {
    return bioFromNhlLanding(parsePlayerLanding((await fetchPlayerLanding(athleteId)) as Record<string, unknown> | null), new Date(), fetchedAt);
  }
  const path = ESPN_PATH[sport];
  if (!path) return null;
  return parseEspnAthlete(await getJson(`https://site.web.api.espn.com/apis/common/v3/sports/${path}/athletes/${encodeURIComponent(athleteId)}`), path, fetchedAt);
}
