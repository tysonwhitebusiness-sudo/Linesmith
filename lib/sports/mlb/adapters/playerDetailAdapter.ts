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

import type { HistoryEntry, PickCandidate, SplitEvidence, Sport, SportSnapshot, WeatherContext } from '@/lib/core/types';
import { buildAnalyticsRoles } from '@/lib/sports/shared/analyticsRoles';
import { toCareerH2H } from '@/lib/sports/shared/careerH2H';
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
import { directionMark, marketText } from '@/components/MarketLabel';
import {
  toRoleStat,
  type ConditionsRole,
  type OpponentUnitRole,
  type RoleStat,
} from '@/lib/sports/shared/playerRoles';
import { toOpposingStarterFromProfile, toPlatoonBinarySplit, toSpatialGridRole, toUsageMixRole } from './pitchRoles';
import { toConditionsRole } from '@/lib/sports/shared/conditionsRole';
import type { PitchProfile } from '@/lib/sports/mlb/pitchProfileShapes';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import type { GameDetailGame, StatKeyDef } from '@/components/GameDetail';
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

/**
 * Universal matchup card data — one canonical shape for every sport, per
 * `docs/matchup-card-rebuild-gameplan-2026-08-23.md` §5/§10. Replaces the
 * old `matchups` (MLB) / `mlbContextMatchup` (MLB) / `nflMatchup`
 * (NFL, soccer) trio outright — same "MLB owns the canonical type" rule as
 * every other shared interface in this file, just applied to a rebuild
 * instead of a first pass.
 *
 * Design notes (see the gameplan for the full reasoning):
 * - `positionGroups: null` means the sport has no meaningful position-group
 *   split (yet) — the component renders a single implicit group instead of
 *   a tab strip. Every stats map is still keyed by group key even then,
 *   using the literal key `'_default'`.
 * - `subjectStatsByGroup` is opponent-independent (a player's own season
 *   production doesn't change when you pick a different opponent to
 *   compare against) — hoisted out of the per-opponent map so picking a
 *   different opponent is a pure client-side re-index, not new data.
 * - A stat key present in BOTH the subject's and the opponent's row list
 *   for a group renders as a two-sided bar (the same "quality of contact"
 *   framing `BatterPitcherMatchupCard` used); a key present on only one
 *   side renders solo. No caller-declared list of "which keys are shared"
 *   needed — whichever keys actually collide, collide.
 * - `opponentOptions: null` means no custom-opponent picker yet for this
 *   sport (today's real next-game opponent is the only one available) —
 *   `opponentMeta`/`opponentStatsByGroup` still only need the default
 *   opponent's entry in that case.
 */
export interface MatchupStatRow {
  key: string;
  label: string;
  value: number;
  decimals: number;
  rank: number | null;
  poolSize: number | null;
}

export interface MatchupPositionGroup {
  key: string;
  label: string;
}

export interface MatchupOpponentOption {
  id: string;
  abbr: string;
  name: string;
  logoUrl?: string | null;
}

