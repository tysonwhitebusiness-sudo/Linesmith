import { Suspense } from 'react';
import AppShell from '@/components/AppShell';

export default function CfbPage() {
  return (
    <Suspense>
      <AppShell sport="cfb" />
    </Suspense>
  );
}
