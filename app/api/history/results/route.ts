/**
 * GET /api/history/results?sport=nfl[&teamId=13][&from=2023-01-01][&to=…]
 *
 * De-duplicated real results from `game_result`, through the one read module
 * (`lib/history/gameResults.ts`). Every page that wants a record, a form
 * streak or a results list reads this rather than counting rows itself —
 * counting rows is how a team page showed home and away records totalling 13
 * games each under a 0-0 season (F-B2).
 *
 * CACHING — pattern 1 (`cachedRoute`), per CLAUDE.md. `game_result` is
 * written by Python ingest jobs and by the archival bridge, not by requests,
 * so a request never needs a fresh read. The TTL is one day because a
 * finished game never changes; the only thing that moves the answer is a new
 * game finishing, and the sports that play daily still only add one row per
 * team per day. A page opened during a game sees yesterday's results, which
 * is what a results list is.
 *
 * CACHE KEY — `history:results:route:{sport}:{teamId}:{from}:{to}`, grepped
 * before it was chosen, per CLAUDE.md's warning about the flat
 * `snapshot_cache` namespace: nothing in `lib/` or `app/` used a
 * `history:results` prefix. The route's own segment (`:route:`) is in the key
 * for the reason `golf:schedule:route:` carries one — so it can never collide
 * with a constituent function that caches its own differently-shaped answer
 * under the bare name.
 *
 * EVERY PARAMETER IS BOUNDED BEFORE IT REACHES THE KEY (task 3.5's lesson: an
 * unbounded id mints a permanent cache row per value). Sport is checked
 * against the real list, dates must parse as ISO dates in a sane range, and
 * `teamId` is length-capped and character-restricted.
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { readGameResults } from '@/lib/history/gameResults';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** `game_result.sport`'s own vocabulary — soccer and tennis are split, as they are in the table. */
const SPORTS = new Set(['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer_epl', 'soccer_mls', 'tennis_atp', 'tennis_wta']);

const DEFAULT_FROM = '2023-01-01';

function parseDate(raw: string | null): string | null | undefined {
  if (raw == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const t = Date.parse(`${raw}T00:00:00Z`);
  if (Number.isNaN(t)) return undefined;
  const year = Number(raw.slice(0, 4));
  if (year < 1990 || year > 2100) return undefined;
  return raw;
}

/** Team ids are short source-native strings ("13", "LV", an ESPN numeric id) — anything else is not one. */
function parseTeamId(raw: string | null): string | null | undefined {
  if (raw == null) return null;
  if (!/^[A-Za-z0-9_.-]{1,32}$/.test(raw)) return undefined;
  return raw;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  if (!SPORTS.has(sport)) {
    return NextResponse.json({ error: `Unknown sport. Expected one of: ${[...SPORTS].join(', ')}` }, { status: 400 });
  }

  const teamId = parseTeamId(url.searchParams.get('teamId'));
  if (teamId === undefined) return NextResponse.json({ error: 'teamId is not a team id' }, { status: 400 });

  const from = parseDate(url.searchParams.get('from'));
  if (from === undefined) return NextResponse.json({ error: 'from must be an ISO date (YYYY-MM-DD)' }, { status: 400 });

  const to = parseDate(url.searchParams.get('to'));
  if (to === undefined) return NextResponse.json({ error: 'to must be an ISO date (YYYY-MM-DD)' }, { status: 400 });

  const effectiveFrom = from ?? DEFAULT_FROM;

  return cachedRoute({
    cacheKey: `history:results:route:${sport}:${teamId ?? 'all'}:${effectiveFrom}:${to ?? 'now'}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'history/results',
    errorMessage: 'Results read failed',
    request,
    build: async () => {
      const games = await readGameResults({
        sport,
        ...(teamId ? { teamId } : {}),
        from: effectiveFrom,
        ...(to ? { to } : {}),
      });
      return { sport, teamId: teamId ?? null, from: effectiveFrom, to: to ?? null, games, fetchedAt: new Date().toISOString() };
    },
  });
}
