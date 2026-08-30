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

import type { PickCandidate, Sport, SportSnapshot } from '@/lib/core/types';
import { toConditionsRole } from '@/lib/sports/shared/conditionsRole';
import { categoriseByLine, fixedWindow, openWindow, OVER, subsetWindow, UNDER } from '@/lib/core/windowedStat';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import type { PropOddsRow } from '@/lib/db/client';
import { marketText } from '@/components/MarketLabel';
import { toVenueBinarySplit } from '@/lib/sports/shared/venueSplit';
import type { ChipDef, GamelogRow, MatchupExplorerData, PlayerDetailChart, PlayerDetailData, PropOddsBoardProps, SummaryStat, WindowedStat5 } from '@/lib/sports/mlb/adapters/playerDetailAdapter';
// Type-only import — `teamDefenseAllowed.ts` itself pulls in `lib/db/client`
// (Postgres, server-only), so only its TYPE is safe to bring into this
// client-bundled adapter; the matching logic below is a local pure copy,
// same reasoning as this file's own `normalizeTeamName` above.
import type { CfbTeamDefenseAllowed } from '@/lib/sports/cfb/teamDefenseAllowed';

function fuzzyMatchCfbTeamName(teams: CfbTeamDefenseAllowed[], espnName: string): CfbTeamDefenseAllowed | null {
  const normalizedEspn = normalizeTeamName(espnName);
  if (!normalizedEspn) return null;
  for (const t of teams) {
    const normalizedCfbd = normalizeTeamName(t.teamName);
    if (normalizedCfbd === normalizedEspn) return t;
  }
  for (const t of teams) {
    const normalizedCfbd = normalizeTeamName(t.teamName);
    if (normalizedCfbd && (normalizedEspn.includes(normalizedCfbd) || normalizedCfbd.includes(normalizedEspn))) return t;
  }
  return null;
}

const CFB_MATCHUP_GROUPS = [
  { key: 'passing', label: 'Passing' },
  { key: 'rushing', label: 'Rushing' },
  { key: 'receiving', label: 'Receiving' },
] as const;

function cfbDefenseRow(team: CfbTeamDefenseAllowed, groupKey: string): { key: string; label: string; value: number; decimals: number; rank: number; poolSize: number }[] {
  if (groupKey === 'passing') return [{ key: 'passingYdsAllowed', label: 'Pass Yds/Gm Allowed', value: team.passingYdsAllowedPerGame, decimals: 1, rank: team.passingRank, poolSize: team.poolSize }];
  if (groupKey === 'rushing') return [{ key: 'rushingYdsAllowed', label: 'Rush Yds/Gm Allowed', value: team.rushingYdsAllowedPerGame, decimals: 1, rank: team.rushingRank, poolSize: team.poolSize }];
  return [{ key: 'receivingYdsAllowed', label: 'Rec Yds/Gm Allowed', value: team.receivingYdsAllowedPerGame, decimals: 1, rank: team.receivingRank, poolSize: team.poolSize }];
}

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

interface CfbSeasonStats {
  games: number;
  passingYards: number;
  rushingYards: number;
  receivingYards: number;
  receptions: number;
  longestRush: number;
  longestReception: number;
  kickingPoints: number;
}

/**
 * Local copy of `screenshotImport.ts`'s `normalizeName` — that module also
 * pulls in the Anthropic SDK (server-only, `node:path` etc.), which breaks
 * the client bundle when imported from a `playerDetailAdapter.ts` (rendered
 * client-side via `PlayerDetail.tsx`). Same normalization, no SDK import.
 */
function normalizeTeamName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'`'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * CFBD's own opponent name ("Alabama") and ESPN's full display name
 * ("Alabama Crimson Tide") are real but differently-conventioned —
 * substring match rather than exact equality, same real fix
 * `adapter.ts`'s own H2H split needed (found together, same class of bug
 * as soccer's identical opponent-name/abbreviation mismatch).
 */
function isOpponentMatch(rawOpponent: string | undefined, opponentName: string | undefined): boolean {
  if (!rawOpponent || !opponentName) return false;
  const a = normalizeTeamName(rawOpponent);
  const b = normalizeTeamName(opponentName);
  return a !== '' && b !== '' && (a.includes(b) || b.includes(a));
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
  kpiScope: 'season' | 'l15';
}

