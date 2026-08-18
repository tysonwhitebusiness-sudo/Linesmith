/**
 * `PlayerDetail.tsx` adapter — MLB half.
 *
 * Phase 1 of the sport-adapter project (see `docs/sport-adapter-design.md`
 * §3). This file is purely additive: it converts MLB's real data shapes
 * (the `PickCandidate[]`/`SportSnapshot`/`UnifiedLinesResult` a caller
 * already has, plus the handful of hook results `PlayerDetail.tsx` itself
 * currently fetches) into the sport-agnostic `PlayerDetailData` the design
 * doc specifies. No existing component is touched — Phase 2 is what wires
 * this into `PlayerDetail.tsx` and removes its `active.sport === 'mlb'`
 * branches.
 *
 * `PlayerDetailData` and its supporting types are defined here (rather than
 * a third shared file) because this task is scoped to exactly two new
 * files; `lib/sports/golf/adapters/playerDetailAdapter.ts` imports the
 * shared types from here. A later phase should probably relocate the
 * sport-agnostic half of this (everything above the "MLB-specific" marker
 * below) into a neutral module once `PlayerDetail.tsx` itself starts
 * consuming it — noted, not done here, to stay inside Phase 1's scope.
 *
 * DEVIATION FROM THE DESIGN DOC (documented, see the Phase 1 report): every
 * `render*?: () => ReactNode` slot in the doc's `PlayerDetailData` sketch is
 * modeled here as plain data instead (`*Data` fields). Building a
 * `() => ReactNode` is a component's job — it needs JSX, hooks-derived
 * closures, and the app's design-system primitives, none of which an
 * adapter should import. The adapter's job stops at "here is everything
 * needed to render this slot"; Phase 2 turns each `*Data` field into real
 * JSX inside `PlayerDetail.tsx`.
 */

import type { HistoryEntry, PickCandidate, SplitEvidence, SportSnapshot, WeatherContext } from '@/lib/core/types';
import {
  categoriseByLine,
  entryValue,
  fixedWindow,
  isOk,
  openWindow,
  OVER,
  subsetWindow,
  UNDER,
  type WindowedStat,
} from '@/lib/core/windowedStat';
import { directionMark } from '@/components/MarketLabel';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import type { GameDetailGame, StatKeyDef } from '@/components/GameDetail';
import type { BatterPitcherMatchupProps } from '@/components/BatterPitcherMatchupCard';
import type { NflPlayerVsDefenseCardProps } from '@/components/NflPlayerVsDefenseCard';
import type { TeamStatcastState } from '@/components/useTeamStatcast';
import type { LiveGameState } from '@/components/useLiveGame';
import type { UnifiedLinesResult } from '@/lib/odds/types';
import { buildSlate, liveFor, type SlateGame } from '@/lib/odds/matching';
import { projectLine } from '@/lib/odds/display';
import { computeMoneylineEdge, computeTotalEdge, type MoneylineEdge, type TotalEdge } from '@/lib/odds/gameEdge';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import type { PropOddsRow } from '@/lib/db/client';
import { teamSeasonStatRows } from './statRowAdapter';
import { teamNameFor } from '@/lib/sports/mlb/teamAliases';
import { teamPrimaryColor } from '@/lib/sports/mlb/teamColors';

// ---------------------------------------------------------------------------
// Sport-agnostic supporting types — the design doc's §3 interface, plus the
// small documented additions called out in the Phase 1 report.
// ---------------------------------------------------------------------------

/** A scope-filter chip. Pure label data — `active`/`onClick` stay a component concern (the key encodes which filter it represents, e.g. `venue:home`, `lastN:10`, `round:2`, `opponent`). */
export interface ChipDef {
  key: string;
  label: string;
}

/** MLB/NFL's shared 5-window set — L5/L10/L15/H2H/SZN, exactly the shape `PlayerDetail.tsx:1081-1098` and `NflPlayerDetail.tsx:215-232` both already build by hand. Not previously given a name anywhere in the codebase; named here per the design doc's `WindowedStat5` reference (docs/sport-adapter-design.md:209). */
export interface WindowedStat5 {
  l5: WindowedStat;
  l10: WindowedStat;
  l15: WindowedStat;
  h2h: WindowedStat;
  szn: WindowedStat;
}

/** Golf's window-box replacement — one entry per round, plus a trailing tournament-average entry. Defined here (not the golf file) since it's a `PlayerDetailData` field referenced by this shared interface. */
export interface RoundScoreEntry {
  key: string;
  label: string;
  value: number | null;
  /** Which display convention Phase 2 should format `value` with — integer 'E'/'+N' for a single round, one-decimal for the average. */
  format: 'relative' | 'average';
  /** Set only on real round entries, graded against the currently-selected golf category; omitted on the average entry, where hit/miss doesn't apply. */
  hit?: boolean | null;
}

