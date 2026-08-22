'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

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
  const next = search.get('next') ?? '/';

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
            <div>
              <label htmlFor="email" className="mb-1 block text-[12px] font-medium text-ink-muted">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-line bg-card px-3 py-2 text-[14px] shadow-card focus:border-masters focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-[12px] font-medium text-ink-muted">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-line bg-card px-3 py-2 text-[14px] shadow-card focus:border-masters focus:outline-none"
              />
            </div>

            {error ? <p className="text-[12px] text-bad">{error}</p> : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-masters px-3 py-2 text-[14px] font-medium text-white shadow-card disabled:opacity-50"
            >
              {loading ? 'Please wait…' : mode === 'signIn' ? 'Sign in' : 'Sign up'}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signIn' ? 'signUp' : 'signIn');
            setError(null);
            setCheckEmail(false);
          }}
          className="mt-4 w-full text-center text-[12px] font-medium text-masters"
        >
          {mode === 'signIn' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
