/**
 * `TeamDetail.tsx` adapter — soccer half.
 *
 * Real Team Detail, matching MLB/NFL's own shape (2026-08-23): real
 * candidates (`buildSoccerMoneylineCandidate`/`buildSoccerGameTotalCandidate`,
 * built from this team's own real recent match results — same
 * `teamFormCandidates.ts` pattern MLB's adapter uses), real windows/
 * distribution/games table through the same windowedStat engine every other
 * sport's Team Detail runs through, and (EPL only) a real stat-groups card
 * from Understat's team-level goals-for/goals-against rate + league rank
 * (`teamSeasonStats`, fetched by the API route). MLS's stat-groups card
 * stays empty — no team-level ASA source wired yet, honest gap not
 * fabricated coverage. `grades`/`matchup` stay `null` — no grading model or
 * opponent-conditional stat source for soccer, same gap CFB's adapter
 * documents.
 */

import { soccerTeamSpec } from './teamResearchSpec';
import { buildTeamResearch } from '@/lib/sports/shared/teamResearch';
import type { TeamResearchData, TeamResearchPayload } from '@/lib/sports/shared/teamResearchShapes';
import type { RecentResultRow } from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import type { SoccerTeam, SoccerPregameLine } from '@/lib/sports/soccer/espn';
import type { UnderstatTeamDefense } from '@/lib/sports/soccer/understat';
import type { EspnTeamSportGame } from '@/lib/sports/multiSport/teamSportEspn';
/**
 * Real final scores from ESPN's scoreboard `score`/`status` fields
 * (teamSportEspn.ts) mapped to one team's perspective — `win`/`isDraw` stay
 * `null`/`false` for a game ESPN hasn't posted a completed status for yet.
 * Shared by this file's own `recentResults` and `gameDetailAdapter.ts`'s
 * records/last-five sections, so both read the exact same real derivation.
 */
export function toSoccerRecentResultRows(games: EspnTeamSportGame[], teamId: string): RecentResultRow[] {
  return games.map((g) => {
    const isHome = g.homeTeamId === teamId;
    const scoreFor = isHome ? g.homeScore : g.awayScore;
    const scoreAgainst = isHome ? g.awayScore : g.homeScore;
    const resolved = g.status?.completed === true && scoreFor != null && scoreAgainst != null;
    return {
      gameId: g.gameId,
      date: g.date,
      win: resolved ? scoreFor > scoreAgainst : null,
      isDraw: resolved ? scoreFor === scoreAgainst : false,
      opponentAbbr: isHome ? g.awayAbbr : g.homeAbbr,
      isHome,
      scoreFor: scoreFor ?? 0,
      scoreAgainst: scoreAgainst ?? 0,
    };
  });
}

interface SoccerRosterSeasonStats {
  /** null for MLS — ASA's season aggregate has no real "games played" field, only minutesPlayed. */
  games: number | null;
  goals: number;
  assists: number;
}


export interface SoccerTeamDetailApiResponse {
  team: SoccerTeam;
  roster: Array<{ subjectId: string; fullName: string; position: string | null; headshotUrl: string | null; seasonStats: SoccerRosterSeasonStats | null }>;
  nextGame: EspnTeamSportGame | null;
  nextGameLine: SoccerPregameLine | null;
  recentGames: EspnTeamSportGame[];
  /** EPL only — real season goals-for/against rate + league rank from Understat. `null` for MLS (no team-level ASA source wired yet) or a team Understat's index doesn't carry (name-match miss). */
  teamSeasonStats: UnderstatTeamDefense | null;
  /** EPL only — the next opponent's own row from the same Understat index. */
  opponentSeasonStats: UnderstatTeamDefense | null;
  opponentAbbr: string | null;
  opponentName: string | null;
  opponentLogoUrl: string | null;
  /** Real logo per real ESPN abbreviation (2026-08-24) — feeds the distribution chart's `logoFor`. */
  logoByAbbr: Record<string, string>;
}

// ---------------------------------------------------------------------------
// R7.4 — the team research page
// ---------------------------------------------------------------------------

/**
 * Soccer's team page: the shared team research read through soccer's spec,
 * W-D-L throughout. Soccer adds no section of its own: the plan's soccer card is
 * its ranked club totals, which the shared Team stats section already is.
 */
export function toTeamResearchData(input: { payload: TeamResearchPayload; season: number | null; now?: Date }): TeamResearchData {
  const sport = input.payload.sport === 'soccer_mls' ? 'soccer_mls' : 'soccer_epl';
  const slug = sport === 'soccer_mls' ? 'mls' : 'epl';
  return buildTeamResearch({ payload: input.payload, spec: soccerTeamSpec(sport), season: input.season, teamHref: (id) => `/soccer/${slug}/team/${encodeURIComponent(id)}`, now: input.now });
}
