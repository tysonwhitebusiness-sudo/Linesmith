/**
 * Client-safe (no fetch, no server-only imports) constructors that turn a
 * team's `RecentGameResult[]` into real `PickCandidate`s — Moneyline and
 * game Total — so they run through the exact same windowedStat/
 * DistributionChart machinery a player's props already use. No parallel
 * stat engine: `entryValue`/`categoriseByLine` read a history entry's
 * `result` token generically, so a win/loss or a run total slots in the
 * same way a batter's hit count does.
 */

import type { PickCandidate, HistoryEntry } from '../../core/types';
import type { RecentGameResult } from './statsapi';

function mlbTeamLogoUrl(teamId: number): string {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export interface TeamFormCandidateInput {
  teamId: number;
  teamName: string;
  teamAbbr: string;
  /** Most-recent-first, as returned by /api/mlb/team-form. */
  results: RecentGameResult[];
  /** Today's game, when this team is playing. */
  today?: { opponentId: number; opponentAbbr: string; isHome: boolean; gamePk: number | string } | null;
  /** Today's posted game total, when available. */
  todaysTotalLine?: number | null;
}

const PRE_LIVE_STATE = { status: 'pre' as const, distanceToSubject: null, distanceUnit: 'games' as const, etaMinutes: null, etaConfidence: null };

function baseMeta(input: TeamFormCandidateInput): Record<string, unknown> {
  return {
    team: input.teamAbbr,
    teamLogoUrl: mlbTeamLogoUrl(input.teamId),
    opponent: input.today?.opponentAbbr,
    opponentId: input.today?.opponentId,
    opponentLogoUrl: input.today?.opponentId != null ? mlbTeamLogoUrl(input.today.opponentId) : undefined,
    isHome: input.today?.isHome,
    gamePk: input.today?.gamePk,
    isTeamCandidate: true,
  };
}

/** Ascending (oldest first) — the API returns most-recent-first, but windowedStat's fixed windows read the tail as "most recent". */
function ascending(results: RecentGameResult[]): RecentGameResult[] {
  return [...results].reverse();
}

/** Win/loss trend. Encoded as 1/0 against a fixed 0.5 line so "over" = win, reusing entryValue's plain-integer parsing rather than a bespoke win/loss category. */
export function buildMoneylineCandidate(input: TeamFormCandidateInput): PickCandidate | null {
  if (input.results.length === 0) return null;
  const history: HistoryEntry[] = ascending(input.results).map((r, i) => ({
    period: i,
    result: r.win ? '1' : '0',
    category: r.win ? 'over' : 'under',
    periodLabel: `${shortDate(r.date)} ${r.isHome ? 'vs' : '@'} ${r.opponentAbbr}`,
    raw: { opponentId: r.opponentId, isHome: r.isHome, runsFor: r.runsFor, runsAgainst: r.runsAgainst, win: r.win },
  }));

  return {
    sport: 'mlb',
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

/** Combined final score of each past game, measured against today's posted total (or, lacking one, the team's own recent scoring pace — a real number, just not tied to a specific book price). */
export function buildGameTotalCandidate(input: TeamFormCandidateInput): PickCandidate | null {
  if (input.results.length === 0) return null;
  const ordered = ascending(input.results);

  const line =
    input.todaysTotalLine ??
    (() => {
      const window = ordered.slice(-15);
      const avg = window.reduce((sum, r) => sum + r.runsFor + r.runsAgainst, 0) / window.length;
      return Math.round(avg * 2) / 2;
    })();

  const history: HistoryEntry[] = ordered.map((r, i) => {
    const total = r.runsFor + r.runsAgainst;
    return {
      period: i,
      result: String(total),
      category: total > line ? 'over' : 'under',
      periodLabel: `${shortDate(r.date)} ${r.isHome ? 'vs' : '@'} ${r.opponentAbbr}`,
      raw: { opponentId: r.opponentId, isHome: r.isHome, runsFor: r.runsFor, runsAgainst: r.runsAgainst },
    };
  });

  return {
    sport: 'mlb',
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
