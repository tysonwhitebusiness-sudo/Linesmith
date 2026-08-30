import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Auth phase (Phase 03 of docs/four-feature-gameplan-2026-08-22.md).
 *
 * Only the routes that read/write genuinely per-user data are gated —
 * everything else (sport snapshots, odds, props, diagnostics, admin) stays
 * public for this phase. "Logged in" and "paying" are deliberately kept
 * separate: this is auth only, no entitlement/paywall check anywhere here.
 *
 * `/api/picks/game-history` is deliberately NOT gated despite living under
 * `/api/picks/*` — it reads `game_picks`, the model's own global pick-lock
 * win/loss record (public scoreboard data, same posture as `pick_history`),
 * not this user's slip. Confirmed by reading the route: it calls
 * `gamePickRecord`/`listGamePickHistory`, neither of which takes a userId.
 *
 * `/api/picks/props` and `/api/picks/rare-markets` (Phase 6 of docs/daily-
 * picks-full-model-build-2026-08-27.md) are the same real posture — both
 * call `readTodaysPropCandidates`, a plain `pick_history` read with no
 * userId, same public-scoreboard-data shape as game-history above.
 * `/api/picks/bankroll` (Phase 7) is the same again — gamesPnlForSport/
 * propsPnlForSport aggregate game_picks/pick_history, no userId.
 * `/api/picks/model-data` (2026-08-27, Scan-table Score-column fix) is the
 * same posture again — readTodaysPropCandidates with no dimension filter,
 * no userId.
 */
const PROTECTED_API_PREFIXES = ['/api/picks', '/api/bets', '/api/watchlist', '/api/tracked-lines'];
const PROTECTED_API_EXCLUDE = ['/api/picks/game-history', '/api/picks/props', '/api/picks/rare-markets', '/api/picks/bankroll', '/api/picks/model-data'];
const PROTECTED_PAGE_PREFIXES = ['/bets', '/bet/'];

/**
 * Admin surface (Phase 04). `/diagnostics` is real system/model-internals
 * data (spend, calibration, provider budgets) — "logged in" isn't enough
 * here the way it is for `/bets`; it's restricted to the operator
 * specifically, not any account that signs up. A small allowlist rather
 * than a `profiles.role` column because there's exactly one operator today
 * — revisit if this app ever grows real multi-admin needs.
 */
/**
 * Task 3.7, finding P4 M9. This was a hardcoded UUID literal — in a public
 * repository, and unchangeable without a redeploy.
 *
 * Env var rather than a `profiles` table with a `role` column: no `profiles`
 * table exists (PostgREST 404s on it), and inventing a roles table for a
 * single-operator app before there are any other users is the kind of
 * infrastructure that gets built once and maintained forever. Phase 7 owns
 * that when real users exist.
 *
 * The previous literal is kept as the fallback deliberately. Without it, a
 * missing env var would empty this list and lock the operator out of their own
 * admin surface with a 403 that looks like a permissions bug — and the value
 * is already public in git history, so treating it as a secret now would be
 * theatre. What the env var buys is the ability to CHANGE it without a code
 * change, which is the part that actually mattered.
 */
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS ?? '038048de-c950-4798-9bfb-9da68c89f936')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Rate limiting — task 3.4, finding P4 M1. There was none.
// ---------------------------------------------------------------------------

/**
 * IMPORTANT AND DELIBERATE LIMITATION: this bucket lives in the process, so
 * the effective limit is (configured limit x number of running instances).
 * With one instance today that is exact; Phase 8 must revisit it if the app is
 * ever run multi-instance, and the honest fix there is shared state (Postgres
 * or an edge KV), not a smaller per-instance number.
 *
 * It is still worth having now: the vector P4 M1 describes is one script
 * hammering unauthenticated endpoints, and a per-instance bucket stops that
 * just as well as a shared one when there is one instance.
 */
interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();

/**
 * Cap on distinct keys held at once. Without this, the rate limiter is itself
 * a memory-exhaustion vector: every spoofed x-forwarded-for value would mint a
 * permanent Map entry, which is the same class of unbounded-growth bug task
 * 3.5 exists to fix for cache keys. When the cap is hit, expired entries are
 * dropped first and the whole map is cleared if that is not enough — losing
 * rate-limit state is a far better failure than exhausting memory.
 */
