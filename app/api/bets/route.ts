import { NextResponse } from 'next/server';
import { listBets, submitPicksAsBets } from '@/lib/db/client';
import { gradeOpenBets } from '@/lib/odds/props/betGrading';

export const dynamic = 'force-dynamic';

/** Grades any open bets against live/final box scores, then returns the current list — read-time settlement, same pattern as the pick_history job but with nothing to schedule. */
export async function GET(request: Request) {
  const sport = new URL(request.url).searchParams.get('sport') ?? undefined;
  await gradeOpenBets();
  return NextResponse.json({ bets: listBets(sport) });
}

/** Submit a set of slip legs (by pick id) to Live Bets. */
export async function POST(request: Request) {
  const body = (await request.json()) as { ids?: number[] };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'number') : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids is required' }, { status: 400 });
  }
  const bets = submitPicksAsBets(ids);
  return NextResponse.json({ bets }, { status: 201 });
}
