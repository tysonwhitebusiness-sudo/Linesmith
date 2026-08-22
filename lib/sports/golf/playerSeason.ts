/**
 * A golfer's season tournament log — wires up `fetchAthleteSeason` in
 * espn.ts, which existed already but was never called from anywhere (dead
 * code, written for a player-detail view that was never built). Free, same
 * ESPN feed the rest of golf already depends on, no new integration.
 */

import { fetchAthleteSeason } from './espn';
import { readSnapshotCache, writeSnapshotCache } from '../../db/client';

export interface SeasonEventResult {
  eventId: string;
  eventName: string;
  date: string;
  /** e.g. "T12", "1", "CUT", "WD" */
  position: string;
  scoreDisplay: string;
  madeCut: boolean;
}

export interface PlayerSeasonLog {
  espnId: string;
  season: number;
  events: SeasonEventResult[];
  fetchedAt: string;
  fromCache: boolean;
}

const CACHE_KEY_PREFIX = 'golf:season-log:';
// A finished tournament's row in this log never changes — daily TTL just
// keeps this from re-fetching every scan refresh for a golfer no one's
// looking at.
const TTL_MS = 24 * 60 * 60 * 1000;

function parseSeasonLog(json: any): SeasonEventResult[] {
  const eventsStats = json?.leaguesStats?.[0]?.eventsStats;
  if (!Array.isArray(eventsStats)) return [];

  const out: SeasonEventResult[] = [];
  for (const event of eventsStats) {
    const competitor = event?.competitions?.[0]?.competitors?.[0];
    if (!competitor) continue;
    const status = competitor.status;
    const cutStatus = status?.type?.name === 'STATUS_CUT';
    out.push({
      eventId: String(event.id ?? ''),
      eventName: event.name ?? event.shortName ?? 'Event',
      date: event.date ?? '',
      position: status?.position?.displayName ?? status?.displayValue ?? '—',
      scoreDisplay: competitor.score?.displayValue ?? String(competitor.score?.value ?? '—'),
      madeCut: !cutStatus,
    });
  }
  return out;
}

export async function getPlayerSeasonLog(espnId: string, season = new Date().getFullYear()): Promise<PlayerSeasonLog> {
  const cacheKey = `${CACHE_KEY_PREFIX}${espnId}:${season}`;
  const cached = await readSnapshotCache(cacheKey);
  const ageMs = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;

  if (cached && ageMs < TTL_MS) {
    return { espnId, season, events: JSON.parse(cached.payload), fetchedAt: cached.fetchedAt, fromCache: true };
  }

  const json = await fetchAthleteSeason(espnId, season);
  const events = json ? parseSeasonLog(json) : [];
  if (json) await writeSnapshotCache(cacheKey, JSON.stringify(events));

  return { espnId, season, events, fetchedAt: new Date().toISOString(), fromCache: false };
}
