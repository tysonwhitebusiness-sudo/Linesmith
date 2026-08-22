import { Suspense } from 'react';
import AppShell from '@/components/AppShell';

export default function NbaPage() {
  return (
    <Suspense>
      <AppShell sport="nba" />
    </Suspense>
  );
}
