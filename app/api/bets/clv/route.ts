/**
 * GET /api/bets/clv[?sport=mlb]
 *
 * Closing Line Value for the signed-in user's own bets — Phase 6.21.
 *
 * The MODEL's CLV already ships at `/api/diagnostics/clv`, computed hourly by
 * the Python worker. This is the same measurement asked about a person's own
 * slip, and it is a per-request read because `bets` is one of the four
 * session-authenticated user tables `docs/table-ownership.md` keeps in
 * TypeScript.
 *
 * CACHING — none, and deliberately not `cachedRoute`. The payload is scoped to
 * one user id, so a shared `snapshot_cache` key would either collide across
 * users or mint a permanent row per user; and a bet's CLV changes as its game
 * approaches its close. `lib/odds/userClv.ts` carries the definition.
 *
 * AUTH mirrors `/api/bets`: middleware blocks unauthenticated requests and this
 * re-checks as defence in depth. A user only ever sees their own rows.
 */

import { NextResponse } from 'next/server';
import { listBets } from '@/lib/db/client';
import { createClient } from '@/lib/supabase/server';
import { computeBetClv, resolveGameStartTimes, summariseClv, type BetForClv } from '@/lib/odds/userClv';

export const dynamic = 'force-dynamic';

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sport = new URL(request.url).searchParams.get('sport') ?? undefined;
  const bets = (await listBets(sport, user.id)) as unknown as BetForClv[];

  // One lookup for every game on the slip rather than one per bet — a slip of
  // twenty legs across four games is four rows, not twenty.
  const starts = await resolveGameStartTimes(bets.map((b) => b.game_id ?? '').filter(Boolean));

  const rows = await Promise.all(
    bets.map((b) => computeBetClv(b, b.game_id ? (starts.get(b.game_id) ?? null) : null)),
  );

  return NextResponse.json({ summary: summariseClv(rows), bets: rows });
}
