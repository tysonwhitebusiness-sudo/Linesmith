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
import { normalizeName } from '@/lib/odds/screenshotImport';

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
  /** Real final/current score + completion state — `undefined` for a game ESPN hasn't posted a score for yet (future/scheduled). Shared by every sport on this fetcher (NFL/CFB/Soccer today). */
  status?: { completed: boolean; state: 'pre' | 'in' | 'post'; shortDetail: string };
  homeScore?: number;
  awayScore?: number;
}

interface RawCompetitor {
  homeAway: 'home' | 'away';
  team: { id: string; displayName: string; abbreviation: string };
  score?: string;
}

function dateRangeParam(daysAhead: number, daysBack: number): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const start = new Date(Date.now() - daysBack * 86_400_000);
  const end = new Date(Date.now() + daysAhead * 86_400_000);
  return `${fmt(start)}-${fmt(end)}`;
}

/**
 * `daysAhead` matters a lot for sports that don't play daily: NFL/CFB games
 * cluster on specific days, and odds providers (ParlayAPI observed this
 * session) already price 1-2 weeks out — a same-day-only scoreboard query
 * would miss most of what's actually priced. Soccer/daily sports can use a
 * narrower window; team sports default wide.
 *
 * `daysBack` defaults to 0 (today forward only) — every existing caller
 * before this param was added only ever wanted upcoming games. A caller
 * that also needs real recent/past results (a team page's "recent form")
 * passes a real `daysBack` explicitly.
 */
export async function fetchScoreboard(espnSport: string, espnLeague: string, daysAhead = 14, daysBack = 0): Promise<EspnTeamSportGame[]> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${espnSport}/${espnLeague}/scoreboard?dates=${dateRangeParam(daysAhead, daysBack)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const json = (await res.json()) as {
    events?: Array<{
      id: string;
      date: string;
      competitions?: Array<{
        competitors?: RawCompetitor[];
        status?: { type?: { completed?: boolean; state?: string; shortDetail?: string } };
      }>;
    }>;
  };

  const games: EspnTeamSportGame[] = [];
  for (const ev of json.events ?? []) {
    const comp = ev.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === 'home');
    const away = comp?.competitors?.find((c) => c.homeAway === 'away');
    if (!home || !away) continue;
    const statusType = comp?.status?.type;
    games.push({
      gameId: String(ev.id),
      date: ev.date,
      homeTeamId: String(home.team.id),
      homeTeamName: home.team.displayName,
      homeAbbr: home.team.abbreviation,
      awayTeamId: String(away.team.id),
      awayTeamName: away.team.displayName,
      awayAbbr: away.team.abbreviation,
      status:
        statusType?.state != null
          ? { completed: statusType.completed === true, state: statusType.state as 'pre' | 'in' | 'post', shortDetail: statusType.shortDetail ?? '' }
          : undefined,
      homeScore: home.score != null ? Number(home.score) : undefined,
      awayScore: away.score != null ? Number(away.score) : undefined,
    });
  }
  return games;
}

interface RawScheduleCompetitor {
  homeAway: 'home' | 'away';
  team: { id: string; displayName: string; abbreviation: string };
  /** Real shape difference from the scoreboard endpoint's `RawCompetitor.score` (a plain string) — confirmed live 2026-08-24 against a real completed NBA game. */
  score?: { value: number; displayValue: string };
}

/**
 * One team's own real full-season schedule — unlike `fetchScoreboard`,
 * which is a league-wide query capped at 100 events by ESPN regardless of
 * the date range requested (confirmed live 2026-08-24: a 6-month NBA range
 * silently returned only ~3 weeks of games), this per-team endpoint has no
 * such cap and returns every game in the real season. Needed for any
 * "season to date" window (`windows.szn`) — a team-level candidate built
 * from `fetchScoreboard`'s capped output was silently a ≤10-game sample
 * mislabeled as a season.
 */
