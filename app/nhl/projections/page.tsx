import { Suspense } from 'react';
import NhlProjectionsPanel from '@/components/NhlProjectionsPanel';

export const metadata = { title: 'NHL projections · Linesmith' };

export default function NhlProjectionsPage() {
  return (
    <Suspense>
      <NhlProjectionsPanel />
    </Suspense>
  );
}
