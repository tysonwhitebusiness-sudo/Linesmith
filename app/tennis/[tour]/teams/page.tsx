'use client';

import { notFound, useParams } from 'next/navigation';
import { TENNIS_TOURS, type TennisTour } from '@/lib/core/types';
import { NoTeamPage } from '@/components/NoTeamPage';

/** Tennis has no teams; the URL explains why and points to the players and schedule (R7). */
export default function TennisNoTeamPage() {
  const tour = useParams<{ tour: string }>()?.tour ?? '';
  if (!(TENNIS_TOURS as string[]).includes(tour)) notFound();
  return <NoTeamPage sport="tennis" tour={tour as TennisTour} />;
}
