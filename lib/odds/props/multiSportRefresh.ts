/**
 * Proactive refresh for the four non-MLB sports (NFL, CFB, Soccer/EPL,
 * Tennis), mirroring tier1Refresh.ts's job for MLB but sourced from
 * multiSportGameContext.ts (ESPN-derived, no snapshot cache) instead of the
 * MLB snapshot. One function per sport rather than one big generic loop —
 * each sport has a different provider mix and budget identity per the
 * odds-stack plan, so keeping them distinct makes the per-sport cadence/
 * provider choice explicit at the call site (lib/scheduler.ts).
 */

import { runProviderFetch } from './registry';
import { loadGameContextsForSport } from './multiSportGameContext';
import { monthlyStatus, recordMonthlySpend, withinPerMinuteRate } from './budget';
import { parlayApiConfig, sportsGameOddsConfig } from './config';
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

async function refreshWithParlayApi(sport: Exclude<SportKey, 'mlb'>): Promise<MultiSportRefreshSummary> {
  const summary = newSummary(sport);
  const config = parlayApiConfig();
  if (!config.enabled) {
    summary.warnings.push('ParlayAPI is not configured.');
    return summary;
  }

  const budget = monthlyStatus('parlayapi', config.monthlyLimit, config.softCap);
  if (budget.exhausted) {
    summary.warnings.push('ParlayAPI monthly budget exhausted — skipping.');
    return summary;
  }

  const games = await loadGameContextsForSport(sport);
  for (const game of games) {
    const result = await runProviderFetch('parlayapi', game);
    absorb(summary, result);
    const spent = result.cost.requests ?? 0;
    if (spent > 0) recordMonthlySpend('parlayapi', spent, 0);
    summary.gamesRefreshed += 1;
  }
  return summary;
}

async function refreshWithSportsGameOdds(sport: 'nfl' | 'cfb' | 'soccer_epl'): Promise<MultiSportRefreshSummary> {
  const summary = newSummary(sport);
  const config = sportsGameOddsConfig();
  if (!config.enabled) {
    summary.warnings.push('SportsGameOdds is not configured.');
    return summary;
  }

  const budget = monthlyStatus('sportsgameodds', config.monthlyLimit, config.softCap, 'objects');
  let spentThisRun = budget.used;

  const games = await loadGameContextsForSport(sport);
  for (const game of games) {
    if (spentThisRun >= config.softCap) {
      summary.warnings.push(`SportsGameOdds soft cap reached (${spentThisRun}/${config.softCap}) — pausing.`);
      summary.skipped.push(`${game.gameId} (soft cap)`);
      continue;
    }
    if (!withinPerMinuteRate('sportsgameodds', config.ratePerMin)) {
      summary.skipped.push(`${game.gameId} (rate limit — will pick up next cycle)`);
      continue;
    }
    const result = await runProviderFetch('sportsgameodds', game);
    absorb(summary, result);
    const objects = result.cost.objects ?? 0;
    if (objects > 0) {
      recordMonthlySpend('sportsgameodds', 0, objects);
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
    if (spent > 0) recordMonthlySpend(providerId, budgetUnit === 'requests' ? spent : 0, budgetUnit === 'objects' ? spent : 0);
    summary.gamesRefreshed += 1;
  }
  return summary;
}

/** NFL: ParlayAPI (primary) + SportsGameOdds (secondary, re-verify once regular season starts). */
export async function refreshNfl(): Promise<MultiSportRefreshSummary[]> {
  return Promise.all([refreshWithParlayApi('nfl'), refreshWithSportsGameOdds('nfl')]);
}

/** CFB: ParlayAPI + SportsGameOdds, both proven live this session. */
export async function refreshCfb(): Promise<MultiSportRefreshSummary[]> {
  return Promise.all([refreshWithParlayApi('cfb'), refreshWithSportsGameOdds('cfb')]);
}

/** Soccer/EPL: Propline (second key, proven live) primary; SportsGameOdds covers MLS/UCL separately (not EPL). */
export async function refreshSoccerEpl(): Promise<MultiSportRefreshSummary> {
  return refreshOneProvider('soccer_epl', 'propline_2', 'requests');
}

/** Tennis: SharpAPI is already the proven primary (existing MLB-shaped adapter, not part of this multi-sport module). */
