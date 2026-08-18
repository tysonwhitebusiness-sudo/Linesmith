'use client';

import { useEffect, useState } from 'react';
import type { PickCandidate, Sport } from '@/lib/core/types';
import { candidateKey } from '@/lib/core/types';
import { formatAmerican } from '@/lib/odds/display';
import { teamPrimaryColor } from '@/lib/sports/mlb/teamColors';
import { teamAbbrFor } from '@/lib/sports/mlb/teamAliases';
import { useGamePickHistory, type GamePickView } from './useGamePickRecord';
import { useSlip } from './useSlip';
import { ScanCard } from './ScanCard';
import { StarIcon } from './icons';

function pickTime(iso: string | null): string {
  if (!iso) return 'TBD';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** 3 hours before first pitch — when a "provisional" lean becomes the locked, graded pick. */
function lockClockTime(commenceTime: string | null): string | null {
  if (!commenceTime) return null;
  const t = Date.parse(commenceTime);
  if (!Number.isFinite(t)) return null;
  return new Date(t - 3 * 60 * 60 * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function lockTitle(locked: boolean, commenceTime: string | null): string | undefined {
  if (locked) return 'Locked';
  const at = lockClockTime(commenceTime);
  return at ? `Locks at ${at}` : undefined;
}

/** Team identity as a filled, brand-colored circle — no logo asset required, and every team reads at a glance even at 24px. */
function TeamBadge({ teamId, size = 26 }: { teamId: number | null; size?: number }) {
  const abbr = teamAbbrFor(teamId ?? undefined) ?? '?';
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
      style={{ width: size, height: size, backgroundColor: teamPrimaryColor(teamId ?? undefined) }}
    >
      {abbr}
    </span>
  );
}

function MatchupCell({ row }: { row: GamePickView }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <TeamBadge teamId={row.awayTeamId} />
      <span className="max-w-[96px] truncate font-medium">{row.awayTeamName ?? '?'}</span>
      <span className="text-ink-faint">@</span>
      <TeamBadge teamId={row.homeTeamId} />
      <span className="max-w-[96px] truncate font-medium">{row.homeTeamName ?? '?'}</span>
    </div>
  );
}

/** Win/loss/pending, as a small filled square rather than a tinted row — the pick's own text stays legible regardless of the result. */
function ResultBadge({ outcome }: { outcome: 'win' | 'loss' | null }) {
  if (outcome === 'win') {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-good text-[11px] font-bold text-white" title="Won">
        W
      </span>
    );
  }
  if (outcome === 'loss') {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bad text-[11px] font-bold text-white" title="Lost">
        L
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ink/10 text-ink-faint" title="Not graded yet">
      –
    </span>
  );
}

function PickRow({
  label,
  price,
  pct,
  outcome,
  title,
}: {
  label: string;
  price: number | null;
  pct: number | null;
  outcome: 'win' | 'loss' | null;
  title?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2" title={title}>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold">
          {label}
          {price != null ? <span className="ml-1 font-normal text-ink-muted tabular-nums">{formatAmerican(price)}</span> : null}
        </div>
        {pct != null ? <div className="text-[11px] text-ink-faint">{pct}% conf</div> : null}
      </div>
      <ResultBadge outcome={outcome} />
    </div>
  );
}

function MoneylineCell({ pick, commenceTime }: { pick: GamePickView['moneyline']; commenceTime: string | null }) {
  if (!pick.pickTeamName) return <span className="text-ink-faint">—</span>;
  return (
    <PickRow
      label={pick.pickTeamName}
      price={pick.price}
      pct={pick.confidence?.pct ?? null}
      outcome={pick.outcome}
      title={lockTitle(pick.locked, commenceTime)}
    />
  );
}

function TotalCell({ pick, commenceTime }: { pick: GamePickView['total']; commenceTime: string | null }) {
  if (!pick.pickSide) return <span className="text-ink-faint">—</span>;
  return (
    <PickRow
      label={`${pick.pickSide === 'over' ? 'Over' : 'Under'} ${pick.line ?? ''}`}
      price={pick.price}
      pct={pick.confidence?.pct ?? null}
      outcome={pick.outcome}
      title={lockTitle(pick.locked, commenceTime)}
    />
  );
}

/** Six rows visible at once, same as the reference — the rest are a click away on the Games tab, so a long slate doesn't turn this into its own scrolling list. */
const VISIBLE_ROWS = 6;

