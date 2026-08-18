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
  homeAway: 'home' | 'away';
  athlete: { id: string; fullName: string };
}

export async function fetchTennisMatches(tour: 'atp' | 'wta'): Promise<EspnTennisMatch[]> {
  const res = await fetch(`${BASE}/${tour}/scoreboard`, { cache: 'no-store' });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    events?: Array<{
      name: string;
      groupings?: Array<{
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
  for (const ev of json.events ?? []) {
    for (const grouping of ev.groupings ?? []) {
      for (const comp of grouping.competitions ?? []) {
        const home = comp.competitors?.find((c) => c.homeAway === 'home');
        const away = comp.competitors?.find((c) => c.homeAway === 'away');
        if (!home?.athlete || !away?.athlete) continue;
        matches.push({
          matchId: String(comp.id),
          date: comp.date,
          tournamentName: ev.name,
          player1SubjectId: `espn:tennis:${home.athlete.id}`,
          player1Name: home.athlete.fullName,
          player2SubjectId: `espn:tennis:${away.athlete.id}`,
          player2Name: away.athlete.fullName,
          completed: comp.status?.type?.completed ?? false,
        });
      }
    }
  }
  return matches;
}
