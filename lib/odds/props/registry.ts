/**
 * The provider registry. Downstream code asks this module, never a specific
 * provider adapter directly (update-09 § 6) — Scan, Player Detail and Game
 * Detail all read prop odds through `readPropOddsForGame`/`readPropOddsForSubject`
 * in `lib/db/client.ts`, and only the refresh/action routes in `app/api/props/*`
 * touch this file.
 */

import type { ProviderAdapter, ProviderId, GameLookupContext, FetchResult, SportKey } from './types';
import { sharpApiAdapter } from './providers/sharpapi';
import { oddsApiIoAdapter } from './providers/oddsApiIo';
import { sportsGameOddsAdapter, sportsGameOddsMultisportAdapter } from './providers/sportsGameOdds';
import { oddsPapiAdapter } from './providers/oddsPapi';
import { theOddsApiAdapter } from './providers/theOddsApi';
import { parlayApiAdapter, parlayApiMlbAdapter, parlayApiNflAdapter, parlayApiCfbAdapter, parlayApiSoccerAdapter } from './providers/parlayApi';
import { proplineAdapter, propline2Adapter } from './providers/propline';
import { writePropOdds, replaceUnresolvedForProvider } from '@/lib/db/client';

const ALL_ADAPTERS: ProviderAdapter[] = [
  sharpApiAdapter,
  oddsApiIoAdapter,
  sportsGameOddsAdapter,
  sportsGameOddsMultisportAdapter,
  oddsPapiAdapter,
  theOddsApiAdapter,
  parlayApiAdapter,
  parlayApiMlbAdapter,
  parlayApiNflAdapter,
  parlayApiCfbAdapter,
  parlayApiSoccerAdapter,
  proplineAdapter,
  propline2Adapter,
];

/** Every adapter whose config resolved to enabled at import time. */
export function enabledProviders(): ProviderAdapter[] {
  return ALL_ADAPTERS.filter((a) => a.meta.enabled);
}

/**
 * Real, ordered, capability-informed provider stacks per JOB — replaces the
 * old flat tier1Providers()/tier2Providers() split (2026-08-20, see
 * docs/api-capability-audit-2026-08-20.md §4). That split answered "which
 * automated loop" but conflated it with "which budget" — a single tag
 * trying to carry two different questions is exactly the shape that let
 * ParlayAPI and Propline's soccer identity each silently run with zero
 * rate-limit checking for a real stretch of time (see
 * docs/phase2-hardening-gameplan-2026-08-20.md items 3-4).
 *
 * Keyed by JOB, not sport — MLB alone spans two real jobs with different
 * cadences (Tier 1 @ ~2.5min: SharpAPI/Odds-API.io/Propline; a separate
 * SportsGameOdds job @ ~90min). Collapsing this to one stack per SportKey
 * would pull SportsGameOdds into Tier 1's loop and double-schedule it via
 * two paths at once — exactly mirrors the real job boundaries Python's
 * JOB_REGISTRY (python-odds-service/src/jobs.py) already proved correct
 * live tonight, so this is kept in lockstep with that, not redesigned
 * independently.
 *
 * Order matters: SharpAPI leads Tier 1 because it's the only free-unmetered
 * provider (no daily/monthly wall to manage), not because of a tier label.
 * `parlayapi_mlb` deliberately has no job here — it's real but click-only
 * (see parlayApi.ts's SCHEDULED map), reached directly by id from a manual
 * action route, not through a job stack. SharpAPI's own capability audit
 * (docs/api-capability-audit-2026-08-20.md §1) confirms real live NFL
 * coverage that's never actually been wired into the NFL job — a genuine,
 * separate opportunity, deliberately not added here since it's new scope
 * beyond replacing the tier system, not a rename of existing behavior.
 */
export type ProviderJob = 'tier1' | 'sportsgameodds_mlb' | 'nfl' | 'cfb' | 'soccer_epl';

const JOB_PROVIDER_STACKS: Record<ProviderJob, ProviderId[]> = {
  tier1: ['sharpapi', 'oddsapiio', 'propline'],
  sportsgameodds_mlb: ['sportsgameodds'],
  nfl: ['parlayapi_nfl', 'sportsgameodds_multisport'],
  cfb: ['parlayapi_cfb', 'sportsgameodds_multisport'],
  soccer_epl: ['parlayapi_soccer', 'propline_2'],
};

/** The real, ordered stack of enabled providers for one job — see JOB_PROVIDER_STACKS. */
export function providersForJob(job: ProviderJob): ProviderAdapter[] {
  return JOB_PROVIDER_STACKS[job]
    .map((id) => getProvider(id))
    .filter((a): a is ProviderAdapter => a != null && a.meta.enabled);
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
    await writePropOdds(
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

  await replaceUnresolvedForProvider(
    id,
    result.unresolved.map((u) => ({ kind: u.kind, rawValue: u.rawValue, context: u.context })),
  );

  return result;
}
