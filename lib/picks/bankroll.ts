/**
 * Real dollar P&L on a simulated flat $10 bet — Phase 1 (games) and
 * Phase 7 (player props / rare markets) of docs/daily-picks-full-model-
 * build-2026-08-27.md share this exact formula. Pulled out of
 * app/api/picks/game-history/route.ts (where it first landed) into one
 * shared place so game/prop/rare-market P&L can never compute this
 * differently from each other.
 */
import { americanToDecimalOdds } from '@/lib/core/kelly';

/** `outcome === 'push'` isn't a real value this app's tables produce today, so only 'win'/'loss'/null are handled; a push (not currently modeled) falls through to null, same as ungraded. */
export function simulatedProfit(price: number | null, outcome: 'win' | 'loss' | null): number | null {
  if (price == null || outcome == null) return null;
  if (outcome === 'loss') return -10;
  return 10 * (americanToDecimalOdds(price) - 1);
}
