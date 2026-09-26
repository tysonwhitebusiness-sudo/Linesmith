import type { Metadata, Viewport } from 'next';
import { Barlow_Condensed, Roboto_Condensed } from 'next/font/google';
import './globals.css';
import ComplianceFooter from '@/components/ComplianceFooter';
import { RouterProvider } from '@/components/ui/RouterProvider';

export const metadata: Metadata = {
  title: 'Linesmith',
  description: 'Personal pick-finder for consistent patterns in live sports data.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#141619',
};

/**
 * TYPE SYSTEM 1 (operator-approved 2026-09-26, slate-polish type options):
 * Barlow Condensed for headlines, card and section titles, player and team
 * names; Roboto Condensed for everything else — numbers, odds, labels, body.
 * Self-hosted by next/font (no request to Google from the browser). R3 had no
 * web font at all; every page, Scan included, now renders these two.
 *
 * Barlow Condensed has static weights, so they are named; Roboto Condensed is
 * a variable font and carries its whole weight range.
 */
const display = Barlow_Condensed({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-barlow-condensed', display: 'swap' });
const body = Roboto_Condensed({ subsets: ['latin'], variable: '--font-roboto-condensed', display: 'swap' });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      {/*
        The compliance strings are mounted HERE, not per page, because
        docs/audit-phase-5.md recorded them as missing entirely and they block
        anything user-facing on either board. A page that forgets to include
        them is the failure this placement removes.
      */}
      {/*
        U0: `RouterProvider` renders no markup — it only gives React Aria a way
        to navigate through Next's router, so a kit `Button href` is a
        client-side navigation rather than a full page load.
      */}
      <body>
        <RouterProvider>
          {children}
          <ComplianceFooter />
        </RouterProvider>
      </body>
    </html>
  );
}
