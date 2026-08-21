/**
 * Proactive refresh for the four non-MLB sports (NFL, CFB, Soccer/EPL,
 * Tennis), mirroring tier1Refresh.ts's job for MLB but sourced from
 * multiSportGameContext.ts (ESPN-derived, no snapshot cache) instead of the
 * MLB snapshot. One function per sport rather than one big generic loop —
 * each sport has a different provider mix and budget identity per the
 * odds-stack plan, so keeping them distinct makes the per-sport cadence/
 * provider choice explicit at the call site (lib/scheduler.ts).
 *
 * Rewired 2026-08-20 (see docs/api-capability-audit-2026-08-20.md) onto
 * per-sport ParlayAPI keys (parlayapi_nfl/cfb/soccer) and a dedicated
 * SportsGameOdds account (sportsgameodds_multisport) — real, separate free
 * accounts replacing the shared parlayapi/sportsgameodds keys' role here, so
 * NFL/CFB/Soccer spend no longer competes with each other or with MLB.
 * Matches Python's job_nfl/job_cfb/job_soccer_epl (jobs.py), which already
 * proved this shape live. Soccer/EPL now also gets ParlayAPI (confirmed real
 * coverage, 787 rows) alongside Propline, not just Propline alone.
 */

import { runProviderFetch } from './registry';
import { loadGameContextsForSport } from './multiSportGameContext';
import { monthlyStatus, recordMonthlySpend, withinPerMinuteRate } from './budget';
import { parlayApiNflConfig, parlayApiCfbConfig, parlayApiSoccerConfig, sportsGameOddsMultisportConfig } from './config';
import type { ProviderConfig } from './config';
import type { FetchResult, ProviderId, SportKey } from './types';

export interface MultiSportRefreshSummary {
  sport: SportKey;
  gamesRefreshed: number;
  rowsWritten: number;
  warnings: string[];
  skipped: string[];
  /** Unresolved player/market/bookmaker rows — surfaced for debugging, never silently dropped. */
  unresolved: Array<{ kind: string; rawValue: string; context?: string }>;
}

function newSummary(sport: SportKey): MultiSportRefreshSummary {
  return { sport, gamesRefreshed: 0, rowsWritten: 0, warnings: [], skipped: [], unresolved: [] };
}

function absorb(summary: MultiSportRefreshSummary, result: FetchResult): void {
  summary.rowsWritten += result.rows.length;
  summary.warnings.push(...result.warnings);
  summary.unresolved.push(...result.unresolved);
}

const PARLAYAPI_SPORT_CONFIG: Record<
  'nfl' | 'cfb' | 'soccer_epl',
  { id: ProviderId; getConfig: () => ProviderConfig & { monthlyLimit: number; softCap: number } }
> = {
  nfl: { id: 'parlayapi_nfl', getConfig: parlayApiNflConfig },
  cfb: { id: 'parlayapi_cfb', getConfig: parlayApiCfbConfig },
  soccer_epl: { id: 'parlayapi_soccer', getConfig: parlayApiSoccerConfig },
};

async function refreshWithParlayApi(sport: 'nfl' | 'cfb' | 'soccer_epl'): Promise<MultiSportRefreshSummary> {
  const summary = newSummary(sport);
  const { id, getConfig } = PARLAYAPI_SPORT_CONFIG[sport];
  const config = getConfig();
  if (!config.enabled) {
    summary.warnings.push(`${id} is not configured.`);
    return summary;
  }

  const budget = await monthlyStatus(id, config.monthlyLimit, config.softCap);
  if (budget.exhausted) {
    summary.warnings.push(`${id} monthly budget exhausted — skipping.`);
    return summary;
  }

  const games = await loadGameContextsForSport(sport);
  for (const game of games) {
    const result = await runProviderFetch(id, game);
    absorb(summary, result);
    const spent = result.cost.requests ?? 0;
    if (spent > 0) await recordMonthlySpend(id, spent, 0);
    summary.gamesRefreshed += 1;
  }
  return summary;
}

/** NFL/CFB only — SportsGameOdds has no real Soccer/EPL coverage (its soccer leagues are MLS/UCL), see the capability audit. */
async function refreshWithSportsGameOddsMultisport(sport: 'nfl' | 'cfb'): Promise<MultiSportRefreshSummary> {
  const summary = newSummary(sport);
  const config = sportsGameOddsMultisportConfig();
  if (!config.enabled) {
    summary.warnings.push('sportsgameodds_multisport is not configured.');
    return summary;
  }

  const budget = await monthlyStatus('sportsgameodds_multisport', config.monthlyLimit, config.softCap, 'objects');
  let spentThisRun = budget.used;

  const games = await loadGameContextsForSport(sport);
  for (const game of games) {
    if (spentThisRun >= config.softCap) {
      summary.warnings.push(`SportsGameOdds soft cap reached (${spentThisRun}/${config.softCap}) — pausing.`);
      summary.skipped.push(`${game.gameId} (soft cap)`);
      continue;
    }
    if (!withinPerMinuteRate('sportsgameodds_multisport', config.ratePerMin)) {
      summary.skipped.push(`${game.gameId} (rate limit — will pick up next cycle)`);
      continue;
    }
    const result = await runProviderFetch('sportsgameodds_multisport', game);
    absorb(summary, result);
    const objects = result.cost.objects ?? 0;
    if (objects > 0) {
      await recordMonthlySpend('sportsgameodds_multisport', 0, objects);
      spentThisRun += objects;
    }
    summary.gamesRefreshed += 1;
  }
  return summary;
}

async function refreshOneProvider(sport: SportKey, providerId: ProviderId, budgetUnit: 'requests' | 'objects'): Promise<MultiSportRefreshSummary> {
  const summary = newSummary(sport);
  const games = sport === 'mlb' ? [] : await loadGameContextsForSport(sport);
  for (const game of games) {
    const result = await runProviderFetch(providerId, game);
    absorb(summary, result);
    const spent = budgetUnit === 'objects' ? (result.cost.objects ?? 0) : (result.cost.requests ?? 0);
    if (spent > 0) await recordMonthlySpend(providerId, budgetUnit === 'requests' ? spent : 0, budgetUnit === 'objects' ? spent : 0);
    summary.gamesRefreshed += 1;
  }
  return summary;
}

/** NFL: ParlayAPI (dedicated key) + SportsGameOdds (dedicated multisport account). */
export async function refreshNfl(): Promise<MultiSportRefreshSummary[]> {
  return Promise.all([refreshWithParlayApi('nfl'), refreshWithSportsGameOddsMultisport('nfl')]);
}

/** CFB: ParlayAPI (dedicated key) + SportsGameOdds (dedicated multisport account). */
export async function refreshCfb(): Promise<MultiSportRefreshSummary[]> {
  return Promise.all([refreshWithParlayApi('cfb'), refreshWithSportsGameOddsMultisport('cfb')]);
}

/**
 * Soccer/EPL: ParlayAPI (dedicated key, real coverage confirmed 2026-08-20 —
 * 787 rows) + Propline (second key, proven live). SportsGameOdds covers
 * MLS/UCL separately, not EPL, so it's not in this stack.
 */
export async function refreshSoccerEpl(): Promise<MultiSportRefreshSummary[]> {
  return Promise.all([refreshWithParlayApi('soccer_epl'), refreshOneProvider('soccer_epl', 'propline_2', 'requests')]);
}

/** Tennis: SharpAPI is already the proven primary (existing MLB-shaped adapter, not part of this multi-sport module). */
