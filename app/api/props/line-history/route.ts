/**
 * GET /api/props/line-history?gameId=X&subjectId=Y&marketKey=Z[&side=over][&hours=48][&line=5.5]
 *
 * Line movement for one prop, one series per bookmaker. Phase 6.16.
 *
 * THE PLAN SAID THIS ROUTE EXISTED AND HAD NO FRONTEND CONSUMER. It did not
 * exist at all — measured 2026-08-30. The data always did: `prop_odds_history`
 * holds 670,478 observations across 2,294 subjects and 26 books, written by the
 * Python worker's `JOB_REGISTRY` jobs.
 *
 * CACHING — pattern 2 (direct Postgres read, refreshed out-of-band), per
 * `CLAUDE.md`'s convention, and the same shape as `app/api/props/lines/route.ts`:
 *
 *   - the data lives in its own real table, not a snapshot blob;
 *   - the Python worker is its sole writer, on its own schedule;
 *   - this route triggers nothing and writes nothing.
 *
 * NOT `cachedRoute` (pattern 1), deliberately. The whole point of a line-
 * movement chart is the most recent point, and the underlying rows change every
 * few minutes; a snapshot TTL would show a movement story that stopped moving.
 * The read is one index range scan on
 * `(game_id, subject_id, market_key, line, side, observed_at)` with the leading
 * columns all pinned, and the bucket ladder caps the returned rows regardless of
 * window — so this is not the "every visitor pays a full rebuild" case that
 * convention exists to prevent.
 *
 * Every parameter is bounded before it reaches SQL — task 3.5's lesson, that
 * `Number.isFinite(x) && x > 0` accepted 1e9 and 2.5 alike.
 */

import { NextResponse } from 'next/server';
import { readLineHistory } from '@/lib/odds/props/lineHistory';

export const dynamic = 'force-dynamic';

/** Ids are provider/ESPN strings, so length- and charset-bounded rather than parsed. */
const ID_PATTERN = /^[A-Za-z0-9:_.\-]{1,64}$/;
const MAX_HOURS = 24 * 30;
const DEFAULT_HOURS = 48;

export async function GET(request: Request) {
  const url = new URL(request.url);

  const gameId = url.searchParams.get('gameId') ?? '';
  const subjectId = url.searchParams.get('subjectId') ?? '';
  const marketKey = url.searchParams.get('marketKey') ?? '';
  for (const [name, value] of [
    ['gameId', gameId],
    ['subjectId', subjectId],
    ['marketKey', marketKey],
  ] as const) {
    if (!ID_PATTERN.test(value)) {
      return NextResponse.json({ error: `${name} is required and must match ${ID_PATTERN}` }, { status: 400 });
    }
  }

  // An allowlist, not a pattern: `side` reaches an equality filter, and these
  // are the only two values the table holds for a prop.
  const side = url.searchParams.get('side') ?? 'over';
  if (side !== 'over' && side !== 'under') {
    return NextResponse.json({ error: "side must be 'over' or 'under'" }, { status: 400 });
  }

  const rawHours = url.searchParams.get('hours');
  const hours = rawHours == null ? DEFAULT_HOURS : Number(rawHours);
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) {
    return NextResponse.json({ error: `hours must be an integer from 1 to ${MAX_HOURS}` }, { status: 400 });
  }

  // Optional: pin a specific alternate line. An unrecognised value is not an
  // error — `readLineHistory` falls back to the most-quoted line and echoes
  // `resolvedLine`, so a caller always learns which line it actually got.
  const rawLine = url.searchParams.get('line');
  let line: number | undefined;
  if (rawLine != null) {
    const parsed = Number(rawLine);
    if (!Number.isFinite(parsed) || Math.abs(parsed) > 1000) {
      return NextResponse.json({ error: 'line must be a finite number within +/-1000' }, { status: 400 });
    }
    line = parsed;
  }

  try {
    return NextResponse.json(await readLineHistory({ gameId, subjectId, marketKey, side, hours, line }));
  } catch (err) {
    // Task 3.10's rule — the detail goes to the server log, never to the client.
    console.error('[props/line-history] failed', err);
    return NextResponse.json({ error: 'Line history lookup failed' }, { status: 500 });
  }
}