export interface MatchupExplorerData {
  subjectName: string;
  subjectHeadshotUrl?: string | null;
  subjectFallbackUrl?: string | null;
  subjectTeamAbbr?: string | null;
  subjectTeamLogoUrl?: string | null;
  /** Defaults to 'Produces'/'Allows' at render time when omitted. */
  subjectRoleLabel?: string;
  opponentRoleLabel?: string;
  positionGroups: MatchupPositionGroup[] | null;
  subjectStatsByGroup: Record<string, MatchupStatRow[]>;
  defaultOpponentId: string;
  opponentOptions: MatchupOpponentOption[] | null;
  opponentMeta: Record<string, MatchupOpponentOption & { hand?: string | null }>;
  opponentStatsByGroup: Record<string, Record<string, MatchupStatRow[]>>;
  /** Extra context line under the identity header — MLB's first-pitch time/weather, etc. Plain text, sport-specific content already formatted by the adapter. */
  contextLine?: string | null;
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
  /**
   * Universal matchup card (see `MatchupExplorerData`'s own header comment)
   * — every sport populates this now, `null` only for a sport this hasn't
   * been wired up for yet. Replaces the old `matchups`/`mlbContextMatchup`/
   * `nflMatchup` trio outright, per
   * `docs/matchup-card-rebuild-gameplan-2026-08-23.md` §10's "replace
   * outright" decision — golf keeps its own genuinely different
   * `liveMatchup`/`golfContextMatchup` untouched (§3 of that doc).
   */
  matchupExplorer?: MatchupExplorerData | null;
  /**
   * Live line tracker (docs/live-matchup-and-line-tracker-gameplan-
   * 2026-08-23.md, Part 2) — what this subject can be tracked on today, not
   * the user's saved tracked lines themselves (those are per-user mutable
   * state, fetched client-side through `/api/tracked-lines` by
   * `LiveLineTrackerCard`, same "user-owned state stays out of the cached
   * adapter payload" reasoning as watchlist). `gameId` is this sport's own
   * live-game id (feeds `/api/{sport}/game/{gameId}/live`, the same Part 1
   * routes the hero card's Live tab already uses) — null if the subject has
   * no game today. `availableStats` is empty for a sport with no
   * player-level live data source (soccer, tennis) rather than omitted, so
   * the card can render an honest "nothing trackable yet" state instead of
   * hiding entirely. `null` only for golf (no live-game concept at all).
   */
  liveLineTracker?: {
    subjectId: string;
    sport: Sport;
    gameId: string | null;
    availableStats: Array<{ key: string; label: string }>;
  } | null;
  /** Golf only — season/advanced stats card, passed straight through from the caller's already-fetched `golfStats` prop. */
  seasonStatsCard?: {
    strokesGained: import('@/lib/sports/golf/pgatourStats').GolferStrokesGained | null;
    seasonLog: import('@/lib/sports/golf/playerSeason').PlayerSeasonLog | null;
    advancedStats: import('@/lib/sports/golf/pgatourStats').AdvancedStat[];
    loading: boolean;
  } | null;
  /** Golf only — every hole this golfer has scored identically in every round played so far (`ConsistentHolesForm`'s own filter, `PlayerDetail.tsx:760-762`), precomputed as a convenience since it's otherwise re-derivable from `candidates` alone. */
  golfFormHoles?: PickCandidate[] | null;
  /** PHASE 2 ADDITION — NFL only. Position-gated season totals, ranked where a real rank exists (`seasonTotalsRows`, `NflPlayerDetail.tsx:104-136`). MLB/golf have no equivalent "raw season totals" card (MLB's own season numbers live in the gamelog summary strip instead). */
  nflSeasonStats?: {
    rows: Array<{ key: string; label: string; value: number; decimals: number; rank?: { rank: number; poolSize: number } }>;
    /** e.g. "WR" — appended as "ranked among {label}s" in the card header when any row carries a rank. */
    rankedAmongLabel?: string;
  } | null;

  /**
   * PHASE 6.3 — the six universal roles.
   *
   * `opponentUnit`, `usageMix`, `spatialGrid`, `binarySplit`, `conditions` and
   * `careerH2H`. See `lib/sports/shared/playerRoles.ts` for the full argument;
   * the short version is that pitch mix, strike zone and platoon splits are not
   * MLB *concepts*, they are MLB's instance of roles every sport fills with its
   * own content — so one spine, filled eight ways, rather than seven sports
   * looking at fields named after the eighth.
   *
   * Every role is independently nullable and every one carries its own title,
   * labels, units and formatting from the sport's adapter. The component
   * renders a heading and a shape; it never learns what a strike zone is.
   *
   * Spread rather than nested so a role reads as `data.binarySplit`, matching
   * every other slot on this interface.
   */
  /**
   * PHASE 6.16 -- the four analytics cards.
   *
   * `rollingForm`, `situationalSplits`, `whereThisSits` and `gameContext`.
   * Every one is a function of this candidate's own history and line, so all
   * four are built by ONE shared call (`buildAnalyticsRoles`) that every
   * sport's adapter makes -- see `lib/sports/shared/analyticsRoles.ts` for why
   * they are not per-sport.
   *
   * They exist because the board-vs-build audit found Player Detail rendering
   * 13 of the design board's 20 cards, and these four needed no new sourcing
   * at all: the primitives were already written and had never been rendered.
   */
  rollingForm?: import('@/lib/sports/shared/analyticsRoles').RollingFormRole | null;
  situationalSplits?: import('@/lib/sports/shared/analyticsRoles').SituationalSplitsRole | null;
  whereThisSits?: import('@/lib/sports/shared/analyticsRoles').WhereThisSitsRole | null;
  gameContext?: import('@/lib/sports/shared/analyticsRoles').GameContextRole | null;