const MAX_BUCKETS = 20_000;

/** Requests allowed per window, by route class. */
const LIMITS: { test: (p: string) => boolean; limit: number; windowMs: number; label: string }[] = [
  // Model fitting and backfills: expensive, operator-only, and never needed
  // in bursts. 2/hour.
  { test: (p) => /\/api\/props\/(fit-|.*backfill|elo-backfill|ingest-|park-factors)/.test(p), limit: 2, windowMs: 60 * 60_000, label: 'fit/backfill' },
  // Routes that can reach an external provider or run real computation.
  { test: (p) => p.startsWith('/api/odds/') || p.startsWith('/api/props/') || p.startsWith('/api/diagnostics/'), limit: 10, windowMs: 60_000, label: 'provider' },
  // Everything else under /api.
  { test: (p) => p.startsWith('/api/'), limit: 60, windowMs: 60_000, label: 'default' },
];

function clientKey(request: NextRequest): string {
  // x-forwarded-for is client-controlled and trivially spoofed. That is
  // acceptable here — the goal is stopping accidental and casual abuse, not a
  // determined attacker rotating headers, and MAX_BUCKETS bounds the damage
  // spoofing can do. Real per-client identity arrives with a deployment that
  // has a trusted proxy in front (Phase 8).
  const fwd = request.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : null) ?? request.headers.get('x-real-ip') ?? 'unknown';
}

/** null when allowed; a 429 response when not. */
function rateLimit(request: NextRequest, pathname: string): NextResponse | null {
  const rule = LIMITS.find((r) => r.test(pathname));
  if (!rule) return null;

  const now = Date.now();
  if (buckets.size >= MAX_BUCKETS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    if (buckets.size >= MAX_BUCKETS) buckets.clear();
  }

  const key = `${rule.label}:${clientKey(request)}`;
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return null;
  }
  existing.count += 1;
  if (existing.count <= rule.limit) return null;

  const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return NextResponse.json(
    { error: 'Too many requests', detail: `Limit is ${rule.limit} per ${rule.windowMs / 1000}s for this route.` },
    { status: 429, headers: { 'retry-after': String(retryAfter) } },
  );
}
/**
 * Phase 1.5 (audit finding P4 H2). Before this, `/api/diagnostics` was the ONLY
 * admin prefix, which left every `/api/props/*` route answering anonymous
 * callers — including `fit-weights`, which retrains a model AND activates it,
 * and the various `*-backfill` routes, which write to `pick_history`. An
 * unauthenticated stranger could replace the model this app renders from.
 *
 * Gated as a whole prefix with a short exclude list, rather than enumerating
 * ~20 admin routes: a new operator route added under /api/props is then
 * protected by default, and forgetting to add it to a list can only ever make
 * something MORE restricted, never less. That is the safe direction for the
 * mistake to point.
 */
// `/api/mlb/refresh-hr-matchup` is an operator route living under a public
// prefix: a POST that pulls every qualified batter's full season game log and
// rewrites team_hr_rate_allowed. Task 1.5 gated the operator surface but
// scoped itself to `/api/props`, so this one stayed open to anyone —
// unauthenticated, and expensive on purpose. Found in task 2.9 while tracing
// that table's writers. Listed individually rather than gating all of
// `/api/mlb`, which is genuinely public read surface.
const ADMIN_API_PREFIXES = ['/api/diagnostics', '/api/props', '/api/odds/import', '/api/mlb/refresh-hr-matchup'];
/**
 * Genuinely public reads that happen to live under /api/props:
 *  - `lines` is price data the app renders for everyone.
 *  - `line-history` is the same price data over time. It was here before,
 *    was deleted along with its route in task 2.6 for having no caller
 *    anywhere, and came back in 6.16 WITH one — the movement charts
 *    `components/charts/SeriesChart` and `Sparkline` were built for. Same
 *    class as `lines`: it reads `prop_odds_history`, writes nothing, and
 *    exposes no more than the price board already does.
 *  - `calibration` is the model-health payload the public scoreboard reads.
 *
 * `scan-player`, `more-books` and `sharp-price` were also listed here, as
 * user-triggered provider calls needing a signed-in user but not the
 * operator. All three routes were deleted in task 2.5 (Q12), so both their
 * entries here and their PROTECTED_API_PREFIXES entries are gone. Nothing
 * in this file now grants access to anything that no longer exists — a
 * stale allow-entry for a deleted route is harmless today and a live hole
 * the moment somebody reuses that path.
 */
