'use client';

import { useMemo, useState } from 'react';
import type { SubjectSummary } from '@/lib/core/types';

export interface PlayerFilterDrawerProps {
  subjects: SubjectSummary[];
  selected: Set<string>;
  open: boolean;
  onClose: () => void;
  onToggle: (subjectId: string) => void;
  onSetAll: (ids: string[]) => void;
}

/**
 * Multi-select checklist used to narrow the scan to a chosen set of subjects.
 * Sport-agnostic — it only reads `SubjectSummary`.
 */
export function PlayerFilterDrawer({
  subjects,
  selected,
  open,
  onClose,
  onToggle,
  onSetAll,
}: PlayerFilterDrawerProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return subjects;
    return subjects.filter((s) => s.subjectName.toLowerCase().includes(q));
  }, [query, subjects]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button type="button" aria-label="Close filter" onClick={onClose} className="absolute inset-0 bg-ink/30" />

      <section className="relative flex max-h-[85vh] flex-col rounded-t-2xl bg-paper shadow-drawer">
        <header className="border-b border-line px-4 py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">
              Players {selected.size > 0 ? `· ${selected.size} selected` : ''}
            </h2>
            <button type="button" onClick={onClose} className="text-sm font-semibold text-masters">
              Done
            </button>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search players"
            className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-masters focus:outline-none"
          />
          <div className="mt-2 flex gap-3 text-sm">
            <button type="button" onClick={() => onSetAll(filtered.map((s) => s.subjectId))} className="text-masters">
              Select shown
            </button>
            <button type="button" onClick={() => onSetAll([])} className="text-ink-muted">
              Clear
            </button>
          </div>
        </header>

        <ul className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <li className="p-6 text-center text-sm text-ink-muted">No players match “{query}”.</li>
          ) : (
            filtered.map((subject) => {
              const checked = selected.has(subject.subjectId);
              return (
                <li key={subject.subjectId}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 active:bg-accent-soft">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(subject.subjectId)}
                      className="h-4 w-4 accent-masters"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{subject.subjectName}</span>
                      {subject.statusLine ? (
                        <span className="block truncate text-xs text-ink-muted">{subject.statusLine}</span>
                      ) : null}
                    </span>
                    {typeof subject.meta?.team === 'string' ? (
                      <span className="lb-chip bg-ink/5 text-ink-muted">{subject.meta.team as string}</span>
                    ) : null}
                  </label>
                </li>
              );
            })
          )}
        </ul>
      </section>
    </div>
  );
}

export default PlayerFilterDrawer;
