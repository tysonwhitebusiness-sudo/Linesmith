/**
 * GET /api/slate/market?sport=mlb[&league=][&tour=][&date=]
 *
 * The Slate's two market-shape cards: Price outliers and Line disagreements.
 *
 * A SEPARATE ROUTE FROM `/api/slate` ON PURPOSE. These two queries take two to
 * six seconds against the real tables (591,923 current quotes), and the Games
 * section takes a quarter of one. Putting them together would make the top of
 * the page wait for the bottom of it, which is the problem `/api/slate` exists
 * to solve.
 *
 * WHAT IS NOT HERE: Movers. S2's third card is not built, and the reason is
 * measured rather than assumed — see the ledger row SL-18 and queue row Q9.
 * The movement data is real (3,769 moved game lines and 120,495 moved prop
 * lines in 36 hours), but every one of the largest moves, at every threshold
 * tried, is one of two books quoting badly rather than a market changing its
 * mind. A card that puts "Fanatics moved 25 points" at the top of the page
 * every time is worse than no card.
 *
 * CACHING — pattern 1 (`cachedRoute`). Both tables are written by the Python
 * odds worker, never by a request. 120 s is the spec's own TTL for lines and
 * props. Key `slate:market:route:{scope}:{date}`, grepped: nothing used it.
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { readSnapshotCache } from '@/lib/db/client';
import { readPriceOutliers, readLineDisagreements } from '@/lib/slate/marketMoves';
import type { SlateGame } from '@/lib/odds/matching';
import { easternDate } from '@/lib/sports/mlb/statsapi';

export const dynamic = 'force-dynamic';

const TTL_MS = 120 * 1000;

const SPORTS = new Set(['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer', 'tennis', 'golf']);
const LEAGUES = new Set(['epl', 'mls']);
const TOURS = new Set(['atp', 'wta']);

function parseDate(raw: string | null): string | undefined {
  // EASTERN, not UTC. A slate is a US sports day: at 03:00 UTC it is still
  // 23:00 the previous evening in New York and the same slate is still being
  // played. Defaulting to `toISOString()` emptied every Games section the
  // moment the clock passed midnight UTC — found by rendering at 23:06 ET.
  if (raw == null) return easternDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const year = Number(raw.slice(0, 4));
  if (year < 2000 || year > 2100) return undefined;
  return raw;
}

async function slateGameIds(key: string): Promise<string[]> {
  const cached = await readSnapshotCache(key);
  if (!cached) return [];
  try {
    const snapshot = JSON.parse(cached.payload);
    return ((snapshot?.context?.other?.games ?? []) as SlateGame[]).map((g) => String(g.gamePk ?? '')).filter(Boolean);
  } catch {
    return [];
  }
}

function snapshotKey(sport: string, league: string | null, tour: string | null): string {
  if (sport === 'soccer') return `soccer:snapshot:${league ?? 'epl'}`;
  if (sport === 'tennis') return `tennis:snapshot:${tour ?? 'atp'}`;
  return `${sport}:snapshot`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  if (!SPORTS.has(sport)) {
    return NextResponse.json({ error: `Unknown sport. Expected one of: ${[...SPORTS].join(', ')}` }, { status: 400 });
  }
  const league = url.searchParams.get('league');
  if (sport === 'soccer' && league != null && !LEAGUES.has(league)) {
    return NextResponse.json({ error: 'Unknown league' }, { status: 400 });
  }
  const tour = url.searchParams.get('tour');
  if (sport === 'tennis' && tour != null && !TOURS.has(tour)) {
    return NextResponse.json({ error: 'Unknown tour' }, { status: 400 });
  }
  const date = parseDate(url.searchParams.get('date'));
  if (date === undefined) return NextResponse.json({ error: 'date must be an ISO date (YYYY-MM-DD)' }, { status: 400 });

  const scope = sport === 'soccer' ? `soccer_${league ?? 'epl'}` : sport === 'tennis' ? `tennis_${tour ?? 'atp'}` : sport;

  return cachedRoute({
    cacheKey: `slate:market:route:${scope}:${date}`,
    ttlMs: TTL_MS,
    routeName: 'slate/market',
    errorMessage: 'Market read failed',
    request,
    build: async () => {
      const ids = await slateGameIds(snapshotKey(sport, league, tour));
      const [outliers, disagreements] = await Promise.all([readPriceOutliers(ids, 12), readLineDisagreements(ids, 12)]);
      return { sport: scope, date, outliers, disagreements, fetchedAt: new Date().toISOString() };
    },
  });
}
