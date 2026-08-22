/**
 * POST /api/props/more-books  { gameId }
 *
 * Tier 2, user-triggered only (update-09 § 3). Merges SportsGameOdds rows
 * alongside whatever Tier 1 already has — never replaces — so "N books"
 * counts and best-price comparisons see everything fetched.
 */

import { NextResponse } from 'next/server';
import { runProviderFetch } from '@/lib/odds/props/registry';
import { loadGameContext } from '@/lib/odds/props/gameContext';
import { lastPropFetch, readPropOddsForGame } from '@/lib/db/client';
import { monthlyStatus, recordMonthlySpend } from '@/lib/odds/props/budget';
import { sportsGameOddsConfig } from '@/lib/odds/props/config';
import { isGameFinal } from '@/lib/odds/props/gameState';

const COOLDOWN_MS = 5 * 60_000;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { gameId?: string };
  const gameId = body.gameId;
  if (!gameId) return NextResponse.json({ error: 'gameId is required' }, { status: 400 });

  const config = sportsGameOddsConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: 'SportsGameOdds is not configured.' }, { status: 409 });
  }

  if (await isGameFinal(gameId)) {
    return NextResponse.json({ error: 'This game is final — More Books is disabled.' }, { status: 409 });
  }

  const budget = await monthlyStatus('sportsgameodds', config.monthlyLimit, config.softCap, 'objects');
  if (budget.exhausted) {
    return NextResponse.json({ error: 'SportsGameOdds monthly budget is exhausted.', budget }, { status: 429 });
  }

  const last = await lastPropFetch('sportsgameodds', gameId);
  if (last && Date.now() - Date.parse(last) < COOLDOWN_MS) {
    const retryInMs = COOLDOWN_MS - (Date.now() - Date.parse(last));
    return NextResponse.json(
      { error: 'More Books was just fetched for this game — try again shortly.', retryInMs },
      { status: 429 },
    );
  }

  const game = await loadGameContext(gameId);
  if (!game) return NextResponse.json({ error: 'Game not found in the current slate.' }, { status: 404 });

  const result = await runProviderFetch('sportsgameodds', game);
  const objects = result.cost.objects ?? 0;
  await recordMonthlySpend('sportsgameodds', 0, objects);

  return NextResponse.json({
    rowsAdded: result.rows.length,
    warnings: result.warnings,
    budget: await monthlyStatus('sportsgameodds', config.monthlyLimit, config.softCap, 'objects'),
    rows: await readPropOddsForGame(gameId),
  });
}
