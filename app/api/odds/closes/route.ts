/**
 * GET /api/odds/closes?sport=mlb&games=823409@2026-09-24T23:05:00Z,…
 *
 * The team page's "Against the closing number" (odds build P8, O3): each
 * game's consensus closing spread and total — per book the last full-game
 * main price at or before the start, then the line most books closed at
 * (`lib/db/oddsRead.ts` `readGameCloses`). History is hot for ten days, so
 * an older game reads as no close.
 *
 * CACHING — pattern 2 (CLAUDE.md): direct reads of `game_lines_history` and
 * `game_lines`, which the P6 bridge and the worker keep fresh out of band. A
 * past game's close never changes. IT READS; IT NEVER WRITES.
 */
import { NextResponse } from 'next/server';
import { readGameCloses } from '@/lib/db/oddsRead';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  const games = (url.searchParams.get('games') ?? '').split(',').filter(Boolean).map(s => {
    const [gameId, start] = s.split('@');
    return { gameId, start };
  });
  if (!/^[a-z_]{2,16}$/.test(sport) || !games.length || games.length > 20
      || games.some(g => !/^[A-Za-z0-9_.:-]{1,64}$/.test(g.gameId ?? '') || Number.isNaN(Date.parse(g.start ?? '')))) {
    return NextResponse.json({ error: 'sport and games (id@startISO, at most 20) are required' }, { status: 400 });
  }
  try {
    return NextResponse.json({ closes: await readGameCloses(sport, games) });
  } catch (e) {
    console.error('[odds/closes]', e);
    return NextResponse.json({ error: 'Closes read failed' }, { status: 500 });
  }
}
