/**
 * `PlayerDetail.tsx` adapter — CFB half.
 *
 * Real per-game history now exists for the markets `lib/sports/cfb/adapter.ts`'s
 * `HISTORY_FIELD` covers (passing/rushing/receiving-yards, receptions,
 * longest-rush/reception, kicking-points — 7 of the 8 real market keys;
 * `longest-completion` has no CFBD source field, see that file's header),
 * sourced from CollegeFootballData.com. `windows`/`chart`/`gamelog` below
 * are the same windowed-stat engine soccer's adapter uses, scoped the same
 * way (opponent-only + lastN — no venue filter, matching soccer/NFL).
 *
 * `model`/`hitterStats`/`matchups` stay `null` — no grading/ranking model
 * or per-player season-stats source for CFB yet. `propOddsBoard` is real
 * and independent of history, same as every other sport's adapter.
 */

import type { PickCandidate, SportSnapshot } from '@/lib/core/types';
import { categoriseByLine, fixedWindow, openWindow, OVER, subsetWindow, UNDER } from '@/lib/core/windowedStat';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import type { PropOddsRow } from '@/lib/db/client';
import type { ChipDef, GamelogRow, PlayerDetailChart, PlayerDetailData, PropOddsBoardProps, WindowedStat5 } from '@/lib/sports/mlb/adapters/playerDetailAdapter';

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

const GAMELOG_COLUMNS = [
  { key: 'passingYards', label: 'Pass Yds' },
  { key: 'rushingYards', label: 'Rush Yds' },
  { key: 'receivingYards', label: 'Rec Yds' },
  { key: 'receptions', label: 'Rec' },
  { key: 'longestRush', label: 'Lng Rush' },
  { key: 'longestReception', label: 'Lng Rec' },
  { key: 'kickingPoints', label: 'Kick Pts' },
];

export interface CfbPlayerDetailScope {
  lineOffset: number;
  opponentOnly: boolean;
  lastN: number | 'all';
  showAllGames: boolean;
}

export interface CfbPlayerDetailInput {
  candidates: PickCandidate[];
  market?: string;
  snapshot: SportSnapshot | null;
  scope: CfbPlayerDetailScope;
  propOdds?: { rows: PropOddsRow[]; userSportsbook: string };
}

export function toPlayerDetailData(input: CfbPlayerDetailInput): PlayerDetailData | null {
  const { candidates, market, snapshot, scope, propOdds } = input;

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
  const wantOver = true; // every CFB market here is a counting-stat over/under, not a two-sided pick.

  let scoped = active.history;
  if (scope.opponentOnly && opponentAbbr) {
    scoped = scoped.filter((e) => (rawOf(e).opponentAbbr as string | undefined) === opponentAbbr);
  }
  if (scope.lastN !== 'all') scoped = scoped.slice(-scope.lastN);

  const measured = categoriseByLine(scoped, line);
  const wanted = wantOver ? OVER : UNDER;

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
      opponentLabel: oppAbbr ? `${isHome ? 'vs' : '@'} ${oppAbbr}` : 'Opponent unknown',
      values,
    };
  });

  const activeMarketKey = candidateDimensionToMarketKey(active.dimension);
  const propOddsBoard: PropOddsBoardProps | null =
    activeMarketKey && propOdds
      ? { allRows: propOdds.rows, subjectId: active.subjectId, marketKey: activeMarketKey, line: active.line ?? null, userSportsbook: propOdds.userSportsbook }
      : null;

  return {
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
    gamelog: scoped.length > 0 || active.history.length > 0 ? { columns, rows, cardBadges: columns } : null,
    propOddsBoard,
    model: null,
    hitterStats: null,
    formWindows: active.supportingSplits ?? null,
    lineControl: { kind: 'stepper', line, baseLine, wantOver },
    liveGame: null,
    liveMatchup: null,
    matchups: null,
    seasonStatsCard: null,
    mlbContextMatchup: null,
    golfFormHoles: null,
    nflMatchup: null,
    nflSeasonStats: null,
  };
}
