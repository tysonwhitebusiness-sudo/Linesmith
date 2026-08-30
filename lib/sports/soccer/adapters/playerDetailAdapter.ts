/**
 * `PlayerDetail.tsx` adapter — soccer half.
 *
 * Real per-match history now exists for the markets `lib/sports/soccer/adapter.ts`'s
 * `HISTORY_FIELD` covers (anytime-goalscorer, two-plus-goals, shots, assists,
 * goals-assists — see that file's header for why only these), sourced from
 * Understat (EPL) / American Soccer Analysis (MLS). `windows`/`chart`/`gamelog`
 * below are the same windowed-stat engine NFL's adapter uses, scoped the same
 * way (opponent-only + lastN — soccer has no venue filter, matching NFL, since
 * `raw.isHome` isn't surfaced as a UI filter chip here either). A candidate
 * outside `HISTORY_FIELD`'s coverage (first/last-goalscorer, shots-on-target,
 * tackles, passes/dribbles/crosses-attempted, yellow-cards, saves) still
 * arrives with `history: []` — real "no source yet" for that specific market,
 * not fabricated.
 *
 * `nflMatchup`/`nflSeasonStats` (2026-08-23): despite the field names, both
 * are sport-agnostic in shape (`NflPlayerVsDefenseCardProps`/plain ranked
 * rows) — reused directly rather than forking a `soccerMatchup` type, since
 * the UI concept is genuinely the same, just populated with real goals/xG
 * instead of rush yards (CLAUDE.md's sport-adapter rule 4: reuse when
 * genuinely the same shape, branch only when genuinely different). Built
 * from real Understat season aggregates + real per-team goals-against rate
 * (`adapter.ts`'s `attachRealHistory`, which already attaches
 * `subjectMeta.seasonStats`/`.seasonRank`/`.opponentDefense`) — EPL only for
 * now, MLS's equivalent needs ASA's own team-season endpoint wired in.
 * `model`/`hitterStats` stay `null` — no grading/ranking model for soccer yet.
 * `propOddsBoard` is real and independent of history, same as before.
 */

import type { PickCandidate, SportSnapshot } from '@/lib/core/types';
import { categoriseByLine, fixedWindow, openWindow, OVER, subsetWindow, UNDER } from '@/lib/core/windowedStat';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import type { PropOddsRow } from '@/lib/db/client';
import { marketText } from '@/components/MarketLabel';
import { toVenueBinarySplit } from '@/lib/sports/shared/venueSplit';
import { MIDDOT, fmt } from '@/components/charts/tokens';
import type { SpatialGridRole } from '@/lib/sports/shared/playerRoles';
import type { ShotGrid } from '@/lib/sports/soccer/understatShots';
import type { ChipDef, GamelogRow, MatchupExplorerData, PlayerDetailChart, PlayerDetailData, PropOddsBoardProps, SummaryStat, WindowedStat5 } from '@/lib/sports/mlb/adapters/playerDetailAdapter';
import { toCareerH2H } from '@/lib/sports/shared/careerH2H';

interface SoccerSeasonStats {
  games: number;
  goals: number;
  xG: number;
  assists: number;
  xA: number;
  shots: number;
  keyPasses: number;
}
interface SoccerSeasonRank {
  rank: number;
  poolSize: number;
  positionLabel: string;
}
interface SoccerOpponentDefense {
  teamTitle: string;
  gamesPlayed: number;
  goalsAgainstPerGame: number;
  xGAPerGame: number;
  goalsForPerGame: number;
  rank: number;
  poolSize: number;
}

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

const GAMELOG_COLUMNS = [
  { key: 'goals', label: 'G' },
  { key: 'shots', label: 'Sh' },
  { key: 'assists', label: 'A' },
];

export interface SoccerPlayerDetailScope {
  lineOffset: number;
  opponentOnly: boolean;
  lastN: number | 'all';
  showAllGames: boolean;
  kpiScope: 'season' | 'l15';
}

export interface SoccerPlayerDetailInput {
  candidates: PickCandidate[];
  market?: string;
  snapshot: SportSnapshot | null;
  scope: SoccerPlayerDetailScope;
  propOdds?: { rows: PropOddsRow[]; userSportsbook: string };
}

