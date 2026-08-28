/**
 * GET /api/props/user-sportsbook — which book the app should prefer when
 * showing a price.
 *
 * Exists because of Phase 1.5. The public UI used to read this one string out
 * of `/api/props/diagnostics`, which also returns **provider budget usage
 * against monthly spend limits** and the unresolved-coverage report. Gating
 * `/api/props/*` for the operator surface surfaced that: every anonymous page
 * load was fetching operator data to extract a single preference field.
 *
 * The honest fix is not to un-gate diagnostics — it is to stop asking a
 * privileged endpoint for an unprivileged value. This returns exactly that
 * value and nothing else, and is listed in middleware's ADMIN_API_EXCLUDE.
 *
 * Uncached deliberately: it is one env-backed string, so there is nothing for
 * `cachedRoute` to save, and it must reflect a config change immediately.
 */

import { NextResponse } from 'next/server';
import { userSportsbook } from '@/lib/odds/props/config';
import { normalizeBookmaker } from '@/lib/odds/props/entityResolution';

export const dynamic = 'force-dynamic';

export async function GET() {
  const raw = userSportsbook();
  return NextResponse.json(
    { userSportsbook: normalizeBookmaker(raw) ?? raw.toLowerCase() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
