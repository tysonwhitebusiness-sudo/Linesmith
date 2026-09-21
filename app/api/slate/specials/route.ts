/**
 * GET /api/slate/specials?sport=mlb[&league=epl|mls][&date=YYYY-MM-DD]
 *
 * The Slate's Specials (S4) — today's frozen rankings from `slate_rankings`,
 * and the receipts: the last graded slate's top five and a seven-day count.
 *
 * CACHING — pattern 1 (`cachedRoute`). `slate_rankings` has one writer, the
 * Python `slateRankingsJob`, which recomputes a ranking until that sport's
 * first game and then freezes it. The spec's TTL for rankings is "once per
 * slate"; five minutes is short enough to pick up the freeze and the morning's
 * grading without re-reading a table that no longer changes.
 *
 * CACHE KEY — `slate:specials:route:{scope}:{date}`, grepped: unused.
 * IT READS; IT NEVER WRITES.
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { readSpecials, rankingSport } from '@/lib/slate/specials';
import { easternDate } from '@/lib/sports/mlb/statsapi';

export const dynamic = 'force-dynamic';

const TTL_MS = 5 * 60 * 1000;
const SPORTS = new Set(['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer', 'tennis', 'golf']);
const LEAGUES = new Set(['epl', 'mls']);

function parseDate(raw: string | null): string | undefined {
  // Eastern, for the reason SL-19 records: a slate is a US sports day.
  if (raw == null) return easternDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const year = Number(raw.slice(0, 4));
  if (year < 2000 || year > 2100) return undefined;
  return raw;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  if (!SPORTS.has(sport)) return NextResponse.json({ error: 'Unknown sport' }, { status: 400 });
  const league = url.searchParams.get('league');
  if (sport === 'soccer' && league != null && !LEAGUES.has(league)) return NextResponse.json({ error: 'Unknown league' }, { status: 400 });
  const date = parseDate(url.searchParams.get('date'));
  if (date === undefined) return NextResponse.json({ error: 'date must be an ISO date (YYYY-MM-DD)' }, { status: 400 });

  const scope = rankingSport(sport, league);
  return cachedRoute({
    cacheKey: `slate:specials:route:${scope}:${date}`,
    ttlMs: TTL_MS,
    routeName: 'slate/specials',
    errorMessage: 'Specials read failed',
    request,
    build: async () => ({ sport: scope, date, rankings: await readSpecials(scope, date), fetchedAt: new Date().toISOString() }),
  });
}
