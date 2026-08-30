/**
 * `PlayerDetail.tsx` adapter — NBA half. Mirrors CFB's/soccer's player
 * adapter: real per-game history (points/rebounds/assists/steals/blocks/
 * turnovers/threes-made, sourced from sportsdataverse.ts) drives real
 * L5/L10/L15/H2H/SZN windows, a real distribution chart, and a real
 * per-game gamelog, same windowed-stat engine every other sport's adapter
 * uses. `model`/`hitterStats`/`matchups` stay `null` — no grading model
 * for NBA yet. `propOddsBoard` is real and independent of history.
 */

import type { PickCandidate, Sport, SportSnapshot } from '@/lib/core/types';
import { categoriseByLine, fixedWindow, openWindow, OVER, subsetWindow, UNDER } from '@/lib/core/windowedStat';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import type { PropOddsRow } from '@/lib/db/client';
import { marketText } from '@/components/MarketLabel';
import { toVenueBinarySplit } from '@/lib/sports/shared/venueSplit';
import type { ChipDef, GamelogRow, MatchupExplorerData, PlayerDetailChart, PlayerDetailData, PropOddsBoardProps, SummaryStat, WindowedStat5 } from '@/lib/sports/mlb/adapters/playerDetailAdapter';
import type { NbaTeamDefenseAllowed } from '@/lib/sports/nba/teamDefenseAllowed';
import { MIDDOT, fmt } from '@/components/charts/tokens';
import { toRoleStat, type OpponentUnitRole, type SpatialGridRole } from '@/lib/sports/shared/playerRoles';
import type { NbaShotProfile } from '@/lib/sports/nba/shotProfileShapes';
import { toCareerH2H } from '@/lib/sports/shared/careerH2H';
import { toRestConditions } from '@/lib/sports/shared/restConditions';

// Local copy rather than importing lib/sports/nba/adapter.ts's version —
// that module pulls in server-only DB/pg code (lib/db/client.ts), which
// breaks the client bundle when imported from a client-rendered adapter
// (this file is reachable from components/PlayerDetail.tsx). Same
// convention CFB's teamDetailAdapter.ts already documents for its own
// local `normalizeTeamName` copy.
function nbaTeamLogoUrl(abbreviation: string | undefined): string | undefined {
  return abbreviation ? `https://a.espncdn.com/i/teamlogos/nba/500/${abbreviation.toLowerCase()}.png` : undefined;
}

function fieldSum(entries: PickCandidate['history'], key: string): number {
  return entries.reduce((s, e) => s + (Number((e.raw as Record<string, unknown> | undefined)?.[key]) || 0), 0);
}

const NBA_MATCHUP_GROUPS = [
  { key: 'Guards', label: 'Guards' },
  { key: 'Forwards', label: 'Forwards' },
  { key: 'Centers', label: 'Centers' },
] as const;

function nbaDefenseRow(team: NbaTeamDefenseAllowed, groupKey: string): { key: string; label: string; value: number; decimals: number; rank: number; poolSize: number }[] {
  if (groupKey === 'Guards') return [{ key: 'ptsAllowedGuards', label: 'Pts/Gm Allowed', value: team.guardPtsAllowedPerGame, decimals: 1, rank: team.guardRank, poolSize: team.poolSize }];
  if (groupKey === 'Forwards') return [{ key: 'ptsAllowedForwards', label: 'Pts/Gm Allowed', value: team.forwardPtsAllowedPerGame, decimals: 1, rank: team.forwardRank, poolSize: team.poolSize }];
  return [{ key: 'ptsAllowedCenters', label: 'Pts/Gm Allowed', value: team.centerPtsAllowedPerGame, decimals: 1, rank: team.centerRank, poolSize: team.poolSize }];
}

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

const GAMELOG_COLUMNS = [
  { key: 'points', label: 'Pts' },
  { key: 'rebounds', label: 'Reb' },
  { key: 'assists', label: 'Ast' },
  { key: 'steals', label: 'Stl' },
  { key: 'blocks', label: 'Blk' },
  { key: 'turnovers', label: 'TO' },
  { key: 'threesMade', label: '3PM' },
];

