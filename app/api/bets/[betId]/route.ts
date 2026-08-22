import { NextResponse } from 'next/server';
import { getBet } from '@/lib/db/client';
import { gradeOpenBets } from '@/lib/odds/props/betGrading';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ betId: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { betId } = await params;
  const id = Number(betId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid betId' }, { status: 400 });
  }
  await gradeOpenBets();
  const bet = await getBet(id, user.id);
  if (!bet) return NextResponse.json({ error: 'Bet not found' }, { status: 404 });
  return NextResponse.json({ bet });
}
