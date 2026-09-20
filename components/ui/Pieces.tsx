'use client';

/*
 * The borrowed pieces (U spec §4, "Borrowed pieces"), adapted from Untitled UI
 * React @ c981a73bcd6b6c68d2a54070f20f020191212828 (MIT) and rewritten to our
 * tokens, our type ramp and our `cx`.
 *
 * "Borrowed" rather than "adopted" is the distinction the scorecard draws:
 * these take Untitled UI's LOOK onto components we already own the rules for.
 * `Avatar` still falls back to a silhouette and never to initials; `Chip` still
 * only carries semantic tones.
 */

import type { ReactNode } from 'react';
import { Avatar } from './Avatar';
import { cx } from './cx';

/* -------------------------------------------------------------------------- */

export interface TagProps {
  label: ReactNode;
  /** Renders the close button. Without it a Tag is a plain label. */
  onRemove?: () => void;
  /** Names the thing being removed: "Remove Aaron Judge". */
  removeLabel?: string;
  /** A leading dot, for a compare slot's own colour. */
  dot?: string;
  className?: string;
}

/**
 * `Tag` — a REMOVABLE pill. The compare targets on the player and team pages
 * (`?vs=` / `?peer=`) are the reason it exists: a chip cannot be dismissed, and
 * a compare target must be.
 */
export function Tag({ label, onRemove, removeLabel, dot, className }: TagProps) {
  return (
    <span className={cx('inline-flex max-w-full items-center gap-1.5 rounded-[6px] px-2 py-1 text-body-sm font-medium text-ink ring-1 ring-line ring-inset', className)}>
      {dot ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dot }} /> : null}
      <span className="truncate">{label}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? (typeof label === 'string' ? `Remove ${label}` : 'Remove')}
          className="-mr-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[3px] text-ink-muted hover:bg-card-sunk hover:text-ink"
        >
          <svg viewBox="0 0 12 12" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
            <path d="M3.5 3.5l5 5M8.5 3.5l-5 5" />
          </svg>
        </button>
      ) : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

export interface AvatarLabelProps {
  name: ReactNode;
  /** ONE sub-line. Two would be a card, not a row. */
  sub?: ReactNode;
  src?: string;
  fallbackSrc?: string;
  size?: 24 | 32 | 40;
  kind?: 'player' | 'logo' | 'flag';
  teamColor?: string;
  href?: string;
  className?: string;
}

/**
 * `AvatarLabel` — the standard person-or-team row: a photo, the name, and one
 * sub-line. It replaces the ad hoc name rows scattered through the cards, and
 * it is what a Slate card, a spotlight and a compare picker all use so a player
 * looks the same wherever they appear.
 */
export function AvatarLabel({ name, sub, src, fallbackSrc, size = 32, kind = 'player', teamColor, href, className }: AvatarLabelProps) {
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-2', className)}>
      <Avatar
        label={typeof name === 'string' ? name : 'subject'}
        src={src}
        fallbackSrc={fallbackSrc}
        size={size}
        kind={kind}
        teamColor={teamColor}
        href={href}
        decorative
      />
      <span className="flex min-w-0 flex-col">
        <span className={cx('truncate font-semibold text-ink', size === 40 ? 'text-body' : 'text-body-sm')}>{name}</span>
        {sub ? <span className="truncate text-label text-ink-muted">{sub}</span> : null}
      </span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */

export interface AvatarGroupProps {
  people: Array<{ key: string; name: string; src?: string; fallbackSrc?: string; kind?: 'player' | 'logo' }>;
  /** Everyone beyond this becomes the "+N" circle. */
  max?: number;
  size?: 24 | 32;
  className?: string;
}

/**
 * `AvatarGroup` — an overlapped stack, then a "+N". A golf group, a game's
 * scratched players, the books quoting a line.
 */
export function AvatarGroup({ people, max = 4, size = 24, className }: AvatarGroupProps) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className={cx('inline-flex items-center', className)} role="img" aria-label={people.map((p) => p.name).join(', ')}>
      {/* No explicit z-index: DOM order stacks each avatar over the one before
          it, which is what keeps the "+N" fully visible at the end. Stacking
          the other way clipped the "+" behind the last face. */}
      {shown.map((p, i) => (
        <span key={p.key} className={cx('relative rounded-full ring-2 ring-card', i > 0 && '-ml-2')}>
          <Avatar label={p.name} src={p.src} fallbackSrc={p.fallbackSrc} size={size} kind={p.kind ?? 'player'} decorative />
        </span>
      ))}
      {rest > 0 ? (
        <span
          aria-hidden
          style={{ width: size, height: size }}
          className="relative -ml-2 grid place-items-center rounded-full bg-card-sunk text-overline font-semibold text-ink-secondary ring-2 ring-card tabular-nums"
        >
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

export type FeaturedIconTone = 'neutral' | 'good' | 'bad' | 'warn';

export interface FeaturedIconProps {
  icon: ReactNode;
  /** `soft` is a circle with a halo; `outline` a square with a ring. */
  variant?: 'soft' | 'outline';
  tone?: FeaturedIconTone;
  className?: string;
}

const TONE_SOFT: Record<FeaturedIconTone, string> = {
  neutral: 'bg-card-sunk text-ink-secondary',
  good: 'bg-good/10 text-good',
  bad: 'bg-bad/10 text-bad',
  warn: 'bg-warn/10 text-warn',
};

/**
 * `FeaturedIcon` — 40px. It is what gives `EmptyState`, `ErrorState` and a
 * Modal header something to lead with other than grey text.
 *
 * The halo is a 6px `paper` ring, which reads as a soft edge on a card and
 * disappears on the page ground — deliberate: the icon belongs to the card.
 */
export function FeaturedIcon({ icon, variant = 'soft', tone = 'neutral', className }: FeaturedIconProps) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-grid h-10 w-10 shrink-0 place-items-center',
        variant === 'soft' ? cx('rounded-full ring-[6px] ring-paper', TONE_SOFT[tone]) : 'rounded-ctl bg-card text-ink-secondary ring-1 ring-line ring-inset',
        className,
      )}
    >
      {icon}
    </span>
  );
}
