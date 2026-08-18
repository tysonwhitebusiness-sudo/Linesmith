/**
 * POST /api/props/scan-player  { gameId }
 *
 * A player-page "Scan" action. Tier 1 only (SharpAPI + Odds-API.io) — free,
 * so no budget guard is needed the way the Tier 2 routes need one.
 *
 * Scoped to the player's *game*, not the player alone: none of the five
 * providers support fetching a single player's props (SharpAPI and
 * Odds-API.io both return the whole game's board in one call), so "scan
 * this player" really means "refresh this player's game right now, instead
 * of waiting for the ambient ~3-minute cycle" — `/api/props/lines` already
 * shows just that player's slice once the game's rows are current. Bypasses
 * the passive TTL in `/api/props/lines` (this is an explicit user action,
 * not an implicit render-triggered fetch — update-09 §7's rule is about the
 * latter).
 */

import { NextResponse } from 'next/server';
import { refreshTier1 } from '@/lib/odds/props/tier1Refresh';
import { readPropOddsForGame } from '@/lib/db/client';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { gameId?: string };
  const gameId = body.gameId;
  if (!gameId) return NextResponse.json({ error: 'gameId is required' }, { status: 400 });

  const summary = await refreshTier1(gameId);
  return NextResponse.json({ summary, rows: readPropOddsForGame(gameId) });
}
