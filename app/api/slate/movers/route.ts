/**
 * GET /api/slate/movers?sport=mlb[&league=][&tour=][&date=]
 *
 * The Slate's Movers card (MV3): consensus line movement on the games that
 * have not started, for game lines and props. The rules are in
 * `lib/slate/marketMoves.ts` (pre-game only, net first → latest, the median
 * of ≥3 books, exchanges and pick'em out) and pinned in
 * `tests/slate-shell.test.ts`.
 *
 * A SEPARATE ROUTE, for the reason `/api/slate/market` is one: the prop read
 * takes up to three seconds on a busy MLB slate, and the Games section must
 * not wait for it.
 *
 * CACHING — pattern 1 (`cachedRoute`). Both history tables are written by the
 * Python odds worker, never by a request. 120 s is the spec's own TTL for
 * lines and props. Key `slate:movers:route:{scope}:{date}`, grepped: unused.
 * IT READS; IT NEVER WRITES.
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { readSnapshotCache } from '@/lib/db/client';
import { readConsensusMovers, type MoverGame } from '@/lib/slate/marketMoves';
import type { SlateGame } from '@/lib/odds/matching';
import { easternDate } from '@/lib/sports/mlb/statsapi';

export const dynamic = 'force-dynamic';

const TTL_MS = 120 * 1000;

const SPORTS = new Set(['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer', 'tennis']);
const LEAGUES = new Set(['epl', 'mls']);
const TOURS = new Set(['atp', 'wta']);

function parseDate(raw: string | null): string | undefined {
  if (raw == null) return easternDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const year = Number(raw.slice(0, 4));
  if (year < 2000 || year > 2100) return undefined;
  return raw;
}

function snapshotKey(sport: string, league: string | null, tour: string | null): string {
  if (sport === 'soccer') return `soccer:snapshot:${league ?? 'epl'}`;
  if (sport === 'tennis') return `tennis:snapshot:${tour ?? 'atp'}`;
  return `${sport}:snapshot`;
}

/** The slate's games that have not started, on its Eastern day. */
async function upcomingGames(key: string, date: string): Promise<MoverGame[]> {
  const cached = await readSnapshotCache(key);
  if (!cached) return [];
  try {
    const games = (JSON.parse(cached.payload)?.context?.other?.games ?? []) as SlateGame[];
    return games
      .filter((g) => g.gamePk != null && g.firstPitch && easternDate(new Date(g.firstPitch)) === date && Date.parse(g.firstPitch) > Date.now())
      .map((g) => ({ id: String(g.gamePk), startsAt: g.firstPitch!, matchup: g.matchup ?? null }));
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  // Golf is not here on purpose: its winner prices are cached, not stored as
  // history, so there is nothing to have moved (spec §4.8).
  if (!SPORTS.has(sport)) return NextResponse.json({ error: 'No Movers for this sport' }, { status: 400 });
  const league = url.searchParams.get('league');
  // The client sends one value as both `league` and `tour`; each is checked
  // only for the sport that has it.
  if (sport === 'soccer' && league != null && !LEAGUES.has(league)) return NextResponse.json({ error: 'Unknown league' }, { status: 400 });
  const tour = url.searchParams.get('tour');
  if (sport === 'tennis' && tour != null && !TOURS.has(tour)) return NextResponse.json({ error: 'Unknown tour' }, { status: 400 });
  const date = parseDate(url.searchParams.get('date'));
  if (date === undefined) return NextResponse.json({ error: 'date must be an ISO date (YYYY-MM-DD)' }, { status: 400 });

  const scope = sport === 'soccer' ? `soccer_${league ?? 'epl'}` : sport === 'tennis' ? `tennis_${tour ?? 'atp'}` : sport;

  return cachedRoute({
    cacheKey: `slate:movers:route:${scope}:${date}`,
    ttlMs: TTL_MS,
    routeName: 'slate/movers',
    errorMessage: 'Movers read failed',
    request,
    build: async () => {
      const games = await upcomingGames(snapshotKey(sport, league, tour), date);
      const [lines, props] = await Promise.all([readConsensusMovers('lines', games), readConsensusMovers('props', games)]);
      return { sport: scope, date, games: games.length, lines, props, fetchedAt: new Date().toISOString() };
    },
  });
}
