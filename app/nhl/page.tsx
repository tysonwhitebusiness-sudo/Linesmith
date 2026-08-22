import { Suspense } from 'react';
import AppShell from '@/components/AppShell';

export default function NhlPage() {
  return (
    <Suspense>
      <AppShell sport="nhl" />
    </Suspense>
  );
}
