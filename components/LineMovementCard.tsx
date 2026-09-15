'use client';

import { useState } from 'react';
import { SeriesChart } from './charts/SeriesChart';
import { CONTEXT, EMPHASIS, MIDDOT, fmt } from './charts/tokens';
import { Card, DataTable, DrillDownPanel, Skeleton, VizLegend } from './ui';
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
 * ============ THIS IS A STEP SERIES, AND THAT IS NOT A STYLE CHOICE =========
 *
 * `prop_odds_history` is **log-on-CHANGE**, not a sampled series.
 * `db.py:write_prop_odds` looks up the prior price for the exact key and
 * inserts only when it differs — in its own words, "a repeat of the same price
 * on the next cycle is not a history point". The current-state table
 * `prop_odds` is what gets written every cycle regardless.
 *
 * So a bucket with no row for a book means **the price did not change**. It
 * does NOT mean nobody looked.
 *
 * The first version of this function returned `NaN` for those buckets so the
 * line would break, on the reasoning that "a gap in the data should read as a
 * gap" — a decent general principle, applied without checking how the writer
 * behaves. Against a change-log it is simply wrong: it drew a shattered line
 * for a price that was quietly stable, which is the opposite of what happened.
 * Measured while catching it: `prop_odds` had 117 writes in fifteen minutes
 * while `prop_odds_history` had none, because nothing moved.
 *
 * `NaN` is still correct BEFORE a book's first observation in the window —
 * there genuinely was no price on record then, and carrying one backwards
 * would invent one.
 *
 * KNOWN LIMIT: a change-log cannot distinguish "unchanged" from "this book
 * withdrew the market". Both look like silence. Holding the last price is the
 * right reading for the overwhelmingly common case and is what the log's own
 * semantics assert; a withdrawn market would need `prop_odds` (current state)
 * to detect, which this chart does not read.
 * ===========================================================================
 *
 * Exported so the test CALLS this rather than re-implementing it beside the
 * component; a mirror of a rule agrees with that rule's bugs.
 */
export function alignToBuckets(
  points: ReadonlyArray<{ t: string; americanOdds: number | null }>,
  buckets: readonly string[],
): number[] {
  const byT = new Map(points.map((p) => [p.t, p.americanOdds]));
  let held: number | null = null;
  return buckets.map((t) => {
    const v = byT.get(t);
    // `undefined` means no row in this bucket -> unchanged, so hold.
    // An explicit `null` price is a real row with no usable number; it does not
    // update what is held, and before any observation there is nothing to hold.
    if (v != null) held = v;
    return held == null ? Number.NaN : held;
  });
}

