'use client';

/**
 * On-brand loading state — the Linesmith mark held still inside a spinning
 * ring, replacing the gap where sport switches / tab navigations used to
 * show nothing at all between the click and the destination's own content.
 *
 * `page`: the full `loading.tsx` content for a route segment — same job a
 * full skeleton page used to do, real estate-wise.
 * `inline`: small enough to sit next to the sport `<select>` or a tab label
 * for the instant on-click feedback — logo omitted at this size (illegible
 * that small), ring only.
 *
 * Reuses Tailwind's stock `animate-spin` (same utility already spinning
 * TopBar's own refresh icon) rather than a second bespoke spin keyframe.
 */
export function BrandedLoader({ size = 'page', label = 'Loading' }: { size?: 'page' | 'inline'; label?: string }) {
  if (size === 'inline') {
    return (
      <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center" role="status" aria-label={label}>
        <svg viewBox="0 0 18 18" width={18} height={18} className="animate-spin motion-reduce:animate-none" aria-hidden>
          <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="2" strokeOpacity="0.18" className="text-masters" />
          <circle
            cx="9"
            cy="9"
            r="7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="11 33"
            className="text-masters"
          />
        </svg>
      </span>
    );
  }

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 py-16" role="status" aria-label={label}>
      <div className="relative flex h-[88px] w-[88px] items-center justify-center">
        <svg
          viewBox="0 0 88 88"
          width={88}
          height={88}
          className="absolute inset-0 animate-spin motion-reduce:animate-none motion-reduce:opacity-60"
          aria-hidden
        >
          <circle cx="44" cy="44" r="38" fill="none" stroke="currentColor" strokeWidth="3" strokeOpacity="0.14" className="text-masters" />
          <circle
            cx="44"
            cy="44"
            r="38"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="60 179"
            className="text-masters"
          />
        </svg>
        <img
          src="/brand/linesmith-mark.png"
          alt=""
          width={44}
          height={44}
          className="h-[44px] w-auto select-none motion-reduce:animate-lb-pulse"
        />
      </div>
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export default BrandedLoader;
