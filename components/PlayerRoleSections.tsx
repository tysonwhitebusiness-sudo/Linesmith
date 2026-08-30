'use client';

import { HeatGrid } from './charts/HeatGrid';
import { SplitDumbbell } from './charts/SplitDumbbell';
import { StatTable } from './charts/StatTable';
import { StreakStrip } from './charts/StreakStrip';
import { MIDDOT, fmt } from './charts/tokens';
import { heatFill, heatInk, rankToHeat } from '@/lib/ui/heat';
import type {
  BinarySplitRole,
  CareerH2HRole,
  ConditionsRole,
  OpponentUnitRole,
  PlayerRoles,
  SpatialGridRole,
  UsageMixRole,
} from '@/lib/sports/shared/playerRoles';

/**
 * The six universal roles, rendered — Phase 6.13.
 *
 * `PlayerDetail.tsx` is already 107KB. Every role gets its own small component
 * here rather than another six blocks inline in that file, which is the same
 * reasoning that produced `components/charts/`: the shared page is the thing
 * most at risk of becoming unmaintainable, and Phase 6 adds the most to it.
 *
 * **THERE IS NO SPORT CHECK IN THIS FILE, and the Phase 6 gate greps for
 * exactly that.** A role carries its own title, labels, units and formatting
 * from the sport's adapter; these components render a heading and a shape. MLB
 * passes a strike zone and NFL will pass a target map through the identical
 * `SpatialGridRole`, and neither component knows which it got.
 *
 * Every section is presence-gated. A sport that cannot fill a role omits it and
 * nothing renders — which is `CLAUDE.md`'s sport-adapter §4 rule working
 * exactly as written, not a gap being hidden.
 */
export function PlayerRoleSections({ roles }: { roles: PlayerRoles }) {
  return (
    <>
      {roles.opponentUnit ? <OpponentUnitSection role={roles.opponentUnit} /> : null}
      {roles.usageMix ? <UsageMixSection role={roles.usageMix} /> : null}
      {roles.spatialGrid ? <SpatialGridSection role={roles.spatialGrid} /> : null}
      {roles.binarySplit ? <BinarySplitSection role={roles.binarySplit} /> : null}
      {roles.careerH2H ? <CareerH2HSection role={roles.careerH2H} /> : null}
      {roles.conditions ? <ConditionsSection role={roles.conditions} /> : null}
    </>
  );
}

function RoleCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
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

/** ROLE 1 — the opposing starter, defensive unit, goalie, or field. */
function OpponentUnitSection({ role }: { role: OpponentUnitRole }) {
  return (
    <RoleCard title={role.title} subtitle={role.subtitle}>
      <div className="mb-2 flex items-center gap-2">
        {role.logoUrl || role.headshotUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={role.headshotUrl ?? role.logoUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
        ) : null}
        <span className="text-[13px] font-semibold text-ink">{role.name}</span>
      </div>
      <StatTable
        rows={role.stats.map((s) => ({
          key: s.key,
          label: s.label,
          value: s.value,
          format: (v: number) => v.toFixed(s.decimals),
          rank: s.rank ?? null,
          poolSize: s.poolSize ?? null,
          lowerIsBetter: s.lowerIsBetter,
          sub: s.sub,
        }))}
        emptyMessage={role.emptyMessage}
      />
    </RoleCard>
  );
}

/**
 * ROLE 2 — pitch mix, route mix, shot-type mix, serve mix.
 *
 * A stacked proportion bar plus a labelled row per slice. The bar answers "what
 * does this subject mostly do"; the rows carry the per-slice outcome, which is
 * the part that actually moves a decision — a 44% sinker is context, a 44%
 * sinker they get hit hard on is a reason.
 */
