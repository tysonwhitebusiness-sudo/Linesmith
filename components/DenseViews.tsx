'use client';

import { useMemo, useState } from 'react';
import type { PickCandidate } from '@/lib/core/types';
import { candidateKey } from '@/lib/core/types';
import { readForm } from '@/lib/core/pickEngine';
import { windowSet, rateOrNull } from '@/lib/core/windowedStat';
import { HitRateCell, StreakCell } from './StatCells';
import type { UnifiedGameLine } from '@/lib/odds/types';
import { formatAmerican, projectLine, homeShare, type SourceFilter } from '@/lib/odds/display';
import { abbreviateLive, liveFor, type SlateEntry, type Slate } from '@/lib/odds/matching';
import { MarketLabel } from './MarketLabel';
import { SubjectAvatar } from './SubjectAvatar';

/**
 * Row-based alternatives to the card views.
 *
 * Cards are the right default — they hold enough context to make a decision
 * from. These are for the other mode of use: sweeping thirty candidates for
 * the two worth opening. Same data, one line each, no scrolling sideways
 * through prose.
 */

const WINDOWS = [5, 10, 15];

type SortColumn = 'player' | 'odds' | 'l5' | 'l10' | 'l15' | 'streak';
type SortDir = 'asc' | 'desc';

/** Compact context signal — opposing handedness or weather flag. */
function ContextCell({ candidate }: { candidate: PickCandidate }) {
  const meta = candidate.subjectMeta as Record<string, unknown> | undefined;
  const opposingHand = typeof meta?.opposingHand === 'string' ? meta.opposingHand : undefined;
  const opposingStarter = typeof meta?.opposingStarter === 'string' ? meta.opposingStarter : undefined;
  const weather = candidate.context?.weather;

  if (opposingHand) {
    const label = opposingHand === 'L' ? 'vs LHP' : 'vs RHP';
    return (
      <span
        className="lb-chip bg-accent-soft/50 text-masters"
        title={opposingStarter ?? label}
      >
        {label}
      </span>
    );
  }
  if (weather?.rainPct && weather.rainPct > 30) {
    return (
      <span className="lb-chip bg-warn/10 text-warn" title={`${weather.rainPct}% rain`}>
        Rain
      </span>
    );
  }
  if (weather?.windMph && weather.windMph > 15) {
    return (
      <span className="lb-chip bg-warn/10 text-warn" title={`Wind ${weather.windMph}mph ${weather.windDir}`}>
        Wind
      </span>
    );
  }
  return <span className="text-ink-faint">—</span>;
}

