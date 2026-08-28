'use client';

import dynamicImport from 'next/dynamic';
import { useParams, notFound } from 'next/navigation';
import { SOCCER_LEAGUES, type SoccerLeague } from '@/lib/core/types';
import { BrandedLoader } from '@/components/BrandedLoader';

function isSoccerLeague(v: string): v is SoccerLeague {
  return (SOCCER_LEAGUES as string[]).includes(v);
}

/**
 * `ssr: false` is load-bearing here — see app/tennis/[tour]/page.tsx's doc
 * comment for the full bisection. Statically importing AppShell directly
 * into a page nested one level under a `[bracket]` route segment never
 * hydrated in a production build; every flat sport route (app/nhl/page.tsx
 * etc.) does the identical static import with no issue. Routing it through
 * `next/dynamic(..., { ssr: false })` sidesteps the bug; verified live.
 */
const AppShell = dynamicImport(() => import('@/components/AppShell'), {
  ssr: false,
  loading: () => <BrandedLoader size="page" />,
});

export default function SoccerLeaguePage() {
  const params = useParams<{ league: string }>();
  const league = params?.league ?? '';
  if (!isSoccerLeague(league)) notFound();

  return <AppShell sport="soccer" league={league} />;
}
