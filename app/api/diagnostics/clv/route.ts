/**
 * GET /api/diagnostics/clv
 *
 * Task 4.5 (P3 M1) — Closing Line Value on the dashboard.
 *
 * P3 M1's complaint was not that CLV was hard to compute. It was that it had
 * been computed once, by hand, and nothing reported it:
 * `python-odds-service/src/predict/clv_backtest.py` was already written and
 * carefully documented, and was wired to nothing at all — no JOB_REGISTRY
 * entry, no reader anywhere in app/ or lib/. This route is the missing reader.
 *
 * THE CLOSING REFERENCE, stated here because 4.5 requires the definition to be
 * documented rather than implied: the **last real observed price for one
 * (event, market, side) at the reference book, strictly before that game's own
 * `commence_time`**, read from `game_odds_history`'s observation log via
 * `db.get_closing_price`. Deliberately NOT `game_picks`' own `final` capture —
 * that snapshot is taken on a timer, so it is "near the close" rather than
 * "the close", and CLV is precisely a claim about the close.
 *
 * CACHING: CLAUDE.md pattern 2 — a direct read of a row refreshed out-of-band,
 * not `cachedRoute()`. `clvSummaryJob` (hourly, in the Python worker) computes
 * this and writes it; nothing here recomputes anything, per Q13. If the job has
 * never run the payload is absent, and this says so rather than serving zeros
 * that would read as "CLV is zero".
 *
 * Gated to the operator via middleware.ts's ADMIN_USER_IDS, same as the rest
 * of /api/diagnostics/**.
 */

import { NextResponse } from 'next/server';
import { pgGet } from '@/lib/db/pgClient';

const CLV_SUMMARY_CACHE_KEY = 'python-harness:clv-summary';

interface ClvMarket {
  market: string;
  reference_bookmaker: string;
  picks_considered: number;
  picks_with_reference_close: number;
  mean_clv_prob_points: number | null;
  median_clv_prob_points: number | null;
  positive_clv_rate: number | null;
  summary: string;
}

interface ClvPayload {
  computed_at: string;
  reference_definition: string;
  markets: ClvMarket[];
}

export const dynamic = 'force-dynamic';

export async function GET() {
  const row = await pgGet<{ payload: string; fetchedAt: string }>(
    'SELECT payload, fetched_at AS "fetchedAt" FROM snapshot_cache WHERE cache_key = ?',
    [CLV_SUMMARY_CACHE_KEY],
  );

  if (!row) {
    // An explicit absence, not an empty result set dressed as data. A UI that
    // renders 0.0000 here would be asserting that CLV is zero, which is a
    // different and much stronger claim than "this has not been computed".
    return NextResponse.json({
      available: false,
      reason: 'clvSummaryJob has not written a result yet',
    });
  }

  const payload = JSON.parse(row.payload) as ClvPayload;
  return NextResponse.json({
    available: true,
    computedAt: payload.computed_at,
    fetchedAt: row.fetchedAt,
    referenceDefinition: payload.reference_definition,
    markets: payload.markets.map((m) => ({
      market: m.market,
      referenceBookmaker: m.reference_bookmaker,
      picksConsidered: m.picks_considered,
      picksWithClose: m.picks_with_reference_close,
      meanClvProbPoints: m.mean_clv_prob_points,
      medianClvProbPoints: m.median_clv_prob_points,
      positiveClvRate: m.positive_clv_rate,
      summary: m.summary,
    })),
  });
}
