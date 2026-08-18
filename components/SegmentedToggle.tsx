'use client';

import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Shared segmented pill toggle — a graphite glider slides behind whichever
 * option is active instead of the two states swapping color instantly.
 * Defaults match the pill shape GameDetail originally defined this as;
 * pass className/buttonClassName/gliderClassName to match a call site's own
 * size (see TeamDetail/PlayerDetail/PitchingMatchupCard's rect variant).
 */
export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  className = 'rounded-full border border-line p-0.5 text-meta',
  buttonClassName = 'rounded-full px-2.5 py-1',
  gliderClassName = 'rounded-full',
}: {
  options: Array<{ key: T; label: string; title?: string }>;
  value: T;
  onChange: (key: T) => void;
  className?: string;
  buttonClassName?: string;
  gliderClassName?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<T, HTMLButtonElement>());
  const [glider, setGlider] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const btn = buttonRefs.current.get(value);
      if (btn) setGlider({ left: btn.offsetLeft, width: btn.offsetWidth });
    };
    update();
    if (!containerRef.current) return;
    const ro = new ResizeObserver(update);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options.length]);

  return (
    <div ref={containerRef} className={`relative flex ${className}`}>
      {glider ? (
        <span
          aria-hidden
          className={`absolute inset-y-0.5 bg-masters transition-[transform,width] duration-200 ease-out ${gliderClassName}`}
          style={{ width: glider.width, transform: `translateX(${glider.left}px)` }}
        />
      ) : null}
      {options.map((o) => (
        <button
          key={o.key}
          ref={(el) => {
            if (el) buttonRefs.current.set(o.key, el);
            else buttonRefs.current.delete(o.key);
          }}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          title={o.title}
          className={`relative z-10 font-medium transition-colors ${buttonClassName} ${
            value === o.key ? 'text-white' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
