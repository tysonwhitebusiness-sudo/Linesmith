import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import ComplianceFooter from '@/components/ComplianceFooter';

// Numerals and mono-label chrome across the redesigned cards lean on this —
// declared once here so every page gets the same font file, not a per-card fetch.
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

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
    <html lang="en" className={plexMono.variable}>
      {/*
        The compliance strings are mounted HERE, not per page, because
        docs/audit-phase-5.md recorded them as missing entirely and they block
        anything user-facing on either board. A page that forgets to include
        them is the failure this placement removes.
      */}
      <body>
        {children}
        <ComplianceFooter />
      </body>
    </html>
  );
}
