'use client';

import { Suspense, useState } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { safeNext } from '@/lib/core/safeNext';

/**
 * Auth phase (Phase 03 of docs/four-feature-gameplan-2026-08-22.md) — a
 * thin custom form rather than Supabase Auth's hosted UI widget, to match
 * the app's existing design system instead of a generic out-of-box look.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  // `next` is attacker-controllable (it's just a query param on a link anyone
  // can send), and it is fed straight to router.push after a successful sign-in
  // — so it has to be constrained to a same-origin path or it's an open
  // redirect: /login?next=https://evil.example lands a freshly-authenticated
  // user on someone else's page (Phase 0.6 of docs/audit-remediation-plan.md,
  // finding P4 M5). Accept only a path starting with a single "/": that rejects
  // absolute URLs ("https://…"), protocol-relative ones ("//evil.example"),
  // the backslash variant browsers normalise to protocol-relative ("/\evil"),
  // and scheme payloads like "javascript:".
  const next = safeNext(search.get('next'));

  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    try {
      if (mode === 'signIn') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push(next);
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setCheckEmail(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="lb-card w-full max-w-sm p-6">
        <h1 className="text-[20px] font-semibold text-ink">{mode === 'signIn' ? 'Sign in' : 'Create an account'}</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {mode === 'signIn' ? 'Welcome back to Linesmith.' : 'Your picks, bets, and watchlist stay yours once you sign up.'}
        </p>

        {checkEmail ? (
          <div className="mt-5 rounded-lg border border-line bg-accent-soft/40 p-3 text-[13px] text-ink">
            Check <strong>{email}</strong> for a confirmation link, then sign in.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-5 space-y-3">
            {/* U3: `lg` fields on login, 16px text on a phone so iOS does not zoom. */}
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" size="lg" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                size="lg"
                required
                minLength={6}
                autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            {error ? <p className="text-[12px] text-bad">{error}</p> : null}

            {/* U spec 2c: `lg` on login — 44px is the touch floor. */}
            <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
              {loading ? 'Please wait…' : mode === 'signIn' ? 'Sign in' : 'Sign up'}
            </Button>
          </form>
        )}

        <Button
          variant="link"
          size="sm"
          onPress={() => {
            setMode(mode === 'signIn' ? 'signUp' : 'signIn');
            setError(null);
            setCheckEmail(false);
          }}
          className="mt-4 w-full"
        >
          {mode === 'signIn' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </Button>
      </div>
    </div>
  );
}
