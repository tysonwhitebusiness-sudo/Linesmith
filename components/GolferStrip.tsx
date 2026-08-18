'use client';

import { useEffect, useRef, useState } from 'react';
import type { SubjectSummary } from '@/lib/core/types';
import { SubjectAvatar } from './SubjectAvatar';
import { PauseIcon, PlayIcon } from './icons';

/**
 * Golf's counterpart to the MLB game-scroller (`DateGameStrip.tsx`) — same
 * slow looping auto-scroll, hover-to-pause, and mouse drag-to-pan, copied
 * over rather than shared since DateGameStrip also carries MLB's Today/
 * Tomorrow/date-picker controls that don't apply to a single tournament.
 * Golf has no team-vs-team matchup, so each chip is one golfer instead:
 * position, avatar, name, live score — leaderboard-ordered.
 */

/** Slow — a background loop through the field, not a ticker. Matches DateGameStrip's own pace. */
const AUTOSCROLL_PX_PER_SECOND = 16;

export interface GolferStripProps {
  subjects: SubjectSummary[];
  /** Null means "All". */
  selectedPlayerId: string | null;
  /** Called with null for the All chip. */
  onSelectPlayer: (playerId: string | null) => void;
  /** Called when a chip should take the user to that golfer's page. */
  onNavigateToPlayer?: (playerId: string) => void;
}

/** The lowest-score-first sort every leaderboard/scan surface already uses — parses the leading score token off `statusLine` ("-3 · thru 14", "+2 · F"). */
function leaderboardScore(statusLine: string | undefined): number {
  const token = statusLine?.split(' ')[0] ?? '';
  if (/^e$/i.test(token)) return 0;
  const n = Number(token.replace('+', ''));
  return Number.isFinite(n) ? n : 999;
}

/** "-3 · thru 14" → ["-3", "thru 14"]; "+2 · F" → ["+2", "F"]; no thru yet → ["-3", null]. */
function splitStatusLine(statusLine: string | undefined): [string, string | null] {
  if (!statusLine) return ['—', null];
  const [score, ...rest] = statusLine.split(' · ');
  return [score, rest.length > 0 ? rest.join(' · ') : null];
}

export function GolferStrip({ subjects, selectedPlayerId, onSelectPlayer, onNavigateToPlayer }: GolferStripProps) {
  const ordered = [...subjects].sort((a, b) => leaderboardScore(a.statusLine) - leaderboardScore(b.statusLine));

  // Same auto-scroll/drag-to-pan mechanics as DateGameStrip — see that
  // file's comments for why pointer capture is deferred to the first real
  // drag movement rather than grabbed on every pointerdown.
  const [playing, setPlaying] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef(false);
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
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const delta = e.clientX - dragStartXRef.current;
    if (Math.abs(delta) > 4 && !draggedRef.current) {
      draggedRef.current = true;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* no active pointer */
      }
    }
    el.scrollLeft = dragStartScrollRef.current - delta;
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      scrollRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
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
  }, [playing, subjects.length]);

  if (subjects.length === 0) {
    return (
      <div className="border-t border-line bg-ink/[0.02] py-2 text-center text-[11px] text-ink-faint">
        No field posted yet
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 border-t border-line bg-ink/[0.02] px-3 py-2">
      <div
        ref={scrollRef}
        onMouseEnter={() => {
          hoveredRef.current = true;
        }}
        onMouseLeave={() => {
          hoveredRef.current = false;
        }}
        onFocus={() => {
          hoveredRef.current = true;
        }}
        onBlur={() => {
          hoveredRef.current = false;
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        className="lb-scroll-x flex min-w-0 flex-1 cursor-grab select-none items-center gap-1.5 active:cursor-grabbing"
      >
        <button
          type="button"
          onClick={() => onSelectPlayer(null)}
          aria-pressed={selectedPlayerId === null}
          className={`shrink-0 self-stretch rounded-xl px-3 text-[12px] font-semibold transition-colors ${
            selectedPlayerId === null ? 'bg-masters text-white shadow-card' : 'border border-line bg-card text-ink-muted hover:border-masters/30'
          }`}
        >
          All
        </button>

        {ordered.map((s) => {
          const selected = s.subjectId === selectedPlayerId;
          const meta = (s.meta ?? {}) as Record<string, unknown>;
          const position = typeof meta.position === 'string' ? meta.position : null;
          const [score, thru] = splitStatusLine(s.statusLine);

          return (
            <button
              key={s.subjectId}
              type="button"
              onClick={() => (onNavigateToPlayer ? onNavigateToPlayer(s.subjectId) : onSelectPlayer(s.subjectId))}
              aria-pressed={selected}
              className={`flex w-[150px] shrink-0 flex-col justify-center gap-0.5 rounded-xl border px-2 py-1.5 leading-tight shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-card-hover ${
                selected ? 'border-masters bg-masters text-white' : 'border-line bg-card text-ink-muted hover:border-masters/30'
              }`}
            >
              <span className="flex w-full items-center gap-1.5">
                <SubjectAvatar
                  name={s.subjectName}
                  headshotUrl={typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined}
                  fallbackUrl={typeof meta.flagUrl === 'string' ? meta.flagUrl : undefined}
                  size={18}
                />
                <span className={`min-w-0 flex-1 truncate text-[11.5px] font-semibold ${selected ? 'text-white' : 'text-ink'}`}>
                  {s.subjectName}
                </span>
              </span>
              <span className="flex w-full items-center gap-1 text-[10px]">
                <span className={`font-semibold uppercase tracking-wide ${selected ? 'text-white/80' : 'text-ink-faint'}`}>
                  {position ?? '—'}
                </span>
                <span className={`ml-auto font-bold tabular-nums ${selected ? 'text-white' : 'text-ink'}`}>{score}</span>
                {thru ? <span className={`shrink-0 ${selected ? 'text-white/75' : 'text-ink-faint'}`}>{thru}</span> : null}
              </span>
            </button>
          );
        })}
      </div>

      {/* Discreet — barely there until you look for it or hover it, same as DateGameStrip's. */}
      <button
        type="button"
        onClick={() => setPlaying((v) => !v)}
        aria-label={playing ? 'Pause field auto-scroll' : 'Resume field auto-scroll'}
        title={playing ? 'Pause auto-scroll' : 'Resume auto-scroll'}
        className="shrink-0 rounded-full p-1.5 text-ink-faint opacity-40 transition-opacity hover:opacity-100"
      >
        {playing ? <PauseIcon size={11} /> : <PlayIcon size={11} />}
      </button>
    </div>
  );
}

export default GolferStrip;