export interface GamelogColumnDef {
  key: string;
  label: string;
}

/**
 * One gamelog row, already resolved to the columns the adapter decided are
 * in use — Phase 2 never reads `entry.raw` itself.
 *
 * PHASE 2 CORRECTION: the Phase 1 version of this type carried a bare
 * `opponentId?: number` for the table's group header + card's left-border
 * tint, resolved via MLB's own `mlbLogoUrl(id)`/`teamPrimaryColor(id)`/
 * `teamNameFor(id)` inside `PlayerDetail.tsx` itself. That's MLB's own team-id
 * resolution mechanism leaking into a supposedly sport-agnostic row shape —
 * NFL identifies an opponent by abbreviation, not a numeric id, and has its
 * own logo/color lookups. Corrected to carry the already-resolved display
 * values instead, so `PlayerDetail.tsx` never needs a sport check to render a
 * gamelog row.
 */
export interface GamelogRow {
  /** Stable React key. */
  key: string;
  periodLabel: string;
  /** Pre-resolved opponent logo URL (MLB: `mlbLogoUrl(opponentId)`; NFL: `nflTeamLogoUrl(opponentAbbr)`). */
  opponentLogoUrl?: string;
  /** Pre-resolved "vs/@ Team Name" (or "Opponent unknown") — drives both the table's group header and the card's inline opponent line. */
  opponentLabel: string;
  /** Left-border tint for the card view (MLB: `teamPrimaryColor(opponentId)`; NFL: its own `teamColors.ts`). Omitted renders a transparent border, same as no opponent. */
  accentColor?: string;
  /** column key → display-ready value; `null`/`undefined` renders as a dash. */
  values: Record<string, number | string | null | undefined>;
}

export interface SummaryStat {
  label: string;
  display: string;
}

export type PlayerDetailChart =
  | {
      kind: 'distribution';
      /** PHASE 2 ADDITION — the chart section's own header text ("N games in scope" / "green cleared over/under N"), pre-composed so `PlayerDetail.tsx` never recomputes the scope-count/line wording itself. */
      title: string;
      subtitle: string;
      /** Already scope-filtered (venue/opponent/lastN applied) — the same `scoped` array the window boxes and gamelog read, so the chart never disagrees with the numbers next to it. */
      data: PickCandidate['history'];
      line: number;
      wantOver: boolean;
      /** Resolves a bar's opponent logo URL. Omitted for MLB (DistributionChart's own numeric-opponentId default handles it); a sport whose `raw` carries an opponent differently supplies its own. */
      logoFor?: (entry: PickCandidate['history'][number]) => string | undefined;
    }
  | {
      kind: 'scorecard';
      title: string;
      subtitle: string;
      data: Array<{ hole: number; par: number | null; value: number | null; strokes: number | null }>;
    };

/** Matches `PropOddsBoard`'s real (inline, unexported) prop type at `components/PropOddsPanel.tsx:98-110` — reproduced here since that component doesn't export a named interface for it. */
export interface PropOddsBoardProps {
  allRows: PropOddsRow[];
  subjectId: string;
  marketKey: string;
  line: number | null;
  userSportsbook: string;
}

/** The "Today's line" context-rail card's data — moneyline/total plus edges, when a game model exists. Sport-agnostic in shape (same `EdgeBadge`/`OddsChip` consumers as Game Detail's picks panel use); `null` for a sport/subject with no game line today, `{}`-ish empty state otherwise. */
export interface TodaysLineData {
  liveScore?: { home: string; away: string };
  livePeriod?: string;
  moneyline?: { away: number; home: number; book: string; source: string } | null;
  moneylineEdge?: MoneylineEdge | null;
  total?: { point: number; overPrice: number; underPrice: number; book: string; source: string } | null;
  totalEdge?: TotalEdge | null;
}

/** MLB-only live-game slot data (`renderLiveGame?` in the design doc) — everything `PlayerDetail.tsx:1487-1674`'s live section needs, already resolved from `useLiveGame`. `null` whenever the game isn't in progress (or hasn't loaded yet); `loading` distinguishes "not live" from "loading the live poll". */
export interface LiveGameSlotData {
  gameIsInProgress: boolean;
  loading: boolean;
  live: import('@/lib/sports/mlb/liveGame').LiveGameDetail | null;
  /** Candidates with a live-trackable value for this game — same filter as `PlayerDetail.tsx:1512-1514`. */
  trackableCandidates: PickCandidate[];
  /**
   * PHASE 2 ADDITION — team identity for the score panel's two team rows
   * (`PlayerDetail.tsx:1510-1533`). `LiveGameDetail` itself (the live-feed
   * poll result) carries no team id/abbreviation, only the slate's own
   * `todaysGame` lookup does — pulled out here so the live section never
   * reads that slate lookup directly.
   */
  awayTeamId?: number;
  homeTeamId?: number;
  awayAbbrev?: string;
  homeAbbrev?: string;
}

