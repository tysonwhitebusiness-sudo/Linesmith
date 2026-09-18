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

import { liveLineHit } from '@/lib/sports/shared/liveLine';
import type { PlayerBio, PlayerHistory, PlayerResearchData } from '@/lib/sports/shared/playerResearchShapes';
import { buildPlayerResearch } from '@/lib/sports/shared/playerResearch';
import { mlbResearchSpec } from './playerResearchSpec';
import { mlbHitterSection, mlbPitcherSection, type MlbStatcastInput } from './playerResearchSections';
import type { PickCandidate, SplitEvidence, Sport, SportSnapshot, WeatherContext } from '@/lib/core/types';
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
import { mlbHeadshotUrl } from '@/components/SubjectAvatar';
import {
  toRoleStat,
  type ConditionsRole,
  type OpponentUnitRole,
  type RoleStat,
} from '@/lib/sports/shared/playerRoles';
import { toOpposingStarterFromProfile, toUsageMixRole } from './pitchRoles';
import { toConditionsRole } from '@/lib/sports/shared/conditionsRole';
import type { PitchProfile } from '@/lib/sports/mlb/pitchProfileShapes';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import type { MlbSlateGame, StatKeyDef } from '@/lib/sports/mlb/slateGameShapes';
import type { TeamStatcastState } from '@/components/useTeamStatcast';
import type { LiveGameState } from '@/components/useLiveGame';
import type { UnifiedLinesResult } from '@/lib/odds/types';
import { buildSlate, liveFor, type SlateGame } from '@/lib/odds/matching';
import { projectLine } from '@/lib/odds/display';
import { computeMoneylineEdge, computeTotalEdge, type MoneylineEdge, type TotalEdge } from '@/lib/odds/gameEdge';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import { isPickemBook, repriceAtMainLine } from '@/lib/odds/props/mainLine';
import type { PropOddsRow } from '@/lib/db/client';
import { teamSeasonStatRows } from './statRowAdapter';
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

/**
 * C4 — the game in progress, as one sport-neutral slot (R6.1d).
 *
 * Every sport fills the same score, period and "your lines so far"; a sport's
 * own situation is a named, presence-checked field beside them (`baseball`:
 * count, outs, bases, who is up and who is pitching), the rule-4 shape. MLB
 * fills it in R6.1d; each other sport fills its own in its sub-phase (soccer
 * and tennis get score and state only). `null` when no game is in progress.
 */
