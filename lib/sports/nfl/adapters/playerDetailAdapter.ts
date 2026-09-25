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

import type { UnifiedGameLine } from '@/lib/odds/types';
import { gamePkOf, gameSideOf, todaysLineFromGameLines } from '@/lib/sports/shared/todaysLine';
import type { PlayerPool } from '@/lib/sports/shared/playerPool';
import { liveLinePricing } from '@/lib/sports/shared/liveLine';
import type { PlayerBio, PlayerHistory, PlayerResearchData } from '@/lib/sports/shared/playerResearchShapes';
import { buildPlayerResearch } from '@/lib/sports/shared/playerResearch';
import { footballResearchSpec } from './playerResearchSpec';
import type { PickCandidate, SportSnapshot } from '@/lib/core/types';
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
import { repriceAtMainLine } from '@/lib/odds/props/mainLine';
import { toFootballGameState } from '@/lib/sports/multiSport/footballGameState';
import type { PropOddsRow } from '@/lib/db/client';
import { toRoleStat, type OpponentUnitRole } from '@/lib/sports/shared/playerRoles';
import { nflTargetsSection, type NflTargetsInput } from '@/lib/sports/nfl/targetShapes';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import type {
  ChipDef,
  PlayerDetailChart,
  PlayerDetailData,
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

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

/** The interactive scope state `PlayerDetail.tsx` owns for NFL — mirrors `MlbPlayerDetailScope` minus the fields NFL has no equivalent of (no `venue`, no `kpiScope`). */
export interface NflPlayerDetailScope {
  lineOffset: number;
  opponentOnly: boolean;
  lastN: number | 'all';
}

export interface NflPlayerDetailInput {
  /**
   * `useFootballLiveGame(...)`'s result — C4's game state (R6.2). Structural,
   * not an import of the hook's type, so this file stays a pure transform.
   */
  live?: { data: import('@/lib/sports/multiSport/footballLiveGame').FootballLiveGameDetail | null; loading: boolean };
  candidates: PickCandidate[];
  market?: string;
  snapshot: SportSnapshot | null;
  scope: NflPlayerDetailScope;
  propOdds?: { rows: PropOddsRow[]; userSportsbook: string };
  /** `useGameLines(sport)`'s lines: the player's game's line (P1). */
  gameLines?: readonly UnifiedGameLine[] | null;
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
  const opponentDefenseAllowed = (richMeta.opponentDefenseAllowed as NflvStatLine[] | undefined) ?? [];
  const positionRank = typeof richMeta.positionRank === 'number' ? richMeta.positionRank : null;
  const positionPoolSize = typeof richMeta.positionPoolSize === 'number' ? richMeta.positionPoolSize : null;
  const sideOfBallRank = typeof richMeta.sideOfBallRank === 'number' ? richMeta.sideOfBallRank : null;
  const sideOfBallPoolSize = typeof richMeta.sideOfBallPoolSize === 'number' ? richMeta.sideOfBallPoolSize : null;
  const rankPrefix = positionRank != null ? `#${positionRank} ` : '';
  const rankDetail =
    positionRank != null && positionPoolSize != null
      ? `${ordinal(positionRank)} of ${positionPoolSize} ${position ?? ''}${
          sideOfBallRank != null && sideOfBallPoolSize != null
            ? ` · ${ordinal(sideOfBallRank)} of ${sideOfBallPoolSize} ${(position && SIDE_OF_BALL_LABEL[position]) ?? ''}`
            : ''
        }`
      : undefined;

  const activeMarketKey = candidateDimensionToMarketKey(active.dimension);

  const wantOver = directionMark(active.category ?? '') !== 'U';

  const games = ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{ gamePk: string; firstPitch?: string }>;
  const todaysGame = games.find((g) => String(g.gamePk) === String(meta.gamePk));

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

  // Role 3 | spatialGrid: NFL's target map was a 2x3 share grid here until
  // R6.2. The same rows now draw every located pass at its own air yards in
  // "Usage & depth" / "Where he throws" (`targetShapes.ts`), which the grid
  // could not show, so the prop block no longer repeats them.
  const spatialGrid = null;

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
        statLabel: marketText('nfl', active.dimension),
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

  // ---- Prop odds board (universal, no branch) ----

  // ---- Form (NflPlayerDetail.tsx:559-571 — same `active.supportingSplits`, already sport-agnostic) ----
  const formWindows = active.supportingSplits ?? null;

  // The defence's allowed stats, which the opponentUnit role below reads. (The
  // universal matchup card that also used them was deleted in R10: compare
  // replaced it.)
  const matchupOpponentStats = opponentDefenseAllowed.map(toStatRow);

  // ---- Role 1 | opponentUnit: the defense this player faces.
  // `opponentDefenseAllowed` is already filtered to THIS player's position
  // groups upstream (see the adapter's richMeta note), so these are the
  // defensive numbers that actually bear on his market -- not the unit's
  // whole profile. Same rows the matchup card draws, one level simpler.
  const opponentUnit: OpponentUnitRole | null =
    opponentAbbr && matchupOpponentStats.length > 0
      ? {
          title: 'Opposing defense',
          name: `${opponentAbbr} defense`,
          subtitle: 'Allows',
          logoUrl: opponentLogoUrl,
          stats: matchupOpponentStats.map((st) => toRoleStat(st)),
          emptyMessage: 'No defensive splits for this opponent yet.',
        }
      : null;

  // ---- C4 game state (R6.2) ----
  // The live route is ESPN's summary for both football leagues, so one builder
  // fills the slot (`footballGameState.ts`); the lines so far are measured
  // against the same main line the stepper shows.
  const gameState = toFootballGameState({
    sport: 'nfl',
    live: input.live ?? { data: null, loading: false },
    subjectName: active.subjectName,
    candidates,
    ...liveLinePricing(propOdds, startIso),
    gameHref: todaysGame?.gamePk ? `/nfl/game/${todaysGame.gamePk}` : null,
    teams: { abbr: teamAbbr, logoUrl: teamLogoUrl, opponentAbbr, opponentLogoUrl },
    started: startIso != null && Date.now() >= Date.parse(startIso),
  });

  return {
    // P1 (odds workstream): the player's game's line, from /api/odds/lines.
    gameLine: todaysLineFromGameLines(input.gameLines, gamePkOf(active), gameSideOf(active)),
    opponentUnit,
    conditions,
    spatialGrid,
    // ---- Role 6 | careerH2H (6.13). It was BUILT in ef93a7a and returned from
    // the wrong object: the variable landed inside the per-row gamelog literal
    // a few dozen lines above, where nothing reads it, so `data.careerH2H` was
    // undefined and the block never rendered for NFL. `tsc` passed it — a
    // gamelog row is a structural type and an extra property on an object
    // literal assigned through a mapped callback is not excess-property
    // checked. Caught by counting which sports actually fill each role.
    careerH2H,
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
    chart,
    formWindows,
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
export function toPlayerResearchData(input: { history: PlayerHistory; bio: PlayerBio | null; now?: Date; pool?: PlayerPool | null; targets?: NflTargetsInput }): PlayerResearchData | null {
  const research = buildPlayerResearch({ sport: 'nfl', history: input.history, spec: footballResearchSpec('nfl', input.bio, input.history.games), now: input.now, pool: input.pool });
  // NFL's own section (R6.2). The role is the player's, not the market's: a
  // quarterback's chart is what he threw and a receiver's what was thrown to
  // him, and the page renders either without a line.
  return research && input.targets ? { ...research, sections: [nflTargetsSection({ ...input.targets, scopeSeason: research.splits.defaultSeason })] } : research;
}
