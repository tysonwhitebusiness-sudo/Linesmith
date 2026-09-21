/**
 * `PlayerDetail.tsx` adapter — NBA half. Mirrors CFB's/soccer's player
 * adapter: real per-game history (points/rebounds/assists/steals/blocks/
 * turnovers/threes-made, sourced from sportsdataverse.ts) drives real
 * L5/L10/L15/H2H/SZN windows, a real distribution chart, and a real
 * per-game gamelog, same windowed-stat engine every other sport's adapter
 * uses. `model`/`hitterStats`/`matchups` stay `null` — no grading model
 * for NBA yet. `propOddsBoard` is real and independent of history.
 */

import type { PlayerPool } from '@/lib/sports/shared/playerPool';
import { liveLinePricing } from '@/lib/sports/shared/liveLine';
import type { PlayerBio, PlayerHistory, PlayerResearchData } from '@/lib/sports/shared/playerResearchShapes';
import { buildPlayerResearch } from '@/lib/sports/shared/playerResearch';
import { NBA_SPEC } from './playerResearchSpec';
import type { PickCandidate, SportSnapshot } from '@/lib/core/types';
import { categoriseByLine, fixedWindow, openWindow, OVER, subsetWindow, UNDER } from '@/lib/core/windowedStat';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import { repriceAtMainLine } from '@/lib/odds/props/mainLine';
import { nbaShotSection, type NbaShotsInput } from '@/lib/sports/nba/playerShotShapes';
import { toNbaGameState } from '@/lib/sports/multiSport/hoopsHockeyGameState';
import type { NbaLiveGameDetail } from '@/lib/sports/nba/liveGame';
import type { PropOddsRow } from '@/lib/db/client';
import { marketText } from '@/components/MarketLabel';
import { toVenueBinarySplit } from '@/lib/sports/shared/venueSplit';
import type { ChipDef, PlayerDetailChart, PlayerDetailData, PropOddsBoardProps, WindowedStat5 } from '@/lib/sports/mlb/adapters/playerDetailAdapter';
import type { NbaTeamDefenseAllowed } from '@/lib/sports/nba/teamDefenseAllowed';
import { toRoleStat, type OpponentUnitRole, type SpatialGridRole, type UsageMixRole } from '@/lib/sports/shared/playerRoles';
import { toCareerH2H } from '@/lib/sports/shared/careerH2H';
import { toRestConditions } from '@/lib/sports/shared/restConditions';

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

export interface NbaPlayerDetailScope {
  lineOffset: number;
  opponentOnly: boolean;
  lastN: number | 'all';
}

export interface NbaPlayerDetailInput {
  /** `useNbaLiveGame(...)`'s result — C4's game state (R6.5). Structural, not an import of the hook's type. */
  live?: { data: NbaLiveGameDetail | null; loading: boolean };
  candidates: PickCandidate[];
  market?: string;
  snapshot: SportSnapshot | null;
  scope: NbaPlayerDetailScope;
  propOdds?: { rows: PropOddsRow[]; userSportsbook: string };
  /** League-wide defense-allowed leaderboard, see the identical field on `CfbPlayerDetailInput` for the full reasoning. */
  teamDefenseAllowed?: NbaTeamDefenseAllowed[];
}

