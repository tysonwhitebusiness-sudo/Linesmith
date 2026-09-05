'use client';

/**
 * Phase 4.10 — NHL's call site for the shared `StatsBoard`.
 *
 * This is the thin per-sport wrapper the sport-adapter convention calls for:
 * the hook lives here, the adapter already ran on the server (the route returns
 * `StatsBoardData` directly), and `StatsBoard` itself stays sport-agnostic. A
 * second sport gets its own panel beside this one; neither ends up as a branch
 * inside the board.
 */
import { useEffect, useState } from 'react';
import StatsBoard from '@/components/StatsBoard';
import type { StatsBoardData } from '@/lib/sports/nhl/adapters/statsBoardAdapter';

type Payload = StatsBoardData & { unnamedOmitted: number };

export default function NhlProjectionsPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/nhl/projections')
      .then((r) => {
        if (!r.ok) throw new Error(`projections unavailable (${r.status})`);
        return r.json();
      })
      .then((d: Payload) => {
        if (live) setData(d);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : 'projections unavailable');
      });
    return () => {
      live = false;
    };
  }, []);

  if (error) {
    return (
      <section className="lb-card mx-auto max-w-3xl p-5">
        <h2 className="text-lg font-semibold tracking-tight">NHL projections</h2>
        <p className="mt-2 text-sm text-bad">{error}</p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="lb-card mx-auto max-w-3xl p-5">
        <h2 className="text-lg font-semibold tracking-tight">NHL projections</h2>
        <p className="mt-2 text-sm text-ink-muted">Loading…</p>
      </section>
    );
  }

  return <StatsBoard data={data} unnamedOmitted={data.unnamedOmitted} />;
}
