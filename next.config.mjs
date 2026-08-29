import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A stray lockfile further up the tree otherwise gets picked as the root.
  outputFileTracingRoot: projectRoot,
  // Lets a second, isolated dev/build process (e.g. a verification run
  // alongside another already-running `next dev`) avoid corrupting the
  // shared `.next` directory both would otherwise write to concurrently.
  // Unset for every normal invocation, so this changes nothing by default.
  ...(process.env.LB_DIST_DIR ? { distDir: process.env.LB_DIST_DIR } : {}),
  // xlsx (SheetJS) does its own fs access inside readFile() that breaks when
  // webpack bundles it — throws "Cannot access file" even though the file is
  // right there on disk, since it's really the bundler's fs shim tripping up
  // SheetJS's internal file-reading path, not an actual filesystem problem.
  // better-sqlite3/node:sqlite dropped from this list as part of the Phase 1
  // Postgres cutover — lib/db/client.ts no longer imports either; the `pg`
  // driver it uses now is pure JS and bundles fine.
  serverExternalPackages: ['xlsx'],

  // Avatars render through a plain <img> so the headshot → flag/logo → initials
  // fallback chain can hang off onError. These hosts are declared anyway so a
  // later switch to next/image needs no config change.
  /**
   * Security headers (task 3.12, finding P4 M2). None of these existed.
   *
   * CSP is deliberately NOT here — it is task 8.2's. Next inlines scripts for
   * hydration, so a CSP strict enough to be worth having needs nonce plumbing
   * and real tuning against a deployed build; a permissive one written now
   * would mostly serve to make `curl -I` look reassuring.
   *
   * HSTS is included but only ever acts over HTTPS, so it is inert in local
   * development and takes effect once Phase 8 deploys. `preload` is
   * deliberately omitted: submitting to the preload list is effectively
   * irreversible for the domain, and that is not a decision to make as a side
   * effect of a hardening task.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Stops a browser second-guessing Content-Type — the vector that
          // turns an uploaded "image" served back as text/html into stored XSS.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // No framing at all. Nothing in this app is designed to be embedded,
          // and DENY is the honest expression of that.
          { key: 'X-Frame-Options', value: 'DENY' },
          // Send the full URL only to ourselves; bare origin cross-site. Prop
          // and player URLs carry ids that should not leak into a third party's
          // referer logs.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // This app asks for none of these. Denying them explicitly means a
          // future dependency cannot quietly start asking.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'a.espncdn.com' },
      { protocol: 'https', hostname: 'img.mlbstatic.com' },
      { protocol: 'https', hostname: 'www.mlbstatic.com' },
    ],
  },
};

export default nextConfig;
