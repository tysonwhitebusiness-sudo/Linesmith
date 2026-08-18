import { NextResponse } from 'next/server';
import { getSeasonSchedule } from '@/lib/sports/golf/schedule';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const yearParam = url.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : new Date().getFullYear();

  try {
    const result = await getSeasonSchedule(Number.isFinite(year) ? year : new Date().getFullYear());
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[api/golf/schedule]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Golf schedule lookup failed.' },
      { status: 502 },
    );
  }
}
