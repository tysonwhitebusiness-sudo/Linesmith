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

import { liveLinePricing } from '@/lib/sports/shared/liveLine';
import type { PlayerBio, PlayerHistory, PlayerResearchData } from '@/lib/sports/shared/playerResearchShapes';
import { buildPlayerResearch } from '@/lib/sports/shared/playerResearch';
import { footballResearchSpec } from '@/lib/sports/nfl/adapters/playerResearchSpec';
import { cfbEfficiencySection } from '@/lib/sports/nfl/targetShapes';
import type { PickCandidate, Sport, SportSnapshot } from '@/lib/core/types';
import { toConditionsRole } from '@/lib/sports/shared/conditionsRole';
import { categoriseByLine, fixedWindow, openWindow, OVER, subsetWindow, UNDER } from '@/lib/core/windowedStat';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import { repriceAtMainLine } from '@/lib/odds/props/mainLine';
import { toFootballGameState } from '@/lib/sports/multiSport/footballGameState';
import type { PropOddsRow } from '@/lib/db/client';
import { marketText } from '@/components/MarketLabel';
import { toVenueBinarySplit } from '@/lib/sports/shared/venueSplit';
import type { ChipDef, MatchupExplorerData, PlayerDetailChart, PlayerDetailData, PropOddsBoardProps, WindowedStat5 } from '@/lib/sports/mlb/adapters/playerDetailAdapter';
// Type-only import — `teamDefenseAllowed.ts` itself pulls in `lib/db/client`
// (Postgres, server-only), so only its TYPE is safe to bring into this
// client-bundled adapter; the matching logic below is a local pure copy,
// same reasoning as this file's own `normalizeTeamName` above.
import type { CfbTeamDefenseAllowed } from '@/lib/sports/cfb/teamDefenseAllowed';
import { toCareerH2H } from '@/lib/sports/shared/careerH2H';
import { toRoleStat, type OpponentUnitRole } from '@/lib/sports/shared/playerRoles';
import { isTeamNameMatch, normalizeTeamName } from '@/lib/sports/shared/teamNameMatch';

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
/**
 * CFBD's own opponent name ("Alabama") and ESPN's full display name
 * ("Alabama Crimson Tide") are real but differently-conventioned —
 * substring match rather than exact equality, same real fix
 * `adapter.ts`'s own H2H split needed (found together, same class of bug
 * as soccer's identical opponent-name/abbreviation mismatch).
 */
const isOpponentMatch = isTeamNameMatch;

export interface CfbPlayerDetailScope {
  lineOffset: number;
  opponentOnly: boolean;
  lastN: number | 'all';
}

export interface CfbPlayerDetailInput {
  /**
   * `useFootballLiveGame(...)`'s result — C4's game state (R6.2). Structural,
   * not an import of the hook's type, so this file stays a pure transform.
   */
  live?: { data: import('@/lib/sports/multiSport/footballLiveGame').FootballLiveGameDetail | null; loading: boolean };
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

  const activeMarketKey = candidateDimensionToMarketKey(active.dimension);

  // ---- The line (R6-F9) ----
  // The candidate carries the main line as it stood when the slate snapshot was
  // built, which can be hours old: measured 2026-09-15, Josh Allen's passing
  // yards candidate read 249.5 while the books' current main line was 248.5.
  // `repriceAtMainLine` is the same rule MLB uses, run against the rows the
  // page holds now, so the stepper, the price, the movement chart and the
  // "Odds & prices" table all name one line.
  const startIso = todaysGame?.firstPitch ?? null;
  const activeRows =
    activeMarketKey && propOdds ? propOdds.rows.filter((r) => r.subjectId === active.subjectId && r.marketKey === activeMarketKey) : [];
  const { marketLine, priced: priceCandidate } = repriceAtMainLine(active, activeRows, startIso);
  const baseLine = marketLine ?? active.line ?? 0.5;
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
    statLabel: marketText('cfb', active.dimension),
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

