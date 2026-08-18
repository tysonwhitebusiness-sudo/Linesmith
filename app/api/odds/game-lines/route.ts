import { NextResponse } from 'next/server';
import { getMlbGameLines } from '@/lib/odds/oddsApi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get('force') !== null;

  try {
    const result = await getMlbGameLines(force);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[api/odds/game-lines]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Odds lookup failed.' },
      { status: 502 },
    );
  }
}
