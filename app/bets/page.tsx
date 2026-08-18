'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { SubjectAvatar, TeamLogo, mlbHeadshotUrl, mlbTeamLogoUrl } from '@/components/SubjectAvatar';
import { MarketLine, directionMark } from '@/components/MarketLabel';
import { Chip, type ChipTone } from '@/components/Chip';
import { OddsChip } from '@/components/OddsChip';
import { BookLogo } from '@/components/BookLogo';
import { useLiveGame } from '@/components/useLiveGame';
import { heatInk } from '@/lib/ui/heat';

interface BetRow {
  id: number;
  sport: string;
  subjectId: string;
  subjectName: string;
  dimension: string;
  dimensionLabel: string;
  category: string;
  categoryLabel: string;
  line: number | null;
  gameId: string | null;
  teamId: number | null;
  team: string | null;
  opponentId: number | null;
  opponent: string | null;
  americanOdds: string | null;
  oddsSource: string | null;
  bookmaker: string | null;
  eventContext: string | null;
  sampleSize: number | null;
  submittedAt: string;
  status: 'pending' | 'live' | 'won' | 'lost' | 'push';
  actualValue: number | null;
  settledAt: string | null;
}

/**
 * `/bets` — "Live Bets": every bet submitted off the slip (see SlipModal's
 * Submit action), at a glance, with live progress. MLB-only for now — golf
 * has no live-stats route to drive the progress column with (see the UI
 * redesign scope notes: golf is getting a separate full rebuild), so bets
 * are filtered to `sport === 'mlb'` rather than shown half-working.
 */

const STATUS_LABEL: Record<BetRow['status'], string> = {
  pending: 'Not started',
  live: 'Live',
  won: 'Won',
  lost: 'Lost',
  push: 'Push',
};

const STATUS_TONE: Record<BetRow['status'], ChipTone> = {
  pending: 'neutral',
  live: 'masters',
  won: 'good',
  lost: 'bad',
  push: 'warn',
};

const FILTERS = ['All', 'Open', 'Settled'] as const;
type Filter = (typeof FILTERS)[number];

function matchesFilter(bet: BetRow, filter: Filter): boolean {
  if (filter === 'All') return true;
  if (filter === 'Open') return bet.status === 'pending' || bet.status === 'live';
  return bet.status === 'won' || bet.status === 'lost' || bet.status === 'push';
}

function wantsOver(category: string): boolean {
  return category === 'over' || category === 'hit' || category === 'run';
}

function progressState(category: string, value: number, line: number): 'ahead' | 'behind' | 'exact' {
  if (value === line) return 'exact';
  const over = value > line;
  return over === wantsOver(category) ? 'ahead' : 'behind';
}

function LiveProgress({ bet }: { bet: BetRow }) {
  const gamePk = bet.gameId ? Number(bet.gameId) : undefined;
  const enabled = !!gamePk && (bet.status === 'pending' || bet.status === 'live');
  const live = useLiveGame(gamePk, enabled, undefined, bet.subjectId);

  if (bet.status === 'won' || bet.status === 'lost' || bet.status === 'push') {
    return (
      <p className="text-[13px] tabular-nums" style={{ color: heatInk(bet.status === 'won' ? 1 : bet.status === 'lost' ? 0 : 0.5) }}>
        Final: {bet.actualValue ?? '—'}
        {bet.line != null ? <span className="text-ink-faint"> / {bet.line}</span> : null}
      </p>
    );
  }

  if (!enabled) return <p className="text-[12px] text-ink-faint">Not started</p>;
  if (live.loading && !live.data) return <p className="text-[12px] text-ink-faint">Loading…</p>;
  if (!live.data) return <p className="text-[12px] text-ink-faint">Not started</p>;

  const value = bet.dimension && live.data.liveValues ? live.data.liveValues[bet.dimension] : undefined;
  if (bet.line == null || value == null) {
    return (
      <p className="text-[12px] text-ink-faint tabular-nums">
        {live.data.inning.ordinal} {live.data.inning.half} · {live.data.score.away}–{live.data.score.home}
      </p>
    );
  }

  const state = progressState(bet.category, value, bet.line);
  const tone = state === 'ahead' ? 1 : state === 'behind' ? 0 : 0.5;
  return (
    <p className="text-[13px] font-semibold tabular-nums" style={{ color: heatInk(tone) }}>
      {value} <span className="font-normal text-ink-faint">/ {directionMark(bet.category) === 'U' ? 'U' : 'O'}{bet.line}</span>
    </p>
  );
}

export default function LiveBetsPage() {
  const router = useRouter();
  const [bets, setBets] = useState<BetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('Open');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bets?sport=mlb', { cache: 'no-store' });
      if (res.ok) setBets((await res.json()).bets ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const filtered = useMemo(() => bets.filter((b) => matchesFilter(b, filter)), [bets, filter]);

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <TopBar
          sport="mlb"
          leading={
            <button
              type="button"
              onClick={() => router.push('/mlb')}
              className="whitespace-nowrap px-2 py-3 text-[13px] font-medium text-masters"
            >
              ← Scan
            </button>
          }
          slipCount={0}
          onOpenSlip={() => {}}
          onRefresh={load}
          loading={loading}
        />
      </header>

      <main className="mx-auto max-w-lg px-3 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-[17px] font-bold">Live Bets</h1>
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${
                  f === filter ? 'bg-masters text-white' : 'bg-ink/5 text-ink-muted'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {loading && bets.length === 0 ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="lb-card h-20 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="lb-card p-8 text-center text-sm text-ink-muted">
            {bets.length === 0
              ? 'Nothing submitted yet — build a slip and submit it to track it here.'
              : 'No bets match this filter.'}
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((bet) => (
              <li key={bet.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/bet/${bet.id}`)}
                  className="lb-card-interactive flex w-full items-center gap-3 p-3 text-left"
                >
                  <SubjectAvatar
                    name={bet.subjectName}
                    headshotUrl={mlbHeadshotUrl(Number(bet.subjectId))}
                    fallbackUrl={mlbTeamLogoUrl(bet.teamId ?? undefined)}
                    size={36}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold">{bet.subjectName}</p>
                    <MarketLine sport={bet.sport as 'mlb'} dimension={bet.dimension} category={bet.category} line={bet.line ?? undefined} />
                    {bet.team || bet.opponent ? (
                      <div className="mt-0.5 flex items-center gap-1">
                        <TeamLogo logoUrl={mlbTeamLogoUrl(bet.teamId ?? undefined)} abbreviation={bet.team ?? undefined} size={13} />
                        <span className="text-[10px] text-ink-faint">vs</span>
                        <TeamLogo logoUrl={mlbTeamLogoUrl(bet.opponentId ?? undefined)} abbreviation={bet.opponent ?? undefined} size={13} />
                      </div>
                    ) : null}
                    {bet.americanOdds ? (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        {bet.bookmaker ? <BookLogo bookId={bet.bookmaker} size={12} /> : null}
                        <OddsChip price={bet.americanOdds} source={bet.oddsSource ?? undefined} />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Chip tone={STATUS_TONE[bet.status]} size="sm">
                      {STATUS_LABEL[bet.status]}
                    </Chip>
                    <LiveProgress bet={bet} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
