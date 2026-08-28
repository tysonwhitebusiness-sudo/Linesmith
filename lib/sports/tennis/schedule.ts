/**
 * ATP/WTA season schedule + per-tournament draw — tennis's counterpart to
 * `lib/sports/golf/schedule.ts`, built the same "list is cheap, detail is
 * expensive" way but for a structurally different reason than golf's.
 *
 * Golf's schedule feed only ever has full detail for whichever event is
 * currently live — ESPN's PGA scoreboard just doesn't carry course/leaderboard
 * data for other weeks. Tennis is the opposite problem: `?dates={year}` on
 * `.../tennis/{tour}/scoreboard` returns EVERY event for the year with its
 * FULL round-by-round draw already embedded (confirmed live: ~17.5MB for one
 * ATP season) — so the season list here is deliberately stripped down to
 * {id, name, dates, major, venue, status} before it's ever cached, and the
 * full draw is fetched separately, per tournament, on demand
 * (`getTournamentDraw`). Caching the raw year-query response would mean a
 * single `snapshot_cache` row holding tens of megabytes for a page that only
 * ever needs a plain list.
 *
 * The per-tournament draw fetch works for ANY tournament — live, upcoming, or
 * fully completed weeks or months ago (confirmed live against Wimbledon 2026,
 * ~6 weeks after it ended: the full 239-match draw and the real final score
 * came back from a `dates=` range query scoped to that fortnight). That's a
 * genuine capability golf's own schedule page doesn't have — it can only ever
 * show detail for the one currently-active event.
 */

import { readSnapshotCache, writeSnapshotCache } from '../../db/client';
import type { TennisTour } from '../../core/types';
import { roundOrder } from './roundOrder';

export { roundOrder };

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';

export interface ScheduleEvent {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  /** ESPN's own Grand Slam flag — real, not inferred. */
  major: boolean;
  venueCity: string | null;
  status: 'pre' | 'in' | 'post';
  completed: boolean;
}

interface EspnScheduleEvent {
  id: string;
  name: string;
  date: string;
  endDate: string;
  major?: boolean;
  venue?: { displayName?: string };
  status?: { type?: { state?: string; completed?: boolean } };
}

const SEASON_CACHE_KEY = (tour: TennisTour, year: number) => `tennis:schedule:${tour}:${year}`;
// A season's schedule barely moves week to week — same reasoning golf's
// schedule.ts gives for its own 24h TTL.
const SEASON_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchScheduleFromEspn(tour: TennisTour, year: number): Promise<ScheduleEvent[] | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${tour}/scoreboard?dates=${year}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = await res.json();
  const events = (json?.events ?? []) as EspnScheduleEvent[];
  const now = Date.now();
  // Stripped immediately — see this module's own header comment on why the
  // raw response (full draws embedded) must never be what gets cached.
  return events.map((e) => {
    // ESPN's own `status.type.state`/`completed` is unreliable for tennis,
    // confirmed live: the US Open came back `state: "post", completed: true`
    // from BOTH the year-wide and the tournament's own date-scoped query
    // while its qualifying/main draw was actively being played (real live
    // and real TBD-future matches sitting in the same response). A Slam's
    // 3-week qualifying+main-draw span seems to confuse whatever ESPN
    // computes this from — golf's single 4-day stroke-play window never hits
    // this, which is presumably why golf's own schedule.ts trusts the field
    // directly. Deriving status from the event's own start/end dates instead
    // is simple and, checked against the real match data, actually correct.
    const start = Date.parse(e.date);
    const end = Date.parse(e.endDate);
    const status: ScheduleEvent['status'] = now < start ? 'pre' : now > end ? 'post' : 'in';
    return {
      id: String(e.id),
      name: e.name,
      startDate: e.date,
      endDate: e.endDate,
      major: e.major === true,
      venueCity: e.venue?.displayName ?? null,
      status,
      completed: status === 'post',
    };
  });
}

/** The full season schedule for one tour, oldest first. */
export async function getSeasonSchedule(
  tour: TennisTour,
  year = new Date().getFullYear(),
): Promise<{ events: ScheduleEvent[]; fetchedAt: string; fromCache: boolean; warnings: string[] }> {
  const cacheKey = SEASON_CACHE_KEY(tour, year);
  const cached = await readSnapshotCache(cacheKey);
  const ageMs = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;

  if (cached && ageMs < SEASON_TTL_MS) {
    return { events: JSON.parse(cached.payload), fetchedAt: cached.fetchedAt, fromCache: true, warnings: [] };
  }

  const events = await fetchScheduleFromEspn(tour, year);
  if (!events) {
    if (cached) {
      return {
        events: JSON.parse(cached.payload),
        fetchedAt: cached.fetchedAt,
        fromCache: true,
        warnings: ['ESPN schedule request failed — showing the last successful fetch.'],
      };
    }
    return { events: [], fetchedAt: new Date().toISOString(), fromCache: false, warnings: ['ESPN schedule request failed and there is no cached copy yet.'] };
  }

  await writeSnapshotCache(cacheKey, JSON.stringify(events));
  return { events, fetchedAt: new Date().toISOString(), fromCache: false, warnings: [] };
}