export async function fetchTeamSchedule(espnSport: string, espnLeague: string, teamId: string, season: string): Promise<EspnTeamSportGame[]> {
  const cacheKey = `espnTeamSport:schedule:${espnSport}:${espnLeague}:${teamId}:${season}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 6 * 60 * 60_000) {
    return JSON.parse(cached.payload) as EspnTeamSportGame[];
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}/${espnSport}/${espnLeague}/teams/${teamId}/schedule?season=${season}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  } catch {
    return cached ? (JSON.parse(cached.payload) as EspnTeamSportGame[]) : [];
  }
  if (!res.ok) return cached ? (JSON.parse(cached.payload) as EspnTeamSportGame[]) : [];
  let json: { events?: Array<{ id: string; date: string; competitions?: Array<{ competitors?: RawScheduleCompetitor[]; status?: { type?: { completed?: boolean; state?: string; shortDetail?: string } } }> }> };
  try {
    json = await res.json();
  } catch {
    return cached ? (JSON.parse(cached.payload) as EspnTeamSportGame[]) : [];
  }

  const games: EspnTeamSportGame[] = [];
  for (const ev of json.events ?? []) {
    const comp = ev.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === 'home');
    const away = comp?.competitors?.find((c) => c.homeAway === 'away');
    if (!home || !away) continue;
    const statusType = comp?.status?.type;
    games.push({
      gameId: String(ev.id),
      date: ev.date,
      homeTeamId: String(home.team.id),
      homeTeamName: home.team.displayName,
      homeAbbr: home.team.abbreviation,
      awayTeamId: String(away.team.id),
      awayTeamName: away.team.displayName,
      awayAbbr: away.team.abbreviation,
      status:
        statusType?.state != null
          ? { completed: statusType.completed === true, state: statusType.state as 'pre' | 'in' | 'post', shortDetail: statusType.shortDetail ?? '' }
          : undefined,
      homeScore: home.score?.value,
      awayScore: away.score?.value,
    });
  }

  await writeSnapshotCache(cacheKey, JSON.stringify(games));
  return games;
}

/**
 * Real "has this sport's season actually started" signal — same purpose
 * CFB's own `cfbd.ts`'s `fetchSeasonStatus` serves, generalized here since
 * NBA/NHL's real off-season timing is exactly this same question and ESPN
 * already has the answer for any sport on this fetcher. Queries a wide
 * window (60 days back covers a season that just ended; 120 days ahead
 * covers preseason through the real regular-season opener) so a call made
 * deep in the off-season still finds the real next kickoff date, not an
 * empty list.
 */
export async function fetchSeasonStatus(espnSport: string, espnLeague: string): Promise<{ started: boolean; nextGameDate: string | null }> {
  const games = await fetchScoreboard(espnSport, espnLeague, 120, 60);
  if (games.length === 0) return { started: true, nextGameDate: null }; // unknown — don't claim "not started" without real data
  const started = games.some((g) => g.status?.completed === true);
  const upcoming = games.filter((g) => g.status?.state !== 'post').map((g) => g.date).sort();
  return { started, nextGameDate: started ? null : (upcoming[0] ?? null) };
}

export interface EspnInjuryRow {
  playerName: string;
  status: string;
  position?: string;
  note?: string;
}

interface RawInjuriesResponse {
  injuries?: Array<{
    id: string;
    displayName?: string;
    injuries?: Array<{
      status?: string;
      shortComment?: string;
      athlete?: { displayName?: string; position?: { abbreviation?: string } };
    }>;
  }>;
}

const INJURIES_TTL_MS = 30 * 60_000;

/**
 * Real league-wide injuries — one fetch covers every team, confirmed live
 * 2026-08-24 against CFB/NBA/NHL's real `site.api.espn.com` injuries
 * endpoint (`{sport}/{league}/injuries`, no team id needed — real payload
 * already groups by team). Cached by (sport, league) so every team's Game
 * Detail page on the same sport shares one fetch instead of one each.
 */
export async function fetchEspnInjuries(espnSport: string, espnLeague: string): Promise<Map<string, EspnInjuryRow[]>> {
  const cacheKey = `espnTeamSport:injuries:${espnSport}:${espnLeague}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < INJURIES_TTL_MS) {
    return new Map(JSON.parse(cached.payload) as Array<[string, EspnInjuryRow[]]>);
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}/${espnSport}/${espnLeague}/injuries`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  } catch {
    return cached ? new Map(JSON.parse(cached.payload) as Array<[string, EspnInjuryRow[]]>) : new Map();
  }
  if (!res.ok) return cached ? new Map(JSON.parse(cached.payload) as Array<[string, EspnInjuryRow[]]>) : new Map();
  let json: RawInjuriesResponse;
  try {
    json = await res.json();
  } catch {
    return cached ? new Map(JSON.parse(cached.payload) as Array<[string, EspnInjuryRow[]]>) : new Map();
  }

  const byTeamId = new Map<string, EspnInjuryRow[]>();
  for (const team of json.injuries ?? []) {
    const rows: EspnInjuryRow[] = (team.injuries ?? [])
      .filter((i) => i.athlete?.displayName)
      .map((i) => ({
        playerName: i.athlete!.displayName!,
        status: i.status ?? 'Out',
        position: i.athlete?.position?.abbreviation,
        note: i.shortComment,
      }));
    if (rows.length === 0) continue;
    byTeamId.set(team.id, rows);
    // Also key by normalized team name — NHL's roster/schedule come from
    // its own official API (nhle.ts), a different id space than ESPN's own
    // `team.id` here, so NHL's caller looks this up by real team name
    // instead (CFB/NBA both already share ESPN's own id space, so their
    // `team.id` lookup above is exact).
    if (team.displayName) byTeamId.set(normalizeName(team.displayName), rows);
  }

  await writeSnapshotCache(cacheKey, JSON.stringify([...byTeamId.entries()]));
  return byTeamId;
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
  const cached = await readSnapshotCache(cacheKey);
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
  await writeSnapshotCache(cacheKey, JSON.stringify(athletes));
  return athletes;
}
