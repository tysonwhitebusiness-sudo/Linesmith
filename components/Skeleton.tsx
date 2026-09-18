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