function UsageMixSection({ role }: { role: UsageMixRole }) {
  const slices = role.slices.filter((s) => Number.isFinite(s.share) && s.share > 0);
  if (slices.length === 0) {
    return (
      <RoleCard title={role.title}>
        <p className="py-3 text-center text-[11px] text-ink-faint">
          {role.emptyMessage ?? 'No usage breakdown available yet.'}
        </p>
      </RoleCard>
    );
  }
  return (
    <RoleCard
      title={role.title}
      subtitle={role.sampleSize != null ? `n=${role.sampleSize.toLocaleString()}` : undefined}
    >
      <div className="mb-2 flex h-3 w-full overflow-hidden rounded-[3px]">
        {slices.map((s, i) => (
          <div
            key={s.key}
            style={{ width: `${s.share}%`, background: heatFill(1 - i / Math.max(1, slices.length - 1), 0.55) }}
            title={`${s.label} ${s.share.toFixed(1)}%`}
          />
        ))}
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {slices.map((s, i) => (
            <tr key={s.key} className="border-b border-line-hair last:border-b-0">
              <td className="py-[3px] pr-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
                  <span
                    className="inline-block h-2 w-2 rounded-[2px]"
                    style={{ background: heatFill(1 - i / Math.max(1, slices.length - 1), 0.55) }}
                  />
                  {s.label}
                </span>
              </td>
              <td className="w-[52px] py-[3px] text-right text-[11.5px] font-semibold tabular-nums">
                {s.share.toFixed(1)}%
              </td>
              <td className="w-[64px] py-[3px] pl-2 text-right text-[10.5px] tabular-nums text-ink-faint">
                {s.value != null && Number.isFinite(s.value)
                  ? `${s.value.toFixed(s.decimals ?? 2)}${s.valueLabel ? ` ${s.valueLabel}` : ''}`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </RoleCard>
  );
}

/**
 * ROLE 3 — strike zone, target map, shot chart.
 *
 * Straight through to `HeatGrid`, and every field that primitive was burned on
 * (`format`, `unit`, `caption`) comes from the role rather than a default. See
 * `HeatGrid`'s own header for the "4.800" bug.
 */
function SpatialGridSection({ role }: { role: SpatialGridRole }) {
  return (
    <RoleCard title={role.title}>
      <HeatGrid
        rows={role.cells}
        rowLabels={role.rowLabels}
        columnLabels={role.columnLabels}
        domain={role.domain}
        format={role.format}
        unit={role.unit}
        caption={role.caption}
        aspect="zone"
        lowerIsBetter={role.lowerIsBetter}
        label={role.title}
      />
    </RoleCard>
  );
}

/** ROLE 4 — vs LHP/RHP, man/zone, PP/EV, home/away, hard/clay. */
function BinarySplitSection({ role }: { role: BinarySplitRole }) {
  return (
    <RoleCard title={role.title}>
      <SplitDumbbell
        rows={role.rows.map((r) => ({
          key: r.key,
          label: r.label,
          a: r.a,
          b: r.b,
          format: (v: number) => v.toFixed(r.decimals),
          aSample: r.aSample,
          bSample: r.bSample,
          lowerIsBetter: r.lowerIsBetter,
        }))}
        aLabel={role.aLabel}
        bLabel={role.bLabel}
        label={role.title}
      />
    </RoleCard>
  );
}

/**
 * ROLE 6 — vs this pitcher, this defence, this club, this course.
 *
 * Leads with the sample size because most head-to-head records are small
 * enough that it is the headline: "4 for 11" is a different claim from "40 for
 * 110", and the average alone cannot tell them apart. `sampleSize` is required
 * on the role for exactly this reason.
 */
function CareerH2HSection({ role }: { role: CareerH2HRole }) {
  return (
    <RoleCard title={role.title} subtitle={`${role.sampleSize} ${role.sampleLabel}`}>
      <div className="mb-2 text-[12px] font-semibold text-ink">{role.opponentLabel}</div>
      {role.meetings && role.meetings.length > 0 ? (
        <div className="mb-2">
          <StreakStrip
            outcomes={role.meetings.map((m) => (m.value == null ? null : m.value > 0))}
            titles={role.meetings.map((m) => `${m.date}${m.title ? ` ${MIDDOT} ${m.title}` : ''}`)}
            label={`${role.title} meetings`}
          />
        </div>
      ) : null}
      <StatTable
        rows={role.stats.map((s) => ({
          key: s.key,
          label: s.label,
          value: s.value,
          format: (v: number) => v.toFixed(s.decimals),
          rank: s.rank ?? null,
          poolSize: s.poolSize ?? null,
          sub: s.sub,
        }))}
        showRank={false}
        emptyMessage={role.emptyMessage ?? 'No prior meetings on record.'}
      />
    </RoleCard>
  );
}

/**
 * ROLE 5 — park and wind, roof and surface, rest and travel, greens speed.
 *
 * Plain labelled facts. `impact` renders only where a sport has a REAL measured
 * factor; an unquantified "wind blowing out" is information, an invented "+4%
 * runs" is a fabrication, and the role's own doc comment forbids the second.
 */
function ConditionsSection({ role }: { role: ConditionsRole }) {
  if (role.facts.length === 0) {
    return (
      <RoleCard title={role.title}>
        <p className="py-3 text-center text-[11px] text-ink-faint">
          {role.emptyMessage ?? 'No venue conditions available.'}
        </p>
      </RoleCard>
    );
  }
  return (
    <RoleCard title={role.title}>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {role.facts.map((f) => (
          <div key={f.key} className="min-w-0">
            <dt className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">{f.label}</dt>
            <dd className="truncate text-[12px] text-ink">
              {f.value}
              {f.impact ? (
                <span
                  className="ml-1 text-[10px] font-semibold tabular-nums"
                  style={{ color: heatInk(rankToHeat(f.impact.value, 0.9, 1.1)) }}
                  title={f.impact.label}
                >
                  {fmt.signed2(f.impact.value)}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </RoleCard>
  );
}
