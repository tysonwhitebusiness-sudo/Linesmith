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
import { easternDate, shiftDate } from '@/lib/sports/mlb/statsapi';

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
  /**
   * Where the game is played, when ESPN reports it.
   *
   * `indoor` IS NOT UNIVERSALLY PRESENT, and its absence is not `false`.
   * Measured across live scoreboards: NFL carries it on 16 of 16 events (5 of
   * them genuinely domed — Ford Field, Lucas Oil, Reliant, Allegiant, U.S.
   * Bank) and CFB on 25 of 25, but **both MLS and EPL omit the field
   * entirely**. MLS really does have enclosed venues, so treating a missing
   * flag as outdoors would report wind and rain for a game played under a
   * roof. Consumers must require `indoor === false`, never `!indoor`.
   *
   * ESPN gives no coordinates for any sport here — only a city — so weather
   * has to be geocoded and comes back flagged `approximate`.
   */
  venue?: EspnVenue;
  /**
   * R4: the poll rank ESPN shows beside a college team (`curatedRank.current`),
   * as of that game for a played one and the current poll for a future one.
   * `null` when there is no poll rank: ESPN sends 99 for an unranked college
   * team AND for every NFL team (checked 2026-09-14), so render only a number.
   */
  homeRank?: number | null;
  awayRank?: number | null;
}

/** ESPN's `curatedRank`: 1-25 is a poll rank; 99 means none (unranked college team, or a pro league). */
export function pollRank(c: { curatedRank?: { current?: number } }): number | null | undefined {
  const r = c.curatedRank?.current;
  if (r == null) return undefined;
  return r >= 1 && r <= 25 ? r : null;
}

export interface EspnVenue {
  fullName?: string;
  city?: string;
  state?: string;
  country?: string;
  /** `undefined` means UNKNOWN. See `EspnTeamSportGame.venue`. */
  indoor?: boolean;
}

interface RawCompetitor {
  homeAway: 'home' | 'away';
  team: { id: string; displayName: string; abbreviation: string };
  score?: string;
  curatedRank?: { current?: number };
}

/**
 * ESPN files every game under its US EASTERN date, so the range must be built
 * from the Eastern date too, never from UTC.
 *
 * It used to use UTC, and after 00:00Z (8pm Eastern) the range started on the
 * next day. The in-progress Sunday night game (DAL @ NYG, 401872930, kickoff
 * 00:20Z) then vanished mid-game: ESPN returned it for `dates=20260913` and not
 * for `20260914-…`, so the NFL games strip dropped it and its game page
 * rendered "Game not found". Every primetime game hit this, every week.
 */
function dateRangeParam(daysAhead: number, daysBack: number): string {
  const today = easternDate();
  const ymd = (isoDate: string) => isoDate.replace(/-/g, '');
  return `${ymd(shiftDate(today, -daysBack))}-${ymd(shiftDate(today, daysAhead))}`;
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
        venue?: {
          fullName?: string;
          address?: { city?: string; state?: string; country?: string };
          indoor?: boolean;
        };
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
      // `indoor` is copied through as-is, including `undefined`. Coercing it to
      // false here would erase the difference between "open air" and "ESPN did
      // not say", which is the whole reason the field is optional.
      venue: comp?.venue
        ? {
            fullName: comp.venue.fullName,
            city: comp.venue.address?.city,
            state: comp.venue.address?.state,
            country: comp.venue.address?.country,
            indoor: comp.venue.indoor,
          }
        : undefined,
      homeRank: pollRank(home),
      awayRank: pollRank(away),
    });
  }
  return games;
}

interface RawScheduleCompetitor {
  homeAway: 'home' | 'away';
  team: { id: string; displayName: string; abbreviation: string };
  /** Real shape difference from the scoreboard endpoint's `RawCompetitor.score` (a plain string) — confirmed live 2026-08-24 against a real completed NBA game. */
  score?: { value: number; displayValue: string };
  curatedRank?: { current?: number };
}

type RawScheduleEvent = { id: string; date: string; competitions?: Array<{ competitors?: RawScheduleCompetitor[]; status?: { type?: { completed?: boolean; state?: string; shortDetail?: string } } }> };