export interface GameStateSlot {
  /** `loading` while the first live poll for a started game runs. */
  status: 'live' | 'loading';
  away: { abbr: string; logoUrl?: string; score: number | null };
  home: { abbr: string; logoUrl?: string; score: number | null };
  /** "Top 5th", "Q3 4:12", "72'". */
  periodLabel: string | null;
  /**
   * Why there is no line for this player, where the sport holds none at all
   * (soccer's feed carries the score and the events, not a box score; tennis
   * carries set scores). Said in the card rather than leaving the band empty.
   */
  notHeld?: string;
  /** The subject's own game so far. `null` before the player appears in the box score. */
  subjectLine: {
    /** "2-for-3", "5.1 IP". */
    headline: string;
    facts: string[];
    /** "At bat", "Pitching". */
    now: string | null;
    plays: Array<{ label: string; text: string; note: string | null }>;
  } | null;
  /**
   * Today's markets with a live value, each against its main line and the price
   * the page resolved for it. A line that has cleared is marked here rather
   * than by colour alone in the card (R6.3).
   */
  lines: Array<{
    key: string;
    label: string;
    direction: 'O' | 'U';
    line: number;
    value: number;
    cleared: boolean;
    price?: { americanOdds: number; bookmaker: string } | null;
  }>;
  /** What just happened, newest first — MLB plays, football scoring, NHL goals and penalties, soccer cards. */
  events: Array<{ clock: string; text: string }>;
  /** The game page, when the sport has one for this game (R8 fills the rest). */
  gameHref: string | null;
  /** Baseball's situation. Absent for every other sport. */
  baseball?: {
    balls: number;
    strikes: number;
    outs: number;
    bases: { first: boolean; second: boolean; third: boolean };
    batter: { name: string; headshotUrl?: string; line: string } | null;
    pitcher: { name: string; headshotUrl?: string; line: string } | null;
  } | null;
  /** Football's situation: possession, down and distance, the red zone. */
  football?: {
    possession: string | null;
    downAndDistance: string | null;
    ballOn: string | null;
    redZone: boolean;
  } | null;
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
  propOddsBoard: PropOddsBoardProps | null;
  model?: { todaysLine?: TodaysLineData | null } | null;
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
  /**
   * Default numeric O/U stepper (MLB/NFL). Golf supplies its own `GolfCategoryPicker` control data instead — see the golf adapter's `lineControl`.
   *
   * `model` (R6.1d) is the model's probability and the line it was computed
   * at. MLB's model runs on fixed board lines (`BOARD_LINES`) while the stepper
   * opens on the main line books posted, so the component names the model's
   * line whenever the two differ rather than printing a probability for a line
   * it was not computed at. Omitted by sports that show no model here.
   */
  lineControl?:
    | { kind: 'stepper'; line: number; baseLine: number; wantOver: boolean; model?: { prob: number; line: number } | null }
    | { kind: 'category'; dimension: string; value: string; categories: string[] };
  /**
   * The active candidate as priced at the line the stepper opens on (R6.1d).
   * MLB's candidates carry the board line; this one carries the main line and
   * that line's price, and drops the model fields that belong to the board
   * line. The price chip, the edge and "Add to slip" read it. Omitted when the
   * active candidate is already at its market line (every other sport).
   */
  priceCandidate?: PickCandidate | null;
  /** C4 — see `GameStateSlot`. */
  gameState?: GameStateSlot | null;
  /** Golf only — the round-in-progress hole-by-hole scorecard vs. a tee-time groupmate. */
  liveMatchup?: import('@/lib/sports/golf/adapter').LiveRoundMatchup | null;
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

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

function mlbLogoUrl(teamId: number): string {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

/** "#12 " lead-in, empty string until a rank exists — ported from `PlayerDetail.tsx:138-145`. */
function rankPrefix(rank: number | null | undefined): string {
  return rank != null ? `#${rank} ` : '';
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
}

export interface MlbPlayerDetailInput {
  candidates: PickCandidate[];
  /** Falls back to `candidates[0]` when omitted or not found, same as `PlayerDetail.tsx:958`. */
  market?: string;
  snapshot: SportSnapshot | null;
  odds: UnifiedLinesResult | null;
  scope: MlbPlayerDetailScope;
  /** `usePropOdds()`'s resolved rows/sportsbook — a hook result, so the component still calls the hook; the adapter only repackages it into `PropOddsBoardProps`. */
  propOdds?: { rows: PropOddsRow[]; userSportsbook: string };
  /** `useTeamStatcast(opponentId)`'s result — only meaningful when the active subject is a pitcher. */
  opponentTeamStatcast?: TeamStatcastState;
  /** `useLiveGame(...)`'s result — only meaningful while the subject's game is in progress. */
  live?: LiveGameState;
  /**
   * the Statcast rollup row's `profile` block (`useMlbStatcast`, R6.1b) — the pitch-level Statcast rollup that
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
   * Tonight's opposing STARTER's own pitch profile — `useMlbStatcast` for the starter
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
  const { candidates, market, snapshot, odds, scope, propOdds, opponentTeamStatcast, live, pitchProfile, opposingPitchProfile } = input;

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

  const games: SlateGame[] = ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as SlateGame[];
  const statKeys: StatKeyDef[] = ((snapshot?.context?.other as Record<string, unknown> | undefined)?.statKeys ?? []) as StatKeyDef[];
  const slate = buildSlate(games, odds?.lines ?? []);
  const todaysGame = teamAbbr ? slate.byAbbrev.get(teamAbbr.toUpperCase()) : undefined;
  const liveScoreInfo = todaysGame ? liveFor(todaysGame) : {};
  const gameIsInProgress = /in progress/i.test(todaysGame?.game?.state ?? '');

  // ---- The line (R2-F4, operator decision 2026-09-15) ----
  // MLB's candidates sit on fixed board lines (`BOARD_LINES`: pitcher
  // strikeouts 4.5, total bases 1.5), the lines the Python model, its
  // calibration and grading use, and Scan keeps them. The player page opens on
  // the line books actually posted — R2's main line, the rule every other
  // sport's candidates already carry — so the hit rates and the price are for a
  // bet that exists. Measured 2026-09-15 over 63 games: the main line equalled
  // the board line for 8 of 31 pitcher strikeout markets, 3 of 30 pitcher
  // outs, and 119 of 253 total bases. A market with only one-sided rungs
  // (triples, batter strikeouts) has no main line and keeps the board line.
  const startIso = todaysGame?.game?.firstPitch ?? null;
  // The slate's first pitch is an ISO instant; the matchup line and the
  // conditions card printed it raw ("2026-09-15T22:40:00Z"), found rendering R6.1d.
  const firstPitchText = startIso && Number.isFinite(Date.parse(startIso))
    ? new Date(startIso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null;
  // `repriceAtMainLine` is the shared rule; the model keeps its own line.
  const repriced = (c: PickCandidate) => {
    const key = candidateDimensionToMarketKey(c.dimension);
    const rows = key && propOdds ? propOdds.rows.filter((r) => r.subjectId === c.subjectId && r.marketKey === key) : [];
    return repriceAtMainLine(c, rows, startIso);
  };
  /** The best price on the side the card shows, at the line it shows. */
  const priceFor = (c: PickCandidate, line: number) => {
    const key = candidateDimensionToMarketKey(c.dimension);
    if (!key || !propOdds) return null;
    const side = directionMark(c.category) === 'U' ? 'under' : 'over';
    // A pick'em app's fixed payout is not a price (R2, `mainLine.ts`): it won
    // this comparison on every market until the live card showed "prizepicks +100".
    const rows = propOdds.rows.filter((r) => r.subjectId === c.subjectId && r.marketKey === key && r.line === line && r.side === side && !isPickemBook(r.bookmaker));
    const best = rows.length ? rows.reduce((a, b) => (b.americanOdds > a.americanOdds ? b : a)) : null;
    return best ? { americanOdds: best.americanOdds, bookmaker: best.bookmaker } : null;
  };
  const { marketLine, priced: priceCandidate } = repriced(active);
  const baseLine = marketLine ?? active.line ?? 0.5;
  const line = Math.max(0.5, baseLine + scope.lineOffset);
  const wantOver = directionMark(active.category ?? '') !== 'U';
  const modelProb = typeof meta.modelProb === 'number' ? meta.modelProb : null;
  const model = modelProb != null && active.line != null ? { prob: modelProb, line: active.line } : null;

  const activeHistory = active.history;

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


  // ---- Prop odds board (PlayerDetail.tsx:1784-1817; universal, no branch) ----
  const activeMarketKey = candidateDimensionToMarketKey(active.dimension);
  const propOddsBoard: PropOddsBoardProps | null =
    activeMarketKey && propOdds
      ? { allRows: propOdds.rows, subjectId: active.subjectId, marketKey: activeMarketKey, line: marketLine ?? active.line ?? null, userSportsbook: propOdds.userSportsbook }
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

  // ---- Form (context rail; corrected per the type doc comment above) ----
  const formWindows: SplitEvidence[] | null = active.supportingSplits ?? null;

  // ---- C4 game state (R6.1d) ----
  // The live route answers 404 unless the game is live, so a poll that
  // succeeded is the proof; the slate's own state lags (measured 2026-09-15:
  // "Warmup" in the snapshot three minutes after StatsAPI said In Progress).
  // A failed poll or a slate that says final clears it, so the last good poll
  // never keeps a finished game on screen.
  const slateFinal = /final|game over|completed/i.test(todaysGame?.game?.state ?? '');
  const liveData = live?.data && !live.error && !slateFinal ? live.data : null;
  const logo = (id: number | undefined) => (id != null ? mlbLogoUrl(id) : undefined);
  const teams = (withScore: boolean) => ({
    away: { abbr: todaysGame?.awayAbbrev ?? 'Away', logoUrl: logo(todaysGame?.game?.awayTeamId), score: withScore && liveData ? liveData.score.away : null },
    home: { abbr: todaysGame?.homeAbbrev ?? 'Home', logoUrl: logo(todaysGame?.game?.homeTeamId), score: withScore && liveData ? liveData.score.home : null },
  });
  let gameState: GameStateSlot | null = null;
  if (liveData) {
    const p = liveData.player;
    // The live box score stubs a zeroed batting line for every player, so a
    // pitcher's batting line is skipped by his known role, not by presence.
    const bat = p?.batting && !isPitcherSubject ? p.batting : null;
    const pit = p?.pitching ?? null;
    const current = liveData.currentPitcher;
    gameState = {
      status: 'live',
      ...teams(true),
      periodLabel: `${liveData.inning.half === 'top' ? 'Top' : 'Bot'} ${liveData.inning.ordinal}`,
      subjectLine: bat
        ? {
            headline: `${bat.hits}-for-${bat.atBats}`,
            facts: [`${bat.runs} R`, `${bat.rbi} RBI`, `${bat.walks} BB`, `${bat.strikeOuts} K`],
            now: p?.isCurrentBatter ? 'At bat' : null,
            plays: (liveData.subjectPlays ?? []).map((pl, i) => ({ label: `PA ${i + 1}`, text: pl.description ? `${pl.event}: ${pl.description}` : pl.event, note: pl.rbi > 0 ? `${pl.rbi} RBI` : null })),
          }
        : pit
          ? {
              headline: `${pit.inningsPitched} IP`,
              facts: [`${pit.hits} H`, `${pit.runs} R`, `${pit.earnedRuns} ER`, `${pit.walks} BB`, `${pit.strikeOuts} K`, `${pit.pitches} pitches`],
              // The route's `isCurrentPitcher` is true for a starter whose team
              // is batting (measured 2026-09-15, top 1st: Chris Murphy "pitching"
              // with Foster Griffin on the mound); the defense's pitcher decides.
              now: p?.isCurrentPitcher && current?.id === p.id ? 'Pitching' : null,
              plays: [],
            }
          : null,
      lines: candidates.flatMap((c) => {
        const value = liveData.liveValues?.[c.dimension];
        const dir = directionMark(c.category);
        const at = repriced(c).marketLine ?? c.line;
        if (value == null || dir === null || at == null) return [];
        return [
          {
            key: `${c.dimension}:${c.category}`,
            label: marketText('mlb', c.dimension, 'full'),
            direction: dir,
            line: at,
            value,
            cleared: liveLineHit(dir, value, at),
            price: priceFor(c, at),
          },
        ];
      }),
      // Newest first, the way a reader scans a feed.
      events: [...(liveData.plays ?? [])]
        .slice(-4)
        .reverse()
        .map((pl) => ({ clock: `${pl.half === 'top' ? 'T' : 'B'}${pl.inning}`, text: `${pl.batter} ${pl.event.toLowerCase()}` })),
      gameHref: todaysGame?.game?.gamePk != null ? `/mlb/game/${todaysGame.game.gamePk}` : null,
      baseball: {
        balls: liveData.count.balls,
        strikes: liveData.count.strikes,
        outs: liveData.outs,
        bases: liveData.bases,
        batter: liveData.batter ? { name: liveData.batter.name, headshotUrl: mlbHeadshotUrl(liveData.batter.id), line: liveData.batter.todayLine } : null,
        // `currentPitcher`, not the inning half: after a mid-inning change the
        // half still points at whoever started it.
        pitcher: current ? { name: current.name, headshotUrl: mlbHeadshotUrl(current.id), line: `${current.ip} IP · ${current.h} H · ${current.k} K` } : null,
      },
    };
  } else if (gameIsInProgress && live?.loading) {
    gameState = { status: 'loading', ...teams(false), periodLabel: null, subjectLine: null, lines: [], events: [], gameHref: null, baseball: null };
  }

  // ---- Hero rank prefix (PlayerDetail.tsx:143-145, 1259-1264) ----
  const ownStatcastSummary = meta.ownStatcastSummary as { overallRank: number | null } | undefined;

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
    extraFacts: firstPitchText
      ? [{ key: 'firstPitch', label: 'First pitch', value: firstPitchText }]
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
  // MLB's strike zone and platoon split live in the page's Statcast sections
  // now — "Contact quality & approach" for a hitter (R6.1b), "Arsenal &
  // command" for a pitcher (R6.1c) — from the same rollup, with more views. The
  // prop block no longer repeats them, so both roles are null for MLB.
  const spatialGrid = null;



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
    propOddsBoard,
    model: { todaysLine },
    formWindows,
    lineControl: { kind: 'stepper', line, baseLine, wantOver, model },
    priceCandidate,
    gameState,
    liveMatchup: null,
    seasonStatsCard: null,
    golfFormHoles: null,
    nflSeasonStats: null,
    opponentUnit,
    conditions,
    usageMix,
    spatialGrid,
    binarySplit: null,
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

/**
 * The player page's shared research sections (Seasons, Trends, Splits, Game
 * log, the hero's season tiles) — R6.1a. Built from the player's history and
 * bio, never from a candidate, so the page renders with no market at all.
 * The columns are this sport's `playerResearchSpec.ts`; the work is
 * `buildPlayerResearch`, shared by every sport.
 */
export function toPlayerResearchData(input: { history: PlayerHistory; bio: PlayerBio | null; now?: Date; statcast?: MlbStatcastInput }): PlayerResearchData | null {
  const spec = mlbResearchSpec(input.bio, input.history.games);
  const research = buildPlayerResearch({ sport: 'mlb', history: input.history, spec, now: input.now });
  if (!research || !input.statcast) return research;
  // MLB's own sections: the hitter's contact quality (R6.1b), the pitcher's arsenal (R6.1c).
  const season = input.history.games.filter((g) => g.season === input.statcast!.season);
  const sum = (keys: string[]) => season.reduce((n, g) => n + keys.reduce((m, k) => m + (typeof g.stats[k] === 'number' ? (g.stats[k] as number) : 0), 0), 0);
  // Box-score counts for the coverage note. A pitcher's history has no batters
  // faced, so at bats + walks + hit-by-pitches stands in (it leaves out
  // sacrifices and interference, so it can only understate).
  return {
    ...research,
    sections:
      spec.kind === 'hitter'
        ? [mlbHitterSection(input.statcast, sum(['bat_plateAppearances']) || null)]
        : [mlbPitcherSection(input.statcast, sum(['pit_atBats', 'pit_baseOnBalls', 'pit_hitByPitch']) || null)],
  };
}
