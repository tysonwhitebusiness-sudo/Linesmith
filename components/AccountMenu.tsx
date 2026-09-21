'use client';

import { useEffect, useState } from 'react';
import { Button, Dropdown } from './ui';
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
      <Button variant="tertiary" size="sm" href="/login">
        Sign in
      </Button>
    );
  }

  // U4: the kit Dropdown — a real menu (arrow keys, Escape, focus return),
  // where this was a click-catching full-screen div and a card.
  return (
    <Dropdown
      label="Account"
      header={email}
      trigger={
        <Button
          variant="tertiary"
          size="sm"
          aria-label="Account"
          className="h-7 w-7 rounded-full bg-accent-soft px-0 text-label font-semibold text-masters hover:bg-accent-soft/70"
        >
          {email.charAt(0).toUpperCase()}
        </Button>
      }
      sections={[
        {
          id: 'account',
          items: [
            {
              id: 'sign-out',
              label: 'Sign out',
              onAction: async () => {
                const supabase = createClient();
                await supabase.auth.signOut();
                router.push('/');
                router.refresh();
              },
            },
          ],
        },
      ]}
    />
  );
}

export default AccountMenu;
