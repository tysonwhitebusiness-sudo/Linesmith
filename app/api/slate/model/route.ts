/**
 * GET /api/slate/model?sport=mlb[&date=YYYY-MM-DD]
 *
 * The Slate's Model section (S5) — today's locked game picks, reduced to what
 * M1's display rule allows: the pick and its price, never a probability,
 * grade, stake or record (see `lib/slate/modelPicks.ts`).
 *
 * CACHING — pattern 1 (`cachedRoute`). `game_picks` has one writer, the Python
 * capture job, which re-reads a pick until it locks before first pitch. Two
 * minutes is short enough to pick up a lock and long enough that a page load
 * never re-reads the table.
 *
 * CACHE KEY — `slate:model:route:{sport}:{date}`, grepped: unused.
 * IT READS; IT NEVER WRITES.
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { listGamePickHistory } from '@/lib/db/client';
import { toModelPicks } from '@/lib/slate/modelPicks';
import { easternDate } from '@/lib/sports/mlb/statsapi';

export const dynamic = 'force-dynamic';

const TTL_MS = 2 * 60 * 1000;
/** A slate is one day; the pick job writes a few dozen rows a day at most. */
const PICK_WINDOW = 200;
/** The sports whose slate adapter declares `modelPicks`. */
const SPORTS = new Set(['mlb']);

function parseDate(raw: string | null): string | undefined {
  if (raw == null) return easternDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const year = Number(raw.slice(0, 4));
  if (year < 2000 || year > 2100) return undefined;
  return raw;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  if (!SPORTS.has(sport)) return NextResponse.json({ error: 'No model section for this sport' }, { status: 400 });
  const date = parseDate(url.searchParams.get('date'));
  if (date === undefined) return NextResponse.json({ error: 'date must be an ISO date (YYYY-MM-DD)' }, { status: 400 });

  return cachedRoute({
    cacheKey: `slate:model:route:${sport}:${date}`,
    ttlMs: TTL_MS,
    routeName: 'slate/model',
    errorMessage: 'Model picks read failed',
    request,
    build: async () => ({ sport, date, rows: toModelPicks(await listGamePickHistory(sport, PICK_WINDOW), date), fetchedAt: new Date().toISOString() }),
  });
}
