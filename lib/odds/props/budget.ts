/**
 * Spend tracking for the four metered/rate-limited providers, backed by the
 * `provider_usage` table so counts survive a dev-server restart — a restart
 * silently re-earning budget would be the same class of bug as the
 * `snapshot_cache` fault from update-07's Phase 4.
 *
 * "Local midnight" (update-09 §2, Odds-API.io's daily reset) is anchored to
 * US Eastern, the same "today" the rest of the app already uses for the MLB
 * slate (`easternDate()` in `lib/sports/mlb/statsapi.ts`) — anchoring the
 * odds day-counter to a different timezone than the slate it's counting
 * against would make "today's usage" and "today's slate" disagree.
 */

import { getProviderUsage, incrementProviderUsage } from '@/lib/db/client';
import type { ProviderId } from './types';

function easternDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function easternMonthKey(now: Date = new Date()): string {
  return easternDateKey(now).slice(0, 7);
}

export interface BudgetStatus {
  used: number;
  limit: number;
  remaining: number;
  softCap: number | null;
  /** True once `used` would meet or exceed `limit` on the next spend. */
  exhausted: boolean;
  /** True once `used` has crossed the soft cap — caller should degrade, not stop. */
  overSoftCap: boolean;
}

function statusFrom(used: number, limit: number, softCap: number | null): BudgetStatus {
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    softCap,
    exhausted: used >= limit,
    overSoftCap: softCap != null && used >= softCap,
  };
}

/** Odds-API.io: daily, resets at Eastern midnight. */
export function dailyStatus(providerId: ProviderId, limit: number, softCap: number | null = null): BudgetStatus {
  const row = getProviderUsage(providerId, 'daily', easternDateKey());
  return statusFrom(row.requestCount, limit, softCap);
}

export function recordDailySpend(providerId: ProviderId, requests: number): void {
  incrementProviderUsage(providerId, 'daily', easternDateKey(), requests, 0);
}

/** SportsGameOdds / OddsPapi / The Odds API: monthly, billed by object or request depending on provider. */
export function monthlyStatus(
  providerId: ProviderId,
  limit: number,
  softCap: number | null,
  unit: 'requests' | 'objects' = 'requests',
): BudgetStatus {
  const row = getProviderUsage(providerId, 'monthly', easternMonthKey());
  return statusFrom(unit === 'objects' ? row.objectCount : row.requestCount, limit, softCap);
}

export function recordMonthlySpend(providerId: ProviderId, requests: number, objects: number): void {
  incrementProviderUsage(providerId, 'monthly', easternMonthKey(), requests, objects);
}

/** Minutes-based rate limiting (SharpAPI 12/min, SportsGameOdds 10/min) — a simple in-process token count, not persisted, since a burst window resets in under a minute regardless of restarts. */
const minuteWindows = new Map<string, { windowStart: number; count: number }>();

export function withinPerMinuteRate(providerId: ProviderId, ratePerMin: number): boolean {
  const now = Date.now();
  const bucket = minuteWindows.get(providerId);
  if (!bucket || now - bucket.windowStart >= 60_000) {
    minuteWindows.set(providerId, { windowStart: now, count: 1 });
    return true;
  }
  if (bucket.count >= ratePerMin) return false;
  bucket.count += 1;
  return true;
}
