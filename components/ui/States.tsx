import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';

/**
 * Loading, empty and error states — R3 3b. One of each, so a card never invents
 * its own "Loading…" string or prints raw API text (design finding D5).
 */

/** A placeholder block. Size it like the content it stands in for, so nothing reflows on arrival. */
export function Skeleton({ w, h = 12, className, round = 'rounded' }: { w?: number | string; h?: number; className?: string; round?: string }) {
  return <span aria-hidden className={cx('lb-skel block', round, className)} style={{ width: typeof w === 'number' ? `${w}px` : w, height: `${h}px` }} />;
}

/** Several text-line skeletons, the default card body while loading. */
export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} w={i === lines - 1 ? '60%' : '100%'} h={12} />
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  /** What is missing, in a few words: "No 2026 games yet". */
  title: string;
  /** WHY it is missing. Required: an empty state that doesn't say why reads as a bug. */
  reason: string;
  /** The nearest real data, when there is some: "Show 2025". */
  action?: { label: string; onClick?: () => void; href?: string };
  className?: string;
}

export function EmptyState({ title, reason, action, className }: EmptyStateProps) {
  return (
    <div className={cx('px-4 py-8 text-center', className)}>
      <p className="text-body font-semibold text-ink">{title}</p>
      <p className="mt-1 text-body-sm text-ink-muted">{reason}</p>
      {action ? (
        <Button variant="secondary" size="sm" href={action.href} onPress={action.onClick} className="mt-3">
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

export interface ErrorStateProps {
  /** Human text. Never the raw API or exception message. */
  message: string;
  onRetry?: () => void;
  /** Cached content to keep showing under the error, when there is some. */
  stale?: ReactNode;
  className?: string;
}

/** An error that keeps what the page already had: the message sits above the cached content rather than replacing it. */
export function ErrorState({ message, onRetry, stale, className }: ErrorStateProps) {
  return (
    <div className={className}>
      <div role="alert" className={cx('flex items-center gap-3 rounded-ctl border border-bad/25 bg-bad/5 px-3 py-2', stale ? 'mb-3' : '')}>
        <p className="flex-1 text-body-sm text-ink">
          {message}
          {stale ? <span className="text-ink-muted"> Showing the last data we had.</span> : null}
        </p>
        {onRetry ? (
          <Button variant="secondary" size="sm" onPress={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
      {stale}
    </div>
  );
}