/** One schedule request's events, or `null` when the request or its JSON failed. */
async function fetchScheduleEvents(url: string): Promise<RawScheduleEvent[] | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { events?: RawScheduleEvent[] };
    return json.events ?? [];
  } catch {
    return null;
  }
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
  // v2 (R4): games carry poll ranks; entries cached under the old key lack them.
  const cacheKey = `espnTeamSport:schedule:v2:${espnSport}:${espnLeague}:${teamId}:${season}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 6 * 60 * 60_000) {
    return JSON.parse(cached.payload) as EspnTeamSportGame[];
  }

  // SOCCER NEEDS TWO CALLS (R2 source quirk, checked 2026-09-14 against EPL
  // team 382): the plain schedule returns only PLAYED matches (4 of them,
  // newest first), and unplayed fixtures come back only with `fixture=true`
  // (34, all future). Every other sport on this fetcher returns both from one.
  const urls = [`${BASE}/${espnSport}/${espnLeague}/teams/${teamId}/schedule?season=${season}`];
  if (espnSport === 'soccer') urls.push(`${urls[0]}&fixture=true`);
  const responses = await Promise.all(urls.map(fetchScheduleEvents));
  if (responses.every((r) => r == null)) return cached ? (JSON.parse(cached.payload) as EspnTeamSportGame[]) : [];

  const byId = new Map<string, EspnTeamSportGame>();
  for (const ev of responses.flatMap((r) => r ?? [])) {
    const comp = ev.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === 'home');
    const away = comp?.competitors?.find((c) => c.homeAway === 'away');
    if (!home || !away) continue;
    const statusType = comp?.status?.type;
    byId.set(String(ev.id), {
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
      homeRank: pollRank(home),
      awayRank: pollRank(away),
    });
  }
  // Oldest first, always. ESPN's own order is not chronological (soccer's
  // played list is newest-first), and a "last N" taken from it would be wrong.
  const games = [...byId.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

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

// ---------------------------------------------------------------------------
// Team page (R7)
// ---------------------------------------------------------------------------

export interface EspnSeasonSide {
  id: string;
  name: string;
  abbr: string;
  logoUrl: string | null;
  score: number | null;
  rank: number | null;
}

export interface EspnSeasonGame {
  id: string;
  start: string;
  postseason: boolean;
  home: EspnSeasonSide;
  away: EspnSeasonSide;
  state: 'final' | 'live' | 'scheduled' | 'postponed';
  /** "OT", "2OT", "SO" from ESPN's short detail ("Final/OT"); null in regulation. */
  extra: string | null;
  /** "Week 4"; for a bowl or playoff game ESPN's note ("College Football Playoff Quarterfinal at the Goodyear Cotton Bowl Classic"). */
  label: string | null;
  venue: string | null;
  neutral: boolean;
}

type RawSeasonCompetitor = {
  homeAway: 'home' | 'away';
  team: { id: string; displayName: string; abbreviation: string; logos?: Array<{ href?: string }>; logo?: string };
  score?: { value?: number } | string;
  curatedRank?: { current?: number };
};

type RawSeasonEvent = {
  id: string;
  date: string;
  seasonType?: { type?: number };
  week?: { text?: string };
  competitions?: Array<{
    neutralSite?: boolean;
    venue?: { fullName?: string };
    notes?: Array<{ headline?: string }>;
    status?: { type?: { name?: string; state?: string; completed?: boolean; shortDetail?: string } };
    competitors?: RawSeasonCompetitor[];
  }>;
};

const seasonScheduleCache = new Map<string, { at: number; games: EspnSeasonGame[] }>();

/**
 * One team's season from ESPN's team schedule, regular season (`seasontype=2`)
 * and postseason (`seasontype=3`) fetched apart so January can never fold into
 * the record — R7-C1. ESPN's default is the regular season alone (measured:
 * Ohio State 2025 returns 13 games; its CFP quarterfinal is only under type 3).
 * Preseason (type 1) is never read.
 *
 * In-process cache: 30 minutes for a season still being played, a week for a
 * finished one. The team route caches the whole page on top of this.
 */
export async function fetchTeamSeasonGames(espnSport: string, espnLeague: string, teamId: string, season: number, finished: boolean): Promise<EspnSeasonGame[]> {
  const key = `${espnSport}:${espnLeague}:${teamId}:${season}`;
  const hit = seasonScheduleCache.get(key);
  const ttl = finished ? 7 * 24 * 60 * 60_000 : 30 * 60_000;
  if (hit && Date.now() - hit.at < ttl) return hit.games;

  const base = `${BASE}/${espnSport}/${espnLeague}/teams/${teamId}/schedule?season=${season}`;
  // Soccer has no postseason type and splits played from unplayed instead (R2 source quirk).
  // Basketball's play-in is ESPN season type 5 (measured: Golden State 2025-26,
  // two games). It is not in the regular-season standings, so it is postseason.
  const urls =
    espnSport === 'soccer'
      ? [base, `${base}&fixture=true`]
      : [`${base}&seasontype=2`, `${base}&seasontype=3`, ...(espnSport === 'basketball' ? [`${base}&seasontype=5`] : [])];
  const responses = await Promise.all(
    urls.map(async (u) => {
      try {
        const res = await fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return null;
        return ((await res.json()) as { events?: RawSeasonEvent[] }).events ?? [];
      } catch {
        return null;
      }
    }),
  );
  if (responses.every((r) => r == null)) return hit?.games ?? [];

  const side = (c: RawSeasonCompetitor): EspnSeasonSide => {
    const raw = typeof c.score === 'string' ? Number(c.score) : c.score?.value;
    return {
      id: String(c.team.id),
      name: c.team.displayName,
      abbr: c.team.abbreviation,
      logoUrl: c.team.logos?.[0]?.href ?? c.team.logo ?? null,
      score: raw != null && Number.isFinite(raw) ? raw : null,
      rank: pollRank(c) ?? null,
    };
  };
  const byId = new Map<string, EspnSeasonGame>();
  for (const ev of responses.flatMap((r) => r ?? [])) {
    const comp = ev.competitions?.[0];
    const h = comp?.competitors?.find((c) => c.homeAway === 'home');
    const a = comp?.competitors?.find((c) => c.homeAway === 'away');
    if (!comp || !h || !a) continue;
    const st = comp.status?.type;
    const state: EspnSeasonGame['state'] = /POSTPONED|CANCELED|CANCELLED|SUSPENDED/.test(st?.name ?? '')
      ? 'postponed'
      : st?.completed || st?.state === 'post'
        ? 'final'
        : st?.state === 'in'
          ? 'live'
          : 'scheduled';
    const postseason = ev.seasonType?.type === 3 || ev.seasonType?.type === 5;
    byId.set(String(ev.id), {
      id: String(ev.id),
      start: ev.date,
      postseason,
      home: side(h),
      away: side(a),
      state,
      extra: state === 'final' ? ((st?.shortDetail ?? '').match(/\/(\d?OT|SO)\b/)?.[1] ?? null) : null,
      label: ev.seasonType?.type === 5 ? 'Play-In' : postseason ? (comp.notes?.[0]?.headline ?? ev.week?.text ?? null) : (ev.week?.text ?? null),
      venue: comp.venue?.fullName ?? null,
      neutral: comp.neutralSite === true,
    });
  }
  const games = [...byId.values()].sort((x, y) => x.start.localeCompare(y.start));
  seasonScheduleCache.set(key, { at: Date.now(), games });
  return games;
}

export interface EspnStandingsGroup {
  name: string;
  /** The groups above this one, outermost first ("National Football League", "American Football Conference"). */
  parents: string[];
  entries: Array<{
    team: { id: string; name: string; abbr: string; logoUrl: string | null };
    /** First occurrence of each stat name: the overall record, where ESPN repeats a name per record type (CFB). */
    stats: Record<string, { value: number | null; display: string }>;
  }>;
}

type RawStandingsGroup = {
  name?: string;
  children?: RawStandingsGroup[];
  standings?: {
    entries?: Array<{
      team: { id: string; displayName: string; abbreviation: string; logos?: Array<{ href?: string }> };
      stats?: Array<{ name: string; value?: number; displayValue?: string }>;
    }>;
  };
};

const standingsGroupsCache = new Map<string, { at: number; groups: EspnStandingsGroup[] }>();

/**
 * Every leaf group of ESPN's standings for a season (`apis/v2`), in ESPN's
 * published order. `level=3` asks for divisions where a league has them (NFL:
 * AFC East…); CFB returns conferences, and a conference split into divisions
 * (Sun Belt East / West) comes back as those divisions.
 */
export async function fetchStandingsGroups(espnSport: string, espnLeague: string, season: number, level?: number): Promise<EspnStandingsGroup[]> {
  const q = `season=${season}${level ? `&level=${level}` : ''}`;
  const key = `${espnSport}:${espnLeague}:${q}`;
  const hit = standingsGroupsCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.groups;
  let json: RawStandingsGroup;
  try {
    const res = await fetch(`https://site.api.espn.com/apis/v2/sports/${espnSport}/${espnLeague}/standings?${q}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return hit?.groups ?? [];
    json = (await res.json()) as RawStandingsGroup;
  } catch {
    return hit?.groups ?? [];
  }
  const groups: EspnStandingsGroup[] = [];
  const walk = (g: RawStandingsGroup, parents: string[]) => {
    if (g.standings?.entries?.length) {
      groups.push({
        name: g.name ?? '',
        parents,
        entries: g.standings.entries.map((e) => {
          const stats: Record<string, { value: number | null; display: string }> = {};
          for (const s of e.stats ?? []) if (!(s.name in stats)) stats[s.name] = { value: s.value ?? null, display: s.displayValue ?? '' };
          return { team: { id: String(e.team.id), name: e.team.displayName, abbr: e.team.abbreviation, logoUrl: e.team.logos?.[0]?.href ?? null }, stats };
        }),
      });
    }
    for (const c of g.children ?? []) walk(c, g.name ? [...parents, g.name] : parents);
  };
  walk(json, []);
  standingsGroupsCache.set(key, { at: Date.now(), groups });
  return groups;
}

