/**
 * GET /api/diagnostics/health
 *
 * Phase 04 of docs/four-feature-gameplan-2026-08-22.md. Direct read of
 * `job_health_checks` — a real table health_check.py now upserts into on
 * every run (see python-odds-service/src/db.py's write_health_check_results),
 * not a snapshot blob — so this follows CLAUDE.md's pattern 2 (direct reads
 * + no cachedRoute()) the same way app/api/props/lines/route.ts does.
 * Gated to the operator via middleware.ts's ADMIN_USER_IDS, same as the
 * rest of /api/diagnostics/**.
 */

import { NextResponse } from 'next/server';
import { pgAll } from '@/lib/db/pgClient';

interface JobHealthCheckRow {
  check_name: string;
  healthy: boolean;
  status: string;
  detail: unknown;
  checked_at: string;
}

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await pgAll<JobHealthCheckRow>(
    'SELECT check_name, healthy, status, detail, checked_at FROM job_health_checks ORDER BY healthy ASC, check_name ASC',
  );
  return NextResponse.json({
    checks: rows.map((r) => ({
      name: r.check_name,
      healthy: r.healthy,
      status: r.status,
      detail: r.detail,
      checkedAt: r.checked_at,
    })),
  });
}