/** MLB context-rail "Matchup" card data (`renderContextMatchup?`) — `PlayerDetail.tsx:2047-2112`'s non-golf branch. */
export interface MlbContextMatchupData {
  teamAbbr?: string;
  teamLogoUrl?: string;
  opponentAbbr?: string;
  opponentId?: number;
  opponentTeamHref?: string;
  firstPitch?: string | null;
  opposingStarter?: string | null;
  /** "#N " prefix, empty string when no overall rank is computed yet — same convention as `pitcherRankPrefix`. */
  opposingStarterRankPrefix: string;
  opposingHand?: string | null;
  matchupRank?: number | null;
  matchupStatLabel?: string | null;
  weather?: WeatherContext | null;
}

export interface PlayerDetailData {
  subject: {
    subjectId: string;
    name: string;
    headshotUrl?: string;
    teamAbbr?: string;
    teamLogoUrl?: string;
    position?: string;
    /** Phase 1 addition beyond the design doc's literal §3 interface — MLB's hero header leads with the subject's own Statcast composite rank ("#12 ") when computed (`ownStatcastRankPrefix`, `PlayerDetail.tsx:143-145`). Empty string, never absent, so a consumer doesn't have to special-case undefined vs "no rank yet". */
    rankPrefix: string;
    /** PHASE 2 ADDITION — the hero header's "vs/@ {opponent}" logo (`PlayerDetail.tsx:1241-1246`), pre-resolved same as `teamLogoUrl`/`opponentAbbr` below rather than reconstructed from a sport-specific id. Golf omits both (no opponent concept). */
    opponentAbbr?: string;
    opponentLogoUrl?: string;
    /** PHASE 2 ADDITION — NFL-only secondary rank line under the hero name ("3rd of 32 WR · 8th of 96 offense", `NflPlayerDetail.tsx:301-308`). Already-formatted since the two-rank composition is genuinely NFL-specific; MLB/golf omit it (MLB's single rank lives in `rankPrefix` already). */
    rankDetail?: string;
    /** PHASE 2 ADDITION — hero header's kickoff/first-pitch time + live game state (`PlayerDetail.tsx:1247-1255`), pulled out of the MLB-only `todaysGame` lookup so the header itself needs no sport check. Golf omits both (no scheduled-game concept). */
    gameStartTime?: string | null;
    gameStatus?: string | null;
    /** PHASE 2 ADDITION — the hero card's background gradient tint (`PlayerDetail.tsx:1211-1212`'s `teamPrimaryColor(meta.teamId)`), pre-resolved since MLB keys team color by numeric id and NFL by abbreviation. Omitted (golf) falls back to the header's neutral default. */
    accentColor?: string;
  };
  candidates: PickCandidate[];
  market?: string;
  chips: ChipDef[];
  windows?: WindowedStat5 | null;
  roundScores?: RoundScoreEntry[] | null;
  chart: PlayerDetailChart;
  gamelog?: {
    columns: GamelogColumnDef[];
    rows: GamelogRow[];
    summaryStrip?: SummaryStat[];
    /** PHASE 2 ADDITION — the card view's headline stat badges (`STAT_BADGE_DEFS`, `PlayerDetail.tsx:177-183`), moved here so the shared `GamelogCard` never hardcodes a sport's stat keys. A badge only actually renders when its key is also in `columns` (same "used column" gate as before). */
    cardBadges?: GamelogColumnDef[];
  } | null;
  propOddsBoard: PropOddsBoardProps | null;
  model?: { todaysLine?: TodaysLineData | null } | null;
  /**
   * MLB-only "Quality of Contact" card (`PlayerDetail.tsx:2114-2152`).
   *
   * PHASE 2 CORRECTION: Phase 1 typed this as a bare `OpposingStarterStat[]`
   * (just `meta.ownStatcast`), but the real card also shows a "Season
   * averages" sub-block (`meta.ownBattingStats`) and a composite-rank summary
   * line above the stat rows (`meta.ownStatcastSummary`) — both missed in the
   * original sketch. Widened to carry all three.
   */
  hitterStats?: {
    own: OpposingStarterStat[];
    seasonAverages?: OpposingStarterStat[] | null;
    summaryLine?: string | null;
  } | null;
  /**
   * MLB/NFL "Form" context-rail card.
   *
   * DESIGN DOC CORRECTION (see Phase 1 report): docs/sport-adapter-design.md
   * §3 types this `WindowedStat5 | null`, describing it as "the same shared
   * shape as the main window boxes". That doesn't match what
   * `PlayerDetail.tsx:2163` (the real non-golf Form branch) actually
   * renders, which is `active.supportingSplits` — a `SplitEvidence[]`
   * (`lib/core/types.ts:146-159`), already sport-agnostic and already richer
   * than a bare window set (each split carries its own label/kind alongside
   * the `WindowedStat`). Typed correctly here rather than reproducing the
   * doc's inaccuracy.
   */
  formWindows?: SplitEvidence[] | null;