  // ---- Role 1 | opponentUnit: the defense this player faces.
  // CFB CAN BE PRECISE where NBA and NHL cannot: its groups are
  // passing/rushing/receiving, and the candidate's own market names which one
  // applies -- a receiving-yards prop is read against the receiving defense,
  // not against all three. Falls back to every group only when the market is
  // one this mapping does not cover, which is honest rather than silent.
  const cfbDefenseGroupKey = active.dimension.startsWith('passing-')
    ? 'passing'
    : active.dimension.startsWith('rushing-')
      ? 'rushing'
      : active.dimension.startsWith('receiving-')
        ? 'receiving'
        : null;
  const cfbDefenseTeam = opponentName ? teamDefenseAllowed.find((t) => isOpponentMatch(t.teamName, opponentName)) : undefined;
  const cfbDefenseGroups = cfbDefenseGroupKey
    ? CFB_MATCHUP_GROUPS.filter((g) => g.key === cfbDefenseGroupKey)
    : [...CFB_MATCHUP_GROUPS];
  const opponentUnit: OpponentUnitRole | null = cfbDefenseTeam
    ? {
        title: 'Opposing defense',
        name: `${opponentName} defense`,
        subtitle: 'Allows',
        logoUrl: opponentLogoUrl,
        stats: cfbDefenseGroups.flatMap((g) =>
          cfbDefenseRow(cfbDefenseTeam, g.key).map((r) =>
            toRoleStat(cfbDefenseGroupKey ? r : { ...r, label: `${r.label} vs ${g.label}` }),
          ),
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
  const careerH2H = opponentName
    ? toCareerH2H({
        measured: categoriseByLine(active.history, line),
        wanted,
        isVsOpponent: (e) => isOpponentMatch(rawOf(e).opponentAbbr as string | undefined, opponentName),
        opponentLabel: `vs ${opponentName}`,
        statLabel: marketText('cfb', active.dimension),
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


  const propOddsBoard: PropOddsBoardProps | null =
    activeMarketKey && propOdds
      ? { allRows: propOdds.rows, subjectId: active.subjectId, marketKey: activeMarketKey, line: marketLine ?? active.line ?? null, userSportsbook: propOdds.userSportsbook }
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



  // ---- C4 game state (R6.2) ----
  // The live route is ESPN's summary for both football leagues, so one builder
  // fills the slot (`footballGameState.ts`); the lines so far are measured
  // against the same main line the stepper shows.
  const gameState = toFootballGameState({
    sport: 'cfb',
    live: input.live ?? { data: null, loading: false },
    subjectName: active.subjectName,
    candidates,
    ...liveLinePricing(propOdds, startIso),
    gameHref: todaysGame?.gamePk ? `/cfb/game/${todaysGame.gamePk}` : null,
    teams: { abbr: teamAbbr, logoUrl: teamLogoUrl, opponentAbbr, opponentLogoUrl },
    started: startIso != null && Date.now() >= Date.parse(startIso),
  });

  return {
    opponentUnit,
    careerH2H,
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
    propOddsBoard,
    model: null,
    formWindows: active.supportingSplits ?? null,
    lineControl: { kind: 'stepper', line, baseLine, wantOver },
    priceCandidate,
    gameState,
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

/**
 * The player page's shared research sections (Seasons, Trends, Splits, Game
 * log, the hero's season tiles) — R6.1a. Built from the player's history and
 * bio, never from a candidate, so the page renders with no market at all.
 * The columns are this sport's `playerResearchSpec.ts`; the work is
 * `buildPlayerResearch`, shared by every sport.
 */
export function toPlayerResearchData(input: { history: PlayerHistory; bio: PlayerBio | null; now?: Date }): PlayerResearchData | null {
  const spec = footballResearchSpec('cfb', input.bio, input.history.games);
  const research = buildPlayerResearch({ sport: 'cfb', history: input.history, spec, now: input.now });
  // College play-by-play is not ingested, so a quarterback's efficiency
  // section says so rather than being absent (R6.2, G2's own CFB state).
  return research && spec.kind === 'quarterback' ? { ...research, sections: [cfbEfficiencySection()] } : research;
}
