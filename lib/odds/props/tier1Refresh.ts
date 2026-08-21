/**
 * Automatic Tier 1 refresh — SharpAPI + Odds-API.io + Propline (MLB key),
 * no user action, never gated behind a button (update-09 § 2). Other
 * providers never appear here; the ones that are click-only are wired into
 * `app/api/props/more-books` and `app/api/props/sharp-price` instead, fired
 * only on an explicit click — the ones that are scheduled elsewhere
 * (SportsGameOdds's MLB job, the NFL/CFB/Soccer jobs) have their own
 * separate stacks in registry.ts, not this one.
 *
 * Propline added to this comment 2026-08-20 — it was always tagged tier1
 * and always running in this loop, but this comment (and this loop's own
 * rate-limit/budget-recording logic, fixed in the same pass) hadn't been
 * updated to account for it. See providers/propline.ts's own header comment
 * and the incident notes there for the full story — found alongside a
 * related but distinct bug where ParlayAPI was ALSO silently running here
 * despite never being meant to (fixed separately: ParlayAPI is no longer
 * tier1 at all, its real home is multiSportRefresh.ts).
 *
 * Rewired 2026-08-20 onto registry.ts's providersForJob('tier1') — the flat
 * tier1Providers()/tier2Providers() split retired in favor of real, ordered,
 * per-job stacks (see registry.ts's own doc comment). This loop's own
 * per-provider gating below (keyed by provider.meta.id, not by which stack
 * it came from) is unchanged.
 */

import { providersForJob, runProviderFetch } from './registry';
import { loadAllGameContexts, loadGameContext } from './gameContext';
import { dailyStatus, recordDailySpend, hasPerMinuteCapacity, withinPerMinuteRate } from './budget';
import { oddsApiIoConfig, sharpApiConfig, proplineConfig } from './config';
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
    ? [await loadGameContext(gameId)].filter((g): g is GameLookupContext => g !== null)
    : await loadAllGameContexts();

  const summary: Tier1RefreshSummary = { gamesRefreshed: 0, rowsWritten: 0, warnings: [], skipped: [] };
  const providers = providersForJob('tier1');
  if (providers.length === 0) {
    summary.warnings.push('No Tier 1 providers enabled.');
    return summary;
  }

  const sharpRate = sharpApiConfig().ratePerMin;
  const oddsApiIoLimit = oddsApiIoConfig().dailyLimit;
  const oddsApiIoDaily = await dailyStatus('oddsapiio', oddsApiIoLimit);
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

  // Propline (MLB key) — same daily-cap discipline as Odds-API.io, added
  // 2026-08-20. Previously this provider ran in this exact loop with none
  // of this: no cap check, no spend ever recorded, despite genuinely
  // belonging here (unlike ParlayAPI, which didn't and has been removed).
  const proplineLimit = proplineConfig().dailyLimit;
  const proplineDaily = await dailyStatus('propline', proplineLimit);
  let proplineSpentToday = proplineDaily.used;

  if (proplineDaily.exhausted) {
    summary.warnings.push('Propline daily request cap reached — degrading to Tier 1 sources that still have budget.');
  } else if (proplineDaily.overSoftCap) {
    summary.warnings.push(`Propline is over its soft cap (${proplineDaily.used}/${proplineDaily.limit} today) — continuing, but refresh frequency should ease off.`);
  }

  for (const game of games) {
    // A finished game's props can't get more valuable data — skipping it
    // here is pure waste elimination on Odds-API.io's per-game credit, and
    // costs nothing extra to check since SharpAPI is free regardless.
    if (await isGameFinal(game.gameId)) {
      summary.skipped.push(`${game.gameId} (final)`);
      continue;
    }
    for (const provider of providers) {
      if (provider.meta.id === 'oddsapiio' && oddsApiIoSpentToday >= oddsApiIoLimit) {
        summary.skipped.push(`oddsapiio:${game.gameId} (daily cap)`);
        continue;
      }
      if (provider.meta.id === 'propline' && proplineSpentToday >= proplineLimit) {
        summary.skipped.push(`propline:${game.gameId} (daily cap)`);
        continue;
      }
      // SharpAPI's own board cache (providers/sharpapi.ts) makes at most one
      // real network call per 90s regardless of how many games this loop
      // visits, so this is a read-only capacity peek, not a consuming check
      // — consuming a token on every loop iteration regardless of whether
      // the fetch below actually reaches the network would starve every
      // game past the first one whenever the board is already cached (the
      // bug this rate limiter previously had, when the consuming check ran
      // *after* the fetch and so could only warn, never actually block). The
      // token itself is only spent below, once a real cache-miss fetch is
      // confirmed to have happened.
      if (provider.meta.id === 'sharpapi' && !hasPerMinuteCapacity('sharpapi', sharpRate)) {
        summary.skipped.push(`sharpapi:${game.gameId} (rate limit — will pick up next cycle)`);
        continue;
      }

      const result = await runProviderFetch(provider.meta.id, game);
      summary.rowsWritten += result.rows.length;
      summary.warnings.push(...result.warnings);

      if (provider.meta.id === 'sharpapi' && (result.cost.requests ?? 0) > 0) {
        // Consumes the token the capacity check above confirmed was
        // available; safe as a separate call here since this loop is fully
        // sequential (no concurrent iteration can spend it in between).
        withinPerMinuteRate('sharpapi', sharpRate);
      }
      if (provider.meta.id === 'oddsapiio' && (result.cost.requests ?? 0) > 0) {
        await recordDailySpend('oddsapiio', result.cost.requests ?? 0);
        oddsApiIoSpentToday += result.cost.requests ?? 0;
      }
      if (provider.meta.id === 'propline' && (result.cost.requests ?? 0) > 0) {
        await recordDailySpend('propline', result.cost.requests ?? 0);
        proplineSpentToday += result.cost.requests ?? 0;
      }
    }
    summary.gamesRefreshed += 1;
  }

  return summary;
}
