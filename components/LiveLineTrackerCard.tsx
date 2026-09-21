'use client';

import { useState } from 'react';
import { useTrackedLines } from './useTrackedLines';
import { useLiveLineValues } from './useLiveLineValues';
import { heatFill, heatInk } from '@/lib/ui/heat';
import { Button, Card, CloseButton, Input, SelectBox } from './ui';

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
        <span className="text-label font-medium text-ink">
          {side === 'over' ? 'Over' : 'Under'} {line} {label}
        </span>
        <div className="flex items-center gap-2">
          <span
            className="text-label font-semibold tabular-nums"
            style={{ color: hasValue ? heatInk(hit ? 0.9 : 0.3) : undefined }}
          >
            {hasValue ? liveValue : loadingValue ? '…' : '—'}
          </span>
          <CloseButton size="sm" onPress={onRemove} aria-label="Remove tracked line" className="hover:text-bad" />
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
        <SelectBox label="Stat" className="min-w-0 flex-1" value={statKey} onChange={setStatKey} options={availableStats.map((s) => ({ value: s.key, label: s.label }))} />
        <SelectBox<'over' | 'under'> label="Side" value={side} onChange={setSide} options={[{ value: 'over', label: 'Over' }, { value: 'under', label: 'Under' }]} />
        <Input
          type="number"
          size="sm"
          inputMode="decimal"
          step="0.5"
          value={lineText}
          onChange={(e) => setLineText(e.target.value)}
          placeholder="Line"
          aria-label="Line"
          className="w-20"
        />
      </div>
      {error ? <p className="text-label text-bad">{error}</p> : null}
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" loading={submitting} onPress={submit}>
          {submitting ? 'Adding…' : 'Track this line'}
        </Button>
        <Button variant="secondary" size="sm" onPress={onCancel}>
          Cancel
        </Button>
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
    <Card
      title="Live line tracker"
      dense
      bodyClassName="p-0"
      scope={
        !adding && data.availableStats.length > 0 ? (
          <Button variant="link" size="sm" onPress={() => setAdding(true)} className="text-label text-ink-secondary">
            + Track a line
          </Button>
        ) : undefined
      }
    >

      {loading && lines.length === 0 ? (
        <div className="p-3 text-label text-ink-muted">Loading…</div>
      ) : lines.length === 0 && !adding ? (
        <div className="p-3 text-label text-ink-muted">
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
    </Card>
  );
}

export default LiveLineTrackerCard;
