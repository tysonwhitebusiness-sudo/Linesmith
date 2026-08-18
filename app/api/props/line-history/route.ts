/**
 * POST /api/props/line-history  { gameId }
 *
 * Tier 2, game-level only (see docs/odds-provider-verification.md's scope
 * correction — OddsPapi's historical endpoint carries no player-prop
 * history either, only game lines). Shares OddsPapi's fixture cooldown with
 * "Check sharp price" — see lib/odds/props/tier2Cooldown.ts.
 */

import { NextResponse } from 'next/server';
import { fetchLineHistory } from '@/lib/odds/props/providers/oddsPapi';
import { loadGameContext } from '@/lib/odds/props/gameContext';
import { monthlyStatus } from '@/lib/odds/props/budget';
import { oddsPapiConfig } from '@/lib/odds/props/config';
import { lastFixtureAction, markFixtureAction } from '@/lib/odds/props/tier2Cooldown';

const COOLDOWN_MS = 15 * 60_000;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { gameId?: string };
  const gameId = body.gameId;
  if (!gameId) return NextResponse.json({ error: 'gameId is required' }, { status: 400 });

  const config = oddsPapiConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: 'OddsPapi is not configured.' }, { status: 409 });
  }

  const budget = monthlyStatus('oddspapi', config.monthlyLimit, config.softCap, 'requests');
  if (budget.exhausted) {
    return NextResponse.json({ error: 'OddsPapi monthly budget is exhausted.', budget }, { status: 429 });
  }

  const last = lastFixtureAction(gameId);
  if (last && Date.now() - last < COOLDOWN_MS) {
    return NextResponse.json(
      { error: 'OddsPapi was just queried for this game — try again shortly.', retryInMs: COOLDOWN_MS - (Date.now() - last) },
      { status: 429 },
    );
  }

  const game = loadGameContext(gameId);
  if (!game) return NextResponse.json({ error: 'Game not found in the current slate.' }, { status: 404 });

  const result = await fetchLineHistory(game);
  markFixtureAction(gameId);
  return NextResponse.json(result);
}
