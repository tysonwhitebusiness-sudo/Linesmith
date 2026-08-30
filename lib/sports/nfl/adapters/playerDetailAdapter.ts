/**
 * `PlayerDetail.tsx` adapter — NFL half.
 *
 * Phase 3 of the sport-adapter project (see `docs/sport-adapter-design.md`
 * §3). Converts NFL's real data shapes into the shared `PlayerDetailData`
 * interface defined in the MLB adapter (`lib/sports/mlb/adapters/playerDetailAdapter.ts`),
 * same contract as the golf sibling. Ported field-for-field from
 * `NflPlayerDetail.tsx` (deleted once this adapter + the generic
 * `PlayerDetail.tsx` are verified) — no new behavior invented here.
 *
 * Unlike MLB's own hooks (`useLiveGame`, `useTeamStatcast`), NFL's rich data
 * (`seasonStats`, `seasonRanks`, `opponentDefenseAllowed`, position/side-of-
 * ball ranks, `weeklyBoxScores`) comes from `snapshot.subjects[].meta` (the
 * `richMeta` pattern, `NflPlayerDetail.tsx:178`), not a separate fetch — so
 * this adapter needs no new hook results threaded through `PlayerDetail.tsx`,
 * only `snapshot` (already a prop) plus the same `propOdds` shape MLB/golf
 * already take.
 */

import type { PickCandidate, Sport, SportSnapshot } from '@/lib/core/types';
import { toCareerH2H } from '@/lib/sports/shared/careerH2H';
import { toConditionsRole } from '@/lib/sports/shared/conditionsRole';
import {
  categoriseByLine,
  fixedWindow,
  openWindow,
  OVER,
  subsetWindow,
  UNDER,
  type WindowedStat,
} from '@/lib/core/windowedStat';
import { directionMark, marketText } from '@/components/MarketLabel';
import { nflTeamLogoUrl } from '@/components/SubjectAvatar';
import { teamPrimaryColor } from '@/lib/sports/nfl/teamColors';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import type { PropOddsRow } from '@/lib/db/client';
import type { PlayerSeasonRank, PlayerSeasonStats } from '@/lib/sports/nfl/nflverse';
import { MATCHUP_GROUP_BY_POSITION, playerMatchupRows } from '@/components/NflPlayerVsDefenseCard';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import type {
  ChipDef,
  GamelogColumnDef,
  GamelogRow,
  MatchupExplorerData,
  PlayerDetailChart,
  PlayerDetailData,
  PropOddsBoardProps,
  SummaryStat,
  WindowedStat5,
} from '@/lib/sports/mlb/adapters/playerDetailAdapter';

// ---------------------------------------------------------------------------
// NFL-specific helpers — ported byte-for-byte from `NflPlayerDetail.tsx`
// ---------------------------------------------------------------------------

const SIDE_OF_BALL_LABEL: Record<string, string> = {
  QB: 'offense', RB: 'offense', FB: 'offense', WR: 'offense', TE: 'offense',
  CB: 'defense', S: 'defense', SS: 'defense', FS: 'defense',
  LB: 'defense', OLB: 'defense', ILB: 'defense', MLB: 'defense',
  DE: 'defense', DT: 'defense', NT: 'defense',
  K: 'special teams', P: 'special teams',
};

const NFL_TEAM_COUNT = 32;

interface NflvStatLine {
  key: string;
  label: string;
  value: number;
  rank: number;
  decimals: number;
  group?: string;
}

function toStatRow(l: NflvStatLine): OpposingStarterStat {
  return { key: l.key, label: l.label, value: l.value, decimals: l.decimals, rank: l.rank, poolSize: NFL_TEAM_COUNT };
}

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

/** Local copy of `PlayerDetail.tsx`'s own exported `ordinal` — see the MLB adapter's identical copy for why (avoids a circular value-import). */
function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th');
  return `${rank}${suffix}`;
}

