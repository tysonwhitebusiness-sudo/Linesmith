'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { SubjectAvatar, TeamLogo, mlbHeadshotUrl, mlbTeamLogoUrl } from '@/components/SubjectAvatar';
import { MarketLine, directionMark } from '@/components/MarketLabel';
import { Chip, type ChipTone } from '@/components/Chip';
import { OddsChip } from '@/components/OddsChip';
import { BookLogo } from '@/components/BookLogo';
import { useLiveGame } from '@/components/useLiveGame';
import { heatFill, heatInk } from '@/lib/ui/heat';

export interface BetRow {
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
 * `/bet/[betId]` — the line breakdown + live-stats view a Live Bets card
 * opens into. Reuses `useLiveGame`'s existing `subjectId` mode (added for
 * the Game Detail live tab) rather than a new fetch path: that route
 * already returns a per-subject batting/pitching line, the value for
 * whatever dimension this bet is on (`liveValues`), and every play the
 * subject has had today (`subjectPlays`) — exactly what a single bet's
 * detail page needs, just never surfaced outside the game hero card before.
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

function wantsOver(category: string): boolean {
  return category === 'over' || category === 'hit' || category === 'run';
}

/** ahead = winning if the game ended right now; behind = losing; exact = sitting right on the line. */
function progressState(category: string, value: number, line: number): 'ahead' | 'behind' | 'exact' {
  if (value === line) return 'exact';
  const over = value > line;
  return over === wantsOver(category) ? 'ahead' : 'behind';
}