export interface CfbPlayerDetailInput {
  candidates: PickCandidate[];
  market?: string;
  snapshot: SportSnapshot | null;
  scope: CfbPlayerDetailScope;
  propOdds?: { rows: PropOddsRow[]; userSportsbook: string };
  /** League-wide defense-allowed leaderboard (`useTeamDefenseAllowed('/api/cfb/team-defense-allowed', ...)`, `PlayerDetail.tsx`) — fetched once, shared across every subject on the page, so picking a custom opponent in the matchup card is a pure client re-index. `[]` while loading or when CFBD has no data yet (no `CFBD_API_KEY`, or season hasn't started) — the matchup card degrades to no card at all in that case, same "null when a sport genuinely has no data" rule as everything else in this file. */
  teamDefenseAllowed?: CfbTeamDefenseAllowed[];
}

export function toPlayerDetailData(input: CfbPlayerDetailInput): PlayerDetailData | null {
  const { candidates, market, snapshot, scope, propOdds, teamDefenseAllowed = [] } = input;

  const active = candidates.find((c) => c.dimension === market) ?? candidates[0];
  if (!active) return null;

  const meta = (active.subjectMeta ?? {}) as Record<string, unknown>;
  const teamAbbr = typeof meta.team === 'string' ? meta.team : undefined;
  const opponentAbbr = typeof meta.opponent === 'string' ? meta.opponent : undefined;
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
  const wantOver = true; // every CFB market here is a counting-stat over/under, not a two-sided pick.

  let scoped = active.history;
  if (scope.opponentOnly && opponentName) {
    scoped = scoped.filter((e) => isOpponentMatch(rawOf(e).opponentAbbr as string | undefined, opponentName));
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

  // ---- Role 4 | binarySplit: home/away, off the `raw.isHome` this sport's
  // history already carries but exposes through no filter chip.
  // Over the FULL history, not `scoped` - this is a season-level fact, the
  // same reason `windows.h2h` reads `active.history` rather than `measured`.
  // Null unless BOTH venues have a real sample; see `venueSplit.ts` for the
  // resolution defect that guard contains.
  const binarySplit = toVenueBinarySplit({
    measured: categoriseByLine(active.history, line),
    wanted,
    statLabel: marketText('cfb', active.dimension, 'compact'),
  });

  const windows: WindowedStat5 = {
    l5: fixedWindow(measured, wanted, 5),
    l10: fixedWindow(measured, wanted, 10),
    l15: fixedWindow(measured, wanted, 15),
    szn: openWindow(measured, wanted, { minimum: 1 }),
    h2h:
      !opponentName
        ? { status: 'insufficient', available: 0, required: 1 }
        : subsetWindow(categoriseByLine(active.history, line), wanted, (e) => isOpponentMatch(rawOf(e).opponentAbbr as string | undefined, opponentName), { minimum: 1 }),
  };

  const chips: ChipDef[] = [
    ...(opponentAbbr ? [{ key: 'opponent', label: `vs ${opponentAbbr}` }] : []),
    { key: 'lastN:5', label: 'Last 5' },
    { key: 'lastN:10', label: 'Last 10' },
    { key: 'lastN:15', label: 'Last 15' },
    { key: 'lastN:all', label: 'All games' },
  ];

  // Real opponent logo — `toHistoryEntries` (adapter.ts) now embeds
  // `opponentLogoUrl` via `cfbTeamLogoByCfbdName`; this just reads it
  // (2026-08-24 fix — CFB's chart/gamelog never had opponent logos before).
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

  // Real summary strip (2026-08-24) — top-of-card headline stats, scoped by
  // the existing KPI-scope toggle, built generically from whichever real
  // columns this player actually has (passing/rushing/receiving/kicking
  // differ by position — no fixed 3-stat set fits every CFB player the way
  // NBA's points/rebounds/assists does).
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

  // ---- Real season totals (CollegeFootballData.com, summed across every real game — adapter.ts) ----
  const seasonStats = meta.seasonStats as CfbSeasonStats | undefined;
  const nflSeasonStats: PlayerDetailData['nflSeasonStats'] = seasonStats
    ? {
        rows: [
          { key: 'games', label: 'Games', value: seasonStats.games, decimals: 0 },
          ...(seasonStats.passingYards > 0 ? [{ key: 'passingYards', label: 'Pass Yds', value: seasonStats.passingYards, decimals: 0 }] : []),
          ...(seasonStats.rushingYards > 0 ? [{ key: 'rushingYards', label: 'Rush Yds', value: seasonStats.rushingYards, decimals: 0 }] : []),
          ...(seasonStats.receivingYards > 0 ? [{ key: 'receivingYards', label: 'Rec Yds', value: seasonStats.receivingYards, decimals: 0 }] : []),
          ...(seasonStats.receptions > 0 ? [{ key: 'receptions', label: 'Receptions', value: seasonStats.receptions, decimals: 0 }] : []),
          ...(seasonStats.kickingPoints > 0 ? [{ key: 'kickingPoints', label: 'Kicking Pts', value: seasonStats.kickingPoints, decimals: 0 }] : []),
          ...(seasonStats.longestRush > 0 ? [{ key: 'longestRush', label: 'Long Rush', value: seasonStats.longestRush, decimals: 0 }] : []),
          ...(seasonStats.longestReception > 0 ? [{ key: 'longestReception', label: 'Long Rec', value: seasonStats.longestReception, decimals: 0 }] : []),
        ],
      }
    : null;

  // ---- Universal matchup card — CFB's first real matchup card ----
  const opponentKeyOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const subjectGamesPlayed = seasonStats && seasonStats.games > 0 ? seasonStats.games : null;
  const subjectStatsByGroupCfb: Record<string, { key: string; label: string; value: number; decimals: number; rank: null; poolSize: null }[]> = {
    passing: seasonStats && subjectGamesPlayed && seasonStats.passingYards > 0 ? [{ key: 'passingYdsAllowed', label: 'Pass Yds/Gm', value: seasonStats.passingYards / subjectGamesPlayed, decimals: 1, rank: null, poolSize: null }] : [],
    rushing: seasonStats && subjectGamesPlayed && seasonStats.rushingYards > 0 ? [{ key: 'rushingYdsAllowed', label: 'Rush Yds/Gm', value: seasonStats.rushingYards / subjectGamesPlayed, decimals: 1, rank: null, poolSize: null }] : [],
    receiving: seasonStats && subjectGamesPlayed && seasonStats.receivingYards > 0 ? [{ key: 'receivingYdsAllowed', label: 'Rec Yds/Gm', value: seasonStats.receivingYards / subjectGamesPlayed, decimals: 1, rank: null, poolSize: null }] : [],
  };
  const matchupExplorer: MatchupExplorerData | null =
    teamDefenseAllowed.length > 0
      ? {
          subjectName: active.subjectName,
          subjectHeadshotUrl: headshotUrl,
          subjectTeamAbbr: teamAbbr,
          subjectTeamLogoUrl: teamLogoUrl,
          positionGroups: [...CFB_MATCHUP_GROUPS],
          subjectStatsByGroup: subjectStatsByGroupCfb,
          defaultOpponentId: (() => {
            const match = opponentAbbr ? fuzzyMatchCfbTeamName(teamDefenseAllowed, opponentAbbr) : (opponentName ? fuzzyMatchCfbTeamName(teamDefenseAllowed, opponentName) : null);
            return match ? opponentKeyOf(match.teamName) : opponentKeyOf(teamDefenseAllowed[0].teamName);
          })(),
          opponentOptions: teamDefenseAllowed.map((t) => ({ id: opponentKeyOf(t.teamName), abbr: t.teamName.slice(0, 4).toUpperCase(), name: t.teamName, logoUrl: t.logoUrl })),
          // Real logo for every real opponent (2026-08-24 fix) — CFB's
          // matchup card never had logos at all before this;
          // `teamDefenseAllowed` now carries a real one per team via
          // `cfbTeamLogoByCfbdName` (teamDefenseAllowed.ts).
          opponentMeta: Object.fromEntries(teamDefenseAllowed.map((t) => [opponentKeyOf(t.teamName), { id: opponentKeyOf(t.teamName), abbr: t.teamName.slice(0, 4).toUpperCase(), name: t.teamName, logoUrl: t.logoUrl }])),
          opponentStatsByGroup: Object.fromEntries(
            teamDefenseAllowed.map((t) => [opponentKeyOf(t.teamName), Object.fromEntries(CFB_MATCHUP_GROUPS.map((g) => [g.key, cfbDefenseRow(t, g.key)]))]),
          ),
          contextLine: opponentName ? `Real next-game opponent: ${opponentName}` : null,
        }
      : null;

  return {
    conditions,
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
      sport: 'cfb',
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
