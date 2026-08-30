'use client';

import { SeriesChart } from './charts/SeriesChart';
import { MIDDOT, fmt } from './charts/tokens';
import type { LineHistoryResult } from '@/lib/odds/props/lineHistory';

/**
 * Price movement for one prop — Phase 6.16's frontend, and the reason the route
 * exists at all.
 *
 * `/api/props/line-history` was built once before, had no caller anywhere, and
 * was deleted as dead code in task 2.6. Rebuilding it without a consumer would
 * earn the same fate; this is that consumer.
 *
 * THE USER'S OWN BOOK IS THE SUBJECT, EVERY OTHER BOOK IS CONTEXT. That is
 * exactly `SeriesChart`'s `values` + `context` split, and it answers the
 * question a bettor actually has — "is my book moving with the market or
 * against it" — without this component computing a consensus nobody can bet.
 *
 * A SHORTENING PRICE IS THE FAVOURABLE DIRECTION when you already hold the bet,
 * but this chart is for someone deciding, so no direction is marked good. The
 * axis and the numbers say what happened and the reader draws the conclusion.
 */
/**
 * One book's prices on the shared bucket domain, as `SeriesChart` wants them.
 *
 * A BUCKET THIS BOOK DID NOT QUOTE BECOMES `NaN`, NOT A CARRIED-FORWARD PRICE.
 * `SeriesChart` breaks its line on a non-finite entry instead of interpolating
 * across it, so a gap in the data reads as a gap. Carrying the last price
 * forward would draw a flat segment asserting the price held steady, when what
 * actually happened is that nobody recorded one — a claim the data does not
 * support, made in the most confident visual form available.
 *
 * Exported so the test CALLS this rather than re-implementing it beside the
 * component; a mirror of a rule agrees with that rule's bugs.
 */
export function alignToBuckets(
  points: ReadonlyArray<{ t: string; americanOdds: number | null }>,
  buckets: readonly string[],
): number[] {
  const byT = new Map(points.map((p) => [p.t, p.americanOdds]));
  return buckets.map((t) => {
    const v = byT.get(t);
    return v == null ? Number.NaN : v;
  });
}

export function LineMovementCard({
  data,
  loading,
  userSportsbook,
  marketLabel,
}: {
  data: LineHistoryResult | null;
  loading: boolean;
  userSportsbook: string;
  marketLabel: string;
}) {
  const series = data?.series ?? [];
  // Books with a single point cannot show movement. Dropping them keeps the
  // background from filling with flat dots that read as agreement.
  const usable = series.filter((s) => s.points.length >= 2);

  if (!loading && usable.length === 0) return null;

  const buckets = data?.buckets ?? [];
  const align = (bookmaker: string): number[] =>
    alignToBuckets(series.find((s) => s.bookmaker === bookmaker)?.points ?? [], buckets);

  const mine = usable.find((s) => s.bookmaker.toLowerCase() === userSportsbook.toLowerCase());
  // Falls back to the most-observed book rather than rendering nothing: a
  // reader without that book still wants to see the market move.
  const subject = mine ?? usable[0];
  const others = usable.filter((s) => s.bookmaker !== subject?.bookmaker);

  const lineLabel =
    data?.resolvedLine != null ? `${marketLabel} ${data.resolvedLine}` : marketLabel;
  const hoursSpan =
    buckets.length >= 2
      ? Math.round((Date.parse(buckets[buckets.length - 1]) - Date.parse(buckets[0])) / 3_600_000)
      : 0;

  return (
    <section className="lb-card overflow-hidden">
      <div className="flex items-baseline justify-between gap-2 bg-accent-soft px-3 py-1.5">
        <h2 className="text-[12px] font-semibold text-masters">Line movement</h2>
        <span className="truncate text-[9.5px] text-ink-faint">
          {lineLabel}
          {subject ? ` ${MIDDOT} ${subject.bookmaker}` : ''}
          {hoursSpan > 0 ? ` ${MIDDOT} ${hoursSpan}h` : ''}
        </span>
      </div>
      <div className="p-2.5">
        <SeriesChart
          values={subject ? align(subject.bookmaker) : []}
          context={others.map((s) => align(s.bookmaker))}
          // American odds cross zero and have no meaningful origin — a
          // zero-based axis would squash every real move into nothing. This is
          // the parameter `SeriesChart` deliberately gives no default for.
          zeroBased={false}
          format={fmt.american}
          unit="odds"
          isLoading={loading}
          label={`Price movement for ${lineLabel}`}
          emptyMessage="No recorded movement for this prop yet."
          height={120}
        />
        {/* The alternates are real and the pinned line is only one of them.
            Saying so beats letting the chart imply it is the whole market. */}
        {data && data.availableLines.length > 1 ? (
          <p className="mt-1.5 text-[9.5px] text-ink-faint">
            {data.availableLines.length} lines quoted ({data.availableLines[0]}–
            {data.availableLines[data.availableLines.length - 1]}); showing the most-quoted.
          </p>
        ) : null}
        {others.length > 0 ? (
          <p className="mt-1 text-[9.5px] text-ink-faint">
            {subject?.bookmaker} in front, {others.length} other {others.length === 1 ? 'book' : 'books'} behind.
          </p>
        ) : null}
      </div>
    </section>
  );
}
