'use client';

import dynamicImport from 'next/dynamic';
import { useParams, notFound } from 'next/navigation';
import { TENNIS_TOURS, type TennisTour } from '@/lib/core/types';
import { BrandedLoader } from '@/components/BrandedLoader';

function isTennisTour(v: string): v is TennisTour {
  return (TENNIS_TOURS as string[]).includes(v);
}

/**
 * `ssr: false` is load-bearing here, not a style choice. Statically
 * importing AppShell (a huge, heavily shared client component — chunk
 * `1060`, pulled in via a dozen sub-chunks) directly into this page never
 * hydrated in a production (`next build && next start`) server: every
 * required chunk fetched with a real 200 (confirmed via the network log on
 * a clean tab), zero console errors or hydration-mismatch warnings ever
 * appeared, and yet no button on the page ever got React's internal props
 * and the client never called its own `/api/tennis/[tour]` snapshot route.
 * Bisected by deleting pieces of this file down to a bare `<button>`
 * (hydrated fine), adding back `useParams()`+`notFound()` (still fine),
 * then adding back `<AppShell sport="nhl" />` alone with no Suspense, no
 * league prop, no tennis-specific code at all — still broken, for ANY sport
 * value, confirming this was never about tennis's own logic. Soccer's
 * `app/soccer/[league]/page.tsx` had the identical symptom from the
 * identical "statically import AppShell into a page nested one level under
 * a `[bracket]` route segment" shape; every FLAT sport route (app/nhl/page.tsx
 * etc.) statically imports the same AppShell with no issue. Routing this
 * import through `next/dynamic(..., { ssr: false })` — a genuinely
 * different runtime `import()` path than RSC's static chunk-preload list —
 * sidesteps whatever the underlying chunk-loading bug is; verified live
 * (real hydration, real click-through) after the fix, both here and on
 * soccer's page.
 */
const AppShell = dynamicImport(() => import('@/components/AppShell'), {
  ssr: false,
  loading: () => <BrandedLoader size="page" />,
});

export default function TennisTourPage() {
  const params = useParams<{ tour: string }>();
  const tour = params?.tour ?? '';
  if (!isTennisTour(tour)) notFound();

  return <AppShell sport="tennis" league={tour} />;
}