  // ---- Sport-specific slot data (plain data, not renderers — see the file
  // header's deviation note). All optional; every one is `null`/omitted for
  // a sport that doesn't have the section. ----
  /** Default numeric O/U stepper (MLB/NFL). Golf supplies its own `GolfCategoryPicker` control data instead — see the golf adapter's `lineControl`. */
  lineControl?: { kind: 'stepper'; line: number; baseLine: number; wantOver: boolean } | { kind: 'category'; dimension: string; value: string; categories: string[] };
  /** MLB only. */
  liveGame?: LiveGameSlotData | null;
  /** Golf only — the round-in-progress hole-by-hole scorecard vs. a tee-time groupmate. */
  liveMatchup?: import('@/lib/sports/golf/adapter').LiveRoundMatchup | null;
  /** MLB: one or two `BatterPitcherMatchupCard` prop sets (batter-vs-starter, and/or pitcher-vs-lineup). NFL's `NflPlayerVsDefenseCard` is a genuinely different shape and isn't modeled here. */
  matchups?: BatterPitcherMatchupProps[] | null;
  /** Golf only — season/advanced stats card, passed straight through from the caller's already-fetched `golfStats` prop. */
  seasonStatsCard?: {
    strokesGained: import('@/lib/sports/golf/pgatourStats').GolferStrokesGained | null;
    seasonLog: import('@/lib/sports/golf/playerSeason').PlayerSeasonLog | null;
    advancedStats: import('@/lib/sports/golf/pgatourStats').AdvancedStat[];
    loading: boolean;
  } | null;
  /** MLB's context-rail matchup card. Golf's equivalent (`PastRoundMatchupsCard`) is `golfContextMatchup` in the golf adapter — genuinely different shapes, not unified. */
  mlbContextMatchup?: MlbContextMatchupData | null;
  /** Golf only — every hole this golfer has scored identically in every round played so far (`ConsistentHolesForm`'s own filter, `PlayerDetail.tsx:760-762`), precomputed as a convenience since it's otherwise re-derivable from `candidates` alone. */
  golfFormHoles?: PickCandidate[] | null;
  /** PHASE 2 ADDITION — NFL only. `NflPlayerVsDefenseCard`'s "own stats vs. opponent's ranked defense" card (`NflPlayerDetail.tsx:406-419`) is a genuinely different shape from MLB's `BatterPitcherMatchupProps` (no player-level rank source exists for NFL, only real 32-team defense ranks — see that card's own header comment), so it isn't folded into `matchups` above. */
  nflMatchup?: NflPlayerVsDefenseCardProps | null;
  /** PHASE 2 ADDITION — NFL only. Position-gated season totals, ranked where a real rank exists (`seasonTotalsRows`, `NflPlayerDetail.tsx:104-136`). MLB/golf have no equivalent "raw season totals" card (MLB's own season numbers live in the gamelog summary strip instead). */
  nflSeasonStats?: {
    rows: Array<{ key: string; label: string; value: number; decimals: number; rank?: { rank: number; poolSize: number } }>;
    /** e.g. "WR" — appended as "ranked among {label}s" in the card header when any row carries a rank. */
    rankedAmongLabel?: string;
  } | null;
}

// ---------------------------------------------------------------------------
// MLB-specific: gamelog columns
// ---------------------------------------------------------------------------

/**
 * Kept byte-for-byte in step with the module-private `GAMELOG_COLUMNS` in
 * `components/PlayerDetail.tsx:69-85` — duplicated locally rather than
 * imported because that array isn't exported (same small-duplication
 * convention the file already uses for `golfScoreHeat`/`relDisplay` etc.).
 * Phase 2 should either export the original and drop this copy, or delete
 * the original once `PlayerDetail.tsx` reads gamelog columns from here.
 */
const GAMELOG_COLUMNS: GamelogColumnDef[] = [
  { key: 'plateAppearances', label: 'PA' },
  { key: 'atBats', label: 'AB' },
  { key: 'hits', label: 'H' },
  { key: 'runs', label: 'R' },
  { key: 'rbi', label: 'RBI' },
  { key: 'totalBases', label: 'TB' },
  { key: 'doubles', label: '2B' },
  { key: 'triples', label: '3B' },
  { key: 'homeRuns', label: 'HR' },
  { key: 'baseOnBalls', label: 'BB' },
  { key: 'strikeOuts', label: 'SO' },
  { key: 'stolenBases', label: 'SB' },
  { key: 'hitByPitch', label: 'HBP' },
  { key: 'earnedRuns', label: 'ER' },
  { key: 'inningsPitched', label: 'IP' },
];

