/**
 * `PlayerDetail.tsx` adapter — Golf half.
 *
 * Phase 1 of the sport-adapter project (see `docs/sport-adapter-design.md`
 * §3). Purely additive, same contract as the MLB sibling
 * (`lib/sports/mlb/adapters/playerDetailAdapter.ts`): converts golf's real
 * data shapes into the shared `PlayerDetailData` interface. No existing
 * component is touched.
 *
 * `PlayerDetailData` and its sport-agnostic supporting types live in the
 * MLB adapter file and are imported from there rather than redefined here
 * — see that file's header comment for why (this task is scoped to exactly
 * two new files; a later phase should relocate the shared half to a neutral
 * module once `PlayerDetail.tsx` itself consumes it).
 */

import type { PickCandidate, SportSnapshot } from '@/lib/core/types';
import { entryValue } from '@/lib/core/windowedStat';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import type { PropOddsRow } from '@/lib/db/client';
import type { AdvancedStat, GolferStrokesGained } from '@/lib/sports/golf/pgatourStats';
import type { PlayerSeasonLog } from '@/lib/sports/golf/playerSeason';
import type { GolfCategory, LiveRoundMatchup } from '@/lib/sports/golf/adapter';
import type { ChipDef, PlayerDetailChart, PlayerDetailData, PropOddsBoardProps, RoundScoreEntry } from '@/lib/sports/mlb/adapters/playerDetailAdapter';

// ---------------------------------------------------------------------------
// Golf-specific helpers
// ---------------------------------------------------------------------------

/** Average isn't a whole-number relative-to-par token, so the AVG round-score box gets one-decimal formatting — Phase 2's `format: 'average'` case should use this convention (ported from `PlayerDetail.tsx:843-846`'s `relDisplayAvg`), while `format: 'relative'` uses the integer-only 'E'/'+N' convention (`relDisplay`, `PlayerDetail.tsx:538-542`). Both stay component-side formatting, not adapter output — the adapter only says which convention applies.
 */

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

/** The interactive scope state `PlayerDetail.tsx` currently owns for golf (`selectedGolfCategory`/`selectedRound`, lines 968, 1107). Phase 2's component keeps these as its own state and re-calls `toPlayerDetailData` whenever one changes. */
export interface GolfPlayerDetailScope {
  /** `null` defaults to the most recent round with history — same fallback as `effectiveRound` (`PlayerDetail.tsx:1111`). */
  selectedRound: number | null;
  /** `null` defaults to the active candidate's own tracked category — same fallback as `effectiveGolfCategory` (`PlayerDetail.tsx:972`). */
  selectedCategory: GolfCategory | null;
}

