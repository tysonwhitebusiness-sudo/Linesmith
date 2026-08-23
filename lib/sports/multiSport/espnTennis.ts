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

/**
 * Resolves one real match by id — real per-set scores, status, venue, and
 * country flags (used as a "logo" substitute in Game Detail's hero, honest
 * for an individual sport with no team crest). Confirmed live (§ audit):
 * ESPN's tennis `/summary` does NOT expose per-match stats the way it does
 * for soccer, so this only surfaces what the scoreboard itself carries —
 * still real, just not statistical.
 *
 * The scoreboard is date-scoped (no direct "get by id" endpoint found), so
 * this re-queries a wide window and searches for the matching competition
 * id — the same shape `fetchTennisMatches` uses, just windowed wider since
 * a Game Detail visit can land well after (or, for an upcoming match,
 * before) `fetchTennisMatches`' own default same-day-ish window.
 */
export async function fetchTennisMatchDetail(tour: 'atp' | 'wta', matchId: string): Promise<EspnTennisMatchDetail | null> {
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const start = fmt(new Date(Date.now() - 21 * 86_400_000));
  const end = fmt(new Date(Date.now() + 14 * 86_400_000));
  const res = await fetch(`${BASE}/${tour}/scoreboard?dates=${start}-${end}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    events?: Array<{
      name: string;
      groupings?: Array<{
        competitions?: Array<{
          id: string;
          date: string;
          venue?: { fullName?: string };
          status?: { type?: { state?: string; completed?: boolean; detail?: string } };
          notes?: Array<{ text?: string; type?: string }>;
          competitors?: Array<{
            /** Competitor's own `id`, not `athlete.id` — see `RawCompetitor`'s comment above. */
            id: string;
            homeAway: 'home' | 'away';
            winner?: boolean;
            linescores?: Array<{ value?: number; winner?: boolean }>;
            athlete: { fullName: string; flag?: { href?: string } };
          }>;
        }>;
      }>;
    }>;
  };

  for (const ev of json.events ?? []) {
    for (const grouping of ev.groupings ?? []) {
      for (const comp of grouping.competitions ?? []) {
        if (String(comp.id) !== matchId) continue;
        const home = comp.competitors?.find((c) => c.homeAway === 'home');
        const away = comp.competitors?.find((c) => c.homeAway === 'away');
        if (!home?.athlete || !away?.athlete) return null;
        const setsWon = (c: NonNullable<typeof home>) => (c.linescores ?? []).filter((l) => l.winner).length;
        const state = comp.status?.type?.state === 'in' ? 'in' : comp.status?.type?.state === 'post' ? 'post' : comp.status?.type?.state === 'pre' ? 'pre' : 'unknown';
        return {
          matchId,
          date: comp.date,
          tournamentName: ev.name,
          venue: comp.venue?.fullName ?? null,
          status: { state, completed: comp.status?.type?.completed ?? false, detail: comp.status?.type?.detail ?? '' },
          player1: {
            subjectId: `espn:tennis:${home.id}`,
            name: home.athlete.fullName,
            flagUrl: home.athlete.flag?.href ?? null,
            setsWon: [setsWon(home)],
            wonMatch: home.winner ?? false,
          },
          player2: {
            subjectId: `espn:tennis:${away.id}`,
            name: away.athlete.fullName,
            flagUrl: away.athlete.flag?.href ?? null,
            setsWon: [setsWon(away)],
            wonMatch: away.winner ?? false,
          },
          resultNote: comp.notes?.find((n) => n.type === 'event')?.text ?? null,
        };
      }
    }
  }
  return null;
}