/** The 5 headline stats shown as label+value pairs on a gamelog card — a subset of `GAMELOG_COLUMNS`. Ported from `PlayerDetail.tsx:177-183`. */
const STAT_BADGE_DEFS: GamelogColumnDef[] = [
  { key: 'hits', label: 'H' },
  { key: 'runs', label: 'R' },
  { key: 'rbi', label: 'RBI' },
  { key: 'baseOnBalls', label: 'BB' },
  { key: 'strikeOuts', label: 'SO' },
];

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

function usedColumns(history: PickCandidate['history']): GamelogColumnDef[] {
  return GAMELOG_COLUMNS.filter(({ key }) =>
    history.some((entry) => {
      const value = rawOf(entry)[key];
      return value != null && value !== '' && Number(value) !== 0;
    }),
  );
}

function fieldSum(history: PickCandidate['history'], key: string): number {
  return history.reduce((sum, entry) => sum + (Number(rawOf(entry)[key]) || 0), 0);
}

/** Baseball convention drops the leading zero — ".179", never "0.179". Ported from `PlayerDetail.tsx:194-196`. */
function formatAvg(rate: number): string {
  return rate.toFixed(3).replace(/^0\./, '.');
}

function mlbLogoUrl(teamId: number): string {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

/** "#12 " lead-in, empty string until a rank exists — ported from `PlayerDetail.tsx:138-145`. */
function rankPrefix(rank: number | null | undefined): string {
  return rank != null ? `#${rank} ` : '';
}

/** "1st"/"2nd"/"3rd"/"Nth" — a local copy of `PlayerDetail.tsx`'s own exported `ordinal`, duplicated rather than imported to avoid a circular value-import between this adapter and the component that consumes it (same small-duplication convention this file already uses for `usedColumns`/`formatAvg`/etc.). */
function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th');
  return `${rank}${suffix}`;
}

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

/** The interactive scope state `PlayerDetail.tsx` currently owns in `useState` (lines 976-984). Phase 2's component keeps these as its own state and re-calls `toPlayerDetailData` whenever one changes — the adapter itself holds no state. */
export interface MlbPlayerDetailScope {
  lineOffset: number;
  opponentOnly: boolean;
  venue: 'all' | 'home' | 'away';
  lastN: number | 'all';
  showAllGames: boolean;
  kpiScope: 'season' | 'l15';
}

