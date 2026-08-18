'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { PickCandidate, SportSnapshot } from '@/lib/core/types';
import {
  categoriseByLine,
  entryValue,
  fixedWindow,
  openWindow,
  subsetWindow,
  OVER,
  UNDER,
  type WindowedStat,
} from '@/lib/core/windowedStat';
import { DistributionChart, WindowBox, FilterChip, ordinal, type OpposingStarterStat } from './PlayerDetail';
import { StatRankRow } from './StatRankRow';
import { useTeamStatcast } from './useTeamStatcast';
import { useTeamBatterRanks } from './useTeamBatterRanks';
import { useBullpen } from './useBullpen';
import { SegmentedToggle } from './SegmentedToggle';
import { marketText, directionMark } from './MarketLabel';
import { OddsChip, EdgeBadge, GetOddsButton } from './OddsChip';
import { SubjectAvatar, TeamLogo } from './SubjectAvatar';
import { useTeamRoster, type TeamRosterPlayer } from './useTeamRoster';
import { useTeamForm } from './useTeamForm';
import { StandingsTables } from './StandingsTables';
import type { TeamStandingRow } from './useAllTeams';
import { buildMoneylineCandidate, buildGameTotalCandidate } from '@/lib/sports/mlb/teamFormCandidates';
import { buildSlate } from '@/lib/odds/matching';
import { projectLine } from '@/lib/odds/display';
import { computeMoneylineEdge, computeTotalEdge } from '@/lib/odds/gameEdge';
import { teamPrimaryColor, withAlpha } from '@/lib/sports/mlb/teamColors';
import { PitchingMatchupCard } from './PitchingMatchupCard';
import { BatterPitcherMatchupCard } from './BatterPitcherMatchupCard';
import type { UnifiedLinesResult } from '@/lib/odds/types';
import type { GameDetailGame, StatKeyDef } from './GameDetail';

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

function teamLogoUrl(teamId: number | undefined): string | undefined {
  return teamId ? `https://www.mlbstatic.com/team-logos/${teamId}.svg` : undefined;
}

/** `forRanks` are pre-formatted ordinal strings ("28th") — pulls the raw int back out. Duplicated from GameDetail.tsx's own local helper (same small-duplication convention already used elsewhere). */
function parseRank(s: string | null | undefined): number | null {
  const m = /^(\d+)/.exec(s ?? '');
  return m ? Number(m[1]) : null;
}

/** Converts a team's season `forStats`/`forRanks` into the same `OpposingStarterStat[]` shape as the ranked player-level stats, for the Contact quality matchup card's "Season stats" section (poolSize is always 30 teams). */
function teamSeasonStatRows(team: GameDetailGame['home'], statKeys: StatKeyDef[]): OpposingStarterStat[] {
  if (!team) return [];
  return statKeys
    .map((k): OpposingStarterStat | null => {
      const value = team.forStats[k.key];
      const rank = parseRank(team.forRanks[k.key]);
      if (value == null || rank == null) return null;
      return { key: k.key, label: k.label, value, decimals: k.decimals, rank, poolSize: 30 };
    })
    .filter((s): s is OpposingStarterStat => s != null);
}

const POSITION_ORDER = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

function seasonLineText(player: TeamRosterPlayer): string {
  const s = player.seasonLine;
  if (!s) return 'No stats yet this season';
  if (player.isPitcher) {
    const era = s.era != null ? s.era.toFixed(2) : '—';
    return `${era} ERA · ${s.wins ?? 0}-${s.losses ?? 0} · ${s.strikeOuts ?? 0} K`;
  }
  const avg = s.avg != null ? s.avg.toFixed(3) : '—';
  return `${avg} AVG · ${s.homeRuns ?? 0} HR · ${s.rbi ?? 0} RBI`;
}

