/**
 * Spend tracking for the four metered/rate-limited providers, backed by the
 * `provider_usage` table so counts survive a dev-server restart — a restart
 * silently re-earning budget would be the same class of bug as the
 * `snapshot_cache` fault from update-07's Phase 4.
 *
 * "Local midnight" (update-09 §2, Odds-API.io's daily reset) was assumed
 * anchored to US Eastern, matching the MLB slate's own "today"
 * (`easternDate()` in `lib/sports/mlb/statsapi.ts`) — **that assumption was
 * wrong, confirmed live 2026-08-20**: Odds-API.io's own 429 error text says
 * "resets at midnight UTC", and Propline's response headers
 * (`x-daily-reset`) confirm the same for both its keys. Eastern midnight ran
 * ~4-5 hours (the EDT offset) behind the real vendor reset every single day,
 * undercounting real spend for that whole window — very likely why
 * Odds-API.io's real account showed "500/500 exhausted" while this app's own
 * tracker still read near-zero for the day (see
 * docs/api-capability-audit-2026-08-20.md). `dailyStatus`/`recordDailySpend`
 * now key off real UTC midnight instead. `monthlyStatus`/`recordMonthlySpend`
 * stay on Eastern — a calendar month only disagrees between timezones in a
 * few-hour window once a month, a far smaller edge case than the daily one.
 * Fixed in the Python worker's db.py at the same time — both apps read/write
 * the same provider_usage rows, so leaving one on the old key would fragment
 * the shared budget instead of fixing it.
 */

import { getProviderUsage, incrementProviderUsage } from '@/lib/db/client';
import type { ProviderId } from './types';

function utcDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function easternMonthKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .slice(0, 7);
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

/** Odds-API.io / Propline: daily, resets at UTC midnight (live-confirmed 2026-08-20). */
export async function dailyStatus(providerId: ProviderId, limit: number, softCap: number | null = null): Promise<BudgetStatus> {
  const row = await getProviderUsage(providerId, 'daily', utcDateKey());
  return statusFrom(row.requestCount, limit, softCap);
}

export async function recordDailySpend(providerId: ProviderId, requests: number): Promise<void> {
  await incrementProviderUsage(providerId, 'daily', utcDateKey(), requests, 0);
}

/** SportsGameOdds / OddsPapi / The Odds API: monthly, billed by object or request depending on provider. */
export async function monthlyStatus(
  providerId: ProviderId,
  limit: number,
  softCap: number | null,
  unit: 'requests' | 'objects' = 'requests',
): Promise<BudgetStatus> {
  const row = await getProviderUsage(providerId, 'monthly', easternMonthKey());
  return statusFrom(unit === 'objects' ? row.objectCount : row.requestCount, limit, softCap);
}

export async function recordMonthlySpend(providerId: ProviderId, requests: number, objects: number): Promise<void> {
  await incrementProviderUsage(providerId, 'monthly', easternMonthKey(), requests, objects);
}

/** Minutes-based rate limiting (SharpAPI 12/min, SportsGameOdds 10/min) — a simple in-process token count, not persisted, since a burst window resets in under a minute regardless of restarts. */
const minuteWindows = new Map<string, { windowStart: number; count: number }>();

/**
 * Read-only capacity check — true if a per-minute token is currently
 * available, without consuming one. Exists for a caller (SharpAPI's tier1
 * refresh loop) that needs to gate a fetch *before* it happens but can't
 * unconditionally call `withinPerMinuteRate` at that point, because that
 * would consume a token on every loop iteration regardless of whether the
 * fetch that follows actually reaches the network or gets served from the
 * provider adapter's own cache — see the call site in tier1Refresh.ts.
 */
export function hasPerMinuteCapacity(providerId: ProviderId, ratePerMin: number): boolean {
  const now = Date.now();
  const bucket = minuteWindows.get(providerId);
  if (!bucket || now - bucket.windowStart >= 60_000) return true;
  return bucket.count < ratePerMin;
}

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
