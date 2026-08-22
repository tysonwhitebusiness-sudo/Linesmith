'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Sport, SoccerLeague } from '@/lib/core/types';
import { SPORTS, SPORT_LABEL, SOCCER_LEAGUES, SOCCER_LEAGUE_LABEL } from '@/lib/core/types';
import { BrandedLoader } from './BrandedLoader';
import { AccountMenu } from './AccountMenu';

/**
 * The application chrome, one row tall.
 *
 * What was here before stacked a sport switcher, a tab row and the games strip
 * into three bands, which ate a third of a phone screen before any data
 * appeared. This puts identity and sport on the left, navigation in the middle
 * and the utilities that don't change on the right, all on one line.
 *
 * Navigation is understated text with an underline rather than filled pills:
 * filled pills read as buttons you press to *do* something, and competing with
 * the sport selector and the slip button for that meaning made the header
 * noisy. Only the current view is emphasised.
 */

export const TABS = ['Scan', 'Players', 'Teams', 'Schedule'] as const;
export type Tab = (typeof TABS)[number];

export interface TopBarProps {
  sport: Sport;
  /** Soccer only — which competition, since it's the first sport with more than one. */
  league?: SoccerLeague;
  onLeagueChange?: (league: SoccerLeague) => void;
  /** Omitted on pages with no tab row of their own, e.g. Game Detail. */
  tab?: Tab;
  onTabChange?: (tab: Tab) => void;
  /** Which tab (if any) the caller's own `startTransition`-wrapped `onTabChange` is still resolving — a local re-render pending, not a navigation, so it's tracked outside this component's own `navigate()`/`isPending` pair. */
  pendingTab?: Tab | null;
  /** Rendered at the far left in place of the tabs, e.g. a back control. */
  leading?: React.ReactNode;
  slipCount: number;
  onOpenSlip: () => void;
  onOpenSearch?: () => void;
  onRefresh: () => void;
  loading?: boolean;
  lastFetched?: Date | null;
}