function useBet(betId: string) {
  const [bet, setBet] = useState<BetRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/bets/${betId}`, { cache: 'no-store' });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setBet(json.bet);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load bet');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    // Re-check every 20s while open — picks up 'pending' → 'live' → settled
    // transitions without the user having to reload.
    const interval = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [betId]);

  return { bet, loading, error };
}

export default function BetDetailPage() {
  const params = useParams<{ betId: string }>();
  const router = useRouter();
  const betId = String(params?.betId ?? '');
  const { bet, loading, error } = useBet(betId);

  const settled = bet?.status === 'won' || bet?.status === 'lost' || bet?.status === 'push';
  const gamePk = bet?.gameId ? Number(bet.gameId) : undefined;
  const live = useLiveGame(gamePk, !!gamePk, settled ? null : undefined, bet?.subjectId);

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <TopBar
          sport="mlb"
          leading={
            <button
              type="button"
              onClick={() => router.push('/bets')}
              className="whitespace-nowrap px-2 py-3 text-[13px] font-medium text-masters"
            >
              ← Live Bets
            </button>
          }
          slipCount={0}
          onOpenSlip={() => {}}
          onRefresh={() => {}}
        />
      </header>

      <main className="mx-auto max-w-lg px-3 py-4">
        {loading ? (
          <div className="lb-card h-40 animate-pulse" />
        ) : error || !bet ? (
          <div className="lb-card p-6 text-center text-sm text-bad">{error ?? 'Bet not found.'}</div>
        ) : (
          <div className="space-y-3">
            <section className="lb-card-hero p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <SubjectAvatar
                    name={bet.subjectName}
                    headshotUrl={mlbHeadshotUrl(Number(bet.subjectId))}
                    fallbackUrl={mlbTeamLogoUrl(bet.teamId ?? undefined)}
                    size={48}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[17px] font-bold">{bet.subjectName}</p>
                    <MarketLine sport={bet.sport as 'mlb'} dimension={bet.dimension} category={bet.category} line={bet.line ?? undefined} size="md" />
                  </div>
                </div>
                <Chip tone={STATUS_TONE[bet.status]} shape="pill" size="md">
                  {STATUS_LABEL[bet.status]}
                </Chip>
              </div>

              {bet.team || bet.opponent ? (
                <div className="mt-3 flex items-center gap-2 text-[12px]">
                  <TeamLogo logoUrl={mlbTeamLogoUrl(bet.teamId ?? undefined)} abbreviation={bet.team ?? undefined} size={18} />
                  <span className="text-ink-faint">vs</span>
                  <TeamLogo logoUrl={mlbTeamLogoUrl(bet.opponentId ?? undefined)} abbreviation={bet.opponent ?? undefined} size={18} />
                </div>
              ) : null}

              {bet.eventContext || bet.americanOdds ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-faint">
                  {bet.eventContext ? <span>{bet.eventContext}</span> : null}
                  {bet.americanOdds ? (
                    <span className="flex items-center gap-1.5">
                      {bet.bookmaker ? <BookLogo bookId={bet.bookmaker} size={14} /> : null}
                      <OddsChip price={bet.americanOdds} source={bet.oddsSource ?? undefined} size="md" />
                    </span>
                  ) : (
                    <span className="text-warn">Needs odds</span>
                  )}
                </div>
              ) : null}
            </section>

            {settled ? (
              <section className="lb-card p-4 text-center">
                <p className="text-meta font-semibold uppercase tracking-wide text-ink-muted">Final</p>
                <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: heatInk(bet.status === 'won' ? 1 : bet.status === 'lost' ? 0 : 0.5) }}>
                  {bet.actualValue ?? '—'}
                  {bet.line != null ? <span className="text-base text-ink-faint"> / line {bet.line}</span> : null}
                </p>
              </section>
            ) : !gamePk ? (
              <section className="lb-card p-4 text-center text-sm text-ink-muted">
                No live game linked to this bet — it was added before live tracking existed, or its market has no single game attached.
              </section>
            ) : live.loading && !live.data ? (
              <div className="lb-card h-28 animate-pulse" />
            ) : live.error ? (
              <section className="lb-card p-4 text-center text-sm text-ink-muted">Game hasn't started yet — check back once it's live.</section>
            ) : live.data ? (
              <>
                <section className="lb-card flex items-center justify-between p-4">
                  <div>
                    <p className="text-meta font-semibold uppercase tracking-wide text-ink-muted">
                      {live.data.inning.ordinal} {live.data.inning.half}
                    </p>
                    <p className="mt-0.5 text-[13px] tabular-nums text-ink-muted">
                      {live.data.score.away}–{live.data.score.home} · {live.data.outs} out{live.data.outs === 1 ? '' : 's'}
                    </p>
                  </div>
                  {bet.line != null && live.data.liveValues?.[bet.dimension] != null ? (
                    (() => {
                      const value = live.data.liveValues![bet.dimension];
                      const state = progressState(bet.category, value, bet.line!);
                      const tone = state === 'ahead' ? 1 : state === 'behind' ? 0 : 0.5;
                      return (
                        <div className="text-right">
                          <p className="text-2xl font-bold tabular-nums" style={{ color: heatInk(tone) }}>
                            {value}
                          </p>
                          <p className="text-[11px] text-ink-faint">
                            {directionMark(bet.category) === 'U' ? 'Under' : 'Over'} {bet.line} · {state === 'ahead' ? 'on track' : state === 'exact' ? 'right on the line' : 'needs work'}
                          </p>
                        </div>
                      );
                    })()
                  ) : null}
                </section>

                {live.data.player ? (
                  <section className="lb-card p-4">
                    <p className="mb-2 text-meta font-semibold uppercase tracking-wide text-ink-muted">Today's line</p>
                    {live.data.player.batting ? (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] tabular-nums">
                        <span>{live.data.player.batting.hits}-for-{live.data.player.batting.atBats}</span>
                        <span className="text-ink-faint">R {live.data.player.batting.runs}</span>
                        <span className="text-ink-faint">RBI {live.data.player.batting.rbi}</span>
                        <span className="text-ink-faint">BB {live.data.player.batting.walks}</span>
                        <span className="text-ink-faint">K {live.data.player.batting.strikeOuts}</span>
                      </div>
                    ) : null}
                    {live.data.player.pitching ? (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] tabular-nums">
                        <span>{live.data.player.pitching.inningsPitched} IP</span>
                        <span className="text-ink-faint">H {live.data.player.pitching.hits}</span>
                        <span className="text-ink-faint">ER {live.data.player.pitching.earnedRuns}</span>
                        <span className="text-ink-faint">BB {live.data.player.pitching.walks}</span>
                        <span className="text-ink-faint">K {live.data.player.pitching.strikeOuts}</span>
                        <span className="text-ink-faint">{live.data.player.pitching.pitches}p</span>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {live.data.subjectPlays && live.data.subjectPlays.length > 0 ? (
                  <section className="lb-card p-4">
                    <p className="mb-2 text-meta font-semibold uppercase tracking-wide text-ink-muted">Plays today</p>
                    <ul className="space-y-2">
                      {[...live.data.subjectPlays].reverse().map((play, i) => (
                        <li key={i} className="text-[13px]">
                          <span className="font-medium" style={{ color: play.rbi > 0 ? heatFill(1) : undefined }}>
                            {play.event}
                          </span>
                          <span className="text-ink-faint"> · Inning {play.inning} — {play.description}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : (
                  <section className="lb-card p-4 text-center text-sm text-ink-muted">No plate appearances yet.</section>
                )}
              </>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
