'use client';

import type { MarketEdge } from '@/lib/odds/section/types';
import type { SlateOddsGame } from '@/lib/odds/section/slate';
import { useEffect, useState } from 'react';
import { EmptyState, FeaturedIcon, SegmentedToggle, Skeleton, cx, SectionBand } from '@/components/ui';
import type { SlateData, SlateSection, SlateStatus } from '@/lib/sports/shared/slateShapes';
import { GameCard } from './GameCard';

/**
 * The Slate's shell: the sticky section nav, and the Games section (S1).
 *
 * `SlatePage` is not a separate route — the Slate REPLACES Scan in place at
 * `/{sport}` (D1), keeping the chrome exactly as it is: the TopBar and the date
 * strip are untouched, and only the body under them changes. So what lives here
 * is the body's sections, mounted by `AppShell` where Scan's body used to be.
 *
 * The nav is derived from the data, never declared beside it, so a section
 * cannot be in the nav and missing from the page or the reverse. A section with
 * nothing in it drops out of both.
 */

/* -------------------------------------------------------------------------- */

export function SlateSectionNav({ sections }: { sections: SlateSection[] }) {
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null);
  // The page's own header (TopBar + the date strip) is sticky at `top: 0`, and
  // its height is not a constant — golf's strip, tennis's and the team sports'
  // are all different, and the strip itself reflows at 400px. Sticking this nav
  // at a hard-coded offset put it ON TOP of the strip. Measured instead.
  const [headerH, setHeaderH] = useState(0);

  useEffect(() => {
    const header = document.querySelector('header');
    if (!header) return;
    const measure = () => setHeaderH(header.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  // Which section the reader is actually looking at, so the nav follows the
  // page rather than only the last thing clicked.
  useEffect(() => {
    if (sections.length === 0) return;
    const nodes = sections.map((s) => document.getElementById(`slate-${s.id}`)).filter((n): n is HTMLElement => n != null);
    if (nodes.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id.replace('slate-', ''));
      },
      { rootMargin: `-${headerH + 56}px 0px -60% 0px` },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [sections, headerH]);

  if (sections.length === 0) return null;

  return (
    <nav
      aria-label="Slate sections"
      style={{ top: headerH }}
      className="lb-scroll-x sticky z-10 -mx-4 mb-3 flex gap-1 border-b border-char3 bg-paper/95 px-4 py-2 backdrop-blur"
    >
      {sections.map((s) => {
        const on = s.id === active;
        return (
          <a
            key={s.id}
            href={`#slate-${s.id}`}
            aria-current={on ? 'true' : undefined}
            onClick={() => setActive(s.id)}
            className={cx(
              'inline-flex shrink-0 items-center gap-1.5 rounded-ctl px-3 py-1.5 text-body-sm font-semibold transition-colors duration-instant',
              on ? 'bg-card text-ink shadow-card ring-1 ring-line ring-inset' : 'text-ink-muted hover:text-ink',
            )}
          >
            {s.label}
            {s.count != null ? (
              <span className={cx('rounded-[6px] px-1.5 py-px text-overline font-semibold tabular-nums', on ? 'bg-card-sunk text-ink-secondary' : 'bg-card-sunk text-ink-muted')}>
                {s.count.toLocaleString()}
              </span>
            ) : null}
          </a>
        );
      })}
    </nav>
  );
}

/* -------------------------------------------------------------------------- */

const FILTERS: Array<{ value: SlateStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pre', label: 'Upcoming' },
  { value: 'live', label: 'Live' },
  { value: 'done', label: 'Final' },
];

export function SlateGames({ data, loading, odds, edges }: { data: SlateData | null; loading: boolean; odds?: Map<string, SlateOddsGame>; edges?: MarketEdge[] }) {
  const [filter, setFilter] = useState<SlateStatus | 'all'>('all');
  const games = data?.games;

  if (loading && !games) {
    return (
      <section id="slate-games" className="mb-6 scroll-mt-[150px]">
        <SectionBand title="Games" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 wide:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-card border border-line-soft bg-card p-4 shadow-card">
              <Skeleton h={18} w="40%" />
              <div className="mt-3 space-y-2">
                <Skeleton h={20} w="70%" />
                <Skeleton h={20} w="65%" />
              </div>
              <div className="mt-3">
                <Skeleton h={44} w="100%" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!games) return null;

  const shown = filter === 'all' ? games.cards : games.cards.filter((c) => c.status === filter);
  const count = (v: SlateStatus | 'all') => (v === 'all' ? games.counts.all : games.counts[v]);

  return (
    <section id="slate-games" className="mb-6 scroll-mt-[150px]">
      <SectionBand
        title={games.noun === 'matches' ? 'Matches' : 'Games'}
        right={
          games.cards.length > 0 ? (
            <SegmentedToggle
              label="Game status"
              size="sm"
              value={filter}
              onChange={setFilter}
              options={FILTERS.map((f) => ({ value: f.value, label: `${f.label} ${count(f.value)}` }))}
            />
          ) : null
        }
      />

      {games.cards.length === 0 ? (
        <div className="rounded-card border border-line-soft bg-card shadow-card">
          <EmptyState
            icon={<CalendarGlyph />}
            title={`No ${games.noun} today`}
            reason={games.note ?? `The schedule holds no ${games.noun} for this date.`}
          />
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-card border border-line-soft bg-card shadow-card">
          <EmptyState title="Nothing in this state" reason={`No ${games.noun} are ${FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} right now.`} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 wide:grid-cols-3">
          {shown.map((c) => (
            <GameCard key={c.id} card={c} sport={data.sport} odds={odds?.get(c.id)} edgeCount={edges?.filter((e) => e.gameId === c.id).length ?? 0} />
          ))}
        </div>
      )}

      {data?.warnings?.length ? (
        <p className="mt-2 text-label text-ink-muted">{data.warnings.join(' ')}</p>
      ) : null}
    </section>
  );
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <rect x="2.75" y="4.25" width="14.5" height="13" rx="2" />
      <path d="M2.75 8h14.5M6.5 2.75v3M13.5 2.75v3" />
    </svg>
  );
}

/** Kept beside the nav so both read from the same `FeaturedIcon` import. */
export { FeaturedIcon };
