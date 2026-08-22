import { NextResponse } from 'next/server';
import { addPick, clearPicks, deletePick, listPicks, updatePickOdds } from '@/lib/db/client';
import type { PickInput } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const sport = new URL(request.url).searchParams.get('sport') ?? undefined;
  return NextResponse.json({ picks: await listPicks(sport) });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<PickInput>;

  const required = ['sport', 'subjectId', 'subjectName', 'dimension', 'category'] as const;
  const missing = required.filter((key) => !body[key]);
  if (missing.length > 0) {
    return NextResponse.json({ error: `Missing required field(s): ${missing.join(', ')}` }, { status: 400 });
  }

  const pick = await addPick({
    sport: body.sport!,
    subjectId: body.subjectId!,
    subjectName: body.subjectName!,
    dimension: body.dimension!,
    dimensionLabel: body.dimensionLabel ?? body.dimension!,
    category: body.category!,
    categoryLabel: body.categoryLabel ?? body.category!,
    line: body.line ?? null,
    gameId: body.gameId ?? null,
    teamId: body.teamId ?? null,
    team: body.team ?? null,
    opponentId: body.opponentId ?? null,
    opponent: body.opponent ?? null,
    americanOdds: body.americanOdds ?? null,
    oddsSource: body.oddsSource ?? (body.americanOdds ? 'manual' : null),
    bookmaker: body.bookmaker ?? null,
    eventContext: body.eventContext ?? null,
    sampleSize: body.sampleSize ?? null,
  });

  return NextResponse.json({ pick }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as { id?: number; americanOdds?: string | null; source?: string };
  if (typeof body.id !== 'number') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  const odds = body.americanOdds?.trim() ? body.americanOdds.trim() : null;
  const pick = await updatePickOdds(body.id, odds, body.source ?? 'manual');
  if (!pick) return NextResponse.json({ error: 'Pick not found' }, { status: 404 });
  return NextResponse.json({ pick });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  const all = params.get('all');

  if (all !== null) {
    await clearPicks(params.get('sport') ?? undefined);
    return NextResponse.json({ ok: true });
  }
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  await deletePick(Number(id));
  return NextResponse.json({ ok: true });
}