export interface MlbPlayerDetailInput {
  candidates: PickCandidate[];
  /** Falls back to `candidates[0]` when omitted or not found, same as `PlayerDetail.tsx:958`. */
  market?: string;
  snapshot: SportSnapshot | null;
  odds: UnifiedLinesResult | null;
  scope: MlbPlayerDetailScope;
  /** Full box-score history for the active candidate, once fetched — mirrors `fullHistoryCache[subjectId:dimension]` (`PlayerDetail.tsx:991-1007`). The component still owns the fetch/cache; this is just that cache's current entry for the active candidate. */
  fullHistoryOverride?: HistoryEntry[];
  /** `usePropOdds()`'s resolved rows/sportsbook — a hook result, so the component still calls the hook; the adapter only repackages it into `PropOddsBoardProps`. */
  propOdds?: { rows: PropOddsRow[]; userSportsbook: string };
  /** `useTeamStatcast(opponentId)`'s result — only meaningful when the active subject is a pitcher. */
  opponentTeamStatcast?: TeamStatcastState;
  /** `useLiveGame(...)`'s result — only meaningful while the subject's game is in progress. */
  live?: LiveGameState;
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/**
 * Converts MLB's real `PlayerDetail` inputs into `PlayerDetailData`.
 *
 * Returns `null` when there is no active candidate to show (`candidates` is
 * empty) — `PlayerDetail.tsx:1155-1157`'s "No tracked markets for this
 * player" case. Every other field is populated for real; nothing here is
 * fabricated to satisfy the type.
 */
export function toPlayerDetailData(input: MlbPlayerDetailInput): PlayerDetailData | null {
  const { candidates, market, snapshot, odds, scope, fullHistoryOverride, propOdds, opponentTeamStatcast, live } = input;

  const active = candidates.find((c) => c.dimension === market) ?? candidates[0];
  if (!active) return null;

  const meta = (active.subjectMeta ?? {}) as Record<string, unknown>;
  const teamAbbr = typeof meta.team === 'string' ? meta.team : undefined;
  const teamLogoUrl = typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined;
  const headshotUrl = typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined;
  const opponentAbbr = typeof meta.opponent === 'string' ? meta.opponent : undefined;
  const opponentId = typeof meta.opponentId === 'number' ? meta.opponentId : undefined;
  const isHome = meta.isHome === true;
  const isPitcherSubject = typeof meta.pitchHand === 'string';

  const baseLine = active.line ?? 0.5;
  const line = Math.max(0.5, baseLine + scope.lineOffset);
  const wantOver = directionMark(active.category ?? '') !== 'U';

  const activeHistory = fullHistoryOverride ?? active.history;

  const games: SlateGame[] = ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as SlateGame[];
  const statKeys: StatKeyDef[] = ((snapshot?.context?.other as Record<string, unknown> | undefined)?.statKeys ?? []) as StatKeyDef[];
  const slate = buildSlate(games, odds?.lines ?? []);
  const todaysGame = teamAbbr ? slate.byAbbrev.get(teamAbbr.toUpperCase()) : undefined;
  const liveScoreInfo = todaysGame ? liveFor(todaysGame) : {};
  const gameIsInProgress = /in progress/i.test(todaysGame?.game?.state ?? '');

  // ---- Scope filters (PlayerDetail.tsx:1063-1076) ----
  let scoped = activeHistory;
  if (scope.opponentOnly && opponentId != null) {
    scoped = scoped.filter((e) => (rawOf(e).opponentId as number | undefined) === opponentId);
  }
  if (scope.venue !== 'all') {
    scoped = scoped.filter((e) => rawOf(e).isHome === (scope.venue === 'home'));
  }
  if (scope.lastN !== 'all') scoped = scoped.slice(-scope.lastN);

  const measured = categoriseByLine(scoped, line);
  const wanted = wantOver ? OVER : UNDER;

  // ---- Windows (PlayerDetail.tsx:1081-1098) ----
  const windows: WindowedStat5 = {
    l5: fixedWindow(measured, wanted, 5),
    l10: fixedWindow(measured, wanted, 10),
    l15: fixedWindow(measured, wanted, 15),
    szn: openWindow(measured, wanted, { minimum: 1 }),
    h2h:
      opponentId == null
        ? { status: 'insufficient', available: 0, required: 1 }
        : subsetWindow(categoriseByLine(activeHistory, line), wanted, (e) => (rawOf(e).opponentId as number | undefined) === opponentId, { minimum: 1 }),
  };

  // ---- Chips (PlayerDetail.tsx:1425-1446) ----
  const chips: ChipDef[] = [
    { key: 'venue:all', label: 'All venues' },
    { key: 'venue:home', label: 'Home' },
    { key: 'venue:away', label: 'Away' },
    ...(opponentId != null ? [{ key: 'opponent', label: `vs ${opponentAbbr ?? ''}`.trimEnd() }] : []),
    { key: 'lastN:5', label: 'Last 5' },
    { key: 'lastN:10', label: 'Last 10' },
    { key: 'lastN:15', label: 'Last 15' },
    { key: 'lastN:all', label: 'All games' },
  ];

  // ---- Chart (PlayerDetail.tsx:1690-1706) ----
  const chart: PlayerDetailChart = {
    kind: 'distribution',
    title: `${scoped.length} game${scoped.length === 1 ? '' : 's'} in scope`,
    subtitle: `green cleared ${wantOver ? 'over' : 'under'} ${line}`,
    data: scoped,
    line,
    wantOver,
  };

  // ---- Gamelog (MLB-only; PlayerDetail.tsx:1819-1976) ----
  const columns = usedColumns(scoped);
  const gamelogSource = [...scoped].reverse().slice(0, scope.showAllGames ? undefined : 15);
  const rows: GamelogRow[] = gamelogSource.map((entry, index) => {
    const raw = rawOf(entry);
    const values: Record<string, number | string | null | undefined> = {};
    for (const col of columns) {
      const v = raw[col.key];
      values[col.key] = v == null || v === '' ? null : (v as number | string);
    }
    const rowOpponentId = raw.opponentId as number | undefined;
    const rowIsHome = raw.isHome === true;
    return {
      key: `${entry.period}-${index}`,
      periodLabel: entry.periodLabel ?? `Game #${entry.period}`,
      opponentLogoUrl: rowOpponentId != null ? mlbLogoUrl(rowOpponentId) : undefined,
      opponentLabel: rowOpponentId != null ? `${rowIsHome ? 'vs' : '@'} ${teamNameFor(rowOpponentId)}` : 'Opponent unknown',
      accentColor: rowOpponentId != null ? teamPrimaryColor(rowOpponentId) : undefined,
      values,
    };
  });
  const kpiSource = scope.kpiScope === 'l15' ? scoped.slice(-15) : scoped;
  const summaryStrip: SummaryStat[] = isPitcherSubject
    ? [
        { label: 'Strikeouts', display: String(fieldSum(kpiSource, 'strikeOuts')) },
        { label: 'Walks', display: String(fieldSum(kpiSource, 'baseOnBalls')) },
        { label: 'Hits allowed', display: String(fieldSum(kpiSource, 'hits')) },
        { label: 'Earned runs', display: String(fieldSum(kpiSource, 'earnedRuns')) },
      ]
    : [
        {
          label: 'Batting avg',
          display: formatAvg(fieldSum(kpiSource, 'atBats') > 0 ? fieldSum(kpiSource, 'hits') / fieldSum(kpiSource, 'atBats') : 0),
        },
        { label: 'Strikeouts', display: String(fieldSum(kpiSource, 'strikeOuts')) },
        { label: 'Walks', display: String(fieldSum(kpiSource, 'baseOnBalls')) },
        { label: 'Stolen bases', display: String(fieldSum(kpiSource, 'stolenBases')) },
      ];

  // ---- Prop odds board (PlayerDetail.tsx:1784-1817; universal, no branch) ----
  const activeMarketKey = candidateDimensionToMarketKey(active.dimension);
  const propOddsBoard: PropOddsBoardProps | null =
    activeMarketKey && propOdds
      ? { allRows: propOdds.rows, subjectId: active.subjectId, marketKey: activeMarketKey, line: active.line ?? null, userSportsbook: propOdds.userSportsbook }
      : null;

  // ---- Today's line model (PlayerDetail.tsx:1196-1203, 1998-2043) ----
  const projected = todaysGame?.line ? projectLine(todaysGame.line) : null;
  const gameModel = todaysGame?.game?.gameModel ?? null;
  const moneylineEdge = computeMoneylineEdge(gameModel, projected?.moneyline);
  const totalEdge = computeTotalEdge(gameModel, projected?.total);
  const todaysLine: TodaysLineData | null = projected?.available
    ? {
        liveScore: liveScoreInfo.liveScore,
        livePeriod: liveScoreInfo.livePeriod,
        moneyline:
          projected.moneyline?.away != null && projected.moneyline?.home != null && projected.moneyline?.book != null
            ? { away: projected.moneyline.away, home: projected.moneyline.home, book: projected.moneyline.book, source: projected.source }
            : null,
        moneylineEdge,
        total:
          projected.total?.point != null && projected.total?.overPrice != null && projected.total?.underPrice != null && projected.total?.book != null
            ? { point: projected.total.point, overPrice: projected.total.overPrice, underPrice: projected.total.underPrice, book: projected.total.book, source: projected.source }
            : null,
        totalEdge,
      }
    : null;

  // ---- Hitter stats — Quality of Contact, MLB-only (PlayerDetail.tsx:2114-2152) ----
  const ownStatcastSummaryFull = meta.ownStatcastSummary as
    | { overallRank: number | null; poolSize: number; position: string; positionRank: number | null; positionPoolSize: number }
    | undefined;
  const hitterStats: PlayerDetailData['hitterStats'] =
    Array.isArray(meta.ownStatcast) && meta.ownStatcast.length > 0
      ? {
          own: meta.ownStatcast as OpposingStarterStat[],
          seasonAverages: Array.isArray(meta.ownBattingStats) && meta.ownBattingStats.length > 0 ? (meta.ownBattingStats as OpposingStarterStat[]) : null,
          summaryLine: ownStatcastSummaryFull
            ? [
                ownStatcastSummaryFull.overallRank != null ? `${ordinal(ownStatcastSummaryFull.overallRank)} of ${ownStatcastSummaryFull.poolSize} overall` : null,
                ownStatcastSummaryFull.positionRank != null
                  ? `${ordinal(ownStatcastSummaryFull.positionRank)} of ${ownStatcastSummaryFull.positionPoolSize} at ${ownStatcastSummaryFull.position}`
                  : null,
              ]
                .filter((s): s is string => s != null)
                .join(' · ') || null
            : null,
        }
      : null;

  // ---- Form (context rail; corrected per the type doc comment above) ----
  const formWindows: SplitEvidence[] | null = active.supportingSplits ?? null;

  // ---- Live game slot, MLB-only (PlayerDetail.tsx:1487-1674) ----
  const liveGame: LiveGameSlotData | null =
    gameIsInProgress || live
      ? {
          gameIsInProgress,
          loading: live?.loading ?? false,
          live: live?.data ?? null,
          trackableCandidates: candidates.filter((c) => live?.data?.liveValues?.[c.dimension] != null && directionMark(c.category) !== null),
          awayTeamId: todaysGame?.game?.awayTeamId,
          homeTeamId: todaysGame?.game?.homeTeamId,
          awayAbbrev: todaysGame?.awayAbbrev,
          homeAbbrev: todaysGame?.homeAbbrev,
        }
      : null;

  // ---- Matchup cards (PlayerDetail.tsx:1722-1779) ----
  const matchups: BatterPitcherMatchupProps[] = [];
  if (!isPitcherSubject && Array.isArray(meta.ownStatcast) && meta.ownStatcast.length > 0 && typeof meta.opposingStarter === 'string') {
    matchups.push({
      subjectName: active.subjectName,
      subjectHeadshotUrl: headshotUrl,
      subjectTeamAbbr: teamAbbr,
      subjectTeamLogoUrl: teamLogoUrl,
      subjectStats: [...(meta.ownStatcast as OpposingStarterStat[]), ...((meta.ownBattingStats as OpposingStarterStat[] | undefined) ?? [])],
      opponentName: meta.opposingStarter,
      opponentId: typeof meta.opposingStarterId === 'number' ? meta.opposingStarterId : undefined,
      opponentHand: typeof meta.opposingHand === 'string' ? meta.opposingHand : undefined,
      opponentRoleLabel: 'Allows',
      opponentTeamAbbr: opponentAbbr,
      opponentTeamLogoUrl: opponentId != null ? mlbLogoUrl(opponentId) : undefined,
      opponentStats: (meta.opposingStarterStats as OpposingStarterStat[] | undefined) ?? [],
    });
  }
  if (isPitcherSubject && Array.isArray(meta.ownPitcherStats) && meta.ownPitcherStats.length > 0 && opponentTeamStatcast && opponentTeamStatcast.hitting.length > 0) {
    const opponentGameSide = isHome ? (todaysGame?.game as GameDetailGame | undefined)?.away : (todaysGame?.game as GameDetailGame | undefined)?.home;
    matchups.push({
      title: 'Pitcher vs. lineup',
      subjectName: active.subjectName,
      subjectHeadshotUrl: headshotUrl,
      subjectTeamAbbr: teamAbbr,
      subjectTeamLogoUrl: teamLogoUrl,
      subjectStats: meta.ownPitcherStats as OpposingStarterStat[],
      subjectRoleLabel: 'Allows',
      opponentName: opponentAbbr ? `${opponentAbbr} lineup` : 'Opposing lineup',
      opponentHeadshotUrl: opponentId != null ? mlbLogoUrl(opponentId) : undefined,
      opponentTeamAbbr: opponentAbbr,
      opponentTeamLogoUrl: opponentId != null ? mlbLogoUrl(opponentId) : undefined,
      opponentStats: [...opponentTeamStatcast.hitting, ...teamSeasonStatRows(opponentGameSide, statKeys)],
      opponentRoleLabel: 'Produces',
    });
  }

  // ---- Context-rail matchup card (PlayerDetail.tsx:2047-2112) ----
  const mlbContextMatchup: MlbContextMatchupData = {
    teamAbbr,
    teamLogoUrl,
    opponentAbbr,
    opponentId,
    opponentTeamHref: opponentId != null ? `/mlb/team/${opponentId}` : undefined,
    firstPitch: todaysGame?.game?.firstPitch ?? null,
    opposingStarter: typeof meta.opposingStarter === 'string' ? meta.opposingStarter : null,
    opposingStarterRankPrefix: rankPrefix((meta.opposingStarterOverallRank as { rank: number | null } | undefined)?.rank),
    opposingHand: typeof meta.opposingHand === 'string' ? meta.opposingHand : null,
    matchupRank: typeof meta.matchupRank === 'number' ? meta.matchupRank : null,
    matchupStatLabel: typeof meta.matchupStatLabel === 'string' ? meta.matchupStatLabel : null,
    weather: active.context?.weather ?? null,
  };

  // ---- Hero rank prefix (PlayerDetail.tsx:143-145, 1259-1264) ----
  const ownStatcastSummary = ownStatcastSummaryFull;

  return {
    subject: {
      subjectId: active.subjectId,
      name: active.subjectName,
      headshotUrl,
      teamAbbr,
      teamLogoUrl,
      position: typeof meta.position === 'string' ? meta.position : undefined,
      rankPrefix: rankPrefix(ownStatcastSummary?.overallRank),
      opponentAbbr,
      opponentLogoUrl: opponentId != null ? mlbLogoUrl(opponentId) : undefined,
      gameStartTime: todaysGame?.game?.firstPitch ?? null,
      gameStatus: todaysGame?.game?.state ?? null,
      accentColor: typeof meta.teamId === 'number' ? teamPrimaryColor(meta.teamId) : undefined,
    },
    candidates,
    market: active.dimension,
    chips,
    windows,
    roundScores: null,
    chart,
    gamelog: { columns, rows, summaryStrip, cardBadges: STAT_BADGE_DEFS },
    propOddsBoard,
    model: { todaysLine },
    hitterStats,
    formWindows,
    lineControl: { kind: 'stepper', line, baseLine, wantOver },
    liveGame,
    liveMatchup: null,
    matchups: matchups.length > 0 ? matchups : null,
    seasonStatsCard: null,
    mlbContextMatchup,
    golfFormHoles: null,
    nflMatchup: null,
    nflSeasonStats: null,
  };
}

// Only isOk is needed elsewhere via this module's re-export surface today;
// kept imported (not re-exported) so callers of formWindows can branch the
// way `PlayerDetail.tsx`'s own JSX already does (`isOk(split.stat)`).
export { isOk };
