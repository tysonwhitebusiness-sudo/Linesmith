/**
 * GET /api/odds/game-line-history?eventId=X&market=moneyline[&side=home][&hours=48]
 *
 * Price movement for one GAME market — Phase 6.22, the game/team twin of
 * `/api/props/line-history`.
 *
 * CACHING — pattern 2 (direct Postgres read, refreshed out-of-band), per
 * `CLAUDE.md`, and the same reasoning its prop twin records verbatim:
 *
 *   - the data lives in its own real table (`game_odds_history`), not a
 *     snapshot blob;
 *   - the Python worker is its sole writer, on its own schedule;
 *   - this route triggers nothing and writes nothing.
 *
 * NOT `cachedRoute` (pattern 1), deliberately: the whole point of a movement
 * chart is the most recent point, and a snapshot TTL would show a movement
 * story that had stopped moving. The read is one index range scan with the
 * leading key columns pinned and the bucket ladder caps returned rows
 * regardless of window, so this is not the "every visitor pays a full rebuild"
 * case that convention exists to prevent.
 *
 * Every parameter is bounded before it reaches SQL — task 3.5's lesson, that
 * `Number.isFinite(x) && x > 0` accepted 1e9 and 2.5 alike.
 */

import { NextResponse } from 'next/server';
import { readGameLineHistory, GAME_HISTORY_MARKETS, type GameHistoryMarket } from '@/lib/odds/gameLineHistory';

export const dynamic = 'force-dynamic';

/** Event ids are provider/ESPN strings, so length- and charset-bounded rather than parsed. */
const ID_PATTERN = /^[A-Za-z0-9:_.\-]{1,64}$/;
/**
 * An ALLOWLIST, not a pattern. `side` reaches an equality filter, and these are
 * the values the table actually holds: home/away for a moneyline or spread,
 * over/under for a total, and draw for soccer's real third outcome.
 */
const SIDES = new Set(['home', 'away', 'over', 'under', 'draw']);
const MAX_HOURS = 24 * 30;
const DEFAULT_HOURS = 48;

export async function GET(request: Request) {
  const url = new URL(request.url);

  const eventId = url.searchParams.get('eventId') ?? '';
  if (!ID_PATTERN.test(eventId)) {
    return NextResponse.json({ error: `eventId is required and must match ${ID_PATTERN}` }, { status: 400 });
  }

  const market = url.searchParams.get('market') ?? 'moneyline';
  if (!(GAME_HISTORY_MARKETS as readonly string[]).includes(market)) {
    return NextResponse.json(
      { error: `market must be one of: ${GAME_HISTORY_MARKETS.join(', ')}` },
      { status: 400 },
    );
  }

  const side = url.searchParams.get('side') ?? (market === 'total' ? 'over' : 'home');
  if (!SIDES.has(side)) {
    return NextResponse.json({ error: `side must be one of: ${[...SIDES].join(', ')}` }, { status: 400 });
  }

  const rawHours = url.searchParams.get('hours');
  const hours = rawHours == null ? DEFAULT_HOURS : Number(rawHours);
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) {
    return NextResponse.json({ error: `hours must be an integer from 1 to ${MAX_HOURS}` }, { status: 400 });
  }

  try {
    const result = await readGameLineHistory({ eventId, market: market as GameHistoryMarket, side, hours });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: 'Game line history lookup failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
