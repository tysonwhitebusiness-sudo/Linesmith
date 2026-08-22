/**
 * GET /api/props/model-versions?sport=mlb — every fitted model_weights row
 * for both game markets, most recent first. Free to serve: the version
 * history already exists in the DB from every fit that's ever run, this
 * just exposes it for the diagnostics page instead of it staying invisible.
 */

import { NextResponse } from 'next/server';
import { listModelWeightVersions } from '@/lib/db/client';
import { explainFeatureWeights } from '@/lib/sports/mlb/featureExplain';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sport = searchParams.get('sport') ?? 'mlb';

  const [moneyline, total, homeRun] = await Promise.all([
    listModelWeightVersions(sport, 'moneyline'),
    listModelWeightVersions(sport, 'total'),
    listModelWeightVersions(sport, 'home-run'),
  ]);

  const activeMoneyline = moneyline.find((v) => v.active);
  const activeTotal = total.find((v) => v.active);
  const activeHomeRun = homeRun.find((v) => v.active);

  return NextResponse.json({
    moneyline,
    total,
    homeRun,
    explanations: {
      moneyline: activeMoneyline ? explainFeatureWeights(activeMoneyline.featureNames, activeMoneyline.weights) : null,
      total: activeTotal ? explainFeatureWeights(activeTotal.featureNames, activeTotal.weights) : null,
      homeRun: activeHomeRun ? explainFeatureWeights(activeHomeRun.featureNames, activeHomeRun.weights) : null,
    },
  });
}
