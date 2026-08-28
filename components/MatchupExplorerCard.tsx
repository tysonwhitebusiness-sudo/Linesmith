'use client';

/**
 * The universal matchup card — one component, every sport, replacing
 * `BatterPitcherMatchupCard`/`NflPlayerVsDefenseCard`/MLB's old context-rail
 * matchup card outright. See `docs/matchup-card-rebuild-gameplan-2026-08-23.md`
 * for the full design reasoning; this file is the "shell" §9 phase 1 refers
 * to. Fed entirely by `MatchupExplorerData` (declared in
 * `lib/sports/mlb/adapters/playerDetailAdapter.ts` per this codebase's
 * "MLB owns the canonical type" rule) — this component never branches on
 * sport, only on which optional fields that data happens to carry.
 *
 * View modes (Overview / Stat grid / Profile) reuse `SegmentedToggle`'s
 * animated-glider pattern. Bar/number transitions and the crossfade between
 * views, groups, and opponents use Motion (`npm install motion` — see the
 * gameplan §4.4/§10 decision) rather than the hand-rolled CSS-transition
 * fallback that codebase otherwise defaults to, per explicit approval to
 * bring in a real (free/MIT) animation library.
 */

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { SegmentedToggle } from './SegmentedToggle';
import { SubjectAvatar, TeamLogo } from './SubjectAvatar';
import { heatFill } from '@/lib/ui/heat';
import { percentileOf } from './PercentileRing';
import { ordinal } from './PlayerDetail';
import type { MatchupExplorerData, MatchupStatRow } from '@/lib/sports/mlb/adapters/playerDetailAdapter';

type ViewMode = 'overview' | 'grid' | 'profile';

function pctOf(row: MatchupStatRow | undefined | null): number | null {
  if (!row || row.rank == null || row.poolSize == null) return null;
  return percentileOf({ rank: row.rank, poolSize: row.poolSize });
}

function MotionBar({ percentile, reverse }: { percentile: number | null; reverse?: boolean }) {
  const p = percentile ?? 0;
  return (
    <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-line-hair">
      <motion.div
        className={`h-full rounded-full ${reverse ? 'ml-auto' : ''}`}
        initial={false}
        animate={{ width: `${p}%`, backgroundColor: heatFill(p / 100) }}
        transition={{ type: 'spring', stiffness: 220, damping: 28 }}
      />
    </div>
  );
}

function SoloRow({ row }: { row: MatchupStatRow }) {
  const p = pctOf(row);
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 truncate text-[9px] uppercase tracking-wide text-ink-faint">{row.label}</span>
      <MotionBar percentile={p} />
      <motion.span
        key={row.value}
        initial={{ opacity: 0.4 }}
        animate={{ opacity: 1 }}
        className="w-10 shrink-0 text-right text-[10.5px] font-semibold tabular-nums"
      >
        {row.value.toFixed(row.decimals)}
      </motion.span>
      <span className="w-16 shrink-0 truncate text-right text-[9px] text-ink-faint">
        {row.rank != null && row.poolSize != null ? `${ordinal(row.rank)} of ${row.poolSize}` : '—'}
      </span>
    </div>
  );
}

function TwoSidedRow({ label, subject, opponent }: { label: string; subject?: MatchupStatRow; opponent?: MatchupStatRow }) {
  const sp = pctOf(subject);
  const op = pctOf(opponent);
  return (
    <div className="py-1">
      <div className="grid grid-cols-[44px_1fr_1fr_44px] items-center gap-1.5">
        <span className="text-right text-[10.5px] font-semibold tabular-nums">{subject ? subject.value.toFixed(subject.decimals) : '—'}</span>
        <MotionBar percentile={sp} reverse />
        <MotionBar percentile={op} />
        <span className="text-[10.5px] font-semibold tabular-nums">{opponent ? opponent.value.toFixed(opponent.decimals) : '—'}</span>
      </div>
      <div className="text-center text-[9px] uppercase tracking-wide text-ink-faint">{label}</div>
    </div>
  );
}

