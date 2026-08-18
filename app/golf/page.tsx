import { Suspense } from 'react';
import AppShell from '@/components/AppShell';

export default function GolfPage() {
  return (
    <Suspense>
      <AppShell sport="golf" />
    </Suspense>
  );
}