export function TopBar({
  sport,
  league,
  onLeagueChange,
  tab,
  onTabChange,
  pendingTab = null,
  leading,
  slipCount,
  onOpenSlip,
  onOpenSearch,
  onRefresh,
  loading = false,
  lastFetched = null,
}: TopBarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Which control triggered the in-flight navigation — `isPending` alone is
  // one shared flag for every transition started below, this is what lets
  // the spinner land next to the actual thing that was clicked instead of
  // every candidate at once.
  const [pendingTarget, setPendingTarget] = useState<'sport' | Tab | null>(null);

  const navigate = (target: 'sport' | Tab, href: string) => {
    setPendingTarget(target);
    startTransition(() => {
      router.push(href);
    });
  };

  return (
    <div className="flex h-12 items-center gap-3 px-3">
      {/* Identity + sport */}
      <div className="flex shrink-0 items-center gap-1.5">
        <img src="/brand/linesmith-mark.png" alt="" width={28} height={18} className="h-[18px] w-auto select-none" />
        <span className="select-none text-[15px] font-semibold tracking-tight text-ink">
          Linesmith
        </span>
        <label className="sr-only" htmlFor="lb-sport">
          Sport
        </label>
        <select
          id="lb-sport"
          value={sport}
          onChange={(e) => navigate('sport', e.target.value === 'soccer' ? '/soccer/epl' : `/${e.target.value}`)}
          disabled={isPending && pendingTarget === 'sport'}
          className="cursor-pointer rounded-md border border-line bg-card py-0.5 pl-1.5 pr-5 text-[12px] font-medium text-ink-muted focus:border-masters focus:outline-none disabled:cursor-wait disabled:opacity-70"
        >
          {SPORTS.map((s) => (
            <option key={s} value={s}>
              {SPORT_LABEL[s]}
            </option>
          ))}
        </select>
        {sport === 'soccer' && league && onLeagueChange ? (
          <>
            <label className="sr-only" htmlFor="lb-league">
              League
            </label>
            <select
              id="lb-league"
              value={league}
              onChange={(e) => onLeagueChange(e.target.value as SoccerLeague)}
              className="cursor-pointer rounded-md border border-line bg-card py-0.5 pl-1.5 pr-5 text-[12px] font-medium text-ink-muted focus:border-masters focus:outline-none"
            >
              {SOCCER_LEAGUES.map((l) => (
                <option key={l} value={l}>
                  {SOCCER_LEAGUE_LABEL[l]}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {isPending && pendingTarget === 'sport' ? <BrandedLoader size="inline" label="Switching sport" /> : null}
      </div>

      {/* Navigation */}
      <nav className="lb-scroll-x flex min-w-0 flex-1 items-center justify-center gap-1">
        {leading}
        {tab && onTabChange
          ? TABS.filter(
              (t) => (t !== 'Teams' || sport === 'mlb' || sport === 'nfl' || sport === 'soccer') && (t !== 'Schedule' || sport === 'golf'),
            ).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  if (t === 'Teams') navigate(t, sport === 'soccer' ? `/soccer/${league}/teams` : `/${sport}/teams`);
                  else if (t === 'Schedule') navigate(t, '/golf/schedule');
                  else onTabChange(t);
                }}
                aria-current={t === tab ? 'page' : undefined}
                className={`relative flex items-center gap-1.5 whitespace-nowrap px-2.5 py-3 text-[13px] transition-colors ${
                  t === tab
                    ? 'font-semibold text-ink after:absolute after:inset-x-2.5 after:bottom-2 after:h-[2px] after:rounded-full after:bg-masters'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {t}
                {(isPending && pendingTarget === t) || pendingTab === t ? <BrandedLoader size="inline" label={`Loading ${t}`} /> : null}
              </button>
            ))
          : null}
      </nav>

      {/* Utilities */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => router.push('/diagnostics')}
          aria-label="Diagnostics"
          title="Diagnostics — odds provider status, budgets, unresolved rows"
          className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink"
        >
          <svg viewBox="0 0 16 16" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M8 1.5v3M8 11.5v3M2.6 4.6l2.1 2.1M11.3 9.3l2.1 2.1M1.5 8h3M11.5 8h3M2.6 11.4l2.1-2.1M11.3 6.7l2.1-2.1" strokeLinecap="round" />
            <circle cx="8" cy="8" r="2.2" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => router.push('/bets')}
          aria-label="Live Bets"
          title="Live Bets — every bet you've submitted, with live progress"
          className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink"
        >
          <svg viewBox="0 0 16 16" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M2 5.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 14 5.5v1a1 1 0 0 0 0 2v1a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 9.5v-1a1 1 0 0 0 0-2v-1Z" strokeLinejoin="round" />
            <path d="M6 4v8" strokeDasharray="1.6 1.6" strokeLinecap="round" />
          </svg>
        </button>

        {onOpenSearch ? (
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Search players"
            className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <svg viewBox="0 0 16 16" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 14 14" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}

        <button
          type="button"
          onClick={onRefresh}
          // The timestamp is the label: a bare refresh icon says an update is
          // possible, this says whether one is needed.
          title={lastFetched ? `Last updated ${lastFetched.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Refresh'}
          aria-label="Refresh data"
          className="flex items-center gap-1 rounded-md px-1.5 py-1.5 text-[11px] text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink-muted"
        >
          <svg
            viewBox="0 0 16 16"
            width={13}
            height={13}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden
            className={loading ? 'animate-spin' : undefined}
          >
            <path d="M13.5 8a5.5 5.5 0 1 1-1.7-4" strokeLinecap="round" />
            <path d="M13 1.5V4h-2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="hidden tabular-nums sm:inline">
            {loading
              ? 'Updating'
              : lastFetched
                ? lastFetched.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                : 'Refresh'}
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenSlip}
          className="lb-btn-primary flex items-center gap-1.5 rounded-md bg-masters px-2.5 py-1.5 text-[12px] font-semibold text-white shadow-card"
        >
          Slip
          <span className="rounded bg-white/20 px-1 tabular-nums">{slipCount}</span>
        </button>

        <AccountMenu />
      </div>
    </div>
  );
}

export default TopBar;
