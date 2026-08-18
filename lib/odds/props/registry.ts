/**
 * The provider registry. Downstream code asks this module, never a specific
 * provider adapter directly (update-09 § 6) — Scan, Player Detail and Game
 * Detail all read prop odds through `readPropOddsForGame`/`readPropOddsForSubject`
 * in `lib/db/client.ts`, and only the refresh/action routes in `app/api/props/*`
 * touch this file.
 */

import type { ProviderAdapter, ProviderId, GameLookupContext, FetchResult } from './types';
import { sharpApiAdapter } from './providers/sharpapi';
import { oddsApiIoAdapter } from './providers/oddsApiIo';
import { sportsGameOddsAdapter } from './providers/sportsGameOdds';
import { oddsPapiAdapter } from './providers/oddsPapi';
import { theOddsApiAdapter } from './providers/theOddsApi';
import { parlayApiAdapter, parlayApiMlbAdapter } from './providers/parlayApi';
import { proplineAdapter, propline2Adapter } from './providers/propline';
import { writePropOdds, replaceUnresolvedForProvider } from '@/lib/db/client';

const ALL_ADAPTERS: ProviderAdapter[] = [
  sharpApiAdapter,
  oddsApiIoAdapter,
  sportsGameOddsAdapter,
  oddsPapiAdapter,
  theOddsApiAdapter,
  parlayApiAdapter,
  parlayApiMlbAdapter,
  proplineAdapter,
  propline2Adapter,
];

/** Every adapter whose config resolved to enabled at import time. */
export function enabledProviders(): ProviderAdapter[] {
  return ALL_ADAPTERS.filter((a) => a.meta.enabled);
}

export function tier1Providers(): ProviderAdapter[] {
  return enabledProviders().filter((a) => a.meta.tier === 'tier1');
}

export function tier2Providers(): ProviderAdapter[] {
  return enabledProviders().filter((a) => a.meta.tier === 'tier2');
}

export function getProvider(id: ProviderId): ProviderAdapter | undefined {
  return ALL_ADAPTERS.find((a) => a.meta.id === id);
}

/** All registered adapters regardless of enabled state — for a settings/diagnostics view. */
export function allProviderMeta() {
  return ALL_ADAPTERS.map((a) => a.meta);
}

/**
 * Runs one adapter's fetch, persists resolved rows and unresolved rows, and
 * returns the result so the caller (a refresh cycle or a Tier 2 action route)
 * can update budget counters with the real cost. Never throws — a provider
 * failure becomes a warning in the result, since one provider being down must
 * not take the others down with it (acceptance check: "exhausting one does
 * not disable the others").
 */
export async function runProviderFetch(id: ProviderId, game: GameLookupContext): Promise<FetchResult> {
  const adapter = getProvider(id);
  if (!adapter) {
    return { rows: [], unresolved: [], cost: {}, warnings: [`Provider ${id} is not registered or not enabled.`] };
  }

  let result: FetchResult;
  try {
    result = await adapter.fetchGameProps(game);
  } catch (error) {
    return {
      rows: [],
      unresolved: [],
      cost: {},
      warnings: [`${id} fetch failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (result.rows.length > 0) {
    writePropOdds(
      result.rows.map((r) => ({
        providerId: r.providerId,
        gameId: r.gameId,
        subjectId: r.subjectId,
        subjectName: r.subjectName,
        marketKey: r.marketKey,
        line: r.line,
        side: r.side,
        bookmaker: r.bookmaker,
        americanOdds: r.americanOdds,
        decimalOdds: r.decimalOdds,
        isDelayed: r.isDelayed,
        delaySeconds: r.delaySeconds,
      })),
    );
  }

  replaceUnresolvedForProvider(
    id,
    result.unresolved.map((u) => ({ kind: u.kind, rawValue: u.rawValue, context: u.context })),
  );

  return result;
}
