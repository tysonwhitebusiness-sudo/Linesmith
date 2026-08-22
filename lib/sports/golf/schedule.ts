/**
 * PGA Tour season schedule — ESPN's `pga/scoreboard?dates=YYYY`, the same
 * public golf host the rest of `lib/sports/golf` already depends on. Existed
 * nowhere in the app before this rebuild.
 *
 * This endpoint gives event name/dates/status only — no course, no par, no
 * yardage per event (verified live 2026-08-16). Full course detail (holes,
 * par, yardage) is only ever available for whichever event ESPN's live
 * leaderboard is currently showing (see espn.ts's `parseCourse`), which is
 * the one event `getGolfSnapshot` already fetches in depth. The schedule
 * page is honest about that gap rather than guessing a course from a
 * tournament name.
 */

import { readSnapshotCache, writeSnapshotCache } from '../../db/client';

export interface ScheduleEvent {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'pre' | 'in' | 'post';
  completed: boolean;
}

interface EspnScheduleEvent {
  id: string;
  name: string;
  date: string;
  endDate: string;
  status?: { type?: { state?: string; completed?: boolean } };
}

const CACHE_KEY_PREFIX = 'golf:schedule:';
// A season's schedule barely changes week to week — refetching more than
// daily buys nothing.
const TTL_MS = 24 * 60 * 60 * 1000;

async function fetchScheduleFromEspn(year: number): Promise<ScheduleEvent[] | null> {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=${year}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const events = (json?.events ?? []) as EspnScheduleEvent[];
  return events.map((e) => ({
    id: String(e.id),
    name: e.name,
    startDate: e.date,
    endDate: e.endDate,
    status: (e.status?.type?.state as ScheduleEvent['status']) ?? 'pre',
    completed: Boolean(e.status?.type?.completed),
  }));
}

/** The full season schedule, oldest first. */
export async function getSeasonSchedule(year = new Date().getFullYear()): Promise<{ events: ScheduleEvent[]; fetchedAt: string; fromCache: boolean; warnings: string[] }> {
  const cacheKey = `${CACHE_KEY_PREFIX}${year}`;
  const cached = await readSnapshotCache(cacheKey);
  const ageMs = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;

  if (cached && ageMs < TTL_MS) {
    return { events: JSON.parse(cached.payload), fetchedAt: cached.fetchedAt, fromCache: true, warnings: [] };
  }

  const events = await fetchScheduleFromEspn(year);
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
