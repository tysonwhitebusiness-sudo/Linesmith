import { Suspense } from 'react';
import AppShell from '@/components/AppShell';

export default function NflPage() {
  return (
    <Suspense>
      <AppShell sport="nfl" />
    </Suspense>
  );
}