const ADMIN_API_EXCLUDE = [
  '/api/props/lines',
  '/api/props/line-history',
  '/api/props/calibration',
  '/api/props/user-sportsbook',
];
const ADMIN_PAGE_PREFIXES = ['/diagnostics'];

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Before anything else, including the Supabase round trip below: a rate
  // limiter that only runs after authentication is not a rate limiter.
  const limited = rateLimit(request, pathname);
  if (limited) return limited;
  const isProtectedApi =
    PROTECTED_API_PREFIXES.some((p) => pathname.startsWith(p)) && !PROTECTED_API_EXCLUDE.some((p) => pathname.startsWith(p));
  const isProtectedPage = PROTECTED_PAGE_PREFIXES.some((p) => pathname.startsWith(p));
  const isAdminApi =
    ADMIN_API_PREFIXES.some((p) => pathname.startsWith(p)) && !ADMIN_API_EXCLUDE.some((p) => pathname.startsWith(p));
  const isAdminPage = ADMIN_PAGE_PREFIXES.some((p) => pathname.startsWith(p));

  if (!isProtectedApi && !isProtectedPage && !isAdminApi && !isAdminPage) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() (not getSession()) — validates the token against Supabase's
  // auth server rather than trusting an unverified cookie value.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isAdminApi || isAdminPage) {
    if (!user) {
      if (isAdminApi) {
        return NextResponse.json({ error: 'Unauthorized', detail: 'Sign in required.' }, { status: 401 });
      }
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
    if (!ADMIN_USER_IDS.includes(user.id)) {
      if (isAdminApi) {
        return NextResponse.json({ error: 'Forbidden', detail: 'Admin access required.' }, { status: 403 });
      }
      const url = request.nextUrl.clone();
      url.pathname = '/';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return response;
  }

  if (!user) {
    if (isProtectedApi) {
      return NextResponse.json({ error: 'Unauthorized', detail: 'Sign in required.' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    '/api/picks/:path*',
    '/api/bets/:path*',
    '/api/watchlist/:path*',
    '/api/tracked-lines/:path*',
    '/bets/:path*',
    '/bet/:path*',
    '/api/diagnostics/:path*',
    '/diagnostics/:path*',
    // Phase 1.5 — a prefix in ADMIN_API_PREFIXES does nothing unless the
    // matcher also routes it here. Missing matcher entries are why these were
    // reachable in the first place.
    '/api/props/:path*',
    '/api/odds/import/:path*',
    // Task 3.4 — rate limiting has to see EVERY api request, not just the
    // authenticated ones; the abuse vector P4 M1 describes is unauthenticated
    // by definition. Widened to all of /api. The handler still returns
    // NextResponse.next() immediately for unprotected paths after the rate
    // check, without the Supabase round trip, so public routes pay only the
    // bucket lookup.
    //
    // Deliberately NOT '/:path*': that would run this on every static asset
    // and page for no benefit. Pages are not the expensive surface — API
    // routes that fetch from providers or rebuild caches are.
    '/api/:path*',
    // Task 2.9 added this route to ADMIN_API_PREFIXES and NOTHING HAPPENED,
    // because the matcher entry was missed — the exact failure the comment
    // above warns about, made three lines below the warning. Verified by
    // request this time, not by reading the constant: it returned 200 to an
    // unauthenticated POST until this line existed. Scoped to the one route
    // rather than all of `/api/mlb`, which is genuinely public read surface.
    '/api/mlb/refresh-hr-matchup',
  ],
};