const GAMELOG_COLUMNS_BY_POSITION: Record<string, GamelogColumnDef[]> = {
  QB: [
    { key: 'completions', label: 'Cmp' },
    { key: 'attempts', label: 'Att' },
    { key: 'passingYards', label: 'Pass Yds' },
    { key: 'passingTds', label: 'Pass TD' },
    { key: 'interceptions', label: 'INT' },
    { key: 'rushingYards', label: 'Rush Yds' },
  ],
  RB: [
    { key: 'carries', label: 'Car' },
    { key: 'rushingYards', label: 'Rush Yds' },
    { key: 'rushingTds', label: 'Rush TD' },
    { key: 'receptions', label: 'Rec' },
    { key: 'receivingYards', label: 'Rec Yds' },
  ],
  FB: [
    { key: 'carries', label: 'Car' },
    { key: 'rushingYards', label: 'Rush Yds' },
    { key: 'rushingTds', label: 'Rush TD' },
    { key: 'receptions', label: 'Rec' },
    { key: 'receivingYards', label: 'Rec Yds' },
  ],
  WR: [
    { key: 'targets', label: 'Tgt' },
    { key: 'receptions', label: 'Rec' },
    { key: 'receivingYards', label: 'Rec Yds' },
    { key: 'receivingTds', label: 'Rec TD' },
  ],
  TE: [
    { key: 'targets', label: 'Tgt' },
    { key: 'receptions', label: 'Rec' },
    { key: 'receivingYards', label: 'Rec Yds' },
    { key: 'receivingTds', label: 'Rec TD' },
  ],
};

type SeasonRankMap = Partial<Record<'passingYards' | 'passingTds' | 'rushingYards' | 'rushingTds' | 'receptions' | 'receivingYards' | 'receivingTds', PlayerSeasonRank>>;

interface SeasonStatRow { key: string; label: string; value: number; rank?: PlayerSeasonRank }

function seasonTotalsRows(seasonStats: PlayerSeasonStats | undefined, position: string | undefined, seasonRanks: SeasonRankMap | undefined): SeasonStatRow[] {
  if (!seasonStats) return [];
  const r = (key: keyof SeasonRankMap, label: string, value: number): SeasonStatRow => ({ key, label, value, rank: seasonRanks?.[key] });
  switch (position) {
    case 'QB':
      return [
        { key: 'games', label: 'Games', value: seasonStats.games },
        r('passingYards', 'Pass Yds', seasonStats.passingYards),
        r('passingTds', 'Pass TD', seasonStats.passingTds),
        r('rushingYards', 'Rush Yds', seasonStats.rushingYards),
        r('rushingTds', 'Rush TD', seasonStats.rushingTds),
      ];
    case 'RB':
    case 'FB':
      return [
        { key: 'games', label: 'Games', value: seasonStats.games },
        r('rushingYards', 'Rush Yds', seasonStats.rushingYards),
        r('rushingTds', 'Rush TD', seasonStats.rushingTds),
        r('receptions', 'Receptions', seasonStats.receptions),
        r('receivingYards', 'Rec Yds', seasonStats.receivingYards),
      ];
    case 'WR':
    case 'TE':
      return [
        { key: 'games', label: 'Games', value: seasonStats.games },
        r('receptions', 'Receptions', seasonStats.receptions),
        r('receivingYards', 'Rec Yds', seasonStats.receivingYards),
        r('receivingTds', 'Rec TD', seasonStats.receivingTds),
      ];
    default:
      return [{ key: 'games', label: 'Games', value: seasonStats.games }];
  }
}

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

/** The interactive scope state `PlayerDetail.tsx` owns for NFL — mirrors `MlbPlayerDetailScope` minus the fields NFL has no equivalent of (no `venue`, no `kpiScope`). */
export interface NflPlayerDetailScope {
  lineOffset: number;
  opponentOnly: boolean;
  lastN: number | 'all';
  showAllGames: boolean;
  kpiScope: 'season' | 'l15';
}

