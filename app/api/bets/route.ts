import { NextResponse } from 'next/server';
import { listBets, submitPicksAsBets } from '@/lib/db/client';
import { gradeOpenBets } from '@/lib/odds/props/betGrading';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** middleware.ts already blocks unauthenticated requests to this route — this is defense in depth, not the primary gate. */
async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Grades any open bets (every user's — grading is an objective, global settlement, not per-user) against live/final box scores, then returns this user's current list. */
export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sport = new URL(request.url).searchParams.get('sport') ?? undefined;
  await gradeOpenBets();
  return NextResponse.json({ bets: await listBets(sport, user.id) });
}

/** Submit a set of slip legs (by pick id) to Live Bets. */
export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json()) as { ids?: number[] };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'number') : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids is required' }, { status: 400 });
  }
  const bets = await submitPicksAsBets(ids, user.id);
  return NextResponse.json({ bets }, { status: 201 });
}
