'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { PickCandidate, Sport, SoccerLeague, SportSnapshot } from '@/lib/core/types';
import { isOk } from '@/lib/core/windowedStat';
import { DistributionChart, WindowBox, FilterChip } from './PlayerDetail';
import { SeriesChart } from './charts/SeriesChart';
import { fmt } from './charts/tokens';
import { StatRankRow } from './StatRankRow';
import { useTeamStatcast } from './useTeamStatcast';
import { useTeamBatterRanks } from './useTeamBatterRanks';
import { useTeamRatingHistory } from './useTeamRatingHistory';
import { eloSportKey } from '@/lib/sports/shared/teamRatingShapes';
import { useBullpen } from './useBullpen';
import { SegmentedToggle } from './SegmentedToggle';
import { marketText, directionMark } from './MarketLabel';
import { OddsChip, GetOddsButton } from './OddsChip';
import { SubjectAvatar, TeamLogo, nflTeamLogoUrl } from './SubjectAvatar';
import { useTeamRoster } from './useTeamRoster';
import { useTeamForm } from './useTeamForm';
import { useNflTeamDetail } from './useNflTeamDetail';
import { useSoccerTeamDetail } from './useSoccerTeamDetail';
import { useCfbTeamDetail } from './useCfbTeamDetail';
import { useNbaTeamDetail } from './useNbaTeamDetail';
import { useNhlTeamDetail } from './useNhlTeamDetail';
import { StandingsTables } from './StandingsTables';
import type { TeamStandingRow } from './useAllTeams';
import { teamPrimaryColor as mlbTeamPrimaryColor, withAlpha } from '@/lib/sports/mlb/teamColors';
import { teamPrimaryColor as nflTeamPrimaryColor } from '@/lib/sports/nfl/teamColors';
import { PitchingMatchupCard } from './PitchingMatchupCard';
import { BatterPitcherMatchupCard } from './BatterPitcherMatchupCard';
import { NflPlayerVsDefenseCard } from './NflPlayerVsDefenseCard';
import { GradeChip } from './GradeChip';
import { useSeasonRanks, seasonRankSport } from './useSeasonRanks';
import type { UnifiedLinesResult } from '@/lib/odds/types';
import {
  toTeamDetailData as toMlbTeamDetailData,
  type TeamDetailData,
} from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import { toTeamDetailData as toNflTeamDetailData } from '@/lib/sports/nfl/adapters/teamDetailAdapter';
import { toTeamDetailData as toSoccerTeamDetailData } from '@/lib/sports/soccer/adapters/teamDetailAdapter';
import { toTeamDetailData as toCfbTeamDetailData } from '@/lib/sports/cfb/adapters/teamDetailAdapter';
import { toTeamDetailData as toNbaTeamDetailData } from '@/lib/sports/nba/adapters/teamDetailAdapter';
import { toTeamDetailData as toNhlTeamDetailData } from '@/lib/sports/nhl/adapters/teamDetailAdapter';

const POSITION_ORDER = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'QB', 'RB', 'FB', 'WR', 'TE', 'K', 'OL', 'DL', 'LB', 'DB', 'S', 'CB'];

export interface TeamDetailProps {
  sport: Sport;
  teamId: number;
  /** Soccer only. */
  league?: SoccerLeague;
  /** MLB only — drives `TeamDetail`'s line stepper/edge badge. NFL/soccer build their candidates from their own `/api/{sport}/team/[teamId]` directly and read neither. */
  snapshot?: SportSnapshot | null;
  odds?: UnifiedLinesResult | null;
  onAdd?: (candidate: PickCandidate, oddsInfo?: { americanOdds: string; source: string }) => void;
  addedKeys?: Set<string>;
  /** All teams' standings, for the division tables at the bottom of every team page. Passed down from `TeamDetailPanel` rather than fetched again here — it's already loading the same list for the sidebar. */
  standingsTeams: TeamStandingRow[];
  standingsLoading: boolean;
  /**
   * Fires whenever this component's own data-fetching hooks (roster, form,
   * team Statcast, batter ranks, bullpen — MLB; `useNflTeamDetail` — NFL)
   * settle, not just when `data` first resolves. See `PlayerDetail`'s
   * identically-named prop for why this exists.
   */
  onReadyChange?: (ready: boolean) => void;
}

