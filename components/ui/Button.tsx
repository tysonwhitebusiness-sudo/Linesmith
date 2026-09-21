'use client';

/*
 * Adapted from Untitled UI React (`components/base/buttons/button.tsx`),
 * github.com/untitleduico/react @ c981a73bcd6b6c68d2a54070f20f020191212828, MIT.
 * Rewritten to our tokens, our type ramp, our sizes and our `cx`.
 */

import { Button as AriaButton, type ButtonProps as AriaButtonProps, Link as AriaLink } from 'react-aria-components';
import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * U1 — the Button family. One component per job (U spec §0): a page never
 * styles a button again.
 *
 * It replaces 96 hand-styled `<button>` elements and `.lb-btn-primary`, whose
 * graphite glow went with it. The behaviour comes from React Aria: press
 * (pointer, keyboard and touch treated the same), `data-pressed`,
 * `data-focus-visible`, and `href` routed through the `RouterProvider` in the
 * root layout so a link-button is a client-side navigation.
 *
 * Sizes are OURS, not Untitled UI's — ours are denser (U spec §2c):
 *
 *   sm  32px  body-sm 600  10px  card headers, table footers, filter bars
 *   md  36px  body 600     14px  the default
 *   lg  44px  body 600     16px  primary actions on a phone, modal footers,
 *                                login; 44 is the touch floor
 *
 * Variants: ONE primary per view — it is the main action. Everything else is
 * secondary, tertiary or link.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'link' | 'destructive' | 'destructive-secondary';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-masters text-white shadow-card hover:bg-masters-dark',
  secondary: 'bg-card text-ink ring-1 ring-line ring-inset hover:bg-card-sunk',
  tertiary: 'bg-transparent text-ink-secondary hover:bg-card-sunk hover:text-ink',
  link: 'bg-transparent p-0! h-auto! text-ink underline-offset-2 hover:underline',
  destructive: 'bg-bad text-white shadow-card hover:brightness-95',
  'destructive-secondary': 'bg-card text-bad-ink ring-1 ring-bad/25 ring-inset hover:bg-bad/5',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-body-sm font-semibold',
  md: 'h-9 gap-2 px-3.5 text-body font-semibold',
  lg: 'h-11 gap-2 px-4 text-body font-semibold',
};

/** Icon-only: square at the same heights. */
const ICON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-11 w-11',
};

/** Icons are 16px in `sm`, 18px in `md` and `lg` (U spec §4). */
export const iconPx = (size: ButtonSize): number => (size === 'sm' ? 16 : 18);

const BASE =
  'inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-ctl ' +
  'transition-[background-color,color,box-shadow,transform] duration-quick ease-standard ' +
  'data-[pressed]:scale-[0.98] ' +
  'disabled:cursor-not-allowed disabled:opacity-50 ' +
  // React Aria marks its own focus; `globals.css` styles `[data-focus-visible]`
  // and `:focus-visible` identically, as the one ring.
  'outline-hidden';

export interface ButtonProps extends Omit<AriaButtonProps, 'children' | 'className' | 'style'> {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. A spinner replaces it while `loading`. */
  icon?: ReactNode;
  /** Trailing icon — a chevron, an external-link mark. */
  iconTrailing?: ReactNode;
  /** A spinner replaces the leading icon, the label stays, and presses are ignored. */
  loading?: boolean;
  /** Renders a client-side link through the root layout's `RouterProvider`. */
  href?: string;
  target?: string;
  rel?: string;
  className?: string;
}

function Spinner({ size }: { size: ButtonSize }) {
  const px = iconPx(size);
  return (
    <svg width={px} height={px} viewBox="0 0 16 16" fill="none" aria-hidden className="animate-spin">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  iconTrailing,
  loading = false,
  href,
  target,
  rel,
  className,
  isDisabled,
  ...rest
}: ButtonProps) {
  const classes = cx(BASE, SIZE[size], VARIANT[variant], className);
  const inner = (
    <>
      {loading ? <Spinner size={size} /> : icon}
      {children}
      {iconTrailing}
    </>
  );

  if (href) {
    return (
      <AriaLink
        href={href}
        target={target}
        rel={rel}
        isDisabled={isDisabled || loading}
        className={classes}
        aria-label={rest['aria-label']}
      >
        {inner}
      </AriaLink>
    );
  }

  return (
    <AriaButton
      {...rest}
      // A loading button keeps its label and its width; it just stops
      // responding, so a second press cannot fire the same action twice.
      isDisabled={isDisabled || loading}
      aria-busy={loading || undefined}
      className={classes}
    >
      {inner}
    </AriaButton>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon' | 'iconTrailing'> {
  icon: ReactNode;
  /** Required: an icon-only button has no visible name. */
  'aria-label': string;
}

/** Square, icon-only. `aria-label` is not optional. */
export function IconButton({ icon, size = 'md', variant = 'tertiary', className, ...rest }: IconButtonProps) {
  return (
    <Button {...rest} variant={variant} size={size} className={cx(ICON_SIZE[size], 'px-0', className)}>
      {icon}
    </Button>
  );
}

/** The × in a modal, a slideout or a dismissible card. */
export function CloseButton({ size = 'md', className, ...rest }: Omit<IconButtonProps, 'icon' | 'aria-label'> & { 'aria-label'?: string }) {
  const px = iconPx(size);
  return (
    <IconButton
      {...rest}
      size={size}
      aria-label={rest['aria-label'] ?? 'Close'}
      className={className}
      icon={
        <svg width={px} height={px} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      }
    />
  );
}
