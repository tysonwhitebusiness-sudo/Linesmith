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
import { useMarketCalibration } from './useMarketCalibration';
import { useGamePickHistory } from './useGamePickRecord';
import { TodaysPicksButton } from './TodaysPicksModal';
import { isGoodBet, candidateGoodBetSignals } from '@/lib/odds/goodBets';
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
import {
  DensityToggle,
  ScanScopeToggle,
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
} from './FilterBar';
import { FilterSidebar } from './FilterSidebar';
import { PeopleIcon, BarsIcon, ShieldIcon, TargetIcon, SlidersIcon, FlameIcon, SidebarIcon, BookIcon, SnowflakeIcon, CheckCircleIcon } from './icons';
import { GameLinesView } from './GameLinesView';
import { useGolfLines } from './useGolfLines';
import { TournamentLinesView } from './TournamentLinesView';
import { TournamentNotStartedNotice } from './TournamentNotStartedNotice';
import { TeamLogo, GameMatchupLabel, nflTeamLogoUrl } from './SubjectAvatar';
import { buildSlate, type SlateEntry, type SlateGame } from '@/lib/odds/matching';
import { useFilters, applyFilters, filtersActive, activeFilterCount } from './useFilters';
import { easternDate, shiftDate } from '@/lib/sports/mlb/statsapi';

/**
 * "All" leads because the table is meant to be swept.
 *
 * "Coming up" is empty by definition until first pitch, so opening on it meant
 * arriving at an empty screen for most of the day — the table has to actually
 * have the slate in it to be worth defaulting to.
 *
 * "Good Bets" now leads instead — the Good Bets engine (edge + calibration
 * trust + price ceiling, lib/odds/goodBets.ts) is the app's actual selling
 * point, so the app should open on it rather than making it one tab among
 * several.
 *
 * Consistent and Hot/Cold used to be separate tabs here; they're now filter
 * toggles instead (Hot Streak / Cold Streak / Consistent, in the filter bar)
 * so they narrow whichever tab you're already on rather than replacing it.
 *
 * "Home Runs" (Home Run model plan, Phase 7) — the standalone home-run
 * model's daily rankings, sorted by its own modelProb. Same underline-tab
 * pattern as every other entry here, not a separate page: one more
 * filter+sort added to `views` below, rendered through the same
 * renderList/ScanTable machinery.
 */
const SCAN_VIEWS = ['Good Bets', 'All', 'Coming up', 'Watchlist', 'Home Runs'] as const;
type ScanView = (typeof SCAN_VIEWS)[number];

const LAST_SPORT_KEY = 'linesmith:last-sport';
const DENSE_KEY = 'linesmith:dense';

/**
 * Top-of-Scan record — the Linesmith Pick lock system's real, forward-only
 * record (see components/useGamePickRecord.ts): moneyline and O/U tracked
 * separately, since a strong week on one market shouldn't hide a bad one on
 * the other. Starts empty and grows from the day this system launched —
 * intentionally not backfilled from the old edge-gated Good Bets record,
 * which graded a different, retroactive question.
 */
function RecordChip({ label, wins, losses }: { label: string; wins: number; losses: number }) {
  const total = wins + losses;
  const winRate = total > 0 ? (wins / total) * 100 : null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 text-[11px]"
      title={`${label} picks locked 3 hours before first pitch, graded once final.`}
    >
      <span className="font-medium text-ink-faint">{label}</span>
      {total > 0 ? (
        <>
          <span className="font-semibold tabular-nums text-ink">
            {wins}-{losses}
          </span>
          {winRate != null ? <span className="text-ink-faint">({winRate.toFixed(1)}%)</span> : null}
        </>
      ) : (
        <span className="text-ink-faint">no graded picks yet</span>
      )}
    </span>
  );
}

