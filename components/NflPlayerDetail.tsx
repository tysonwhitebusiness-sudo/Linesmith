'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PickCandidate, SportSnapshot } from '@/lib/core/types';
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
import { DistributionChart, WindowBox, FilterChip, ordinal, type OpposingStarterStat } from './PlayerDetail';
import { StatRankRow } from './StatRankRow';
import { marketText, directionMark } from './MarketLabel';
import { OddsChip, GetOddsButton } from './OddsChip';
import { SubjectAvatar, TeamLogo, nflTeamLogoUrl } from './SubjectAvatar';
import { NflPlayerVsDefenseCard, MATCHUP_GROUP_BY_POSITION, playerMatchupRows } from './NflPlayerVsDefenseCard';
import { PropOddsBoard } from './PropOddsPanel';
import { usePropOdds } from './usePropOdds';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import { teamPrimaryColor, withAlpha } from '@/lib/sports/nfl/teamColors';
import type { UnifiedLinesResult } from '@/lib/odds/types';
import type { PlayerSeasonStats, PlayerSeasonRank } from '@/lib/sports/nfl/nflverse';

// Position -> side of ball, for the header's "#N of M {side}" line. Small,
// local duplicate of nflPlayerRankings.ts's own table rather than an import
// — that file pulls in lib/db/client.ts (better-sqlite3), which can't reach
// a 'use client' component's bundle (same reasoning MATCHUP_GROUP_BY_POSITION
// is already duplicated between adapter.ts and NflPlayerVsDefenseCard.tsx).
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

/** Real per-game box-score columns, position-gated — history[].raw already carries all of these (adapter.ts), this just decides which are worth a column for this player. */
const GAMELOG_COLUMNS_BY_POSITION: Record<string, Array<{ key: string; label: string }>> = {
  QB: [
    { key: 'completions', label: 'Cmp' },
    { key: 'attempts', label: 'Att' },
    { key: 'passingYards', label: 'Pass Yds' },
    { key: 'passingTds', label: 'Pass TD' },
    { key: 'interceptions', label: 'INT' },
    { key: 'rushingYards', label: 'Rush Yds' },
  ],
  RB: [
    { key: 'carries', label: 'Car' },
    { key: 'rushingYards', label: 'Rush Yds' },
    { key: 'rushingTds', label: 'Rush TD' },
    { key: 'receptions', label: 'Rec' },
    { key: 'receivingYards', label: 'Rec Yds' },
  ],
  FB: [
    { key: 'carries', label: 'Car' },
    { key: 'rushingYards', label: 'Rush Yds' },
    { key: 'rushingTds', label: 'Rush TD' },
    { key: 'receptions', label: 'Rec' },
    { key: 'receivingYards', label: 'Rec Yds' },
  ],
  WR: [
    { key: 'targets', label: 'Tgt' },
    { key: 'receptions', label: 'Rec' },
    { key: 'receivingYards', label: 'Rec Yds' },
    { key: 'receivingTds', label: 'Rec TD' },
  ],
  TE: [
    { key: 'targets', label: 'Tgt' },
    { key: 'receptions', label: 'Rec' },
    { key: 'receivingYards', label: 'Rec Yds' },
    { key: 'receivingTds', label: 'Rec TD' },
  ],
};

type SeasonRankMap = Partial<Record<'passingYards' | 'passingTds' | 'rushingYards' | 'rushingTds' | 'receptions' | 'receivingYards' | 'receivingTds', PlayerSeasonRank>>;

/** Real season totals, position-gated — the "Season stats" card's rows. `rank` is a real rank among every same-position player who recorded the stat (nflverse.ts's `getPlayerSeasonRanksByGsis`); omitted (not fabricated) for "Games" and for any stat a rank couldn't be computed for. */
interface SeasonStatRow { key: string; label: string; value: number; rank?: PlayerSeasonRank }

