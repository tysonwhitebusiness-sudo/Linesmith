'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Sport, SoccerLeague, TennisTour } from '@/lib/core/types';
import { SPORTS, SPORT_LABEL, SOCCER_LEAGUES, SOCCER_LEAGUE_LABEL, TENNIS_TOURS, TENNIS_TOUR_LABEL } from '@/lib/core/types';
import { BrandedLoader } from './BrandedLoader';
import { AccountMenu } from './AccountMenu';
import { Button, IconButton, cx } from './ui';

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

/**
 * S1 (D2): the first tab is the SLATE. It was "Scan", and the rename is the
 * only change the chrome gets — the strip, the sport picker and the utilities
 * are untouched, because the Slate replaces Scan's BODY, not its page.
 *
 * `?tab=Scan` still works, and is read as `Slate` (`AppShell`): links, saved
 * tabs and anything the operator has bookmarked keep working.
 */
export const TABS = ['Slate', 'Players', 'Teams', 'Schedule'] as const;
export type Tab = (typeof TABS)[number];

export interface TopBarProps {
  sport: Sport;
  /** Soccer/tennis only — which competition or tour, since these are the sports with more than one. */
  league?: SoccerLeague | TennisTour;
  onLeagueChange?: (league: SoccerLeague | TennisTour) => void;
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
    <div className="flex h-12 items-center gap-2 px-2 sm:gap-3 sm:px-3">
      {/* Identity + sport */}
      {/* Shrinkable, not `shrink-0`: with a league or tour select beside the
          sport one, the fixed pieces outgrew a phone and pushed Slip and
          Sign in past the right edge. The selects truncate instead. */}
      <div className="flex min-w-0 shrink items-center gap-1 sm:gap-1.5">
        {/* Below `sm`, a second select (league, tour) needs the mark's room more
            than the mark does: with both, the selects truncated to "S" and "P". */}
        <img
          src="/brand/linesmith-mark.png"
          alt=""
          width={28}
          height={18}
          className={cx('h-[18px] w-auto select-none', (sport === 'soccer' || sport === 'tennis') && league && onLeagueChange && 'hidden sm:block')}
        />
        {/* Wordmark and Diagnostics drop below `sm`: at 400px the bar was 31px
            wider than the screen on every page, so phones scrolled sideways.
            The mark stays as the identity; Diagnostics is an admin tool. */}
        <span className="hidden select-none text-[15px] font-semibold tracking-tight text-ink sm:inline">
          Linesmith
        </span>
        <label className="sr-only" htmlFor="lb-sport">
          Sport
        </label>
        <select
          id="lb-sport"
          value={sport}
          onChange={(e) =>
            navigate('sport', e.target.value === 'soccer' ? '/soccer/epl' : e.target.value === 'tennis' ? '/tennis/atp' : `/${e.target.value}`)
          }
          disabled={isPending && pendingTarget === 'sport'}
          className="min-w-[3.25rem] max-w-[5.5rem] shrink cursor-pointer truncate rounded-md border border-line bg-card py-0.5 pl-1.5 pr-5 text-[12px] font-medium text-ink-muted focus:border-masters focus:outline-hidden disabled:cursor-wait disabled:opacity-70 sm:max-w-none"
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
              className="min-w-[3.25rem] max-w-[5.5rem] shrink cursor-pointer truncate rounded-md border border-line bg-card py-0.5 pl-1.5 pr-5 text-[12px] font-medium text-ink-muted focus:border-masters focus:outline-hidden sm:max-w-none"
            >
              {SOCCER_LEAGUES.map((l) => (
                <option key={l} value={l}>
                  {SOCCER_LEAGUE_LABEL[l]}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {sport === 'tennis' && league && onLeagueChange ? (
          <>
            <label className="sr-only" htmlFor="lb-tour">
              Tour
            </label>
            <select
              id="lb-tour"
              value={league}
              onChange={(e) => onLeagueChange(e.target.value as TennisTour)}
              className="min-w-[3.25rem] max-w-[5.5rem] shrink cursor-pointer truncate rounded-md border border-line bg-card py-0.5 pl-1.5 pr-5 text-[12px] font-medium text-ink-muted focus:border-masters focus:outline-hidden sm:max-w-none"
            >
              {TENNIS_TOURS.map((t) => (
                <option key={t} value={t}>
                  {TENNIS_TOUR_LABEL[t]}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {isPending && pendingTarget === 'sport' ? <BrandedLoader size="inline" label="Switching sport" /> : null}
      </div>

      {/* Navigation */}
      {/* `justify-center-safe`, not `justify-center`: a centred row that
          overflows spills off BOTH ends, and the start is unreachable by
          scrolling — at phone width "Slate" and half of "Players" vanished. */}
      <nav className="lb-scroll-x flex min-w-0 flex-1 items-center justify-center-safe gap-1">
        {leading}
        {tab && onTabChange
          ? TABS.filter(
              (t) =>
                (t !== 'Teams' || sport === 'mlb' || sport === 'nfl' || sport === 'soccer' || sport === 'cfb' || sport === 'nba' || sport === 'nhl') &&
                (t !== 'Schedule' || sport === 'golf' || sport === 'tennis'),
            ).map((t) => (
              // The shell's nav, not a content tab strip: the underline is its
              // own, and it keeps `aria-current="page"` rather than
              // `aria-selected`, because these navigate.
              <Button
                key={t}
                variant="tertiary"
                size="sm"
                onPress={() => {
                  if (t === 'Teams') navigate(t, sport === 'soccer' ? `/soccer/${league}/teams` : `/${sport}/teams`);
                  else if (t === 'Schedule') navigate(t, sport === 'tennis' ? `/tennis/${league}/schedule` : '/golf/schedule');
                  else onTabChange(t);
                }}
                aria-current={t === tab ? 'page' : undefined}
                className={cx(
                  'relative h-auto rounded-none px-2.5 py-3 text-body-sm font-normal hover:bg-transparent',
                  t === tab
                    ? 'font-semibold text-ink after:absolute after:inset-x-2.5 after:bottom-2 after:h-[2px] after:rounded-full after:bg-masters'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {t}
                {(isPending && pendingTarget === t) || pendingTab === t ? <BrandedLoader size="inline" label={`Loading ${t}`} /> : null}
              </Button>
            ))
          : null}
      </nav>

      {/* Utilities */}
      <div className="flex shrink-0 items-center gap-1">
        <IconButton
          size="sm"
          href="/diagnostics"
          aria-label="Diagnostics"
          className="hidden sm:inline-flex"
          icon={
            <svg viewBox="0 0 16 16" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M8 1.5v3M8 11.5v3M2.6 4.6l2.1 2.1M11.3 9.3l2.1 2.1M1.5 8h3M11.5 8h3M2.6 11.4l2.1-2.1M11.3 6.7l2.1-2.1" strokeLinecap="round" />
              <circle cx="8" cy="8" r="2.2" />
            </svg>
          }
        />

        <IconButton
          size="sm"
          href="/bets"
          aria-label="Live Bets"
          icon={
            <svg viewBox="0 0 16 16" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M2 5.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 14 5.5v1a1 1 0 0 0 0 2v1a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 9.5v-1a1 1 0 0 0 0-2v-1Z" strokeLinejoin="round" />
              <path d="M6 4v8" strokeDasharray="1.6 1.6" strokeLinecap="round" />
            </svg>
          }
        />

        {onOpenSearch ? (
          <IconButton
            size="sm"
            onPress={onOpenSearch}
            aria-label="Search players"
            icon={
              <svg viewBox="0 0 16 16" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5 14 14" strokeLinecap="round" />
              </svg>
            }
          />
        ) : null}

        {/* The timestamp is the label: a bare refresh icon says an update is
            possible, this says whether one is needed. Hidden below `sm` for
            width — `useSnapshot` already re-polls on an interval and on tab
            focus, so a phone loses no data by it. */}
        <Button
          variant="tertiary"
          size="sm"
          onPress={onRefresh}
          aria-label="Refresh data"
          className="hidden gap-1 px-1.5 text-overline font-normal text-ink-muted hover:text-ink-muted sm:inline-flex"
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
        </Button>

        <Button variant="primary" size="sm" onPress={onOpenSlip}>
          Slip
          <span className="rounded-xs bg-white/20 px-1 tabular-nums">{slipCount}</span>
        </Button>

        <AccountMenu />
      </div>
    </div>
  );
}

export default TopBar;