export interface TeamDetailProps {
  teamId: number;
  snapshot: SportSnapshot | null;
  odds: UnifiedLinesResult | null;
  onAdd?: (candidate: PickCandidate, oddsInfo?: { americanOdds: string; source: string }) => void;
  addedKeys?: Set<string>;
  /** All 30 teams' standings, for the AL/NL tables at the bottom of every team page. Passed down from TeamDetailPanel rather than fetched again here — it's already loading the same list for the sidebar. */
  standingsTeams: TeamStandingRow[];
  standingsLoading: boolean;
}

export function TeamDetail({ teamId, snapshot, odds, onAdd, addedKeys, standingsTeams, standingsLoading }: TeamDetailProps) {
  const roster = useTeamRoster(teamId);
  const form = useTeamForm(teamId);
  const teamStatcast = useTeamStatcast(teamId);
  const batterRanks = useTeamBatterRanks(teamId);

  const [market, setMarket] = useState<string | undefined>(undefined);
  const [lineOffset, setLineOffset] = useState(0);
  const [opponentOnly, setOpponentOnly] = useState(false);
  const [venue, setVenue] = useState<'all' | 'home' | 'away'>('all');
  const [lastN, setLastN] = useState<number | 'all'>('all');
  const [showAllGames, setShowAllGames] = useState(false);
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterPosition, setRosterPosition] = useState<string | null>(null);

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
  }, [teamId]);

  const games = useMemo(
    () => ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as GameDetailGame[],
    [snapshot],
  );
  const statKeys = useMemo(
    () => ((snapshot?.context?.other as Record<string, unknown> | undefined)?.statKeys ?? []) as StatKeyDef[],
    [snapshot],
  );
  const todaysGame = useMemo(
    () => games.find((g) => g.awayTeamId === teamId || g.homeTeamId === teamId),
    [games, teamId],
  );
  const isHome = todaysGame?.homeTeamId === teamId;
  const own = isHome ? todaysGame?.home : todaysGame?.away;
  const opponentId = todaysGame ? (isHome ? todaysGame.awayTeamId : todaysGame.homeTeamId) : undefined;
  const opponentAbbr = todaysGame
    ? (isHome ? todaysGame.matchup?.split('@')[0] : todaysGame.matchup?.split('@')[1])?.trim()
    : undefined;

  const bullpen = useBullpen(todaysGame?.awayTeamId, todaysGame?.homeTeamId);
  const [matchupView, setMatchupView] = useState<'pitching' | 'contact'>('pitching');
  // The opposing side's starter — same GameDetailGame fields PitchingMatchupCard
  // already reads for whichever side isn't this team.
  const opponentStarterName = todaysGame ? (isHome ? todaysGame.awayStarter : todaysGame.homeStarter) : undefined;
  const opponentStarterStats = todaysGame ? (isHome ? todaysGame.awayStarterStats : todaysGame.homeStarterStats) : undefined;
  const opponentStarterOverallRank = todaysGame
    ? (isHome ? todaysGame.awayStarterOverallRank : todaysGame.homeStarterOverallRank)
    : undefined;

  const gameLine = useMemo(() => {
    if (!todaysGame) return null;
    const slate = buildSlate(games, odds?.lines ?? []);
    return slate.entries.find((e) => Number(e.game.gamePk) === Number(todaysGame.gamePk))?.line ?? null;
  }, [games, odds, todaysGame]);

  const projected = gameLine ? projectLine(gameLine) : null;
  const gameModel = todaysGame?.gameModel ?? null;
  const moneylineEdge = computeMoneylineEdge(gameModel, projected?.moneyline);
  const totalEdge = computeTotalEdge(gameModel, projected?.total);
  const myMoneylinePrice = isHome ? projected?.moneyline?.home : projected?.moneyline?.away;
  const myMoneylineEdge = isHome ? moneylineEdge?.home : moneylineEdge?.away;

  // Real PickCandidates built from this team's own results — same shape a
  // player's props already have, so every window/chart/table below is
  // reading the one stat engine the whole app uses, not a parallel one.
  const candidates = useMemo(() => {
    if (!roster.data) return [];
    const today =
      todaysGame && opponentId != null && opponentAbbr
        ? { opponentId, opponentAbbr, isHome, gamePk: todaysGame.gamePk ?? 'unknown' }
        : null;

    const moneyline = buildMoneylineCandidate({
      teamId,
      teamName: roster.data.teamName,
      teamAbbr: roster.data.abbreviation,
      results: form.results,
      today,
    });
    if (moneyline && myMoneylinePrice != null) {
      moneyline.odds = { americanOdds: String(myMoneylinePrice), source: 'odds-api', capturedAt: new Date().toISOString() };
    }

    const total = buildGameTotalCandidate({
      teamId,
      teamName: roster.data.teamName,
      teamAbbr: roster.data.abbreviation,
      results: form.results,
      today,
      todaysTotalLine: projected?.total?.point ?? null,
    });
    const myTotalPrice = projected?.total?.overPrice;
    if (total && myTotalPrice != null) {
      total.odds = { americanOdds: String(myTotalPrice), source: 'odds-api', capturedAt: new Date().toISOString() };
    }

    const teamProps = (snapshot?.candidates ?? []).filter(
      (c) => c.subjectId === `team-${teamId}` && (c.subjectMeta as Record<string, unknown> | undefined)?.isTeamCandidate === true,
    );

    return [moneyline, total, ...teamProps].filter((c): c is PickCandidate => c != null);
  }, [roster.data, teamId, form.results, todaysGame, opponentId, opponentAbbr, isHome, myMoneylinePrice, projected, totalEdge, snapshot]);

  const active = candidates.find((c) => c.dimension === market) ?? candidates[0];
  const wantOver = directionMark(active?.category ?? '') !== 'U';
  const baseLine = active?.line ?? 0.5;
  const line = Math.max(0, baseLine + lineOffset);
  const isMoneylineMarket = active?.dimension === 'moneyline';
  const isTotalMarket = active?.dimension === 'game-total';

  const scoped = useMemo(() => {
    if (!active) return [];
    let list = active.history;
    if (opponentOnly && opponentId != null) {
      list = list.filter((e) => (rawOf(e).opponentId as number | undefined) === opponentId);
    }
    if (venue !== 'all') list = list.filter((e) => rawOf(e).isHome === (venue === 'home'));
    if (lastN !== 'all') list = list.slice(-lastN);
    return list;
  }, [active, opponentOnly, opponentId, venue, lastN]);

  const measured = useMemo(() => categoriseByLine(scoped, line), [scoped, line]);
  const wanted = wantOver ? OVER : UNDER;

  const windows = useMemo(
    () => ({
      l5: fixedWindow(measured, wanted, 5),
      l10: fixedWindow(measured, wanted, 10),
      l15: fixedWindow(measured, wanted, 15),
      szn: openWindow(measured, wanted, { minimum: 1 }),
      h2h:
        opponentId == null
          ? ({ status: 'insufficient', available: 0, required: 1 } as WindowedStat)
          : subsetWindow(
              categoriseByLine(active?.history ?? [], line),
              wanted,
              (e) => (rawOf(e).opponentId as number | undefined) === opponentId,
              { minimum: 1 },
            ),
    }),
    [measured, wanted, opponentId, active, line],
  );

  const rosterPositions = useMemo(() => {
    if (!roster.data) return [];
    const present = new Set(roster.data.roster.map((p) => p.position));
    return POSITION_ORDER.filter((p) => present.has(p));
  }, [roster.data]);

  const filteredRoster = useMemo(() => {
    if (!roster.data) return [];
    const query = rosterSearch.trim().toLowerCase();
    return roster.data.roster.filter((p) => {
      if (rosterPosition && p.position !== rosterPosition) return false;
      if (query && !p.fullName.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [roster.data, rosterSearch, rosterPosition]);

  const playerCandidateByPersonId = useMemo(() => {
    const map = new Map<number, PickCandidate>();
    for (const c of snapshot?.candidates ?? []) {
      const id = Number(c.subjectId);
      if (Number.isFinite(id) && !map.has(id)) map.set(id, c);
    }
    return map;
  }, [snapshot]);

  if (roster.loading && !roster.data) {
    return (
      <div className="lb-card p-4">
        <div className="h-24 animate-pulse rounded-lg bg-line/30" />
      </div>
    );
  }
  if (roster.error) return <div className="lb-card border-bad/30 bg-bad/5 p-3 text-sm text-bad">{roster.error}</div>;
  if (!roster.data) return <div className="lb-card p-8 text-center text-sm text-ink-muted">Team not found.</div>;

  const team = roster.data;

  return (
    <div className="space-y-3">
      {/* Header — team-color hero wash, same treatment Player/Game Detail use. */}
      <section
        className="lb-card-hero overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${withAlpha(teamPrimaryColor(teamId), '26')} 0%, #ffffff 62%)`,
          borderTop: '3px solid #141619',
        }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <TeamLogo logoUrl={team.logoUrl} abbreviation={team.abbreviation} size={44} />
            <div>
              <h1 className="text-lg font-semibold">{team.teamName}</h1>
              <p className="text-[12px] text-ink-muted">
                {team.record
                  ? `${team.record.wins}-${team.record.losses}${team.record.divisionRank ? ` · ${team.record.divisionRank} in division` : ''}`
                  : 'Record unavailable'}
              </p>
            </div>
          </div>
          {todaysGame ? (
            <Link href={`/mlb/game/${todaysGame.gamePk}`} className="flex items-center gap-1.5 text-[12px] text-masters hover:underline">
              {isHome ? 'vs' : '@'} <TeamLogo abbreviation={opponentAbbr} size={18} /> {opponentAbbr}
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
      {!candidates.length ? (
        <div className="lb-card p-8 text-center text-sm text-ink-muted">No form data available yet for this team.</div>
      ) : !active ? null : (
        <>
          {/* Market tabs */}
          <div className="lb-scroll-x flex gap-1 border-b border-line">
            {candidates.map((c) => (
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
                {isMoneylineMarket ? 'Win' : `${wantOver ? 'O' : 'U'} ${line}`}
              </span>
              <button type="button" onClick={() => setLineOffset((v) => v + 1)} aria-label="Raise the line" className="px-2.5 py-1 text-[15px] leading-none text-ink-muted hover:text-masters">
                +
              </button>
            </div>

            <span className="text-[12px] text-ink-muted">{marketText('mlb', active.dimension, 'full') || active.dimensionLabel}</span>

            {lineOffset === 0 && active.odds ? (
              <OddsChip price={active.odds.americanOdds} source={active.odds.source} capturedAt={active.odds.capturedAt} size="md" />
            ) : lineOffset !== 0 ? (
              <span className="text-[11px] text-ink-faint">No price recorded at this alternate line.</span>
            ) : onAdd ? (
              <GetOddsButton onClick={() => onAdd(active)} label="Add to slip to record a price" />
            ) : null}

            {(isMoneylineMarket && myMoneylineEdge != null) || (isTotalMarket && totalEdge) ? (
              <EdgeBadge
                edge={isMoneylineMarket ? myMoneylineEdge! : totalEdge!.over}
                modelProb={isMoneylineMarket ? (isHome ? moneylineEdge!.homeModelProb : moneylineEdge!.awayModelProb) : totalEdge!.overModelProb}
                marketProb={isMoneylineMarket ? (isHome ? moneylineEdge!.homeMarketProb : moneylineEdge!.awayMarketProb) : totalEdge!.overMarketProb}
                label={isMoneylineMarket ? 'Model' : 'Over'}
              />
            ) : null}

            {lineOffset !== 0 ? (
              <button type="button" onClick={() => setLineOffset(0)} className="text-[11px] text-masters underline">
                Reset to {baseLine}
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
            {opponentId != null ? (
              <FilterChip active={opponentOnly} onClick={() => setOpponentOnly((v) => !v)}>vs {opponentAbbr}</FilterChip>
            ) : null}
            <span className="mx-1 h-4 w-px bg-line" />
            {([5, 10, 15, 'all'] as const).map((n) => (
              <FilterChip key={String(n)} active={lastN === n} onClick={() => setLastN(n)}>
                {n === 'all' ? 'Season' : `Last ${n}`}
              </FilterChip>
            ))}
          </div>

          {/* Window boxes */}
          <div className="lb-scroll-x flex gap-1.5 overflow-x-auto">
            <WindowBox label="L5" stat={windows.l5} />
            <WindowBox label="L10" stat={windows.l10} />
            <WindowBox label="L15" stat={windows.l15} />
            <WindowBox label="H2H" stat={windows.h2h} showCount />
            <WindowBox label="SZN" stat={windows.szn} showCount />
          </div>

          {/* Chart */}
          <section className="lb-card overflow-hidden">
            <div className="flex items-baseline justify-between gap-2 bg-accent-soft px-3 py-1.5">
              <h2 className="text-[12px] font-semibold text-masters">
                {scoped.length} game{scoped.length === 1 ? '' : 's'} in scope
              </h2>
              <span className="text-[10px] text-masters/70">
                green cleared {isMoneylineMarket ? 'a win' : `${wantOver ? 'over' : 'under'} ${line}`}
              </span>
            </div>
            <div className="p-2.5">
              <DistributionChart
                history={scoped}
                line={line}
                wantOver={wantOver}
                refreshKey={`${active.dimension}|${line}|${opponentOnly}|${venue}|${lastN}|${teamId}`}
              />
            </div>
          </section>

          {/* Games table */}
          <section className="lb-card overflow-hidden">
            <div className="flex items-center justify-between gap-2 bg-accent-soft px-2.5 py-1.5">
              <h2 className="text-[12px] font-semibold text-masters">
                {showAllGames ? `All ${scoped.length} games` : `Last ${Math.min(scoped.length, 15)} games`}
              </h2>
              {scoped.length > 15 ? (
                <button type="button" onClick={() => setShowAllGames((v) => !v)} className="text-[11px] font-medium text-masters hover:underline">
                  {showAllGames ? 'Show last 15' : `Show all ${scoped.length}`}
                </button>
              ) : null}
            </div>
            {scoped.length === 0 ? (
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
                      <th className="border-b border-line px-2 py-1 text-right font-semibold text-ink-muted">{isMoneylineMarket ? '' : `vs ${line}`}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...scoped].reverse().slice(0, showAllGames ? undefined : 15).map((entry, index) => {
                      const value = entryValue(entry);
                      const cleared = value != null && (wantOver ? value > line : value <= line);
                      const opponentId = rawOf(entry).opponentId as number | undefined;
                      return (
                        <tr key={index} className="border-b border-line/50">
                          <td className="px-2 py-1 text-left">
                            <span className="flex items-center gap-1.5">
                              <TeamLogo logoUrl={teamLogoUrl(opponentId)} size={16} />
                              {entry.periodLabel}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums font-semibold">
                            {isMoneylineMarket ? (value === 1 ? 'W' : 'L') : (value ?? '—')}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {value == null ? (
                              <span className="text-ink-faint">—</span>
                            ) : (
                              <span className={cleared ? 'text-good' : 'text-ink-faint'}>{cleared ? '✓' : '✗'}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* Pitching matchup / Contact quality matchup toggle — today's starters
          vs. each other (Pitching) or this team's hitting rollup vs. the
          opposing starter (Contact quality). Each option is a full card with
          its own header, so the toggle itself stays a standalone control
          rather than a second, nested card wrapper. */}
      {todaysGame ? (
        <>
          <div className="flex items-center justify-end">
            <SegmentedToggle
              value={matchupView}
              onChange={setMatchupView}
              className="rounded-lg border border-line bg-card p-0.5 text-meta"
              buttonClassName="rounded-md px-2 py-0.5"
              gliderClassName="rounded-md"
              options={[
                { key: 'pitching', label: 'Pitching matchup' },
                { key: 'contact', label: 'Contact quality' },
              ]}
            />
          </div>
          {matchupView === 'pitching' ? (
            <PitchingMatchupCard game={todaysGame} bullpen={bullpen.byTeam} bullpenLoading={bullpen.loading} />
          ) : (
            <BatterPitcherMatchupCard
              title="Contact quality matchup"
              subjectName={team.teamName}
              subjectHeadshotUrl={team.logoUrl}
              subjectTeamAbbr={team.abbreviation}
              subjectTeamLogoUrl={team.logoUrl}
              subjectStats={[...teamStatcast.hitting, ...teamSeasonStatRows(own, statKeys)]}
              opponentName={opponentStarterName ?? 'Opposing starter'}
              opponentHeadshotUrl={opponentId != null ? teamLogoUrl(opponentId) : undefined}
              opponentRoleLabel="Allows"
              opponentTeamAbbr={opponentAbbr}
              opponentTeamLogoUrl={opponentId != null ? teamLogoUrl(opponentId) : undefined}
              opponentStats={opponentStarterStats ?? []}
            />
          )}
        </>
      ) : null}

      {/* Team stats — only for teams playing today, same league-wide comparison Game Detail uses. Two splits: per-game rate (adapter.ts's `perGame` — counting stats divided by games played so teams with different game counts compare fairly) and the real season total/rate alongside it, so neither framing has to stand in for the other. */}
      {todaysGame && own ? (
        <section className="lb-card overflow-hidden">
          <h2 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Team stats</h2>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Per game</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                {statKeys.map((s) => (
                  <div key={s.key} className="flex items-baseline justify-between gap-2">
                    <span className="text-ink-faint">{s.label}</span>
                    <span className="font-semibold tabular-nums">
                      {own.forStats[s.key] != null ? own.forStats[s.key]!.toFixed(s.decimals) : '—'}
                      <span className="ml-1 text-[10px] font-normal text-ink-faint">{own.forRanks[s.key] ?? ''}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Season</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                {statKeys.map((s) => (
                  <div key={s.key} className="flex items-baseline justify-between gap-2">
                    <span className="text-ink-faint">{s.label}</span>
                    <span className="font-semibold tabular-nums">
                      {own.forStatsSeason[s.key] != null ? own.forStatsSeason[s.key]!.toFixed(s.decimals) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Roster — search + position filter */}
      <section className="lb-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-accent-soft px-3 py-1.5">
          <h2 className="text-[10.5px] font-bold uppercase tracking-wide text-masters">
            Roster ({filteredRoster.length}{filteredRoster.length !== team.roster.length ? ` of ${team.roster.length}` : ''})
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
        {rosterPositions.length > 1 ? (
          <div className="lb-scroll-x mb-2 flex gap-1.5">
            <FilterChip active={rosterPosition === null} onClick={() => setRosterPosition(null)}>All</FilterChip>
            {rosterPositions.map((p) => (
              <FilterChip key={p} active={rosterPosition === p} onClick={() => setRosterPosition(rosterPosition === p ? null : p)}>
                {p}
              </FilterChip>
            ))}
          </div>
        ) : null}
        {filteredRoster.length === 0 ? (
          <p className="p-4 text-center text-[12px] text-ink-muted">No players match.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {filteredRoster.map((p) => {
              const candidate = playerCandidateByPersonId.get(p.id);
              const gamePk = (candidate?.subjectMeta as Record<string, unknown> | undefined)?.gamePk as string | number | undefined;
              const rank = !p.isPitcher ? batterRanks.byPersonId.get(p.id) : undefined;
              const content = (
                <>
                  <SubjectAvatar name={p.fullName} headshotUrl={p.headshotUrl} fallbackUrl={team.logoUrl} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium">{p.fullName}</span>
                      <span className="lb-chip bg-ink/5 text-[10px] text-ink-muted">{p.position}</span>
                      {rank?.overallRank != null ? (
                        <span
                          className="lb-chip bg-accent-soft text-[10px] font-semibold text-masters"
                          title={`Quality of contact: ${ordinal(rank.overallRank)} of ${rank.poolSize} overall, ${
                            rank.positionRank != null ? `${ordinal(rank.positionRank)} of ${rank.positionPoolSize} at ${rank.position}` : 'position rank unavailable'
                          }`}
                        >
                          #{rank.overallRank}
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-[11px] text-ink-faint">{seasonLineText(p)}</p>
                  </div>
                </>
              );
              if (candidate && gamePk != null) {
                return (
                  <li key={p.id}>
                    <Link
                      href={`/mlb/game/${gamePk}?player=${p.id}&market=${candidate.dimension}`}
                      className="flex items-center gap-2 rounded-lg border border-transparent p-1.5 transition-colors hover:bg-ink/[0.03]"
                    >
                      {content}
                    </Link>
                  </li>
                );
              }
              return (
                <li key={p.id} className="flex items-center gap-2 rounded-lg p-1.5 opacity-70">
                  {content}
                </li>
              );
            })}
          </ul>
        )}
        </div>
      </section>

      {/* Standings — AL/NL, every division, this team's row highlighted. Stays
          in the main column, not the rail — a full standings table needs
          more than 260px, and putting a second, condensed copy in the rail
          would just be the same information twice. */}
      <section>
        <h2 className="mb-2 rounded-lg bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Standings</h2>
        <StandingsTables teams={standingsTeams} loading={standingsLoading} highlightTeamId={teamId} />
      </section>
      </div>

      {/* Context rail — sticky at lg+, stacks below the main column on mobile. */}
      <div className="space-y-3 lg:sticky lg:top-4">
        {todaysGame ? (
          <section className="lb-card overflow-hidden">
            <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Next game</h3>
            <div className="space-y-1.5 p-3 text-[10.5px]">
              {projected?.moneyline ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <TeamLogo logoUrl={teamLogoUrl(todaysGame.awayTeamId)} size={14} /> {todaysGame.matchup?.split('@')[0]?.trim()} ML
                    </span>
                    <span className="font-semibold text-ink">{projected.moneyline.away}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <TeamLogo logoUrl={teamLogoUrl(todaysGame.homeTeamId)} size={14} /> {todaysGame.matchup?.split('@')[1]?.trim()} ML
                    </span>
                    <span className="font-semibold text-ink">{projected.moneyline.home}</span>
                  </div>
                </>
              ) : null}
              {projected?.total?.point != null ? (
                <div className="flex items-center justify-between border-t border-line-hair pt-1.5">
                  <span className="text-ink-muted">Total {projected.total.point}</span>
                  <span className="font-semibold text-ink">O {projected.total.overPrice}</span>
                </div>
              ) : null}
              {!projected?.moneyline && projected?.total?.point == null ? <p className="text-ink-faint">No line yet.</p> : null}
            </div>
          </section>
        ) : null}

        {/* Advanced stats — Statcast quality-of-contact rollup, hitting + pitching, ranked among all 30 teams. Only in the rail — the season team stats card in the main column already covers traditional counting stats, so this doesn't need a second copy there too. */}
        {teamStatcast.hitting.length > 0 || teamStatcast.pitching.length > 0 ? (
          <section className="lb-card overflow-hidden">
            <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Advanced stats</h3>
            <div className="space-y-3 p-3">
              {teamStatcast.hitting.length > 0 ? (
                <div>
                  <h4 className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Hitting</h4>
                  <div className="space-y-1.5">
                    {teamStatcast.hitting.map((s) => (
                      <StatRankRow key={s.key} stat={s} />
                    ))}
                  </div>
                </div>
              ) : null}
              {teamStatcast.pitching.length > 0 ? (
                <div>
                  <h4 className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Pitching</h4>
                  <div className="space-y-1.5">
                    {teamStatcast.pitching.map((s) => (
                      <StatRankRow key={s.key} stat={s} />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
      </div>
    </div>
  );
}

export default TeamDetail;
