/**
 * Automatic Tier 1 refresh — SharpAPI + Odds-API.io, no user action, never
 * gated behind a button (update-09 § 2). Tier 2 providers never appear here;
 * they're wired into `app/api/props/more-books` and `app/api/props/sharp-price`
 * instead, fired only on an explicit click.
 */

import { tier1Providers, runProviderFetch } from './registry';
import { loadAllGameContexts, loadGameContext } from './gameContext';
import { dailyStatus, recordDailySpend, withinPerMinuteRate } from './budget';
import { oddsApiIoConfig, sharpApiConfig } from './config';
import { isGameFinal } from './gameState';
import type { GameLookupContext } from './types';

export interface Tier1RefreshSummary {
  gamesRefreshed: number;
  rowsWritten: number;
  warnings: string[];
  skipped: string[];
}

/**
 * Refreshes every enabled Tier 1 provider for every game on today's cached
 * slate. Per-provider per-minute rate limits are respected by simply
 * skipping (not queueing/retrying) a game's fetch once a provider's window
 * is spent — the next refresh cycle (~3 min later, tied to the existing
 * snapshot cycle) picks up whatever was skipped, and SharpAPI's board is
 * cached across the whole cycle anyway (see providers/sharpapi.ts) so 12/min
 * is never actually at risk for a normal 15-game slate.
 */
export async function refreshTier1(gameId?: string): Promise<Tier1RefreshSummary> {
  const games: GameLookupContext[] = gameId
    ? [loadGameContext(gameId)].filter((g): g is GameLookupContext => g !== null)
    : loadAllGameContexts();

  const summary: Tier1RefreshSummary = { gamesRefreshed: 0, rowsWritten: 0, warnings: [], skipped: [] };
  const providers = tier1Providers();
  if (providers.length === 0) {
    summary.warnings.push('No Tier 1 providers enabled.');
    return summary;
  }

  const sharpRate = sharpApiConfig().ratePerMin;
  const oddsApiIoLimit = oddsApiIoConfig().dailyLimit;
  const oddsApiIoDaily = dailyStatus('oddsapiio', oddsApiIoLimit);
  // Tracked locally and advanced after every spend so the cap is enforced
  // against the *current* running total, not the total as of the top of this
  // function. `oddsApiIoDaily.exhausted`/`overSoftCap` alone go stale after
  // the first spend in the loop below — a slate-wide refresh that started a
  // few requests under the limit would otherwise run every remaining game
  // before the next call ever re-checked, overshooting the daily cap by up to
  // one game's worth of requests every cycle (observed: 500-540 recorded
  // against a configured 500/day limit).
  let oddsApiIoSpentToday = oddsApiIoDaily.used;

  if (oddsApiIoDaily.exhausted) {
    summary.warnings.push('Odds-API.io daily request cap reached — degrading to Tier 1 sources that still have budget.');
  } else if (oddsApiIoDaily.overSoftCap) {
    summary.warnings.push(`Odds-API.io is over its soft cap (${oddsApiIoDaily.used}/${oddsApiIoDaily.limit} today) — continuing, but refresh frequency should ease off.`);
  }

  for (const game of games) {
    // A finished game's props can't get more valuable data — skipping it
    // here is pure waste elimination on Odds-API.io's per-game credit, and
    // costs nothing extra to check since SharpAPI is free regardless.
    if (isGameFinal(game.gameId)) {
      summary.skipped.push(`${game.gameId} (final)`);
      continue;
    }
    for (const provider of providers) {
      // SharpAPI's own board cache (providers/sharpapi.ts) makes at most one
      // real network call per 90s regardless of how many games this loop
      // visits, so gating on `withinPerMinuteRate` *before* every game would
      // spend a rate-limit token even on calls the adapter serves from cache
      // — that's what starved every game past the first one on an earlier
      // run of this loop. The rate limiter still exists for a genuine burst
      // (cache miss on every game, e.g. right after a restart), checked only
      // when a real fetch is actually about to happen.
      if (provider.meta.id === 'oddsapiio' && oddsApiIoSpentToday >= oddsApiIoLimit) {
        summary.skipped.push(`oddsapiio:${game.gameId} (daily cap)`);
        continue;
      }

      const result = await runProviderFetch(provider.meta.id, game);
      summary.rowsWritten += result.rows.length;
      summary.warnings.push(...result.warnings);

      if (provider.meta.id === 'sharpapi' && (result.cost.requests ?? 0) > 0) {
        if (!withinPerMinuteRate('sharpapi', sharpRate)) {
          summary.warnings.push(`sharpapi:${game.gameId} exceeded its per-minute rate on a genuine cache-miss fetch — this should be rare given the 90s board cache.`);
        }
      }
      if (provider.meta.id === 'oddsapiio' && (result.cost.requests ?? 0) > 0) {
        recordDailySpend('oddsapiio', result.cost.requests ?? 0);
        oddsApiIoSpentToday += result.cost.requests ?? 0;
      }
    }
    summary.gamesRefreshed += 1;
  }

  return summary;
}