export function TeamDetail({ sport, teamId, league, snapshot, odds, onAdd, addedKeys, standingsTeams, standingsLoading, onReadyChange }: TeamDetailProps) {
  // Every hook below is always called (rules of hooks) — NFL's real data
  // model is one bespoke endpoint (`useNflTeamDetail`) instead of MLB's
  // several composed hooks, so both sets run unconditionally and the unused
  // half's queries simply go nowhere (`useNflTeamDetail` no-ops for
  // `teamId undefined`; MLB's hooks return their own "no data" state when
  // `sport !== 'mlb'` never reads it downstream).
  const roster = useTeamRoster(teamId);
  const form = useTeamForm(teamId);
  const teamStatcast = useTeamStatcast(teamId);
  const batterRanks = useTeamBatterRanks(teamId);
  const nflTeam = useNflTeamDetail(sport === 'nfl' ? teamId : undefined);
  const soccerTeam = useSoccerTeamDetail(sport === 'soccer' ? teamId : undefined, sport === 'soccer' ? league : undefined);
  const cfbTeam = useCfbTeamDetail(sport === 'cfb' ? teamId : undefined);
  const nbaTeam = useNbaTeamDetail(sport === 'nba' ? teamId : undefined);
  const nhlTeam = useNhlTeamDetail(sport === 'nhl' ? teamId : undefined);
  // Phase 6.1b — league-wide season ranks, the source for both `statGroups`
  // and `unitGrades` on the sports that had neither. Called unconditionally
  // like every hook above it (rules of hooks); `seasonRankSport` returns
  // undefined for a sport with no spec and the hook idles without fetching.
  const seasonRanks = useSeasonRanks(seasonRankSport(sport, league));

  const [market, setMarket] = useState<string | undefined>(undefined);
  const [lineOffset, setLineOffset] = useState(0);
  const [opponentOnly, setOpponentOnly] = useState(false);
  const [venue, setVenue] = useState<'all' | 'home' | 'away'>('all');
  const [lastN, setLastN] = useState<number | 'all'>('all');
  const [showAllGames, setShowAllGames] = useState(false);
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterPosition, setRosterPosition] = useState<string | null>(null);
  const [rosterShowAll, setRosterShowAll] = useState(false);
  const [matchupTab, setMatchupTab] = useState<string | null>(null);
  const [matchupPlayerId, setMatchupPlayerId] = useState<string | null>(null);

  // Switching teams resets every scope control — a stale line/filter carried
  // from one team onto another would silently mean something different.
  useEffect(() => {
    setMarket(undefined);
    setLineOffset(0);
    setOpponentOnly(false);
    setVenue('all');
    setLastN('all');
    setShowAllGames(false);
    setRosterSearch('');
    setRosterPosition(null);
    setRosterShowAll(false);
    setMatchupTab(null);
    setMatchupPlayerId(null);
  }, [teamId]);

  // A filter change should re-collapse the roster list too — "show more"
  // against one search/position scope shouldn't silently carry over.
  useEffect(() => {
    setRosterShowAll(false);
  }, [rosterSearch, rosterPosition]);

  // MLB's own today's-game lookup — feeds `useBullpen` before the adapter
  // itself is ever called (the adapter needs the bullpen hook's *result*,
  // not to call the hook itself). Cheap, real small duplication of what the
  // MLB adapter recomputes for its own purposes, same convention already
  // used throughout this file family (see `playerDetailAdapter.ts`'s header).
  const mlbGames = ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{ awayTeamId: number; homeTeamId: number }>;
  const mlbTodaysGame = mlbGames.find((g) => g.awayTeamId === teamId || g.homeTeamId === teamId);
  const bullpen = useBullpen(mlbTodaysGame?.awayTeamId, mlbTodaysGame?.homeTeamId);

  // Rating trajectory (6.14). ONE hook for every team sport — `team_elo_history`
  // is a single table, so unlike the shot/target maps there is no per-sport
  // fetch to fork on. `eloSportKey` returns null for tennis and golf (no team
  // concept, so no block) and maps soccer onto the TABLE's own vocabulary,
  // which is `soccer_epl`/`soccer_mls` rather than the app's `soccer`.
  const ratingHistory = useTeamRatingHistory(eloSportKey(sport, league ?? null), teamId);

  const data: TeamDetailData | null =
    sport === 'nfl'
      ? nflTeam.data
        ? toNflTeamDetailData({
            data: nflTeam.data,
            scope: { market, lineOffset, opponentOnly, venue, lastN, matchupPlayerId },
            standingsTeams,
            ratingHistory,
          })
        : null
      : sport === 'soccer'
        ? soccerTeam.data && league
          ? toSoccerTeamDetailData({ league, data: soccerTeam.data, scope: { market, lineOffset, opponentOnly, venue, lastN }, standingsTeams, ratingHistory })
          : null
        : sport === 'cfb'
          ? cfbTeam.data
            ? toCfbTeamDetailData({ data: cfbTeam.data, scope: { market, lineOffset, opponentOnly, venue, lastN }, standingsTeams, ratingHistory })
            : null
          : sport === 'nba'
            ? nbaTeam.data
              ? toNbaTeamDetailData({ data: nbaTeam.data, scope: { market, lineOffset, opponentOnly, venue, lastN }, standingsTeams, seasonRanks: seasonRanks.data, ratingHistory })
              : null
            : sport === 'nhl'
              ? nhlTeam.data
                ? toNhlTeamDetailData({ data: nhlTeam.data, scope: { market, lineOffset, opponentOnly, venue, lastN }, standingsTeams, seasonRanks: seasonRanks.data, ratingHistory })
                : null
              : roster.data
              ? toMlbTeamDetailData({
                teamId,
                snapshot: snapshot ?? null,
                odds: odds ?? null,
                roster: roster.data,
                formResults: form.results,
                teamStatcast,
                batterRanksByPersonId: batterRanks.byPersonId,
                bullpen: { byTeam: bullpen.byTeam, loading: bullpen.loading },
                standingsTeams,
                market,
                lineOffset,
                opponentOnly,
                venue,
                lastN,
                ratingHistory,
              })
            : null;

  const detailLoading =
    sport === 'nfl'
      ? nflTeam.loading && !nflTeam.data
      : sport === 'soccer'
        ? soccerTeam.loading && !soccerTeam.data
        : sport === 'cfb'
          ? cfbTeam.loading && !cfbTeam.data
          : sport === 'nba'
            ? nbaTeam.loading && !nbaTeam.data
            : sport === 'nhl'
              ? nhlTeam.loading && !nhlTeam.data
              : roster.loading && !roster.data;
  const detailError =
    sport === 'nfl'
      ? nflTeam.error
      : sport === 'soccer'
        ? soccerTeam.error
        : sport === 'cfb'
          ? cfbTeam.error
          : sport === 'nba'
            ? nbaTeam.error
            : sport === 'nhl'
              ? nhlTeam.error
              : roster.error;

  // Combined readiness for `onReadyChange` — must run before any early
  // return below (rules of hooks). An error also counts as "ready" — a
  // stuck loader would be worse than showing the error state below.
  const internalReady =
    Boolean(detailError) ||
    (!detailLoading &&
      data !== null &&
      !bullpen.loading &&
      (sport === 'nfl'
        ? !nflTeam.loading
        : sport === 'soccer'
          ? !soccerTeam.loading
          : sport === 'cfb'
            ? !cfbTeam.loading
            : sport === 'nba'
              ? !nbaTeam.loading
              : sport === 'nhl'
                ? !nhlTeam.loading
                : !form.loading && !teamStatcast.loading && !batterRanks.loading));
  useEffect(() => {
    onReadyChange?.(internalReady);
  }, [internalReady, onReadyChange]);

  if (detailLoading) {
    return (
      <div className="lb-card p-4">
        <div className="h-24 animate-pulse rounded-lg bg-line/30" />
      </div>
    );
  }
  if (detailError) return <div className="lb-card border-bad/30 bg-bad/5 p-3 text-sm text-bad">{detailError}</div>;
  if (!data) return <div className="lb-card p-8 text-center text-sm text-ink-muted">Team not found.</div>;

  const team = data.team;
  // The units this sport wants in the compact header row — see the chip row
  // below, and `UnitGrade.short`'s own comment for why presence is the switch.
  const headlineUnits = (data.unitGrades ?? []).filter((u) => u.short);
  const active = data.candidates.find((c) => c.dimension === market) ?? data.candidates[0];
  const wantOver = active ? directionMark(active.category) !== 'U' : true;
  const isMoneylineMarket = active?.dimension === 'moneyline';
  const activeMatchupTab = matchupTab ?? data.matchup?.tabs[0]?.key ?? null;

  const rosterPositions = Array.from(new Set(data.roster.map((p) => p.position))).filter((p) => POSITION_ORDER.includes(p));
  const sortedRosterPositions = POSITION_ORDER.filter((p) => rosterPositions.includes(p));
  const filteredRoster = data.roster
    .filter((p) => {
      if (rosterPosition && p.position !== rosterPosition) return false;
      if (rosterSearch.trim() && !p.name.toLowerCase().includes(rosterSearch.trim().toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (!data.rosterSortByStats) return 0;
      const aHas = a.hasStats ? 1 : 0;
      const bHas = b.hasStats ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      return a.name.localeCompare(b.name);
    });
  const visibleRoster = data.rosterPageSize == null || rosterShowAll ? filteredRoster : filteredRoster.slice(0, data.rosterPageSize);

  // No per-club color table exists for soccer yet (NFL/MLB's are both
  // hand-maintained lookup tables keyed by league-specific ids) — the
  // header hero's own neutral-gradient fallback (`withAlpha` below) reads
  // fine against a flat default, same as any MLB/NFL team missing from
  // their own tables would.
  const accentColor =
    sport === 'nfl'
      ? nflTeamPrimaryColor(team.abbr)
      : sport === 'soccer' || sport === 'cfb' || sport === 'nba' || sport === 'nhl'
        ? '#3a3a3a'
        : mlbTeamPrimaryColor(team.teamId);

  return (
    <div className="space-y-3">
      {/* Header — team-color hero wash, same treatment Player/Game Detail use. */}
      <section
        className="lb-card-hero overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${withAlpha(accentColor, '26')} 0%, #ffffff 62%)`,
          borderTop: '3px solid #141619',
        }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <TeamLogo logoUrl={team.logoUrl} abbreviation={team.abbr} size={44} />
            <div>
              <h1 className="text-lg font-semibold">{team.name}</h1>
              <p className="text-[12px] text-ink-muted">
                {data.record
                  ? `${data.record.wins}-${data.record.losses}${data.record.divisionRank ? ` · ${data.record.divisionRank} in division` : ''}`
                  : 'Record unavailable'}
              </p>
              {/* Header grade chips — Phase 6.1. Was three hardcoded
                  `<GradeChip label="OFF">`/`"DEF"`/`"ST"` calls reading
                  `data.grades.offense` etc., which is what made this row NFL-
                  only. A unit opts into this compact row by carrying a `short`,
                  so NFL still shows OFF/DEF/ST and MLB shows HIT/PIT with no
                  sport check and no fixed count. */}
              {headlineUnits.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {headlineUnits.map((u) => (
                    <GradeChip key={u.key} grade={u} />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {data.nextGame?.gameHref ? (
            <Link
              href={data.nextGame.gameHref}
              className="flex items-center gap-1.5 text-[12px] text-masters hover:underline"
            >
              {data.nextGame.isHome ? 'vs' : '@'} <TeamLogo logoUrl={data.nextGame.opponentLogoUrl} abbreviation={data.nextGame.opponentAbbr} size={18} />{' '}
              {data.nextGame.opponentAbbr}
              <span className="text-ink-faint">→</span>
            </Link>
          ) : (
            <span className="text-[12px] text-ink-faint">No game today</span>
          )}
        </div>
      </section>

      {/* Main content (left) + persistent context rail (right, sticky at lg+) */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_260px] lg:items-start">
      <div className="min-w-0 space-y-3">
      {!data.candidates.length ? (
        <div className="lb-card p-8 text-center text-sm text-ink-muted">
          No form data available yet for this team.
          {snapshot?.seasonStatus && !snapshot.seasonStatus.started ? (
            <>
              {' '}
              {snapshot.seasonStatus.label ?? 'The season hasn’t started yet'}
              {snapshot.seasonStatus.nextGameDate
                ? ` — first real games are ${new Date(snapshot.seasonStatus.nextGameDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`
                : '.'}
            </>
          ) : null}
        </div>
      ) : !active ? null : (
        <>
          {/* Market tabs */}
          <div className="lb-scroll-x flex gap-1 border-b border-line">
            {data.candidates.map((c) => (
              <button
                key={`${c.dimension}-${c.category}`}
                type="button"
                onClick={() => {
                  setLineOffset(0);
                  setShowAllGames(false);
                  setMarket(c.dimension);
                }}
                aria-current={c.dimension === active.dimension ? 'true' : undefined}
                className={`relative whitespace-nowrap px-2.5 pb-1.5 pt-1 text-[12px] transition-colors ${
                  c.dimension === active.dimension
                    ? 'font-semibold text-ink after:absolute after:inset-x-2.5 after:bottom-0 after:h-[2px] after:rounded-full after:bg-masters'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {c.dimensionLabel}
              </button>
            ))}
          </div>

          {/* Line stepper + price */}
          <section className="lb-card flex flex-wrap items-center gap-2 p-2.5">
            <div className="flex items-center gap-1 rounded-lg border border-line">
              <button type="button" onClick={() => setLineOffset((v) => v - 1)} aria-label="Lower the line" className="px-2.5 py-1 text-[15px] leading-none text-ink-muted hover:text-masters">
                −
              </button>
              <span className="min-w-[52px] text-center text-[15px] font-semibold tabular-nums" aria-live="polite">
                {isMoneylineMarket ? 'Win' : `${wantOver ? 'O' : 'U'} ${Math.max(0, (active.line ?? 0.5) + lineOffset)}`}
              </span>
              <button type="button" onClick={() => setLineOffset((v) => v + 1)} aria-label="Raise the line" className="px-2.5 py-1 text-[15px] leading-none text-ink-muted hover:text-masters">
                +
              </button>
            </div>

            <span className="text-[12px] text-ink-muted">{marketText(sport, active.dimension, 'full') || active.dimensionLabel}</span>

            {lineOffset === 0 && active.odds ? (
              <OddsChip price={active.odds.americanOdds} source={active.odds.source} capturedAt={active.odds.capturedAt} size="md" />
            ) : lineOffset !== 0 ? (
              <span className="text-[11px] text-ink-faint">No price recorded at this alternate line.</span>
            ) : onAdd ? (
              <GetOddsButton onClick={() => onAdd(active)} label="Add to slip to record a price" />
            ) : (
              <span className="text-[11px] text-ink-faint">No price yet.</span>
            )}

            {lineOffset !== 0 ? (
              <button type="button" onClick={() => setLineOffset(0)} className="text-[11px] text-masters underline">
                Reset to {active.line ?? 0.5}
              </button>
            ) : null}

            {onAdd ? (
              <button
                type="button"
                onClick={() => onAdd(active, active.odds ? { americanOdds: active.odds.americanOdds, source: active.odds.source } : undefined)}
                className="lb-btn-primary ml-auto rounded-lg bg-masters px-3 py-1.5 text-[12px] font-semibold text-white"
              >
                {addedKeys?.has(`${active.sport}:${active.subjectId}:${active.dimension}:${active.category}`) ? 'On slip ✓' : 'Add to slip'}
              </button>
            ) : null}
          </section>

          {/* Scope filters */}
          <div className="lb-scroll-x flex items-center gap-1.5">
            <FilterChip active={venue === 'all'} onClick={() => setVenue('all')}>All games</FilterChip>
            <FilterChip active={venue === 'home'} onClick={() => setVenue(venue === 'home' ? 'all' : 'home')}>Home</FilterChip>
            <FilterChip active={venue === 'away'} onClick={() => setVenue(venue === 'away' ? 'all' : 'away')}>Away</FilterChip>
            {data.nextGame?.opponentAbbr ? (
              <FilterChip active={opponentOnly} onClick={() => setOpponentOnly((v) => !v)}>vs {data.nextGame.opponentAbbr}</FilterChip>
            ) : null}
            <span className="mx-1 h-4 w-px bg-line" />
            {([5, 10, 15, 'all'] as const).map((n) => (
              <FilterChip key={String(n)} active={lastN === n} onClick={() => setLastN(n)}>
                {n === 'all' ? 'Season' : `Last ${n}`}
              </FilterChip>
            ))}
          </div>

          {/* Window boxes */}
          {data.windows ? (
            <div className="lb-scroll-x flex gap-1.5 overflow-x-auto">
              <WindowBox label="L5" stat={data.windows.l5} />
              <WindowBox label="L10" stat={data.windows.l10} />
              <WindowBox label="L15" stat={data.windows.l15} />
              <WindowBox label="H2H" stat={data.windows.h2h} showCount />
              <WindowBox label="SZN" stat={data.windows.szn} showCount />
            </div>
          ) : null}

          {/* Chart */}
          {data.distribution ? (
            <section className="lb-card overflow-hidden">
              <div className="flex items-baseline justify-between gap-2 bg-accent-soft px-3 py-1.5">
                <h2 className="text-[12px] font-semibold text-masters">
                  {data.distribution.history.length} game{data.distribution.history.length === 1 ? '' : 's'} in scope
                </h2>
                <span className="text-[10px] text-masters/70">
                  green cleared {isMoneylineMarket ? 'a win' : `${wantOver ? 'over' : 'under'} ${data.distribution.line}`}
                </span>
              </div>
              <div className="p-2.5">
                <DistributionChart
                  history={data.distribution.history}
                  line={data.distribution.line}
                  wantOver={data.distribution.wantOver}
                  refreshKey={data.distribution.refreshKey}
                  logoFor={data.distribution.logoFor}
                />
              </div>
            </section>
          ) : null}

          {/* Rating history (6.14) */}
          {data.ratingHistory ? (
            <section className="lb-card overflow-hidden">
              <div className="flex items-baseline justify-between gap-2 bg-accent-soft px-3 py-1.5">
                <h2 className="text-[12px] font-semibold text-masters">{data.ratingHistory.title}</h2>
                {/* The real span, not the axis's implication — five of six sports
                    have exactly one season here and the label is what says so. */}
                <span className="text-[10px] text-masters/70">{data.ratingHistory.spanLabel}</span>
              </div>
              <div className="p-2.5">
                <SeriesChart
                  values={data.ratingHistory.values}
                  context={data.ratingHistory.context}
                  xLabels={data.ratingHistory.xLabels}
                  // NEVER zero-based. An Elo series spans ~130 points around
                  // 1500; anchoring the axis at zero collapses it into a flat
                  // strip and destroys the entire signal while still rendering
                  // cleanly. This is the exact bug SeriesChart's own header
                  // documents, and the reason the prop has no default.
                  zeroBased={false}
                  format={fmt.int}
                  unit="Elo"
                  label={`${data.team.name} rating history`}
                  isLoading={data.ratingHistory.loading}
                  height={148}
                />
                <p className="mt-1.5 text-[10px] text-ink-muted">{data.ratingHistory.caption}</p>
              </div>
            </section>
          ) : null}

          {/* Games table */}
          <section className="lb-card overflow-hidden">
            <div className="flex items-center justify-between gap-2 bg-accent-soft px-2.5 py-1.5">
              <h2 className="text-[12px] font-semibold text-masters">
                {showAllGames ? `All ${data.games.length} games` : `Last ${Math.min(data.games.length, 15)} games`}
              </h2>
              {data.games.length > 15 ? (
                <button type="button" onClick={() => setShowAllGames((v) => !v)} className="text-[11px] font-medium text-masters hover:underline">
                  {showAllGames ? 'Show last 15' : `Show all ${data.games.length}`}
                </button>
              ) : null}
            </div>
            {data.games.length === 0 ? (
              <p className="p-6 text-center text-sm text-ink-muted">No games match this scope.</p>
            ) : (
              <div className="lb-scroll-x overflow-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr>
                      <th className="border-b border-line px-2 py-1 text-left font-semibold text-ink-muted">Game</th>
                      <th className="border-b border-line px-2 py-1 text-right font-semibold text-ink-muted">
                        {isMoneylineMarket ? 'Result' : 'Value'}
                      </th>
                      <th className="border-b border-line px-2 py-1 text-right font-semibold text-ink-muted">{isMoneylineMarket ? '' : `vs ${data.distribution?.line ?? ''}`}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.games].reverse().slice(0, showAllGames ? undefined : 15).map((g) => (
                      <tr key={g.key} className="border-b border-line/50">
                        <td className="px-2 py-1 text-left">
                          <span className="flex items-center gap-1.5">
                            <TeamLogo logoUrl={g.opponentLogoUrl} size={16} />
                            {g.periodLabel}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums font-semibold">{g.resultText}</td>
                        <td className="px-2 py-1 text-right">
                          {g.cleared == null ? (
                            <span className="text-ink-faint">—</span>
                          ) : (
                            <span className={g.cleared ? 'text-good' : 'text-ink-faint'}>{g.cleared ? '✓' : '✗'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* Matchup toggle — MLB: Pitching matchup (today's two starters) /
          Contact quality (this team's hitting vs. the opposing starter).
          NFL: Team matchup (offense vs. defense) / Player matchup (one
          skill-position player vs. the same opponent group), with a roster
          picker. Genuinely different framings per sport — `data.matchup`
          only ever carries the fields the active sport's adapter populated;
          which concrete card renders is decided by the active tab's own key,
          not a sport check. */}
      {data.matchup ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SegmentedToggle
              value={activeMatchupTab ?? ''}
              onChange={setMatchupTab}
              className="rounded-lg border border-line bg-card p-0.5 text-meta"
              buttonClassName="rounded-md px-2 py-0.5"
              gliderClassName="rounded-md"
              options={data.matchup.tabs.map((t) => ({ key: t.key, label: t.label }))}
            />
            {activeMatchupTab === 'player' && data.matchup.playerOptions && data.matchup.playerOptions.length > 0 ? (
              <select
                value={data.matchup.selectedPlayerId ?? ''}
                onChange={(e) => setMatchupPlayerId(e.target.value)}
                aria-label="Pick a player"
                className="rounded-lg border border-line bg-card px-2 py-1 text-[12px] focus:border-masters focus:outline-none"
              >
                {data.matchup.playerOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            ) : null}
          </div>

          {activeMatchupTab === 'team' && data.matchup.teamGradeBadges && data.matchup.teamGradeBadges.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {data.matchup.teamGradeBadges.map((g) => (
                <GradeChip key={g.label} label={g.label} grade={g.grade} />
              ))}
            </div>
          ) : activeMatchupTab === 'player' && data.matchup.selectedPlayerGradeBadges && data.matchup.selectedPlayerGradeBadges.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {data.matchup.selectedPlayerGradeBadges.map((g) => (
                <GradeChip key={g.label} label={g.label} grade={g.grade} />
              ))}
            </div>
          ) : null}

          {activeMatchupTab === 'pitching' && data.matchup.pitching ? (
            <PitchingMatchupCard game={data.matchup.pitching.game} bullpen={data.matchup.pitching.bullpen} bullpenLoading={data.matchup.pitching.bullpenLoading} />
          ) : activeMatchupTab === 'contact' && data.matchup.contact ? (
            <BatterPitcherMatchupCard {...data.matchup.contact} />
          ) : activeMatchupTab === 'team' ? (
            data.matchup.team ? (
              <BatterPitcherMatchupCard {...data.matchup.team} />
            ) : (
              <div className="lb-card p-6 text-center text-sm text-ink-muted">No opponent stats available yet.</div>
            )
          ) : activeMatchupTab === 'player' ? (
            data.matchup.selectedPlayerCard ? (
              <NflPlayerVsDefenseCard {...data.matchup.selectedPlayerCard} />
            ) : (
              <div className="lb-card p-6 text-center text-sm text-ink-muted">No skill-position players with season stats yet.</div>
            )
          ) : null}
        </>
      ) : null}

      {/* Team stats — grouped, ranked. MLB: Per game / Season (2 groups, same
          keys). NFL: Scoring / Passing / Rushing / Receiving / Defense (5
          groups, each with its own grade chip). */}
      {data.statGroups.length > 0 ? (
        <section className="lb-card overflow-hidden">
          <h2 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Team stats</h2>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
            {data.statGroups.map((g) => (
              <div key={g.label}>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">{g.label}</span>
                  {g.grade ? <GradeChip label="" grade={g.grade} /> : null}
                </div>
                <div className="space-y-1.5">
                  {g.stats.map((s) => (
                    <StatRankRow key={s.key} stat={s} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Roster — search + position filter */}
      <section className="lb-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-accent-soft px-3 py-1.5">
          <h2 className="text-[10.5px] font-bold uppercase tracking-wide text-masters">
            Roster ({filteredRoster.length}{filteredRoster.length !== data.roster.length ? ` of ${data.roster.length}` : ''})
          </h2>
          <input
            type="search"
            value={rosterSearch}
            onChange={(e) => setRosterSearch(e.target.value)}
            placeholder="Search roster…"
            aria-label="Search roster"
            className="w-40 rounded-lg border border-line bg-card px-2 py-1 text-[12px] focus:border-masters focus:outline-none"
          />
        </div>
        <div className="p-4">
        {sortedRosterPositions.length > 1 ? (
          <div className="lb-scroll-x mb-2 flex gap-1.5">
            <FilterChip active={rosterPosition === null} onClick={() => setRosterPosition(null)}>All</FilterChip>
            {sortedRosterPositions.map((p) => (
              <FilterChip key={p} active={rosterPosition === p} onClick={() => setRosterPosition(rosterPosition === p ? null : p)}>
                {p}
              </FilterChip>
            ))}
          </div>
        ) : null}
        {filteredRoster.length === 0 ? (
          <p className="p-4 text-center text-[12px] text-ink-muted">No players match.</p>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {visibleRoster.map((p) => {
                const content = (
                  <>
                    <SubjectAvatar name={p.name} headshotUrl={p.headshotUrl} fallbackUrl={team.logoUrl} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium">{p.name}</span>
                        <span className="lb-chip bg-ink/5 text-[10px] text-ink-muted">{p.position}</span>
                        {p.rankBadge ? (
                          <span className="lb-chip bg-accent-soft text-[10px] font-semibold text-masters" title={p.rankBadge.title}>
                            {p.rankBadge.label}
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-[11px] text-ink-faint">{p.seasonLineText}</p>
                    </div>
                  </>
                );
                if (p.href) {
                  return (
                    <li key={p.subjectId}>
                      <Link href={p.href} className="flex items-center gap-2 rounded-lg border border-transparent p-1.5 transition-colors hover:bg-ink/[0.03]">
                        {content}
                      </Link>
                    </li>
                  );
                }
                return (
                  <li key={p.subjectId} className="flex items-center gap-2 rounded-lg p-1.5 opacity-70">
                    {content}
                  </li>
                );
              })}
            </ul>
            {data.rosterPageSize != null && filteredRoster.length > data.rosterPageSize ? (
              <div className="mt-2 text-center">
                <button type="button" onClick={() => setRosterShowAll((v) => !v)} className="text-[12px] font-medium text-masters hover:underline">
                  {rosterShowAll ? 'Show fewer players' : `Show ${filteredRoster.length - data.rosterPageSize} more players`}
                </button>
              </div>
            ) : null}
          </>
        )}
        </div>
      </section>

      {/* Standings — every division, this team's row highlighted. Stays in
          the main column, not the rail — a full standings table needs more
          than 260px, and a second, condensed copy in the rail would just be
          the same information twice. */}
      <section>
        <h2 className="mb-2 rounded-lg bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Standings</h2>
        <StandingsTables
          teams={standingsTeams}
          loading={standingsLoading}
          highlightTeamId={teamId}
          teamHref={(id) =>
            sport === 'nfl'
              ? `/nfl/team/${id}`
              : sport === 'soccer'
                ? `/soccer/${league}/team/${id}`
                : sport === 'cfb'
                  ? `/cfb/team/${id}`
                  : sport === 'nba'
                    ? `/nba/team/${id}`
                    : sport === 'nhl'
                      ? `/nhl/team/${id}`
                      : `/mlb/team/${id}`
          }
        />
      </section>
      </div>

      {/* Context rail — sticky at lg+, stacks below the main column on mobile. */}
      <div className="space-y-3 lg:sticky lg:top-4">
        {sport !== 'nfl' && data.nextGame ? (
          <section className="lb-card overflow-hidden">
            <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Next game</h3>
            <div className="space-y-1.5 p-3 text-[10.5px]">
              {data.nextGame.moneyline ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <TeamLogo logoUrl={data.nextGame.opponentLogoUrl} size={14} /> {data.nextGame.isHome ? data.nextGame.opponentAbbr : team.abbr} ML
                    </span>
                    <span className="font-semibold text-ink">{data.nextGame.moneyline.away}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <TeamLogo logoUrl={data.nextGame.isHome ? team.logoUrl : data.nextGame.opponentLogoUrl} size={14} />{' '}
                      {data.nextGame.isHome ? team.abbr : data.nextGame.opponentAbbr} ML
                    </span>
                    <span className="font-semibold text-ink">{data.nextGame.moneyline.home}</span>
                  </div>
                </>
              ) : null}
              {data.nextGame.total?.point != null ? (
                <div className="flex items-center justify-between border-t border-line-hair pt-1.5">
                  <span className="text-ink-muted">Total {data.nextGame.total.point}</span>
                  <span className="font-semibold text-ink">O {data.nextGame.total.overPrice}</span>
                </div>
              ) : null}
              {!data.nextGame.moneyline && data.nextGame.total?.point == null ? <p className="text-ink-faint">No line yet.</p> : null}
            </div>
          </section>
        ) : null}

        {sport === 'nfl' || sport === 'soccer' || sport === 'cfb' || sport === 'nba' || sport === 'nhl' ? (
          <section className="lb-card overflow-hidden">
            <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Form</h3>
            {data.form ? (
              <ul className="space-y-1.5 p-3 text-[12px]">
                {([
                  ['Last 5', data.form.l5],
                  ['Last 10', data.form.l10],
                  ['Last 15', data.form.l15],
                  [data.nextGame?.opponentAbbr ? `vs ${data.nextGame.opponentAbbr}` : 'H2H', data.form.h2h],
                ] as const).map(([label, stat]) => (
                  <li key={label} className="flex items-baseline justify-between gap-2">
                    <span className="text-ink-muted">{label}</span>
                    <span className="font-semibold tabular-nums">
                      {isOk(stat) ? `${Math.round(stat.rate * 100)}%` : `${stat.available} of ${stat.required}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-3 text-[12px] text-ink-faint">No candidates yet.</p>
            )}
          </section>
        ) : null}

        {sport === 'nfl' || sport === 'soccer' || sport === 'cfb' || sport === 'nba' || sport === 'nhl' ? (
          data.nextGame ? (
            <section className="lb-card overflow-hidden">
              <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Next game</h3>
              <div className="space-y-1.5 p-3 text-[10.5px]">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-ink-muted">
                    <TeamLogo logoUrl={data.nextGame.isHome ? data.nextGame.opponentLogoUrl : team.logoUrl} size={14} />{' '}
                    {data.nextGame.isHome ? data.nextGame.opponentAbbr : team.abbr}
                  </span>
                  <span className="text-ink-faint">@</span>
                  <span className="flex items-center gap-1.5 text-ink-muted">
                    {data.nextGame.isHome ? team.abbr : data.nextGame.opponentAbbr}{' '}
                    <TeamLogo logoUrl={data.nextGame.isHome ? team.logoUrl : data.nextGame.opponentLogoUrl} size={14} />
                  </span>
                </div>
                <p className="text-ink-faint">{data.nextGame.startTime}</p>
                {!active?.odds ? <p className="text-ink-faint">No live line yet.</p> : null}
              </div>
            </section>
          ) : (
            <section className="lb-card p-3 text-[11px] text-ink-faint">No upcoming game scheduled.</section>
          )
        ) : null}

        {/* Advanced stats — Statcast quality-of-contact rollup, MLB only, grouped Hitting/Pitching. */}
        {data.advancedStats && data.advancedStats.length > 0 ? (
          <section className="lb-card overflow-hidden">
            <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Advanced stats</h3>
            <div className="space-y-3 p-3">
              {data.advancedStats.map((g) => (
                <div key={g.label}>
                  <h4 className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">{g.label}</h4>
                  <div className="space-y-1.5">
                    {g.stats.map((s) => (
                      <StatRankRow key={s.key} stat={s} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {(sport === 'nfl' || sport === 'soccer' || sport === 'cfb' || sport === 'nba' || sport === 'nhl') && data.recentResults && data.recentResults.length > 0 ? (
          <section className="lb-card overflow-hidden">
            <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Recent results</h3>
            <ul className="space-y-1.5 p-3 text-[10.5px]">
              {data.recentResults.slice(0, 5).map((g) => (
                <li key={g.gameId} className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-ink-muted">
                    <TeamLogo logoUrl={sport === 'nfl' ? nflTeamLogoUrl(g.opponentAbbr) : undefined} abbreviation={g.opponentAbbr} size={14} /> {g.isHome ? 'vs' : '@'} {g.opponentAbbr}
                  </span>
                  <span className={`font-semibold ${g.win ? 'text-good' : g.isDraw ? 'text-ink-muted' : 'text-ink-faint'}`}>
                    {g.isDraw ? `D ${g.scoreFor}-${g.scoreAgainst}` : g.win != null ? `${g.win ? 'W' : 'L'} ${g.scoreFor}-${g.scoreAgainst}` : '—'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      </div>
    </div>
  );
}

export default TeamDetail;
