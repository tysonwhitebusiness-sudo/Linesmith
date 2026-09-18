/**
 * `TeamDetail.tsx` adapter — CFB half.
 *
 * Real Team Detail, matching MLB/NFL/soccer's shape (2026-08-23, matchup +
 * roster season-stats added 2026-08-24): real candidates
 * (`buildCfbMoneylineCandidate`/`buildCfbGameTotalCandidate`, built from
 * this team's own real recent results), real windows/distribution/games
 * table through the same windowedStat engine every other sport runs
 * through. `grades` stays null — no grading model exists for CFB.
 * `matchup`/`statGroups` are now real, from `teamDefenseAllowed.ts`'s
 * league-wide index (same source `playerDetailAdapter.ts`'s matchup card
 * already used — the team route just never called it before). Real:
 * roster (every FBS player, identity carried via the roster link's own
 * query params so a player with zero active props still gets an honest
 * page — see `app/cfb/player/[playerId]/page.tsx`; real per-player season
 * stats via CFBD's own box-score pipeline), next fixture with a real
 * single-book pregame line, real record/rank from standings.
 */

import type { FootballTeamResearchPayload } from '@/lib/sports/multiSport/footballTeamResearch';
import { footballTeamSpec } from '@/lib/sports/nfl/adapters/teamResearchSpec';
import { buildTeamResearch, formatRecord, gameResult } from '@/lib/sports/shared/teamResearch';
import type { ResearchSection } from '@/lib/sports/shared/playerResearchShapes';
import type { TeamGame, TeamResearchData, TeamResearchSpec } from '@/lib/sports/shared/teamResearchShapes';
import type { CfbTeam, CfbPregameLine } from '@/lib/sports/cfb/espn';
import type { EspnTeamSportGame } from '@/lib/sports/multiSport/teamSportEspn';
import type { CfbTeamDefenseAllowed } from '@/lib/sports/cfb/teamDefenseAllowed';
import type { EspnInjuryRow } from '@/lib/sports/multiSport/teamSportEspn';
interface CfbRosterSeasonStats {
  games: number;
  passingYards: number;
  rushingYards: number;
  receivingYards: number;
  receptions: number;
}

export interface CfbTeamDetailApiResponse {
  team: CfbTeam;
  roster: Array<{ subjectId: string; fullName: string; position: string | null; headshotUrl: string | null; seasonStats: CfbRosterSeasonStats | null }>;
  nextGame: EspnTeamSportGame | null;
  nextGameLine: CfbPregameLine | null;
  recentGames: EspnTeamSportGame[];
  /** This team's own real yards-produced-per-game, ranked — from the same league-wide index `opponentDefenseAllowed` comes from. */
  teamOffense: CfbTeamDefenseAllowed | null;
  /** The next opponent's real yards-allowed-per-game, ranked. */
  opponentDefenseAllowed: CfbTeamDefenseAllowed | null;
  opponentAbbr: string | null;
  opponentName: string | null;
  opponentLogoUrl: string | null;
  /** Real, confirmed live 2026-08-24 against ESPN's college-football injuries feed. */
  injuries: EspnInjuryRow[];
  /** Real logo per real FBS abbreviation (2026-08-24) — feeds the distribution chart's `logoFor`. */
  logoByAbbr: Record<string, string>;
}

// ---------------------------------------------------------------------------
// R7.2 — the team research page
// ---------------------------------------------------------------------------

/**
 * CFB's team page: the shared team research read through the football spec
 * (NFL's, as CFB's player page uses), plus CFB's own section, "Ranked
 * opponents" — every game against a team in the AP poll at kickoff (R4's
 * `curatedRank`).
 */
export function toTeamResearchData(input: { payload: FootballTeamResearchPayload; season: number | null; now?: Date }): TeamResearchData {
  const spec = footballTeamSpec('cfb');
  const data = buildTeamResearch({
    payload: input.payload,
    spec,
    season: input.season,
    teamHref: (id) => `/cfb/team/${encodeURIComponent(id)}`,
    now: input.now,
  });
  const season = data.scope.season;
  const games = input.payload.seasons.find((s) => s.season === season)?.games ?? [];
  return { ...data, sections: [...data.sections, rankedOpponentsSection(games, season, spec)] };
}

function rankedOpponentsSection(games: TeamGame[], season: number, spec: TeamResearchSpec): ResearchSection {
  const base = { id: 'ranked', navLabel: 'Ranked opponents', title: 'Ranked opponents', sub: `${season} · AP poll rank at kickoff` };
  const ranked = games.filter((g) => g.opponentRank != null).sort((a, b) => a.start.localeCompare(b.start));
  if (!ranked.length) {
    return { ...base, rows: [], state: { kind: 'empty', title: 'No ranked opponents on the schedule', reason: `No opponent was in the AP poll at kickoff in ${season}.` } };
  }
  const played = ranked.filter((g) => g.state === 'final' && g.us != null && g.them != null);
  return {
    ...base,
    rows: [
      [
        {
          kind: 'table',
          key: 'ranked',
          title: played.length ? `${formatRecord(played, spec)} against ranked teams` : 'Ranked teams still to play',
          scope: `${ranked.length} ${ranked.length === 1 ? 'game' : 'games'}`,
          labelHeader: 'Opponent',
          fixedOrder: true,
          columns: [
            { key: 'rank', label: 'Rank', decimals: 0 },
            { key: 'date', label: 'Date', decimals: 0 },
            { key: 'result', label: 'Result', decimals: 0 },
            { key: 'note', label: 'Game', decimals: 0 },
          ],
          rows: ranked.map((g) => {
            const final = g.state === 'final' && g.us != null && g.them != null;
            const r = final ? gameResult(g, spec) : null;
            return {
              key: g.id,
              label: g.opponent.name,
              labelNote: g.home || g.neutral ? 'vs' : '@',
              imageUrl: g.opponent.logoUrl,
              href: `/cfb/team/${g.opponent.id}`,
              values: {
                rank: `No. ${g.opponentRank}`,
                date: new Date(`${g.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
                result: final ? `${r} ${g.us}-${g.them}` : g.state === 'postponed' ? 'Postponed' : 'To play',
                note: g.label,
              },
              ...(r === 'W' ? { tones: { result: 'good' as const } } : r === 'L' ? { tones: { result: 'bad' as const } } : {}),
            };
          }),
          caption: 'Advanced team stats (success rate, EPA) are not held for college football.',
        },
      ],
    ],
    state: { kind: 'ready' },
  };
}
