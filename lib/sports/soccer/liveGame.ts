/**
 * Soccer live in-game detail — hero card's Live tab data source, built on
 * ESPN's public summary endpoint (the same family `soccer/espn.ts` already
 * uses for pregame data). Verified live against a real completed EPL match
 * (event 401879322) before building: soccer's summary has **no**
 * `boxscore.players` (team-level stats only — fouls/cards/corners/saves),
 * unlike NBA/NHL — so this sport's Live tab is timeline + team-stats only,
 * no player box score table (a real data-shape difference, not a shortcut).
 * `keyEvents[]` carries the real goal/card/substitution timeline with
 * clock/period/team/participant already attached. Deliberately uncached —
 * same live-data contract as `app/api/mlb/game/[gameId]/live/route.ts`.
 */

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

export interface SoccerLiveEvent {
  period: number;
  clockDisplay: string;
  typeText: string;
  teamAbbr: 'away' | 'home' | null;
  description: string;
  scoringPlay: boolean;
}

export interface SoccerTeamStatLine {
  label: string;
  displayValue: string;
}

export interface SoccerLiveGameDetail {
  gameId: string;
  state: 'pre' | 'in' | 'post';
  statusDetail: string;
  clockDisplay: string | null;
  awayTeamId: string;
  awayAbbr: string;
  awayScore: number;
  awayHalfScores: number[];
  homeTeamId: string;
  homeAbbr: string;
  homeScore: number;
  homeHalfScores: number[];
  events: SoccerLiveEvent[];
  teamStats: { away: SoccerTeamStatLine[]; home: SoccerTeamStatLine[] };
}

interface RawSummary {
  header?: {
    competitions?: Array<{
      status?: { type?: { state?: 'pre' | 'in' | 'post'; shortDetail?: string; detail?: string } };
      competitors?: Array<{
        id: string;
        homeAway: 'home' | 'away';
        team: { id: string; abbreviation: string };
        score?: string;
        linescores?: Array<{ displayValue: string }>;
      }>;
    }>;
  };
  boxscore?: { teams?: Array<{ team: { id: string }; statistics: Array<{ label: string; displayValue: string }> }> };
  keyEvents?: Array<{
    type: { text: string };
    text: string;
    shortText?: string;
    period?: { number: number };
    clock?: { displayValue: string };
    scoringPlay?: boolean;
    team?: { id: string };
  }>;
}

export async function fetchSoccerLiveGame(league: string, eventId: string): Promise<SoccerLiveGameDetail | null> {
  let res: Response;
  try {
    res = await fetch(`${ESPN_BASE}/${league}/summary?event=${eventId}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = (await res.json()) as RawSummary;

  const comp = json.header?.competitions?.[0];
  const away = comp?.competitors?.find((c) => c.homeAway === 'away');
  const home = comp?.competitors?.find((c) => c.homeAway === 'home');
  if (!comp || !away || !home) return null;

  const teamSide = (teamId: string | undefined): 'away' | 'home' | null =>
    teamId === away.team.id ? 'away' : teamId === home.team.id ? 'home' : null;

  const events: SoccerLiveEvent[] = (json.keyEvents ?? [])
    .filter((e) => e.period && e.clock)
    .map((e) => ({
      period: e.period!.number,
      clockDisplay: e.clock!.displayValue,
      typeText: e.type.text,
      teamAbbr: teamSide(e.team?.id),
      description: e.shortText ?? e.text,
      scoringPlay: e.scoringPlay === true,
    }));

  const statsFor = (teamId: string): SoccerTeamStatLine[] =>
    json.boxscore?.teams?.find((t) => t.team.id === teamId)?.statistics ?? [];

  return {
    gameId: eventId,
    state: comp.status?.type?.state ?? 'pre',
    statusDetail: comp.status?.type?.shortDetail ?? comp.status?.type?.detail ?? '',
    clockDisplay: events.length > 0 ? events[events.length - 1].clockDisplay : null,
    awayTeamId: away.team.id,
    awayAbbr: away.team.abbreviation,
    awayScore: away.score != null ? Number(away.score) : 0,
    awayHalfScores: (away.linescores ?? []).map((l) => Number(l.displayValue)),
    homeTeamId: home.team.id,
    homeAbbr: home.team.abbreviation,
    homeScore: home.score != null ? Number(home.score) : 0,
    homeHalfScores: (home.linescores ?? []).map((l) => Number(l.displayValue)),
    events,
    teamStats: { away: statsFor(away.team.id), home: statsFor(home.team.id) },
  };
}
