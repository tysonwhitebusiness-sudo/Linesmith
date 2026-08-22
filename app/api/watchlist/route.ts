import { NextResponse } from 'next/server';
import { addWatch, listWatchlist, removeWatch } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const sport = new URL(request.url).searchParams.get('sport') ?? undefined;
  return NextResponse.json({ watchlist: await listWatchlist(sport) });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { sport?: string; subjectId?: string; subjectName?: string };
  if (!body.sport || !body.subjectId || !body.subjectName) {
    return NextResponse.json({ error: 'sport, subjectId and subjectName are required' }, { status: 400 });
  }
  await addWatch(body.sport, body.subjectId, body.subjectName);
  return NextResponse.json({ watchlist: await listWatchlist(body.sport) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const sport = params.get('sport');
  const subjectId = params.get('subjectId');
  if (!sport || !subjectId) {
    return NextResponse.json({ error: 'sport and subjectId are required' }, { status: 400 });
  }
  await removeWatch(sport, subjectId);
  return NextResponse.json({ watchlist: await listWatchlist(sport) });
}
