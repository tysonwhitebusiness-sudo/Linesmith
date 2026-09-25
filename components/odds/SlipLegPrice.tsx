'use client';

import { BookLogo } from '../BookLogo';
import { Button } from '../ui';
import { bookLabel } from '@/lib/odds/books/registry';
import { fmtAgo, fmtAmerican, secondsSince } from '@/lib/odds/section/format';
import type { SlipBest } from '@/lib/odds/slipBest';

/**
 * A slip leg's price check (odds build P12 §2): "Best right now: {price} {book}
 * · checked N s ago", "your {book} is N¢ worse" when it is, and "Open at {book}"
 * only where a stored `book_link` exists (never a guessed URL).
 */
export function SlipLegPrice({ check, link, now }: { check: SlipBest; link: string | null; now: number }) {
  const { best, mine, centsWorse } = check;
  if (!best) return <p className="mt-1 text-label text-ink-muted">No book prices this line right now.</p>;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-ink-secondary" data-slip-best>
      <span className="inline-flex items-center gap-1.5">
        Best right now: <b className="tabular-nums text-ink">{fmtAmerican(best.price)}</b> <BookLogo bookId={best.book} size={14} withLabel />
        <span className="text-ink-muted">· checked {fmtAgo(secondsSince(best.checkedAt, now))} ago</span>
      </span>
      {mine && centsWorse ? <span data-slip-worse>your {bookLabel(mine.book)} is {centsWorse}¢ worse</span> : null}
      {link ? (
        <Button size="sm" variant="secondary" href={link} target="_blank" rel="noopener noreferrer">Open at {bookLabel(best.book)}</Button>
      ) : null}
    </div>
  );
}