function LinesmithRecordBar({ record }: { record: { moneyline: { wins: number; losses: number }; total: { wins: number; losses: number } } | null }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <RecordChip label="ML" wins={record?.moneyline.wins ?? 0} losses={record?.moneyline.losses ?? 0} />
      <RecordChip label="O/U" wins={record?.total.wins ?? 0} losses={record?.total.losses ?? 0} />
    </div>
  );
}

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
  const slateProps = useSlatePropOdds(snapshot?.fetchedAt ?? null, hasPropsPipeline);
  // Scan's price gate (below) depends on slateProps having actually
  // resolved — without this, the gate would read an empty rows array as
  // "nothing has real odds" and flash an empty Scan table on every load.
  const dataLoading = loading || (hasPropsPipeline && slateProps.loading);

  // Lets the Teams pages' tab row link straight back to Players (not just
  // Scan) without Teams needing to live inside this component's own state.
  const [tab, setTab] = useState<Tab>(() => (searchParams.get('tab') === 'Players' ? 'Players' : 'Scan'));
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
  // NFL/soccer default to All rather than Good Bets — the Good Bets scoring
  // engine needs graded-outcome data to calibrate a threshold against, which
  // a brand-new sport doesn't have yet (same reasoning as hiding it below).
  const [scanView, setScanView] = useState<ScanView>(() => (sport === 'nfl' || sport === 'soccer' || sport === 'cfb' || sport === 'nba' || sport === 'nhl' || sport === 'tennis' ? 'All' : 'Good Bets'));
  const calibration = useMarketCalibration();
  const gamePickHistory = useGamePickHistory(sport);
  const [scanScope, setScanScope] = useState<'players' | 'games'>('players');
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
  const golfScanMode: 'holes' | 'rounds' | 'match-winner' =
    scanScope === 'games' ? 'match-winner' : golfMarketView;
  const setGolfScanMode = (mode: 'holes' | 'rounds' | 'match-winner') => {
    if (mode === 'match-winner') {
      setScanScope('games');
    } else {
      setScanScope('players');
      setGolfMarketView(mode);
    }
  };
  const [slipOpen, setSlipOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
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
    toggleGoodBetOnly,
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
    setScanView('All');
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
    // Home Runs is hidden from golf's tab row, Good Bets + Home Runs both
    // hidden from NFL's (see SCAN_VIEWS.filter below) — if one was active,
    // switching sports shouldn't land on a tab that no longer has a button.
    setScanView((v) => {
      if (sport === 'golf' && v === 'Home Runs') return 'Good Bets';
      if ((sport === 'nfl' || sport === 'soccer' || sport === 'cfb' || sport === 'nba' || sport === 'nhl' || sport === 'tennis') && (v === 'Home Runs' || v === 'Good Bets')) return 'All';
      return v;
    });
  }, [sport, clearAll]);

  const candidates = useMemo(() => {
    const base = snapshot?.candidates ?? [];
    if (sport !== 'golf') return base;
    return base.filter((c) => (golfMarketView === 'rounds' ? c.dimension === 'round-score' : c.dimension !== 'round-score'));
  }, [snapshot, sport, golfMarketView]);

  // Extract today's games from the snapshot for the Games strip.
  const games: SlateGame[] = useMemo(() => {
    return ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ??
      []) as SlateGame[];
  }, [snapshot]);

  // Base filtering shared by every tab, deliberately stopping short of the
  // price-existence check below — Good Bets (views.goodBets) builds from
  // this directly so a candidate with no posted price yet can still qualify
  // there, flagged rather than silently dropped (see ScanTable's Odds
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

  const isCandidateGoodBet = (c: PickCandidate) => {
    const info = resolveCandidateEdge(c, slateProps.rows, effectiveSportsbook);
    return isGoodBet(
      {
        edge: info.edge,
        marketProb: info.marketProb,
        sampleSize: c.sampleSize,
        dimension: c.dimension,
        priceAmerican: info.price,
        ...candidateGoodBetSignals(c),
      },
      calibration.trustedMarkets,
    );
  };

  // Odds range + hot/cold streak narrowing, factored out so Good Bets can
  // apply the same lenses starting from `filteredBeforePriceGate` instead of
  // `filtered` — everywhere else goes through the price-existence gate first,
  // Good Bets deliberately doesn't. Not memoized itself (cheap array filters,
  // and memoizing a function value here would just move the dependency-array
  // bookkeeping without saving real work).
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
  const narrowed = useMemo(() => {
    let result = narrowByOddsAndStreak(filtered);
    if (filters.goodBetOnly) {
      result = result.filter(isCandidateGoodBet);
    }
    return result;
  }, [filtered, filters.oddsMin, filters.oddsMax, filters.showNoOdds, filters.hotStreak, filters.coldStreak, filters.goodBetOnly, slateProps.rows, effectiveSportsbook, calibration.trustedMarkets]);

  const views = useMemo(() => {
    const comingUp = scanComingUp(narrowed, { maxDistance: 6, minSampleSize: 2 });
    const watchlist = sortByComingUp(narrowed.filter((c) => slip.watchedIds.has(c.subjectId)));
    // The whole filtered set, ordered by imminence. The table sorts it further.
    const all = sortByComingUp(narrowed);
    // The Good Bets engine (lib/odds/goodBets.ts) — same edge/price/calibration
    // resolution ScanTable's own Edge column uses, reused rather than
    // recomputed, so a candidate shown here always agrees with its own row.
    // Built from `filteredBeforePriceGate`, not `narrowed`/`filtered` — a
    // candidate with no posted price yet can still qualify on performance or
    // matchup alone; ScanTable's Odds column flags the gap instead of this
    // silently dropping it.
    const goodBets = sortByComingUp(narrowByOddsAndStreak(filteredBeforePriceGate).filter(isCandidateGoodBet));
    // Home Run model plan, Phase 7 — the standalone model's daily board,
    // ranked by its own modelProb (whichever source populated it: the fitted
    // home-run model when active, the plain Beta-Binomial baseline
    // otherwise — see adapter.ts's Phase 6 wiring). Built from
    // `filteredBeforePriceGate` like Good Bets: a batter with no posted price
    // yet still belongs on a rankings board, unlike a market-dependent view.
    const homeRuns = filteredBeforePriceGate
      .filter((c) => c.dimension === 'home-runs')
      .map((c) => ({ candidate: c, prob: (c.subjectMeta as Record<string, unknown> | undefined)?.modelProb }))
      .filter((r): r is { candidate: PickCandidate; prob: number } => typeof r.prob === 'number')
      .sort((a, b) => b.prob - a.prob)
      .map((r) => r.candidate);
    return { all, comingUp, watchlist, goodBets, homeRuns };
  }, [narrowed, filteredBeforePriceGate, slip.watchedIds, filters.oddsMin, filters.oddsMax, filters.showNoOdds, filters.hotStreak, filters.coldStreak, slateProps.rows, effectiveSportsbook, calibration.trustedMarkets]);

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

  const eventContext = snapshot ? [snapshot.eventName, snapshot.eventDetail].filter(Boolean).join(' · ') : null;

  // ESPN doesn't publish tee times/pairings until close to the event — until
  // it does, `event.golfers` (adapter.ts) is empty, so `subjects` is empty
  // too. That's a real, temporary state (not a filter producing zero rows),
  // so Scan/Players get their own notice instead of a generic "no results".
  const golfFieldPending = sport === 'golf' && snapshot != null && snapshot.status === 'pre' && (snapshot.subjects?.length ?? 0) === 0;

  const renderList = (list: PickCandidate[], emptyMessage: string, showReasons = false, defaultSortColumn?: ScanTableProps['defaultSortColumn']) => {
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
          userSportsbook={effectiveSportsbook}
          trustedMarkets={calibration.trustedMarkets}
          showReasons={showReasons}
          trustTiers={calibration.trustTiers}
          defaultSortColumn={defaultSortColumn}
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

      <main className="px-4 py-3">
        {error ? (
          <div className="lb-card mb-3 border-bad/30 bg-bad/5 p-3 text-sm text-bad">
            {error}
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

        {tab === 'Scan' ? (
          <>
            {hasPropsPipeline ? (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <TodaysPicksButton sport={sport} date={easternDate()} />
                <LinesmithRecordBar record={gamePickHistory.record} />
              </div>
            ) : null}

            {/* Golf's one Scan-mode switch — rendered once, above the games/players
                branch below, so it stays visible and in the same spot no matter
                which mode is active (it's what drives scanScope in the first
                place for golf, so it can't live inside a branch scanScope gates). */}
            {sport === 'golf' ? (
              <div className="mb-2 flex items-center justify-end">
                <GolfScanModeToggle mode={golfScanMode} onChange={setGolfScanMode} />
              </div>
            ) : null}

            {scanScope === 'games' ? (
              <>
                {sport === 'golf' ? null : (
                  <div className="mb-2 flex items-center justify-end">
                    <ScanScopeToggle scope={scanScope} onChange={setScanScope} />
                  </div>
                )}
                {sport === 'golf' ? (
                  <TournamentLinesView
                    lines={golfLines.result?.lines ?? []}
                    subjects={snapshot?.subjects ?? []}
                    eventName={golfLines.result?.eventName ?? null}
                    loading={golfLines.loading}
                    warnings={golfLines.result?.warnings ?? []}
                  />
                ) : (
                  <GameLinesView
                    entries={slate.entries}
                    onNavigate={(gamePk) =>
                      router.push(sport === 'soccer' || sport === 'tennis' ? `/${sport}/${league}/game/${gamePk}` : `/${sport}/game/${gamePk}`)
                    }
                  />
                )}
              </>
            ) : golfFieldPending ? (
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

                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center justify-between gap-3 border-b border-line">
                    <div className="lb-scroll-x flex items-center gap-6">
                      {/* Home Runs is the standalone home-run model's board — an
                          MLB-only dimension (candidateGoodBetSignals never
                          produces one for golf), so the tab is hidden for golf
                          rather than opening onto a permanently-empty list.
                          Good Bets is hidden for NFL too — its scoring engine
                          has no calibrated threshold for a sport with no
                          graded history yet (see scanView default above). */}
                      {SCAN_VIEWS.filter((v) => {
                        if (sport === 'golf') return v !== 'Home Runs';
                        if (sport === 'nfl' || sport === 'soccer' || sport === 'cfb' || sport === 'nba' || sport === 'nhl' || sport === 'tennis') return v !== 'Home Runs' && v !== 'Good Bets';
                        return true;
                      }).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setScanView(v)}
                          aria-current={v === scanView ? 'page' : undefined}
                          className={`relative shrink-0 whitespace-nowrap px-1 pb-3 pt-2 text-[14px] transition-colors ${
                            v === scanView
                              ? 'font-semibold text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:rounded-full after:bg-masters'
                              : 'text-ink-muted hover:text-ink'
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 pb-2">
                      {sport === 'golf' ? null : <ScanScopeToggle scope={scanScope} onChange={setScanScope} />}
                    </div>
                  </div>

                  {/* Controls row — search, card/list view, overflow menu, sidebar toggle. */}
                  <div className="mb-3 mt-3 flex items-center gap-2">
                    <FilterSearchBox value={filters.playerSearch} onChange={setPlayerSearch} />
                    <div className="flex-1" />
                    <DensityToggle dense={dense} onChange={setDense} />
                    <OverflowMenu active={selectedSubjects.size > 0 || filters.goodBetOnly || filters.sportsbook != null}>
                      <button
                        type="button"
                        onClick={() => setFilterOpen(true)}
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-accent-soft/30"
                      >
                        <span>Players</span>
                        <span className="text-ink-faint">{selectedSubjects.size > 0 ? selectedSubjects.size : 'All'}</span>
                      </button>
                      <BooleanCheckboxRow label="Good Bet only" checked={filters.goodBetOnly} onChange={toggleGoodBetOnly} />
                      {filtersActive(filters) ? (
                        <button
                          type="button"
                          onClick={clearAll}
                          className="w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-bad hover:bg-bad/5"
                        >
                          Clear all filters
                        </button>
                      ) : null}
                    </OverflowMenu>
                    <IconToggleButton
                      icon={<SidebarIcon size={16} />}
                      label="Toggle filter sidebar"
                      active={sidebarLayout}
                      onClick={() => setSidebarLayout(!sidebarLayout)}
                    />
                  </div>

                  {/* Filter button row — only in the default (non-sidebar) layout. */}
                  {!sidebarLayout ? (
                    <FilterBar>
                      <FilterDropdown
                        icon={<PeopleIcon size={15} />}
                        label="Games"
                        badge={filters.gamePks.size > 0 ? filters.gamePks.size : undefined}
                        active={filters.gamePks.size > 0}
                      >
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

                      <FilterDropdown
                        icon={<BarsIcon size={15} />}
                        label="Market"
                        badge={filters.dimensions.size > 0 ? filters.dimensions.size : undefined}
                        active={filters.dimensions.size > 0}
                      >
                        <CheckboxList
                          options={marketOptions}
                          selected={filters.dimensions}
                          onToggle={toggleDimension}
                          onClear={() => filters.dimensions.forEach((d) => toggleDimension(d))}
                        />
                      </FilterDropdown>

                      <FilterDropdown
                        icon={<ShieldIcon size={15} />}
                        label="Team"
                        badge={filters.teams.size > 0 ? filters.teams.size : undefined}
                        active={filters.teams.size > 0}
                      >
                        <CheckboxList
                          options={teamOptions}
                          selected={filters.teams}
                          onToggle={toggleTeam}
                          onClear={() => filters.teams.forEach((t) => toggleTeam(t))}
                        />
                      </FilterDropdown>

                      <FilterDropdown
                        icon={<TargetIcon size={15} />}
                        label="Hit rate"
                        badge={filters.hitRateMin != null ? `≥${filters.hitRateMin}%` : undefined}
                        active={filters.hitRateMin != null}
                      >
                        <div className="space-y-1 p-1">
                          {[65, 50, 0].map((pct) => (
                            <button
                              key={pct}
                              type="button"
                              onClick={() => setHitRateMin(pct === 0 ? null : pct)}
                              className={`block w-full rounded-lg px-2 py-1.5 text-left text-[13px] ${
                                filters.hitRateMin === pct || (pct === 0 && filters.hitRateMin === null)
                                  ? 'bg-accent-soft font-semibold text-masters'
                                  : 'hover:bg-accent-soft/30'
                              }`}
                            >
                              {pct === 0 ? 'Any' : `≥ ${pct}%`}
                            </button>
                          ))}
                        </div>
                      </FilterDropdown>

                      <FilterDropdown
                        icon={<SlidersIcon size={15} />}
                        label="Odds"
                        badge={filters.oddsMin !== null || filters.oddsMax !== null ? `${filters.oddsMin ?? '−∞'} to ${filters.oddsMax ?? '+∞'}` : undefined}
                        active={filters.oddsMin !== null || filters.oddsMax !== null || !filters.showNoOdds}
                      >
                        <FilterOddsRangeInputs min={filters.oddsMin} max={filters.oddsMax} onChange={setOddsRange} />
                        <div className="mt-1 border-t border-line pt-1">
                          <BooleanCheckboxRow label="Show players with no odds" checked={filters.showNoOdds} onChange={toggleShowNoOdds} />
                        </div>
                      </FilterDropdown>

                      <FilterDropdown
                        icon={<FlameIcon size={15} />}
                        label="Streak"
                        badge={
                          [filters.hotStreak, filters.coldStreak, filters.consistentOnly].filter(Boolean).length || undefined
                        }
                        active={filters.hotStreak || filters.coldStreak || filters.consistentOnly}
                      >
                        <div className="space-y-0.5">
                          <BooleanCheckboxRow label="Hot streak" checked={filters.hotStreak} onChange={toggleHotStreak} icon={<FlameIcon size={14} className="text-ink-faint" />} />
                          <BooleanCheckboxRow label="Cold streak" checked={filters.coldStreak} onChange={toggleColdStreak} icon={<SnowflakeIcon size={14} className="text-ink-faint" />} />
                          <BooleanCheckboxRow label="Consistent" checked={filters.consistentOnly} onChange={toggleConsistentOnly} icon={<CheckCircleIcon size={14} className="text-ink-faint" />} />
                        </div>
                      </FilterDropdown>

                      {hasPropsPipeline && bookOptions.length > 1 ? (
                        <FilterSelect
                          icon={<BookIcon size={15} />}
                          label="Book"
                          value={filters.sportsbook ?? ''}
                          onChange={(value) => setSportsbook(value || null)}
                          options={bookOptions}
                        />
                      ) : null}
                    </FilterBar>
                  ) : null}

                  {scanView === 'Good Bets'
                    ? renderList(
                        views.goodBets,
                        'No good bets clear the bar right now — a real edge, strong recent form, or a favorable matchup, on a market we trust and a price no worse than -300. Check back as odds update, or browse All.',
                        true,
                      )
                    : null}

                  {scanView === 'All' ? renderList(views.all, 'No candidates match these filters.') : null}

                  {scanView === 'Coming up'
                    ? renderList(views.comingUp, 'Nothing is live and imminent right now. Check All for the whole slate.')
                    : null}

                  {scanView === 'Watchlist'
                    ? renderList(views.watchlist, 'Star a player on any card to follow them here.')
                    : null}

                  {scanView === 'Home Runs'
                    ? renderList(views.homeRuns, 'No home-run projections available for today’s slate yet.', false, 'modelProb')
                    : null}
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
