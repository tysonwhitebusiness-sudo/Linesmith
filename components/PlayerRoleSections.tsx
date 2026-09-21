'use client';

import { Card, DataTable, Tooltip, type Column } from './ui';

import { SpatialSurface } from './charts/SpatialSurface';
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
  UsageMixSlice,
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
/**
 * WHICH COLUMN EACH ROLE BELONGS IN, taken from the design board rather than
 * from the order they happened to be written in.
 *
 * `docs/design/_ps-body.html` lays the page out as `1fr 288px` and puts eight
 * of its twenty cards in the RAIL. Five of ours were in the main column: the
 * opposing unit, head-to-head and conditions from this file, plus
 * `whereThisSits` and `gameContext` from the analytics file.
 *
 * That is not a cosmetic difference. A 288px card stretched to ~800px is the
 * "90% whitespace" the operator reported -- the opposing-defence card's three
 * rows had five hundred pixels of nothing between label and value, because the
 * card was in a column twice the width it was designed for.
 *
 * `usageMix`, `spatialGrid` and `binarySplit` stay in the main column, which
 * is where the board has them, and the latter two are PAIRED there -- see
 * `PlayerRoleMainSections`.
 */
export function PlayerRoleMainSections({ roles }: { roles: PlayerRoles }) {
  // The board pairs the binary split and the spatial grid side by side
  // (`.two-up`, `1fr 1fr`). Rendered as a pair only when BOTH are present:
  // one half of a two-column grid with an empty cell beside it is a
  // half-width card floating in space, which is worse than a full-width one.
  const paired = roles.binarySplit && roles.spatialGrid;
  return (
    <>
      {roles.usageMix ? <UsageMixSection role={roles.usageMix} /> : null}
      {paired ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BinarySplitSection role={roles.binarySplit!} />
          <SpatialGridSection role={roles.spatialGrid!} />
        </div>
      ) : (
        <>
          {roles.binarySplit ? <BinarySplitSection role={roles.binarySplit} /> : null}
          {roles.spatialGrid ? <SpatialGridSection role={roles.spatialGrid} /> : null}
        </>
      )}
    </>
  );
}

/** The three roles the board rails. Same components, narrower column. */
export function PlayerRoleRailSections({ roles }: { roles: PlayerRoles }) {
  return (
    <>
      {roles.opponentUnit ? <OpponentUnitSection role={roles.opponentUnit} /> : null}
      {roles.careerH2H ? <CareerH2HSection role={roles.careerH2H} /> : null}
      {roles.conditions ? <ConditionsSection role={roles.conditions} /> : null}
    </>
  );
}

/**
 * R6.3: the shared `Card`, not a green bar. The player page carried two card
 * headers — this one and R3's — which is why one page showed three heading
 * styles at once (operator, 2026-09-15). Same content, one chrome.
 */
function RoleCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card title={title} scope={subtitle} dense>
      {children}
    </Card>
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
        <span className="text-body-sm font-semibold text-ink">{role.name}</span>
      </div>
      <StatTable
        rows={role.stats.map((s) => ({
          key: s.key,
          label: s.label,
          value: s.value,
          format: (v: number) => `${(s.format ?? ((n: number) => n.toFixed(s.decimals)))(v)}${s.suffix ?? ''}`,
          rank: s.rank ?? null,
          poolSize: s.poolSize ?? null,
          // `RoleStat.lowerIsBetter` is NOT forwarded: StatTable's bar is
          // rank-driven and a rank already carries its direction. See
          // `StatTableRow.rank`. HeatGrid and SplitDumbbell below do take it,
          // because their heat comes from the value.
          sub: s.sub,
        }))}
        // Only when SOMETHING here is ranked. StatTable prints an em-dash for
        // an unranked row, which is right when its neighbours do have ranks --
        // and wrong when nothing in the table does, where it becomes a column
        // of dashes beside every number. Golf's field size and tennis's
        // opponent averages are not ranked against anything.
        showRank={role.stats.some((s) => s.rank != null && s.poolSize != null)}
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
  const anySample = slices.some((s) => s.valueSample != null && s.valueSample > 0);
  // The other side of the matchup, keyed for lookup. See `UsageMixRole.compare`.
  const cmp = role.compare ?? null;
  const cmpByKey = new Map((cmp?.slices ?? []).map((c) => [c.key, c]));
  if (slices.length === 0) {
    return (
      <RoleCard title={role.title}>
        <p className="py-3 text-center text-overline font-normal tracking-normal text-ink-muted">
          {role.emptyMessage ?? 'No usage breakdown available yet.'}
        </p>
      </RoleCard>
    );
  }
  return (
    <RoleCard
      title={role.title}
      subtitle={
        cmp && cmp.sampleSize != null && role.sampleSize != null
          ? `${cmp.sampleSize.toLocaleString()} thrown ${MIDDOT} ${role.sampleSize.toLocaleString()} seen`
          : role.sampleSize != null
            ? `n=${role.sampleSize.toLocaleString()}`
            : undefined
      }
    >
      <div className="mb-2 flex h-3 w-full overflow-hidden rounded-[3px]">
        {slices.map((s, i) => (
          <Tooltip key={s.key} content={`${s.label} ${s.share.toFixed(1)}%`}><div
            style={{ width: `${s.share}%`, background: heatFill(1 - i / Math.max(1, slices.length - 1), 0.55) }}
          /></Tooltip>
        ))}
      </div>
      {/* U6: the kit DataTable, with a group header only when there is a
          side to compare (`columnGroups`, finding U-7). Without `compare`
          it is the same two-column mix it always was. The other side comes
          first because it is the thing being faced; a pitch he does not
          throw prints an em-dash, not 0.0% ("not in his arsenal" and "throws
          it and gets hit" are different facts). The sample sits BESIDE the
          value, never in a tooltip — `share` counts every observation and
          `value` often does not (22% of MLB balls in play carry an xwOBA). */}
      <DataTable<UsageMixSlice>
        caption={role.title}
        density="compact"
        rows={slices}
        rowKey={(s) => s.key}
        columnGroups={cmp ? [{ label: 'Pitch', span: 1 }, { label: cmp.label, span: 2 }, { label: cmp.subjectLabel, span: anySample ? 3 : 2 }] : undefined}
        columns={[
          {
            key: 'pitch',
            label: 'Pitch',
            sortable: false,
            render: (s) => (
              <span className="inline-flex items-center gap-1.5 text-ink-muted">
                <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: heatFill(1 - slices.indexOf(s) / Math.max(1, slices.length - 1), 0.55) }} />
                {s.label}
              </span>
            ),
          },
          ...(cmp
            ? ([
                { key: 'cmpShare', label: 'Share', numeric: true, sortable: false, render: (s) => { const o = cmpByKey.get(s.key); return o ? `${o.share.toFixed(1)}%` : '—'; } },
                {
                  key: 'cmpValue',
                  label: 'Outcome',
                  numeric: true,
                  sortable: false,
                  render: (s) => {
                    const o = cmpByKey.get(s.key);
                    return o && o.value != null && Number.isFinite(o.value) ? (role.valueFormat ?? ((v: number) => v.toFixed(2)))(o.value) : '—';
                  },
                },
              ] satisfies Column<UsageMixSlice>[])
            : []),
          { key: 'share', label: 'Share', numeric: true, sortable: false, render: (s) => <span className="font-semibold">{s.share.toFixed(1)}%</span> },
          {
            key: 'value',
            label: 'Outcome',
            numeric: true,
            sortable: false,
            render: (s) =>
              s.value != null && Number.isFinite(s.value)
                ? `${(role.valueFormat ?? ((v: number) => v.toFixed(s.decimals ?? 2)))(s.value)}${s.valueLabel ? ` ${s.valueLabel}` : ''}`
                : '—',
          },
          ...(anySample
            ? ([{ key: 'n', label: 'n', numeric: true, sortable: false, render: (s) => (s.valueSample != null && s.valueSample > 0 ? `n=${s.valueSample}` : '') }] satisfies Column<UsageMixSlice>[])
            : []),
        ]}
      />
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
      {/* R3 3c / D4: drawn on the sport's own surface, chosen by `role.surface`. */}
      <SpatialSurface role={role} />
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
          format: (v: number) => `${v.toFixed(r.decimals)}${r.suffix ?? ''}`,
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
/** "05-08 vs Washington Nationals" -> "05-08". Splits on the vs/@ separator every sport's period label already uses. */
function shortMeetingDate(label?: string): string {
  if (!label) return '';
  return label.split(/\s+(?:vs|@)\s+/i)[0].trim();
}