  opponentUnit?: import('@/lib/sports/shared/playerRoles').OpponentUnitRole | null;
  usageMix?: import('@/lib/sports/shared/playerRoles').UsageMixRole | null;
  spatialGrid?: import('@/lib/sports/shared/playerRoles').SpatialGridRole | null;
  binarySplit?: import('@/lib/sports/shared/playerRoles').BinarySplitRole | null;
  conditions?: import('@/lib/sports/shared/playerRoles').ConditionsRole | null;
  careerH2H?: import('@/lib/sports/shared/playerRoles').CareerH2HRole | null;
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
  /**
   * `useMlbPitchProfile(...)`'s result — the pitch-level Statcast rollup that
   * fills `usageMix` and `spatialGrid`. Structural, not an import of the hook's
   * own type, so this file stays a pure transform with no dependency on a
   * component.
   *
   * Absent or `{ profile: null }` leaves both roles `null` and renders nothing,
   * which is the correct state for a subject with no pitches on record — the
   * table starts at 2024 by operator decision, so anything earlier genuinely
   * has none.
   */
  pitchProfile?: { profile: PitchProfile | null; loading: boolean };
  /**
   * Tonight's opposing STARTER's own pitch profile — `useMlbPitchProfile('pitcher', ...)`
   * a second time, for a different subject.
   *
   * Fills `usageMix.compare`, so the batter's pitch-mix card can answer the
   * question it could not before: this pitcher throws the slider 31% of the
   * time and allows .284 on it, and you see sliders 24% of the time and hit
   * .198 against them. `null` for a pitcher subject, for a game with no
   * probable starter announced, and for every other sport.
   */
  opposingPitchProfile?: { profile: PitchProfile | null; loading: boolean };
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
  const { candidates, market, snapshot, odds, scope, fullHistoryOverride, propOdds, opponentTeamStatcast, live, pitchProfile, opposingPitchProfile } = input;

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
  // ---- Role 6 | careerH2H (6.13). NOT a second copy of the h2h window
  // box: what this adds is the per-MEETING history. "3 of 5" and "3 of 5,
  // all three in 2019" are different facts and the window box cannot tell
  // them apart. Same opponent predicate `windows.h2h` already uses.
  const careerH2H = opponentId != null
    ? toCareerH2H({
        measured: categoriseByLine(activeHistory, line),
        wanted,
        isVsOpponent: (e) => (rawOf(e).opponentId as number | undefined) === opponentId,
        opponentLabel: `vs ${opponentAbbr ?? 'opponent'}`,
        statLabel: marketText('mlb', active.dimension),
      })
    : null;

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

  // ---- Universal matchup card (replaces PlayerDetail.tsx:1722-1779's
  // BatterPitcherMatchupCard mapping + :2047-2112's context-rail card —
  // see MatchupExplorerData's header comment / the rebuild gameplan) ----
  const toMatchupStatRow = (s: OpposingStarterStat): MatchupStatRow => ({
    key: s.key,
    label: s.label,
    value: s.value,
    decimals: s.decimals,
    rank: s.rank ?? null,
    poolSize: s.poolSize ?? null,
  });

