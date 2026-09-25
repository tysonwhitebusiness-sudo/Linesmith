/**
 * GET /api/odds/slate?sport=mlb&date=2026-09-25&ids=823735,823409,…
 *
 * The Slate's odds (odds build P8, O4): per game the best moneyline per side,
 * Pinnacle's two prices and no-vig split, the consensus total and where it
 * opened, the home moneyline open → now, DraftKings' splits, Kalshi's 24 h
 * volume, the books' main moneylines, steam with its first mover, dropping
 * odds and pulled lines (`lib/db/oddsRead.ts` `readSlateOdds` →
 * `lib/odds/section/slate.ts`). The slate-wide lists are built from these in
 * the page.
 *
 * CACHING — pattern 1 (`cachedRoute`), per CLAUDE.md: the build aggregates a
 * whole slate, so every visitor must not pay for it. TTL 60 s: the bridge
 * forwards changes every ~30 s and the page's live refresh arrives in P9.
 *
 * CACHE KEY — `odds:slate:route:{sport}:{date}:{ids hash}` (grepped: no
 * `odds:slate` key existed). The ids are part of the key because the Slate
 * sends the games it shows (a soccer league filter shows a different set);
 * each is bounded and the list is capped at 60, so the key space is the
 * slates people actually open.
 *
 * F12 (steam / first mover at read time): `buildMs` in the payload is the
 * build's own time; P8 records its p95 on a full NFL Sunday slate.
 */
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { readSlateOdds } from '@/lib/db/oddsRead';

export const dynamic = 'force-dynamic';

const TTL_MS = 60 * 1000;
const SPORTS = new Set(['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer', 'soccer_epl', 'soccer_mls', 'tennis', 'tennis_atp', 'tennis_wta']);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  const date = url.searchParams.get('date') ?? '';
  const ids = [...new Set((url.searchParams.get('ids') ?? '').split(',').filter(Boolean))].sort();
  if (!SPORTS.has(sport) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !ids.length || ids.length > 60
      || ids.some(id => !/^[A-Za-z0-9_.:-]{1,64}$/.test(id))) {
    return NextResponse.json({ error: 'sport, date (YYYY-MM-DD) and ids (at most 60) are required' }, { status: 400 });
  }
  const hash = createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 12);
  return cachedRoute({
    cacheKey: `odds:slate:route:${sport}:${date}:${hash}`,
    ttlMs: TTL_MS,
    routeName: 'odds/slate',
    errorMessage: 'Slate odds read failed',
    request,
    build: () => readSlateOdds(sport, date, ids),
  });
}
