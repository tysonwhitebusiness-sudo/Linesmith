/**
 * `PlayerDetail.tsx` adapter — NHL half. Mirrors CFB's/NBA's player
 * adapter: real per-game history (goals/assists/points/shots-on-goal/
 * hits/blocked-shots for skaters, saves/goals-against for goalies,
 * sourced from nhle.ts's boxscore data) drives real L5/L10/L15/H2H/SZN
 * windows, a real distribution chart, and a real per-game gamelog.
 * `model`/`hitterStats`/`matchups` stay `null` — no grading model for
 * NHL yet. `propOddsBoard` is real and independent of history.
 */

import type { PickCandidate, Sport, SportSnapshot } from '@/lib/core/types';
import { categoriseByLine, fixedWindow, openWindow, OVER, subsetWindow, UNDER } from '@/lib/core/windowedStat';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import type { PropOddsRow } from '@/lib/db/client';
import { marketText } from '@/components/MarketLabel';
import { toVenueBinarySplit } from '@/lib/sports/shared/venueSplit';
import type { ChipDef, GamelogRow, MatchupExplorerData, PlayerDetailChart, PlayerDetailData, PropOddsBoardProps, SummaryStat, WindowedStat5 } from '@/lib/sports/mlb/adapters/playerDetailAdapter';
import type { NhlTeamDefenseAllowed } from '@/lib/sports/nhl/teamDefenseAllowed';
import { MIDDOT, fmt } from '@/components/charts/tokens';
import { toRoleStat, type OpponentUnitRole, type SpatialGridRole } from '@/lib/sports/shared/playerRoles';
import type { NhlShotProfile } from '@/lib/sports/nhl/shotProfileShapes';
import { toCareerH2H } from '@/lib/sports/shared/careerH2H';
import { toRestConditions } from '@/lib/sports/shared/restConditions';

const NHL_MATCHUP_GROUPS = [
  { key: 'Forwards', label: 'Forwards' },
  { key: 'Defense', label: 'Defense' },
] as const;

function nhlDefenseRow(team: NhlTeamDefenseAllowed, groupKey: string): { key: string; label: string; value: number; decimals: number; rank: number; poolSize: number }[] {
  if (groupKey === 'Forwards') return [{ key: 'ptsAllowedForwards', label: 'Pts/Gm Allowed', value: team.forwardPtsAllowedPerGame, decimals: 1, rank: team.forwardRank, poolSize: team.poolSize }];
  return [{ key: 'ptsAllowedDefense', label: 'Pts/Gm Allowed', value: team.defensePtsAllowedPerGame, decimals: 1, rank: team.defenseRank, poolSize: team.poolSize }];
}

function fieldSum(entries: PickCandidate['history'], key: string): number {
  return entries.reduce((s, e) => s + (Number(rawOf(e)[key]) || 0), 0);
}

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

const GAMELOG_COLUMNS = [
  { key: 'goals', label: 'G' },
  { key: 'assists', label: 'A' },
  { key: 'points', label: 'Pts' },
  { key: 'shots', label: 'SOG' },
  { key: 'hits', label: 'Hits' },
  { key: 'blockedShots', label: 'Blk' },
  { key: 'saves', label: 'Sv' },
  { key: 'goalsAgainst', label: 'GA' },
];

export interface NhlPlayerDetailScope {
  lineOffset: number;
  opponentOnly: boolean;
  lastN: number | 'all';
  showAllGames: boolean;
  kpiScope: 'season' | 'l15';
}

export interface NhlPlayerDetailInput {
  candidates: PickCandidate[];
  market?: string;
  snapshot: SportSnapshot | null;
  scope: NhlPlayerDetailScope;
  propOdds?: { rows: PropOddsRow[]; userSportsbook: string };
  /** League-wide defense-allowed leaderboard, see the identical field on `CfbPlayerDetailInput` for the full reasoning. */
  teamDefenseAllowed?: NhlTeamDefenseAllowed[];
  /**
   * `useNhlShotProfile(...)`'s result — the shot map (6.7). Structural rather
   * than an import of the hook's own type, so this file stays a pure transform
   * with no dependency on a component.
   */
  shotProfile?: { profile: NhlShotProfile | null; loading: boolean };
}

