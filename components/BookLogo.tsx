'use client';

import { useEffect, useState } from 'react';

import { bookLabel, bookLogoUrl } from '@/lib/odds/books/registry';

/**
 * Sportsbook mark.
 *
 * Names and logo domains come from the one book registry
 * (`lib/odds/books/registry.ts`, P1 of the odds build); `bookLabel` and
 * `bookLogoUrl` are re-exported here so existing imports keep working.
 *
 * With no logo (no domain, or the favicon failed) it draws a one-letter
 * monogram tile rather than the book's name: the name used to be the
 * fallback, and callers that printed the label beside the logo showed it
 * twice ("parx parx"). `withLabel` adds the name beside the mark or tile.
 */
export { bookLabel, bookLogoUrl };

function Monogram({ label, size }: { label: string; size: number }) {
  const letter = (label.match(/[A-Za-z0-9]/)?.[0] ?? '?').toUpperCase();
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.62)), lineHeight: `${size}px` }}
      className="inline-block shrink-0 rounded-xs bg-ink text-center font-semibold text-paper"
    >
      {letter}
    </span>
  );
}

export interface BookLogoProps {
  bookId: string | undefined | null;
  size?: number;
  /** Shows the text label next to the mark, rather than only on image failure. */
  withLabel?: boolean;
  className?: string;
}

export function BookLogo({ bookId, size = 14, withLabel = false, className = '' }: BookLogoProps) {
  const [failed, setFailed] = useState(false);
  const url = bookLogoUrl(bookId, size * 2);

  useEffect(() => {
    setFailed(false);
  }, [bookId]);

  if (!bookId) return null;

  const label = bookLabel(bookId);
  const mark = !url || failed ? (
    <Monogram label={label} size={size} />
  ) : (
    <img
      src={url}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-xs object-contain"
    />
  );

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {mark}
      {withLabel ? <span className="text-overline font-normal tracking-normal text-ink-muted">{label}</span> : null}
    </span>
  );
}

export default BookLogo;
