/**
 * Client-safe constructors turning an NHL team's real recent results
 * (`NhlGame`, nhle.ts's own real schedule shape) into real `PickCandidate`s
 * — Moneyline and a combined-goals Total — same `teamFormCandidates.ts`
 * pattern every other sport's team adapter uses.
 */

import type { PickCandidate, HistoryEntry } from '@/lib/core/types';
import type { NhlGame } from '@/lib/sports/nhl/nhle';

/**
 * Local copy of `nhle.ts`'s `isNhlGameCompleted` — that module also pulls
 * in `lib/db/client.ts` (the Postgres driver, server-only, uses `tls`),
 * which breaks the client bundle when imported as a *value* from a
 * client-rendered adapter (`TeamDetail.tsx`). A type-only import of
 * `NhlGame` is erased at build time and stays safe; this one function
 * can't be, so it's duplicated instead.
 */
function isNhlGameCompleted(gameState: string): boolean {
  return gameState === 'OFF' || gameState === 'FINAL';
}

export interface NhlTeamFormCandidateInput {
  teamAbbr: string;
  teamName: string;
  teamLogoUrl?: string;
  games: NhlGame[];
  today?: { opponentAbbr: string; opponentLogoUrl?: string; isHome: boolean; gamePk: string } | null;
  /** Real logo per real opponent abbreviation (2026-08-24) — the Team Detail distribution chart's `logoFor` reads this off each history entry's `raw`, same as the player-level chart's own opponent logos. */
  logoByAbbr?: Record<string, string>;
}

const PRE_LIVE_STATE = { status: 'pre' as const, distanceToSubject: null, distanceUnit: 'games' as const, etaMinutes: null, etaConfidence: null };

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function baseMeta(input: NhlTeamFormCandidateInput): Record<string, unknown> {
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

function resolveResults(teamAbbr: string, games: NhlGame[]): ResolvedResult[] {
  const completed = games.filter((g) => isNhlGameCompleted(g.gameState) && g.homeScore != null && g.awayScore != null);
  const sorted = [...completed].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return sorted.map((g) => {
    const isHome = g.homeAbbr === teamAbbr;
    const scoreFor = (isHome ? g.homeScore : g.awayScore) ?? 0;
    const scoreAgainst = (isHome ? g.awayScore : g.homeScore) ?? 0;
    return { date: g.date, isHome, opponentAbbr: isHome ? g.awayAbbr : g.homeAbbr, scoreFor, scoreAgainst, win: scoreFor > scoreAgainst };
  });
}

export function buildNhlMoneylineCandidate(input: NhlTeamFormCandidateInput): PickCandidate | null {
  const results = resolveResults(input.teamAbbr, input.games);
  if (results.length === 0) return null;
  const history: HistoryEntry[] = results.map((r, i) => ({
    period: i,
    result: r.win ? '1' : '0',
    category: r.win ? 'over' : 'under',
    periodLabel: `${shortDate(r.date)} ${r.isHome ? 'vs' : '@'} ${r.opponentAbbr}`,
    raw: { opponentAbbr: r.opponentAbbr, opponentLogoUrl: input.logoByAbbr?.[r.opponentAbbr], isHome: r.isHome, scoreFor: r.scoreFor, scoreAgainst: r.scoreAgainst, win: r.win },
  }));

  return {
    sport: 'nhl',
    subjectId: `team-${input.teamAbbr}`,
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

export function buildNhlGameTotalCandidate(input: NhlTeamFormCandidateInput): PickCandidate | null {
  const results = resolveResults(input.teamAbbr, input.games);
  if (results.length === 0) return null;

  const window = results.slice(-15);
  const avg = window.reduce((sum, r) => sum + r.scoreFor + r.scoreAgainst, 0) / window.length;
  const line = Math.round(avg * 2) / 2;

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
    sport: 'nhl',
    subjectId: `team-${input.teamAbbr}`,
    subjectName: input.teamName,
    subjectMeta: baseMeta(input),
    dimension: 'game-total',
    dimensionLabel: 'Total Goals',
    category: 'over',
    categoryLabel: 'Over',
    line,
    history,
    consistent: false,
    sampleSize: history.length,
    liveState: PRE_LIVE_STATE,
  };
}

export function buildNhlGoalsForCandidate(input: NhlTeamFormCandidateInput): PickCandidate | null {
  const results = resolveResults(input.teamAbbr, input.games);
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
    sport: 'nhl',
    subjectId: `team-${input.teamAbbr}`,
    subjectName: input.teamName,
    subjectMeta: baseMeta(input),
    dimension: 'team-goals-for',
    dimensionLabel: 'Goals Scored',
    category: 'over',
    categoryLabel: 'Over',
    line,
    history,
    consistent: false,
    sampleSize: history.length,
    liveState: PRE_LIVE_STATE,
  };
}
