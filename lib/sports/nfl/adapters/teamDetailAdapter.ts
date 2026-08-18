/**
 * `TeamDetail.tsx` adapter — NFL half.
 *
 * Converts the real `/api/nfl/team/[teamId]` response (fetched by
 * `useNflTeamDetail`, the extracted hook — see that file's header) plus the
 * UI-selected scope state `TeamDetail.tsx` owns into the shared
 * `TeamDetailData` interface defined in
 * `lib/sports/mlb/adapters/teamDetailAdapter.ts`. Ported field-for-field from
 * the old `NflTeamDetail.tsx` (deleted once this adapter + the generic
 * `TeamDetail.tsx` are verified) — no new behavior invented here.
 */

import type { PickCandidate } from '@/lib/core/types';
import {
  categoriseByLine,
  entryValue,
  fixedWindow,
  openWindow,
  OVER,
  subsetWindow,
  UNDER,
  type WindowedStat,
} from '@/lib/core/windowedStat';
import { directionMark } from '@/components/MarketLabel';
import { nflTeamLogoUrl } from '@/components/SubjectAvatar';
import { MATCHUP_GROUP_BY_POSITION, playerMatchupRows } from '@/components/NflPlayerVsDefenseCard';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import type { TeamGrade } from '@/lib/sports/nfl/nflTeamGrades';
import type { NflTeamDetailApiResponse, NflTeamStatLine } from '@/components/useNflTeamDetail';
import type {
  GameRow,
  RosterPlayer,
  TeamDetailData,
  TeamDistributionChartData,
  TeamMatchupData,
  TeamNextGame,
  TeamWindowedForm,
} from '@/lib/sports/mlb/adapters/teamDetailAdapter';

const NFL_TEAM_COUNT = 32;

/** Matchup group -> the opponent defense grade that group actually measures — ported from `NflTeamDetail.tsx:33-37`. */
const GROUP_TO_GRADE_KEY: Record<string, { key: keyof import('@/lib/sports/nfl/nflTeamGrades').TeamGrades; label: string }> = {
  Passing: { key: 'secondary', label: 'Pass D' },
  Rushing: { key: 'dLine', label: 'Run D' },
  Receiving: { key: 'secondary', label: 'Pass D' },
};

/** Team's own stat group -> its offense grade — ported from `NflTeamDetail.tsx:617-623`. */
const STAT_GROUP_TO_GRADE_KEY: Record<string, keyof import('@/lib/sports/nfl/nflTeamGrades').TeamGrades | null> = {
  Scoring: null,
  Passing: 'passingOffense',
  Rushing: 'rushingOffense',
  Receiving: 'receivingOffense',
  Defense: 'defense',
};

function toStatRow(l: NflTeamStatLine): OpposingStarterStat {
  return { key: l.key, label: l.label, value: l.value, decimals: l.decimals, rank: l.rank, poolSize: NFL_TEAM_COUNT };
}

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

function seasonLineText(p: NflTeamDetailApiResponse['roster'][number]): string {
  const s = p.seasonStats;
  if (!s || s.games === 0) return 'No stats yet this season';
  switch (p.position) {
    case 'QB':
      return `${s.passingYards} pass yds · ${s.passingTds} pass TD`;
    case 'RB':
    case 'FB':
      return `${s.rushingYards} rush yds · ${s.rushingTds} rush TD`;
    case 'WR':
    case 'TE':
      return `${s.receptions} rec · ${s.receivingYards} rec yds`;
    default:
      return `${s.games} games played`;
  }
}

export interface NflTeamDetailScope {
  market: string | undefined;
  lineOffset: number;
  opponentOnly: boolean;
  venue: 'all' | 'home' | 'away';
  lastN: number | 'all';
  /** `null` defaults to the roster's own QB, or else the highest-yardage skill player — same fallback `defaultMatchupPlayer` (`NflTeamDetail.tsx:259-268`) already computes. */
  matchupPlayerId: string | null;
}

