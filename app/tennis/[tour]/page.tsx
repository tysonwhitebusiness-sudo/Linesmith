import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { TENNIS_TOURS, type TennisTour } from '@/lib/core/types';

function isTennisTour(v: string): v is TennisTour {
  return (TENNIS_TOURS as string[]).includes(v);
}

export default async function TennisTourPage({ params }: { params: Promise<{ tour: string }> }) {
  const { tour } = await params;
  if (!isTennisTour(tour)) notFound();

  return (
    <Suspense>
      <AppShell sport="tennis" league={tour} />
    </Suspense>
  );
}