function GroupGrid({
  subjectRows,
  opponentRows,
  subjectRoleLabel,
  opponentRoleLabel,
}: {
  subjectRows: MatchupStatRow[];
  opponentRows: MatchupStatRow[];
  subjectRoleLabel: string;
  opponentRoleLabel: string;
}) {
  const opponentByKey = new Map(opponentRows.map((r) => [r.key, r]));
  const sharedKeys = subjectRows.filter((r) => opponentByKey.has(r.key)).map((r) => r.key);
  const sharedSet = new Set(sharedKeys);
  const subjectByKey = new Map(subjectRows.map((r) => [r.key, r]));
  const soloSubject = subjectRows.filter((r) => !sharedSet.has(r.key));
  const soloOpponent = opponentRows.filter((r) => !sharedSet.has(r.key));

  if (subjectRows.length === 0 && opponentRows.length === 0) {
    return <p className="py-4 text-center text-[11px] text-ink-faint">No stats available for this group yet.</p>;
  }

  return (
    <div className="space-y-3">
      {sharedKeys.length > 0 ? (
        <div>
          <div className="mb-1 grid grid-cols-[44px_1fr_1fr_44px] items-center gap-1.5">
            <span aria-hidden />
            <span className="text-[9px] font-semibold uppercase tracking-wide text-masters">{subjectRoleLabel}</span>
            <span className="text-right text-[9px] font-semibold uppercase tracking-wide text-masters">{opponentRoleLabel}</span>
            <span aria-hidden />
          </div>
          <div className="divide-y divide-line/50">
            {sharedKeys.map((k) => (
              <TwoSidedRow key={k} label={subjectByKey.get(k)!.label} subject={subjectByKey.get(k)} opponent={opponentByKey.get(k)} />
            ))}
          </div>
        </div>
      ) : null}
      {soloSubject.length > 0 || soloOpponent.length > 0 ? (
        <div className="grid grid-cols-1 gap-x-5 gap-y-1.5 border-t border-line pt-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            {soloSubject.map((r) => (
              <SoloRow key={r.key} row={r} />
            ))}
          </div>
          <div className="space-y-1.5">
            {soloOpponent.map((r) => (
              <SoloRow key={r.key} row={r} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Hand-rolled radar/spider chart — no chart library, same "SVG primitives, no new viz dependency" convention `PercentileRing` already set. Plots every stat key either side has a percentile for, subject vs. opponent overlaid. */
function ProfileRadar({
  keys,
  subjectByKey,
  opponentByKey,
  subjectLabel,
  opponentLabel,
}: {
  keys: Array<{ key: string; label: string }>;
  subjectByKey: Map<string, MatchupStatRow>;
  opponentByKey: Map<string, MatchupStatRow>;
  subjectLabel: string;
  opponentLabel: string;
}) {
  if (keys.length < 3) {
    return <p className="py-4 text-center text-[11px] text-ink-faint">Not enough ranked stats for a profile view yet — see the Stat grid tab instead.</p>;
  }
  const size = 220;
  const center = size / 2;
  const maxR = center - 28;
  const angleFor = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / keys.length;
  const pointFor = (i: number, pct: number) => {
    const r = (pct / 100) * maxR;
    const a = angleFor(i);
    return `${center + r * Math.cos(a)},${center + r * Math.sin(a)}`;
  };
  const subjectPts = keys.map((k, i) => pointFor(i, pctOf(subjectByKey.get(k.key)) ?? 0)).join(' ');
  const opponentPts = keys.map((k, i) => pointFor(i, pctOf(opponentByKey.get(k.key)) ?? 0)).join(' ');

  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <svg width={size} height={size} className="overflow-visible">
        {[0.25, 0.5, 0.75, 1].map((ring) => (
          <circle key={ring} cx={center} cy={center} r={maxR * ring} fill="none" stroke="currentColor" className="text-line" strokeWidth={1} />
        ))}
        {keys.map((k, i) => {
          const a = angleFor(i);
          const lx = center + (maxR + 16) * Math.cos(a);
          const ly = center + (maxR + 16) * Math.sin(a);
          return (
            <text key={k.key} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-current text-ink-faint" style={{ fontSize: 9 }}>
              {k.label}
            </text>
          );
        })}
        <motion.polygon
          key={`opp-${opponentPts}`}
          points={opponentPts}
          fill="#0f7a4f33"
          stroke="#0f7a4f"
          strokeWidth={1.5}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
        />
        <motion.polygon
          key={`subj-${subjectPts}`}
          points={subjectPts}
          fill="#97989b33"
          stroke="#97989b"
          strokeWidth={1.5}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, delay: 0.05 }}
        />
      </svg>
      <div className="flex items-center gap-4 text-[10px]">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: '#97989b' }} />{subjectLabel}</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: '#0f7a4f' }} />{opponentLabel}</span>
      </div>
    </div>
  );
}

