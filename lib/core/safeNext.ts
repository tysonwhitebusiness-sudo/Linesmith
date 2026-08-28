/**
 * Constrains a `?next=` redirect target to a same-origin path.
 *
 * `next` is attacker-controllable — it is just a query parameter on a link
 * anyone can send — and `app/login/page.tsx` feeds it to `router.push` after a
 * successful sign-in. Unconstrained, `/login?next=https://evil.example` lands a
 * freshly-authenticated user on someone else's page (Phase 0.6 of
 * docs/audit-remediation-plan.md, finding P4 M5).
 *
 * Accept only a path starting with a single "/". That rejects absolute URLs
 * ("https://…"), protocol-relative ones ("//evil.example"), the backslash
 * spelling browsers normalise to protocol-relative ("/\evil"), and scheme
 * payloads like "javascript:".
 *
 * This lives here rather than in the login page because a Next.js App Router
 * `page.tsx` may only export a default plus a fixed allowlist of route
 * options — an extra named export fails `next build` with "Property 'safeNext'
 * is incompatible with index signature". `tsc --noEmit` does not catch it,
 * which is how it survived until the Phase 0 gate's build step.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return '/';
  // useSearchParams already percent-decodes, so "%2F%2Fevil" arrives here as
  // "//evil" and is caught by the protocol-relative check below.
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//')) return '/';
  // Browsers normalise "/\" to "//" — same protocol-relative escape, different
  // spelling.
  if (raw.startsWith('/\\')) return '/';
  return raw;
}
