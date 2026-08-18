'use client';

import { useEffect, useRef, useState } from 'react';
import type { SlateGame } from '@/lib/odds/matching';
import { liveFor } from '@/lib/odds/matching';
import { easternDate, shiftDate } from '@/lib/sports/mlb/statsapi';
import { CalendarIcon, ChevronLeftIcon, PauseIcon, PlayIcon } from './icons';
import { TeamMark, formatGameTime, splitAbbrevs } from './GamesStrip';

const COLLAPSE_KEY = 'linesmith:date-strip-collapsed';
/** Slow — a background loop through the slate, not a ticker. */
const AUTOSCROLL_PX_PER_SECOND = 16;

/**
 * Today/Tomorrow/custom-date controls merged into the same horizontally-
 * scrolling row as the day's game chips — the Redesign Brief's "date + game
 * strip" section. Previously two separate bars (a plain "DATE" row, then
 * GamesStrip below it); this is AppShell-specific rather than a GamesStrip
 * rewrite, since GamesStrip itself is reused as a plain nav strip (no date
 * controls) on the team/game/player pages.
 *
 * Game-chip rendering (logos, score, Final/live state) is intentionally the
 * same logic GamesStrip already uses — imported, not duplicated — so a game
 * chip looks identical here and on those other pages.
 */

export interface DateGameStripProps {
  scanDate: string | undefined;
  onSetDate: (date: string | undefined) => void;
  games: SlateGame[];
  /** Null means "All". */
  selectedGamePk: number | null;
  /** Called with null for the All chip. */
  onSelectGame: (gamePk: number | null) => void;
  onNavigateToGame: (gamePk: number) => void;
  /** Same role as `GamesStrip`'s own `logoFor` — resolves a team logo by abbreviation for sports whose `SlateGame` has no numeric `awayTeamId`/`homeTeamId` (NFL). Omit for MLB's existing numeric-id path. */
  logoFor?: (abbreviation: string) => string | undefined;
}