function seasonTotalsRows(seasonStats: PlayerSeasonStats | undefined, position: string | undefined, seasonRanks: SeasonRankMap | undefined): SeasonStatRow[] {
  if (!seasonStats) return [];
  const r = (key: keyof SeasonRankMap, label: string, value: number): SeasonStatRow => ({ key, label, value, rank: seasonRanks?.[key] });
  switch (position) {
    case 'QB':
      return [
        { key: 'games', label: 'Games', value: seasonStats.games },
        r('passingYards', 'Pass Yds', seasonStats.passingYards),
        r('passingTds', 'Pass TD', seasonStats.passingTds),
        r('rushingYards', 'Rush Yds', seasonStats.rushingYards),
        r('rushingTds', 'Rush TD', seasonStats.rushingTds),
      ];
    case 'RB':
    case 'FB':
      return [
        { key: 'games', label: 'Games', value: seasonStats.games },
        r('rushingYards', 'Rush Yds', seasonStats.rushingYards),
        r('rushingTds', 'Rush TD', seasonStats.rushingTds),
        r('receptions', 'Receptions', seasonStats.receptions),
        r('receivingYards', 'Rec Yds', seasonStats.receivingYards),
      ];
    case 'WR':
    case 'TE':
      return [
        { key: 'games', label: 'Games', value: seasonStats.games },
        r('receptions', 'Receptions', seasonStats.receptions),
        r('receivingYards', 'Rec Yds', seasonStats.receivingYards),
        r('receivingTds', 'Rec TD', seasonStats.receivingTds),
      ];
    default:
      return [{ key: 'games', label: 'Games', value: seasonStats.games }];
  }
}

export interface NflPlayerDetailProps {
  /** Every candidate for this player, across markets. */
  candidates: PickCandidate[];
  snapshot: SportSnapshot | null;
  odds: UnifiedLinesResult | null;
  market?: string;
  onMarketChange?: (market: string) => void;
  onAdd?: (candidate: PickCandidate, oddsInfo?: { americanOdds: string; source: string; bookmaker?: string }) => void;
  addedKeys?: Set<string>;
}

