/**
 * GET /api/tennis/archive?tour=atp&name=Carlos%20Alcaraz
 *
 * One player's TennisMyLife matches — surface, level, round, rank, aces and the
 * serve columns — for the player page's "Surface & serve" section (R6.4).
 * `player_game_history` stores eight keys for tennis and none of those, so the
 * section cannot be built from the page's own history.
 *
 * CACHING — pattern 1 (`cachedRoute`), per CLAUDE.md. Six hours, matching the
 * TTL `fetchSeasonRows` already applies to each season's CSV underneath: the
 * archive is republished after tournaments, not during them.
 *
 * CACHE KEY: `tennis:archive:{tour}:{name}` — grepped before choosing; the
 * existing keys are `tennis:tml:v2:{tour}:{season}` (the raw CSVs). The name is
 * bounded in shape and length before it reaches a key (task 3.5).
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { getTennisArchive } from '@/lib/sports/tennis/playerArchive';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Letters (accented included), spaces, apostrophes, hyphens and dots. */
const NAME = /^[\p{L}][\p{L} .'’-]{1,47}$/u;

export async function GET(request: Request) {
  const url = new URL(request.url);

  const tour = url.searchParams.get('tour') ?? 'atp';
  if (tour !== 'atp' && tour !== 'wta') {
    return NextResponse.json({ error: "tour must be 'atp' or 'wta'" }, { status: 400 });
  }

  const name = (url.searchParams.get('name') ?? '').trim();
  if (!NAME.test(name)) {
    return NextResponse.json({ error: 'name must be a player name' }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `tennis:archive:${tour}:${name.toLowerCase()}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'tennis/archive',
    build: () => getTennisArchive(tour, name),
    errorMessage: 'Tennis archive lookup failed',
    request,
  });
}
