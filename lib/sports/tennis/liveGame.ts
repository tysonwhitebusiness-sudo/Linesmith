/**
 * Tennis live in-game detail — hero card's Live tab data source. Verified
 * live against real ATP scoreboard matches before building: unlike every
 * team sport on ESPN's site API, tennis has no per-match `summary?event=`
 * endpoint — a match is nested inside its tournament event's `groupings[].
 * competitions[]` on the scoreboard response itself (same shape
 * `espnTennis.ts`'s `fetchTennisMatches` already reads), so this fetches
 * the tour-wide scoreboard and finds the one competition by id, same as
 * that file does for its own purpose. `competitors[].linescores[]` gives
 * real per-set score including tiebreaks — confirmed live. `statistics[]`
 * (serve stats) was confirmed EMPTY on every real match checked this
 * session, so it's modeled as present-but-likely-empty rather than
 * fabricated into the UI; the Live tab shows the honest set ladder only.
 * Deliberately uncached — same live-data contract as
 * `app/api/mlb/game/[gameId]/live/route.ts`.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';

export interface TennisSetScore {
  value: number;
  tiebreak?: number;
  winner: boolean;
}

export interface TennisLivePlayer {
  name: string;
  sets: TennisSetScore[];
  winner: boolean;
}

export interface TennisLiveGameDetail {
  matchId: string;
  state: 'pre' | 'in' | 'post';
  statusDetail: string;
  away: TennisLivePlayer;
  home: TennisLivePlayer;
}

interface RawCompetitor {
  homeAway: 'home' | 'away';
  winner?: boolean;
  athlete?: { displayName: string };
  linescores?: Array<{ value: number; tiebreak?: number; winner?: boolean }>;
}
interface RawScoreboard {
  events?: Array<{
    groupings?: Array<{
      competitions?: Array<{
        id: string;
        status?: { type?: { state?: 'pre' | 'in' | 'post'; shortDetail?: string; detail?: string } };
        competitors?: RawCompetitor[];
      }>;
    }>;
  }>;
}

export async function fetchTennisLiveGame(tour: 'atp' | 'wta', matchId: string): Promise<TennisLiveGameDetail | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${tour}/scoreboard`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = (await res.json()) as RawScoreboard;

  for (const ev of json.events ?? []) {
    for (const grouping of ev.groupings ?? []) {
      for (const comp of grouping.competitions ?? []) {
        if (comp.id !== matchId) continue;
        const away = comp.competitors?.find((c) => c.homeAway === 'away');
        const home = comp.competitors?.find((c) => c.homeAway === 'home');
        if (!away?.athlete || !home?.athlete) return null;
        const toPlayer = (c: RawCompetitor): TennisLivePlayer => ({
          name: c.athlete!.displayName,
          winner: c.winner === true,
          sets: (c.linescores ?? []).map((l) => ({ value: l.value, tiebreak: l.tiebreak, winner: l.winner === true })),
        });
        return {
          matchId,
          state: comp.status?.type?.state ?? 'pre',
          statusDetail: comp.status?.type?.shortDetail ?? comp.status?.type?.detail ?? '',
          away: toPlayer(away),
          home: toPlayer(home),
        };
      }
    }
  }
  return null;
}
