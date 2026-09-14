'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { cx } from './cx';

/**
 * Page-level navigation — R3 3d.
 *
 * `BackLink`: a breadcrumb back that NAMES its destination ("← Kansas City
 * Chiefs"), unlike `router.back()`, which goes wherever history says —
 * sometimes out of the app entirely.
 *
 * `useUrlState`: keeps a piece of page state (section, scope, market, game
 * state, compare target) in the query string, so a page can be linked to,
 * reloaded or shared exactly as it was. Writes use `replace` with
 * `scroll: false`, so changing a scope neither adds a history entry nor jumps
 * the page.
 */
export function BackLink({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <Link href={href} className={cx('inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap px-2 text-body-sm font-medium text-ink-secondary hover:text-ink', className)}>
      <span aria-hidden>←</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function useUrlState<T extends string>(key: string, fallback: T, allowed?: readonly T[]): [T, (next: T) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params?.get(key);
  const value = raw != null && (!allowed || (allowed as readonly string[]).includes(raw)) ? (raw as T) : fallback;

  const set = useCallback(
    (next: T) => {
      const q = new URLSearchParams(params?.toString() ?? '');
      if (next === fallback) q.delete(key);
      else q.set(key, next);
      const qs = q.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}${window.location.hash}`, { scroll: false });
    },
    [params, router, pathname, key, fallback],
  );
  return [value, set];
}
