import type { Metadata, Viewport } from 'next';
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // R3: no web font. The IBM Plex Mono load was used by one element (F2); every
    // page renders the system sans stack.
    <html lang="en">
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
