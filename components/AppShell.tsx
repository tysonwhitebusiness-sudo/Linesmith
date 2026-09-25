'use client';

import { startTransition, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { PickCandidate, Sport, SoccerLeague, TennisTour } from '@/lib/core/types';
import { SPORTS, SPORT_LABEL, candidateKey } from '@/lib/core/types';
import {
  readForm,
  scanComingUp,
  scanMovers,
  sortByComingUp,
} from '@/lib/core/pickEngine';
import { useSnapshot } from './useSnapshot';
import { useSlip } from './useSlip';
import { useGameLines } from './useGameLines';
import { useSlatePropOdds, rowsFor, resolveCandidateEdge } from './usePropOdds';
import { usePickHistoryModelData, needsModelDataMerge, mergeModelData } from './usePickHistoryModelData';
import { useTeamDefenseAllowed } from './useTeamDefenseAllowed';
import type { CfbTeamDefenseAllowed } from '@/lib/sports/cfb/teamDefenseAllowed';
import { cfbMatchupFavorableFor } from '@/lib/sports/cfb/teamDefenseAllowedMatch';
import type { NbaTeamDefenseAllowed } from '@/lib/sports/nba/teamDefenseAllowed';
import { nbaMatchupFavorableFor } from '@/lib/sports/nba/matchupFavorable';
import type { NhlTeamDefenseAllowed } from '@/lib/sports/nhl/teamDefenseAllowed';
import { nhlMatchupFavorableFor } from '@/lib/sports/nhl/matchupFavorable';
import { mergeMatchupFavorable } from '@/lib/odds/props/matchupFavorable';
import { useMarketCalibration } from './useMarketCalibration';
import { useProjections, projectionKey } from './useProjections';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import ScanCard from './ScanCard';
import SlipModal from './SlipModal';
import PlayerFilterDrawer from './PlayerFilterDrawer';
import { DateGameStrip } from './DateGameStrip';
import { GolferStrip } from './GolferStrip';
import { TopBar, TABS, type Tab } from './TopBar';
import { PlayerDetailPanel } from './PlayerDetailPanel';
import { ScanTable, ScanTableSkeleton, type ScanTableProps } from './ScanTable';
import { PlayerSkeleton, ScanListSkeleton } from './Skeleton';
import { useSlate } from './slate/useSlate';
import { SlateGames, SlateSectionNav } from './slate/SlateSections';
import { SlateMarket, useSlateMarket } from './slate/SlateMarket';
import { SlateSpotlights, useSlateFlags } from './slate/SlateSpotlights';
import { SlateSpecials, useSlateSpecials } from './slate/SlateSpecials';
import { SlateMovers, moversShown, useSlateMovers } from './slate/SlateMovers';
import { useEdges, useScanExtras, useSlateOdds } from './odds/useOdds';
import { LiveProvider } from './odds/live';
import { SlateModel, useSlateModel } from './slate/SlateModel';
import { SlateYourLines, useSignedIn, useYourLineSources } from './slate/SlateYourLines';
import { useTrackedAlerts } from './useTrackedAlerts';
import { toYourLines } from '@/lib/slate/yourLines';
import { buildSpotlights, flagSpotlightCards, weatherSpotlight } from '@/lib/slate/spotlights';
import { slateSections } from '@/lib/sports/shared/slateShapes';
import { athleteIdOf } from '@/lib/sports/shared/playerResearchShapes';
import {
  DensityToggle,
  GolfScanModeToggle,
  FilterBar,
  FilterDropdown,
  CheckboxList,
  BooleanCheckboxRow,
  FilterSelect,
  FilterSearchBox,
  FilterOddsRangeInputs,
  OverflowMenu,
  IconToggleButton,
  HitRatePicker,
} from './FilterBar';
import { FilterSidebar } from './FilterSidebar';
import { PeopleIcon, BarsIcon, ShieldIcon, TargetIcon, SlidersIcon, FlameIcon, SidebarIcon, BookIcon, SnowflakeIcon, CheckCircleIcon, PositionIcon } from './icons';
import { useGolfLines } from './useGolfLines';
import { TournamentLinesView } from './TournamentLinesView';
import { TournamentNotStartedNotice } from './TournamentNotStartedNotice';
import { TeamLogo, GameMatchupLabel, nflTeamLogoUrl } from './SubjectAvatar';
import { buildSlate, type SlateEntry, type SlateGame } from '@/lib/odds/matching';
import { useFilters, applyFilters, filtersActive, activeFilterCount } from './useFilters';
import { SegmentedToggle, Toggle, Chip, Button, SlideoutMenu, SectionBand } from './ui';
import { easternDate } from '@/lib/sports/mlb/statsapi';

/**
 * Phase 2 — GOOD BETS IS GONE, and the ranking replaced it.
 *
 * It was an edge-gated subset built by the scoring layer Phase 1 deleted, and
 * it answered a different question from the one this product asks. "Which of
 * these is a bet" is a claim about someone else's price; "who has the most
 * value today" is a claim about players, which is the only kind this project
 * has evidence for. The replacement is not another tab — it is the DEFAULT
 * ORDER of the table itself (see `ScanTable`'s `rank` sort and
 * `lib/sports/propRanking.ts`), so the board opens ranked rather than asking
 * anyone to pick a lens first.
 *
 * "All" leads because the table is meant to be swept.
 *
 * "Coming up" is empty by definition until first pitch, so opening on it meant
 * arriving at an empty screen for most of the day — the table has to actually
 * have the slate in it to be worth defaulting to.
 *
 * Consistent and Hot/Cold used to be separate tabs here; they're now filter
 * toggles instead (Hot Streak / Cold Streak / Consistent, in the filter bar)
 * so they narrow whichever tab you're already on rather than replacing it.
 *
 * C6: the view tabs are gone — status (All / Upcoming / Live) and Watchlist
 * are independent controls, and the Home Runs board was deleted outright (HR
 * props remain a value of the Market filter; the HR *ranking* is a Special).
 */

const LAST_SPORT_KEY = 'linesmith:last-sport';
const DENSE_KEY = 'linesmith:dense';

export function AppShell({ sport, league }: { sport: Sport; league?: SoccerLeague | TennisTour }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // P4 — undefined previews today; a date string previews that future slate
  // instead. MLB only (golf has no date-parameterised snapshot route yet).
  const [scanDate, setScanDate] = useState<string | undefined>(undefined);
  // NFL reuses MLB's whole odds/props pipeline shape (real provider rows in
  // the same prop_odds table, same date-agnostic "today's slate" concept) —
  // golf is the one genuinely different case (tournament field, no daily date).
  // Soccer's props are embedded directly per-candidate by buildSoccerSnapshot
  // (same as NFL's own adapter), not fetched via this separate slate-wide
  // path — /api/props/lines is MLB-scoped underneath (loadAllGameContexts()
  // only knows MLB games), so it wouldn't return anything for soccer anyway.
  const hasPropsPipeline = sport === 'mlb' || sport === 'nfl';
  const { snapshot, loading, error, lastFetched, refresh } = useSnapshot(sport, sport === 'mlb' ? scanDate : undefined, league);
  const slip = useSlip(sport);

  // Odds ride the snapshot's own refresh cycle rather than polling separately —
  // every extra fetch is an Odds API credit off a 500/month budget.
  const odds = useGameLines(sport, snapshot?.fetchedAt ?? null);
  const golfLines = useGolfLines(snapshot?.fetchedAt ?? null, sport === 'golf');
  // Slate-wide Tier 1 prop prices for Scan's dense table.
  const slateProps = useSlatePropOdds(snapshot?.fetchedAt ?? null, hasPropsPipeline, sport);
  // Scan's price gate (below) depends on slateProps having actually
  // resolved — without this, the gate would read an empty rows array as
  // "nothing has real odds" and flash an empty Scan table on every load.
  const dataLoading = loading || (hasPropsPipeline && slateProps.loading);
  // Scan-table Score-column fix (2026-08-27) — these five sports' own
  // adapter.ts files never populated subjectMeta.modelProb (no real model
  // existed for them until predict/generic_prop_production.py). MLB has its
  // own fitted model wired in at snapshot-build time; merging pick_history's
  // generic model on top there would overwrite a better number with a worse
  // one. (This comment used to say golf had a fitted model too. It never did:
  // golf's were unfitted priors, deleted in master plan Phase 8.)
  const shouldMergeModelData = needsModelDataMerge(sport);
  const modelData = usePickHistoryModelData(sport, snapshot?.fetchedAt ?? null, shouldMergeModelData);
  // X-signal for CFB (Phase C of docs/x-signal-remaining-sports-gameplan-
  // 2026-08-27.md) — same client-side merge shape as modelData above, since
  // CFB's real opponent-rank data is fetched by a separate route/hook
  // rather than being available server-side at adapter build time the way
  // NFL's/Soccer's own X-signal is.
  const cfbTeamDefense = useTeamDefenseAllowed<CfbTeamDefenseAllowed>('/api/cfb/team-defense-allowed', sport === 'cfb');
  // X-signal for NBA/NHL (Phase D/E of the same gameplan) — identical shape
  // to CFB above, one hook per sport since each has its own route/type.
  const nbaTeamDefense = useTeamDefenseAllowed<NbaTeamDefenseAllowed>('/api/nba/team-defense-allowed', sport === 'nba');
  const nhlTeamDefense = useTeamDefenseAllowed<NhlTeamDefenseAllowed>('/api/nhl/team-defense-allowed', sport === 'nhl');

  // Lets the Teams pages' tab row link straight back to Players (not just
  // Scan) without Teams needing to live inside this component's own state.
  // `?tab=Scan` is kept as an alias for `Slate` (S1): the tab was renamed, and
  // a link written before the rename should still land where it meant to.
  const [tab, setTab] = useState<Tab>(() => (searchParams.get('tab') === 'Players' ? 'Players' : 'Slate'));
  // NFL's candidate set is now ~2,099 items — re-scoring/re-sorting that on
  // a synchronous setState was a real, felt freeze on click, not just a
  // navigation-related gap. `startTransition` lets React paint the pending
  // state immediately and de-prioritize the heavy re-render; `pendingTab`
  // is separate local UI state (not part of the transition itself) so
  // TopBar can show its own spinner for it.
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);
  const handleTabChange = (next: Tab) => {
    setPendingTab(next);
    startTransition(() => {
      setTab(next);
      setPendingTab(null);
    });
  };
  // Every sport opens on All, which is now the ranked board rather than an
  // unordered dump — Phase 2 made the ranking the table's default sort, so
  // there is no longer a "best" tab to land on instead of the whole slate.
  const calibration = useMarketCalibration(true, sport);
  // Phase 2 — the validated prop model. Runs for every sport and is inert for
  // the seven with no fitted model, same as every other hook here (rules of
  // hooks: always called, mostly idle).
  const projections = useProjections(sport);
  // S1 — the Slate's own read. Ten kilobytes, fetched beside the snapshot
  // rather than inside it, so the top of the page draws while the props
  // board's own 20-odd megabytes are still arriving (SL-11).
  const slateRead = useSlate(sport, league ?? null, sport === 'mlb' ? (scanDate ?? null) : null, snapshot?.fetchedAt ?? null);
  // S2's market cards, on their own route and their own clock: they take two
  // to six seconds against the real tables and must not delay either of the
  // two sections that matter.
  const marketRead = useSlateMarket(sport, league ?? null, sport === 'mlb' ? (scanDate ?? null) : null, snapshot?.fetchedAt ?? null);
  // MV3 — consensus line movement on the games still to start.
  // O4 — the slate's game-line odds (every book, the sharp price, steam,
  // pulls), keyed by the games the Slate shows, on their own 60 s cache.
  const slateCards = slateRead.data?.games?.cards ?? [];
  const slateOdds = useSlateOdds(sport === 'golf' ? null : sport, slateRead.data?.date ?? null, slateCards.map((c) => c.id), snapshot?.fetchedAt ?? null);
  const slateOddsById = useMemo(() => new Map((slateOdds.data?.games ?? []).map((g) => [g.gameId, g])), [slateOdds.data]);
  const slateRefs = useMemo(
    () => new Map(slateCards.map((c) => [c.id, { label: `${c.away.abbr ?? c.away.name} @ ${c.home.abbr ?? c.home.name}`, href: c.href ?? null, home: c.home.abbr ?? c.home.name }])),
    [slateCards],
  );
  // D22 — Scan's Open → now and pulled marker, for the same games.
  const scanExtras = useScanExtras(sport === 'golf' ? [] : slateCards.map((c) => c.id), snapshot?.fetchedAt ?? null);
  // P11 — the market edges passing every gate, for the game cards and the Market hub.
  const slateEdges = useEdges(sport === 'golf' ? [] : slateCards.map((c) => c.id), snapshot?.fetchedAt ?? null);
  const moversRead = useSlateMovers(sport, league ?? null, sport === 'mlb' ? (scanDate ?? null) : null, snapshot?.fetchedAt ?? null);
  // S4 — the Specials, from `slate_rankings` (the table M3 actually wrote).
  const specialsRead = useSlateSpecials(sport, league ?? null, sport === 'mlb' ? (scanDate ?? null) : null, snapshot?.fetchedAt ?? null);
  // F0 — the sport's own spotlights, the `kind='spotlight'` half of the same
  // table. The research pages read the same route for one subject.
  const flagsRead = useSlateFlags(sport, league ?? null, sport === 'mlb' ? (scanDate ?? null) : null, snapshot?.fetchedAt ?? null);
  // S5 — the Model section, only when the slate's adapter declares one.
  const modelRead = useSlateModel(sport, !!slateRead.data?.modelPicks, sport === 'mlb' ? (scanDate ?? null) : null, snapshot?.fetchedAt ?? null);
  // S5 — Your lines. Signed out, nothing is fetched and nothing renders.
  const signedIn = useSignedIn();
  const yourLineSources = useYourLineSources(sport, signedIn);
  // P12 — alerts on the reader's tracked lines (the same store the header bell reads).
  const trackedAlerts = useTrackedAlerts(signedIn);
  // Golf only: Hole Props (the existing per-hole pattern-scan market) vs.
  // Round Score (one row per golfer, betting on the round total). Filters
  // the base candidate list itself, so every existing tab/filter (Good Bets,
  // All, Coming Up, ...) composes with it for free instead of needing its
  // own special case.
  const [golfMarketView, setGolfMarketView] = useState<'holes' | 'rounds'>('holes');
  // Golf's Scan header used to show two separate pill toggles (Hole
  // Props/Round Score, and a golf-relabeled Field/Match Winner). Collapsed
  // into one 3-way control — derived from the two pieces of state above so
  // nothing else that reads scanScope/golfMarketView has to change.
  // S1: the third mode ("Match Winner") is gone from this control — golf's
  // winner prices are now a SECTION above the props board, always visible,
  // rather than a view you had to switch to and lose the props to see.
  const golfScanMode: 'holes' | 'rounds' = golfMarketView;
  const setGolfScanMode = (mode: 'holes' | 'rounds') => setGolfMarketView(mode);
  const [slipOpen, setSlipOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  // C6: the <640 filter sheet.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Redesign Brief — default (button row) vs. sidebar filter layout.
  const [sidebarLayout, setSidebarLayout] = useState(false);
  const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(new Set());
  // Cards remain available; the table is what loads. Sweeping many candidates
  // is what this view is for, and cards make that a scrolling exercise.
  // The table is the default. Cards stay one click away, but this view exists
  // to sweep a slate, and that is what the table is for.
  const [dense, setDenseRaw] = useState(true);
  const setDense = (v: boolean) => {
    setDenseRaw(v);
    try { window.localStorage.setItem(DENSE_KEY, String(v)); } catch { /* quota */ }
  };

  // Same row-cap ScanTable's dense view uses — the non-dense card list is
  // opt-in (dense defaults true) but has the identical unbounded-.map risk
  // on NFL's 4000+-candidate "All" view.
  const CARD_PAGE_SIZE = 100;
  const [showAllCards, setShowAllCards] = useState(false);
  useEffect(() => {
    setShowAllCards(false);
  }, [tab]);

  // Restore persisted density preference.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DENSE_KEY);
      if (stored !== null) setDenseRaw(stored === 'true');
    } catch { /* quota */ }
  }, []);

  // Filter state
  const {
    filters,
    toggleGame,
    setGamePks,
    toggleDimension,
    toggleTeam,
    setWindow,
    setOddsRange,
    toggleShowNoOdds,
    setHitRateMin,
    setPlayerSearch,
    setSportsbook,
    toggleHotStreak,
    toggleColdStreak,
    toggleConsistentOnly,
    togglePosition,
    setPositions,
    setStatus,
    toggleWatchlistOnly,
    clearAll,
  } = useFilters();

  /**
   * The slider's selection *is* the Games filter — there is no second piece of
   * state to drift out of sync. A multi-select made from the dropdown has no
   * single card to highlight, which the slider shows honestly by falling back
   * to no selection rather than picking one of them arbitrarily.
   */
  const selectedGamePk = filters.gamePks.size === 1 ? [...filters.gamePks][0] : null;
  const selectGame = (gamePk: number | null) =>
    setGamePks(gamePk === null ? new Set() : new Set([gamePk]));

  // Deep link from Tournament Detail's hole-by-hole cards ("/golf?market=hole-7")
  // straight into Scan pre-filtered to that hole's market — applied once on
  // mount only, so it doesn't fight a filter the user changes afterward.
  useEffect(() => {
    const market = searchParams.get('market');
    if (!market) return;
    toggleDimension(market);
    setStatus('all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember the sport across visits.
  useEffect(() => {
    window.localStorage.setItem(LAST_SPORT_KEY, sport);
  }, [sport]);

  // The subject filter (and everything else) is per-sport; drop it when switching.
  useEffect(() => {
    setSelectedSubjects(new Set());
    clearAll();
  }, [sport, clearAll]);

  const candidates = useMemo(() => {
    // Scan-table Score/Edge fix (Phase 1 of docs/scan-playerdetail-parity-
    // gameplan-2026-08-27.md) — shared with every PlayerDetail page route
    // via usePickHistoryModelData.ts's own mergeModelData, so Scan and
    // PlayerDetail can never compute this differently from each other.
    let base = shouldMergeModelData ? mergeModelData(snapshot?.candidates ?? [], modelData.rowsByKey) : (snapshot?.candidates ?? []);
    if (sport === 'cfb' && cfbTeamDefense.teams.length > 0) {
      base = mergeMatchupFavorable(base, (c) =>
        cfbMatchupFavorableFor(c.dimension, (c.subjectMeta as Record<string, unknown> | undefined)?.opponentName as string | undefined, cfbTeamDefense.teams),
      );
    }
    // NBA/NHL: a candidate's own subjectMeta never carries `position` (only
    // the separate SubjectSummary does — real gap found building this,
    // see nba/matchupFavorable.ts's header), so it's resolved once here
    // from snapshot.subjects rather than per-candidate.
    if (sport === 'nba' && nbaTeamDefense.teams.length > 0) {
      const positionBySubjectId = new Map((snapshot?.subjects ?? []).map((s) => [s.subjectId, s.meta?.position as string | undefined]));
      base = mergeMatchupFavorable(base, (c) =>
        nbaMatchupFavorableFor(positionBySubjectId.get(c.subjectId), (c.subjectMeta as Record<string, unknown> | undefined)?.opponent as string | undefined, nbaTeamDefense.teams),
      );
    }
    if (sport === 'nhl' && nhlTeamDefense.teams.length > 0) {
      const positionBySubjectId = new Map((snapshot?.subjects ?? []).map((s) => [s.subjectId, s.meta?.position as string | undefined]));
      base = mergeMatchupFavorable(base, (c) =>
        nhlMatchupFavorableFor(positionBySubjectId.get(c.subjectId), (c.subjectMeta as Record<string, unknown> | undefined)?.opponent as string | undefined, nhlTeamDefense.teams),
      );
    }
    if (sport !== 'golf') return base;
    return base.filter((c) => (golfMarketView === 'rounds' ? c.dimension === 'round-score' : c.dimension !== 'round-score'));
  }, [snapshot, sport, golfMarketView, shouldMergeModelData, modelData.rowsByKey, cfbTeamDefense.teams, nbaTeamDefense.teams, nhlTeamDefense.teams]);

  // Extract today's games from the snapshot for the Games strip.
  const games: SlateGame[] = useMemo(() => {
    return ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ??
      []) as SlateGame[];
  }, [snapshot]);

  // C4: bare athlete id → team logo, straight from the snapshot's own
  // subjects, so the market-shape cards put a team mark beside a player's name
  // without a second lookup. Matched on the bare id, like the player rail.
  const teamLogoBySubject = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of snapshot?.subjects ?? []) {
      const logo = (s.meta as unknown as Record<string, unknown> | undefined)?.teamLogoUrl;
      if (typeof logo === 'string' && logo) map.set(athleteIdOf(s.subjectId), logo);
    }
    return map;
  }, [snapshot]);

  // Base filtering shared by every tab, deliberately stopping short of the
  // price-existence check below — the Home Runs board builds from this
  // directly, so a candidate with no posted price yet still appears on a
  // rankings board, flagged rather than silently dropped (see ScanTable's Odds
  // column). All/Coming Up/Watchlist go one step further, through `filtered`.
  const filteredBeforePriceGate = useMemo(() => {
    let result = applyFilters(candidates, filters);
    // Subject (player drawer) filter — ANDed on top
    if (selectedSubjects.size > 0) {
      result = result.filter((c) => selectedSubjects.has(c.subjectId));
    }
    // Scan is a player-level view — team candidates (team-total-runs) belong
    // to Game Detail's Team tab only.
    result = result.filter((c) => (c.subjectMeta as Record<string, unknown> | undefined)?.isTeamCandidate !== true);
    // A candidate whose underlying hole/inning/game has already been played
    // has no active line left to bet — e.g. hole-1 par once a golfer has
    // finished all four rounds, or a first-inning-only prop once the first
    // inning is over. Adapters already stamp liveState.status === 'done' for
    // exactly this case; Scan just needs to act on it instead of only using
    // it for display.
    result = result.filter((c) => c.liveState.status !== 'done');
    return result;
  }, [candidates, filters, selectedSubjects]);

  const filtered = useMemo(() => {
    let result = filteredBeforePriceGate;
    // A candidate with no real book price for its exact market+line isn't
    // something the user can browse to and act on in All/Coming Up/
    // Watchlist. Skipped while props are still loading so an empty rows
    // array doesn't read as "nothing has odds."
    if (hasPropsPipeline && !slateProps.loading) {
      result = result.filter((c) => {
        const marketKey = candidateDimensionToMarketKey(c.dimension);
        if (!marketKey) return false;
        const rows = rowsFor(slateProps.rows, c.subjectId, marketKey, c.line ?? null);
        if (rows.length === 0) return false;
        // A specific book selected (not "Best available") narrows to players
        // that book actually has a price on, not just the pool as a whole.
        if (filters.sportsbook) return rows.some((r) => r.bookmaker === filters.sportsbook);
        return true;
      });
    }
    return result;
  }, [filteredBeforePriceGate, sport, slateProps.rows, slateProps.loading, filters.sportsbook]);

  // Which book's price every row is resolved against — a real user choice
  // now (filters.sportsbook), falling back to their saved default.
  const effectiveSportsbook = filters.sportsbook ?? slateProps.userSportsbook;

  // Odds range + hot/cold streak narrowing. Still factored out because the
  // Home Runs board applies the same lenses starting from
  // `filteredBeforePriceGate` rather than from `filtered` — a batter with no
  // posted price yet still belongs on a rankings board. Not memoized itself
  // (cheap array filters, and memoizing a function value here would just move
  // the dependency-array bookkeeping without saving real work).
  const narrowByOddsAndStreak = (base: PickCandidate[]) => {
    let result = base;

    if (filters.oddsMin !== null || filters.oddsMax !== null || !filters.showNoOdds) {
      result = result.filter((c) => {
        const price = resolveCandidateEdge(c, slateProps.rows, effectiveSportsbook).price;
        if (price == null) return filters.showNoOdds;
        if (filters.oddsMin !== null && price < filters.oddsMin) return false;
        if (filters.oddsMax !== null && price > filters.oddsMax) return false;
        return true;
      });
    }

    if (filters.hotStreak || filters.coldStreak) {
      const { hot, cold } = scanMovers(result, { minDelta: 0.2, minSampleSize: 4 });
      const ids = new Set([
        ...(filters.hotStreak ? hot.map((h) => candidateKey(h.candidate)) : []),
        ...(filters.coldStreak ? cold.map((h) => candidateKey(h.candidate)) : []),
      ]);
      result = result.filter((c) => ids.has(candidateKey(c)));
    }

    return result;
  };

  // Second-stage narrowing: odds range, hot/cold streak and Good-Bet-only all
  // need live price or a whole-pool comparison, so they apply here rather
  // than in useFilters' pure `applyFilters` — but they narrow every tab
  // uniformly (Hot Streak isn't its own tab anymore, it's a lens onto
  // whichever tab you're already looking at).
  const narrowed = useMemo(
    () => narrowByOddsAndStreak(filtered),
    [filtered, filters.oddsMin, filters.oddsMax, filters.showNoOdds, filters.hotStreak, filters.coldStreak, slateProps.rows, effectiveSportsbook],
  );

  // S3 — the Spotlights, derived from the same candidates the props board
  // holds rather than from `slate_rankings` (which turned out to hold the
  // Specials pilot set, not these). Deriving them here means a spotlight can
  // never disagree with the table underneath it.
  //
  // F0 adds two more sources of the same card, in the order a reader wants
  // them: the sport's OWN spotlights first (they are about today), then the
  // two universal ones, then N5's weather list. A sport with no rankings
  // written yet contributes nothing and the section is unchanged.
  const spotlights = useMemo(() => {
    const weather = weatherSpotlight(slateRead.data?.games?.cards ?? []);
    return [
      ...flagSpotlightCards(flagsRead.flags, { sport, league: league ?? null }),
      ...buildSpotlights(filteredBeforePriceGate, { sport, league: league ?? null }),
      ...(weather ? [weather] : []),
    ];
  }, [flagsRead.flags, filteredBeforePriceGate, slateRead.data, sport, league]);

  // S5 — Your lines, joined against the same candidates the board draws.
  const yourLines = useMemo(
    () =>
      signedIn
        ? toYourLines({
            sport,
            date: scanDate ?? easternDate(),
            candidates: filteredBeforePriceGate,
            bets: yourLineSources.bets,
            slip: slip.picks,
            tracked: yourLineSources.tracked,
            watchlist: slip.watchlist,
          })
        : null,
    [signedIn, sport, scanDate, filteredBeforePriceGate, yourLineSources.bets, yourLineSources.tracked, slip.picks, slip.watchlist],
  );

  const views = useMemo(() => {
    const comingUp = scanComingUp(narrowed, { maxDistance: 6, minSampleSize: 2 });
    const watchlist = sortByComingUp(narrowed.filter((c) => slip.watchedIds.has(c.subjectId)));
    // The whole filtered set, ordered by imminence. The table sorts it further.
    const all = sortByComingUp(narrowed);
    // C6: "live" — a game whose state is in progress, which the Slate already
    // reads (liveState.status === 'live'). The Home Runs board was deleted.
    const live = sortByComingUp(narrowed.filter((c) => c.liveState.status === 'live'));
    return { all, comingUp, watchlist, live };
  }, [narrowed, slip.watchedIds]);

  // Odds columns in the dense scan view need each subject's game.
  const slate = useMemo(() => {
    const games = ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ??
      []) as SlateEntry['game'][];
    return buildSlate(games, odds.result?.lines ?? []);
  }, [snapshot, odds.result]);

  // Real bookmakers from the player-prop feed (slateProps.rows) — this drives
  // Scan's own price resolution (resolveCandidateEdge), so it has to be the
  // same universe of books, not the separate game-line feed's bookmakers.
  const bookOptions = useMemo(() => {
    const names = new Set<string>();
    for (const row of slateProps.rows) names.add(row.bookmaker);
    return [
      { value: '', label: 'Best available' },
      ...[...names].sort().map((name) => ({ value: name, label: name })),
    ];
  }, [slateProps.rows]);

  // Market/Team option lists — hoisted out of the filter row's own JSX so
  // the sidebar layout (FilterSidebar) can share the exact same derivation
  // instead of recomputing it a second way.
  const marketOptions = useMemo(() => {
    const dims = new Map<string, string>();
    for (const c of candidates) {
      if (!dims.has(c.dimension)) dims.set(c.dimension, c.dimensionLabel);
    }
    return [...dims].map(([key, label]) => ({ value: key, label }));
  }, [candidates]);

  const teamOptions = useMemo(() => {
    const logos = new Map<string, string | undefined>();
    for (const c of candidates) {
      const meta = c.subjectMeta as Record<string, unknown> | undefined;
      const t = typeof meta?.team === 'string' ? meta.team : undefined;
      if (!t || logos.has(t)) continue;
      logos.set(t, typeof meta?.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined);
    }
    return [...logos.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, logoUrl]) => ({ value: t, label: t, icon: <TeamLogo logoUrl={logoUrl} size={16} /> }));
  }, [candidates]);

  // C6: position is a new filter (the plan's "Position (new)"), from each
  // candidate's own meta.position.
  const positionOptions = useMemo(() => {
    const positions = new Set<string>();
    for (const c of candidates) {
      const p = (c.subjectMeta as Record<string, unknown> | undefined)?.position;
      if (typeof p === 'string' && p) positions.add(p);
    }
    return [...positions].sort().map((p) => ({ value: p, label: p }));
  }, [candidates]);

  // C6: the board's one list — status narrows to upcoming/live, and the
  // watchlist toggle ANDs watched ids on top.
  const displayList = useMemo(() => {
    const base = filters.status === 'upcoming' ? views.comingUp : filters.status === 'live' ? views.live : views.all;
    return filters.watchlistOnly ? base.filter((c) => slip.watchedIds.has(c.subjectId)) : base;
  }, [filters.status, filters.watchlistOnly, views, slip.watchedIds]);

  // C6: the "Showing N of M" line's removable chips — one per active filter.
  const filterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = [];
    if (filters.gamePks.size > 0) chips.push({ key: 'games', label: `${filters.gamePks.size} game${filters.gamePks.size === 1 ? '' : 's'}`, clear: () => setGamePks(new Set()) });
    if (filters.dimensions.size > 0) chips.push({ key: 'markets', label: `${filters.dimensions.size} market${filters.dimensions.size === 1 ? '' : 's'}`, clear: () => filters.dimensions.forEach((d) => toggleDimension(d)) });
    if (filters.teams.size > 0) chips.push({ key: 'teams', label: `${filters.teams.size} team${filters.teams.size === 1 ? '' : 's'}`, clear: () => filters.teams.forEach((t) => toggleTeam(t)) });
    if (filters.positions.size > 0) chips.push({ key: 'positions', label: `${filters.positions.size} position${filters.positions.size === 1 ? '' : 's'}`, clear: () => setPositions(new Set()) });
    if (filters.hitRateMin !== null) chips.push({ key: 'hitrate', label: `Hit rate ≥ ${filters.hitRateMin}%`, clear: () => setHitRateMin(null) });
    if (filters.oddsMin !== null || filters.oddsMax !== null || !filters.showNoOdds) chips.push({ key: 'odds', label: `Odds ${filters.oddsMin ?? '−∞'} to ${filters.oddsMax ?? '+∞'}`, clear: () => { setOddsRange(null, null); if (!filters.showNoOdds) toggleShowNoOdds(); } });
    if (filters.hotStreak || filters.coldStreak || filters.consistentOnly) {
      const parts = [filters.hotStreak ? 'Hot' : null, filters.coldStreak ? 'Cold' : null, filters.consistentOnly ? 'Consistent' : null].filter(Boolean);
      chips.push({ key: 'streak', label: parts.join(' / '), clear: () => { if (filters.hotStreak) toggleHotStreak(); if (filters.coldStreak) toggleColdStreak(); if (filters.consistentOnly) toggleConsistentOnly(); } });
    }
    if (filters.sportsbook) chips.push({ key: 'book', label: filters.sportsbook, clear: () => setSportsbook(null) });
    if (filters.playerSearch.trim()) chips.push({ key: 'search', label: `"${filters.playerSearch.trim()}"`, clear: () => setPlayerSearch('') });
    return chips;
  }, [filters, setGamePks, toggleDimension, toggleTeam, setPositions, setHitRateMin, setOddsRange, toggleShowNoOdds, toggleHotStreak, toggleColdStreak, toggleConsistentOnly, setSportsbook, setPlayerSearch]);

  const eventContext = snapshot ? [snapshot.eventName, snapshot.eventDetail].filter(Boolean).join(' · ') : null;

  // ESPN doesn't publish tee times/pairings until close to the event — until
  // it does, `event.golfers` (adapter.ts) is empty, so `subjects` is empty
  // too. That's a real, temporary state (not a filter producing zero rows),
  // so Scan/Players get their own notice instead of a generic "no results".
  const golfFieldPending = sport === 'golf' && snapshot != null && snapshot.status === 'pre' && (snapshot.subjects?.length ?? 0) === 0;

  // One lookup shared by the table and the cards, memoized on the fetched map
  // so `rows` inside ScanTable is not invalidated on every render.
  const projectionForCandidate = useMemo(
    () => (c: PickCandidate) => projections.byKey.get(projectionKey(c.subjectId, c.dimension)) ?? null,
    [projections.byKey],
  );

  const renderList = (list: PickCandidate[], emptyMessage: string, defaultSortColumn?: ScanTableProps['defaultSortColumn']) => {
    if (dataLoading && list.length === 0) {
      return dense ? <ScanTableSkeleton /> : <ScanListSkeleton />;
    }
    if (dense) {
      return (
        <ScanTable
          sport={sport}
          candidates={list}
          pickedKeys={slip.pickedKeys}
          watchedIds={slip.watchedIds}
          onAdd={(c, odds) => slip.addPick(c, eventContext, odds)}
          onToggleWatch={slip.toggleWatch}
          loading={dataLoading}
          emptyMessage={emptyMessage || 'No candidates match these filters.'}
          propRows={slateProps.rows}
          scanExtras={scanExtras.data}
          userSportsbook={effectiveSportsbook}
          trustedMarkets={calibration.trustedMarkets}
          trustTiers={calibration.trustTiers}
          defaultSortColumn={defaultSortColumn}
          projectionFor={projectionForCandidate}
        />
      );
    }
    if (list.length === 0) {
      return emptyMessage ? <p className="p-8 text-center text-sm text-ink-muted">{emptyMessage}</p> : null;
    }
    const visible = showAllCards ? list : list.slice(0, CARD_PAGE_SIZE);
    return (
      <div className="space-y-2.5">
        {visible.map((candidate) => (
          <ScanCard
            key={candidateKey(candidate)}
            candidate={candidate}
            form={readForm(candidate)}
            added={slip.pickedKeys.has(candidateKey(candidate))}
            watched={slip.watchedIds.has(candidate.subjectId)}
            onAdd={(c, odds) => slip.addPick(c, eventContext, odds)}
            onToggleWatch={slip.toggleWatch}
            propRows={slateProps.rows}
            userSportsbook={effectiveSportsbook}
            trustTiers={calibration.trustTiers}
          />
        ))}
        {!showAllCards && list.length > CARD_PAGE_SIZE ? (
          <div className="p-2 text-center">
            <button
              type="button"
              onClick={() => setShowAllCards(true)}
              className="text-[12px] font-medium text-masters hover:underline"
            >
              Show {list.length - CARD_PAGE_SIZE} more
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  // C6: the eight filter pills — shared by the inline row (fullWidth=false)
  // and the <640 sheet (fullWidth=true).
  const filterPills = (fullWidth: boolean) => (
    <>
      <FilterDropdown icon={<PeopleIcon size={15} />} label="Games" badge={filters.gamePks.size > 0 ? filters.gamePks.size : undefined} active={filters.gamePks.size > 0} fullWidth={fullWidth}>
        <CheckboxList
          options={games.map((g) => ({
            value: String(g.gamePk ?? ''),
            label: <GameMatchupLabel label={g.matchup ?? ''} awayTeamId={g.awayTeamId} homeTeamId={g.homeTeamId} />,
          }))}
          selected={new Set([...filters.gamePks].map(String))}
          onToggle={(v) => toggleGame(Number(v))}
          onClear={() => setGamePks(new Set())}
        />
      </FilterDropdown>
      <FilterDropdown icon={<BarsIcon size={15} />} label="Market" badge={filters.dimensions.size > 0 ? filters.dimensions.size : undefined} active={filters.dimensions.size > 0} fullWidth={fullWidth}>
        <CheckboxList options={marketOptions} selected={filters.dimensions} onToggle={toggleDimension} onClear={() => filters.dimensions.forEach((d) => toggleDimension(d))} />
      </FilterDropdown>
      <FilterDropdown icon={<ShieldIcon size={15} />} label="Team" badge={filters.teams.size > 0 ? filters.teams.size : undefined} active={filters.teams.size > 0} fullWidth={fullWidth}>
        <CheckboxList options={teamOptions} selected={filters.teams} onToggle={toggleTeam} onClear={() => filters.teams.forEach((t) => toggleTeam(t))} />
      </FilterDropdown>
      <FilterDropdown icon={<PositionIcon size={15} />} label="Position" badge={filters.positions.size > 0 ? filters.positions.size : undefined} active={filters.positions.size > 0} fullWidth={fullWidth}>
        <CheckboxList options={positionOptions} selected={filters.positions} onToggle={togglePosition} onClear={() => setPositions(new Set())} />
      </FilterDropdown>
      <FilterDropdown icon={<TargetIcon size={15} />} label="Hit rate" badge={filters.hitRateMin != null ? `≥${filters.hitRateMin}%` : undefined} active={filters.hitRateMin != null} fullWidth={fullWidth}>
        <HitRatePicker value={filters.hitRateMin} onChange={setHitRateMin} />
      </FilterDropdown>
      <FilterDropdown icon={<SlidersIcon size={15} />} label="Odds" badge={filters.oddsMin !== null || filters.oddsMax !== null ? `${filters.oddsMin ?? '−∞'} to ${filters.oddsMax ?? '+∞'}` : undefined} active={filters.oddsMin !== null || filters.oddsMax !== null || !filters.showNoOdds} fullWidth={fullWidth}>
        <FilterOddsRangeInputs min={filters.oddsMin} max={filters.oddsMax} onChange={setOddsRange} />
        <div className="mt-1 border-t border-line pt-1">
          <BooleanCheckboxRow label="Show players with no odds" checked={filters.showNoOdds} onChange={toggleShowNoOdds} />
        </div>
      </FilterDropdown>
      <FilterDropdown icon={<FlameIcon size={15} />} label="Streak" badge={[filters.hotStreak, filters.coldStreak, filters.consistentOnly].filter(Boolean).length || undefined} active={filters.hotStreak || filters.coldStreak || filters.consistentOnly} fullWidth={fullWidth}>
        <div className="space-y-0.5">
          <BooleanCheckboxRow label="Hot streak" checked={filters.hotStreak} onChange={toggleHotStreak} icon={<FlameIcon size={14} className="text-ink-muted" />} />
          <BooleanCheckboxRow label="Cold streak" checked={filters.coldStreak} onChange={toggleColdStreak} icon={<SnowflakeIcon size={14} className="text-ink-muted" />} />
          <BooleanCheckboxRow label="Consistent" checked={filters.consistentOnly} onChange={toggleConsistentOnly} icon={<CheckCircleIcon size={14} className="text-ink-muted" />} />
        </div>
      </FilterDropdown>
      {hasPropsPipeline && bookOptions.length > 1 ? (
        <FilterSelect label="Book" value={filters.sportsbook ?? ''} onChange={(value) => setSportsbook(value || null)} options={bookOptions} />
      ) : null}
    </>
  );

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <TopBar
          sport={sport}
          league={league}
          onLeagueChange={(next) => router.push(sport === 'tennis' ? `/tennis/${next}` : `/soccer/${next}`)}
          tab={tab}
          onTabChange={handleTabChange}
          pendingTab={pendingTab}
          slipCount={slip.picks.length}
          onOpenSlip={() => setSlipOpen(true)}
          onOpenSearch={() => setFilterOpen(true)}
          onRefresh={refresh}
          loading={loading}
          lastFetched={lastFetched}
        />

        {/* Redesign Brief — date controls and the day's game chips merged into
            one scrollable row (previously two separate bars). Odds/lineups
            thin out the further out you preview (most books don't post until
            close to game day); the honest "no price yet" states already used
            throughout Scan cover that rather than needing special-case copy
            here. */}
        {sport === 'mlb' || sport === 'nfl' || sport === 'cfb' || sport === 'nba' || sport === 'nhl' ? (
          <DateGameStrip
            scanDate={scanDate}
            onSetDate={setScanDate}
            games={games}
            selectedGamePk={selectedGamePk}
            onSelectGame={selectGame}
            onNavigateToGame={(gamePk) => router.push(`/${sport}/game/${gamePk}`)}
            // CFB's logo URLs are keyed by ESPN's numeric team id, not
            // abbreviation (unlike NFL's predictable `{abbr}.png` CDN
            // pattern), so there's no synchronous abbr->url template to
            // hand this prop — DateGameStrip's own text-chip fallback
            // covers it, same as MLB's existing `undefined` here.
            logoFor={sport === 'nfl' ? nflTeamLogoUrl : undefined}
          />
        ) : null}
        {sport === 'golf' ? (
          <GolferStrip
            subjects={snapshot?.subjects ?? []}
            selectedPlayerId={selectedSubjects.size === 1 ? [...selectedSubjects][0] : null}
            onSelectPlayer={(id) => setSelectedSubjects(id === null ? new Set() : new Set([id]))}
            onNavigateToPlayer={(id) => router.push(`/golf/player/${id}`)}
          />
        ) : null}
      </header>

      <main className="px-4 py-3 [--lb-gutter:16px]">
        {error ? (
          <div className="lb-card mb-3 border-bad/30 bg-bad/5 p-3 text-sm text-bad">
            {error}
          </div>
        ) : null}

        {/* Real "season hasn't started yet" state — a sport can have real
            pre-season props posted (candidates.length > 0) well before a
            single game has actually been played, so this is a distinct
            signal from an empty Scan table, not implied by one. Only a
            sport whose adapter actually computed `seasonStatus` shows this
            (see lib/core/types.ts's own doc comment) — mid-season sports
            simply never set the field. */}
        {snapshot?.seasonStatus && !snapshot.seasonStatus.started ? (
          <div className="lb-card mb-3 flex items-center gap-3 border-line bg-accent-soft/30 p-3">
            <img src="/brand/linesmith-mark.png" alt="" width={28} height={18} className="h-[22px] w-auto shrink-0 select-none" />
            <div className="min-w-0 text-[13px]">
              <p className="font-semibold text-ink">
                {snapshot.seasonStatus.label ?? `The ${SPORT_LABEL[sport]} season hasn't started yet`}
              </p>
              <p className="text-ink-muted">
                {snapshot.seasonStatus.nextGameDate
                  ? `First real game: ${new Date(snapshot.seasonStatus.nextGameDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}. `
                  : null}
                Any props below are real pre-season lines — check back once games are underway for live form.
              </p>
            </div>
          </div>
        ) : null}

        {/* Collapsed by default — a long roster (NFL's ~1,700 leaguewide
            skill players vs. crosswalk gaps for rookies/practice-squad
            names) can produce dozens of these, and a permanently-open wall
            of text above the actual page content was worse than the
            warnings themselves. Data-integrity detail, not something that
            needs to greet every visit. */}
        {snapshot?.warnings?.length ? (
          <details className="lb-card mb-3 border-warn/30 bg-warn/5 text-xs text-warn">
            <summary className="cursor-pointer select-none px-3 py-2 font-medium">
              {snapshot.warnings.length} data warning{snapshot.warnings.length === 1 ? '' : 's'}
            </summary>
            <div className="space-y-1 px-3 pb-3">
              {snapshot.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          </details>
        ) : null}

        {tab === 'Slate' ? (
          <>
            {/* Golf's props-board mode: Hole Props or Round Score. Since S1 the
                winner prices are their own section above, so this is two
                options rather than three. */}
            {sport === 'golf' ? (
              <div className="mb-2 flex items-center justify-end">
                <GolfScanModeToggle mode={golfScanMode} onChange={setGolfScanMode} />
              </div>
            ) : null}

            {/* S1 — THE SLATE. Scan's body is now sections: the sticky nav, the
                Games section, and the props board below it. What used to be a
                Players/Games TOGGLE is gone (D1): games are always a section,
                not a view you had to leave the table to see. `GameLinesView`
                and `GameLine` went with it. */}
            <SlateSectionNav
              sections={slateSections(
                slateRead.data,
                views.all.length || null,
                (marketRead.data?.outliers.length ?? 0) + (marketRead.data?.disagreements.length ?? 0) + slateOddsById.size || null,
                spotlights.reduce((n, c) => n + c.rows.length, 0) || null,
                specialsRead.data?.rankings.length || null,
                modelRead.data?.rows.length || null,
                yourLines?.length || trackedAlerts.alerts.length || null,
                moversShown(moversRead.data) + (slateOdds.data?.games.some((g) => g.books > 0) ? 1 : 0) || null,
              )}
            />

            {/* P9: the Slate's odds refresh every 60 s; their live memory animates the game cards and Movers. */}
            <LiveProvider value={slateOdds.live}>
            {sport === 'golf' ? (
              <section id="slate-games" className="mb-6 scroll-mt-[150px]">
                <SectionBand title="Winner prices" />
                <TournamentLinesView
                  lines={golfLines.result?.lines ?? []}
                  subjects={snapshot?.subjects ?? []}
                  eventName={golfLines.result?.eventName ?? null}
                  loading={golfLines.loading}
                  warnings={golfLines.result?.warnings ?? []}
                />
              </section>
            ) : (
              <SlateGames data={slateRead.data} loading={slateRead.loading} odds={slateOddsById} edges={slateEdges?.edges} />
            )}

            <SlateMovers data={moversRead.data} loading={moversRead.loading} sport={sport} odds={slateOdds.data?.games} refs={slateRefs} />

            {/* Golf has no prop-market cards: its winner prices are cached,
                not stored per book, so there is no book-by-book spread to
                compare (slate-sheet-cards.md §4.8). */}
            {sport === 'golf' ? null : <SlateMarket data={marketRead.data} loading={marketRead.loading} sport={sport} teamLogoBySubject={teamLogoBySubject} odds={slateOdds.data?.games} refs={slateRefs} edges={slateEdges?.edges} />}
            </LiveProvider>

            <SlateSpotlights cards={spotlights} loading={loading && filteredBeforePriceGate.length === 0} />

            <SlateSpecials data={specialsRead.data} loading={specialsRead.loading} sport={sport} />

            {slateRead.data?.modelPicks ? (
              <SlateModel data={modelRead.data} note={slateRead.data.modelPicks.note} loading={modelRead.loading} />
            ) : null}

            <SlateYourLines rows={yourLines} signedIn={signedIn} />

            {golfFieldPending ? (
              <TournamentNotStartedNotice eventName={snapshot?.eventName} />
            ) : (
              <div className="flex items-start gap-4">
                {/* Redesign Brief — sidebar layout: the same filter state as the
                    button row below, just relocated. The brief's own mockup sidebar
                    has no Games section; added here anyway so switching to sidebar
                    layout doesn't silently drop the ability to filter by game. */}
                {sidebarLayout ? (
                  <FilterSidebar
                    games={games}
                    gamePks={filters.gamePks}
                    onToggleGame={toggleGame}
                    onClearGames={() => setGamePks(new Set())}
                    marketOptions={marketOptions}
                    dimensions={filters.dimensions}
                    onToggleDimension={toggleDimension}
                    onClearDimensions={() => filters.dimensions.forEach((d) => toggleDimension(d))}
                    teamOptions={teamOptions}
                    teams={filters.teams}
                    onToggleTeam={toggleTeam}
                    onClearTeams={() => filters.teams.forEach((t) => toggleTeam(t))}
                    bookOptions={hasPropsPipeline ? bookOptions : undefined}
                    sportsbook={filters.sportsbook}
                    onSetSportsbook={setSportsbook}
                    hitRateMin={filters.hitRateMin}
                    onSetHitRateMin={setHitRateMin}
                    hotStreak={filters.hotStreak}
                    coldStreak={filters.coldStreak}
                    consistentOnly={filters.consistentOnly}
                    onToggleHotStreak={toggleHotStreak}
                    onToggleColdStreak={toggleColdStreak}
                    onToggleConsistentOnly={toggleConsistentOnly}
                    oddsMin={filters.oddsMin}
                    oddsMax={filters.oddsMax}
                    onSetOddsRange={setOddsRange}
                    showNoOdds={filters.showNoOdds}
                    onToggleShowNoOdds={toggleShowNoOdds}
                  />
                ) : null}

                <div id="slate-props" className="min-w-0 flex-1 scroll-mt-[150px]">
                  <SectionBand title="Props" />
                  {/* C6: the four view tabs are now a status control and a
                      watchlist toggle; the counts moved to the "Showing" line. */}
                  <div className="mb-3 mt-3 flex flex-wrap items-center gap-2">
                    <FilterSearchBox value={filters.playerSearch} onChange={setPlayerSearch} />
                    <SegmentedToggle
                      label="Props status"
                      size="sm"
                      value={filters.status}
                      onChange={setStatus}
                      options={[
                        { value: 'all', label: 'All' },
                        { value: 'upcoming', label: 'Upcoming' },
                        { value: 'live', label: 'Live' },
                      ]}
                    />
                    <Toggle isSelected={filters.watchlistOnly} onChange={toggleWatchlistOnly}>
                      Watchlist
                    </Toggle>
                    <div className="flex-1" />
                    <DensityToggle dense={dense} onChange={setDense} />
                    <OverflowMenu active={selectedSubjects.size > 0 || filters.sportsbook != null}>
                      <Button variant="tertiary" size="sm" onPress={() => setFilterOpen(true)} className="w-full justify-between">
                        Players
                        <span className="text-ink-muted">{selectedSubjects.size > 0 ? selectedSubjects.size : 'All'}</span>
                      </Button>
                      {filtersActive(filters) ? (
                        <Button variant="tertiary" size="sm" onPress={clearAll} className="w-full">
                          Clear all filters
                        </Button>
                      ) : null}
                    </OverflowMenu>
                    <IconToggleButton
                      icon={<SidebarIcon size={16} />}
                      label="Toggle filter sidebar"
                      active={sidebarLayout}
                      onClick={() => setSidebarLayout(!sidebarLayout)}
                    />
                  </div>

                  {/* Filter button row — only in the default (non-sidebar) layout.
                      Desktop/tablet show the row inline; <640 folds it into a
                      slideout behind a "Filters (n)" button. */}
                  {!sidebarLayout ? (
                    <>
                      <div className="max-sm:hidden">
                        <FilterBar>{filterPills(false)}</FilterBar>
                      </div>
                      <div className="sm:hidden">
                        <Button variant="secondary" size="sm" icon={<SlidersIcon size={15} />} onPress={() => setFiltersOpen(true)}>
                          Filters{activeFilterCount(filters) > 0 ? ` (${activeFilterCount(filters)})` : ''}
                        </Button>
                        <SlideoutMenu
                          isOpen={filtersOpen}
                          onClose={() => setFiltersOpen(false)}
                          title="Filters"
                          footer={
                            <div className="flex items-center gap-2">
                              <Button variant="tertiary" size="sm" onPress={clearAll} className="flex-1">
                                Reset
                              </Button>
                              <Button variant="secondary" size="sm" onPress={() => setFiltersOpen(false)} className="flex-1">
                                Show {displayList.length} props
                              </Button>
                            </div>
                          }
                        >
                          <div className="flex flex-col gap-2">{filterPills(true)}</div>
                        </SlideoutMenu>
                      </div>
                    </>
                  ) : null}

                  {/* C6: the four tab counts became one line; active filters
                      are removable chips with a Clear all. */}
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-label text-ink-muted">
                    <span>
                      Showing <span className="font-semibold text-ink tabular-nums">{displayList.length}</span> of{' '}
                      <span className="tabular-nums">{views.all.length}</span>
                    </span>
                    {filterChips.map((c) => (
                      <Chip key={c.key} size="sm" onClick={c.clear} title={`Remove ${c.label}`}>
                        {c.label} ×
                      </Chip>
                    ))}
                    {filterChips.length > 0 ? (
                      <Button variant="tertiary" size="sm" onPress={clearAll}>
                        Clear all
                      </Button>
                    ) : null}
                  </div>

                  {renderList(
                    displayList,
                    filters.watchlistOnly
                      ? 'Star a player on any card to follow them here.'
                      : filters.status === 'upcoming'
                        ? 'Nothing is live and imminent right now. Check All for the whole slate.'
                        : filters.status === 'live'
                          ? 'No games are live right now.'
                          : 'No candidates match these filters.',
                  )}
                </div>
              </div>
            )}
          </>
        ) : null}

        {tab === 'Players' ? (
          golfFieldPending ? (
            <TournamentNotStartedNotice eventName={snapshot?.eventName} />
          ) : snapshot ? (
            <PlayerDetailPanel
              league={league}
              sport={sport}
              snapshot={snapshot}
              candidates={candidates}
              odds={odds.result}
              onAdd={(c, odds) => slip.addPick(c, eventContext, odds)}
              addedKeys={slip.pickedKeys}
              loading={loading}
            />
          ) : (
            <PlayerSkeleton />
          )
        ) : null}

      </main>

      <SlipModal
        sport={sport}
        picks={slip.picks}
        candidates={candidates}
        subjects={snapshot?.subjects ?? []}
        open={slipOpen}
        onClose={() => setSlipOpen(false)}
        onRemove={slip.removePick}
        onClear={slip.clearSlip}
        onSetOdds={slip.setOdds}
        onAdd={(c, odds) => slip.addPick(c, eventContext, odds)}
        onSubmit={slip.submitPicks}
        userBook={effectiveSportsbook}
      />

      <PlayerFilterDrawer
        subjects={snapshot?.subjects ?? []}
        selected={selectedSubjects}
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        onToggle={(id) =>
          setSelectedSubjects((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onSetAll={(ids) => setSelectedSubjects(new Set(ids))}
      />
    </div>
  );
}

export default AppShell;
