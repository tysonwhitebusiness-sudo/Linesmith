'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Self-contained auth affordance mounted inside `TopBar` — deliberately not
 * a `TopBarProps` field, so every one of TopBar's many call sites didn't
 * need updating for this. Manages its own session state via
 * `onAuthStateChange` rather than threading a user prop down from each page.
 */
export function AccountMenu() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null | undefined>(undefined); // undefined = not yet checked
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    // Seed from `getSession()` (local/storage read, not a network round
    // trip like `getUser()`) so the initial state resolves even if this
    // effect's `onAuthStateChange` subscription races React Strict Mode's
    // dev-mode double-invoke and misses the one-shot `INITIAL_SESSION`
    // broadcast — that race left `email` stuck at `undefined` forever
    // (the placeholder never resolved to the "Sign in" button) with the
    // subscription-only approach. `onAuthStateChange` still owns every
    // update after this.
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setEmail(data.session?.user?.email ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => setEmail(session?.user?.email ?? null));
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  if (email === undefined) return <span className="h-7 w-7" />; // reserve layout space, avoid a flash

  if (email === null) {
    return (
      <button
        type="button"
        onClick={() => router.push('/login')}
        className="rounded-md px-2 py-1.5 text-[12px] font-medium text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink"
      >
        Sign in
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account"
        title={email}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-masters transition-colors hover:bg-accent-soft/70"
      >
        {email.charAt(0).toUpperCase()}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="lb-card absolute right-0 z-20 mt-1.5 w-52 p-1.5">
            <p className="truncate px-2 py-1.5 text-[12px] text-ink-muted">{email}</p>
            <button
              type="button"
              onClick={async () => {
                const supabase = createClient();
                await supabase.auth.signOut();
                setOpen(false);
                router.push('/');
                router.refresh();
              }}
              className="w-full rounded-md px-2 py-1.5 text-left text-[13px] text-ink transition-colors hover:bg-ink/5"
            >
              Sign out
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default AccountMenu;
