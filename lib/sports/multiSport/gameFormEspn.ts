/**
 * Form coming in and head to head from ESPN team schedules — the before-start
 * read football (R8.2b) and soccer (R8.3a) share. Finished games before this
 * one, this season and last, by event id (R7-C1: a league's own schedule, never
 * `game_result` by date). Form reaches across the break because a team two
 * games into a season has two games of form.
 */

import { fetchTeamSeasonGames, type EspnSeasonGame } from './teamSportEspn';
import type { FormGame } from '@/lib/sports/shared/gameResearchShapes';

/** The US Eastern date of a start, which `player_game_history.game_date` and the rollups use. */
export const easternDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export function formGameFrom(teamId: string, g: EspnSeasonGame): FormGame | null {
  const home = g.home.id === teamId;
  const us = home ? g.home : g.away;
  const them = home ? g.away : g.home;
  if (us.score == null || them.score == null) return null;
  return { pk: g.id, date: easternDate(g.start), home, opponentId: them.id, opponentAbbr: them.abbr, us: us.score, them: them.score, postseason: g.postseason };
}

export async function readEspnForm(input: {
  espnSport: string;
  espnLeague: string;
  eventId: string;
  start: string;
  season: number;
  /** The season still being played; earlier ones cache for a week. */
  currentSeason: number;
  awayId: string;
  homeId: string;
}): Promise<{ form: Record<string, { games: FormGame[] }>; h2h: FormGame[] }> {
  const { espnSport, espnLeague, eventId, start, season, currentSeason, awayId, homeId } = input;
  const schedule = (teamId: string, s: number) => fetchTeamSeasonGames(espnSport, espnLeague, teamId, s, s < currentSeason).catch((): EspnSeasonGame[] => []);
  const [awaySched, homeSched, awayLast, homeLast] = await Promise.all([schedule(awayId, season), schedule(homeId, season), schedule(awayId, season - 1), schedule(homeId, season - 1)]);
  const before = (g: EspnSeasonGame) => g.state === 'final' && g.id !== eventId && Date.parse(g.start) < Date.parse(start);
  const formOf = (teamId: string, games: EspnSeasonGame[]) => {
    const seen = new Set<string>();
    return games
      .filter(before)
      .filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)))
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
      .map((g) => formGameFrom(teamId, g))
      .filter((g): g is FormGame => g != null);
  };
  return {
    form: { [awayId]: { games: formOf(awayId, [...awayLast, ...awaySched]) }, [homeId]: { games: formOf(homeId, [...homeLast, ...homeSched]) } },
    h2h: formOf(awayId, [...awayLast, ...awaySched].filter((g) => g.home.id === homeId || g.away.id === homeId)),
  };
}
