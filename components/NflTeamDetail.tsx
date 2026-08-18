'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { PickCandidate } from '@/lib/core/types';
import {
  categoriseByLine,
  entryValue,
  fixedWindow,
  openWindow,
  subsetWindow,
  isOk,
  OVER,
  UNDER,
  type WindowedStat,
} from '@/lib/core/windowedStat';
import { DistributionChart, WindowBox, FilterChip, type OpposingStarterStat } from './PlayerDetail';
import { StatRankRow } from './StatRankRow';
import { SegmentedToggle } from './SegmentedToggle';
import { marketText, directionMark } from './MarketLabel';
import { OddsChip, GetOddsButton } from './OddsChip';
import { SubjectAvatar, TeamLogo, nflTeamLogoUrl } from './SubjectAvatar';
import { StandingsTables } from './StandingsTables';
import { BatterPitcherMatchupCard, type BatterPitcherMatchupProps } from './BatterPitcherMatchupCard';
import { NflPlayerVsDefenseCard, MATCHUP_GROUP_BY_POSITION, playerMatchupRows } from './NflPlayerVsDefenseCard';
import { teamPrimaryColor, withAlpha } from '@/lib/sports/nfl/teamColors';
import type { PlayerSeasonStats } from '@/lib/sports/nfl/nflverse';
import type { TeamStandingRow } from './useAllTeams';
import { GradeChip } from './NflGameHeroCard';
import type { TeamGrades } from '@/lib/sports/nfl/nflTeamGrades';

/** Matchup group -> the opponent defense grade that group actually measures. Passing and Receiving both come down to coverage (secondary); Rushing comes down to the front (D-line). Small and mechanical, same spirit as MATCHUP_GROUP_BY_POSITION itself. */
const GROUP_TO_GRADE_KEY: Record<string, { key: keyof TeamGrades; label: string }> = {
  Passing: { key: 'secondary', label: 'Pass D' },
  Rushing: { key: 'dLine', label: 'Run D' },
  Receiving: { key: 'secondary', label: 'Pass D' },
};

interface NflvTeamStatLine {
  key: string;
  label: string;
  value: number;
  rank: number;
  decimals: number;
  group?: string;
}

interface RosterPlayer {
  subjectId: string;
  fullName: string;
  position: string | null;
  headshotUrl: string | null;
  seasonStats: PlayerSeasonStats | null;
  positionRank: number | null;
  positionPoolSize: number | null;
  sideOfBallRank: number | null;
  sideOfBallPoolSize: number | null;
}

interface RecentResult {
  gameId: string;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
}

interface TeamDetailApiResponse {
  team: { teamId: string; abbreviation: string; displayName: string; logoUrl: string | null; wins: number; losses: number };
  roster: RosterPlayer[];
  recentResults: RecentResult[];
  teamStats: NflvTeamStatLine[];
  nextGame: { gameId: string; gameday: string; homeTeam: string; awayTeam: string } | null;
  opponentAbbr: string | null;
  opponentDefenseAllowed: NflvTeamStatLine[];
  grades: TeamGrades | null;
  opponentGrades: TeamGrades | null;
  candidates: { moneyline: PickCandidate | null; total: PickCandidate | null; teamTotal: PickCandidate | null };
}

const NFL_TEAM_COUNT = 32;
const POSITION_ORDER = ['QB', 'RB', 'FB', 'WR', 'TE', 'K', 'OL', 'DL', 'LB', 'DB', 'S', 'CB'];

/** Which of a team's/opponent's stat groups a skill position's own matchup rows should be compared against — a QB's real opponent is the pass defense, not the run defense. */
function toStatRow(l: NflvTeamStatLine): OpposingStarterStat {
  return { key: l.key, label: l.label, value: l.value, decimals: l.decimals, rank: l.rank, poolSize: NFL_TEAM_COUNT };
}

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

function seasonLineText(p: RosterPlayer): string {
  const s = p.seasonStats;
  if (!s || s.games === 0) return 'No stats yet this season';
  switch (p.position) {
    case 'QB':
      return `${s.passingYards} pass yds · ${s.passingTds} pass TD`;
    case 'RB':
    case 'FB':
      return `${s.rushingYards} rush yds · ${s.rushingTds} rush TD`;
    case 'WR':
    case 'TE':
      return `${s.receptions} rec · ${s.receivingYards} rec yds`;
    default:
      return `${s.games} games played`;
  }
}

