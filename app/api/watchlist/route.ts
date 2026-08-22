import { NextResponse } from 'next/server';
import { addWatch, listWatchlist, removeWatch } from '@/lib/db/client';
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

export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sport = new URL(request.url).searchParams.get('sport') ?? undefined;
  return NextResponse.json({ watchlist: await listWatchlist(sport, user.id) });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json()) as { sport?: string; subjectId?: string; subjectName?: string };
  if (!body.sport || !body.subjectId || !body.subjectName) {
    return NextResponse.json({ error: 'sport, subjectId and subjectName are required' }, { status: 400 });
  }
  await addWatch(body.sport, body.subjectId, body.subjectName, user.id);
  return NextResponse.json({ watchlist: await listWatchlist(body.sport, user.id) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const sport = params.get('sport');
  const subjectId = params.get('subjectId');
  if (!sport || !subjectId) {
    return NextResponse.json({ error: 'sport and subjectId are required' }, { status: 400 });
  }
  await removeWatch(sport, subjectId, user.id);
  return NextResponse.json({ watchlist: await listWatchlist(sport, user.id) });
}
