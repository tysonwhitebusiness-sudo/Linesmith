import { Suspense } from 'react';
import AppShell from '@/components/AppShell';

export default function MlbPage() {
  return (
    <Suspense>
      <AppShell sport="mlb" />
    </Suspense>
  );
}
