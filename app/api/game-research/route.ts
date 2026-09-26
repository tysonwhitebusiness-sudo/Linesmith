/**
 * GET /api/game-research?sport=mlb&gameId=824711 (also nfl, cfb, soccer_epl, soccer_mls, tennis_atp, tennis_wta, nba: ESPN ids; nhl: NHL game ids)
 *
 * A game page's payload — R8. One route with the sport as a query param, for
 * the reason `/api/team-research` gives. Each sport's
 * reader lives beside its other fetchers (`lib/sports/mlb/gameResearch.ts`).
 *
 * CACHING — pattern 1 (`cachedRoute`), with the TTL set by the game's REAL
 * status, read first from a 20-second in-process status lookup:
 *   final      24 h   — a finished game's feed, box and closing lines do not change;
 *   live       15 s   — stale-while-revalidate, so a poll gets the last build at
 *                       once and the next one is fetched behind it;
 *   postponed  1 h;
 *   pre        5 min  — lineups, probables and prices move before the start.
 * A game that turns live mid-TTL is caught by the status lookup: the key carries
 * the state, so a new state is a new entry rather than a stale one.
 *
 * CACHE KEY — `game-research:route:v10:{sport}:{gameId}:{state}` (v10: R12e adds tennis's pre-2024 head to head to the payload; v9: R9b opponent crests), grepped before it
 * was chosen: nothing in `lib/`, `app/` or `components/` used a `game-research`
 * prefix. The game id is bounded in shape before it reaches the key (task 3.5),
 * and a reader returns `null` for an id the source does not know, which
 * `cachedRoute` answers with an uncached 404.
 */

import { NextResponse } from 'next/server';
import { BadRequest, entityId, nhlGameId } from '@/lib/apiValidation';
import { cachedRoute } from '@/lib/cachedRoute';
import { getGameStatus } from '@/lib/sports/mlb/statsapi';
import { mlbGameState, readMlbGameResearch } from '@/lib/sports/mlb/gameResearch';
import { footballStateOf, readFootballGameResearch } from '@/lib/sports/multiSport/footballGameResearch';
import { readSoccerGameResearch, soccerStateOf } from '@/lib/sports/soccer/gameResearch';
import { readTennisGameResearch, tennisStateOf } from '@/lib/sports/tennis/gameResearch';
import { nbaStateOf, readNbaGameResearch } from '@/lib/sports/nba/gameResearch';
import { nhlStateOf, readNhlGameResearch } from '@/lib/sports/nhl/gameResearch';
import type { GameState } from '@/lib/sports/shared/gameResearchShapes';

export const dynamic = 'force-dynamic';

const TTL: Record<GameState, number> = {
  final: 24 * 60 * 60 * 1000,
  live: 15 * 1000,
  postponed: 60 * 60 * 1000,
  pre: 5 * 60 * 1000,
};

const READERS: Record<string, { state: (gameId: number) => Promise<GameState | null>; read: (gameId: number) => Promise<unknown | null>; id?: (raw: string | null) => string }> = {
  mlb: {
    state: async (pk) => {
      const s = await getGameStatus(pk);
      return s ? mlbGameState(s.abstractState, s.detailedState) : null;
    },
    read: readMlbGameResearch,
  },
  // R8.2: ESPN event ids. The state lookup reads the summary through its own
  // 5-second (10 minutes once final) cache, which the build then reuses.
  nfl: { state: (id) => footballStateOf('nfl', String(id)), read: (id) => readFootballGameResearch('nfl', String(id)) },
  cfb: { state: (id) => footballStateOf('cfb', String(id)), read: (id) => readFootballGameResearch('cfb', String(id)) },
  // R8.3a: ESPN event ids, one reader per league.
  soccer_epl: { state: (id) => soccerStateOf('soccer_epl', String(id)), read: (id) => readSoccerGameResearch('soccer_epl', String(id)) },
  soccer_mls: { state: (id) => soccerStateOf('soccer_mls', String(id)), read: (id) => readSoccerGameResearch('soccer_mls', String(id)) },
  // R8.3b: ESPN competition ids, one reader per tour.
  tennis_atp: { state: (id) => tennisStateOf('tennis_atp', String(id)), read: (id) => readTennisGameResearch('tennis_atp', String(id)) },
  tennis_wta: { state: (id) => tennisStateOf('tennis_wta', String(id)), read: (id) => readTennisGameResearch('tennis_wta', String(id)) },
  // R8.4a: ESPN event ids.
  nba: { state: (id) => nbaStateOf(String(id)), read: (id) => readNbaGameResearch(String(id)) },
  // R8.4b: NHL game ids (2025021270), not ESPN's.
  nhl: { state: (id) => nhlStateOf(String(id)), read: (id) => readNhlGameResearch(String(id)), id: (raw) => nhlGameId(raw) },
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  const reader = READERS[sport];
  if (!reader) {
    return NextResponse.json({ error: `No game page reader for "${sport}". Expected one of: ${Object.keys(READERS).join(', ')}` }, { status: 400 });
  }
  let gameId: number;
  try {
    // NHL game ids run to ten digits, past the shared nine-digit bound; the reader names its own shape.
    gameId = Number(reader.id ? reader.id(url.searchParams.get('gameId')) : entityId(url.searchParams.get('gameId'), 'gameId'));
  } catch (error) {
    if (error instanceof BadRequest) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  // Dev-only replay (MLB): the game as it stood at a StatsAPI timecode, so a
  // finished game can be looked at live. Uncached on purpose — it is a moving
  // read for reviewing the page, never a visitor's load, and it must not leave
  // a live-shaped entry under a final game's key.
  const replay = url.searchParams.get('replay');
  if (replay) {
    if (process.env.NODE_ENV === 'production' || sport !== 'mlb' || !/^\d{8}_\d{6}$/.test(replay)) {
      return NextResponse.json({ error: 'replay is dev-only, MLB only, and takes a timecode yyyymmdd_hhmmss (UTC)' }, { status: 400 });
    }
    const payload = await readMlbGameResearch(gameId, new Date(), replay).catch(() => null);
    return payload ? NextResponse.json(payload) : NextResponse.json({ error: `No replay of ${sport} game ${gameId} at ${replay}` }, { status: 404 });
  }
  let state = await reader.state(gameId).catch(() => null);
  if (!state) {
    // R12d: the state lookups use lenient fetches, so a null here is either "no
    // such game" or "the source did not answer" — and this line used to call
    // both 404, undoing the readers' own distinction. The strict reader tells
    // them apart: null is the source's own "no such game", a throw is an outage.
    try {
      const probe = (await reader.read(gameId)) as { state?: GameState } | null;
      if (!probe?.state) return NextResponse.json({ error: `No ${sport} game ${gameId}` }, { status: 404 });
      state = probe.state;
    } catch {
      return NextResponse.json({ error: 'Game research lookup failed' }, { status: 502 });
    }
  }
  return cachedRoute({
    cacheKey: `game-research:route:v10:${sport}:${gameId}:${state}`,
    ttlMs: TTL[state],
    routeName: 'game-research',
    build: () => reader.read(gameId),
    notFoundMessage: `No ${sport} game ${gameId}`,
    errorMessage: 'Game research lookup failed',
    request,
  });
}