function OpponentPicker({
  data,
  selectedId,
  onSelect,
}: {
  data: MatchupExplorerData;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  if (!data.opponentOptions || data.opponentOptions.length === 0) return null;
  const filtered = data.opponentOptions.filter(
    (o) => o.name.toLowerCase().includes(query.toLowerCase()) || o.abbr.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border border-line px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-muted hover:text-ink"
      >
        {selectedId === data.defaultOpponentId ? 'Change opponent' : 'Custom ▾'}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-20 mt-1 max-h-64 w-48 overflow-y-auto rounded-lg border border-line bg-card p-1.5 shadow-lg"
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search teams…"
              className="mb-1.5 w-full rounded border border-line bg-paper px-2 py-1 text-[11px] outline-none"
            />
            {selectedId !== data.defaultOpponentId ? (
              <button
                type="button"
                onClick={() => { onSelect(data.defaultOpponentId); setOpen(false); }}
                className="mb-1 w-full rounded px-2 py-1 text-left text-[11px] font-semibold text-masters hover:bg-accent-soft"
              >
                ↺ Reset to next game
              </button>
            ) : null}
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => { onSelect(o.id); setOpen(false); setQuery(''); }}
                className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] hover:bg-accent-soft ${o.id === selectedId ? 'font-semibold text-ink' : 'text-ink-muted'}`}
              >
                <TeamLogo logoUrl={o.logoUrl ?? undefined} abbreviation={o.abbr} size={13} />
                {o.name}
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function MatchupExplorerCard({ data }: { data: MatchupExplorerData }) {
  const [view, setView] = useState<ViewMode>('overview');
  const [opponentId, setOpponentId] = useState(data.defaultOpponentId);
  const groups = data.positionGroups ?? [{ key: '_default', label: 'Overview' }];
  const [groupKey, setGroupKey] = useState(groups[0]?.key ?? '_default');

  const opponent = data.opponentMeta[opponentId] ?? data.opponentMeta[data.defaultOpponentId];
  const subjectRows = data.subjectStatsByGroup[groupKey] ?? [];
  const opponentRows = data.opponentStatsByGroup[opponentId]?.[groupKey] ?? [];
  const subjectRoleLabel = data.subjectRoleLabel ?? 'Produces';
  const opponentRoleLabel = data.opponentRoleLabel ?? 'Allows';

  const headline = useMemo(() => {
    let best: { label: string; pct: number } | null = null;
    for (const groupOfOpponent of Object.values(data.opponentStatsByGroup[opponentId] ?? {})) {
      for (const row of groupOfOpponent) {
        const p = pctOf(row);
        if (p != null && (best == null || p > best.pct)) best = { label: row.label, pct: p };
      }
    }
    return best;
  }, [data.opponentStatsByGroup, opponentId]);

  const profileKeys = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of subjectRows) if (r.rank != null) seen.set(r.key, r.label);
    for (const r of opponentRows) if (r.rank != null) seen.set(r.key, r.label);
    return [...seen.entries()].map(([key, label]) => ({ key, label }));
  }, [subjectRows, opponentRows]);

  return (
    <section className="lb-card overflow-hidden">
      <div className="flex items-center justify-between bg-accent-soft px-3 py-1.5">
        <h2 className="text-[10.5px] font-bold uppercase tracking-wide text-masters">Matchup</h2>
        <OpponentPicker data={data} selectedId={opponentId} onSelect={setOpponentId} />
      </div>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5 text-left">
            <SubjectAvatar name={data.subjectName} headshotUrl={data.subjectHeadshotUrl ?? undefined} fallbackUrl={data.subjectFallbackUrl ?? undefined} size={40} />
            <div className="min-w-0">
              <TeamLogo logoUrl={data.subjectTeamLogoUrl ?? undefined} abbreviation={data.subjectTeamAbbr ?? undefined} size={13} />
              <div className="truncate text-emphasis font-bold leading-tight text-ink">{data.subjectName}</div>
            </div>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={opponentId}
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.18 }}
              className="flex min-w-0 flex-row-reverse items-center gap-2.5 text-right"
            >
              <SubjectAvatar name={opponent?.name ?? 'Opponent'} headshotUrl={opponent?.logoUrl ?? undefined} size={40} />
              <div className="min-w-0">
                <div className="flex flex-row-reverse items-center">
                  <TeamLogo logoUrl={opponent?.logoUrl ?? undefined} abbreviation={opponent?.abbr} size={13} />
                </div>
                <div className="truncate text-emphasis font-bold leading-tight text-ink">{opponent?.name ?? 'Opponent'}</div>
                {opponent?.hand ? <div className="text-label text-ink-faint">{opponent.hand}HP</div> : null}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {data.contextLine ? <p className="mt-1.5 truncate text-[10px] text-ink-faint">{data.contextLine}</p> : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <SegmentedToggle
            options={[
              { key: 'overview', label: 'Overview' },
              { key: 'grid', label: 'Stat grid' },
              { key: 'profile', label: 'Profile' },
            ]}
            value={view}
            onChange={(v) => setView(v as ViewMode)}
          />
          {data.positionGroups && data.positionGroups.length > 1 ? (
            <SegmentedToggle
              options={data.positionGroups.map((g) => ({ key: g.key, label: g.label }))}
              value={groupKey}
              onChange={setGroupKey}
            />
          ) : null}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={`${view}-${groupKey}-${opponentId}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="mt-3"
          >
            {view === 'overview' ? (
              <div className="py-2 text-[12px]">
                {headline ? (
                  <p>
                    Biggest edge: <span className="font-semibold text-ink">{headline.label}</span> — {opponent?.name ?? 'this opponent'} ranks in the{' '}
                    <span className="font-semibold" style={{ color: heatFill(headline.pct / 100) }}>
                      {headline.pct}th percentile
                    </span>{' '}
                    allowing it.
                  </p>
                ) : (
                  <p className="text-ink-faint">Not enough ranked data yet for a headline stat.</p>
                )}
              </div>
            ) : view === 'grid' ? (
              <GroupGrid subjectRows={subjectRows} opponentRows={opponentRows} subjectRoleLabel={subjectRoleLabel} opponentRoleLabel={opponentRoleLabel} />
            ) : (
              <ProfileRadar keys={profileKeys} subjectByKey={new Map(subjectRows.map((r) => [r.key, r]))} opponentByKey={new Map(opponentRows.map((r) => [r.key, r]))} subjectLabel={data.subjectTeamAbbr ?? 'Subject'} opponentLabel={opponent?.abbr ?? 'Opponent'} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

export default MatchupExplorerCard;
