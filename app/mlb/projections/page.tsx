import { Suspense } from 'react';
import MlbProjectionsPanel from '@/components/MlbProjectionsPanel';

export const metadata = { title: 'MLB projections · Linesmith' };

export default function MlbProjectionsPage() {
  return (
    <Suspense>
      <MlbProjectionsPanel />
    </Suspense>
  );
}
