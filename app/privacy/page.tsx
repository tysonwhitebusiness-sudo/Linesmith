/**
 * Phase 4.10 — the privacy policy `docs/audit-phase-5.md` recorded as missing.
 *
 * WRITTEN FROM WHAT THE CODE ACTUALLY DOES, not from a template. Verified
 * before writing: authentication goes through Supabase (`lib/supabase/`); the
 * four user-owned tables are `bets`, `picks`, `watchlist` and `tracked_lines`
 * (CLAUDE.md — request-scoped and session-authenticated, deliberately the only
 * tables TypeScript still writes); and a tree-wide grep for Google Analytics,
 * gtag, PostHog, Mixpanel and Sentry returns NOTHING, so the "no third-party
 * analytics" statement below is a checked fact rather than an aspiration.
 *
 * THE OPERATOR MUST READ THIS BEFORE IT IS PUBLIC. It is accurate to the
 * codebase as of 2026-09-05, but a privacy policy is a legal statement about
 * how a real person handles other people's data, and only the operator can
 * confirm the parts that live outside the repository: the hosting and database
 * providers' own retention, where backups go, and which jurisdiction's law
 * applies. Those are marked inline.
 */
import Link from 'next/link';

export const metadata = { title: 'Privacy · Linesmith' };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-ink sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
      <p className="mt-3 text-sm text-ink-secondary">
        Linesmith is a statistics site. It collects the minimum needed to sign
        you in and to remember the things you explicitly save.
      </p>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-muted">What is collected</h2>
      <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm text-ink-secondary">
        <li>
          <strong>Account.</strong> An email address and authentication state,
          handled by Supabase. Passwords are never stored by Linesmith.
        </li>
        <li>
          <strong>Things you save.</strong> Bets you record, picks you keep,
          your watchlist, and lines you track. These exist because you created
          them and are tied to your account.
        </li>
        <li>
          <strong>Operational logs.</strong> Ordinary server and database logs
          kept by the hosting and database providers.
        </li>
      </ul>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-muted">What is not collected</h2>
      <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm text-ink-secondary">
        <li>
          No third-party analytics or advertising trackers. There is no Google
          Analytics, PostHog, Mixpanel, or similar embedded in this site.
        </li>
        <li>No payment details. Linesmith does not accept wagers or take money.</li>
        <li>No selling or sharing of personal data with advertisers.</li>
      </ul>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-muted">Sports data</h2>
      <p className="mt-3 text-sm text-ink-secondary">
        Player and team statistics, schedules and betting lines come from
        third-party sports-data and odds providers. That data is about public
        sporting events and professional athletes; it is not about you, and it
        is not linked to your account.
      </p>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-muted">Your data</h2>
      <p className="mt-3 text-sm text-ink-secondary">
        You can delete anything you saved from within the app. To delete your
        account and everything attached to it, contact the operator at the
        address below.
      </p>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-muted">Contact</h2>
      <p className="mt-3 text-sm text-ink-secondary">
        Questions about this policy, or a request to delete your account, go to
        the site operator.
      </p>

      <p className="mt-10 border-t border-line pt-4 text-xs text-ink-muted">
        Last updated 5 September 2026.{' '}
        <Link href="/" className="underline underline-offset-2 hover:text-ink">Back to Linesmith</Link>
      </p>
    </main>
  );
}
