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
const ADMIN_USER_IDS = ['038048de-c950-4798-9bfb-9da68c89f936'];
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
 *  - `lines` is price data the app renders for everyone. (`line-history`
 *    was here too; the route had no caller anywhere and was deleted in
 *    task 2.6.)
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
  '/api/props/calibration',
  '/api/props/user-sportsbook',
];
const ADMIN_PAGE_PREFIXES = ['/diagnostics'];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
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
  ],
};
