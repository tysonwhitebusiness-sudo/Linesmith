/**
 * GET /api/props/diagnostics
 *
 * Unresolved players/markets/books from the most recent fetch per provider,
 * plus current budget usage — update-09 § 6's "coverage gaps visible rather
 * than silently swallowed" requirement.
 */

import { NextResponse } from 'next/server';
import { listUnresolved } from '@/lib/db/client';
import { allProviderMeta } from '@/lib/odds/props/registry';
import { dailyStatus, monthlyStatus } from '@/lib/odds/props/budget';
import { oddsApiIoConfig, oddsPapiConfig, sportsGameOddsConfig, theOddsApiConfig, userSportsbook } from '@/lib/odds/props/config';
import { normalizeBookmaker } from '@/lib/odds/props/entityResolution';

export const dynamic = 'force-dynamic';

export async function GET() {
  const oddsApiIo = oddsApiIoConfig();
  const sgo = sportsGameOddsConfig();
  const op = oddsPapiConfig();
  const toa = theOddsApiConfig();

  return NextResponse.json({
    userSportsbook: normalizeBookmaker(userSportsbook()) ?? userSportsbook().toLowerCase(),
    providers: allProviderMeta(),
    budgets: {
      oddsapiio: dailyStatus('oddsapiio', oddsApiIo.dailyLimit),
      sportsgameodds: monthlyStatus('sportsgameodds', sgo.monthlyLimit, sgo.softCap, 'objects'),
      oddspapi: monthlyStatus('oddspapi', op.monthlyLimit, op.softCap, 'requests'),
      theoddsapi: monthlyStatus('theoddsapi', toa.monthlyLimit, null, 'requests'),
    },
    unresolved: listUnresolved(),
  });
}
