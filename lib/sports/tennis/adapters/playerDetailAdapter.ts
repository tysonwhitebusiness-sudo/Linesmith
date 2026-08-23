/**
 * `PlayerDetail.tsx` adapter — tennis half.
 *
 * Real per-match history for all three tennis markets (aces, games-won,
 * to-win-a-set — see `lib/sports/tennis/adapter.ts`'s header), sourced from
 * stats.tennismylife.org. `windows`/`chart`/`gamelog` reuse the same
 * windowed-stat engine soccer's/NFL's adapters use, scoped by opponent +
 * lastN — no venue filter (tennis has no home/away).
 *
 * No team concept: `teamAbbr`/`teamLogoUrl` stay `undefined` (same honest
 * gap golf's adapter documents); `opponentAbbr` below actually holds the
 * opposing player's full name, not an abbreviation — same convention
 * `multiSportGameContext.ts`'s tennis branch already uses for
 * `awayAbbr`/`homeAbbr`.
 */

import type { PickCandidate, SportSnapshot } from '@/lib/core/types';
import { categoriseByLine, fixedWindow, openWindow, OVER, subsetWindow } from '@/lib/core/windowedStat';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import type { PropOddsRow } from '@/lib/db/client';
import type { ChipDef, GamelogRow, PlayerDetailChart, PlayerDetailData, PropOddsBoardProps, WindowedStat5 } from '@/lib/sports/mlb/adapters/playerDetailAdapter';

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

const GAMELOG_COLUMNS = [
  { key: 'aces', label: 'Aces' },
  { key: 'gamesWon', label: 'Gms W' },
  { key: 'gamesLost', label: 'Gms L' },
];

export interface TennisPlayerDetailScope {
  lineOffset: number;
  opponentOnly: boolean;
  lastN: number | 'all';
  showAllGames: boolean;
}

export interface TennisPlayerDetailInput {
  candidates: PickCandidate[];
  market?: string;
  snapshot: SportSnapshot | null;
  scope: TennisPlayerDetailScope;
  propOdds?: { rows: PropOddsRow[]; userSportsbook: string };
}

export function toPlayerDetailData(input: TennisPlayerDetailInput): PlayerDetailData | null {
  const { candidates, market, snapshot, scope, propOdds } = input;

  const active = candidates.find((c) => c.dimension === market) ?? candidates[0];
  if (!active) return null;

  const meta = (active.subjectMeta ?? {}) as Record<string, unknown>;
  const opponentAbbr = typeof meta.opponent === 'string' ? meta.opponent : undefined;

  const games = ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{
    gamePk: string;
    firstPitch?: string;
  }>;
  const todaysGame = games.find((g) => String(g.gamePk) === String(meta.gamePk));

  // Every tennis candidate is built with `category: 'over' | 'yes'` (see
  // adapter.ts) — there's no real signal driving an 'under'-favored pick the
  // way MLB/NFL's history-derived direction can, so this is always "over"/
  // "did happen", same as soccer's adapter.
  const wantOver = true;
  const baseLine = active.line ?? 0.5;
  const line = Math.max(0, baseLine + scope.lineOffset);

  let scoped = active.history;
  if (scope.opponentOnly && opponentAbbr) {
    scoped = scoped.filter((e) => (rawOf(e).opponentName as string | undefined) === opponentAbbr);
  }
  if (scope.lastN !== 'all') scoped = scoped.slice(-scope.lastN);

  const measured = categoriseByLine(scoped, line);
  const wanted = OVER;

  const windows: WindowedStat5 = {
    l5: fixedWindow(measured, wanted, 5),
    l10: fixedWindow(measured, wanted, 10),
    l15: fixedWindow(measured, wanted, 15),
    szn: openWindow(measured, wanted, { minimum: 1 }),
    h2h:
      !opponentAbbr
        ? { status: 'insufficient', available: 0, required: 1 }
        : subsetWindow(categoriseByLine(active.history, line), wanted, (e) => (rawOf(e).opponentName as string | undefined) === opponentAbbr, { minimum: 1 }),
  };

  const chips: ChipDef[] = [
    ...(opponentAbbr ? [{ key: 'opponent', label: `vs ${opponentAbbr}` }] : []),
    { key: 'lastN:5', label: 'Last 5' },
    { key: 'lastN:10', label: 'Last 10' },
    { key: 'lastN:15', label: 'Last 15' },
    { key: 'lastN:all', label: 'All matches' },
  ];

  const chart: PlayerDetailChart =
    scoped.length > 0
      ? { kind: 'distribution', title: `${scoped.length} match${scoped.length === 1 ? '' : 'es'} in scope`, subtitle: `green cleared ${wantOver ? 'over' : 'under'} ${line}`, data: scoped, line, wantOver }
      : {
          kind: 'distribution',
          title: '0 matches in scope',
          subtitle: active.history.length === 0 ? 'No name match found in stats.tennismylife.org yet' : `green cleared ${wantOver ? 'over' : 'under'} ${line}`,
          data: [],
          line,
          wantOver,
        };

  const columns = GAMELOG_COLUMNS.filter((c) => scoped.some((e) => rawOf(e)[c.key] != null));
  const gamelogSource = [...scoped].reverse().slice(0, scope.showAllGames ? undefined : 15);
  const rows: GamelogRow[] = gamelogSource.map((entry, index) => {
    const raw = rawOf(entry);
    const opponent = raw.opponentName as string | undefined;
    const values: Record<string, number | string | null | undefined> = {};
    for (const col of columns) {
      const v = raw[col.key];
      values[col.key] = v == null ? null : (v as number);
    }
    return {
      key: `${entry.period}-${index}`,
      periodLabel: entry.periodLabel ?? `Match #${entry.period}`,
      opponentLabel: opponent ? `vs ${opponent}` : 'Opponent unknown',
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
      headshotUrl: undefined,
      teamAbbr: undefined,
      teamLogoUrl: undefined,
      position: undefined,
      rankPrefix: '',
      opponentAbbr,
      opponentLogoUrl: undefined,
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
