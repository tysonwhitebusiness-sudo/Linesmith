/**
 * Proactive SportsGameOdds refresh — Tier 2 by billing model, but scheduled
 * anyway (unlike Tier 1's SharpAPI/Odds-API.io vs. Tier 2's OddsPapi split in
 * tier1Refresh.ts's header comment) because its 2,500 objects/month budget
 * was sitting almost entirely unspent under click-only "More books" (2
 * objects used in the account's first five days). SportsGameOdds is the only
 * provider carrying 11 of the app's 19 tracked prop markets — walks, both
 * strikeout types, triples, singles, stolen bases, pitcher hits-allowed/
 * outs/win/walks-allowed, first HR — so scheduling it is what actually closes
 * those market gaps instead of waiting for a button click that wasn't
 * happening. Runs on its own, much slower interval than Tier 1 (see
 * `lib/scheduler.ts`) — these markets don't need live-tick freshness, and a
 * slow cadence keeps a full slate's spend well under the monthly soft cap.
 *
 * Shares the same `provider_usage` budget row as `/api/props/more-books`
 * (both call `monthlyStatus`/`recordMonthlySpend('sportsgameodds', ...)`), so
 * a manual click and this proactive sweep draw from one real total, not two.
 */

import { runProviderFetch } from './registry';
import { loadAllGameContexts } from './gameContext';
import { monthlyStatus, recordMonthlySpend, withinPerMinuteRate } from './budget';
import { sportsGameOddsConfig } from './config';
import { isGameFinal } from './gameState';

export interface SportsGameOddsRefreshSummary {
  gamesRefreshed: number;
  rowsWritten: number;
  warnings: string[];
  skipped: string[];
}

export async function refreshSportsGameOdds(): Promise<SportsGameOddsRefreshSummary> {
  const summary: SportsGameOddsRefreshSummary = { gamesRefreshed: 0, rowsWritten: 0, warnings: [], skipped: [] };

  const config = sportsGameOddsConfig();
  if (!config.enabled) {
    summary.warnings.push('SportsGameOdds is not configured.');
    return summary;
  }

  const games = await loadAllGameContexts();
  // Tracked locally and advanced after every spend, same reasoning as
  // tier1Refresh.ts's oddsApiIoSpentToday — a status snapshot read once at
  // the top of the loop would go stale after the first fetch and let a
  // slate-wide sweep run past the soft cap before the next status check.
  let spentThisRun = (await monthlyStatus('sportsgameodds', config.monthlyLimit, config.softCap, 'objects')).used;

  for (const game of games) {
    if (await isGameFinal(game.gameId)) {
      summary.skipped.push(`${game.gameId} (final)`);
      continue;
    }
    if (spentThisRun >= config.softCap) {
      summary.warnings.push(
        `SportsGameOdds soft cap reached (${spentThisRun}/${config.softCap} objects this month) — pausing proactive refresh until next month or a higher cap.`,
      );
      summary.skipped.push(`${game.gameId} (soft cap)`);
      continue;
    }
    // Matches multiSportRefresh.ts's refreshWithSportsGameOdds — this
    // adapter does no caching of its own (unlike SharpAPI), so every game in
    // this loop is a real network call and the per-minute limit is a
    // genuine risk on a slate with more concurrent games than the
    // provider's per-minute allowance.
    if (!withinPerMinuteRate('sportsgameodds', config.ratePerMin)) {
      summary.skipped.push(`${game.gameId} (rate limit — will pick up next cycle)`);
      continue;
    }

    const result = await runProviderFetch('sportsgameodds', game);
    summary.rowsWritten += result.rows.length;
    summary.warnings.push(...result.warnings);

    const objects = result.cost.objects ?? 0;
    if (objects > 0) {
      await recordMonthlySpend('sportsgameodds', 0, objects);
      spentThisRun += objects;
    }
    summary.gamesRefreshed += 1;
  }

  return summary;
}