type RosterAthlete = { id?: string; displayName?: string; position?: { abbreviation?: string } };

const athleteNameCache = new Map<string, { name: string; position: string | null }>();

/**
 * Names and positions for ESPN athlete ids: the team's current roster first
 * (one call), then ESPN's athlete endpoint for anyone no longer on it. ESPN's
 * roster ignores `?season=` (measured 2026-09-16: 0 athletes for 2025), and no
 * table in the app holds football names (`athlete_crosswalk` names 29 of the
 * Raiders' 59 players of 2025). Cached in process: a name does not change.
 */
export async function espnAthleteNames(espnSport: string, espnLeague: string, teamId: string, ids: string[]): Promise<Map<string, { name: string; position: string | null }>> {
  const k = (id: string) => `${espnSport}:${espnLeague}:${id}`;
  if (ids.some((id) => !athleteNameCache.has(k(id)))) {
    try {
      const res = await fetch(`${BASE}/${espnSport}/${espnLeague}/teams/${teamId}/roster`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const j = (await res.json()) as { athletes?: Array<RosterAthlete & { items?: RosterAthlete[] }> };
        for (const a of (j.athletes ?? []).flatMap((g) => g.items ?? [g])) {
          if (a.id && a.displayName) athleteNameCache.set(k(String(a.id)), { name: a.displayName, position: a.position?.abbreviation ?? null });
        }
      }
    } catch {
      // Fall through to the per-athlete lookups.
    }
  }
  const missing = ids.filter((id) => !athleteNameCache.has(k(id)));
  for (let i = 0; i < missing.length; i += 8) {
    await Promise.all(
      missing.slice(i, i + 8).map(async (id) => {
        try {
          const res = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/${espnSport}/${espnLeague}/athletes/${encodeURIComponent(id)}`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) return;
          const a = ((await res.json()) as { athlete?: RosterAthlete }).athlete;
          if (a?.displayName) athleteNameCache.set(k(id), { name: a.displayName, position: a.position?.abbreviation ?? null });
        } catch {
          // A name that will not load falls back in the reader.
        }
      }),
    );
  }
  const out = new Map<string, { name: string; position: string | null }>();
  for (const id of ids) {
    const v = athleteNameCache.get(k(id));
    if (v) out.set(id, v);
  }
  return out;
}
