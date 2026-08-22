/**
 * POST /api/props/sharp-price  { gameId }
 *
 * Tier 2, user-triggered only. Game-level per the Phase 0 scope correction
 * (docs/odds-provider-verification.md) — OddsPapi has no MLB player-prop
 * data, so this surfaces Pinnacle's moneyline against the game's other
 * books, not a per-prop comparison. Framed as a sanity-check data point, not
 * an edge calculation (update-09 § 3).
 */

import { NextResponse } from 'next/server';
import { fetchSharpPrice } from '@/lib/odds/props/providers/oddsPapi';
import { loadGameContext } from '@/lib/odds/props/gameContext';
import { monthlyStatus } from '@/lib/odds/props/budget';
import { oddsPapiConfig } from '@/lib/odds/props/config';
import { isGameFinal } from '@/lib/odds/props/gameState';
import { lastFixtureAction, markFixtureAction } from '@/lib/odds/props/tier2Cooldown';

// Longer cooldown than SportsGameOdds — the budget is ~10x tighter (250 vs 2,500/mo).
const COOLDOWN_MS = 15 * 60_000;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { gameId?: string };
  const gameId = body.gameId;
  if (!gameId) return NextResponse.json({ error: 'gameId is required' }, { status: 400 });

  const config = oddsPapiConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: 'OddsPapi is not configured.' }, { status: 409 });
  }
  if (await isGameFinal(gameId)) {
    return NextResponse.json({ error: 'This game is final — Check Sharp Price is disabled.' }, { status: 409 });
  }

  const budget = await monthlyStatus('oddspapi', config.monthlyLimit, config.softCap, 'requests');
  if (budget.exhausted) {
    return NextResponse.json({ error: 'OddsPapi monthly budget is exhausted.', budget }, { status: 429 });
  }

  // "sharp-price" and "line-history" share OddsPapi's one fixture-scoped
  // budget, so the cooldown key covers both actions against the same game.
  const last = lastFixtureAction(gameId);
  if (last && Date.now() - last < COOLDOWN_MS) {
    return NextResponse.json(
      { error: 'Sharp price was just checked for this game — try again shortly.', retryInMs: COOLDOWN_MS - (Date.now() - last) },
      { status: 429 },
    );
  }

  const game = await loadGameContext(gameId);
  if (!game) return NextResponse.json({ error: 'Game not found in the current slate.' }, { status: 404 });

  const result = await fetchSharpPrice(game);
  markFixtureAction(gameId);
  return NextResponse.json(result);
}