  let matchupExplorer: MatchupExplorerData | null = null;
  if (!isPitcherSubject && Array.isArray(meta.ownStatcast) && meta.ownStatcast.length > 0 && typeof meta.opposingStarter === 'string') {
    const opponentId2 = 'today';
    const weather = active.context?.weather ?? null;
    const contextParts = [
      todaysGame?.game?.firstPitch ? `First pitch ${todaysGame.game.firstPitch}` : null,
      typeof meta.opposingHand === 'string' ? `${meta.opposingHand}HP` : null,
      weather ? `${weather.tempF != null ? `${weather.tempF}°F · ` : ''}Wind ${weather.windMph} mph ${weather.windDir}`.trim() : null,
    ].filter((s): s is string => !!s && s.trim().length > 0);
    matchupExplorer = {
      subjectName: active.subjectName,
      subjectHeadshotUrl: headshotUrl,
      subjectTeamAbbr: teamAbbr,
      subjectTeamLogoUrl: teamLogoUrl,
      subjectRoleLabel: 'Produces',
      opponentRoleLabel: 'Allows',
      positionGroups: null,
      subjectStatsByGroup: {
        _default: [...(meta.ownStatcast as OpposingStarterStat[]), ...((meta.ownBattingStats as OpposingStarterStat[] | undefined) ?? [])].map(toMatchupStatRow),
      },
      defaultOpponentId: opponentId2,
      opponentOptions: null,
      opponentMeta: {
        [opponentId2]: {
          id: opponentId2,
          abbr: opponentAbbr ?? '',
          name: meta.opposingStarter,
          logoUrl: opponentId != null ? mlbLogoUrl(opponentId) : undefined,
          hand: typeof meta.opposingHand === 'string' ? meta.opposingHand : null,
        },
      },
      opponentStatsByGroup: {
        [opponentId2]: { _default: ((meta.opposingStarterStats as OpposingStarterStat[] | undefined) ?? []).map(toMatchupStatRow) },
      },
      contextLine: contextParts.length > 0 ? contextParts.join(' · ') : null,
    };
  } else if (isPitcherSubject && Array.isArray(meta.ownPitcherStats) && meta.ownPitcherStats.length > 0 && opponentTeamStatcast && opponentTeamStatcast.hitting.length > 0) {
    const opponentGameSide = isHome ? (todaysGame?.game as GameDetailGame | undefined)?.away : (todaysGame?.game as GameDetailGame | undefined)?.home;
    const opponentId2 = 'today';
    matchupExplorer = {
      subjectName: active.subjectName,
      subjectHeadshotUrl: headshotUrl,
      subjectTeamAbbr: teamAbbr,
      subjectTeamLogoUrl: teamLogoUrl,
      subjectRoleLabel: 'Allows',
      opponentRoleLabel: 'Produces',
      positionGroups: null,
      subjectStatsByGroup: { _default: (meta.ownPitcherStats as OpposingStarterStat[]).map(toMatchupStatRow) },
      defaultOpponentId: opponentId2,
      opponentOptions: null,
      opponentMeta: {
        [opponentId2]: {
          id: opponentId2,
          abbr: opponentAbbr ?? '',
          name: opponentAbbr ? `${opponentAbbr} lineup` : 'Opposing lineup',
          logoUrl: opponentId != null ? mlbLogoUrl(opponentId) : undefined,
        },
      },
      opponentStatsByGroup: {
        [opponentId2]: { _default: [...opponentTeamStatcast.hitting, ...teamSeasonStatRows(opponentGameSide, statKeys)].map(toMatchupStatRow) },
      },
      contextLine: todaysGame?.game?.firstPitch ? `First pitch ${todaysGame.game.firstPitch}` : null,
    };
  }

  // ---- Hero rank prefix (PlayerDetail.tsx:143-145, 1259-1264) ----
  const ownStatcastSummary = ownStatcastSummaryFull;

