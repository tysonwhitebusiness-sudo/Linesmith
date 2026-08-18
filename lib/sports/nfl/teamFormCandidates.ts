/**
 * NFL's version of `lib/sports/mlb/teamFormCandidates.ts` — turns a team's
 * real `NflverseGame[]` (getTeamRecentResults, nflverse.ts) into real
 * `PickCandidate`s (Moneyline, Total, Team Total Points), same shape MLB
 * already proves out: `buildMoneylineCandidate` needs no price at all
 * (binary win/loss, fixed 0.5 line); `buildGameTotalCandidate` falls back to
 * a real computed average when no live line is posted. This is what
 * actually unlocks Team Detail's window boxes/distribution chart/games
 * table/filter chips — see this session's plan file for the full context.
 */

import type { PickCandidate, HistoryEntry } from '@/lib/core/types';
import type { NflverseGame } from './nflverse';

// Local copy rather than importing components/SubjectAvatar.tsx's version —
// MLB's teamFormCandidates.ts makes the same choice (its own local
// mlbTeamLogoUrl) specifically to keep this server-side data module clear
// of any 'use client' boundary.
function nflTeamLogoUrl(abbreviation: string): string {
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${abbreviation.toLowerCase()}.png`;
}

// "MM/DD" rather than the locale's "Nov 2" — DistributionChart's bar label
// (PlayerDetail.tsx) takes only the first whitespace-delimited token of
// periodLabel, so a space inside the date itself silently truncated every
// bar down to just the month.
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export interface NflTeamFormInput {
  teamId: number;
  teamName: string;
  teamAbbr: string;
  /** Most-recent-first, as returned by getTeamRecentResults. */
  results: NflverseGame[];
  today?: { opponentAbbr: string; isHome: boolean; gamePk: string } | null;
  /** Live posted total, when a real NFL game-line source has one — see the plan's "real game lines" follow-up. */
  todaysTotalLine?: number | null;
}

const PRE_LIVE_STATE = { status: 'pre' as const, distanceToSubject: null, distanceUnit: 'games' as const, etaMinutes: null, etaConfidence: null };

function baseMeta(input: NflTeamFormInput): Record<string, unknown> {
  return {
    team: input.teamAbbr,
    teamLogoUrl: nflTeamLogoUrl(input.teamAbbr),
    opponent: input.today?.opponentAbbr,
    opponentLogoUrl: input.today?.opponentAbbr ? nflTeamLogoUrl(input.today.opponentAbbr) : undefined,
    isHome: input.today?.isHome,
    gamePk: input.today?.gamePk,
    isTeamCandidate: true,
  };
}

function ascending(results: NflverseGame[]): NflverseGame[] {
  return [...results].reverse();
}

function teamScoreOf(g: NflverseGame, teamAbbr: string): { own: number; opp: number } {
  const isHome = g.homeTeam === teamAbbr;
  return { own: (isHome ? g.homeScore : g.awayScore) ?? 0, opp: (isHome ? g.awayScore : g.homeScore) ?? 0 };
}

function opponentAbbrOf(g: NflverseGame, teamAbbr: string): string {
  return g.homeTeam === teamAbbr ? g.awayTeam : g.homeTeam;
}

/** Win/loss trend — no price needed, direct NFL port of MLB's version. */
export function buildNflMoneylineCandidate(input: NflTeamFormInput): PickCandidate | null {
  if (input.results.length === 0) return null;
  const history: HistoryEntry[] = ascending(input.results).map((g, i) => {
    const { own, opp } = teamScoreOf(g, input.teamAbbr);
    const win = own > opp;
    const oppAbbr = opponentAbbrOf(g, input.teamAbbr);
    return {
      period: i,
      result: win ? '1' : '0',
      category: win ? 'over' : 'under',
      periodLabel: `${shortDate(g.gameday)} ${g.homeTeam === input.teamAbbr ? 'vs' : '@'} ${oppAbbr}`,
      raw: { opponentAbbr: oppAbbr, isHome: g.homeTeam === input.teamAbbr, pointsFor: own, pointsAgainst: opp, win },
    };
  });

  return {
    sport: 'nfl',
    subjectId: `team-${input.teamId}`,
    subjectName: input.teamName,
    subjectMeta: baseMeta(input),
    dimension: 'moneyline',
    dimensionLabel: 'Moneyline',
    category: 'win',
    categoryLabel: 'Win',
    line: 0.5,
    history,
    consistent: false,
    sampleSize: history.length,
    liveState: PRE_LIVE_STATE,
  };
}

/** Combined final score vs. a live total when posted, else the real average of the last games played — same fallback MLB's version uses. */
export function buildNflGameTotalCandidate(input: NflTeamFormInput): PickCandidate | null {
  if (input.results.length === 0) return null;
  const ordered = ascending(input.results);

  const line =
    input.todaysTotalLine ??
    (() => {
      const window = ordered.slice(-15);
      const avg = window.reduce((sum, g) => {
        const { own, opp } = teamScoreOf(g, input.teamAbbr);
        return sum + own + opp;
      }, 0) / window.length;
      return Math.round(avg * 2) / 2;
    })();

  const history: HistoryEntry[] = ordered.map((g, i) => {
    const { own, opp } = teamScoreOf(g, input.teamAbbr);
    const total = own + opp;
    const oppAbbr = opponentAbbrOf(g, input.teamAbbr);
    return {
      period: i,
      result: String(total),
      category: total > line ? 'over' : 'under',
      periodLabel: `${shortDate(g.gameday)} ${g.homeTeam === input.teamAbbr ? 'vs' : '@'} ${oppAbbr}`,
      raw: { opponentAbbr: oppAbbr, isHome: g.homeTeam === input.teamAbbr, pointsFor: own, pointsAgainst: opp },
    };
  });

  return {
    sport: 'nfl',
    subjectId: `team-${input.teamId}`,
    subjectName: input.teamName,
    subjectMeta: baseMeta(input),
    dimension: 'game-total',
    dimensionLabel: 'Total',
    category: 'over',
    categoryLabel: 'Over',
    line,
    history,
    consistent: false,
    sampleSize: history.length,
    liveState: PRE_LIVE_STATE,
  };
}

/** Team's own points scored — "Team Total Points", NFL's version of MLB's "Team Total Runs" (adapter.ts's TEAM_STAT_MARKETS pattern). */
export function buildNflTeamTotalCandidate(input: NflTeamFormInput): PickCandidate | null {
  if (input.results.length === 0) return null;
  const ordered = ascending(input.results);
  const DEFAULT_LINE = 21.5; // typical NFL team-total line, same role as MLB's 4.5 default

  const history: HistoryEntry[] = ordered.map((g, i) => {
    const { own, opp } = teamScoreOf(g, input.teamAbbr);
    const oppAbbr = opponentAbbrOf(g, input.teamAbbr);
    return {
      period: i,
      result: String(own),
      category: own > DEFAULT_LINE ? 'over' : 'under',
      periodLabel: `${shortDate(g.gameday)} ${g.homeTeam === input.teamAbbr ? 'vs' : '@'} ${oppAbbr}`,
      raw: { opponentAbbr: oppAbbr, isHome: g.homeTeam === input.teamAbbr, pointsFor: own, pointsAgainst: opp },
    };
  });

  return {
    sport: 'nfl',
    subjectId: `team-${input.teamId}`,
    subjectName: input.teamName,
    subjectMeta: baseMeta(input),
    dimension: 'team-total-points',
    dimensionLabel: 'Team Total Points',
    category: 'over',
    categoryLabel: 'Over',
    line: DEFAULT_LINE,
    history,
    consistent: false,
    sampleSize: history.length,
    liveState: PRE_LIVE_STATE,
  };
}