export function toPlayerDetailData(input: NhlPlayerDetailInput): PlayerDetailData | null {
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

  // ---- Role 3 | spatialGrid: the shot map (6.7).
  // Fed by `useNhlShotProfile` -> `/api/nhl/shot-profile` -> `nhl_shot_events`,
  // which Python's `ingestNhlShotsJob` writes. Absent out of season and for a
  // player with no shots on record, and no card renders then.
  //
  // Cells show SHOT SHARE. The coordinates arrive already folded onto one
  // attacking end by `toNhlShotProfile` — see `shotProfileShapes.ts` for why
  // that fold is a 180-degree rotation and not `abs(x)`.
  const shotProfile = shotProfileState?.profile ?? null;
  const spatialGrid: SpatialGridRole | null = shotProfile
    ? {
        title: 'Shot location',
        cells: shotProfile.cells.map((row) =>
          row.map((c) => ({ key: c.key, value: c.shots > 0 ? c.share : null, sampleSize: c.shots })),
        ),
        rowLabels: shotProfile.rowLabels,
        columnLabels: shotProfile.columnLabels,
        format: fmt.pct0,
        unit: 'of attempts',
        caption: `${shotProfile.totalShots.toLocaleString()} attempts ${MIDDOT} ${shotProfile.onGoal} on goal ${MIDDOT} ${shotProfile.totalGoals} scored`,
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
    statLabel: marketText('nhl', active.dimension, 'compact'),
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
  // which one applies -- and there are only two of them. Showing all of
  // them labelled is the honest read of what this defence allows.
  const opponentDefenseTeam = opponentAbbr ? teamDefenseAllowed.find((t) => t.abbr === opponentAbbr) : undefined;
  const opponentUnit: OpponentUnitRole | null = opponentDefenseTeam
    ? {
        title: 'Opposing defence',
        name: `${opponentAbbr} defence`,
        subtitle: 'Allows',
        logoUrl: opponentLogoUrl,
        stats: NHL_MATCHUP_GROUPS.flatMap((g) =>
          nhlDefenseRow(opponentDefenseTeam, g.key).map((r) => toRoleStat({ ...r, label: `${r.label} vs ${g.label}` })),
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
        statLabel: marketText('nhl', active.dimension, 'compact'),
      })
    : null;

  const chips: ChipDef[] = [
    ...(opponentAbbr ? [{ key: 'opponent', label: `vs ${opponentAbbr}` }] : []),
    { key: 'lastN:5', label: 'Last 5' },
    { key: 'lastN:10', label: 'Last 10' },
    { key: 'lastN:15', label: 'Last 15' },
    { key: 'lastN:all', label: 'All games' },
  ];

  const chart: PlayerDetailChart =
    scoped.length > 0
      ? {
          kind: 'distribution',
          title: `${scoped.length} game${scoped.length === 1 ? '' : 's'} in scope`,
          subtitle: `green cleared ${wantOver ? 'over' : 'under'} ${line}`,
          data: scoped,
          line,
          wantOver,
          logoFor: (entry) => rawOf(entry).opponentLogoUrl as string | undefined,
        }
      : {
          kind: 'distribution',
          title: '0 games in scope',
          subtitle: active.history.length === 0 ? 'No per-game history source yet for this market' : `green cleared ${wantOver ? 'over' : 'under'} ${line}`,
          data: [],
          line,
          wantOver,
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

  // Headline totals above the gamelog — real per-game raw fields summed over
  // whichever scope (Season/L15) the toggle is set to, same "kpiSource"
  // convention MLB's adapter uses. Goalie vs skater branch mirrors
  // `nflSeasonStats` below.
  const kpiSource = scope.kpiScope === 'l15' ? scoped.slice(-15) : scoped;
  const isGoalieHistory = kpiSource.some((e) => (rawOf(e).saves as number) > 0 || (rawOf(e).goalsAgainst as number) > 0);
  const summaryStrip: SummaryStat[] | undefined =
    kpiSource.length > 0
      ? isGoalieHistory
        ? [
            { label: 'Saves', display: String(fieldSum(kpiSource, 'saves')) },
            { label: 'Goals against', display: String(fieldSum(kpiSource, 'goalsAgainst')) },
          ]
        : [
            { label: 'Goals', display: String(fieldSum(kpiSource, 'goals')) },
            { label: 'Assists', display: String(fieldSum(kpiSource, 'assists')) },
            { label: 'Points', display: String(fieldSum(kpiSource, 'points')) },
            { label: 'Shots', display: String(fieldSum(kpiSource, 'shots')) },
          ]
      : undefined;

  const activeMarketKey = candidateDimensionToMarketKey(active.dimension);
  const propOddsBoard: PropOddsBoardProps | null =
    activeMarketKey && propOdds
      ? { allRows: propOdds.rows, subjectId: active.subjectId, marketKey: activeMarketKey, line: active.line ?? null, userSportsbook: propOdds.userSportsbook }
      : null;

  // ---- Real season totals (nhle.ts, summed across every real game — adapter.ts) ----
  const seasonStats = meta.seasonStats as
    | { games: number; goals: number; assists: number; points: number; shots: number; hits: number; blockedShots: number; saves: number; goalsAgainst: number }
    | undefined;
  const nflSeasonStats: PlayerDetailData['nflSeasonStats'] = seasonStats
    ? {
        rows: [
          { key: 'games', label: 'Games', value: seasonStats.games, decimals: 0 },
          ...(seasonStats.saves > 0 || seasonStats.goalsAgainst > 0
            ? [
                { key: 'saves', label: 'Saves', value: seasonStats.saves, decimals: 0 },
                { key: 'goalsAgainst', label: 'Goals Against', value: seasonStats.goalsAgainst, decimals: 0 },
              ]
            : [
                { key: 'goals', label: 'Goals', value: seasonStats.goals, decimals: 0 },
                { key: 'assists', label: 'Assists', value: seasonStats.assists, decimals: 0 },
                { key: 'points', label: 'Points', value: seasonStats.points, decimals: 0 },
                { key: 'shots', label: 'Shots on Goal', value: seasonStats.shots, decimals: 0 },
                { key: 'hits', label: 'Hits', value: seasonStats.hits, decimals: 0 },
                { key: 'blockedShots', label: 'Blocked Shots', value: seasonStats.blockedShots, decimals: 0 },
              ]),
        ],
      }
    : null;

  // ---- Universal matchup card — NHL's first real matchup card. Goalies
  // skip this: "points allowed to forwards/D" is a skater-vs-skater-defense
  // framing that doesn't translate to a goalie's own performance. ----
  const isGoalieSubject = seasonStats ? seasonStats.saves > 0 || seasonStats.goalsAgainst > 0 : false;
  const subjectPtsPerGame = seasonStats && seasonStats.games > 0 && !isGoalieSubject ? seasonStats.points / seasonStats.games : null;
  const matchupExplorer: MatchupExplorerData | null =
    !isGoalieSubject && teamDefenseAllowed.length > 0
      ? {
          subjectName: active.subjectName,
          subjectHeadshotUrl: headshotUrl,
          subjectTeamAbbr: teamAbbr,
          subjectTeamLogoUrl: teamLogoUrl,
          positionGroups: [...NHL_MATCHUP_GROUPS],
          subjectStatsByGroup: Object.fromEntries(
            NHL_MATCHUP_GROUPS.map((g) => [
              g.key,
              subjectPtsPerGame != null ? [{ key: `ptsAllowed${g.key}`, label: 'Pts/Gm', value: subjectPtsPerGame, decimals: 1, rank: null, poolSize: null }] : [],
            ]),
          ),
          defaultOpponentId: opponentAbbr && teamDefenseAllowed.some((t) => t.abbr === opponentAbbr) ? opponentAbbr : teamDefenseAllowed[0].abbr,
          opponentOptions: teamDefenseAllowed.map((t) => ({ id: t.abbr, abbr: t.abbr, name: t.abbr })),
          // Real logo for every real opponent option (2026-08-24 fix), not
          // just today's matched one — `teamDefenseAllowed` now carries its
          // own real `logoUrl` per team (teamDefenseAllowed.ts), so there's
          // no reason the custom-opponent picker's other entries should
          // ever fall back to a text-initials avatar.
          opponentMeta: Object.fromEntries(teamDefenseAllowed.map((t) => [t.abbr, { id: t.abbr, abbr: t.abbr, name: t.abbr, logoUrl: t.logoUrl ?? (t.abbr === opponentAbbr ? opponentLogoUrl : undefined) }])),
          opponentStatsByGroup: Object.fromEntries(teamDefenseAllowed.map((t) => [t.abbr, Object.fromEntries(NHL_MATCHUP_GROUPS.map((g) => [g.key, nhlDefenseRow(t, g.key)]))])),
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
      sport: 'nhl',
      gameId: todaysGame?.gamePk ?? null,
      availableStats: NHL_TRACKABLE_STATS,
    },
  };
}

const NHL_TRACKABLE_STATS: Array<{ key: string; label: string }> = [
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
  { key: 'points', label: 'Points' },
  { key: 'shots_on_goal', label: 'Shots on Goal' },
  { key: 'hits', label: 'Hits' },
  { key: 'blocked_shots', label: 'Blocked Shots' },
];
