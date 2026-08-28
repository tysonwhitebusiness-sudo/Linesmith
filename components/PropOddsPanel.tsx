'use client';

import { useMemo, useState } from 'react';
import { OddsChip } from './OddsChip';
import { BookLogo, bookLabel } from './BookLogo';
import { bestPrice, rowsFor, userBookPrice, type PropOddsRow } from './usePropOdds';

/**
 * Every book's price for one subject+market+line, from the five-provider
 * feed. The user's own sportsbook (Fanatics, by default) gets visual
 * priority — shown first with a distinct marker — per update-09 § 5: it's
 * the price they'll actually get, not a theoretical best. When the best
 * available price isn't the user's book, both are shown so the gap is
 * visible rather than only ever showing one number.
 *
 * Every price is tagged with both which sportsbook it's from (`BookLogo`)
 * and which of the five providers supplied it (`OddsChip`'s `source`, read
 * off the row's own `providerId` rather than a hardcoded guess).
 */

export function PropSideOdds({
  rows,
  side,
  userSportsbook,
  wantOver,
}: {
  rows: PropOddsRow[];
  side: 'over' | 'under';
  userSportsbook: string;
  wantOver?: boolean;
}) {
  const best = bestPrice(rows, side);
  const mine = userBookPrice(rows, side, userSportsbook);
  if (!best) return <span className="text-[11px] text-ink-faint">—</span>;

  const sameBook = !!mine && mine.bookmaker === best.bookmaker;

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      {mine ? (
        <span className="inline-flex items-center gap-1">
          <BookLogo bookId={mine.bookmaker} size={12} />
          <OddsChip price={mine.americanOdds} source={mine.providerId} best={sameBook} className="border-masters/50" />
        </span>
      ) : (
        <span className="text-[10px] text-warn" title="Your book has no price for this market">
          No {bookLabel(userSportsbook)} price
        </span>
      )}
      {!sameBook ? (
        <span className="inline-flex items-center gap-1">
          <BookLogo bookId={best.bookmaker} size={12} />
          <OddsChip price={best.americanOdds} source={best.providerId} best />
        </span>
      ) : null}
    </span>
  );
}

/** Compact "N books" + best price, for a dense row where full detail doesn't fit. */
export function PropOddsSummary({
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
  if (rows.length === 0) return <span className="text-[11px] text-ink-faint">—</span>;
  const books = new Set(rows.map((r) => r.bookmaker)).size;
  const mine = userBookPrice(rows, 'over', userSportsbook) ?? userBookPrice(rows, 'under', userSportsbook);

  const shown = mine ?? bestPrice(rows, 'over') ?? bestPrice(rows, 'under');

  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="inline-flex items-center gap-1">
        {shown ? <BookLogo bookId={shown.bookmaker} size={11} /> : null}
        <OddsChip
          price={shown?.americanOdds}
          source={shown?.providerId}
          isDelayed={shown?.isDelayed}
          delaySeconds={shown?.delaySeconds}
          className={mine ? 'border-masters/50' : undefined}
        />
      </span>
      <span className="text-[9px] text-ink-faint">{books} book{books === 1 ? '' : 's'}</span>
    </span>
  );
}

/** "hits" -> "Hits", "total-bases" -> "Total Bases". Local and simple rather than pulling in MarketLabel's dimension/category-keyed lookup, which this row shape doesn't carry. */
function formatMarketKey(marketKey: string): string {
  return marketKey
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Line-shopping right rail for a whole game, player-scoped: picking through
 * every player in the boxscore as one flat list stopped being readable once
 * a game had any real player-prop coverage, so this asks "which player?"
 * first and only renders that player's own markets once one's chosen —
 * nothing loads until a selection is made.
 *
 * Unlike the old all-players list, a market isn't hidden just because only
 * one bookmaker has a price for it — PropOddsBoard already renders a single
 * book as its own one-line row with no fabricated second column, so a
 * player with a single-book market still gets that real price shown, not
 * silently dropped for having "nothing to shop against."
 */
export function GamePropLineShoppingRail({ allRows, userSportsbook }: { allRows: PropOddsRow[]; userSportsbook: string }) {
  const subjects = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of allRows) if (!byId.has(row.subjectId)) byId.set(row.subjectId, row.subjectName);
    return [...byId.entries()]
      .map(([subjectId, subjectName]) => ({ subjectId, subjectName }))
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
  }, [allRows]);

  const [selectedId, setSelectedId] = useState('');

  const markets = useMemo(() => {
    if (!selectedId) return [];
    const byKey = new Map<string, { marketKey: string; line: number | null }>();
    for (const row of allRows) {
      if (row.subjectId !== selectedId) continue;
      const key = `${row.marketKey}|${row.line ?? 'null'}`;
      if (!byKey.has(key)) byKey.set(key, { marketKey: row.marketKey, line: row.line });
    }
    return [...byKey.values()].sort((a, b) => a.marketKey.localeCompare(b.marketKey) || (a.line ?? 0) - (b.line ?? 0));
  }, [allRows, selectedId]);

  if (subjects.length === 0) {
    return <p className="text-[12px] text-ink-faint">No player props tracked for this game yet.</p>;
  }

  return (
    <div className="space-y-3">
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="w-full rounded-md border border-line bg-card px-2 py-1.5 text-[12px] text-ink"
      >
        <option value="">Select a player…</option>
        {subjects.map((s) => (
          <option key={s.subjectId} value={s.subjectId}>
            {s.subjectName}
          </option>
        ))}
      </select>

      {!selectedId ? (
        <p className="text-[12px] text-ink-faint">Pick a player above to see their shoppable lines.</p>
      ) : markets.length === 0 ? (
        <p className="text-[12px] text-ink-faint">No prop prices tracked yet for this player.</p>
      ) : (
        <div className="space-y-3">
          {markets.map((m) => (
            <div key={`${m.marketKey}|${m.line ?? 'null'}`}>
              <div className="mb-1 text-[11px] font-medium text-ink-muted">
                {formatMarketKey(m.marketKey)}
                {m.line != null ? ` ${m.line}` : ''}
              </div>
              <PropOddsBoard allRows={allRows} subjectId={selectedId} marketKey={m.marketKey} line={m.line} userSportsbook={userSportsbook} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
    return <p className="text-[12px] text-ink-faint">No prices fetched yet for this market/line.</p>;
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

  return (
    <ul className="space-y-1">
      {sorted.map(([book, { over, under }]) => (
        <li
          key={book}
          className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[12px] transition-all duration-150 hover:-translate-y-px hover:shadow-[0_6px_16px_-6px_rgba(0,0,0,0.35)] ${book === userSportsbook ? 'bg-accent-soft' : 'hover:bg-surface-subtle'}`}
        >
          <span className={`flex items-center gap-1.5 ${book === userSportsbook ? 'font-semibold text-masters' : 'text-ink-muted'}`}>
            {book === userSportsbook ? '★' : null}
            <BookLogo bookId={book} size={14} />
            {bookLabel(book)}
          </span>
          <span className="flex gap-1.5">
            {over ? (
              <OddsChip price={over.americanOdds} source={over.providerId} side="O" isDelayed={over.isDelayed} delaySeconds={over.delaySeconds} />
            ) : (
              <span className="text-ink-faint text-[11px]">—</span>
            )}
            {under ? (
              <OddsChip price={under.americanOdds} source={under.providerId} side="U" isDelayed={under.isDelayed} delaySeconds={under.delaySeconds} />
            ) : (
              <span className="text-ink-faint text-[11px]">—</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
