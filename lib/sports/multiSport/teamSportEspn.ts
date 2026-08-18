/**
 * Generic ESPN team-sport fetcher — NFL, CFB, and Soccer all share the exact
 * same ESPN shape (scoreboard -> competitions -> competitors -> team roster),
 * verified live for all three (plus tennis, which doesn't fit this shape —
 * see espnTennis.ts). One shared module instead of three near-identical
 * copies, the same way lib/sports/golf/espn.ts is golf's version of this for
 * an individual-athlete sport.
 *
 * Canonical subjectId for every sport built on this module is
 * `espn:{espnSport}:{athleteId}` — ESPN's own athlete id, namespaced per
 * sport so the same numeric id in two different ESPN sports can never
 * collide. This mirrors golf's existing choice (ESPN athlete id as the
 * canonical person id) rather than trusting any odds provider's own id.
 */

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

export interface EspnTeamSportGame {
  gameId: string;
  date: string;
  homeTeamId: string;
  homeTeamName: string;
  homeAbbr: string;
  awayTeamId: string;
  awayTeamName: string;
  awayAbbr: string;
}

interface RawCompetitor {
  homeAway: 'home' | 'away';
  team: { id: string; displayName: string; abbreviation: string };
}

function dateRangeParam(daysAhead: number): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const start = new Date();
  const end = new Date(Date.now() + daysAhead * 86_400_000);
  return `${fmt(start)}-${fmt(end)}`;
}

/**
 * `daysAhead` matters a lot for sports that don't play daily: NFL/CFB games
 * cluster on specific days, and odds providers (ParlayAPI observed this
 * session) already price 1-2 weeks out — a same-day-only scoreboard query
 * would miss most of what's actually priced. Soccer/daily sports can use a
 * narrower window; team sports default wide.
 */
export async function fetchScoreboard(espnSport: string, espnLeague: string, daysAhead = 14): Promise<EspnTeamSportGame[]> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${espnSport}/${espnLeague}/scoreboard?dates=${dateRangeParam(daysAhead)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const json = (await res.json()) as { events?: Array<{ id: string; date: string; competitions?: Array<{ competitors?: RawCompetitor[] }> }> };

  const games: EspnTeamSportGame[] = [];
  for (const ev of json.events ?? []) {
    const comp = ev.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === 'home');
    const away = comp?.competitors?.find((c) => c.homeAway === 'away');
    if (!home || !away) continue;
    games.push({
      gameId: String(ev.id),
      date: ev.date,
      homeTeamId: String(home.team.id),
      homeTeamName: home.team.displayName,
      homeAbbr: home.team.abbreviation,
      awayTeamId: String(away.team.id),
      awayTeamName: away.team.displayName,
      awayAbbr: away.team.abbreviation,
    });
  }
  return games;
}

export interface EspnAthlete {
  subjectId: string;
  fullName: string;
  positionAbbr?: string;
  headshotUrl?: string;
}

const ROSTER_TTL_MS = 60 * 60_000; // team rosters change rarely — 1h cache, same spirit as statsapi.ts's roster TTLs

interface RawAthlete {
  id: string;
  fullName: string;
  position?: { abbreviation?: string };
  headshot?: { href?: string };
}
/** NFL/CFB group athletes by position (`{position, items: RawAthlete[]}`); soccer returns a flat `RawAthlete[]` directly — verified live, not documented anywhere. Handle both shapes rather than assuming one. */
type RosterAthleteEntry = RawAthlete | { items?: RawAthlete[] };

function isGrouped(entry: RosterAthleteEntry): entry is { items?: RawAthlete[] } {
  return 'items' in entry;
}

export async function fetchTeamRoster(espnSport: string, espnLeague: string, teamId: string): Promise<EspnAthlete[]> {
  const cacheKey = `espn-roster:${espnSport}:${espnLeague}:${teamId}`;
  const cached = readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < ROSTER_TTL_MS) {
    return JSON.parse(cached.payload) as EspnAthlete[];
  }

  const res = await fetch(`${BASE}/${espnSport}/${espnLeague}/teams/${teamId}/roster`, { cache: 'no-store' });
  if (!res.ok) return cached ? (JSON.parse(cached.payload) as EspnAthlete[]) : [];
  const json = (await res.json()) as { athletes?: RosterAthleteEntry[] };

  const athletes: EspnAthlete[] = [];
  for (const entry of json.athletes ?? []) {
    const raw = isGrouped(entry) ? (entry.items ?? []) : [entry];
    for (const a of raw) {
      athletes.push({
        subjectId: `espn:${espnSport}:${a.id}`,
        fullName: a.fullName,
        positionAbbr: a.position?.abbreviation,
        headshotUrl: a.headshot?.href,
      });
    }
  }
  writeSnapshotCache(cacheKey, JSON.stringify(athletes));
  return athletes;
}
