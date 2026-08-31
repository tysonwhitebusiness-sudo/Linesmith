'use client';

import { SeriesChart } from './charts/SeriesChart';
import { HeatGrid } from './charts/HeatGrid';
import { DensityCurve } from './charts/DensityCurve';
import { MIDDOT, fmt } from './charts/tokens';
import type {
  AnalyticsRoles,
  GameContextRole,
  RollingFormRole,
  SituationalSplitsRole,
  WhereThisSitsRole,
} from '@/lib/sports/shared/analyticsRoles';

/**
 * The four analytics cards, rendered — Phase 6.16.
 *
 * A SIBLING OF `PlayerRoleSections`, not an extension of it. That file's own
 * header says "the six universal roles" and the Phase 6 gate greps it; these
 * are four different cards from a different board pass, so they get their own
 * file rather than making that heading a lie.
 *
 * **NO SPORT CHECK IN THIS FILE EITHER.** Every title, label, unit and format
 * arrives on the role. These components render a heading and a shape.
 *
 * THREE OF THESE FOUR PRIMITIVES HAD NEVER BEEN RENDERED ANYWHERE. The chart
 * library was built in the Phase 6 chart-grammar pass and then wired one page
 * at a time, so `DensityCurve`, `ContributionBars`, `PercentileRail`,
 * `RangeBar`, `DistributionBars` and `ChartFrame` shipped as dead code. That is
 * the mechanical reason Player Detail sat at 13 of the board's 20 cards, and
 * it is worth knowing before adding a seventh primitive rather than using one.
 */
export function PlayerAnalyticsSections({ roles }: { roles: AnalyticsRoles }) {
  return (
    <>
      {roles.rollingForm ? <RollingFormSection role={roles.rollingForm} /> : null}
      {roles.situationalSplits ? <SituationalSplitsSection role={roles.situationalSplits} /> : null}
      {roles.whereThisSits ? <WhereThisSitsSection role={roles.whereThisSits} /> : null}
      {roles.gameContext ? <GameContextSection role={roles.gameContext} /> : null}
    </>
  );
}

/** Identical chrome to `PlayerRoleSections`' own `RoleCard` — the two files' cards sit in the same column and must not look like two systems. */
function AnalyticsCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="lb-card overflow-hidden">
      <div className="flex items-baseline justify-between gap-2 bg-accent-soft px-3 py-1.5">
        <h2 className="text-[10.5px] font-bold uppercase tracking-wide text-masters">{title}</h2>
        {subtitle ? <span className="truncate text-[9.5px] text-ink-faint">{subtitle}</span> : null}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

/**
 * ROLE 7 — rolling form.
 *
 * The trailing mean is the SUBJECT series and the per-game values are the
 * CONTEXT series, which is the opposite of what it looks like it should be.
 * The card's question is "which way is this trending", and `SeriesChart` draws
 * its subject in emphasis ink and its context greyed at half opacity — so
 * putting the raw sawtooth in emphasis would shout the noise and whisper the
 * signal.
 *
 * `zeroBased` HAS NO DEFAULT and this passes `true` on purpose: a per-game
 * count is a magnitude, and a rolling mean of 0.8 against a mean of 1.2 looks
 * like a collapse on a floating axis when it is four tenths of a hit.
 */
function RollingFormSection({ role }: { role: RollingFormRole }) {
  const format = role.decimals === 0 ? fmt.int : role.decimals === 1 ? fmt.one : fmt.two;
  return (
    <AnalyticsCard
      title={role.title}
      subtitle={[role.subtitle, `${role.window}-game mean`].filter(Boolean).join(` ${MIDDOT} `)}
    >
      <SeriesChart
        values={role.mean}
        context={[role.values]}
        xLabels={role.labels}
        zeroBased
        format={format}
        unit={role.subtitle ?? 'per game'}
        height={132}
        emptyMessage={role.emptyMessage}
        label={role.title}
      />
      {role.line != null ? (
        <p className="mt-2 text-[10.5px] text-ink-faint">
          Line {role.line} {MIDDOT} the grey series is each individual game
        </p>
      ) : null}
    </AnalyticsCard>
  );
}

/**
 * ROLE 8 — situational splits.
 *
 * `domain` is pinned to 0–100 rather than derived. A cover rate is already an
 * absolute quantity with a meaningful midpoint at 50, and letting the ramp
 * stretch to the grid's own min/max would paint a 48%-to-52% grid as though it
 * ran from terrible to excellent.
 */
function SituationalSplitsSection({ role }: { role: SituationalSplitsRole }) {
  return (
    <AnalyticsCard title={role.title}>
      <HeatGrid
        rows={role.cells}
        rowLabels={role.rowLabels}
        columnLabels={role.columnLabels}
        domain={{ lo: 0, hi: 100 }}
        format={fmt.pct0}
        unit="cover rate"
        caption={role.caption}
        aspect="matrix"
        label={role.title}
      />
    </AnalyticsCard>
  );
}

/** ROLE 9 — where this sits, against the peer pool on the same market. */
function WhereThisSitsSection({ role }: { role: WhereThisSitsRole }) {
  return (
    <AnalyticsCard title={role.title} subtitle={`${role.poolSize} players`}>
      <DensityCurve
        population={role.population}
        value={role.value}
        rank={role.rank}
        format={role.decimals === 1 ? fmt.one : fmt.two}
        height={112}
        emptyMessage={role.emptyMessage}
        label={role.label}
      />
    </AnalyticsCard>
  );
}

/**
 * ROLE 10 — game context.
 *
 * A definition list, not a table: these are labelled single values, and a
 * two-column table with no header row is a definition list that has to explain
 * itself to a screen reader.
 */
function GameContextSection({ role }: { role: GameContextRole }) {
  return (
    <AnalyticsCard title={role.title}>
      <dl className="grid grid-cols-1 gap-y-1.5">
        {role.rows.map((r) => (
          <div key={r.key} className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-1 last:border-0 last:pb-0">
            <dt className="text-[11.5px] text-ink-muted">{r.label}</dt>
            <dd className="m-0 text-[12px] font-semibold tabular-nums text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
    </AnalyticsCard>
  );
}
