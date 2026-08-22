'use client';

import { createBrowserClient } from '@supabase/ssr';

/** Browser-side Supabase client, for the login/signup form and client components that need `auth.getUser()`/`onAuthStateChange`. */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
