/**
 * GET /api/picks/bankroll?sport=nfl — Phase 7 of docs/daily-picks-full-
 * model-build-2026-08-27.md: the four real dollar P&L numbers per sport
 * (games, player props, rare markets, and a combined total) a simulated
 * flat $10 bet on every locked/graded pick would have produced. Kept
 * separate on purpose — a real, deliberate product decision (see the
 * gameplan doc): blending them into one number would hide which model,
 * if any, is actually profitable.
 */

import { NextResponse } from 'next/server';
import { gamesPnlForSport, propsPnlForSport } from '@/lib/db/client';
import { RARE_MARKET_DIMENSIONS } from '@/lib/picks/rareMarketDimensions';
import type { Sport } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const sport = (new URL(request.url).searchParams.get('sport') ?? '') as Sport;
  if (!sport || !(sport in RARE_MARKET_DIMENSIONS)) {
    return NextResponse.json({ error: 'sport query param required' }, { status: 400 });
  }
  const rareDimensions = RARE_MARKET_DIMENSIONS[sport];

  const [games, playerProps, rareMarkets] = await Promise.all([
    gamesPnlForSport(sport),
    propsPnlForSport(sport, { exclude: rareDimensions }),
    rareDimensions.length > 0 ? propsPnlForSport(sport, { only: rareDimensions }) : Promise.resolve({ wins: 0, losses: 0, profit: 0 }),
  ]);

  return NextResponse.json({
    games,
    playerProps,
    rareMarkets,
    total: {
      wins: games.wins + playerProps.wins + rareMarkets.wins,
      losses: games.losses + playerProps.losses + rareMarkets.losses,
      profit: games.profit + playerProps.profit + rareMarkets.profit,
    },
  });
}