export interface NflTeamDetailProps {
  teamId: number;
  standingsTeams: TeamStandingRow[];
  standingsLoading?: boolean;
  onAdd?: (candidate: PickCandidate, oddsInfo?: { americanOdds: string; source: string }) => void;
  addedKeys?: Set<string>;
}

export function NflTeamDetail({ teamId, standingsTeams, standingsLoading, onAdd, addedKeys }: NflTeamDetailProps) {
  const [data, setData] = useState<TeamDetailApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [market, setMarket] = useState<string | undefined>(undefined);
  const [lineOffset, setLineOffset] = useState(0);
  const [opponentOnly, setOpponentOnly] = useState(false);
  const [venue, setVenue] = useState<'all' | 'home' | 'away'>('all');
  const [lastN, setLastN] = useState<number | 'all'>('all');
  const [showAllGames, setShowAllGames] = useState(false);
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterPosition, setRosterPosition] = useState<string | null>(null);
  const [rosterShowAll, setRosterShowAll] = useState(false);
  const [matchupView, setMatchupView] = useState<'team' | 'player'>('team');
  const [matchupPlayerId, setMatchupPlayerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/nfl/team/${teamId}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) setError(json.detail ?? json.error);
        else setData(json);
      })
      .catch((err) => { if (!cancelled) setError(String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [teamId]);

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
    setMatchupView('team');
    setMatchupPlayerId(null);
  }, [teamId]);

  // A filter change should re-collapse the list too — "show more" against
  // one search/position scope shouldn't silently carry over to the next.
  useEffect(() => {
    setRosterShowAll(false);
  }, [rosterSearch, rosterPosition]);

  const candidates = useMemo(() => {
    if (!data) return [];
    return [data.candidates.moneyline, data.candidates.total, data.candidates.teamTotal].filter(
      (c): c is PickCandidate => c != null,
    );
  }, [data]);

  const active = candidates.find((c) => c.dimension === market) ?? candidates[0];
  const wantOver = directionMark(active?.category ?? '') !== 'U';
  const baseLine = active?.line ?? 0.5;
  const line = Math.max(0, baseLine + lineOffset);
  const isMoneylineMarket = active?.dimension === 'moneyline';
  const opponentAbbr = data?.opponentAbbr ?? null;

  const scoped = useMemo(() => {
    if (!active) return [];
    let list = active.history;
    if (opponentOnly && opponentAbbr) {
      list = list.filter((e) => (rawOf(e).opponentAbbr as string | undefined) === opponentAbbr);
    }
    if (venue !== 'all') list = list.filter((e) => rawOf(e).isHome === (venue === 'home'));
    if (lastN !== 'all') list = list.slice(-lastN);
    return list;
  }, [active, opponentOnly, opponentAbbr, venue, lastN]);

  const measured = useMemo(() => categoriseByLine(scoped, line), [scoped, line]);
  const wanted = wantOver ? OVER : UNDER;

  const windows = useMemo(
    () => ({
      l5: fixedWindow(measured, wanted, 5),
      l10: fixedWindow(measured, wanted, 10),
      l15: fixedWindow(measured, wanted, 15),
      szn: openWindow(measured, wanted, { minimum: 1 }),
      h2h:
        !opponentAbbr
          ? ({ status: 'insufficient', available: 0, required: 1 } as WindowedStat)
          : subsetWindow(
              categoriseByLine(active?.history ?? [], line),
              wanted,
              (e) => (rawOf(e).opponentAbbr as string | undefined) === opponentAbbr,
              { minimum: 1 },
            ),
    }),
    [measured, wanted, opponentAbbr, active, line],
  );

  const rosterPositions = useMemo(() => {
    if (!data) return [];
    const present = new Set(data.roster.map((p) => p.position).filter((p): p is string => !!p));
    return POSITION_ORDER.filter((p) => present.has(p));
  }, [data]);

  const filteredRoster = useMemo(() => {
    if (!data) return [];
    const query = rosterSearch.trim().toLowerCase();
    const filtered = data.roster.filter((p) => {
      if (rosterPosition && p.position !== rosterPosition) return false;
      if (query && !p.fullName.toLowerCase().includes(query)) return false;
      return true;
    });
    // Players with real recorded stats first — a 97-man roster is mostly
    // inactive/practice-squad names with "No stats yet this season", and
    // burying every skill player who's actually played under those made the
    // list read as flat, undifferentiated noise.
    return [...filtered].sort((a, b) => {
      const aHas = a.seasonStats && a.seasonStats.games > 0 ? 1 : 0;
      const bHas = b.seasonStats && b.seasonStats.games > 0 ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      return a.fullName.localeCompare(b.fullName);
    });
  }, [data, rosterSearch, rosterPosition]);

  const ROSTER_PAGE_SIZE = 24;
  const visibleRoster = rosterShowAll ? filteredRoster : filteredRoster.slice(0, ROSTER_PAGE_SIZE);

  // Skill-position players only — the ones the picker and player-mode card can actually say anything about.
  const matchupEligibleRoster = useMemo(
    () =>
      (data?.roster ?? []).filter(
        (p) => p.position && MATCHUP_GROUP_BY_POSITION[p.position] && p.seasonStats && p.seasonStats.games > 0,
      ),
    [data],
  );

  const defaultMatchupPlayer = useMemo(() => {
    if (matchupEligibleRoster.length === 0) return null;
    const qb = matchupEligibleRoster.find((p) => p.position === 'QB');
    if (qb) return qb;
    return [...matchupEligibleRoster].sort(
      (a, b) =>
        (b.seasonStats!.receivingYards + b.seasonStats!.rushingYards) -
        (a.seasonStats!.receivingYards + a.seasonStats!.rushingYards),
    )[0];
  }, [matchupEligibleRoster]);

  const matchupPlayer = matchupEligibleRoster.find((p) => p.subjectId === matchupPlayerId) ?? defaultMatchupPlayer;

  if (loading && !data) {
    return (
      <div className="lb-card overflow-hidden">
        <div className="lb-skel h-7 w-full" />
        <div className="space-y-2 p-3">
          <div className="lb-skel h-14 w-full rounded-lg" />
          <div className="lb-skel h-24 w-full rounded-lg" />
        </div>
      </div>
    );
  }
  if (error) return <div className="lb-card border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</div>;
  if (!data) return null;

  const { team, teamStats, nextGame, opponentDefenseAllowed, recentResults, grades, opponentGrades } = data;
  const logoUrl = team.logoUrl ?? nflTeamLogoUrl(team.abbreviation);

  const passingStats = teamStats.filter((s) => s.group === 'Passing');
  const rushingStats = teamStats.filter((s) => s.group === 'Rushing');
  const receivingStats = teamStats.filter((s) => s.group === 'Receiving');
  const scoringStats = teamStats.filter((s) => s.group === 'Scoring');
  const defenseStats = teamStats.filter((s) => s.group === 'Defense');

  const opponentPassingAllowed = opponentDefenseAllowed.filter((s) => s.group === 'Passing');
  const opponentRushingAllowed = opponentDefenseAllowed.filter((s) => s.group === 'Rushing');
  const opponentReceivingAllowed = opponentDefenseAllowed.filter((s) => s.group === 'Receiving');

  const teamMatchupProps: BatterPitcherMatchupProps | null =
    opponentAbbr && opponentDefenseAllowed.length > 0
      ? {
          title: 'Team matchup — offense vs. defense',
          subjectName: team.displayName,
          subjectHeadshotUrl: logoUrl,
          subjectTeamAbbr: team.abbreviation,
          subjectTeamLogoUrl: logoUrl,
          subjectStats: [...passingStats, ...rushingStats, ...receivingStats].map(toStatRow),
          subjectRoleLabel: 'Produces',
          opponentName: `${opponentAbbr} defense`,
          opponentHeadshotUrl: nflTeamLogoUrl(opponentAbbr),
          opponentTeamAbbr: opponentAbbr,
          opponentTeamLogoUrl: nflTeamLogoUrl(opponentAbbr),
          opponentStats: opponentDefenseAllowed.map(toStatRow),
          opponentRoleLabel: 'Allows',
        }
      : null;

  const matchupPlayerGroups = matchupPlayer?.position ? MATCHUP_GROUP_BY_POSITION[matchupPlayer.position] ?? [] : [];
  const matchupPlayerOpponentStats = [
    ...(matchupPlayerGroups.includes('Passing') ? opponentPassingAllowed : []),
    ...(matchupPlayerGroups.includes('Rushing') ? opponentRushingAllowed : []),
    ...(matchupPlayerGroups.includes('Receiving') ? opponentReceivingAllowed : []),
  ].map(toStatRow);
  const matchupPlayerOwnRows = matchupPlayer ? playerMatchupRows(matchupPlayer.seasonStats, matchupPlayer.position) : [];

  // Matchup grade badges — team mode headlines the opponent's overall
  // defense grade; player mode headlines whichever of the opponent's
  // defense grades the player's own matchup groups actually measure
  // (deduped — a WR/TE's Passing+Receiving groups both map to secondary).
  const playerMatchupGradeBadges = [
    ...new Map(matchupPlayerGroups.map((g) => GROUP_TO_GRADE_KEY[g]).filter(Boolean).map((g) => [g.key, g])).values(),
  ];

  return (
    <div className="space-y-3">
      <section
        className="lb-card-hero overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${withAlpha(teamPrimaryColor(team.abbreviation), '26')} 0%, #ffffff 62%)`,
          borderTop: '3px solid #141619',
        }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <TeamLogo logoUrl={logoUrl} abbreviation={team.abbreviation} size={44} />
            <div>
              <h1 className="text-lg font-semibold">{team.displayName}</h1>
              <p className="text-[12px] text-ink-muted">{team.wins}-{team.losses}</p>
              {grades ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  <GradeChip label="OFF" grade={grades.offense} />
                  <GradeChip label="DEF" grade={grades.defense} />
                  <GradeChip label="ST" grade={grades.specialTeams} />
                </div>
              ) : null}
            </div>
          </div>
          {nextGame && opponentAbbr ? (
            <Link href={`/nfl/game/${nextGame.gameId}`} className="flex items-center gap-1.5 text-[12px] text-masters hover:underline">
              vs <TeamLogo logoUrl={nflTeamLogoUrl(opponentAbbr)} size={18} /> {opponentAbbr}
              <span className="text-ink-faint">→</span>
            </Link>
          ) : (
            <span className="text-[12px] text-ink-faint">No game scheduled</span>
          )}
        </div>
      </section>

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
                onClick={() => { setLineOffset(0); setShowAllGames(false); setMarket(c.dimension); }}
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

            <span className="text-[12px] text-ink-muted">{marketText('nfl', active.dimension, 'full') || active.dimensionLabel}</span>

            {lineOffset === 0 && active.odds ? (
              <OddsChip price={active.odds.americanOdds} source={active.odds.source} capturedAt={active.odds.capturedAt} size="md" />
            ) : lineOffset !== 0 ? (
              <span className="text-[11px] text-ink-faint">No price recorded at this alternate line.</span>
            ) : onAdd ? (
              <GetOddsButton onClick={() => onAdd(active)} label="Add to slip to record a price" />
            ) : (
              <span className="text-[11px] text-ink-faint">No price yet — no live NFL game-line source wired up.</span>
            )}

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
            {opponentAbbr ? (
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
                logoFor={(entry) => nflTeamLogoUrl(rawOf(entry).opponentAbbr as string | undefined)}
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
                      <th className="whitespace-nowrap border-b border-line px-2 py-1 text-left font-semibold text-ink-muted">Game</th>
                      <th className="whitespace-nowrap border-b border-line px-2 py-1 text-right font-semibold text-ink-muted">
                        {isMoneylineMarket ? 'Result' : 'Value'}
                      </th>
                      <th className="whitespace-nowrap border-b border-line px-2 py-1 text-right font-semibold text-ink-muted">{isMoneylineMarket ? '' : `vs ${line}`}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...scoped].reverse().slice(0, showAllGames ? undefined : 15).map((entry, index) => {
                      const value = entryValue(entry);
                      const cleared = value != null && (wantOver ? value > line : value <= line);
                      const oppAbbr = rawOf(entry).opponentAbbr as string | undefined;
                      return (
                        <tr key={index} className="border-b border-line/50 transition-colors hover:bg-surface-subtle">
                          <td className="px-2 py-1 text-left">
                            <span className="flex items-center gap-1.5">
                              <TeamLogo logoUrl={nflTeamLogoUrl(oppAbbr)} size={16} />
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

      {/* Matchup — team offense vs. opponent defense, or one skill-position
          player's own numbers against the same opponent group. Two mounts of
          the same comparison, same shape a stat pool always takes here: solo
          numbers side by side, since NFL's offense/defense stat keys don't
          overlap the way MLB's shared Statcast rates do. */}
      {opponentAbbr ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SegmentedToggle
              value={matchupView}
              onChange={setMatchupView}
              className="rounded-lg border border-line bg-card p-0.5 text-meta"
              buttonClassName="rounded-md px-2 py-0.5"
              gliderClassName="rounded-md"
              options={[
                { key: 'team', label: 'Team matchup' },
                { key: 'player', label: 'Player matchup' },
              ]}
            />
            {matchupView === 'player' && matchupEligibleRoster.length > 0 ? (
              <select
                value={matchupPlayer?.subjectId ?? ''}
                onChange={(e) => setMatchupPlayerId(e.target.value)}
                aria-label="Pick a player"
                className="rounded-lg border border-line bg-card px-2 py-1 text-[12px] focus:border-masters focus:outline-none"
              >
                {matchupEligibleRoster.map((p) => (
                  <option key={p.subjectId} value={p.subjectId}>{p.fullName} ({p.position})</option>
                ))}
              </select>
            ) : null}
          </div>

          {matchupView === 'team' && opponentGrades ? (
            <div className="flex flex-wrap gap-1">
              <GradeChip label={`${opponentAbbr} DEF`} grade={opponentGrades.defense} />
            </div>
          ) : matchupView === 'player' && opponentGrades && playerMatchupGradeBadges.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {playerMatchupGradeBadges.map((g) => (
                <GradeChip key={g.key} label={`${opponentAbbr} ${g.label}`} grade={opponentGrades[g.key]} />
              ))}
            </div>
          ) : null}

          {matchupView === 'team' ? (
            teamMatchupProps ? (
              <BatterPitcherMatchupCard {...teamMatchupProps} />
            ) : (
              <div className="lb-card p-6 text-center text-sm text-ink-muted">No opponent stats available yet.</div>
            )
          ) : matchupPlayer ? (
            <NflPlayerVsDefenseCard
              playerName={matchupPlayer.fullName}
              playerHeadshotUrl={matchupPlayer.headshotUrl ?? undefined}
              playerFallbackUrl={logoUrl}
              playerTeamAbbr={team.abbreviation}
              playerTeamLogoUrl={logoUrl}
              ownRows={matchupPlayerOwnRows}
              opponentAbbr={opponentAbbr}
              opponentLogoUrl={nflTeamLogoUrl(opponentAbbr)}
              opponentStats={matchupPlayerOpponentStats}
            />
          ) : (
            <div className="lb-card p-6 text-center text-sm text-ink-muted">No skill-position players with season stats yet.</div>
          )}
        </>
      ) : null}

      {/* Team stats — grouped, ranked among all 32 teams. */}
      {teamStats.length > 0 ? (
        <section className="lb-card overflow-hidden">
          <h2 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Team stats</h2>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
            {[
              { label: 'Scoring', rows: scoringStats, gradeKey: null },
              { label: 'Passing', rows: passingStats, gradeKey: 'passingOffense' as const },
              { label: 'Rushing', rows: rushingStats, gradeKey: 'rushingOffense' as const },
              { label: 'Receiving', rows: receivingStats, gradeKey: 'receivingOffense' as const },
              { label: 'Defense', rows: defenseStats, gradeKey: 'defense' as const },
            ]
              .filter((g) => g.rows.length > 0)
              .map((g) => (
                <div key={g.label}>
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">{g.label}</span>
                    {g.gradeKey && grades?.[g.gradeKey] ? <GradeChip label="" grade={grades[g.gradeKey]} /> : null}
                  </div>
                  <div className="space-y-1.5">
                    {g.rows.map((s) => <StatRankRow key={s.key} stat={toStatRow(s)} />)}
                  </div>
                </div>
              ))}
          </div>
        </section>
      ) : null}

      {/* Roster — search + position filter, real headshots, real season stat lines. */}
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
            <>
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {visibleRoster.map((p) => (
                  <li key={p.subjectId}>
                    <Link
                      href={`/nfl/player/${encodeURIComponent(p.subjectId)}`}
                      className="flex items-center gap-2 rounded-lg border border-line/50 bg-card p-1.5 transition-colors hover:border-masters/30 hover:bg-ink/[0.03]"
                    >
                      <SubjectAvatar name={p.fullName} headshotUrl={p.headshotUrl ?? undefined} fallbackUrl={logoUrl} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium">{p.fullName}</span>
                          {p.position ? <span className="lb-chip bg-ink/5 text-[10px] text-ink-muted">{p.position}</span> : null}
                          {p.positionRank != null && p.positionPoolSize != null ? (
                            <span
                              className="lb-chip bg-masters/10 text-[10px] font-semibold text-masters"
                              title={`${p.positionRank} of ${p.positionPoolSize} ${p.position ?? ''}`}
                            >
                              #{p.positionRank}
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-[11px] text-ink-faint">{seasonLineText(p)}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {filteredRoster.length > ROSTER_PAGE_SIZE ? (
                <div className="mt-2 text-center">
                  <button
                    type="button"
                    onClick={() => setRosterShowAll((v) => !v)}
                    className="text-[12px] font-medium text-masters hover:underline"
                  >
                    {rosterShowAll ? 'Show fewer players' : `Show ${filteredRoster.length - ROSTER_PAGE_SIZE} more players`}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 rounded-lg bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Standings</h2>
        <StandingsTables teams={standingsTeams} loading={standingsLoading} highlightTeamId={teamId} />
      </section>
      </div>

      {/* Context rail */}
      <div className="space-y-3 lg:sticky lg:top-4">
        {active ? (
          <section className="lb-card overflow-hidden">
            <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Form</h3>
            <ul className="space-y-1.5 p-3 text-[12px]">
              {([
                ['Last 5', windows.l5],
                ['Last 10', windows.l10],
                ['Last 15', windows.l15],
                [opponentAbbr ? `vs ${opponentAbbr}` : 'H2H', windows.h2h],
              ] as const).map(([label, stat]) => (
                <li key={label} className="flex items-baseline justify-between gap-2">
                  <span className="text-ink-muted">{label}</span>
                  <span className="font-semibold tabular-nums">
                    {isOk(stat) ? `${Math.round(stat.rate * 100)}%` : `${stat.available} of ${stat.required}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {nextGame ? (
          <section className="lb-card overflow-hidden">
            <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Next game</h3>
            <div className="space-y-1.5 p-3 text-[10.5px]">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <TeamLogo logoUrl={nflTeamLogoUrl(nextGame.awayTeam)} size={14} /> {nextGame.awayTeam}
                </span>
                <span className="text-ink-faint">@</span>
                <span className="flex items-center gap-1.5 text-ink-muted">
                  {nextGame.homeTeam} <TeamLogo logoUrl={nflTeamLogoUrl(nextGame.homeTeam)} size={14} />
                </span>
              </div>
              <p className="text-ink-faint">{nextGame.gameday}</p>
              {!active?.odds ? <p className="text-ink-faint">No live line yet.</p> : null}
            </div>
          </section>
        ) : (
          <section className="lb-card p-3 text-[11px] text-ink-faint">No upcoming game scheduled.</section>
        )}

        {recentResults.length > 0 ? (
          <section className="lb-card overflow-hidden">
            <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Recent results</h3>
            <ul className="space-y-1.5 p-3 text-[10.5px]">
              {recentResults.slice(0, 5).map((g) => {
                const isHomeGame = g.homeTeam === team.abbreviation;
                const oppAbbr = isHomeGame ? g.awayTeam : g.homeTeam;
                const own = isHomeGame ? g.homeScore : g.awayScore;
                const opp = isHomeGame ? g.awayScore : g.homeScore;
                const won = own != null && opp != null && own > opp;
                return (
                  <li key={g.gameId} className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <TeamLogo logoUrl={nflTeamLogoUrl(oppAbbr)} size={14} /> {isHomeGame ? 'vs' : '@'} {oppAbbr}
                    </span>
                    <span className={`font-semibold ${won ? 'text-good' : 'text-ink-faint'}`}>
                      {own != null && opp != null ? `${won ? 'W' : 'L'} ${own}-${opp}` : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
      </div>
    </div>
  );
}

export default NflTeamDetail;