export function DenseScanTable({
  candidates,
  slate,
  sourceFilter = 'all',
  bookmaker = null,
  onAdd,
  pickedKeys,
}: {
  candidates: PickCandidate[];
  /** MLB only — supplies the odds columns. Absent for golf. */
  slate?: Slate | null;
  sourceFilter?: SourceFilter;
  bookmaker?: string | null;
  onAdd?: (candidate: PickCandidate) => void;
  pickedKeys?: Set<string>;
}) {
  const [sortCol, setSortCol] = useState<SortColumn>('l10');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const showOdds = Boolean(slate && slate.entries.length > 0);

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  };

  const sortArrow = (col: SortColumn) => {
    if (sortCol !== col) return null;
    return <span className="ml-0.5 text-[9px]">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  const sorted = useMemo(() => {
    const arr = [...candidates];
    arr.sort((a, b) => {
      const byA = windowSet(a.history, a.category);
      const byB = windowSet(b.history, b.category);

      let va = 0;
      let vb = 0;

      switch (sortCol) {
        case 'player':
          va = a.subjectName.localeCompare(b.subjectName);
          vb = 0;
          break;
        case 'odds': {
          const teamA = typeof a.subjectMeta?.team === 'string' ? a.subjectMeta.team : undefined;
          const teamB = typeof b.subjectMeta?.team === 'string' ? b.subjectMeta.team : undefined;
          const entryA = teamA ? slate?.byAbbrev.get(teamA.toUpperCase()) : undefined;
          const entryB = teamB ? slate?.byAbbrev.get(teamB.toUpperCase()) : undefined;
          const projA = entryA?.line ? projectLine(entryA.line, sourceFilter, bookmaker) : null;
          const projB = entryB?.line ? projectLine(entryB.line, sourceFilter, bookmaker) : null;
          va = Number(projA?.moneyline?.home ?? 0);
          vb = Number(projB?.moneyline?.home ?? 0);
          break;
        }
        case 'l5':
        case 'l10':
        case 'l15': {
          // Insufficient sorts below every real rate rather than as a zero,
          // which would rank "we don't know" alongside "he never does it".
          va = rateOrNull(byA[sortCol]) ?? -1;
          vb = rateOrNull(byB[sortCol]) ?? -1;
          break;
        }
        case 'streak':
          va = byA.streak;
          vb = byB.streak;
          break;
      }
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return arr;
  }, [candidates, sortCol, sortDir, slate, sourceFilter, bookmaker]);

  if (candidates.length === 0) {
    return (
      <div className="lb-card p-6 text-center text-sm text-ink-muted">
        No matches — try widening your filters.
      </div>
    );
  }

  return (
    <div className="lb-card overflow-x-auto">
      <table className="lb-dense w-full min-w-[620px] border-collapse">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 cursor-pointer bg-paper/95"
              onClick={() => handleSort('player')}
            >
              Player{sortArrow('player')}
            </th>
            <th scope="col">Line</th>
            <th
              scope="col"
              className="cursor-pointer text-right"
              onClick={() => handleSort('odds')}
            >
              Odds{sortArrow('odds')}
            </th>
            {WINDOWS.map((w) => {
              const col: SortColumn = w === 5 ? 'l5' : w === 10 ? 'l10' : 'l15';
              return (
                <th
                  key={w}
                  scope="col"
                  className="cursor-pointer text-right"
                  onClick={() => handleSort(col)}
                >
                  L{w}{sortArrow(col)}
                </th>
              );
            })}
            <th
              scope="col"
              className="cursor-pointer text-right"
              onClick={() => handleSort('streak')}
            >
              Strk{sortArrow('streak')}
            </th>
            <th scope="col">Context</th>
            {onAdd ? <th scope="col" className="sr-only">Add</th> : null}
          </tr>
        </thead>
        <tbody>
          {sorted.map((candidate) => {
            const windows = windowSet(candidate.history, candidate.category);

            const team = typeof candidate.subjectMeta?.team === 'string' ? candidate.subjectMeta.team : undefined;
            const entry: SlateEntry | undefined = team ? slate?.byAbbrev.get(team.toUpperCase()) : undefined;
            const projected = entry?.line ? projectLine(entry.line, sourceFilter, bookmaker) : null;
            const key = candidateKey(candidate);
            const added = pickedKeys?.has(key);

            const meta = candidate.subjectMeta ?? {};
            const headshotUrl = typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined;
            const teamLogoUrl = typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined;

            return (
              <tr key={key} className="hover:bg-accent-soft/30">
                {/* Player — sticky */}
                <td className="sticky left-0 z-[5] max-w-[140px] bg-card">
                  <div className="flex items-center gap-2">
                    <SubjectAvatar
                      name={candidate.subjectName}
                      headshotUrl={headshotUrl}
                      fallbackUrl={teamLogoUrl}
                      size={24}
                    />
                    <span className="truncate text-[13px] font-medium">{candidate.subjectName}</span>
                  </div>
                </td>

                {/* Line — MarketLabel compact */}
                <td>
                  <MarketLabel
                    sport={candidate.sport}
                    dimension={candidate.dimension}
                    category={candidate.category}
                    mode="compact"
                  />
                </td>

                {/* Odds */}
                <td className="text-right tabular-nums">
                  {projected?.moneyline ? (
                    <span className="text-[13px] font-semibold">
                      {formatAmerican(projected.moneyline.home)}
                    </span>
                  ) : (
                    <span className="text-[11px] text-ink-faint">Add odds</span>
                  )}
                </td>

                {/* L5, L10, L15 */}
                {(['l5', 'l10', 'l15'] as const).map((key) => (
                  <td key={key} className="text-right">
                    <HitRateCell stat={windows[key]} />
                  </td>
                ))}

                {/* Streak */}
                <td className="text-right tabular-nums">
                  <StreakCell streak={windows.streak} />
                </td>

                {/* Context */}
                <td>
                  <ContextCell candidate={candidate} />
                </td>

                {/* Add to slip */}
                {onAdd ? (
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAdd(candidate);
                      }}
                      disabled={added}
                      className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                        added ? 'bg-accent-soft text-masters' : 'bg-masters text-white'
                      }`}
                    >
                      {added ? '✓' : 'Add'}
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Miniature per-book split bar used by DenseGameTable. */
function MiniSpread({ line }: { line: UnifiedGameLine | undefined }) {
  const books = line?.bookmakers ?? [];
  if (books.length === 0) return null;

  return (
    <span className="flex flex-col gap-[2px]" title={`${books.length} bookmakers`}>
      {books.slice(0, 4).map((book) => {
        const share = homeShare(book.homeOdds, book.awayOdds);
        return (
          <span key={book.bookmaker} className="flex h-[3px] w-10 overflow-hidden rounded-full bg-line">
            {share === null ? null : <span className="h-full bg-masters" style={{ width: `${share * 100}%` }} />}
          </span>
        );
      })}
    </span>
  );
}

/** The Context tab's slate, one game per row. */
export function DenseGameTable({
  slate,
  sourceFilter = 'all',
  bookmaker = null,
}: {
  slate: Slate;
  sourceFilter?: SourceFilter;
  bookmaker?: string | null;
}) {
  const anyLive = slate.entries.some((e) => liveFor(e).liveScore);

  return (
    <div className="lb-card overflow-x-auto">
      <table className="lb-dense w-full min-w-[520px] border-collapse">
        <thead>
          <tr>
            <th scope="col">Matchup</th>
            <th scope="col">State</th>
            <th scope="col" className="text-right">
              Moneyline
            </th>
            <th scope="col" className="text-right">
              Total
            </th>
            {anyLive ? <th scope="col">Live</th> : null}
            <th scope="col">Books</th>
          </tr>
        </thead>
        <tbody>
          {slate.entries.map((entry, index) => {
            const { game, line } = entry;
            const projected = line ? projectLine(line, sourceFilter, bookmaker) : null;
            const available = projected?.available !== false;

            return (
              <tr key={game.gamePk ?? index} className="hover:bg-accent-soft/30">
                <td className="whitespace-nowrap font-medium">{game.matchup ?? '—'}</td>
                <td className="max-w-[110px] truncate text-ink-muted">{game.state ?? '—'}</td>
                <td className="whitespace-nowrap text-right font-semibold tabular-nums">
                  {available && projected?.moneyline ? (
                    <>
                      {formatAmerican(projected.moneyline.away)}
                      <span className="px-0.5 font-normal text-ink-faint">/</span>
                      {formatAmerican(projected.moneyline.home)}
                    </>
                  ) : (
                    <span className="font-normal text-ink-faint">—</span>
                  )}
                </td>
                <td className="text-right tabular-nums">
                  {available && projected?.total?.point != null ? (
                    projected.total.point
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>
                {anyLive ? (
                  <td className="whitespace-nowrap text-[12px] font-semibold tabular-nums text-masters">
                    {/* The score is the league's, so a source filter that hides
                        the odds must not hide it. */}
                    {abbreviateLive(entry) ?? <span className="font-normal text-ink-faint">—</span>}
                  </td>
                ) : null}
                <td>
                  <div className="flex items-center gap-1.5">
                    <MiniSpread line={available ? line : undefined} />
                    <span className="text-[11px] tabular-nums text-ink-faint">
                      {available && projected ? projected.bookCount : '—'}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default DenseScanTable;