export function DateGameStrip({ scanDate, onSetDate, games, selectedGamePk, onSelectGame, onNavigateToGame, logoFor }: DateGameStripProps) {
  const tomorrow = shiftDate(easternDate(), 1);
  const isToday = !scanDate;
  const isTomorrow = scanDate === tomorrow;

  const ordered = [...games].sort((a, b) => String(a.firstPitch ?? '').localeCompare(String(b.firstPitch ?? '')));

  // Collapsing Today/Tomorrow/the date picker down to one small toggle hands
  // the rest of the row to the game chips — persisted since it's a layout
  // preference, not per-visit state.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSE_KEY);
      if (stored !== null) setCollapsed(stored === 'true');
    } catch { /* quota */ }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(COLLAPSE_KEY, String(next)); } catch { /* quota */ }
      return next;
    });
  };

  // Slow, looping auto-scroll through the day's games — paused while the
  // strip is hovered/focused so a chip stays clickable, and skipped entirely
  // under prefers-reduced-motion.
  const [playing, setPlaying] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef(false);

  // Mouse drag-to-pan — hidden scrollbar means there's otherwise no visible
  // way to move the strip by hand while it's paused. Touch already scrolls
  // natively, so this only engages for mouse pointers. draggedRef survives
  // past pointerup so the click a drag ends on doesn't also navigate to a game.
  const draggingRef = useRef(false);
  const draggedRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartScrollRef = useRef(0);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const el = scrollRef.current;
    if (!el) return;
    draggingRef.current = true;
    draggedRef.current = false;
    dragStartXRef.current = e.clientX;
    dragStartScrollRef.current = el.scrollLeft;
    // Deliberately no setPointerCapture here — capturing on every mousedown,
    // including a plain click with no movement, made the browser retarget the
    // resulting click event at this div instead of whatever button the
    // pointer actually went down on, so a game chip's onClick never fired at
    // all (confirmed live: pointerdown hit the chip, click's target was this
    // div). Capture is deferred to the first real drag movement below, so a
    // plain click passes through untouched and only an actual drag gets the
    // capture (needed so panning keeps tracking the mouse if it leaves the
    // strip's bounds mid-drag).
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const delta = e.clientX - dragStartXRef.current;
    if (Math.abs(delta) > 4 && !draggedRef.current) {
      draggedRef.current = true;
      try { el.setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
    }
    el.scrollLeft = dragStartScrollRef.current - delta;
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try { scrollRef.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!draggedRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    draggedRef.current = false;
  };

  useEffect(() => {
    if (!playing) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = scrollRef.current;
    if (!el) return;

    let last: number | null = null;
    let raf = 0;
    const tick = (now: number) => {
      const dt = last === null ? 0 : now - last;
      last = now;
      if (!hoveredRef.current) {
        const max = el.scrollWidth - el.clientWidth;
        if (max > 0) {
          const next = el.scrollLeft + (AUTOSCROLL_PX_PER_SECOND * dt) / 1000;
          el.scrollLeft = next >= max ? 0 : next;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, games.length]);

  return (
    <div className="flex items-center gap-2 border-t border-line bg-ink/[0.02] px-3 py-2">
      {!collapsed ? (
        <>
          <button
            type="button"
            onClick={() => onSetDate(undefined)}
            aria-pressed={isToday}
            className={`shrink-0 rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors ${
              isToday ? 'bg-masters text-white shadow-card' : 'border border-line bg-card text-ink-muted hover:border-masters/30'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onSetDate(tomorrow)}
            aria-pressed={isTomorrow}
            className={`shrink-0 rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors ${
              isTomorrow ? 'bg-masters text-white shadow-card' : 'border border-line bg-card text-ink-muted hover:border-masters/30'
            }`}
          >
            Tomorrow
          </button>

          {/* Calendar icon with an invisible native date input on top — same overlay trick FilterBar's FilterSelect already uses, so the OS's own picker handles the calendar UI. */}
          <span className="relative flex shrink-0 items-center justify-center rounded-xl border border-line bg-card p-2.5 text-ink-muted hover:border-masters/30">
            <CalendarIcon size={16} />
            <input
              type="date"
              value={scanDate ?? ''}
              min={easternDate()}
              onChange={(e) => onSetDate(e.target.value || undefined)}
              aria-label="Pick a date"
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </span>
        </>
      ) : null}

      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Show date controls' : 'Hide date controls'}
        title={collapsed ? 'Show date controls' : 'Hide date controls'}
        className="shrink-0 rounded-xl border border-line bg-card p-2.5 text-ink-muted hover:border-masters/30"
      >
        <ChevronLeftIcon size={14} className={collapsed ? 'rotate-180' : ''} />
      </button>

      <div
        ref={scrollRef}
        onMouseEnter={() => { hoveredRef.current = true; }}
        onMouseLeave={() => { hoveredRef.current = false; }}
        onFocus={() => { hoveredRef.current = true; }}
        onBlur={() => { hoveredRef.current = false; }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        className="lb-scroll-x flex min-w-0 flex-1 cursor-grab select-none items-center gap-2 active:cursor-grabbing"
      >
        <button
          type="button"
          onClick={() => onSelectGame(null)}
          aria-pressed={selectedGamePk === null}
          className={`shrink-0 rounded-xl px-3 py-2 text-[12px] font-semibold transition-colors ${
            selectedGamePk === null ? 'bg-masters text-white shadow-card' : 'border border-line bg-card text-ink-muted hover:border-masters/30'
          }`}
        >
          All
        </button>

        {games.length === 0 ? (
          <span className="shrink-0 text-[11px] text-ink-faint">No games scheduled</span>
        ) : (
          ordered.map((game) => {
            const gamePk = Number(game.gamePk);
            if (!Number.isFinite(gamePk)) return null;

            const selected = selectedGamePk === gamePk;
            const isFinal = /final|completed|game over/i.test(game.state ?? '');
            const isLive = !isFinal && /live|in progress|manager challenge|delayed/i.test(game.state ?? '');
            const [awayAbbrev, homeAbbrev] = splitAbbrevs(game.matchup ?? '');
            const live = liveFor({ game, awayAbbrev, homeAbbrev } as never);
            const score = live.liveScore ? `${live.liveScore.away}–${live.liveScore.home}` : null;

            return (
              <button
                key={gamePk}
                type="button"
                onClick={() => onNavigateToGame(gamePk)}
                aria-pressed={selected}
                className={`flex shrink-0 flex-col items-center gap-0.5 rounded-xl border px-4 py-2 leading-tight transition-colors ${
                  selected ? 'border-masters bg-accent-soft text-masters' : 'border-line bg-card text-ink-muted hover:border-masters/30'
                }`}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  {logoFor ? (
                    <TeamMark logoUrl={logoFor(awayAbbrev)} />
                  ) : game.awayTeamId ? (
                    <TeamMark teamId={game.awayTeamId} />
                  ) : null}
                  <span>{awayAbbrev}</span>
                  <span className="text-[10px] font-normal text-ink-faint">@</span>
                  <span>{homeAbbrev}</span>
                  {logoFor ? (
                    <TeamMark logoUrl={logoFor(homeAbbrev)} />
                  ) : game.homeTeamId ? (
                    <TeamMark teamId={game.homeTeamId} />
                  ) : null}
                </span>
                <span className="text-[11px]">
                  {isLive ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-good">
                      <span className="inline-block h-1.5 w-1.5 animate-lb-pulse rounded-full bg-good" />
                      {score ?? formatGameTime(game.firstPitch)}
                      {live.livePeriod ? <span className="font-normal opacity-70">{live.livePeriod}</span> : null}
                    </span>
                  ) : isFinal ? (
                    <span className="text-ink-faint">{score ? `${score} ` : ''}Final</span>
                  ) : (
                    <span className="text-ink-faint">{formatGameTime(game.firstPitch)}</span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Discreet — barely there until you look for it or hover it. */}
      <button
        type="button"
        onClick={() => setPlaying((v) => !v)}
        aria-label={playing ? 'Pause game strip auto-scroll' : 'Resume game strip auto-scroll'}
        title={playing ? 'Pause auto-scroll' : 'Resume auto-scroll'}
        className="shrink-0 rounded-full p-1.5 text-ink-faint opacity-40 transition-opacity hover:opacity-100"
      >
        {playing ? <PauseIcon size={11} /> : <PlayIcon size={11} />}
      </button>
    </div>
  );
}

export default DateGameStrip;
