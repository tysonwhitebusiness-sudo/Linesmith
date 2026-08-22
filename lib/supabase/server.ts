import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client (Route Handlers, Server Components) — reads
 * the session from request cookies. `setAll` is wrapped in try/catch because
 * a Server Component can't write cookies (only Route Handlers/Server Actions
 * can); when called from a Server Component this silently no-ops, which is
 * fine because `middleware.ts` already refreshes the session cookie on every
 * request before a Server Component ever runs.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component — no-op, middleware handles refresh.
        }
      },
    },
  });
}
