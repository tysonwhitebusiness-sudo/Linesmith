/**
 * GET /api/odds/scan?ids=823735,823409,…
 *
 * The Scan table's Open → now and pulled marker (odds build P8, O4; D22): per
 * player and market the line most books opened at (`market_openers`, flagged
 * openers left out), and per player, market and line how many books have
 * pulled it and not put it back (`prop_odds_pulls`). The Sharp, Books and
 * Checked cells come from the prop rows Scan already reads.
 *
 * CACHING — pattern 2 (CLAUDE.md): direct reads of two tables the P6 bridge
 * and the worker keep fresh out of band. Two grouped queries over the slate's
 * games. IT READS; IT NEVER WRITES.
 */
import { NextResponse } from 'next/server';
import { readScanExtras } from '@/lib/db/oddsRead';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const ids = [...new Set((new URL(request.url).searchParams.get('ids') ?? '').split(',').filter(Boolean))];
  if (!ids.length || ids.length > 80 || ids.some(id => !/^[A-Za-z0-9_.:-]{1,64}$/.test(id))) {
    return NextResponse.json({ error: 'ids (at most 80) are required' }, { status: 400 });
  }
  try {
    return NextResponse.json(await readScanExtras(ids));
  } catch (e) {
    console.error('[odds/scan]', e);
    return NextResponse.json({ error: 'Scan odds read failed' }, { status: 500 });
  }
}
