/**
 * Client-safe constructors turning a CFB team's real recent results
 * (`EspnTeamSportGame`, already fetched for `recentResults`) into real
 * `PickCandidate`s — Moneyline and a combined-points Total — so Team
 * Detail's windows/distribution/games sections run through the same
 * windowedStat machinery MLB's/soccer's own `teamFormCandidates.ts` files
 * use. Direct port of soccer's file, football-shaped (points, not goals).
 */

import type { PickCandidate, HistoryEntry } from '@/lib/core/types';
import type { EspnTeamSportGame } from '@/lib/sports/multiSport/teamSportEspn';

export interface CfbTeamFormCandidateInput {
  teamId: string;
  teamName: string;
  teamAbbr: string;
  teamLogoUrl?: string;
  games: EspnTeamSportGame[];
  today?: { opponentAbbr: string; opponentLogoUrl?: string; isHome: boolean; gamePk: string } | null;
  /** Real logo per real opponent abbreviation (2026-08-24) — the Team Detail distribution chart's `logoFor` reads this off each history entry's `raw`, same as the player-level chart's own opponent logos. */
  logoByAbbr?: Record<string, string>;
}

const PRE_LIVE_STATE = { status: 'pre' as const, distanceToSubject: null, distanceUnit: 'games' as const, etaMinutes: null, etaConfidence: null };

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function baseMeta(input: CfbTeamFormCandidateInput): Record<string, unknown> {
  return {
    team: input.teamAbbr,
    teamLogoUrl: input.teamLogoUrl,
    opponent: input.today?.opponentAbbr,
    opponentLogoUrl: input.today?.opponentLogoUrl,
    isHome: input.today?.isHome,
    gamePk: input.today?.gamePk,
    isTeamCandidate: true,
  };
}

interface ResolvedResult {
  date: string;
  isHome: boolean;
  opponentAbbr: string;
  scoreFor: number;
  scoreAgainst: number;
  win: boolean;
}

function resolveResults(teamId: string, games: EspnTeamSportGame[]): ResolvedResult[] {
  const completed = games.filter((g) => g.status?.completed === true);
  const sorted = [...completed].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return sorted.map((g) => {
    const isHome = g.homeTeamId === teamId;
    const scoreFor = (isHome ? g.homeScore : g.awayScore) ?? 0;
    const scoreAgainst = (isHome ? g.awayScore : g.homeScore) ?? 0;
    return { date: g.date, isHome, opponentAbbr: isHome ? g.awayAbbr : g.homeAbbr, scoreFor, scoreAgainst, win: scoreFor > scoreAgainst };
  });
}

export function buildCfbMoneylineCandidate(input: CfbTeamFormCandidateInput): PickCandidate | null {
  const results = resolveResults(input.teamId, input.games);
  if (results.length === 0) return null;
  const history: HistoryEntry[] = results.map((r, i) => ({
    period: i,
    result: r.win ? '1' : '0',
    category: r.win ? 'over' : 'under',
    periodLabel: `${shortDate(r.date)} ${r.isHome ? 'vs' : '@'} ${r.opponentAbbr}`,
    raw: { opponentAbbr: r.opponentAbbr, opponentLogoUrl: input.logoByAbbr?.[r.opponentAbbr], isHome: r.isHome, scoreFor: r.scoreFor, scoreAgainst: r.scoreAgainst, win: r.win },
  }));

  return {
    sport: 'cfb',
    subjectId: `team-${input.teamId}`,
    subjectName: input.teamName,
    subjectMeta: baseMeta(input),
    dimension: 'moneyline',
    dimensionLabel: 'Win',
    category: 'win',
    categoryLabel: 'Win',
    line: 0.5,
    history,
    consistent: false,
    sampleSize: history.length,
    liveState: PRE_LIVE_STATE,
  };
}

export function buildCfbGameTotalCandidate(input: CfbTeamFormCandidateInput, todaysTotalLine?: number | null): PickCandidate | null {
  const results = resolveResults(input.teamId, input.games);
  if (results.length === 0) return null;

  const line =
    todaysTotalLine ??
    (() => {
      const window = results.slice(-15);
      const avg = window.reduce((sum, r) => sum + r.scoreFor + r.scoreAgainst, 0) / window.length;
      return Math.round(avg * 2) / 2;
    })();

  const history: HistoryEntry[] = results.map((r, i) => {
    const total = r.scoreFor + r.scoreAgainst;
    return {
      period: i,
      result: String(total),
      category: total > line ? 'over' : 'under',
      periodLabel: `${shortDate(r.date)} ${r.isHome ? 'vs' : '@'} ${r.opponentAbbr}`,
      raw: { opponentAbbr: r.opponentAbbr, opponentLogoUrl: input.logoByAbbr?.[r.opponentAbbr], isHome: r.isHome, scoreFor: r.scoreFor, scoreAgainst: r.scoreAgainst },
    };
  });

  return {
    sport: 'cfb',
    subjectId: `team-${input.teamId}`,
    subjectName: input.teamName,
    subjectMeta: baseMeta(input),
    dimension: 'game-total',
    dimensionLabel: 'Total Points',
    category: 'over',
    categoryLabel: 'Over',
    line,
    history,
    consistent: false,
    sampleSize: history.length,
    liveState: PRE_LIVE_STATE,
  };
}

/** Team's own points-scored, real per-game — analogous to soccer's goals-for candidate, scoped to just this team's offense. */
export function buildCfbPointsForCandidate(input: CfbTeamFormCandidateInput): PickCandidate | null {
  const results = resolveResults(input.teamId, input.games);
  if (results.length === 0) return null;

  const window = results.slice(-15);
  const avg = window.reduce((sum, r) => sum + r.scoreFor, 0) / window.length;
  const line = Math.round(avg * 2) / 2;

  const history: HistoryEntry[] = results.map((r, i) => ({
    period: i,
    result: String(r.scoreFor),
    category: r.scoreFor > line ? 'over' : 'under',
    periodLabel: `${shortDate(r.date)} ${r.isHome ? 'vs' : '@'} ${r.opponentAbbr}`,
    raw: { opponentAbbr: r.opponentAbbr, opponentLogoUrl: input.logoByAbbr?.[r.opponentAbbr], isHome: r.isHome, scoreFor: r.scoreFor, scoreAgainst: r.scoreAgainst },
  }));

  return {
    sport: 'cfb',
    subjectId: `team-${input.teamId}`,
    subjectName: input.teamName,
    subjectMeta: baseMeta(input),
    dimension: 'team-points-for',
    dimensionLabel: 'Points Scored',
    category: 'over',
    categoryLabel: 'Over',
    line,
    history,
    consistent: false,
    sampleSize: history.length,
    liveState: PRE_LIVE_STATE,
  };
}
