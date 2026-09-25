import { bookLabel } from '@/lib/odds/books/registry';
import { fmtAmerican } from '@/lib/odds/section/format';
import type { ScanEdge } from '@/lib/odds/section/scanCells';

/**
 * Scan's Edge cell (odds build P11; D5/D22 allow the market edge on Scan). A
 * dot and the book's price where a market edge passes every gate at the row's
 * line, else nothing. Render only: the edge is Python's (`market_edges`), read
 * through `/api/odds/scan`; this cell computes nothing and the column cannot
 * be sorted (tests/scan-no-edge.test.ts).
 */
export function ScanEdgeCell({ edge }: { edge: ScanEdge | null | undefined }) {
  if (!edge) return null;
  const side = edge.side === 'under' ? 'U' : 'O';
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-good-ink" data-scan-edge
      aria-label={`Market edge: ${side === 'O' ? 'over' : 'under'} at ${bookLabel(edge.book)} ${fmtAmerican(edge.price)}, ${(edge.ev * 100).toFixed(1)}% EV`}>
      <span aria-hidden className="h-2 w-2 rounded-full bg-good" />
      {side} {fmtAmerican(edge.price)} {bookLabel(edge.book)} +{(edge.ev * 100).toFixed(1)}%
    </span>
  );
}