export function LineMovementCard({
  data,
  loading,
  userSportsbook,
  marketLabel,
}: {
  /**
   * STRUCTURAL, NOT `LineHistoryResult`, since Phase 6.22.
   *
   * A prop's history and a game market's history are different tables with
   * different keys -- `(game, subject, market, line, side)` against
   * `(event, market, side)` -- and this card reads neither of those keys. It
   * reads the series, the buckets, and one optional headline number. Typing
   * the prop shape here forced the game caller to fabricate a `subjectId` and
   * a `marketKey` it does not have, purely to satisfy fields nothing renders.
   *
   * `resolvedLine` is the handicap the series is for, and `availableLines` the
   * alternates a prop can offer; a game market passes the former and omits the
   * latter, because a total genuinely MOVING from 8.5 to 9 is the story rather
   * than an alternate to switch between.
   */
  data: {
    series: LineHistoryResult['series'];
    buckets: LineHistoryResult['buckets'];
    resolvedLine?: number | null;
    availableLines?: number[];
  } | null;
  loading: boolean;
  userSportsbook: string;
  marketLabel: string;
}) {
  const series = data?.series ?? [];
  const buckets = data?.buckets ?? [];

  // A BOOK WITH ONE OBSERVATION IS NOT AN EMPTY BOOK. Under a change-log it
  // set a price once and never moved it, which is a real and useful thing to
  // see beside a book that did move — an earlier `points.length >= 2` filter
  // here silently hid every stable book, which is most of them.
  //
  // What genuinely cannot be drawn is a single bucket: one x value is a dot,
  // not a series. That is the common state early in a game's life, before any
  // price has changed at all, and it renders nothing.
  const usable = series;

  // THE CARD ALWAYS RENDERS. It used to `return null` here whenever there were
  // fewer than two buckets or no series, which is the ordinary state of every
  // prop early in a game's life and of every sport out of season — so the most
  // common outcome was a block that silently did not exist. The empty message
  // below was written for exactly this case and was unreachable.
  //
  // That is also a Phase 6 gate requirement in its own right: "every sport's
  // page renders every block or an honest empty state. A blank card with no
  // empty state is a failure." Rendering nothing is not an empty state.
  const drawable = buckets.length >= 2 && usable.length > 0;

  // Say WHICH kind of nothing this is. "No data" covers two genuinely different
  // situations and a reader can act on the difference: nothing has ever been
  // recorded for this prop, versus a price on record that has not yet moved.
  const emptyMessage =
    usable.length === 0
      ? 'No price history recorded for this prop yet.'
      : 'Only one price on record so far. Prices are logged when they change, so a line appears once a book moves.';
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

  const [expanded, setExpanded] = useState(false);

  // R3: the first real card on the design-system primitives — Card anatomy
  // (sentence-case header, scope, ⓘ, ⤢), built-in loading and empty states,
  // a VizLegend, and a DrillDownPanel holding every book as a sortable table.
  const scope = [lineLabel, subject?.bookmaker, hoursSpan > 0 ? `${hoursSpan}h` : null].filter(Boolean).join(` ${MIDDOT} `);
  const bookRows = usable.map((s) => {
    const prices = s.points.map((p) => p.americanOdds).filter((v): v is number => v != null);
    return { book: s.bookmaker, first: prices[0] ?? null, last: prices[prices.length - 1] ?? null, changes: Math.max(0, prices.length - 1) };
  });

  return (
    <>
      <Card
        title="Line movement"
        scope={scope}
        info="Your book is the dark line; every other book is a grey line behind it. Prices are logged when they change, so a flat line is a book that has not moved, not a book with no data."
        onExpand={drawable ? () => setExpanded(true) : undefined}
        dense
        state={
          loading
            ? { kind: 'loading', skeleton: <Skeleton h={120} className="w-full" /> }
            : !drawable
              ? { kind: 'empty', title: usable.length === 0 ? 'No price history yet' : 'No movement yet', reason: emptyMessage }
              : { kind: 'ready' }
        }
        caption={
          drawable && data && (data.availableLines?.length ?? 0) > 1
            ? `${data.availableLines!.length} lines quoted (${data.availableLines![0]}–${data.availableLines![data.availableLines!.length - 1]}); showing ${data.resolvedLine ?? 'the most-quoted'}.`
            : undefined
        }
      >
        <SeriesChart
          values={subject ? align(subject.bookmaker) : []}
          context={others.map((s) => align(s.bookmaker))}
          // American odds cross zero and have no meaningful origin — a
          // zero-based axis would squash every real move into nothing. This is
          // the parameter `SeriesChart` deliberately gives no default for.
          zeroBased={false}
          format={fmt.american}
          unit="odds"
          label={`Price movement for ${lineLabel}`}
          emptyMessage={emptyMessage}
          height={120}
        />
        {others.length > 0 ? (
          <VizLegend
            items={[
              { label: subject?.bookmaker ?? 'This book', color: EMPHASIS },
              { label: `${others.length} other ${others.length === 1 ? 'book' : 'books'}`, color: CONTEXT },
            ]}
          />
        ) : null}
      </Card>

      <DrillDownPanel open={expanded} onClose={() => setExpanded(false)} title="Line movement" subtitle={scope}>
        <SeriesChart
          values={subject ? align(subject.bookmaker) : []}
          context={others.map((s) => align(s.bookmaker))}
          zeroBased={false}
          format={fmt.american}
          unit="odds"
          label={`Price movement for ${lineLabel}, expanded`}
          emptyMessage={emptyMessage}
          height={240}
          tickCount={4}
        />
        <div className="mt-4">
          <DataTable
            caption={`Every book's price for ${lineLabel}`}
            columns={[
              { key: 'book', label: 'Book' },
              { key: 'first', label: 'First', numeric: true, render: (r) => (r.first == null ? '—' : fmt.american(r.first)) },
              { key: 'last', label: 'Latest', numeric: true, render: (r) => (r.last == null ? '—' : fmt.american(r.last)) },
              { key: 'changes', label: 'Moves', numeric: true },
            ]}
            rows={bookRows}
            rowKey={(r) => r.book}
            initialSort={{ key: 'changes', desc: true }}
          />
        </div>
      </DrillDownPanel>
    </>
  );
}
