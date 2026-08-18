/**
 * `GameLookupContext[]` for the four non-MLB sports, built directly from
 * ESPN (lib/sports/multiSport/*) rather than a per-sport StatsAPI-equivalent
 * — mirrors gameContext.ts's job for MLB, but there's no pre-built snapshot
 * to read here; each call fetches fresh (ESPN's own roster cache inside
 * teamSportEspn.ts keeps this cheap on repeat calls within an hour).
 */

import type { GameLookupContext, SportKey } from './types';
import { fetchScoreboard, fetchTeamRoster } from '@/lib/sports/multiSport/teamSportEspn';
import { fetchTennisMatches } from '@/lib/sports/multiSport/espnTennis';

interface TeamSportConfig {
  kind: 'team';
  espnSport: string;
  espnLeague: string;
}
interface TennisConfig {
  kind: 'tennis';
  tour: 'atp' | 'wta';
}

const SPORT_CONFIG: Record<Exclude<SportKey, 'mlb'>, TeamSportConfig | TennisConfig> = {
  nfl: { kind: 'team', espnSport: 'football', espnLeague: 'nfl' },
  cfb: { kind: 'team', espnSport: 'football', espnLeague: 'college-football' },
  soccer_epl: { kind: 'team', espnSport: 'soccer', espnLeague: 'eng.1' },
  tennis_atp: { kind: 'tennis', tour: 'atp' },
  tennis_wta: { kind: 'tennis', tour: 'wta' },
};

export async function loadGameContextsForSport(sport: Exclude<SportKey, 'mlb'>): Promise<GameLookupContext[]> {
  const config = SPORT_CONFIG[sport];

  if (config.kind === 'tennis') {
    const matches = await fetchTennisMatches(config.tour);
    return matches
      .filter((m) => !m.completed)
      .map((m) => ({
        sport,
        gameId: m.matchId,
        awayTeamName: m.player2Name,
        homeTeamName: m.player1Name,
        // Tennis has no team concept — resolvePlayer's primary path is an
        // exact normalized-name match, which is all a 2-entry roster needs;
        // the team-scoped fallback simply never fires here.
        awayAbbr: m.player2Name,
        homeAbbr: m.player1Name,
        gameDate: m.date,
        roster: [
          { subjectId: m.player1SubjectId, subjectName: m.player1Name },
          { subjectId: m.player2SubjectId, subjectName: m.player2Name },
        ],
      }));
  }

  const games = await fetchScoreboard(config.espnSport, config.espnLeague, sport === 'soccer_epl' ? 7 : 14);
  const contexts: GameLookupContext[] = [];
  for (const g of games) {
    const [homeRoster, awayRoster] = await Promise.all([
      fetchTeamRoster(config.espnSport, config.espnLeague, g.homeTeamId),
      fetchTeamRoster(config.espnSport, config.espnLeague, g.awayTeamId),
    ]);
    contexts.push({
      sport,
      gameId: g.gameId,
      awayTeamName: g.awayTeamName,
      homeTeamName: g.homeTeamName,
      awayAbbr: g.awayAbbr,
      homeAbbr: g.homeAbbr,
      gameDate: g.date,
      roster: [
        ...homeRoster.map((a) => ({ subjectId: a.subjectId, subjectName: a.fullName, teamAbbr: g.homeAbbr, position: a.positionAbbr, headshotUrl: a.headshotUrl })),
        ...awayRoster.map((a) => ({ subjectId: a.subjectId, subjectName: a.fullName, teamAbbr: g.awayAbbr, position: a.positionAbbr, headshotUrl: a.headshotUrl })),
      ],
    });
  }
  return contexts;
}