// ---------------------------------------------------------------------------
// Per-tournament draw
// ---------------------------------------------------------------------------

export interface DrawSetScore {
  value: number;
  tiebreak?: number;
  winner: boolean;
}

export interface DrawCompetitor {
  athleteId: string;
  name: string;
  flagUrl: string | null;
  sets: DrawSetScore[];
  winner: boolean;
  /**
   * Parsed out of the completed match's own result text (e.g. "(3) Name
   * bt..."), confirmed live — ESPN carries no structured seed field.
   * Only ever populated once a match has been played; an upcoming match's
   * seed is genuinely unknown here, not a guess of `null`.
   */
  seed: number | null;
}

export interface DrawMatch {
  matchId: string;
  round: string;
  date: string;
  court: string | null;
  state: 'pre' | 'in' | 'post';
  completed: boolean;
  statusDetail: string;
  home: DrawCompetitor;
  away: DrawCompetitor;
  resultNote: string | null;
}

export interface DefendingChampion {
  athleteId: string | null;
  name: string;
  headshotUrl: string | null;
}

export interface TournamentDraw {
  eventId: string;
  eventName: string;
  tour: TennisTour;
  major: boolean;
  venueCity: string | null;
  /** True once every match in the draw has finished — a completed tournament's draw never changes again. */
  completed: boolean;
  matches: DrawMatch[];
  /** From ESPN's own `previousWinners` — real, not inferred. Null when ESPN hasn't published one yet for this event (a new/lower-tier event, or very early in a season). */
  defendingChampion: DefendingChampion | null;
}

interface RawDrawCompetitor {
  id: string;
  homeAway: 'home' | 'away';
  winner?: boolean;
  linescores?: Array<{ value?: number; tiebreak?: number; winner?: boolean }>;
  athlete?: { fullName: string; flag?: { href?: string } };
}
interface RawDrawCompetition {
  id: string;
  date: string;
  venue?: { court?: string };
  status?: { type?: { state?: string; completed?: boolean; detail?: string } };
  round?: { displayName?: string };
  notes?: Array<{ text?: string; type?: string }>;
  competitors?: RawDrawCompetitor[];
}
interface RawPreviousWinner {
  displayName: string;
  headshot?: string;
  type?: { slug?: string };
  links?: Array<{ rel?: string[]; href?: string }>;
}
interface RawDrawResponse {
  events?: Array<{
    id: string;
    name: string;
    major?: boolean;
    venue?: { displayName?: string };
    previousWinners?: RawPreviousWinner[];
    groupings?: Array<{ grouping: { slug?: string; displayName?: string }; competitions?: RawDrawCompetition[] }>;
  }>;
}

/** Pulls the ESPN athlete id out of a player-card link (`.../player/_/id/3623/...`) — `previousWinners` carries no bare id field, only this link. */
function athleteIdFromPlayerCardHref(href: string | undefined): string | null {
  const m = href ? /\/id\/(\d+)\//.exec(href) : null;
  return m ? `espn:tennis:${m[1]}` : null;
}

function pickDefendingChampion(winners: RawPreviousWinner[] | undefined, tour: TennisTour): DefendingChampion | null {
  const wantSlug = tour === 'atp' ? 'mens-singles' : 'womens-singles';
  const winner = winners?.find((w) => w.type?.slug === wantSlug);
  if (!winner) return null;
  const cardLink = winner.links?.find((l) => l.rel?.includes('playercard'))?.href;
  return { athleteId: athleteIdFromPlayerCardHref(cardLink), name: winner.displayName, headshotUrl: winner.headshot ?? null };
}

/**
 * "(3) Jannik Sinner (ITA) bt (7) Alexander Zverev (GER) 6-7 ..." → seeds for
 * winner/loser. Either or both seeds are commonly absent (unseeded player,
 * qualifier, or a smaller event that doesn't seed that deep) — the regex's
 * seed groups are optional, and a non-match just means neither side gets one.
 */
function parseResultNote(note: string): { winnerSeed: number | null; loserSeed: number | null } | null {
  const m = /^(?:\((\d+)\)\s*)?.+?\s+(?:bt|d\.|def\.)\s+(?:\((\d+)\)\s*)?.+$/i.exec(note.trim());
  if (!m) return null;
  return { winnerSeed: m[1] ? Number(m[1]) : null, loserSeed: m[2] ? Number(m[2]) : null };
}

function toYyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

