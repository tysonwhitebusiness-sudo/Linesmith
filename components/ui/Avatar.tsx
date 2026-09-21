'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cx } from './cx';

/**
 * Avatar — R3 3b. Player photo, team logo or flag, with ONE fallback: a
 * silhouette on the team's color. Never initials (F2: initials on 16 captured
 * cards, club crests standing in for soccer headshots, blank NHL logos).
 *
 * Tries `src`, then `fallbackSrc`, then draws the silhouette. With `href` the
 * whole avatar is a link to that player or team page (R3 3d: every photo and
 * logo links).
 *
 * Sizes follow F2: 16 inline · 20 tables · 24 lists · 32 cards · 48 matchups ·
 * 72 hero.
 */
export interface AvatarProps {
  /** The accessible name: the player or team. */
  label: string;
  src?: string;
  fallbackSrc?: string;
  size?: number;
  /** `player` is a circle photo; `logo` a contained mark on a card tile; `flag` a small rounded rect. */
  kind?: 'player' | 'logo' | 'flag';
  /** A rounded-rect crop for a hero photo. */
  rounded?: boolean;
  /** The team's primary color, behind the silhouette. Any CSS color. */
  teamColor?: string;
  href?: string;
  /** When the avatar sits beside its own visible name, hide it from assistive tech. */
  decorative?: boolean;
  /** C0.3: a 3px white ring on a translucent disc, for a headshot overlapping a coloured hero band. */
  ring?: boolean;
  className?: string;
}

const SILHOUETTE = 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.3-8 5.2V21h16v-1.8c0-2.9-3.6-5.2-8-5.2Z';

export function Avatar({ label, src, fallbackSrc, size = 32, kind = 'player', rounded, teamColor, href, decorative, ring, className }: AvatarProps) {
  const sources = [src, fallbackSrc].filter((s): s is string => Boolean(s));
  const [index, setIndex] = useState(0);
  // A recycled row must restart the chain, or one subject's failure hides the next one's photo.
  useEffect(() => setIndex(0), [src, fallbackSrc]);
  const current = sources[index];

  const shape = kind === 'logo' ? 'rounded-[10px]' : kind === 'flag' ? 'rounded-[3px]' : rounded ? 'rounded-xl' : 'rounded-full';
  const box = cx(
    'relative inline-grid shrink-0 place-items-center overflow-hidden',
    shape,
    kind === 'logo' ? 'border border-line-soft bg-card' : '',
    ring && 'bg-white/12 ring-[3px] ring-white/85',
    className,
  );
  const style = { width: size, height: size, background: current || kind === 'logo' ? undefined : teamColor ?? 'oklch(62% 0.01 260)' };
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': label };

  const inner = current ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={current}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setIndex((i) => i + 1)}
      className={cx('h-full w-full', kind === 'logo' ? 'object-contain p-[12%]' : 'object-cover')}
    />
  ) : kind === 'logo' ? (
    <svg viewBox="0 0 24 24" className="h-[55%] w-[55%]" aria-hidden>
      {/* Decoration, so `ink-faint` is allowed here: a shield where a logo failed. */}
      <path d="M12 2.5 4 5.5v6c0 4.6 3.4 8.6 8 10 4.6-1.4 8-5.4 8-10v-6l-8-3Z" fill="oklch(var(--ink-faint))" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" aria-hidden>
      <path d={SILHOUETTE} fill="rgba(255,255,255,0.85)" />
    </svg>
  );

  if (href) {
    return (
      <Link href={href} className={box} style={style} {...(decorative ? { 'aria-hidden': true, tabIndex: -1 } : { 'aria-label': label })}>
        {inner}
      </Link>
    );
  }
  return (
    <span className={box} style={style} {...a11y}>
      {inner}
    </span>
  );
}
