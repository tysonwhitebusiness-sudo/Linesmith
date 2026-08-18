/**
 * Reads every provider's env configuration once. A provider with a missing
 * key or an explicit `false` `_ENABLED` flag comes back `enabled: false` —
 * the registry (registry.ts) skips it silently at startup rather than
 * throwing, per update-09's "must work with any subset configured, including
 * none."
 */

import type { ProviderId } from './types';

function truthy(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  return value.toLowerCase() === 'true';
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export interface ProviderConfig {
  id: ProviderId;
  enabled: boolean;
  key: string | null;
}

export function sharpApiConfig(): ProviderConfig & { ratePerMin: number; delaySeconds: number } {
  return {
    id: 'sharpapi',
    enabled: truthy(process.env.SHARPAPI_ENABLED, true) && !!process.env.SHARPAPI_KEY,
    key: process.env.SHARPAPI_KEY ?? null,
    ratePerMin: num(process.env.SHARPAPI_RATE_PER_MIN, 12),
    delaySeconds: num(process.env.SHARPAPI_DELAY_SECONDS, 60),
  };
}

export function oddsApiIoConfig(): ProviderConfig & { books: string[]; ratePerHour: number; dailyLimit: number } {
  return {
    id: 'oddsapiio',
    enabled: truthy(process.env.ODDSAPIIO_ENABLED, true) && !!process.env.ODDSAPIIO_KEY,
    key: process.env.ODDSAPIIO_KEY ?? null,
    books: (process.env.ODDSAPIIO_BOOKS ?? 'Fanatics,BetMGM').split(',').map((s) => s.trim()).filter(Boolean),
    ratePerHour: num(process.env.ODDSAPIIO_RATE_PER_HOUR, 100),
    dailyLimit: num(process.env.ODDSAPIIO_DAILY_LIMIT, 500),
  };
}

export function sportsGameOddsConfig(): ProviderConfig & { ratePerMin: number; monthlyLimit: number; softCap: number } {
  return {
    id: 'sportsgameodds',
    enabled: truthy(process.env.SPORTSGAMEODDS_ENABLED, true) && !!process.env.SPORTSGAMEODDS_KEY,
    key: process.env.SPORTSGAMEODDS_KEY ?? null,
    ratePerMin: num(process.env.SPORTSGAMEODDS_RATE_PER_MIN, 10),
    monthlyLimit: num(process.env.SPORTSGAMEODDS_MONTHLY_LIMIT, 2500),
    softCap: num(process.env.SPORTSGAMEODDS_SOFT_CAP, 2000),
  };
}

export function oddsPapiConfig(): ProviderConfig & { monthlyLimit: number; softCap: number } {
  return {
    id: 'oddspapi',
    enabled: truthy(process.env.ODDSPAPI_ENABLED, true) && !!process.env.ODDSPAPI_KEY,
    key: process.env.ODDSPAPI_KEY ?? null,
    monthlyLimit: num(process.env.ODDSPAPI_MONTHLY_LIMIT, 250),
    softCap: num(process.env.ODDSPAPI_SOFT_CAP, 200),
  };
}

export function theOddsApiConfig(): ProviderConfig & { monthlyLimit: number } {
  return {
    id: 'theoddsapi',
    // Lowest priority, disabled by default per update-09 §9 step 10 — the
    // coverage matrix (docs/odds-provider-verification.md) shows the other
    // four already cover what this one would add for props.
    enabled: truthy(process.env.THEODDSAPI_ENABLED, false) && !!process.env.THEODDSAPI_KEY,
    key: process.env.THEODDSAPI_KEY ?? null,
    monthlyLimit: num(process.env.THEODDSAPI_MONTHLY_LIMIT, 500),
  };
}

/**
 * ParlayAPI — general key (NFL/CFB primary, Soccer/EPL secondary). Billed in
 * credits per call (observed live: ~3-10 credits per full-sport-slate pull),
 * 1,000/month free. Separate from `parlayApiMlbConfig` below so MLB usage
 * never crowds out NFL/CFB budget or vice versa — each key gets its own
 * `provider_usage` row.
 */
export function parlayApiConfig(): ProviderConfig & { monthlyLimit: number; softCap: number } {
  return {
    id: 'parlayapi',
    enabled: truthy(process.env.PARLAYAPI_ENABLED, true) && !!process.env.PARLAYAPI_KEY,
    key: process.env.PARLAYAPI_KEY ?? null,
    monthlyLimit: num(process.env.PARLAYAPI_MONTHLY_LIMIT, 1000),
    softCap: num(process.env.PARLAYAPI_SOFT_CAP, 800),
  };
}

/** ParlayAPI — second key, dedicated to MLB props specifically (remaining market gaps there). */
export function parlayApiMlbConfig(): ProviderConfig & { monthlyLimit: number; softCap: number } {
  return {
    id: 'parlayapi_mlb',
    enabled: truthy(process.env.PARLAYAPI_MLB_ENABLED, true) && !!process.env.PARLAYAPI_MLB_KEY,
    key: process.env.PARLAYAPI_MLB_KEY ?? null,
    monthlyLimit: num(process.env.PARLAYAPI_MLB_MONTHLY_LIMIT, 1000),
    softCap: num(process.env.PARLAYAPI_MLB_SOFT_CAP, 800),
  };
}

/**
 * Propline — general key (MLB, proven). Billed 1 request per call regardless
 * of markets requested, 1,000/day free — by far the most generous daily
 * ceiling of any provider in the stack. Use `/events/{id}/markets` to
 * discover real available market keys per sport before assuming a guessed
 * key name returns nothing (see docs/odds-provider-verification.md-style
 * lesson from this session — Soccer/EPL props were missed on first pass by
 * guessing the wrong key names).
 */
export function proplineConfig(): ProviderConfig & { dailyLimit: number } {
  return {
    id: 'propline',
    enabled: truthy(process.env.PROPLINE_ENABLED, true) && !!process.env.PROPLINE_KEY,
    key: process.env.PROPLINE_KEY ?? null,
    dailyLimit: num(process.env.PROPLINE_DAILY_LIMIT, 1000),
  };
}

/** Propline — second key, dedicated to Soccer/EPL (proven live this session). */
export function propline2Config(): ProviderConfig & { dailyLimit: number } {
  return {
    id: 'propline_2',
    enabled: truthy(process.env.PROPLINE_2_ENABLED, true) && !!process.env.PROPLINE_2_KEY,
    key: process.env.PROPLINE_2_KEY ?? null,
    dailyLimit: num(process.env.PROPLINE_2_DAILY_LIMIT, 1000),
  };
}

/**
 * TheRundown — game-lines/schedule/live-score enrichment ONLY. Its free tier
 * explicitly excludes player props ("No player props or alt markets" — their
 * own pricing page); Starter ($49/mo) is required for that. Deliberately not
 * a `ProviderAdapter` in the props registry — see `lib/odds/rundown.ts`,
 * which follows `oddsHarvester.ts`'s pattern (game-line enrichment) instead.
 */
export function rundownConfig(): { enabled: boolean; key: string | null } {
  return {
    enabled: truthy(process.env.RUNDOWN_ENABLED, true) && !!process.env.RUNDOWN_KEY,
    key: process.env.RUNDOWN_KEY ?? null,
  };
}

export function userSportsbook(): string {
  return process.env.USER_SPORTSBOOK ?? 'Fanatics';
}