async function fetchDrawFromEspn(tour: TennisTour, eventId: string, startDate: string, endDate: string): Promise<TournamentDraw | null> {
  // Padded a day on each side — the same safety margin
  // `fetchTennisMatchDetail` (espnTennis.ts) already uses, in case a
  // tournament's first/last match falls right on the boundary in a
  // different timezone than ESPN's own date-bucketing.
  const start = toYyyymmdd(new Date(Date.parse(startDate) - 86_400_000));
  const end = toYyyymmdd(new Date(Date.parse(endDate) + 86_400_000));

  let res: Response;
  try {
    res = await fetch(`${BASE}/${tour}/scoreboard?dates=${start}-${end}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = (await res.json()) as RawDrawResponse;

  const event = (json.events ?? []).find((e) => String(e.id) === eventId);
  if (!event) return null;

  const singlesSlug = tour === 'atp' ? 'mens-singles' : 'womens-singles';
  const grouping = (event.groupings ?? []).find((g) => g.grouping.slug === singlesSlug);
  const major = event.major === true;
  const venueCity = event.venue?.displayName ?? null;
  const defendingChampion = pickDefendingChampion(event.previousWinners, tour);
  if (!grouping) return { eventId, eventName: event.name, tour, major, venueCity, completed: true, matches: [], defendingChampion };

  const matches: DrawMatch[] = [];
  for (const comp of grouping.competitions ?? []) {
    const home = comp.competitors?.find((c) => c.homeAway === 'home');
    const away = comp.competitors?.find((c) => c.homeAway === 'away');
    if (!home?.athlete || !away?.athlete) continue; // doubles-shaped rows carry `roster`, not `athlete` — already excluded by grouping slug, this is a second safety net

    const state = (comp.status?.type?.state as DrawMatch['state']) ?? 'pre';
    const completed = comp.status?.type?.completed ?? false;
    const resultNote = comp.notes?.find((n) => n.type === 'event')?.text ?? null;
    const seeds = resultNote ? parseResultNote(resultNote) : null;

    const toCompetitor = (c: NonNullable<typeof home>, seed: number | null): DrawCompetitor => ({
      athleteId: `espn:tennis:${c.id}`,
      name: c.athlete!.fullName,
      flagUrl: c.athlete!.flag?.href ?? null,
      winner: c.winner === true,
      seed,
      sets: (c.linescores ?? []).map((l) => ({ value: l.value ?? 0, tiebreak: l.tiebreak, winner: l.winner === true })),
    });

    const homeWon = home.winner === true;
    matches.push({
      matchId: String(comp.id),
      round: comp.round?.displayName ?? 'Unknown round',
      date: comp.date,
      court: comp.venue?.court ?? null,
      state,
      completed,
      statusDetail: comp.status?.type?.detail ?? '',
      home: toCompetitor(home, seeds ? (homeWon ? seeds.winnerSeed : seeds.loserSeed) : null),
      away: toCompetitor(away, seeds ? (homeWon ? seeds.loserSeed : seeds.winnerSeed) : null),
      resultNote,
    });
  }

  return {
    eventId,
    eventName: event.name,
    tour,
    major,
    venueCity,
    completed: matches.length > 0 && matches.every((m) => m.completed),
    matches,
    defendingChampion,
  };
}

/**
 * Resolve one tournament's full draw, cached with a TTL that depends on
 * whether the tournament is actually over: a completed draw never changes
 * again, so it's cached for a week; a live/upcoming one refreshes every few
 * minutes. This asymmetry lives here (not in a route-level fixed TTL)
 * because only the fetched payload itself knows which case it is.
 */
export async function getTournamentDraw(
  tour: TennisTour,
  eventId: string,
  startDate: string,
  endDate: string,
): Promise<{ draw: TournamentDraw | null; fromCache: boolean; warnings: string[] }> {
  const cacheKey = `tennis:draw:${tour}:${eventId}`;
  const cached = await readSnapshotCache(cacheKey);
  const cachedDraw: TournamentDraw | null = cached ? JSON.parse(cached.payload) : null;
  const ageMs = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;
  const ttlMs = cachedDraw?.completed ? 7 * 24 * 60 * 60 * 1000 : 3 * 60 * 1000;

  if (cachedDraw && ageMs < ttlMs) {
    return { draw: cachedDraw, fromCache: true, warnings: [] };
  }

  const fetched = await fetchDrawFromEspn(tour, eventId, startDate, endDate);
  if (!fetched) {
    if (cachedDraw) {
      return { draw: cachedDraw, fromCache: true, warnings: ['ESPN draw request failed — showing the last successful fetch.'] };
    }
    return { draw: null, fromCache: false, warnings: ['ESPN draw request failed and there is no cached copy yet.'] };
  }

  await writeSnapshotCache(cacheKey, JSON.stringify(fetched));
  return { draw: fetched, fromCache: false, warnings: [] };
}
