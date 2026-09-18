/**
 * ESPN tennis fetcher — structurally different from the team-sport shape
 * (teamSportEspn.ts): one ESPN "event" is a whole tournament, containing
 * groupings (Men's/Women's Singles) of individual match "competitions". A
 * match's own `competitors[]` already carries both players' names and athlete
 * ids directly — unlike team sports, there's no separate roster to fetch;
 * the two players IN the match are the entire roster relevant to that
 * match's props.
 *
 * Canonical subjectId: `espn:tennis:{athleteId}`, same namespacing scheme as
 * teamSportEspn.ts.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';

/**
 * A tour's scoreboard is NOT limited to that tour. Measured live 2026-09-14:
 * the `atp` scoreboard's US Open event carries a `womens-singles` grouping of
 * 239 competitions, and the `wta` scoreboard's carries `mens-singles` with the
 * same 239 — a combined event is published in full under both tours. Doubles
 * leak too: the `athlete` guard below was documented as excluding them, but
 * only some events shape them that way (Korea Open `womens-doubles` passed
 * 15 of 15, Guadalajara 6 of 15), so it is not a filter.
 *
 * Keep only this tour's singles, the same slug test `schedule.ts` already
 * makes for the draw.
 */
const SINGLES_SLUG: Record<'atp' | 'wta', string> = {
  atp: 'mens-singles',
  wta: 'womens-singles',
};

export interface EspnTennisMatch {
  matchId: string;
  date: string;
  tournamentName: string;
  player1SubjectId: string;
  player1Name: string;
  player2SubjectId: string;
  player2Name: string;
  completed: boolean;
}

interface RawCompetitor {
  /** The athlete id — confirmed live: it's the competitor object's own `id`, NOT `athlete.id` (the nested `athlete` object carries `guid`/`displayName`/`fullName`/`flag`/`links` but no bare `id` field). Getting this wrong collapses every player's subjectId to `espn:tennis:undefined`. */
  id: string;
  homeAway: 'home' | 'away';
  athlete: { fullName: string };
}

export async function fetchTennisMatches(tour: 'atp' | 'wta'): Promise<EspnTennisMatch[]> {
  const res = await fetch(`${BASE}/${tour}/scoreboard`, { cache: 'no-store' });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    events?: Array<{
      name: string;
      groupings?: Array<{
        grouping?: { slug?: string };
        competitions?: Array<{
          id: string;
          date: string;
          status?: { type?: { completed?: boolean } };
          competitors?: RawCompetitor[];
        }>;
      }>;
    }>;
  };

  const matches: EspnTennisMatch[] = [];
  const singlesSlug = SINGLES_SLUG[tour];
  for (const ev of json.events ?? []) {
    for (const grouping of ev.groupings ?? []) {
      if (grouping.grouping?.slug !== singlesSlug) continue;
      for (const comp of grouping.competitions ?? []) {
        const home = comp.competitors?.find((c) => c.homeAway === 'home');
        const away = comp.competitors?.find((c) => c.homeAway === 'away');
        if (!home?.athlete || !away?.athlete) continue;
        matches.push({
          matchId: String(comp.id),
          date: comp.date,
          tournamentName: ev.name,
          player1SubjectId: `espn:tennis:${home.id}`,
          player1Name: home.athlete.fullName,
          player2SubjectId: `espn:tennis:${away.id}`,
          player2Name: away.athlete.fullName,
          completed: comp.status?.type?.completed ?? false,
        });
      }
    }
  }
  return matches;
}

export interface EspnTennisMatchDetail {
  matchId: string;
  date: string;
  tournamentName: string;
  venue: string | null;
  status: { state: 'pre' | 'in' | 'post' | 'unknown'; completed: boolean; detail: string };
  player1: { subjectId: string; name: string; flagUrl: string | null; setsWon: number[]; wonMatch: boolean };
  player2: { subjectId: string; name: string; flagUrl: string | null; setsWon: number[]; wonMatch: boolean };
  resultNote: string | null;
}