  // ---- Phase 6.3: the six universal roles, MLB's instances ----
  // Two are filled from data this adapter already has; the other four need
  // sourcing that does not exist yet and are left null, which renders nothing.
  // That is the rule working, not a gap being hidden:
  //   - `usageMix` (pitch mix) and `spatialGrid` (strike zone) both need
  //     PITCH-LEVEL Statcast. `savant.ts` calls the pitch-level endpoint but
  //     passes `group_by: 'name'`, collapsing it to one season row per player.
  //     Task 6.6 ungroups it into its own table; these fill from that.
  //   - `binarySplit` (vs LHP/RHP) needs a platoon split we do not store.
  //   - `careerH2H` (vs this pitcher) needs batter-vs-pitcher history, same.
  const opposingStarterStats = (meta.opposingStarterStats as OpposingStarterStat[] | undefined) ?? [];

  // FALL BACK TO PITCH EVENTS WHEN THE RANKED ROLLUP HAS NOTHING.
  //
  // `starterStatCard` returns undefined below three starts or without a
  // computed rank -- a sound floor for a PERCENTILE. But the page then said
  // "No Statcast profile for this starter yet" two cards above the pitch-mix
  // card, which was showing 498 real pitches from that same starter broken
  // down by type. Both sentences were true of their own source; the pair was
  // nonsense to read.
  //
  // No extra fetch: this is the profile already loaded for the mix. It carries
  // no rank because there genuinely is not one, and `OpponentUnitSection`
  // hides the rank column when nothing in the table is ranked.
  const derivedStarterStats =
    opposingStarterStats.length === 0
      ? toOpposingStarterFromProfile(
          opposingPitchProfile?.profile ?? null,
          typeof meta.batSide === 'string' ? meta.batSide : null,
        )
      : [];
  const starterStats: RoleStat[] =
    opposingStarterStats.length > 0 ? opposingStarterStats.map((st) => toRoleStat(st)) : derivedStarterStats;

  const opponentUnit: OpponentUnitRole | null =
    typeof meta.opposingStarter === 'string' && meta.opposingStarter.length > 0
      ? {
          title: 'Opposing starter',
          name: meta.opposingStarter,
          subtitle: typeof meta.opposingHand === 'string' ? `${meta.opposingHand}HP · allows` : 'Allows',
          logoUrl: opponentId != null ? mlbLogoUrl(opponentId) : undefined,
          stats: starterStats,
          // Says WHY it is empty, and the two reasons are different: no
          // profile at all, versus a starter with too few pitches to say
          // anything. Only reachable now when the pitch table is empty too.
          emptyMessage: 'No pitch-level Statcast for this starter yet.',
        }
      : null;

  // Weather and first pitch are real and already resolved. `impact` stays
  // absent: MLB's `park_factors` are computed per venue, not per game, and
  // attaching an unverified multiplier to a specific matchup would be exactly
  // the fabrication the role's own doc comment forbids.
  //
  // The facts themselves are built by the SHARED `toConditionsRole` (6.10) —
  // this block used to compose them inline, and NFL and CFB were about to grow
  // a copy each. First pitch is the one genuinely MLB-specific part, so it goes
  // in as an extra fact rather than as a branch inside the builder.
  const conditions: ConditionsRole | null = toConditionsRole({
    weather: active.context?.weather ?? null,
    extraFacts: todaysGame?.game?.firstPitch
      ? [{ key: 'firstPitch', label: 'First pitch', value: String(todaysGame.game.firstPitch) }]
      : [],
  });

