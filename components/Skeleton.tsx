/**
 * Loading placeholders.
 *
 * Every skeleton here is sized to the component it stands in for, so nothing
 * reflows when the real content arrives — a bare "Loading…" string collapses
 * to a single line and then shoves the whole page down on arrival.
 */

export function Skeleton({
  w,
  h = 12,
  className = '',
  rounded = 'rounded',
}: {
  /** CSS width — number = px, string passed through (e.g. '60%'). */
  w?: number | string;
  h?: number;
  className?: string;
  rounded?: string;
}) {
  return (
    <span
      aria-hidden
      className={`lb-skel block ${rounded} ${className}`}
      style={{ width: typeof w === 'number' ? `${w}px` : w, height: `${h}px` }}
    />
  );
}

/** Matches ScanCard's geometry: avatar + two text lines + marks + buttons. */
export function ScanCardSkeleton() {
  return (
    <article className="lb-card p-3.5" aria-hidden>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <Skeleton w={36} h={36} rounded="rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
            <Skeleton w="55%" h={13} />
            <Skeleton w="70%" h={11} />
          </div>
        </div>
        <Skeleton w={74} h={20} rounded="rounded-full" />
      </div>

      <div className="mt-3">
        <Skeleton w={140} h={15} />
      </div>

      <div className="mt-2.5 flex gap-1.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} w={28} h={28} rounded="rounded-full" />
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <Skeleton w="100%" h={36} rounded="rounded-lg" className="flex-1" />
        <Skeleton w={44} h={36} rounded="rounded-lg" />
      </div>
    </article>
  );
}

export function ScanListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2.5" role="status" aria-label="Loading picks">
      {Array.from({ length: count }, (_, i) => (
        <ScanCardSkeleton key={i} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Dense-view equivalent — same row height as the real table. */
export function DenseRowsSkeleton({ count = 6, cols = 6 }: { count?: number; cols?: number }) {
  return (
    <div className="lb-card overflow-hidden p-2" role="status" aria-label="Loading picks">
      {Array.from({ length: count }, (_, row) => (
        <div key={row} className="flex items-center gap-2 border-t border-line px-1 py-2 first:border-t-0">
          {Array.from({ length: cols }, (_, col) => (
            <Skeleton key={col} w={col === 0 ? '30%' : '12%'} h={12} className={col === 0 ? 'flex-1' : ''} />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/**
 * Odds-only skeleton for a game card.
 *
 * The snapshot and the odds arrive on separate requests, so team names and
 * starters are already on screen — this fills just the strip below them.
 */
export function GameOddsSkeleton({ live = false }: { live?: boolean }) {
  return (
    <div className="mt-2.5 border-t border-line pt-2.5" aria-hidden>
      {live ? <Skeleton w="100%" h={38} rounded="rounded-lg" className="mb-2" /> : null}
      <div className="flex items-end gap-5">
        <div className="space-y-1.5">
          <Skeleton w={68} h={20} />
          <Skeleton w={40} h={8} />
        </div>
        <div className="space-y-1.5">
          <Skeleton w={52} h={20} />
          <Skeleton w={30} h={8} />
        </div>
        <div className="space-y-1.5">
          <Skeleton w={44} h={20} />
          <Skeleton w={34} h={8} />
        </div>
      </div>
      <Skeleton w={92} h={10} className="mt-2.5" />
    </div>
  );
}

/** Course tab: header block plus the per-hole strip. */
export function CourseSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading course">
      <section className="lb-card space-y-2 p-4">
        <Skeleton w="45%" h={15} />
        <Skeleton w="60%" h={11} />
        <Skeleton w="70%" h={11} />
      </section>
      <section className="lb-card p-4">
        <Skeleton w={110} h={13} className="mb-3" />
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} w={58} h={78} rounded="rounded-lg" />
          ))}
        </div>
      </section>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Context tab for MLB: the slate before any of it has arrived. */
export function SlateSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading slate">
      {Array.from({ length: count }, (_, i) => (
        <section key={i} className="lb-card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <Skeleton w={110} h={14} />
            <Skeleton w={60} h={11} />
          </div>
          <Skeleton w="55%" h={11} className="mt-2" />
          <Skeleton w="45%" h={11} className="mt-1.5" />
          <GameOddsSkeleton />
        </section>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Player tab: identity card plus one pattern block. */
export function PlayerSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading player">
      <section className="lb-card flex items-center gap-3 p-4">
        <Skeleton w={56} h={56} rounded="rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton w="50%" h={16} />
          <Skeleton w="35%" h={12} />
        </div>
      </section>
      <section className="lb-card space-y-3 p-3">
        <Skeleton w="60%" h={13} />
        <div className="flex gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} w={54} h={52} rounded="rounded-lg" />
          ))}
        </div>
        <Skeleton w="100%" h={44} rounded="rounded-lg" />
      </section>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export default Skeleton;