function TodaysPicksTable({ rows }: { rows: GamePickView[] }) {
  const [expanded, setExpanded] = useState(false);

  if (rows.length === 0) {
    return <p className="p-6 text-center text-[13px] text-ink-muted">No games on today's slate yet.</p>;
  }

  const shown = expanded ? rows : rows.slice(0, VISIBLE_ROWS);
  const remaining = rows.length - shown.length;

  return (
    <div>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Matchup</th>
            <th className="py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Time</th>
            <th className="py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Moneyline</th>
            <th className="py-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">O/U</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.gameId} className="border-b border-line/60 last:border-0">
              <td className="py-2.5 pr-3">
                <MatchupCell row={r} />
              </td>
              <td className="py-2.5 pr-3 text-ink-muted">{pickTime(r.commenceTime)}</td>
              <td className="py-2.5 pr-3">
                <MoneylineCell pick={r.moneyline} commenceTime={r.commenceTime} />
              </td>
              <td className="py-2.5">
                <TotalCell pick={r.total} commenceTime={r.commenceTime} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {remaining > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full py-3 text-center text-[12px] text-ink-faint hover:text-ink"
        >
          +{remaining} more game{remaining === 1 ? '' : 's'} today
        </button>
      ) : expanded && rows.length > VISIBLE_ROWS ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="w-full py-3 text-center text-[12px] text-ink-faint hover:text-ink"
        >
          Show fewer
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Home Run candidates tab
// ---------------------------------------------------------------------------

interface HomeRunCandidatesState {
  candidates: PickCandidate[];
  loading: boolean;
  error: string | null;
}

/** Fetches only when the tab is actually opened — no point paying for this on every "Today's Picks" click when most opens just want the games table. */
function useTopHomeRunCandidates(enabled: boolean): HomeRunCandidatesState {
  const [state, setState] = useState<HomeRunCandidatesState>({ candidates: [], loading: false, error: null });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch('/api/mlb/home-run-candidates', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((data: { candidates: PickCandidate[] }) => {
        if (!cancelled) setState({ candidates: data.candidates ?? [], loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ candidates: [], loading: false, error: err instanceof Error ? err.message : 'Fetch failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}

/**
 * Top 15 home-run candidates as full stat cards — same ScanCard used on the
 * Scan tab's Home Runs board, so matchup context, HR splits, park/weather,
 * and lineup status all show exactly as they do there. Uses its own useSlip
 * instance rather than threading AppShell's down — same self-contained
 * philosophy as the rest of this modal (see TodaysPicksButton's own note).
 */
function TopHomeRunCandidates({ sport, active }: { sport: Sport; active: boolean }) {
  const { candidates, loading, error } = useTopHomeRunCandidates(active);
  const slip = useSlip(sport);

  if (error) {
    return <p className="p-6 text-center text-[13px] text-bad">{error}</p>;
  }
  if (loading && candidates.length === 0) {
    return <p className="p-6 text-center text-[13px] text-ink-muted">Loading…</p>;
  }
  if (candidates.length === 0) {
    return (
      <p className="p-6 text-center text-[13px] text-ink-muted">
        No home-run projections available yet today — check back once the slate loads on the Scan tab.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {candidates.map((candidate) => (
        <ScanCard
          key={candidateKey(candidate)}
          candidate={candidate}
          added={slip.pickedKeys.has(candidateKey(candidate))}
          watched={slip.watchedIds.has(candidate.subjectId)}
          onAdd={(c, odds) => slip.addPick(c, null, odds)}
          onToggleWatch={slip.toggleWatch}
        />
      ))}
    </div>
  );
}

type TodaysPicksTab = 'games' | 'homeRuns';

/** Button + modal, self-contained so any page can drop it in without wiring state. */
export function TodaysPicksButton({ sport, date }: { sport: Sport; date?: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TodaysPicksTab>('games');
  const history = useGamePickHistory(sport, 5 * 60 * 1000, open ? date : undefined);
  // Home-run candidates are MLB-only — the tab itself is hidden for any
  // other sport, so this component stays droppable anywhere without a
  // caller having to know that detail.
  const showHomeRunsTab = sport === 'mlb';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-masters/30 bg-accent-soft px-3 py-1.5 text-[12px] font-semibold text-masters transition-colors hover:bg-accent-soft/80"
      >
        <StarIcon size={12} /> Today&apos;s Picks
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="lb-card flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden shadow-pop"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Today's Picks"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Today&apos;s Picks</h2>
                <p className="text-[11px] text-ink-faint">
                  {history.record ? (
                    <>
                      Season so far — ML {history.record.moneyline.wins}-{history.record.moneyline.losses} · O/U{' '}
                      {history.record.total.wins}-{history.record.total.losses}
                    </>
                  ) : (
                    'Loading record…'
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-full p-1.5 text-ink-faint hover:bg-ink/5 hover:text-ink"
              >
                ✕
              </button>
            </div>

            {showHomeRunsTab ? (
              <div className="flex gap-1 border-b border-line px-4 pt-2">
                <button
                  type="button"
                  onClick={() => setTab('games')}
                  className={`rounded-t-md px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                    tab === 'games' ? 'border-b-2 border-masters text-masters' : 'text-ink-faint hover:text-ink'
                  }`}
                >
                  Games
                </button>
                <button
                  type="button"
                  onClick={() => setTab('homeRuns')}
                  className={`rounded-t-md px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                    tab === 'homeRuns' ? 'border-b-2 border-masters text-masters' : 'text-ink-faint hover:text-ink'
                  }`}
                >
                  Top 15 Home Runs
                </button>
              </div>
            ) : null}

            <div className="overflow-y-auto p-4">
              {tab === 'homeRuns' && showHomeRunsTab ? (
                <TopHomeRunCandidates sport={sport} active={open && tab === 'homeRuns'} />
              ) : history.error ? (
                <p className="p-4 text-center text-[13px] text-bad">{history.error}</p>
              ) : history.loading && history.rows.length === 0 ? (
                <p className="p-6 text-center text-[13px] text-ink-muted">Loading…</p>
              ) : (
                <TodaysPicksTable rows={history.rows} />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default TodaysPicksButton;
