'use client';
import { coverageLine, priceCoverage } from '@/lib/odds/priceFreshness';
import { OddsChip } from './OddsChip';
import { BookLogo } from './BookLogo';
import { rowsFor, type PropOddsRow } from './usePropOdds';

/** Full per-book breakdown for a Player Detail-style panel. */
export function PropOddsBoard({
  allRows,
  subjectId,
  marketKey,
  line,
  userSportsbook,
}: {
  allRows: PropOddsRow[];
  subjectId: string;
  marketKey: string;
  line: number | null;
  userSportsbook: string;
}) {
  const rows = rowsFor(allRows, subjectId, marketKey, line);
  if (rows.length === 0) {
    return <p className="text-label font-normal text-ink-muted">No prices fetched yet for this market/line.</p>;
  }

  const byBook = new Map<string, { over?: PropOddsRow; under?: PropOddsRow }>();
  for (const r of rows) {
    const entry = byBook.get(r.bookmaker) ?? {};
    if (r.side === 'over') entry.over = r;
    else if (r.side === 'under') entry.under = r;
    byBook.set(r.bookmaker, entry);
  }

  const sorted = [...byBook.entries()].sort(([a], [b]) => {
    if (a === userSportsbook) return -1;
    if (b === userSportsbook) return 1;
    return a.localeCompare(b);
  });

  // 6.17 — the sentence a per-chip age cannot say. Staleness is per BOOK on its
  // newest price, so a two-sided book is not counted as twice as stale as a
  // one-sided one.
  const coverage = priceCoverage(rows);
  const summary = coverageLine(coverage);

  return (
    <>
    <ul className="space-y-1">
      {sorted.map(([book, { over, under }]) => (
        <li
          key={book}
          className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 text-label font-normal transition-all duration-150 hover:-translate-y-px hover:shadow-[0_6px_16px_-6px_rgba(0,0,0,0.35)] ${book === userSportsbook ? 'bg-accent-soft' : 'hover:bg-surface-subtle'}`}
        >
          <span className={`flex items-center gap-1.5 ${book === userSportsbook ? 'font-semibold text-masters' : 'text-ink-muted'}`}>
            {book === userSportsbook ? '★' : null}
            <BookLogo bookId={book} size={14} withLabel />
          </span>
          <span className="flex gap-1.5">
            {over ? (
              <OddsChip price={over.americanOdds} source={over.providerId} side="O" capturedAt={over.fetchedAt} isDelayed={over.isDelayed} delaySeconds={over.delaySeconds} />
            ) : (
              <span className="text-ink-muted text-overline font-normal tracking-normal">—</span>
            )}
            {under ? (
              <OddsChip price={under.americanOdds} source={under.providerId} side="U" capturedAt={under.fetchedAt} isDelayed={under.isDelayed} delaySeconds={under.delaySeconds} />
            ) : (
              <span className="text-ink-muted text-overline font-normal tracking-normal">—</span>
            )}
          </span>
        </li>
      ))}
    </ul>
    {summary ? (
      <p className={`mt-1.5 text-overline font-normal tracking-normal ${coverage.stale > 0 ? 'text-warn-ink' : 'text-ink-muted'}`}>{summary}</p>
    ) : null}
    </>
  );
}
