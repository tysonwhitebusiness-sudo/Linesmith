import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { SOCCER_LEAGUES, type SoccerLeague } from '@/lib/core/types';

function isSoccerLeague(v: string): v is SoccerLeague {
  return (SOCCER_LEAGUES as string[]).includes(v);
}

export default async function SoccerLeaguePage({ params }: { params: Promise<{ league: string }> }) {
  const { league } = await params;
  if (!isSoccerLeague(league)) notFound();

  return (
    <Suspense>
      <AppShell sport="soccer" league={league} />
    </Suspense>
  );
}