  // ---- 6.6's two roles, now that `mlb_pitch_events` supplies them ----
  // Both builders are pure and live in `pitchRoles.ts` so the two measured
  // data traps they encode (see that file's header) can be tested directly
  // rather than only grepped for.
  const profile = pitchProfile?.profile ?? null;
  // The opposing starter's own mix, for the comparison columns. Only for a
  // BATTER subject: a pitcher's card comparing his mix to the opposing
  // pitcher's would be comparing two people who never face each other.
  const opposingStarterName = typeof meta.opposingStarter === 'string' ? meta.opposingStarter : null;
  const usageMix = toUsageMixRole(
    profile,
    !isPitcherSubject && opposingStarterName && opposingPitchProfile?.profile
      ? { profile: opposingPitchProfile.profile, name: opposingStarterName }
      : null,
    active.subjectName,
  );
  const spatialGrid = toSpatialGridRole(profile);


  // ---- Phase 6.16: the four analytics cards ----
  //
  // ONE CALL FOR ALL FOUR, identical in every sport's adapter, because every
  // one is a function of this candidate's own history and line. See
  // `analyticsRoles.ts` for why they are shared rather than per-sport.
  //
  // `peers` COMES FROM `snapshot.candidates`, NOT the `candidates` argument.
  // The argument is already scoped to this subject, so using it would compare
  // the player against himself and the pool would be one. That exact mistake
  // was made once on tennis's `opponentUnit` and caught only by opening the
  // page -- same shape, same fix.
  const analyticsRoles = buildAnalyticsRoles({
    history: active.history,
    line: active.line,
    wantOver: directionMark(active.category) !== 'U',
    statLabel: active.dimensionLabel ?? active.dimension,
    peers: (snapshot?.candidates ?? [])
      .filter((c) => c.dimension === active.dimension && c.subjectId !== active.subjectId)
      .map((c) => ({ history: c.history })),
  });

  return {
    ...analyticsRoles,
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
    matchupExplorer,
    seasonStatsCard: null,
    golfFormHoles: null,
    nflSeasonStats: null,
    opponentUnit,
    conditions,
    usageMix,
    spatialGrid,
    // Role 4 | binarySplit -- the PLATOON split, vs LHP/RHP.
    //
    // This was `null` with the comment "MLB's binarySplit is vs LHP/RHP and
    // this app stores no platoon split". True when written; 6.6 made it stale.
    // `mlb_pitch_events` carries `p_throws` and `stand` on every one of its
    // 2,140,525 rows. Left as a worked example of why a null justified in prose
    // needs re-reading whenever its sourcing task lands.
    binarySplit: toPlatoonBinarySplit(profile),
    careerH2H,
    liveLineTracker: {
      subjectId: active.subjectId,
      sport: 'mlb',
      gameId: todaysGame?.game?.gamePk != null ? String(todaysGame.game.gamePk) : null,
      availableStats: MLB_TRACKABLE_STATS,
    },
  };
}

/**
 * Curated, not exhaustive — batting stats only (this app's MLB player pages
 * are batter-focused, per `hitterStats`'s own "Quality of Contact" framing
 * above); a pitcher subject simply won't see a live value light up for
 * these yet. Keys are deliberately the exact same market `dimension`
 * strings `STAT_MARKET_BY_DIMENSION` (`lib/sports/mlb/adapter.ts`) already
 * uses for grading/live-value lookups — not a new vocabulary — so the
 * tracker's live-value hook can call `liveMarketValues()` directly with no
 * translation layer.
 */
const MLB_TRACKABLE_STATS: Array<{ key: string; label: string }> = [
  { key: 'hit-in-game', label: 'Hits' },
  { key: 'home-runs', label: 'Home Runs' },
  { key: 'rbis', label: 'RBI' },
  { key: 'total-bases', label: 'Total Bases' },
  { key: 'walks', label: 'Walks' },
  { key: 'batter-strikeouts', label: 'Strikeouts' },
  { key: 'doubles', label: 'Doubles' },
  { key: 'stolen-bases', label: 'Stolen Bases' },
];

// Only isOk is needed elsewhere via this module's re-export surface today;
// kept imported (not re-exported) so callers of formWindows can branch the
// way `PlayerDetail.tsx`'s own JSX already does (`isOk(split.stat)`).
export { isOk };
