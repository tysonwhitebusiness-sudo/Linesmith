/**
 * GET /api/props/lines[?gameId=X]
 *
 * Pure read from `prop_odds` — no implicit refresh trigger. Before the Step
 * 5 cutover (docs/phase2-hardening-gameplan-2026-08-20.md), this route
 * called `triggerFreshen()` (tier1RefreshScheduler.ts) on every request,
 * firing a real SharpAPI/Propline/Odds-API.io fetch in the background. That
 * call site was missed when the rest of the TS scheduler's five odds-
 * provider jobs were cut over to the Python worker (`python-odds-service`,
 * `JOB_REGISTRY` in `jobs.py`) — `lib/scheduler.ts`'s own `setInterval`
 * jobs were correctly removed, but this separate, per-request trigger kept
 * running, undetected, because it kept prop odds looking fresh even while
 * the Python worker was fully down.
 *
 * The Python worker is now the sole owner of this refresh, without
 * qualification. This route reads whatever refreshTier1 has already
 * written and nothing else. Until task 2.5 (2026-08-28) there were two
 * user-triggered exceptions — `POST /api/props/scan-player` and
 * `POST /api/props/more-books` — and this comment named them; both routes
 * were deleted along with the Scan / More Books / Check Sharp Price
 * buttons per standing decision Q12, so there is no longer any path by
 * which a request causes a provider fetch.
 */

import { NextResponse } from 'next/server';
import { readPropOddsForGame, readPropOddsForSubject } from '@/lib/db/client';
import { loadAllGameContexts } from '@/lib/odds/props/gameContext';
import { loadGameContextsForSport } from '@/lib/odds/props/multiSportGameContext';
import type { SportKey } from '@/lib/odds/props/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const gameId = url.searchParams.get('gameId');
  const subjectId = url.searchParams.get('subjectId');
  const sport = (url.searchParams.get('sport') ?? 'mlb') as SportKey;

  if (subjectId && gameId) {
    return NextResponse.json({ rows: await readPropOddsForSubject(gameId, subjectId) });
  }
  if (gameId) {
    return NextResponse.json({ rows: await readPropOddsForGame(gameId) });
  }

  // Real bug fixed 2026-08-27: this whole-slate branch always called
  // loadAllGameContexts() (hardcoded to snapshot_cache['mlb:snapshot']),
  // regardless of which sport's Scan page was asking — Scan's price gate
  // (components/AppShell.tsx) then filtered out every real NFL candidate
  // once slateProps.loading cleared, since the only rows it ever got back
  // were (at best) MLB's, which never match an NFL subjectId. `sport` now
  // routes non-MLB sports through loadGameContextsForSport (already built,
  // already proven live for the Python-cutover prerequisite work — see
  // that module's own docstring — just never wired into this route until
  // now).
  const games = sport === 'mlb' ? await loadAllGameContexts() : await loadGameContextsForSport(sport as Exclude<SportKey, 'mlb'>);
  const rows = (await Promise.all(games.map((g) => readPropOddsForGame(g.gameId)))).flat();
  return NextResponse.json({ rows });
}
