/**
 * Client-safe constructors turning a soccer team's real recent match
 * results (`EspnTeamSportGame`, already fetched for `recentResults`) into
 * real `PickCandidate`s — Moneyline and a combined-goals Total — so Team
 * Detail's windows/distribution/games sections run through the exact same
 * windowedStat machinery MLB's `teamFormCandidates.ts` uses. Direct port of
 * that file's own shape; see its header for why no parallel stat engine is
 * needed.
 */

import type { PickCandidate, HistoryEntry } from '@/lib/core/types';
import type { EspnTeamSportGame } from '@/lib/sports/multiSport/teamSportEspn';

export interface SoccerTeamFormCandidateInput {
  teamId: string;
  teamName: string;
  teamAbbr: string;
  teamLogoUrl?: string;
  /** Real completed matches, any order — sorted internally. */
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

function baseMeta(input: SoccerTeamFormCandidateInput): Record<string, unknown> {
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
  win: boolean | null;
  isDraw: boolean;
}

function resolveResults(teamId: string, games: EspnTeamSportGame[]): ResolvedResult[] {
  const completed = games.filter((g) => g.status?.completed === true);
  const sorted = [...completed].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return sorted.map((g) => {
    const isHome = g.homeTeamId === teamId;
    const scoreFor = (isHome ? g.homeScore : g.awayScore) ?? 0;
    const scoreAgainst = (isHome ? g.awayScore : g.homeScore) ?? 0;
    return {
      date: g.date,
      isHome,
      opponentAbbr: isHome ? g.awayAbbr : g.homeAbbr,
      scoreFor,
      scoreAgainst,
      win: scoreFor === scoreAgainst ? false : scoreFor > scoreAgainst,
      isDraw: scoreFor === scoreAgainst,
    };
  });
}

/** Win trend, same 1/0-against-0.5 encoding MLB's own moneyline candidate uses. A draw counts as "not a win" (0) for this trend — soccer's real 3-outcome result has no clean single win/loss line otherwise, and the real per-match `raw.isDraw` flag stays available for anything downstream that wants to distinguish a draw from a loss. */
export function buildSoccerMoneylineCandidate(input: SoccerTeamFormCandidateInput): PickCandidate | null {
  const results = resolveResults(input.teamId, input.games);
  if (results.length === 0) return null;
  const history: HistoryEntry[] = results.map((r, i) => ({
    period: i,
    result: r.win ? '1' : '0',
    category: r.win ? 'over' : 'under',
    periodLabel: `${shortDate(r.date)} ${r.isHome ? 'vs' : '@'} ${r.opponentAbbr}`,
    raw: { opponentAbbr: r.opponentAbbr, opponentLogoUrl: input.logoByAbbr?.[r.opponentAbbr], isHome: r.isHome, scoreFor: r.scoreFor, scoreAgainst: r.scoreAgainst, win: r.win, isDraw: r.isDraw },
  }));

  return {
    sport: 'soccer',
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

/** Combined final score (goals for + against) of each real past match — soccer's equivalent of MLB's run-total candidate, same "today's posted line, else the team's own recent scoring pace" fallback. */
export function buildSoccerGameTotalCandidate(input: SoccerTeamFormCandidateInput, todaysTotalLine?: number | null): PickCandidate | null {
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
    sport: 'soccer',
    subjectId: `team-${input.teamId}`,
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

/** Team's own goals-scored, real per-match — the soccer-appropriate analogue of "team total" scoped to just this team's attack, since the combined-score total above mixes both sides. Useful as its own window/distribution candidate the way MLB's team-total-runs is scoped to runs *for* only when displayed per-team. */
export function buildSoccerGoalsForCandidate(input: SoccerTeamFormCandidateInput): PickCandidate | null {
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
    sport: 'soccer',
    subjectId: `team-${input.teamId}`,
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
