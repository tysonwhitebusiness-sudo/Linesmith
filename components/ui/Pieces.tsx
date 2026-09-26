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

import { useState, type ReactNode } from 'react';
import { Avatar } from './Avatar';
import { Tooltip } from './Tooltip';
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
  size?: 18 | 20 | 24 | 32;
  /** C0.3: name every mark in a Tooltip on the group (book marks, whose logos aren't self-explanatory). */
  tooltip?: boolean;
  className?: string;
}

/**
 * `AvatarGroup` — an overlapped stack, then a "+N". A golf group, a game's
 * scratched players, the books quoting a line.
 */
export function AvatarGroup({ people, max = 4, size = 24, tooltip, className }: AvatarGroupProps) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  const group = (
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
  return tooltip ? <Tooltip content={people.map((p) => p.name).join(', ')}>{group}</Tooltip> : group;
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
  good: 'bg-good/10 text-good-ink',
  bad: 'bg-bad/10 text-bad-ink',
  warn: 'bg-warn/10 text-warn-ink',
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

/* ---------------------------------------------------------------- ResultMark */

export type ResultKind = 'W' | 'L' | 'D' | 'hit' | 'miss' | 'dnp';

/**
 * C0.3 `ResultMark`: the one mark for "what happened". Replaces the W/L
 * squares hand-rolled in the player hero and the Specials receipts.
 *
 * `square` (22px, radius 6) for a game result: W on the solid good fill with
 * dark text, L on solid bad with white, D neutral. `dot` (18px circle) for a
 * graded call: a tick for a hit, a cross for a miss, a dash for did not play.
 * A `mark` ("-4" for a golf round) replaces the letter; the square grows.
 */
export function ResultMark({
  result,
  mark,
  kind = 'square',
  label,
  className,
}: {
  result: ResultKind | null;
  mark?: string;
  kind?: 'square' | 'dot';
  label?: string;
  className?: string;
}) {
  const good = result === 'W' || result === 'hit';
  const bad = result === 'L' || result === 'miss';
  const tone = good ? 'bg-good text-good-on' : bad ? 'bg-bad text-white' : 'bg-card-sunk text-ink-secondary';
  const glyph =
    kind === 'dot'
      ? good
        ? '\u2713'
        : bad
          ? '\u2715'
          : '\u2013'
      : (mark ?? (result === 'hit' ? 'W' : result === 'miss' ? 'L' : result === 'dnp' ? '\u2013' : (result ?? '\u00b7')));
  // A graded CALL is a hit or a miss, not a win or a loss: the receipts table
  // (C5) reads these to a screen reader, and "Win" for a player who homered is
  // a claim about a bet the page never makes. Found on /kit in the C8 closeout.
  const name =
    label ??
    (result === 'hit' ? 'Hit' : result === 'miss' ? 'Miss' : good ? 'Win' : bad ? 'Loss' : result === 'D' ? 'Draw' : result === 'dnp' ? 'Did not play' : 'No result');
  return (
    <span
      role="img"
      aria-label={name}
      className={cx(
        'inline-grid shrink-0 place-items-center font-bold tabular-nums',
        kind === 'dot' ? 'h-[18px] w-[18px] rounded-full text-overline' : 'h-[22px] min-w-[22px] rounded-[6px] px-1 text-label',
        tone,
        className,
      )}
    >
      <span aria-hidden>{glyph}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * `ClampText` — a sentence that belongs to a row, at ONE fixed width, two lines
 * until pressed (slate-polish v4, operator-approved 2026-09-26).
 *
 * WHY A FIXED WIDTH. Laid across the full width of a row, the sentence stopped
 * wherever it ended: short ones stopped halfway, long ones ran off the card,
 * and the rows read as ragged. Under the name at one width, every row keeps
 * the same shape. Pressing it opens the rest in place.
 */
export function ClampText({ children, className }: { children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation();
        setOpen((v) => !v);
      }}
      className={cx(
        'mt-1 block w-[290px] max-w-full cursor-pointer text-left text-label text-ink-secondary',
        !open && 'line-clamp-2',
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * `StatusMark` — a status as an icon and at most one word, with its reason in
 * two or three grey words beneath (slate-polish v4). It replaced a pill per
 * row that restated the verdict in a sentence.
 */
export function StatusMark({ status, word, reason, className }: { status: 'ok' | 'hold' | 'no'; word: string; reason?: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex flex-col', className)}>
      <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap text-body-sm font-bold', status === 'ok' ? 'text-good-ink' : status === 'hold' ? 'text-warn-ink' : 'text-ink-muted')}>
        <svg aria-hidden width="15" height="15" viewBox="0 0 16 16" className="shrink-0">
          {status === 'ok' ? (
            <>
              <circle cx="8" cy="8" r="8" className="fill-good" />
              <path d="M4.5 8.2 7 10.6l4.6-5" className="stroke-good-on" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </>
          ) : status === 'hold' ? (
            <>
              <circle cx="8" cy="8" r="8" className="fill-warn" />
              <path d="M6.2 5v6M9.8 5v6" className="stroke-ink" strokeWidth="1.8" strokeLinecap="round" />
            </>
          ) : (
            <>
              <circle cx="8" cy="8" r="7.2" fill="none" className="stroke-ink-faint" strokeWidth="1.6" />
              <path d="M5.5 8h5" className="stroke-ink-muted" strokeWidth="1.8" strokeLinecap="round" />
            </>
          )}
        </svg>
        {word}
      </span>
      {reason ? <span className="ml-[21px] whitespace-nowrap text-label text-ink-muted">{reason}</span> : null}
    </span>
  );
}
