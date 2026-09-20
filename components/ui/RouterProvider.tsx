'use client';

import { useRouter } from 'next/navigation';
import { RouterProvider as AriaRouterProvider } from 'react-aria-components';
import type { ReactNode } from 'react';

declare module 'react-aria-components' {
  interface RouterConfig {
    routerOptions: NonNullable<Parameters<ReturnType<typeof useRouter>['push']>[1]>;
  }
}

/**
 * U0: React Aria's router bridge, wired to Next's.
 *
 * Every adopted component that takes an `href` — `Button`, `Link`, a menu item,
 * a breadcrumb — routes through this. Without it those all do a full page load
 * rather than a client-side navigation, which is silent: the link still works,
 * it just reloads the app. That is the U spec's own trap list, and it is the
 * reason this wrapper exists in U0 rather than arriving with the first
 * component that needs it.
 *
 * It renders nothing of its own, so the shell's markup is unchanged.
 */
export function RouterProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  return <AriaRouterProvider navigate={router.push}>{children}</AriaRouterProvider>;
}