export interface NbaPlayerDetailScope {
  lineOffset: number;
  opponentOnly: boolean;
  lastN: number | 'all';
  showAllGames: boolean;
  kpiScope: 'season' | 'l15';
}

export interface NbaPlayerDetailInput {
  candidates: PickCandidate[];
  market?: string;
  snapshot: SportSnapshot | null;
  scope: NbaPlayerDetailScope;
  propOdds?: { rows: PropOddsRow[]; userSportsbook: string };
  /** League-wide defense-allowed leaderboard, see the identical field on `CfbPlayerDetailInput` for the full reasoning. */
  teamDefenseAllowed?: NbaTeamDefenseAllowed[];
  /** `useNbaShotProfile(...)`'s result — the shot chart (6.7). Structural, not an import of the hook's type. */
  shotProfile?: { profile: NbaShotProfile | null; loading: boolean };
}

export function toPlayerDetailData(input: NbaPlayerDetailInput): PlayerDetailData | null {
  const { candidates, market, snapshot, scope, propOdds, teamDefenseAllowed = [] , shotProfile: shotProfileState } = input;

  const active = candidates.find((c) => c.dimension === market) ?? candidates[0];
  if (!active) return null;

  const meta = (active.subjectMeta ?? {}) as Record<string, unknown>;
  const teamAbbr = typeof meta.team === 'string' ? meta.team : undefined;
  const opponentAbbr = typeof meta.opponent === 'string' ? meta.opponent : undefined;
  const headshotUrl = typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined;
  const teamLogoUrl = typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined;
  const opponentLogoUrl = typeof meta.opponentLogoUrl === 'string' ? meta.opponentLogoUrl : undefined;

  const games = ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{
    gamePk: string;
    firstPitch?: string;
  }>;
  const todaysGame = games.find((g) => String(g.gamePk) === String(meta.gamePk));

  const baseLine = active.line ?? 0.5;
  const line = Math.max(0, baseLine + scope.lineOffset);
  const wantOver = true;

  let scoped = active.history;
  if (scope.opponentOnly && opponentAbbr) {
    scoped = scoped.filter((e) => (rawOf(e).opponentAbbr as string | undefined) === opponentAbbr);
  }
  if (scope.lastN !== 'all') scoped = scoped.slice(-scope.lastN);

  const measured = categoriseByLine(scoped, line);
  const wanted = wantOver ? OVER : UNDER;

  // ---- Role 3 | spatialGrid: the shot chart (6.7).
  // Fed by `useNbaShotProfile` -> `/api/nba/shot-profile` -> `nba_shot_events`,
  // which Python's `ingestNbaShotsJob` writes. Distance BANDS rather than a
  // court grid: basketball is described by distance (at the rim, the paint,
  // mid-range, beyond the arc), and the bands are anchored on the basket at
  // (25, 0) in feet -- an origin confirmed against the three-point line, not
  // assumed. See `shotProfileShapes.ts`.
  const nbaShots = shotProfileState?.profile ?? null;
  const spatialGrid: SpatialGridRole | null = nbaShots
    ? {
        title: 'Shot profile',
        cells: nbaShots.cells.map((row) =>
          row.map((c) => ({ key: c.key, value: c.attempts > 0 ? c.share : null, sampleSize: c.attempts })),
        ),
        rowLabels: nbaShots.rowLabels,
        columnLabels: nbaShots.columnLabels,
        format: fmt.pct0,
        unit: 'of attempts',
        caption: [
          `${nbaShots.totalAttempts.toLocaleString()} located attempts`,
          `${Math.round((nbaShots.totalMade / Math.max(1, nbaShots.totalAttempts)) * 100)}% made`,
          // An unlocated attempt is a real shot whose position ESPN did not
          // record. Saying so beats letting the shares imply full coverage.
          nbaShots.unlocated > 0 ? `${nbaShots.unlocated} unlocated` : null,
        ]
          .filter(Boolean)
          .join(` ${MIDDOT} `),
        emptyMessage: 'No shot locations on record.',
      }
    : null;

  // ---- Role 4 | binarySplit: home/away, off the `raw.isHome` this sport's
  // history already carries but exposes through no filter chip.
  // Over the FULL history, not `scoped` - this is a season-level fact, the
  // same reason `windows.h2h` reads `active.history` rather than `measured`.
  // Null unless BOTH venues have a real sample; see `venueSplit.ts` for the
  // resolution defect that guard contains.
  const binarySplit = toVenueBinarySplit({
    measured: categoriseByLine(active.history, line),
    wanted,
    statLabel: marketText('nba', active.dimension, 'compact'),
  });

  const windows: WindowedStat5 = {
    l5: fixedWindow(measured, wanted, 5),
    l10: fixedWindow(measured, wanted, 10),
    l15: fixedWindow(measured, wanted, 15),
    szn: openWindow(measured, wanted, { minimum: 1 }),
    h2h:
      !opponentAbbr
        ? { status: 'insufficient', available: 0, required: 1 }
        : subsetWindow(categoriseByLine(active.history, line), wanted, (e) => (rawOf(e).opponentAbbr as string | undefined) === opponentAbbr, { minimum: 1 }),
  };

  // ---- Role 5 | conditions: rest and schedule load.
  // Indoor sport -- temperature and wind are not conditions anyone bets on.
  // What moves this market is rest, which `playerRoles.ts`'s own role table
  // names for this sport. Dates come from the subject's FULL history, not the
  // scoped view, since a filter chip should not change how rested he is.
  const conditions = toRestConditions({
    gameDates: active.history.map((e) => rawOf(e).date as string | undefined),
  });

  // ---- Role 1 | opponentUnit: the defensive unit this subject faces.
  // Same league-wide defence-allowed leaderboard the matchup card already
  // reads, reduced to the one opponent and rendered as a named unit.
  //
  // ONE ROW PER GROUP, each labelled by the group. The candidate carries no
  // position for this sport, so picking a single group would mean guessing
  // which one applies -- and there are only three of them. Showing all of
  // them labelled is the honest read of what this defence allows.
  const opponentDefenseTeam = opponentAbbr ? teamDefenseAllowed.find((t) => t.abbr === opponentAbbr) : undefined;
  const opponentUnit: OpponentUnitRole | null = opponentDefenseTeam
    ? {
        title: 'Opposing defence',
        name: `${opponentAbbr} defence`,
        subtitle: 'Allows',
        logoUrl: opponentLogoUrl,
        stats: NBA_MATCHUP_GROUPS.flatMap((g) =>
          nbaDefenseRow(opponentDefenseTeam, g.key).map((r) => toRoleStat({ ...r, label: `${r.label} vs ${g.label}` })),
        ),
        emptyMessage: 'No defensive splits for this opponent yet.',
      }
    : null;

  // ---- Role 6 | careerH2H (6.13). NOT a second copy of the h2h window box:
  // that reports one rate, this reports the per-MEETING history behind it.
  // "3 of 5" and "3 of 5, all three in one season" are different facts and a
  // single rate cannot tell them apart. Same opponent predicate `windows.h2h`
  // uses above -- deliberately the same expression, so the two can never
  // disagree about who the opponent is.
  const careerH2H = opponentAbbr
    ? toCareerH2H({
        measured: categoriseByLine(active.history, line),
        wanted,
        isVsOpponent: (e) => (rawOf(e).opponentAbbr as string | undefined) === opponentAbbr,
        opponentLabel: `vs ${opponentAbbr}`,
        statLabel: marketText('nba', active.dimension, 'compact'),
      })
    : null;

  const chips: ChipDef[] = [
    ...(opponentAbbr ? [{ key: 'opponent', label: `vs ${opponentAbbr}` }] : []),
    { key: 'lastN:5', label: 'Last 5' },
    { key: 'lastN:10', label: 'Last 10' },
    { key: 'lastN:15', label: 'Last 15' },
    { key: 'lastN:all', label: 'All games' },
  ];

  // Real opponent logo — `toHistoryEntries` (adapter.ts) already embeds
  // `opponentLogoUrl` via `nbaTeamLogoUrl` on every real history entry;
  // this just reads it, same as NHL's own `logoFor` (2026-08-24 fix — this
  // used to fall through to `DistributionChart`'s MLB-only numeric-id
  // default, which is always undefined for NBA, so bars never got a logo).
  const logoFor = (entry: PickCandidate['history'][number]) => rawOf(entry).opponentLogoUrl as string | undefined;

  const chart: PlayerDetailChart =
    scoped.length > 0
      ? {
          kind: 'distribution',
          title: `${scoped.length} game${scoped.length === 1 ? '' : 's'} in scope`,
          subtitle: `green cleared ${wantOver ? 'over' : 'under'} ${line}`,
          data: scoped,
          line,
          wantOver,
          logoFor,
        }
      : {
          kind: 'distribution',
          title: '0 games in scope',
          subtitle: active.history.length === 0 ? 'No per-game history source yet for this market' : `green cleared ${wantOver ? 'over' : 'under'} ${line}`,
          data: [],
          line,
          wantOver,
          logoFor,
        };

  const columns = GAMELOG_COLUMNS.filter((c) => scoped.some((e) => rawOf(e)[c.key] != null));
  const gamelogSource = [...scoped].reverse().slice(0, scope.showAllGames ? undefined : 15);
  const rows: GamelogRow[] = gamelogSource.map((entry, index) => {
    const raw = rawOf(entry);
    const oppAbbr = raw.opponentAbbr as string | undefined;
    const isHome = raw.isHome === true;
    const values: Record<string, number | string | null | undefined> = {};
    for (const col of columns) {
      const v = raw[col.key];
      values[col.key] = v == null ? null : (v as number);
    }
    return {
      key: `${entry.period}-${index}`,
      periodLabel: entry.periodLabel ?? `Game #${entry.period}`,
      opponentLogoUrl: raw.opponentLogoUrl as string | undefined,
      opponentLabel: oppAbbr ? `${isHome ? 'vs' : '@'} ${oppAbbr}` : 'Opponent unknown',
      values,
    };
  });

  // Real summary strip (2026-08-24) — same "top card" MLB/NHL already show,
  // scoped to L15 or full season per the existing KPI-scope toggle.
  const kpiSource = scope.kpiScope === 'l15' ? scoped.slice(-15) : scoped;
  const summaryStrip: SummaryStat[] | undefined =
    kpiSource.length > 0
      ? [
          { label: 'Points', display: (fieldSum(kpiSource, 'points') / kpiSource.length).toFixed(1) },
          { label: 'Rebounds', display: (fieldSum(kpiSource, 'rebounds') / kpiSource.length).toFixed(1) },
          { label: 'Assists', display: (fieldSum(kpiSource, 'assists') / kpiSource.length).toFixed(1) },
        ]
      : undefined;

  const activeMarketKey = candidateDimensionToMarketKey(active.dimension);
  const propOddsBoard: PropOddsBoardProps | null =
    activeMarketKey && propOdds
      ? { allRows: propOdds.rows, subjectId: active.subjectId, marketKey: activeMarketKey, line: active.line ?? null, userSportsbook: propOdds.userSportsbook }
      : null;

  // ---- Real season totals (sportsdataverse.ts, summed across every real game — adapter.ts) ----
  const seasonStats = meta.seasonStats as
    | { games: number; points: number; rebounds: number; assists: number; steals: number; blocks: number; turnovers: number; threesMade: number }
    | undefined;
  const nflSeasonStats: PlayerDetailData['nflSeasonStats'] = seasonStats
    ? {
        rows: [
          { key: 'games', label: 'Games', value: seasonStats.games, decimals: 0 },
          { key: 'points', label: 'Points', value: seasonStats.points, decimals: 0 },
          { key: 'rebounds', label: 'Rebounds', value: seasonStats.rebounds, decimals: 0 },
          { key: 'assists', label: 'Assists', value: seasonStats.assists, decimals: 0 },
          { key: 'steals', label: 'Steals', value: seasonStats.steals, decimals: 0 },
          { key: 'blocks', label: 'Blocks', value: seasonStats.blocks, decimals: 0 },
          { key: 'threesMade', label: '3PM', value: seasonStats.threesMade, decimals: 0 },
          { key: 'turnovers', label: 'Turnovers', value: seasonStats.turnovers, decimals: 0 },
        ],
      }
    : null;

  // ---- Universal matchup card — NBA's first real matchup card ----
  const subjectPtsPerGame = seasonStats && seasonStats.games > 0 ? seasonStats.points / seasonStats.games : null;
  const matchupExplorer: MatchupExplorerData | null =
    teamDefenseAllowed.length > 0
      ? {
          subjectName: active.subjectName,
          subjectHeadshotUrl: headshotUrl,
          subjectTeamAbbr: teamAbbr,
          subjectTeamLogoUrl: teamLogoUrl,
          positionGroups: [...NBA_MATCHUP_GROUPS],
          subjectStatsByGroup: Object.fromEntries(
            NBA_MATCHUP_GROUPS.map((g) => [
              g.key,
              subjectPtsPerGame != null ? [{ key: `ptsAllowed${g.key}`, label: 'Pts/Gm', value: subjectPtsPerGame, decimals: 1, rank: null, poolSize: null }] : [],
            ]),
          ),
          defaultOpponentId: opponentAbbr && teamDefenseAllowed.some((t) => t.abbr === opponentAbbr) ? opponentAbbr : teamDefenseAllowed[0].abbr,
          opponentOptions: teamDefenseAllowed.map((t) => ({ id: t.abbr, abbr: t.abbr, name: t.abbr })),
          // Real logo for every real opponent option, not just today's
          // matched one (2026-08-24 fix) — `nbaTeamLogoUrl` is a plain
          // predictable ESPN CDN template, no per-team fetch needed, so
          // there's no reason the custom-opponent picker's other entries
          // should ever fall back to a text-initials avatar.
          opponentMeta: Object.fromEntries(teamDefenseAllowed.map((t) => [t.abbr, { id: t.abbr, abbr: t.abbr, name: t.abbr, logoUrl: nbaTeamLogoUrl(t.abbr) }])),
          opponentStatsByGroup: Object.fromEntries(teamDefenseAllowed.map((t) => [t.abbr, Object.fromEntries(NBA_MATCHUP_GROUPS.map((g) => [g.key, nbaDefenseRow(t, g.key)]))])),
          contextLine: opponentAbbr ? `Real next-game opponent: ${opponentAbbr}` : null,
        }
      : null;

  return {
    conditions,
    opponentUnit,
    careerH2H,

    spatialGrid,
    binarySplit,
    subject: {
      subjectId: active.subjectId,
      name: active.subjectName,
      headshotUrl,
      teamAbbr,
      teamLogoUrl,
      position: undefined,
      rankPrefix: '',
      opponentAbbr,
      opponentLogoUrl,
      gameStartTime: todaysGame?.firstPitch ?? null,
      gameStatus: null,
    },
    candidates,
    market: active.dimension,
    chips,
    windows,
    roundScores: null,
    chart,
    gamelog: scoped.length > 0 || active.history.length > 0 ? { columns, rows, summaryStrip, cardBadges: columns } : null,
    propOddsBoard,
    model: null,
    hitterStats: null,
    formWindows: active.supportingSplits ?? null,
    lineControl: { kind: 'stepper', line, baseLine, wantOver },
    liveGame: null,
    liveMatchup: null,
    matchupExplorer,
    seasonStatsCard: null,
    golfFormHoles: null,
    nflSeasonStats,
    liveLineTracker: {
      subjectId: active.subjectId,
      sport: 'nba',
      gameId: todaysGame?.gamePk ?? null,
      availableStats: NBA_TRACKABLE_STATS,
    },
  };
}

const NBA_TRACKABLE_STATS: Array<{ key: string; label: string }> = [
  { key: 'points', label: 'Points' },
  { key: 'rebounds', label: 'Rebounds' },
  { key: 'assists', label: 'Assists' },
  { key: 'steals', label: 'Steals' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'turnovers', label: 'Turnovers' },
];
