import { NextResponse } from 'next/server';
import { addTrackedLine, listTrackedLines, removeTrackedLine } from '@/lib/db/client';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** middleware.ts already blocks unauthenticated requests to this route — this is defense in depth, not the primary gate. Mirrors app/api/watchlist/route.ts exactly. */
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
  return NextResponse.json({ trackedLines: await listTrackedLines(sport, user.id) });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json()) as {
    sport?: string;
    subjectId?: string;
    subjectName?: string;
    statKey?: string;
    statLabel?: string;
    side?: string;
    line?: number;
    source?: string;
  };
  if (!body.sport || !body.subjectId || !body.subjectName || !body.statKey || !body.statLabel || !body.line || body.line == null) {
    return NextResponse.json({ error: 'sport, subjectId, subjectName, statKey, statLabel, and line are required' }, { status: 400 });
  }
  if (body.side !== 'over' && body.side !== 'under') {
    return NextResponse.json({ error: "side must be 'over' or 'under'" }, { status: 400 });
  }
  const source = body.source === 'prop_odds' ? 'prop_odds' : 'manual';
  await addTrackedLine(body.sport, body.subjectId, body.subjectName, body.statKey, body.statLabel, body.side, body.line, source, user.id);
  return NextResponse.json({ trackedLines: await listTrackedLines(body.sport, user.id) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const sport = params.get('sport');
  const subjectId = params.get('subjectId');
  const statKey = params.get('statKey');
  if (!sport || !subjectId || !statKey) {
    return NextResponse.json({ error: 'sport, subjectId, and statKey are required' }, { status: 400 });
  }
  await removeTrackedLine(sport, subjectId, statKey, user.id);
  return NextResponse.json({ trackedLines: await listTrackedLines(sport, user.id) });
}