export function NflPlayerDetail({ candidates, snapshot, odds: _odds, market, onMarketChange, onAdd, addedKeys }: NflPlayerDetailProps) {
  const active = candidates.find((c) => c.dimension === market) ?? candidates[0];

  const [lineOffset, setLineOffset] = useState(0);
  const [opponentOnly, setOpponentOnly] = useState(false);
  const [lastN, setLastN] = useState<number | 'all'>('all');
  const [showAllGames, setShowAllGames] = useState(false);

  useEffect(() => {
    setLineOffset(0);
    setOpponentOnly(false);
    setLastN('all');
    setShowAllGames(false);
  }, [active?.subjectId]);

  const meta = (active?.subjectMeta ?? {}) as Record<string, unknown>;
  const position = typeof meta.position === 'string' ? meta.position : undefined;
  const teamAbbr = typeof meta.team === 'string' ? meta.team : undefined;
  const opponentAbbr = typeof meta.opponent === 'string' ? meta.opponent : undefined;
  const headshotUrl = typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined;
  const teamLogoUrl = typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined;
  const opponentLogoUrl = typeof meta.opponentLogoUrl === 'string' ? meta.opponentLogoUrl : undefined;
  // seasonStats/seasonRanks/opponentDefenseAllowed/the composite-rank fields
  // live on `subjects[].meta` (one copy per player), not `candidate.subjectMeta`
  // (one copy per market — up to 10x duplication of the same ~2KB blob was
  // inflating the snapshot to 22MB and freezing the tab on every NFL page
  // open). Same subject-level meta pattern headshotUrl/teamLogoUrl already use.
  const richMeta = (snapshot?.subjects.find((s) => s.subjectId === active?.subjectId)?.meta ?? {}) as Record<string, unknown>;
  const seasonStats = richMeta.seasonStats as PlayerSeasonStats | undefined;
  const seasonRanks = richMeta.seasonRanks as SeasonRankMap | undefined;
  const opponentDefenseAllowed = (richMeta.opponentDefenseAllowed as NflvStatLine[] | undefined) ?? [];
  const positionRank = typeof richMeta.positionRank === 'number' ? richMeta.positionRank : null;
  const positionPoolSize = typeof richMeta.positionPoolSize === 'number' ? richMeta.positionPoolSize : null;
  const sideOfBallRank = typeof richMeta.sideOfBallRank === 'number' ? richMeta.sideOfBallRank : null;
  const sideOfBallPoolSize = typeof richMeta.sideOfBallPoolSize === 'number' ? richMeta.sideOfBallPoolSize : null;
  const weeklyBoxScores = (richMeta.weeklyBoxScores as Record<string, Record<string, unknown>> | undefined) ?? {};
  const rankPrefix = positionRank != null ? `#${positionRank} ` : '';

  const baseLine = active?.line ?? 0.5;
  const line = Math.max(0, baseLine + lineOffset);
  const wantOver = directionMark(active?.category ?? '') !== 'U';

  const games = useMemo(
    () => ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{ gamePk: string; firstPitch?: string }>,
    [snapshot],
  );
  const todaysGame = useMemo(
    () => games.find((g) => String(g.gamePk) === String(meta.gamePk)),
    [games, meta.gamePk],
  );

  const scoped = useMemo(() => {
    if (!active) return [];
    let list = active.history;
    if (opponentOnly && opponentAbbr) {
      list = list.filter((e) => (rawOf(e).opponentAbbr as string | undefined) === opponentAbbr);
    }
    if (lastN !== 'all') list = list.slice(-lastN);
    return list;
  }, [active, opponentOnly, opponentAbbr, lastN]);

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

  const matchupOwnRows = playerMatchupRows(seasonStats, position);
  const matchupOpponentStats = opponentDefenseAllowed.map(toStatRow);
  const matchupGroup = position ? MATCHUP_GROUP_BY_POSITION[position] : undefined;

  const gamelogColumns = useMemo(() => {
    const all = position ? GAMELOG_COLUMNS_BY_POSITION[position] ?? [] : [];
    // Only show columns this player's real history actually has a nonzero
    // value for at least once — a WR's log never needs an INT column just
    // because it exists in the table for QBs. Box scores live in
    // weeklyBoxScores (keyed by week), not entry.raw (see the history-
    // building comment in adapter.ts) — entry.raw only carries opponent/
    // season/week now.
    return all.filter((c) =>
      scoped.some((e) => {
        const week = rawOf(e).week as string | undefined;
        const box = week != null ? weeklyBoxScores[week] : undefined;
        return Number(box?.[c.key]) > 0;
      }),
    );
  }, [position, scoped, weeklyBoxScores]);

  const seasonRows = seasonTotalsRows(seasonStats, position, seasonRanks);

  const propOdds = usePropOdds(typeof meta.gamePk === 'string' || typeof meta.gamePk === 'number' ? String(meta.gamePk) : undefined, snapshot?.fetchedAt);
  const activeMarketKey = active ? candidateDimensionToMarketKey(active.dimension) : null;

  if (candidates.length === 0 || !active) {
    return <div className="lb-card p-8 text-center text-sm text-ink-muted">No tracked markets for this player.</div>;
  }

  return (
    <div className="space-y-3">
      <section
        className="lb-card-hero overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${withAlpha(teamPrimaryColor(teamAbbr), '26')} 0%, #ffffff 62%)`,
          borderTop: '3px solid #141619',
        }}
      >
        <div className="flex flex-wrap items-center gap-4 px-4 py-4">
          <div className="relative h-[76px] w-[76px] shrink-0">
            <SubjectAvatar name={active.subjectName} headshotUrl={headshotUrl} fallbackUrl={teamLogoUrl} size={76} shape="rounded" />
            <span className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-white shadow-sm">
              <TeamLogo logoUrl={teamLogoUrl} size={18} />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[24px] font-bold leading-tight text-ink">
              {rankPrefix ? <span className="text-ink-faint">{rankPrefix}</span> : null}
              {active.subjectName}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-muted">
              {position ? <span>{position}</span> : null}
              <TeamLogo logoUrl={teamLogoUrl} abbreviation={teamAbbr} size={14} />
              {opponentAbbr ? (
                <>
                  <span>{meta.isHome ? 'vs' : '@'}</span>
                  <TeamLogo logoUrl={opponentLogoUrl} abbreviation={opponentAbbr} size={14} />
                </>
              ) : null}
              {todaysGame?.firstPitch ? (
                <span className="text-ink-faint">
                  {new Date(todaysGame.firstPitch).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </span>
              ) : null}
            </p>
            {positionRank != null && positionPoolSize != null ? (
              <p className="mt-0.5 text-[10.5px] text-ink-faint">
                {ordinal(positionRank)} of {positionPoolSize} {position ?? ''}
                {sideOfBallRank != null && sideOfBallPoolSize != null
                  ? ` · ${ordinal(sideOfBallRank)} of ${sideOfBallPoolSize} ${(position && SIDE_OF_BALL_LABEL[position]) ?? ''}`
                  : ''}
              </p>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted">{marketText('nfl', active.dimension, 'full') || active.dimensionLabel}</div>
            <div className="mt-0.5 text-[16px] font-bold text-ink">{wantOver ? 'O' : 'U'} {line}</div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_260px] lg:items-start">
      <div className="min-w-0 space-y-3">
        {candidates.length > 1 ? (
          <div className="lb-scroll-x flex gap-1 border-b border-line">
            {candidates.map((c) => (
              <button
                key={`${c.dimension}-${c.category}`}
                type="button"
                onClick={() => { setLineOffset(0); setShowAllGames(false); onMarketChange?.(c.dimension); }}
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
        ) : null}

        <section className="lb-card flex flex-wrap items-center gap-2 p-2.5">
          <div className="flex items-center gap-1 rounded-lg border border-line">
            <button type="button" onClick={() => setLineOffset((v) => v - 1)} aria-label="Lower the line" className="px-2.5 py-1 text-[15px] leading-none text-ink-muted hover:text-masters">−</button>
            <span className="min-w-[52px] text-center text-[15px] font-semibold tabular-nums" aria-live="polite">{wantOver ? 'O' : 'U'} {line}</span>
            <button type="button" onClick={() => setLineOffset((v) => v + 1)} aria-label="Raise the line" className="px-2.5 py-1 text-[15px] leading-none text-ink-muted hover:text-masters">+</button>
          </div>

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
            <button type="button" onClick={() => setLineOffset(0)} className="text-[11px] text-masters underline">Reset to {baseLine}</button>
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

        <div className="lb-scroll-x flex items-center gap-1.5">
          {opponentAbbr ? (
            <FilterChip active={opponentOnly} onClick={() => setOpponentOnly((v) => !v)}>vs {opponentAbbr}</FilterChip>
          ) : null}
          <span className="mx-1 h-4 w-px bg-line" />
          {([5, 10, 15, 'all'] as const).map((n) => (
            <FilterChip key={String(n)} active={lastN === n} onClick={() => setLastN(n)}>{n === 'all' ? 'Season' : `Last ${n}`}</FilterChip>
          ))}
        </div>

        <div className="lb-scroll-x flex gap-1.5 overflow-x-auto">
          <WindowBox label="L5" stat={windows.l5} />
          <WindowBox label="L10" stat={windows.l10} />
          <WindowBox label="L15" stat={windows.l15} />
          <WindowBox label="H2H" stat={windows.h2h} showCount />
          <WindowBox label="SZN" stat={windows.szn} showCount />
        </div>

        <section className="lb-card overflow-hidden">
          <div className="flex items-baseline justify-between gap-2 bg-accent-soft px-3 py-1.5">
            <h2 className="text-[12px] font-semibold text-masters">{scoped.length} game{scoped.length === 1 ? '' : 's'} in scope</h2>
            <span className="text-[10px] text-masters/70">green cleared {wantOver ? 'over' : 'under'} {line}</span>
          </div>
          <div className="p-2.5">
            <DistributionChart
              history={scoped}
              line={line}
              wantOver={wantOver}
              refreshKey={`${active.dimension}|${line}|${opponentOnly}|${lastN}|${snapshot?.fetchedAt ?? ''}`}
              logoFor={(entry) => nflTeamLogoUrl(rawOf(entry).opponentAbbr as string | undefined)}
            />
          </div>
        </section>

        {opponentAbbr && matchupGroup ? (
          <NflPlayerVsDefenseCard
            title="Vs. Defense"
            playerName={active.subjectName}
            playerHeadshotUrl={headshotUrl}
            playerFallbackUrl={teamLogoUrl}
            playerTeamAbbr={teamAbbr}
            playerTeamLogoUrl={teamLogoUrl}
            ownRows={matchupOwnRows}
            opponentAbbr={opponentAbbr}
            opponentLogoUrl={opponentLogoUrl}
            opponentStats={matchupOpponentStats}
          />
        ) : null}

        <section className="lb-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 bg-accent-soft px-2.5 py-1.5">
            <h2 className="text-[12px] font-semibold text-masters">{showAllGames ? `All ${scoped.length} games` : `Last ${Math.min(scoped.length, 15)} games`}</h2>
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
                    <th className="whitespace-nowrap border-b border-line px-2 py-1 text-left font-semibold text-ink-muted">Week</th>
                    <th className="whitespace-nowrap border-b border-line px-2 py-1 text-left font-semibold text-ink-muted">Opponent</th>
                    {gamelogColumns.map((c) => (
                      <th key={c.key} className="whitespace-nowrap border-b border-line px-2 py-1 text-right font-semibold text-ink-muted">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...scoped].reverse().slice(0, showAllGames ? undefined : 15).map((entry, index) => {
                    const raw = rawOf(entry);
                    const oppAbbr = raw.opponentAbbr as string | undefined;
                    const season = raw.season as string | undefined;
                    const week = raw.week as string | undefined;
                    const box = week != null ? weeklyBoxScores[week] : undefined;
                    return (
                      <tr key={index} className="border-b border-line/50 transition-colors hover:bg-surface-subtle">
                        <td className="whitespace-nowrap px-2 py-1 text-left text-ink-muted">
                          {season && week ? `${season} Week ${week}` : entry.periodLabel}
                        </td>
                        <td className="px-2 py-1 text-left">
                          <span className="flex items-center gap-1.5">
                            <TeamLogo logoUrl={nflTeamLogoUrl(oppAbbr)} size={16} />
                            {oppAbbr ?? '—'}
                          </span>
                        </td>
                        {gamelogColumns.map((c) => (
                          <td key={c.key} className="px-2 py-1 text-right tabular-nums">{String(box?.[c.key] ?? '–')}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {seasonRows.length > 0 ? (
          <section className="lb-card overflow-hidden">
            <h2 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">
              Season stats{seasonRanks ? <span className="ml-1.5 font-normal normal-case text-ink-faint">· ranked among {position}s</span> : null}
            </h2>
            <div className="space-y-1.5 p-4">
              {seasonRows.map((r) =>
                r.rank ? (
                  <StatRankRow key={r.key} stat={{ key: r.key, label: r.label, value: r.value, decimals: 0, rank: r.rank.rank, poolSize: r.rank.poolSize }} />
                ) : (
                  <div key={r.key} className="flex items-baseline justify-between gap-2 text-[12px]">
                    <span className="w-20 shrink-0 text-ink-faint">{r.label}</span>
                    <span className="font-semibold tabular-nums">{r.value}</span>
                  </div>
                ),
              )}
            </div>
          </section>
        ) : null}

        {activeMarketKey ? (
          <section className="lb-card overflow-hidden">
            <div className="flex items-center justify-between gap-2 bg-accent-soft px-3 py-1.5">
              <h2 className="text-[12px] font-semibold text-masters">All books</h2>
              {propOdds.scan.lastScannedAt ? (
                <span className="text-[10px] text-ink-faint">
                  scanned {new Date(propOdds.scan.lastScannedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </span>
              ) : null}
            </div>
            <div className="p-2.5">
              {propOdds.scan.error ? <p className="mb-1.5 text-[10px] text-warn">{propOdds.scan.error}</p> : null}
              <PropOddsBoard allRows={propOdds.rows} subjectId={active.subjectId} marketKey={activeMarketKey} line={active.line ?? null} userSportsbook={propOdds.userSportsbook} />
            </div>
          </section>
        ) : null}
      </div>

      <div className="space-y-3 lg:sticky lg:top-4">
        <section className="lb-card overflow-hidden">
          <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Today&apos;s line</h3>
          <div className="p-3">
            <p className="text-[12px] text-ink-faint">No game line for this matchup yet.</p>
          </div>
        </section>

        {opponentAbbr ? (
          <section className="lb-card overflow-hidden">
            <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Matchup</h3>
            <div className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <TeamLogo logoUrl={teamLogoUrl} abbreviation={teamAbbr} size={20} />
                  <span className="text-[10px] font-semibold text-ink-faint">@</span>
                  <TeamLogo logoUrl={opponentLogoUrl} abbreviation={opponentAbbr} size={20} />
                </div>
              </div>
              {opponentDefenseAllowed.length > 0 ? (
                <div className="mt-2 space-y-1.5">
                  {opponentDefenseAllowed.map((s) => <StatRankRow key={s.key} stat={toStatRow(s)} />)}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-ink-faint">No defensive stats available yet.</p>
              )}
            </div>
          </section>
        ) : null}

        <section className="lb-card overflow-hidden">
          <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Form</h3>
          <ul className="space-y-2 p-3">
            {([
              ['Last 5', windows.l5],
              ['Last 10', windows.l10],
              ['Last 15', windows.l15],
            ] as const).map(([label, stat]) => (
              <li key={label}>
                <div className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="truncate text-ink-muted">{label}</span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {isOk(stat) ? `${Math.round(stat.rate * 100)}%` : `${stat.available} of ${stat.required}`}
                  </span>
                </div>
              </li>
            ))}
            {(active.supportingSplits ?? []).slice(0, 4).map((split) => (
              <li key={`${split.kind}-${split.label}`}>
                <div className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="truncate text-ink-muted">{split.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {isOk(split.stat) ? `${Math.round(split.stat.rate * 100)}%` : `${split.stat.available} of ${split.stat.required}`}
                  </span>
                </div>
              </li>
            ))}
            {(active.supportingSplits ?? []).length === 0 ? (
              <li className="text-[12px] text-ink-faint">No corroborating splits yet.</li>
            ) : null}
          </ul>
        </section>

        <section className="lb-card overflow-hidden">
          <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Line movement</h3>
          <div className="p-3">
            <p className="text-[12px] text-ink-faint">
              Movement history isn&apos;t tracked. Prices are recorded when you enter or import them, so only the current value is known.
            </p>
            {active.odds ? (
              <div className="mt-2 flex items-center gap-2">
                <OddsChip price={active.odds.americanOdds} source={active.odds.source} capturedAt={active.odds.capturedAt} />
              </div>
            ) : null}
          </div>
        </section>
      </div>
      </div>
    </div>
  );
}

export default NflPlayerDetail;
