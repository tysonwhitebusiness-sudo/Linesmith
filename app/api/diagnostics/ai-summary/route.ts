/**
 * GET /api/diagnostics/ai-summary[?refresh=1]
 *
 * Phase 05 of docs/four-feature-gameplan-2026-08-22.md — the summarizer
 * half of the "AI health monitor," deliberately not autonomous triage
 * (see the gameplan doc's own scope line: a wrong summary here is just a
 * bad description of data a human can already see raw on the System
 * Health tab, never an action taken on the model's say-so).
 *
 * Feeds job_health_checks (Phase 04) + recent provider_usage rows +
 * recent system_events into DeepSeek, gets back a plain-English summary.
 * cachedRoute() with a 20min TTL — this has both a real external-call
 * cost (DeepSeek tokens) and data that doesn't need a fresh LLM call
 * every page view, the "genuinely live" exception CLAUDE.md's caching
 * rules describe. `?refresh=1` is the manual "Ask again" button's escape
 * hatch, mirroring golf/lines's own `force` pattern.
 */

import { cachedRoute } from '@/lib/cachedRoute';
import { pgAll } from '@/lib/db/pgClient';
import { listRecentSystemEvents, incrementProviderUsage } from '@/lib/db/client';
import { deepseekJson } from '@/lib/ai/deepseekClient';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 20 * 60 * 1000;

interface JobHealthCheckRow {
  check_name: string;
  healthy: boolean;
  status: string;
  checked_at: string;
}

interface ProviderUsageRow {
  provider_id: string;
  period_kind: string;
  period_key: string;
  request_count: number;
  object_count: number;
  updated_at: string;
}

interface AiSummaryResult {
  severity: 'ok' | 'warning' | 'critical';
  summary: string;
  highlights: string[];
}

const SYSTEM_PROMPT = `You are a terse infrastructure summarizer for a sports-betting research app's admin dashboard.
You will be given: job_health_checks (per-check health/staleness state), recent provider_usage rows (odds-provider spend), and recent system_events (error/warning log).

Respond with a single JSON object, no markdown, matching exactly:
{
  "severity": "ok" | "warning" | "critical",
  "summary": "2-4 sentence plain-English summary of overall system state",
  "highlights": ["short bullet strings, most important first, empty array if nothing notable"]
}

Rules:
- "critical": any health check reports unhealthy AND the underlying issue looks like real data is missing/stale, not just "hasn't been polled in this dev environment yet."
- "warning": minor staleness or a provider nearing its budget cap, nothing broken.
- "ok": everything healthy or explainable as expected idle state.
- Never invent a number, table name, or check name that isn't in the provided data.
- Be specific — name the actual check/provider, not "some checks."`;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const force = url.searchParams.get('refresh') === '1';

  return cachedRoute({
    cacheKey: 'diagnostics:ai-summary',
    ttlMs: CACHE_TTL_MS,
    force,
    request,
    errorMessage: 'AI summary failed',
    build: async () => {
      const [checks, events, usage] = await Promise.all([
        pgAll<JobHealthCheckRow>('SELECT check_name, healthy, status, checked_at FROM job_health_checks ORDER BY healthy ASC, check_name ASC'),
        listRecentSystemEvents(20),
        pgAll<ProviderUsageRow>(
          'SELECT provider_id, period_kind, period_key, request_count, object_count, updated_at FROM provider_usage ORDER BY updated_at DESC LIMIT 30',
        ),
      ]);

      const userPrompt = JSON.stringify({ jobHealthChecks: checks, recentSystemEvents: events, providerUsage: usage });
      const { data, usage: tokenUsage } = await deepseekJson<AiSummaryResult>(SYSTEM_PROMPT, userPrompt);

      // Spend tracking (Phase 05 step 3) — extends provider_usage the same
      // way every odds provider already does, token count as `objectCount`
      // (closer to "objects" than "requests" per ProviderSpec.spend_unit's
      // own convention). Non-fatal: a tracking write failing shouldn't take
      // down a summary the caller is about to receive successfully.
      try {
        const monthKey = new Date().toISOString().slice(0, 7);
        await incrementProviderUsage('deepseek', 'monthly', monthKey, 0, tokenUsage.totalTokens);
      } catch (err) {
        console.error('[diagnostics/ai-summary] spend tracking failed (non-fatal)', err);
      }

      return {
        ...data,
        generatedAt: new Date().toISOString(),
        tokensUsed: tokenUsage.totalTokens,
      };
    },
  });
}
