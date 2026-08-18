'use client';

import { useEffect, useState } from 'react';

/**
 * Sportsbook mark.
 *
 * No sportsbook publishes a stable public logo CDN the way MLB does for team
 * marks, so this hotlinks each book's real site favicon via Google's public
 * favicon proxy — the actual icon, not a fabricated asset path. Falls back to
 * the plain text label on failure, matching TeamLogo's degradation chain.
 */

const BOOK_DOMAIN: Record<string, string> = {
  draftkings: 'draftkings.com',
  fanduel: 'fanduel.com',
  fanatics: 'sportsbook.fanatics.com',
  betmgm: 'betmgm.com',
  caesars: 'caesars.com',
  // the-odds-api's raw bookmaker key for Caesars — normalised everywhere
  // else in the app, but the legacy game-odds feed passes this straight
  // through, so it needs its own entry rather than going unrecognised.
  williamhill_us: 'caesars.com',
  pinnacle: 'pinnacle.com',
  espnbet: 'espnbet.com',
  bovada: 'bovada.lv',
  pointsbet: 'pointsbet.com',
  unibet: 'unibet.com',
};

const BOOK_LABEL: Record<string, string> = {
  draftkings: 'DraftKings',
  fanduel: 'FanDuel',
  fanatics: 'Fanatics',
  betmgm: 'BetMGM',
  caesars: 'Caesars',
  williamhill_us: 'Caesars',
  pinnacle: 'Pinnacle',
  espnbet: 'ESPN Bet',
  bovada: 'Bovada',
  pointsbet: 'PointsBet',
  unibet: 'Unibet',
};

export function bookLabel(id: string | undefined | null): string {
  if (!id) return '';
  return BOOK_LABEL[id] ?? id;
}

export function bookLogoUrl(id: string | undefined | null, pixelSize = 32): string | undefined {
  if (!id) return undefined;
  const domain = BOOK_DOMAIN[id];
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=${pixelSize}` : undefined;
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

  if (!url || failed) {
    return <span className={`text-[10px] font-medium text-ink-muted ${className}`}>{bookLabel(bookId)}</span>;
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <img
        src={url}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
        className="shrink-0 rounded-sm object-contain"
      />
      {withLabel ? <span className="text-[10px] text-ink-muted">{bookLabel(bookId)}</span> : null}
    </span>
  );
}

export default BookLogo;