export interface NflPlayerDetailInput {
  candidates: PickCandidate[];
  market?: string;
  snapshot: SportSnapshot | null;
  scope: NflPlayerDetailScope;
  propOdds?: { rows: PropOddsRow[]; userSportsbook: string };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/**
 * Converts NFL's real `PlayerDetail` inputs into `PlayerDetailData`.
 *
 * Returns `null` when there is no active candidate, same contract as the
 * MLB/golf adapters.
 */
export function toPlayerDetailData(input: NflPlayerDetailInput): PlayerDetailData | null {
  const { candidates, market, snapshot, scope, propOdds } = input;

  const active = candidates.find((c) => c.dimension === market) ?? candidates[0];
  if (!active) return null;

  const meta = (active.subjectMeta ?? {}) as Record<string, unknown>;
  const position = typeof meta.position === 'string' ? meta.position : undefined;
  const teamAbbr = typeof meta.team === 'string' ? meta.team : undefined;
  const opponentAbbr = typeof meta.opponent === 'string' ? meta.opponent : undefined;
  const headshotUrl = typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined;
  const teamLogoUrl = typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined;
  const opponentLogoUrl = typeof meta.opponentLogoUrl === 'string' ? meta.opponentLogoUrl : (nflTeamLogoUrl(opponentAbbr) ?? undefined);

  const richMeta = (snapshot?.subjects.find((s) => s.subjectId === active.subjectId)?.meta ?? {}) as Record<string, unknown>;
  const seasonStats = richMeta.seasonStats as PlayerSeasonStats | undefined;
  const seasonRanks = richMeta.seasonRanks as SeasonRankMap | undefined;
  const opponentDefenseAllowed = (richMeta.opponentDefenseAllowed as NflvStatLine[] | undefined) ?? [];
  const positionRank = typeof richMeta.positionRank === 'number' ? richMeta.positionRank : null;
  const positionPoolSize = typeof richMeta.positionPoolSize === 'number' ? richMeta.positionPoolSize : null;
  const sideOfBallRank = typeof richMeta.sideOfBallRank === 'number' ? richMeta.sideOfBallRank : null;
  const sideOfBallPoolSize = typeof richMeta.sideOfBallPoolSize === 'number' ? richMeta.sideOfBallPoolSize : null;
  const weeklyBoxScores = (richMeta.weeklyBoxScores as Record<string, Record<string, unknown>> | undefined) ?? {};
  const rankPrefix = positionRank != null ? `#${positionRank} ` : '';
  const rankDetail =
    positionRank != null && positionPoolSize != null
      ? `${ordinal(positionRank)} of ${positionPoolSize} ${position ?? ''}${
          sideOfBallRank != null && sideOfBallPoolSize != null
            ? ` · ${ordinal(sideOfBallRank)} of ${sideOfBallPoolSize} ${(position && SIDE_OF_BALL_LABEL[position]) ?? ''}`
            : ''
        }`
      : undefined;

  const baseLine = active.line ?? 0.5;
  const line = Math.max(0, baseLine + scope.lineOffset);
  const wantOver = directionMark(active.category ?? '') !== 'U';

  const games = ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{ gamePk: string; firstPitch?: string }>;
  const todaysGame = games.find((g) => String(g.gamePk) === String(meta.gamePk));

  // ---- Scope filters (NflPlayerDetail.tsx:202-210 — no venue filter for NFL) ----
  let scoped = active.history;
  if (scope.opponentOnly && opponentAbbr) {
    scoped = scoped.filter((e) => (rawOf(e).opponentAbbr as string | undefined) === opponentAbbr);
  }
  if (scope.lastN !== 'all') scoped = scoped.slice(-scope.lastN);

  const measured = categoriseByLine(scoped, line);
  const wanted = wantOver ? OVER : UNDER;

  // ---- Role 5 | conditions: venue weather (6.10).
  // Present only for a venue ESPN reported as explicitly outdoor - an
  // indoor stadium or an unreported roof yields no reading at all, so the
  // card simply does not render. Shared builder, not an inline copy of
  // MLB's: a temperature is a temperature.
  const conditions = toConditionsRole({ weather: active.context?.weather ?? null });

  const windows: WindowedStat5 = {
    l5: fixedWindow(measured, wanted, 5),
    l10: fixedWindow(measured, wanted, 10),
    l15: fixedWindow(measured, wanted, 15),
    szn: openWindow(measured, wanted, { minimum: 1 }),
    h2h:
      !opponentAbbr
        ? ({ status: 'insufficient', available: 0, required: 1 } as WindowedStat)
        : subsetWindow(categoriseByLine(active.history, line), wanted, (e) => (rawOf(e).opponentAbbr as string | undefined) === opponentAbbr, { minimum: 1 }),
  };

  // ---- Chips (NflPlayerDetail.tsx:372-380 — opponent + lastN only, no venue) ----
  // ---- Role 6 | careerH2H (6.13). NOT a second copy of the h2h window
  // box: what this adds is the per-MEETING history. "3 of 5" and "3 of 5,
  // all three in 2019" are different facts and the window box cannot tell
  // them apart. Same opponent predicate `windows.h2h` already uses.
  const careerH2H = !!opponentAbbr
    ? toCareerH2H({
        measured: categoriseByLine(active.history, line),
        wanted,
        isVsOpponent: (e) => (rawOf(e).opponentAbbr as string | undefined) === opponentAbbr,
        opponentLabel: `vs ${opponentAbbr}`,
        statLabel: marketText('nfl', active.dimension, 'compact'),
      })
    : null;

  const chips: ChipDef[] = [
    ...(opponentAbbr ? [{ key: 'opponent', label: `vs ${opponentAbbr}` }] : []),
    { key: 'lastN:5', label: 'Last 5' },
    { key: 'lastN:10', label: 'Last 10' },
    { key: 'lastN:15', label: 'Last 15' },
    { key: 'lastN:all', label: 'Season' },
  ];

  // ---- Chart (NflPlayerDetail.tsx:396-403) ----
  const chart: PlayerDetailChart = {
    kind: 'distribution',
    title: `${scoped.length} game${scoped.length === 1 ? '' : 's'} in scope`,
    subtitle: `green cleared ${wantOver ? 'over' : 'under'} ${line}`,
    data: scoped,
    line,
    wantOver,
    logoFor: (entry) => nflTeamLogoUrl(rawOf(entry).opponentAbbr as string | undefined),
  };

  // ---- Gamelog (NflPlayerDetail.tsx:238-253, 445-467) ----
  const gamelogColumns = position ? GAMELOG_COLUMNS_BY_POSITION[position] ?? [] : [];
  const columns = gamelogColumns.filter((c) =>
    scoped.some((e) => {
      const week = rawOf(e).week as string | undefined;
      const box = week != null ? weeklyBoxScores[week] : undefined;
      return Number(box?.[c.key]) > 0;
    }),
  );
  const gamelogSource = [...scoped].reverse().slice(0, scope.showAllGames ? undefined : 15);
  const rows: GamelogRow[] = gamelogSource.map((entry, index) => {
    const raw = rawOf(entry);
    const oppAbbr = raw.opponentAbbr as string | undefined;
    const season = raw.season as string | undefined;
    const week = raw.week as string | undefined;
    const box = week != null ? weeklyBoxScores[week] : undefined;
    const values: Record<string, number | string | null | undefined> = {};
    for (const col of columns) {
      const v = box?.[col.key];
      values[col.key] = v == null || v === '' ? null : (v as number | string);
    }
    return {
      careerH2H,
      key: `${entry.period}-${index}`,
      periodLabel: season && week ? `${season} Week ${week}` : entry.periodLabel ?? `Game #${entry.period}`,
      opponentLogoUrl: nflTeamLogoUrl(oppAbbr),
      opponentLabel: oppAbbr ?? 'Opponent unknown',
      accentColor: oppAbbr ? teamPrimaryColor(oppAbbr) : undefined,
      values,
    };
  });

  // Real summary strip (2026-08-24) — top-of-card headline stats, scoped by
  // the existing KPI-scope toggle, built generically from this player's
  // real position-filtered columns (`GAMELOG_COLUMNS_BY_POSITION`) the same
  // way CFB's/soccer's now do.
  const kpiSource = scope.kpiScope === 'l15' ? scoped.slice(-15) : scoped;
  const summaryStrip: SummaryStat[] | undefined =
    kpiSource.length > 0 && columns.length > 0
      ? columns.slice(0, 4).map((col) => ({
          label: col.label,
          display: String(
            kpiSource.reduce((s, e) => {
              const week = (rawOf(e).week as string | undefined) ?? undefined;
              const box = week != null ? weeklyBoxScores[week] : undefined;
              return s + (Number(box?.[col.key]) || 0);
            }, 0),
          ),
        }))
      : undefined;

  // ---- Prop odds board (universal, no branch) ----
  const activeMarketKey = candidateDimensionToMarketKey(active.dimension);
  const propOddsBoard: PropOddsBoardProps | null =
    activeMarketKey && propOdds
      ? { allRows: propOdds.rows, subjectId: active.subjectId, marketKey: activeMarketKey, line: active.line ?? null, userSportsbook: propOdds.userSportsbook }
      : null;

  // ---- Form (NflPlayerDetail.tsx:559-571 — same `active.supportingSplits`, already sport-agnostic) ----
  const formWindows = active.supportingSplits ?? null;

  // ---- Universal matchup card (was "Vs. Defense", NflPlayerDetail.tsx:406-419)
  // — no player-level rank source exists for NFL (only the real 32-team
  // defense ranks do, per NflPlayerVsDefenseCard's own header comment), so
  // `subjectStatsByGroup` rows carry `rank: null` while `opponentStatsByGroup`
  // rows carry the real rank/poolSize `toStatRow` already attaches.
  // `positionGroups: null` (single implicit group) — `MATCHUP_GROUP_BY_POSITION`
  // already narrows the shown categories to the ones relevant to this
  // player's own position, so there's nothing left to tab between for one
  // specific player (unlike CFB/NBA/NHL's team-wide scouting view, which
  // tabs across every group since any team could be picked as the opponent).
  const matchupOwnRows = playerMatchupRows(seasonStats, position);
  const matchupOpponentStats = opponentDefenseAllowed.map(toStatRow);
  const matchupGroup = position ? MATCHUP_GROUP_BY_POSITION[position] : undefined;
  const nflOpponentId = 'today';
  const matchupExplorer: MatchupExplorerData | null =
    opponentAbbr && matchupGroup
      ? {
          subjectName: active.subjectName,
          subjectHeadshotUrl: headshotUrl,
          subjectFallbackUrl: teamLogoUrl,
          subjectTeamAbbr: teamAbbr,
          subjectTeamLogoUrl: teamLogoUrl,
          subjectRoleLabel: 'Produces',
          opponentRoleLabel: 'Allows',
          positionGroups: null,
          subjectStatsByGroup: {
            _default: matchupOwnRows.map((r) => ({ key: r.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: r.label, value: r.value, decimals: r.decimals, rank: null, poolSize: null })),
          },
          defaultOpponentId: nflOpponentId,
          opponentOptions: null,
          opponentMeta: {
            [nflOpponentId]: { id: nflOpponentId, abbr: opponentAbbr, name: `${opponentAbbr} defense`, logoUrl: opponentLogoUrl },
          },
          opponentStatsByGroup: {
            [nflOpponentId]: { _default: matchupOpponentStats.map((s) => ({ key: s.key, label: s.label, value: s.value, decimals: s.decimals, rank: s.rank ?? null, poolSize: s.poolSize ?? null })) },
          },
          contextLine: null,
        }
      : null;

  // ---- Season stats card (NflPlayerDetail.tsx:474-492) ----
  const seasonRows = seasonTotalsRows(seasonStats, position, seasonRanks);
  const nflSeasonStats =
    seasonRows.length > 0
      ? {
          rows: seasonRows.map((r) => ({ key: r.key, label: r.label, value: r.value, decimals: 0, rank: r.rank })),
          rankedAmongLabel: seasonRanks ? position : undefined,
        }
      : null;

  return {
    conditions,
    subject: {
      subjectId: active.subjectId,
      name: active.subjectName,
      headshotUrl,
      teamAbbr,
      teamLogoUrl,
      position,
      rankPrefix,
      opponentAbbr,
      opponentLogoUrl,
      rankDetail,
      gameStartTime: todaysGame?.firstPitch ?? null,
      gameStatus: null,
      accentColor: teamAbbr ? teamPrimaryColor(teamAbbr) : undefined,
    },
    candidates,
    market: active.dimension,
    chips,
    windows,
    roundScores: null,
    chart,
    gamelog: { columns, rows, summaryStrip, cardBadges: columns.slice(0, 4) },
    propOddsBoard,
    model: null,
    hitterStats: null,
    formWindows,
    lineControl: { kind: 'stepper', line, baseLine, wantOver },
    liveGame: null,
    liveMatchup: null,
    matchupExplorer,
    seasonStatsCard: null,
    golfFormHoles: null,
    nflSeasonStats,
    liveLineTracker: {
      subjectId: active.subjectId,
      sport: 'nfl',
      gameId: todaysGame?.gamePk ?? null,
      availableStats: FOOTBALL_TRACKABLE_STATS,
    },
  };
}

const FOOTBALL_TRACKABLE_STATS: Array<{ key: string; label: string }> = [
  { key: 'passing_yards', label: 'Passing Yards' },
  { key: 'passing_tds', label: 'Passing TDs' },
  { key: 'rushing_yards', label: 'Rushing Yards' },
  { key: 'rushing_tds', label: 'Rushing TDs' },
  { key: 'receiving_yards', label: 'Receiving Yards' },
  { key: 'receiving_tds', label: 'Receiving TDs' },
  { key: 'receptions', label: 'Receptions' },
];