export interface GolfPlayerDetailInput {
  candidates: PickCandidate[];
  /** Falls back to `candidates[0]` when omitted or not found, same as `PlayerDetail.tsx:958`. */
  market?: string;
  /**
   * Present for interface symmetry with the MLB adapter, currently unused:
   * golf's "Today's line" card (`PlayerDetail.tsx:1992-2045`) has no sport
   * gate in the real component, but a golfer's `subjectMeta` never carries
   * a `team` abbreviation, so `todaysGame` resolution there always misses
   * and the card always renders its empty state. Modeled honestly as
   * `model: null` below rather than reproducing dead lookup logic — see
   * the Phase 1 report's "gaps found" section.
   */
  snapshot?: SportSnapshot | null;
  scope: GolfPlayerDetailScope;
  /** `usePropOdds()`'s resolved rows/sportsbook. */
  propOdds?: { rows: PropOddsRow[]; userSportsbook: string };
  /** Golf's season/advanced-stats card data — passed straight through from `PlayerDetailProps.golfStats` (`components/PlayerDetail.tsx:922-930`); this adapter does no fetching of its own, same as the MLB half. */
  golfStats?: {
    strokesGained: GolferStrokesGained | null;
    seasonLog: PlayerSeasonLog | null;
    advancedStats: AdvancedStat[];
    loading: boolean;
  };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/**
 * Converts golf's real `PlayerDetail` inputs into `PlayerDetailData`.
 *
 * Returns `null` when there is no active candidate to show, same contract
 * as the MLB adapter.
 */
export function toPlayerDetailData(input: GolfPlayerDetailInput): PlayerDetailData | null {
  const { candidates, market, scope, propOdds, golfStats } = input;

  const active = candidates.find((c) => c.dimension === market) ?? candidates[0];
  if (!active) return null;

  const meta = (active.subjectMeta ?? {}) as Record<string, unknown>;
  const headshotUrl = typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined;

  // ---- Golf category selection (PlayerDetail.tsx:960-973) ----
  const effectiveGolfCategory: GolfCategory = scope.selectedCategory ?? ((active.category as GolfCategory) ?? 'par');

  // ---- Round selector (PlayerDetail.tsx:1103-1111) ----
  const golfRounds = Array.from(new Set(active.history.map((h) => h.period))).sort((a, b) => a - b);
  const effectiveRound = scope.selectedRound ?? golfRounds[golfRounds.length - 1] ?? 1;

  // ---- Chips — round selector replaces venue/lastN for golf (PlayerDetail.tsx:1417-1423) ----
  const chips: ChipDef[] = golfRounds.map((r) => ({ key: `round:${r}`, label: `Round ${r}` }));

  // ---- Round-score boxes (PlayerDetail.tsx:1452-1473) ----
  const roundScores: RoundScoreEntry[] = golfRounds.map((r) => {
    const entry = active.history.find((h) => h.period === r);
    const value = entry ? entryValue(entry) : null;
    return {
      key: `r${r}`,
      label: `R${r}`,
      value,
      format: 'relative',
      hit: entry ? entry.category === effectiveGolfCategory : null,
    };
  });
  const roundValues = golfRounds
    .map((r) => {
      const entry = active.history.find((h) => h.period === r);
      return entry ? entryValue(entry) : null;
    })
    .filter((v): v is number => v !== null);
  roundScores.push({
    key: 'avg',
    label: 'AVG',
    value: roundValues.length > 0 ? roundValues.reduce((a, b) => a + b, 0) / roundValues.length : null,
    format: 'average',
  });

  // ---- Scorecard chart (PlayerDetail.tsx:1117-1143) ----
  const scorecardHoles = candidates
    .filter((c) => /^hole-\d+$/.test(c.dimension))
    .map((c) => {
      const parMatch = /Par (\d+)/.exec(c.dimensionLabel);
      const par = parMatch ? Number(parMatch[1]) : null;
      const entry = c.history.find((h) => h.period === effectiveRound);
      const value = entry ? entryValue(entry) : null;
      const raw = (entry?.raw ?? null) as { strokes?: number | null } | null;
      const strokes = raw?.strokes ?? (value != null && par != null ? par + value : null);
      return { hole: Number(c.dimension.slice('hole-'.length)), par, value, strokes };
    })
    .sort((a, b) => a.hole - b.hole);
  const chart: PlayerDetailChart = {
    kind: 'scorecard',
    title: `Round ${effectiveRound} scorecard`,
    subtitle: 'green under par, red over',
    data: scorecardHoles,
  };

  // ---- Prop odds board (PlayerDetail.tsx:1784-1817; universal, no branch) ----
  const activeMarketKey = candidateDimensionToMarketKey(active.dimension);
  const propOddsBoard: PropOddsBoardProps | null =
    activeMarketKey && propOdds
      ? { allRows: propOdds.rows, subjectId: active.subjectId, marketKey: activeMarketKey, line: active.line ?? null, userSportsbook: propOdds.userSportsbook }
      : null;

  // ---- Live matchup, golf-only (PlayerDetail.tsx:1710-1720) ----
  const liveMatchup = (meta.liveRoundMatchup as LiveRoundMatchup | undefined) ?? null;

  // ---- Form — every hole scored identically in every round played so far (ConsistentHolesForm, PlayerDetail.tsx:759-763) ----
  const golfFormHoles = candidates
    .filter((c) => /^hole-\d+$/.test(c.dimension) && c.consistent && c.sampleSize >= 2)
    .sort((a, b) => b.sampleSize - a.sampleSize || a.dimension.localeCompare(b.dimension, undefined, { numeric: true }));

  return {
    subject: {
      subjectId: active.subjectId,
      name: active.subjectName,
      headshotUrl,
      // Golf has no team concept — teamAbbr/teamLogoUrl intentionally omitted
      // rather than fabricated. Leaderboard position/thru/teeTime/totalScore
      // are real golf data but live on `active.subjectMeta` already (part of
      // `candidates`, also returned below), not duplicated into `subject`.
      teamAbbr: undefined,
      teamLogoUrl: undefined,
      position: undefined,
      // Golf never populates `ownStatcastSummary` (an MLB-only meta field),
      // so the hero header's rank box never shows for golf today — real
      // absence of data, not an adapter gap.
      rankPrefix: '',
      opponentAbbr: undefined,
      opponentLogoUrl: undefined,
      rankDetail: undefined,
      gameStartTime: undefined,
      gameStatus: undefined,
      accentColor: undefined,
    },
    candidates,
    market: active.dimension,
    chips,
    windows: null,
    roundScores,
    chart,
    gamelog: null,
    propOddsBoard,
    // See GolfPlayerDetailInput.snapshot's comment — golf subjects carry no
    // team abbreviation, so the "Today's line" game-model lookup that powers
    // this field for MLB/NFL structurally never resolves for golf. Modeled
    // as `null` rather than reproducing a lookup that can never succeed.
    model: null,
    hitterStats: null,
    formWindows: null,
    lineControl: { kind: 'category', dimension: active.dimension, value: effectiveGolfCategory, categories: ['birdie', 'par', 'bogey'] },
    liveGame: null,
    liveMatchup,
    matchups: null,
    seasonStatsCard: golfStats
      ? {
          strokesGained: golfStats.strokesGained,
          seasonLog: golfStats.seasonLog,
          advancedStats: golfStats.advancedStats,
          loading: golfStats.loading,
        }
      : null,
    mlbContextMatchup: null,
    golfFormHoles,
    nflMatchup: null,
    nflSeasonStats: null,
  };
}