export function toPlayerDetailData(input: SoccerPlayerDetailInput): PlayerDetailData | null {
  const { candidates, market, snapshot, scope, propOdds } = input;

  const active = candidates.find((c) => c.dimension === market) ?? candidates[0];
  if (!active) return null;

  const meta = (active.subjectMeta ?? {}) as Record<string, unknown>;
  const teamAbbr = typeof meta.team === 'string' ? meta.team : undefined;
  const opponentAbbr = typeof meta.opponent === 'string' ? meta.opponent : undefined;
  // Real team name (Understat/ASA's own opponent identifier, e.g. "Newcastle
  // United") — history entries' `raw.opponentAbbr` carries this same real
  // name despite its field name (see adapter.ts's comment), never the ESPN
  // abbreviation `opponentAbbr` above holds. Filtering/H2H below must
  // compare against this, or every comparison silently fails.
  const opponentName = typeof meta.opponentName === 'string' ? meta.opponentName : undefined;
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
  const wantOver = true; // every soccer market here is "did/will this happen", not a two-sided over/under pick.

  // ---- Scope filters (mirrors NflPlayerDetail's opponent + lastN; no venue filter) ----
  let scoped = active.history;
  if (scope.opponentOnly && opponentName) {
    scoped = scoped.filter((e) => (rawOf(e).opponentAbbr as string | undefined) === opponentName);
  }
  if (scope.lastN !== 'all') scoped = scoped.slice(-scope.lastN);

  const measured = categoriseByLine(scoped, line);
  const wanted = wantOver ? OVER : UNDER;

  // ---- Role 3 | spatialGrid: the shot map (6.9).
  // EPL only. Understat covers the big five leagues; MLS is sourced from
  // American Soccer Analysis, which carries no shot coordinates, so
  // `meta.shotGrid` is simply absent there and no card renders — the same
  // rule working, not a gap being hidden.
  //
  // The cells show SHOT SHARE, not xG: mean xG per cell is very nearly a
  // function of the cell itself, so it reads the same for every player.
  // Where someone actually shoots from is specific to them. The xG and the
  // conversion travel in the caption.
  const shotGrid = (meta.shotGrid ?? null) as ShotGrid | null;
  const spatialGrid: SpatialGridRole | null = shotGrid
    ? {
        title: 'Shot location',
        cells: shotGrid.cells.map((row) =>
          row.map((c) => ({ key: c.key, value: c.shots > 0 ? c.share : null, sampleSize: c.shots })),
        ),
        rowLabels: shotGrid.rowLabels,
        columnLabels: shotGrid.columnLabels,
        format: fmt.pct0,
        unit: 'of shots',
        caption: [
          `${shotGrid.totalShots.toLocaleString()} shots`,
          `${shotGrid.totalGoals} scored`,
          shotGrid.meanXg != null ? `${shotGrid.meanXg.toFixed(2)} xG per shot` : null,
          shotGrid.seasons.length > 0
            ? shotGrid.seasons.length === 1
              ? shotGrid.seasons[0]
              : `${shotGrid.seasons[0]}-${shotGrid.seasons[shotGrid.seasons.length - 1]}`
            : null,
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
    statLabel: marketText('soccer', active.dimension, 'compact'),
  });

  const windows: WindowedStat5 = {
    l5: fixedWindow(measured, wanted, 5),
    l10: fixedWindow(measured, wanted, 10),
    l15: fixedWindow(measured, wanted, 15),
    szn: openWindow(measured, wanted, { minimum: 1 }),
    h2h:
      !opponentName
        ? { status: 'insufficient', available: 0, required: 1 }
        : subsetWindow(categoriseByLine(active.history, line), wanted, (e) => (rawOf(e).opponentAbbr as string | undefined) === opponentName, { minimum: 1 }),
  };

  // ---- Role 6 | careerH2H (6.13). NOT a second copy of the h2h window box:
  // that reports one rate, this reports the per-MEETING history behind it.
  // "3 of 5" and "3 of 5, all three in one season" are different facts and a
  // single rate cannot tell them apart. Same opponent predicate `windows.h2h`
  // uses above -- deliberately the same expression, so the two can never
  // disagree about who the opponent is.
  const careerH2H = opponentName
    ? toCareerH2H({
        measured: categoriseByLine(active.history, line),
        wanted,
        isVsOpponent: (e) => (rawOf(e).opponentAbbr as string | undefined) === opponentName,
        opponentLabel: `vs ${opponentName}`,
        statLabel: marketText('soccer', active.dimension, 'compact'),
      })
    : null;

  const chips: ChipDef[] = [
    ...(opponentAbbr ? [{ key: 'opponent', label: `vs ${opponentAbbr}` }] : []),
    { key: 'lastN:5', label: 'Last 5' },
    { key: 'lastN:10', label: 'Last 10' },
    { key: 'lastN:15', label: 'Last 15' },
    { key: 'lastN:all', label: 'All games' },
  ];

  // Real opponent logo — `toHistoryEntries` (adapter.ts) now embeds
  // `opponentLogoUrl` via `soccerTeamLogoByName`/`matchSoccerTeamLogo`; this
  // just reads it (2026-08-24 fix — soccer's chart/gamelog never had
  // opponent logos before).
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
          subtitle: active.history.length === 0 ? 'No per-match history source yet for this market' : `green cleared ${wantOver ? 'over' : 'under'} ${line}`,
          data: [],
          line,
          wantOver,
          logoFor,
        };

  // ---- Gamelog: real goals/shots/assists per match (whichever were captured on `raw`) ----
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

  // Real summary strip (2026-08-24) — top-of-card headline stats, scoped by
  // the existing KPI-scope toggle.
  const kpiSource = scope.kpiScope === 'l15' ? scoped.slice(-15) : scoped;
  const summaryStrip: SummaryStat[] | undefined =
    kpiSource.length > 0 && columns.length > 0
      ? columns.slice(0, 4).map((col) => ({
          label: col.label,
          display: String(kpiSource.reduce((s, e) => s + (Number(rawOf(e)[col.key]) || 0), 0)),
        }))
      : undefined;

  const activeMarketKey = candidateDimensionToMarketKey(active.dimension);
  const propOddsBoard: PropOddsBoardProps | null =
    activeMarketKey && propOdds
      ? { allRows: propOdds.rows, subjectId: active.subjectId, marketKey: activeMarketKey, line: active.line ?? null, userSportsbook: propOdds.userSportsbook }
      : null;

  // ---- Real season totals + opponent defense (Understat, EPL) ----
  const seasonStats = meta.seasonStats as SoccerSeasonStats | undefined;
  const seasonRank = meta.seasonRank as SoccerSeasonRank | undefined;
  const opponentDefense = meta.opponentDefense as SoccerOpponentDefense | undefined;

  const nflSeasonStats: PlayerDetailData['nflSeasonStats'] = seasonStats
    ? {
        rows: [
          { key: 'games', label: 'Games', value: seasonStats.games, decimals: 0 },
          { key: 'goals', label: 'Goals', value: seasonStats.goals, decimals: 0, rank: seasonRank ? { rank: seasonRank.rank, poolSize: seasonRank.poolSize } : undefined },
          { key: 'xG', label: 'xG', value: seasonStats.xG, decimals: 2 },
          { key: 'assists', label: 'Assists', value: seasonStats.assists, decimals: 0 },
          { key: 'xA', label: 'xA', value: seasonStats.xA, decimals: 2 },
          { key: 'shots', label: 'Shots', value: seasonStats.shots, decimals: 0 },
          { key: 'keyPasses', label: 'Key Passes', value: seasonStats.keyPasses, decimals: 0 },
        ],
        rankedAmongLabel: seasonRank?.positionLabel,
      }
    : null;

  // Team-wide only — real per-position (striker/midfielder/defender) split
  // needs match-level shot data joined to the scorer's position, which
  // Understat's team-aggregate endpoints don't expose; not attempted
  // tonight rather than fabricate a plausible-looking split (see
  // docs/matchup-card-rebuild-gameplan-2026-08-23.md §6's soccer row).
  const matchupExplorer: MatchupExplorerData | null =
    seasonStats && opponentDefense && opponentAbbr
      ? {
          subjectName: active.subjectName,
          subjectHeadshotUrl: headshotUrl,
          subjectTeamAbbr: teamAbbr,
          subjectTeamLogoUrl: teamLogoUrl,
          positionGroups: null,
          subjectStatsByGroup: {
            _default: [
              { key: 'goals', label: 'Goals/Gm', value: seasonStats.games > 0 ? seasonStats.goals / seasonStats.games : 0, decimals: 2, rank: null, poolSize: null },
              { key: 'shots', label: 'Shots/Gm', value: seasonStats.games > 0 ? seasonStats.shots / seasonStats.games : 0, decimals: 2, rank: null, poolSize: null },
              { key: 'xG', label: 'xG/Gm', value: seasonStats.games > 0 ? seasonStats.xG / seasonStats.games : 0, decimals: 2, rank: null, poolSize: null },
            ],
          },
          defaultOpponentId: 'today',
          opponentOptions: null,
          opponentMeta: { today: { id: 'today', abbr: opponentAbbr, name: opponentAbbr, logoUrl: opponentLogoUrl } },
          opponentStatsByGroup: {
            today: {
              _default: [
                { key: 'goals', label: 'Goals Allowed/Gm', value: opponentDefense.goalsAgainstPerGame, decimals: 2, rank: opponentDefense.rank, poolSize: opponentDefense.poolSize },
                { key: 'xG', label: 'xG Allowed/Gm', value: opponentDefense.xGAPerGame, decimals: 2, rank: opponentDefense.rank, poolSize: opponentDefense.poolSize },
              ],
            },
          },
          contextLine: null,
        }
      : null;

  return {
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
    // No player-level live data source — ESPN's soccer summary endpoint
    // carries no `boxscore.players` for this sport (verified live, see
    // lib/sports/soccer/liveGame.ts's header comment), a real data-shape
    // gap, not an oversight. `availableStats: []` (rather than omitting
    // the slot) would still need a live gameId to be honest about "why
    // empty" — simpler and equally honest to leave the whole slot null
    // until soccer gets a real per-player live source.
    liveLineTracker: null,
  };
}
