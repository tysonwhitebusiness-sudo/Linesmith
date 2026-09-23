/**
 * GET /api/slate/flags?sport=mlb[&league=epl|mls][&date=YYYY-MM-DD]
 *                      [&subject=|&team=|&game=]
 *
 * The research flags (F0) — today's spotlights from `slate_rankings`
 * (`kind='spotlight'`), written by the Python ranking job. With no
 * subject/team/game it returns the whole slate's flags, which is what the
 * Slate's Spotlights section asks for; with one of them it returns just that
 * player's, team's or game's, which is what a research page asks for.
 *
 * CACHING — pattern 1 (`cachedRoute`), with `transform`. The build is the
 * WHOLE sport-day's flags under one key, and the per-page slice happens in
 * `transform`: a player page and the Slate then share one cache entry instead
 * of minting one per athlete id. That is the documented reason `transform`
 * exists (see `app/api/mlb/team-statcast/route.ts`). Five minutes, the same
 * TTL as the Specials, is short enough to pick up the freeze.
 *
 * CACHE KEY — `slate:flags:route:{scope}:{date}`, grepped: unused.
 * IT READS; IT NEVER WRITES.
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { flagScope, selectFlags, type FlagsData } from '@/lib/slate/flags';
import { readFlags } from '@/lib/slate/flagsRead';
import { easternDate } from '@/lib/sports/mlb/statsapi';

export const dynamic = 'force-dynamic';

const TTL_MS = 5 * 60 * 1000;
/** The scopes the ranking job actually writes: soccer AND tennis are per league/tour. */
const SCOPES = new Set(['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer_epl', 'soccer_mls', 'tennis_atp', 'tennis_wta', 'golf']);

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
  const scope = flagScope(url.searchParams.get('sport') ?? '', url.searchParams.get('league'));
  if (!SCOPES.has(scope)) return NextResponse.json({ error: 'Unknown sport' }, { status: 400 });
  const date = parseDate(url.searchParams.get('date'));
  if (date === undefined) return NextResponse.json({ error: 'date must be an ISO date (YYYY-MM-DD)' }, { status: 400 });

  const subject = url.searchParams.get('subject');
  const team = url.searchParams.get('team');
  const game = url.searchParams.get('game');
  // Two subjects would be two different questions with one answer.
  if ([subject, team, game].filter(Boolean).length > 1) {
    return NextResponse.json({ error: 'Ask for one of subject, team or game' }, { status: 400 });
  }

  return cachedRoute<FlagsData>({
    cacheKey: `slate:flags:route:${scope}:${date}`,
    ttlMs: TTL_MS,
    routeName: 'slate/flags',
    errorMessage: 'Flags read failed',
    request,
    build: async () => ({ sport: scope, date, flags: await readFlags(scope, date), fetchedAt: new Date().toISOString() }),
    transform: (payload) => ({ ...payload, flags: selectFlags(payload.flags, { subject, team, game }) }),
  });
}
