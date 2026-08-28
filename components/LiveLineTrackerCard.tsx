'use client';

import { useState } from 'react';
import { useTrackedLines } from './useTrackedLines';
import { useLiveLineValues } from './useLiveLineValues';
import { heatFill, heatInk } from '@/lib/ui/heat';

export interface LiveLineTrackerData {
  subjectId: string;
  sport: string;
  gameId: string | null;
  availableStats: Array<{ key: string; label: string }>;
}

function ProgressRow({
  label,
  side,
  line,
  liveValue,
  loadingValue,
  onRemove,
}: {
  label: string;
  side: 'over' | 'under';
  line: number;
  liveValue: number | null | undefined;
  loadingValue: boolean;
  onRemove: () => void;
}) {
  const hasValue = liveValue != null;
  const pct = hasValue ? Math.min(1, liveValue! / Math.max(line, 0.0001)) : 0;
  const hit = hasValue && (side === 'over' ? liveValue! >= line : liveValue! <= line);

  return (
    <div className="flex flex-col gap-1.5 border-b border-line-soft px-3 py-2.5 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-dense font-medium text-ink">
          {side === 'over' ? 'Over' : 'Under'} {line} {label}
        </span>
        <div className="flex items-center gap-2">
          <span
            className="text-dense font-semibold tabular-nums"
            style={{ color: hasValue ? heatInk(hit ? 0.9 : 0.3) : undefined }}
          >
            {hasValue ? liveValue : loadingValue ? '…' : '—'}
          </span>
          <button type="button" onClick={onRemove} className="text-label text-ink-faint hover:text-bad" aria-label="Remove tracked line">
            ✕
          </button>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-line-soft">
        {hasValue ? (
          <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.round(pct * 100)}%`, backgroundColor: heatFill(hit ? 0.9 : 0.4) }} />
        ) : null}
      </div>
    </div>
  );
}

function AddLineForm({
  availableStats,
  onAdd,
  onCancel,
}: {
  availableStats: Array<{ key: string; label: string }>;
  onAdd: (input: { statKey: string; statLabel: string; side: 'over' | 'under'; line: number }) => Promise<void>;
  onCancel: () => void;
}) {
  const [statKey, setStatKey] = useState(availableStats[0]?.key ?? '');
  const [side, setSide] = useState<'over' | 'under'>('over');
  const [lineText, setLineText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const line = Number(lineText);
    if (!statKey || !Number.isFinite(line)) {
      setError('Enter a valid number for the line.');
      return;
    }
    const stat = availableStats.find((s) => s.key === statKey);
    if (!stat) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAdd({ statKey, statLabel: stat.label, side, line });
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add tracked line');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-line-soft bg-surface-subtle p-3">
      <div className="flex items-center gap-2">
        <select value={statKey} onChange={(e) => setStatKey(e.target.value)} className="min-w-0 flex-1 rounded-md border border-line px-2 py-1.5 text-dense">
          {availableStats.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        <select value={side} onChange={(e) => setSide(e.target.value as 'over' | 'under')} className="rounded-md border border-line px-2 py-1.5 text-dense">
          <option value="over">Over</option>
          <option value="under">Under</option>
        </select>
        <input
          type="number"
          inputMode="decimal"
          step="0.5"
          value={lineText}
          onChange={(e) => setLineText(e.target.value)}
          placeholder="Line"
          className="w-20 rounded-md border border-line px-2 py-1.5 text-dense"
        />
      </div>
      {error ? <p className="text-label text-bad">{error}</p> : null}
      <div className="flex items-center gap-2">
        <button type="button" onClick={submit} disabled={submitting} className="rounded-full bg-masters px-3 py-1.5 text-dense font-medium text-white disabled:opacity-50">
          {submitting ? 'Adding…' : 'Track this line'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-full border border-line px-3 py-1.5 text-dense text-ink-muted">
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Live line tracker — docs/live-matchup-and-line-tracker-gameplan-2026-08-23
 * .md, Part 2. Renders whenever `PlayerDetailData.liveLineTracker` is
 * non-null (every sport but golf/soccer/tennis today, see each adapter's
 * own null-with-reason comment). Two independent data sources composed
 * here: `useTrackedLines` (the user's saved rows, CRUD via
 * `/api/tracked-lines`) and `useLiveLineValues` (the live current value for
 * each, reusing Part 1's own `/api/{sport}/game/[id]/live` routes). A line
 * with no live value yet (game hasn't started, or `gameId` is null) still
 * renders — just with `—` instead of a number — so the card is useful
 * pregame too, not only once a game is live.
 */
export function LiveLineTrackerCard({ data, subjectName }: { data: LiveLineTrackerData; subjectName: string }) {
  const [adding, setAdding] = useState(false);
  const { lines, loading, add, remove } = useTrackedLines(data.sport, data.subjectId, subjectName);
  const statKeys = lines.map((l) => l.statKey);
  const { values, loading: valuesLoading } = useLiveLineValues(data.sport, data.gameId, data.subjectId, subjectName, statKeys, statKeys.length > 0);

  return (
    <section className="lb-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 bg-accent-soft px-3 py-1.5">
        <h2 className="text-[12px] font-semibold text-masters">Live line tracker</h2>
        {!adding && data.availableStats.length > 0 ? (
          <button type="button" onClick={() => setAdding(true)} className="text-[11px] font-medium text-masters">
            + Track a line
          </button>
        ) : null}
      </div>

      {loading && lines.length === 0 ? (
        <div className="p-3 text-dense text-ink-muted">Loading…</div>
      ) : lines.length === 0 && !adding ? (
        <div className="p-3 text-dense text-ink-muted">
          {data.availableStats.length === 0 ? 'No trackable stats for this sport yet.' : 'No lines tracked yet — add one to follow it live.'}
        </div>
      ) : (
        lines.map((l) => (
          <ProgressRow
            key={l.statKey}
            label={l.statLabel}
            side={l.side}
            line={l.line}
            liveValue={values[l.statKey]}
            loadingValue={valuesLoading}
            onRemove={() => void remove(l.statKey)}
          />
        ))
      )}

      {adding ? (
        <AddLineForm availableStats={data.availableStats} onAdd={add} onCancel={() => setAdding(false)} />
      ) : null}
    </section>
  );
}

export default LiveLineTrackerCard;