function CareerH2HSection({ role }: { role: CareerH2HRole }) {
  const pct = role.headline && role.headline.total > 0
    ? Math.round((role.headline.cleared / role.headline.total) * 100)
    : null;
  return (
    <RoleCard title={role.title} subtitle={`${role.sampleSize} ${role.sampleLabel}`}>
      {/* THE VERDICT IS ONE SENTENCE, so it renders as one.
          This card used to be a bare opponent label, an unlabelled strip, and
          a two-row table whose first row read "Cleared the line / 2 of 3" on
          the left with a naked "67" pushed to the right margin -- a percentage
          with no percent sign, sitting directly above an average of "2.0", so
          the two numbers looked like the same kind of quantity and neither
          said what it was. */}
      <div className="text-label font-semibold text-ink">{role.opponentLabel}</div>
      {role.headline ? (
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="text-heading font-bold leading-none tabular-nums text-ink">
            {pct}
            <span className="text-body-sm font-semibold">%</span>
          </span>
          <span className="text-overline font-normal tracking-normal text-ink-muted">{role.headline.text}</span>
        </div>
      ) : null}

      {role.meetings && role.meetings.length > 0 ? (
        <div className="mt-2.5">
          <div className="mb-1 text-overline font-normal uppercase tracking-wide text-ink-muted">
            Oldest {MIDDOT} newest
          </div>
          <StreakStrip
            outcomes={role.meetings.map((m) => (m.value == null ? null : m.value > 0))}
            titles={role.meetings.map((m) => `${m.date}${m.title ? ` ${MIDDOT} ${m.title}` : ''}`)}
            label={`${role.title} meetings`}
          />
          {/* The strip is a row of squares and nothing on screen said WHEN.
              Naming the first and last meeting costs one line and makes the
              squares a timeline instead of a decoration. */}
          {/* JUST THE DATE on the endpoints. The full label is
              "05-08 vs Washington Nationals", and two of those under a strip of
              eleven squares wrapped onto three lines and buried the squares.
              The whole label is still on each square's own tooltip. */}
          <div className="mt-1 flex justify-between gap-2 text-overline font-normal tracking-normal text-ink-muted">
            <span className="truncate">{shortMeetingDate(role.meetings[0]?.date)}</span>
            {role.meetings.length > 1 ? (
              <span className="truncate">{shortMeetingDate(role.meetings[role.meetings.length - 1]?.date)}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-2.5 border-t border-line/60 pt-2">
        <StatTable
          rows={role.stats.map((s) => ({
            key: s.key,
            label: s.label,
            value: s.value,
            format: (v: number) => `${v.toFixed(s.decimals)}${s.suffix ?? ''}`,
            rank: s.rank ?? null,
            poolSize: s.poolSize ?? null,
            sub: s.sub,
          }))}
          showRank={false}
          emptyMessage={role.emptyMessage ?? 'No prior meetings on record.'}
        />
      </div>
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
        <p className="py-3 text-center text-overline font-normal tracking-normal text-ink-muted">
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
            <dt className="text-overline font-semibold uppercase tracking-wide text-ink-muted">{f.label}</dt>
            <dd className="truncate text-label font-normal text-ink">
              {f.value}
              {f.impact ? (
                <Tooltip content={f.impact.label}><span
                  className="ml-1 text-overline tracking-normal font-semibold tabular-nums"
                  style={{ color: heatInk(rankToHeat(f.impact.value, 0.9, 1.1)) }}
                >
                  {fmt.signed2(f.impact.value)}
                </span></Tooltip>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </RoleCard>
  );
}
