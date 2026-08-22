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
 */
const PROTECTED_API_PREFIXES = ['/api/picks', '/api/bets', '/api/watchlist'];
const PROTECTED_API_EXCLUDE = ['/api/picks/game-history'];
const PROTECTED_PAGE_PREFIXES = ['/bets', '/bet/'];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isProtectedApi =
    PROTECTED_API_PREFIXES.some((p) => pathname.startsWith(p)) && !PROTECTED_API_EXCLUDE.some((p) => pathname.startsWith(p));
  const isProtectedPage = PROTECTED_PAGE_PREFIXES.some((p) => pathname.startsWith(p));

  if (!isProtectedApi && !isProtectedPage) {
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
  matcher: ['/api/picks/:path*', '/api/bets/:path*', '/api/watchlist/:path*', '/bets/:path*', '/bet/:path*'],
};