export interface NflTeamDetailInput {
  data: NflTeamDetailApiResponse;
  scope: NflTeamDetailScope;
  standingsTeams: import('@/components/useAllTeams').TeamStandingRow[];
}

export function toTeamDetailData(input: NflTeamDetailInput): TeamDetailData {
  const { data, scope, standingsTeams } = input;
  const { team, teamStats, nextGame, opponentDefenseAllowed, recentResults, grades, opponentGrades } = data;
  const logoUrl = team.logoUrl ?? nflTeamLogoUrl(team.abbreviation) ?? '';
  const opponentAbbr = data.opponentAbbr;

  const candidates = [data.candidates.moneyline, data.candidates.total, data.candidates.teamTotal].filter(
    (c): c is PickCandidate => c != null,
  );

  const active = candidates.find((c) => c.dimension === scope.market) ?? candidates[0] ?? null;
  const wantOver = active ? directionMark(active.category) !== 'U' : true;
  const baseLine = active?.line ?? 0.5;
  const line = Math.max(0, baseLine + scope.lineOffset);
  const isMoneylineMarket = active?.dimension === 'moneyline';

  const scoped: PickCandidate['history'] = (() => {
    if (!active) return [];
    let list = active.history;
    if (scope.opponentOnly && opponentAbbr) {
      list = list.filter((e) => (rawOf(e).opponentAbbr as string | undefined) === opponentAbbr);
    }
    if (scope.venue !== 'all') list = list.filter((e) => rawOf(e).isHome === (scope.venue === 'home'));
    if (scope.lastN !== 'all') list = list.slice(-scope.lastN);
    return list;
  })();

  const measured = categoriseByLine(scoped, line);
  const wanted = wantOver ? OVER : UNDER;

  const windows: TeamWindowedForm | null = active
    ? {
        l5: fixedWindow(measured, wanted, 5),
        l10: fixedWindow(measured, wanted, 10),
        l15: fixedWindow(measured, wanted, 15),
        szn: openWindow(measured, wanted, { minimum: 1 }),
        h2h:
          !opponentAbbr
            ? ({ status: 'insufficient', available: 0, required: 1 } as WindowedStat)
            : subsetWindow(categoriseByLine(active.history, line), wanted, (e) => (rawOf(e).opponentAbbr as string | undefined) === opponentAbbr, { minimum: 1 }),
      }
    : null;

  const gameRows: GameRow[] = scoped.map((entry, index) => {
    const value = entryValue(entry);
    const cleared = value == null ? null : wantOver ? value > line : value <= line;
    const oppAbbr = rawOf(entry).opponentAbbr as string | undefined;
    const resultText = isMoneylineMarket ? (value === 1 ? 'W' : value === 0 ? 'L' : '—') : value != null ? String(value) : '—';
    return {
      key: `${entry.period}-${index}`,
      periodLabel: entry.periodLabel ?? '',
      opponentTeamId: null,
      opponentLogoUrl: nflTeamLogoUrl(oppAbbr),
      value,
      resultText,
      cleared,
    };
  });

  const distribution: TeamDistributionChartData | null = active
    ? {
        history: scoped,
        line,
        wantOver,
        refreshKey: `${active.dimension}|${line}|${scope.opponentOnly}|${scope.venue}|${scope.lastN}|${team.teamId}`,
        logoFor: (entry) => nflTeamLogoUrl(rawOf(entry).opponentAbbr as string | undefined),
      }
    : null;

  // Team stats — 5 groups, each with its own optional offense/defense grade (NflTeamDetail.tsx:612-638).
  const statGroups: { label: string; stats: OpposingStarterStat[]; grade?: TeamGrade | null }[] = [
    { label: 'Scoring', rows: teamStats.filter((s) => s.group === 'Scoring') },
    { label: 'Passing', rows: teamStats.filter((s) => s.group === 'Passing') },
    { label: 'Rushing', rows: teamStats.filter((s) => s.group === 'Rushing') },
    { label: 'Receiving', rows: teamStats.filter((s) => s.group === 'Receiving') },
    { label: 'Defense', rows: teamStats.filter((s) => s.group === 'Defense') },
  ]
    .filter((g) => g.rows.length > 0)
    .map((g) => {
      const gradeKey = STAT_GROUP_TO_GRADE_KEY[g.label];
      return { label: g.label, stats: g.rows.map(toStatRow), grade: gradeKey ? grades?.[gradeKey] ?? null : undefined };
    });

  // Matchup — team offense vs. opponent defense, or one skill-position
  // player's own numbers against the same opponent group (NflTeamDetail.tsx:543-610).
  const opponentPassingAllowed = opponentDefenseAllowed.filter((s) => s.group === 'Passing');
  const opponentRushingAllowed = opponentDefenseAllowed.filter((s) => s.group === 'Rushing');
  const opponentReceivingAllowed = opponentDefenseAllowed.filter((s) => s.group === 'Receiving');

  const teamMatchup =
    opponentAbbr && opponentDefenseAllowed.length > 0
      ? {
          title: 'Team matchup — offense vs. defense',
          subjectName: team.displayName,
          subjectHeadshotUrl: logoUrl,
          subjectTeamAbbr: team.abbreviation,
          subjectTeamLogoUrl: logoUrl,
          subjectStats: [...teamStats.filter((s) => s.group === 'Passing' || s.group === 'Rushing' || s.group === 'Receiving')].map(toStatRow),
          subjectRoleLabel: 'Produces',
          opponentName: `${opponentAbbr} defense`,
          opponentHeadshotUrl: nflTeamLogoUrl(opponentAbbr),
          opponentTeamAbbr: opponentAbbr,
          opponentTeamLogoUrl: nflTeamLogoUrl(opponentAbbr),
          opponentStats: opponentDefenseAllowed.map(toStatRow),
          opponentRoleLabel: 'Allows',
        }
      : null;

  const matchupEligibleRoster = data.roster.filter(
    (p) => p.position && MATCHUP_GROUP_BY_POSITION[p.position] && p.seasonStats && p.seasonStats.games > 0,
  );
  const defaultMatchupPlayer = (() => {
    if (matchupEligibleRoster.length === 0) return null;
    const qb = matchupEligibleRoster.find((p) => p.position === 'QB');
    if (qb) return qb;
    return [...matchupEligibleRoster].sort(
      (a, b) => b.seasonStats!.receivingYards + b.seasonStats!.rushingYards - (a.seasonStats!.receivingYards + a.seasonStats!.rushingYards),
    )[0];
  })();
  const matchupPlayer = matchupEligibleRoster.find((p) => p.subjectId === scope.matchupPlayerId) ?? defaultMatchupPlayer ?? null;
  const matchupPlayerGroups = matchupPlayer?.position ? MATCHUP_GROUP_BY_POSITION[matchupPlayer.position] ?? [] : [];
  const matchupPlayerOpponentStats = [
    ...(matchupPlayerGroups.includes('Passing') ? opponentPassingAllowed : []),
    ...(matchupPlayerGroups.includes('Rushing') ? opponentRushingAllowed : []),
    ...(matchupPlayerGroups.includes('Receiving') ? opponentReceivingAllowed : []),
  ].map(toStatRow);
  const selectedPlayerCard =
    matchupPlayer && opponentAbbr
      ? {
          playerName: matchupPlayer.fullName,
          playerHeadshotUrl: matchupPlayer.headshotUrl ?? undefined,
          playerFallbackUrl: logoUrl,
          playerTeamAbbr: team.abbreviation,
          playerTeamLogoUrl: logoUrl,
          ownRows: playerMatchupRows(matchupPlayer.seasonStats, matchupPlayer.position),
          opponentAbbr,
          opponentLogoUrl: nflTeamLogoUrl(opponentAbbr),
          opponentStats: matchupPlayerOpponentStats,
        }
      : null;
  const selectedPlayerGradeBadges = [
    ...new Map(matchupPlayerGroups.map((g) => GROUP_TO_GRADE_KEY[g]).filter(Boolean).map((g) => [g.key, g])).values(),
  ].map((g) => ({ label: `${opponentAbbr ?? ''} ${g.label}`.trim(), grade: opponentGrades?.[g.key] ?? null }));

  const matchup: TeamMatchupData | null = opponentAbbr
    ? {
        tabs: [
          { key: 'team', label: 'Team matchup' },
          { key: 'player', label: 'Player matchup' },
        ],
        team: teamMatchup,
        teamGradeBadges: opponentGrades ? [{ label: `${opponentAbbr} DEF`, grade: opponentGrades.defense }] : [],
        playerOptions: matchupEligibleRoster.map((p) => ({ id: p.subjectId, label: `${p.fullName} (${p.position})` })),
        selectedPlayerId: matchupPlayer?.subjectId ?? null,
        selectedPlayerCard,
        selectedPlayerGradeBadges,
      }
    : null;

  const rosterPlayers: RosterPlayer[] = data.roster.map((p) => ({
    subjectId: p.subjectId,
    name: p.fullName,
    position: p.position ?? '',
    teamAbbr: team.abbreviation,
    headshotUrl: p.headshotUrl ?? undefined,
    seasonLineText: seasonLineText(p),
    hasStats: p.seasonStats != null && p.seasonStats.games > 0,
    href: `/nfl/player/${encodeURIComponent(p.subjectId)}`,
    rankBadge:
      p.positionRank != null && p.positionPoolSize != null
        ? { label: `#${p.positionRank}`, title: `${p.positionRank} of ${p.positionPoolSize} ${p.position ?? ''}` }
        : null,
  }));

  const nextGameData: TeamNextGame | null = nextGame
    ? {
        opponentAbbr: opponentAbbr ?? (nextGame.homeTeam === team.abbreviation ? nextGame.awayTeam : nextGame.homeTeam),
        opponentTeamId: null,
        opponentLogoUrl: nflTeamLogoUrl(opponentAbbr ?? (nextGame.homeTeam === team.abbreviation ? nextGame.awayTeam : nextGame.homeTeam)),
        isHome: nextGame.homeTeam === team.abbreviation,
        startTime: nextGame.gameday,
        moneyline: null,
        total: null,
        gameHref: `/nfl/game/${nextGame.gameId}`,
      }
    : null;

  const recentResultRows =
    recentResults.length > 0
      ? recentResults.map((g) => {
          const isHomeGame = g.homeTeam === team.abbreviation;
          const oppAbbr = isHomeGame ? g.awayTeam : g.homeTeam;
          const scoreFor = isHomeGame ? g.homeScore : g.awayScore;
          const scoreAgainst = isHomeGame ? g.awayScore : g.homeScore;
          return {
            gameId: g.gameId,
            date: g.gameday,
            win: scoreFor != null && scoreAgainst != null ? scoreFor > scoreAgainst : null,
            opponentAbbr: oppAbbr,
            isHome: isHomeGame,
            scoreFor: scoreFor ?? 0,
            scoreAgainst: scoreAgainst ?? 0,
          };
        })
      : null;

  return {
    team: { teamId: Number(team.teamId), name: team.displayName, abbr: team.abbreviation, logoUrl },
    record: { wins: team.wins, losses: team.losses, divisionRank: team.divisionRank ?? '' },
    grades,
    candidates,
    games: gameRows,
    windows,
    distribution,
    matchup,
    statGroups,
    roster: rosterPlayers,
    rosterSortByStats: true,
    rosterPageSize: 24,
    standingsTeams,
    nextGame: nextGameData,
    advancedStats: null,
    form: windows,
    recentResults: recentResultRows,
  };
}
