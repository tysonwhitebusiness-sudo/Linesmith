'use client';

/**
 * Phase 4.10 — the shared stats board. ONE component for every sport, the same
 * way `PlayerDetail`/`TeamDetail`/`GameDetail` are shared (CLAUDE.md): adding a
 * sport means writing one adapter to `StatsBoardData`, never a `sport === 'x'`
 * branch in here.
 *
 * WHAT THIS COMPONENT SAYS: "we think this player has the most value." A
 * ranking and a projection, presented as an opinion.
 *
 * WHAT IT MUST NEVER SAY: that a price is wrong, that a bet is profitable, or
 * that anyone will make money. It renders no claim against a price, no implied
 * probability drawn from one, and no profit framing. The moment a board quotes
 * a number against someone else's price it has become a betting board without
 * passing a betting board's gate — the failure §9d of the plan names, and the
 * reason this file imports nothing from the odds pipeline.
 * `tests/stats-board-no-edge.test.ts` asserts that rather than trusting it, and
 * that test was checked to actually fail when such a cell is injected.
 *
 * A NULL PROBABILITY IS AN INSTRUCTION, NOT MISSING DATA. Markets whose
 * calibration gap exceeded tolerance (shots-on-goal 0.057, goals 0.131) are
 * ranked without a percentage, because ordering and calibration are different
 * claims resting on different evidence. The column simply does not render for
 * those markets, and the board says why in a sentence rather than leaving a
 * reader to wonder.
 */
import { useState } from 'react';
import type {
  StatsBoardData,
  StatsBoardRow,
} from '@/lib/sports/nhl/adapters/statsBoardAdapter';

/**
 * Games of history behind a projection, as words rather than a bare count.
 * Rule 3 of the stats bar: a projection built on 5 games must not look like one
 * built on 50.
 */
function confidence(sampleSize: number): { label: string; className: string } {
  // Thresholds set against what this data actually holds, not a guess. History
  // is unbounded across seasons — Crosby carries 859 games — so the original
  // 15/40 cut labelled every established player identically and the column said
  // nothing. The distinction that matters is at the LOW end, just above the
  // 5-game floor the serving job enforces, because that is where a projection
  // is genuinely shaky.
  if (sampleSize >= 82) return { label: 'Deep history', className: 'text-good' };
  if (sampleSize >= 20) return { label: 'Fair history', className: 'text-ink-secondary' };
  return { label: 'Thin history', className: 'text-warn' };
}

function ProjectionRow({
  row,
  rank,
  unit,
  showProbability,
}: {
  row: StatsBoardRow;
  rank: number;
  unit: string;
  showProbability: boolean;
}) {
  const conf = confidence(row.sampleSize);
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="py-2 pr-3 text-right tabular-nums text-ink-faint">{rank}</td>
      <td className="py-2 pr-3 font-medium">
        {row.subjectName}
        {row.teamAbbr ? (
          <span className="ml-2 text-[11px] uppercase text-ink-muted">{row.teamAbbr}</span>
        ) : null}
      </td>
      <td className="whitespace-nowrap py-2 pr-3 text-right">
        <strong className="tabular-nums">{row.projection.toFixed(2)}</strong>
        <span className="ml-1 text-[11px] text-ink-muted">{unit}</span>
      </td>
      {showProbability ? (
        <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
          {row.probability != null && row.line != null ? (
            <>
              {Math.round(row.probability * 100)}%
              <span className="ml-1 text-[11px] text-ink-muted">over {row.line}</span>
            </>
          ) : (
            <span className="text-ink-disabled">&mdash;</span>
          )}
        </td>
      ) : null}
      <td className="py-2 pr-3 text-right tabular-nums text-ink-secondary">
        {row.projectedToi != null ? `${row.projectedToi.toFixed(1)} min` : '—'}
      </td>
      <td className={`py-2 text-right text-[11px] ${conf.className}`}>
        {conf.label}
        <span className="ml-1 tabular-nums text-ink-faint">({row.sampleSize})</span>
      </td>
    </tr>
  );
}

export default function StatsBoard({
  data,
  unnamedOmitted = 0,
  limit = 25,
}: {
  data: StatsBoardData;
  unnamedOmitted?: number;
  limit?: number;
}) {
  const [activeKey, setActiveKey] = useState(data.markets[0]?.key ?? '');
  const active = data.markets.find((m) => m.key === activeKey) ?? data.markets[0];

  if (!active) {
    return (
      <section className="lb-card mx-auto max-w-3xl p-5">
        <h2 className="text-lg font-semibold tracking-tight">
          {data.sportLabel} projections
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          {data.emptyReason ?? 'Nothing to show right now.'}
        </p>
      </section>
    );
  }

  return (
    <section className="lb-card mx-auto max-w-3xl p-5">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">
          {data.sportLabel} projections
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Who we project to produce the most, ranked. These are estimates from
          past performance &mdash; not advice, and not a claim about any betting
          line.
        </p>
      </header>

      <nav className="mt-4 flex flex-wrap gap-1.5" aria-label="Market">
        {data.markets.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={m.key === active.key}
            onClick={() => setActiveKey(m.key)}
            className={
              'rounded-full border px-3 py-1 text-xs transition-colors ' +
              (m.key === active.key
                ? 'border-masters bg-masters text-paper'
                : 'border-line bg-surface-subtle text-ink-secondary hover:text-ink')
            }
          >
            {m.label}
          </button>
        ))}
      </nav>

      {/*
        Said plainly on the market that lacks one, rather than leaving a reader
        to wonder why a percentage appears on some tabs and not others. The
        honest version of this is a sentence, not a hidden column.
      */}
      {!active.hasProbability ? (
        <p className="mt-3 rounded-card border border-line-soft bg-surface-subtle px-3 py-2 text-xs text-ink-secondary">
          Ranked by projection only. Our {active.label.toLowerCase()} model
          orders players correctly but is not yet accurate enough at the
          individual-percentage level for us to publish one.
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wide text-ink-muted">
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                #
              </th>
              <th scope="col" className="py-2 pr-3 text-left font-medium">
                Player
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Projected
              </th>
              {active.hasProbability ? (
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Chance
                </th>
              ) : null}
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Ice time
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Based on
              </th>
            </tr>
          </thead>
          <tbody>
            {active.rows.slice(0, limit).map((row, i) => (
              <ProjectionRow
                key={`${row.subjectId}-${active.key}`}
                row={row}
                rank={i + 1}
                unit={active.unit}
                showProbability={active.hasProbability}
              />
            ))}
          </tbody>
        </table>
      </div>

      <footer className="mt-3 flex flex-col gap-1 text-[11px] text-ink-muted">
        <p>
          Showing {Math.min(limit, active.rows.length)} of {active.rows.length}{' '}
          players.
        </p>
        {unnamedOmitted > 0 ? (
          <p>
            {unnamedOmitted} player{unnamedOmitted === 1 ? '' : 's'} hidden
            &mdash; we could not match a name to them.
          </p>
        ) : null}
      </footer>
    </section>
  );
}