export function toPlayerDetailData(input: NbaPlayerDetailInput): PlayerDetailData | null {
  const { candidates, market, snapshot, scope, propOdds, teamDefenseAllowed = [] } = input;

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

  // ---- The line (R6-F9) ----
  // The candidate carries the main line as the snapshot found it, which goes
  // stale between rebuilds; this is the rule every other sport now runs.
  const activeMarketKey = candidateDimensionToMarketKey(active.dimension);
  const startIso = todaysGame?.firstPitch ?? null;
  const activeRows =
    activeMarketKey && propOdds ? propOdds.rows.filter((r) => r.subjectId === active.subjectId && r.marketKey === activeMarketKey) : [];
  const { marketLine, priced: priceCandidate } = repriceAtMainLine(active, activeRows, startIso);
  const baseLine = marketLine ?? active.line ?? 0.5;
  const line = Math.max(0, baseLine + scope.lineOffset);
  const wantOver = true;

  let scoped = active.history;
  if (scope.opponentOnly && opponentAbbr) {
    scoped = scoped.filter((e) => (rawOf(e).opponentAbbr as string | undefined) === opponentAbbr);
  }
  if (scope.lastN !== 'all') scoped = scoped.slice(-scope.lastN);

  const measured = categoriseByLine(scoped, line);
  const wanted = wantOver ? OVER : UNDER;

  // ---- The 3x3 shot grid and the shot-type donut are GONE (R6.5). ----
  // They were a 9-cell summary of `nba_shot_events` standing in for the shot
  // chart G2 asks for. The "Shot profile" section now draws every located
  // attempt on a real half court (`playerShotShapes.ts`) with its own zone and
  // type tables, so keeping a coarser view of the same rows beside it would
  // only invite the two to disagree. The whole chain behind it —
  // `/api/nba/shot-profile`, `useNbaShotProfile`, `shotProfile.ts` and
  // `shotProfileShapes.ts` — is deleted with it: grepped 2026-09-15, this page
  // was its only caller.
  const usageMix: UsageMixRole | null = null;
  const spatialGrid: SpatialGridRole | null = null;

  // ---- Role 4 | binarySplit: home/away, off the `raw.isHome` this sport's
  // history already carries but exposes through no filter chip.
  // Over the FULL history, not `scoped` - this is a season-level fact, the
  // same reason `windows.h2h` reads `active.history` rather than `measured`.
  // Null unless BOTH venues have a real sample; see `venueSplit.ts` for the
  // resolution defect that guard contains.
  const binarySplit = toVenueBinarySplit({
    measured: categoriseByLine(active.history, line),
    wanted,
    statLabel: marketText('nba', active.dimension),
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
  // Same league-wide defense-allowed leaderboard the matchup card already
  // reads, reduced to the one opponent and rendered as a named unit.
  //
  // ONE ROW PER GROUP, each labelled by the group. The candidate carries no
  // position for this sport, so picking a single group would mean guessing
  // which one applies -- and there are only three of them. Showing all of
  // them labelled is the honest read of what this defense allows.
  const opponentDefenseTeam = opponentAbbr ? teamDefenseAllowed.find((t) => t.abbr === opponentAbbr) : undefined;
  const opponentUnit: OpponentUnitRole | null = opponentDefenseTeam
    ? {
        title: 'Opposing defense',
        name: `${opponentAbbr} defense`,
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
        statLabel: marketText('nba', active.dimension),
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

  const propOddsBoard: PropOddsBoardProps | null =
    activeMarketKey && propOdds
      ? { allRows: propOdds.rows, subjectId: active.subjectId, marketKey: activeMarketKey, line: marketLine ?? active.line ?? null, userSportsbook: propOdds.userSportsbook }
      : null;

  // ---- Real season totals (sportsdataverse.ts, summed across every real game — adapter.ts) ----

  // ---- C4 game state (R6.5) ----
  // "Your lines so far" from the live box score, which the plan asks for by
  // name for NBA; the builder is shared with NHL.
  const gameState = toNbaGameState({
    live: input.live ?? { data: null, loading: false },
    subjectName: active.subjectName,
    candidates,
    ...liveLinePricing(propOdds, startIso),
    gameHref: todaysGame?.gamePk ? `/nba/game/${todaysGame.gamePk}` : null,
    teams: { abbr: teamAbbr, logoUrl: teamLogoUrl, opponentAbbr, opponentLogoUrl },
    started: startIso != null && Date.now() >= Date.parse(startIso),
  });

  return {
    usageMix,
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
    chart,
    propOddsBoard,
    formWindows: active.supportingSplits ?? null,
    lineControl: { kind: 'stepper', line, baseLine, wantOver },
    priceCandidate,
    gameState,
  };
}

/**
 * The player page's shared research sections (Seasons, Trends, Splits, Game
 * log, the hero's season tiles) — R6.1a. Built from the player's history and
 * bio, never from a candidate, so the page renders with no market at all.
 * The columns are this sport's `playerResearchSpec.ts`; the work is
 * `buildPlayerResearch`, shared by every sport.
 */
export function toPlayerResearchData(input: {
  history: PlayerHistory;
  bio: PlayerBio | null;
  now?: Date;
  pool?: PlayerPool | null;
  shots?: NbaShotsInput;
}): PlayerResearchData | null {
  const research = buildPlayerResearch({ sport: 'nba', history: input.history, spec: NBA_SPEC, now: input.now, pool: input.pool });
  if (!research || !input.shots) return research;
  return { ...research, sections: [nbaShotSection({ ...input.shots, scopeSeason: research.splits.defaultSeason })] };
}
