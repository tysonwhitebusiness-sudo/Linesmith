'use client';

import { useMemo, useState } from 'react';
import type { SubjectSummary } from '@/lib/core/types';
import { Button, Input, Checkbox, Chip, SearchIcon, SlideoutMenu } from './ui';

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
    <SlideoutMenu isOpen={open} onClose={onClose} title={`Players ${selected.size > 0 ? `· ${selected.size} selected` : ''}`}>
      <Input
        size="sm"
        leading={SearchIcon}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search"
        aria-label="Search players"
        className="mb-3"
      />
      <div className="mb-3 flex gap-2">
        <Button variant="secondary" size="sm" onPress={() => onSetAll(filtered.map((s) => s.subjectId))}>
          Select shown
        </Button>
        <Button variant="tertiary" size="sm" onPress={() => onSetAll([])}>
          Clear
        </Button>
      </div>
      <ul className="space-y-0.5">
        {filtered.length === 0 ? (
          <li className="p-6 text-center text-body-sm text-ink-muted">No players match “{query}”.</li>
        ) : (
          filtered.map((subject) => (
            <li key={subject.subjectId}>
              <Checkbox isSelected={selected.has(subject.subjectId)} onChange={() => onToggle(subject.subjectId)} className="rounded-lg px-2 py-2 active:bg-accent-soft">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{subject.subjectName}</span>
                    {subject.statusLine ? (
                      <span className="block truncate text-label text-ink-muted">{subject.statusLine}</span>
                    ) : null}
                  </span>
                  {typeof subject.meta?.team === 'string' ? (
                    <Chip tone="neutral" size="sm">{subject.meta.team as string}</Chip>
                  ) : null}
                </span>
              </Checkbox>
            </li>
          ))
        )}
      </ul>
    </SlideoutMenu>
  );
}

export default PlayerFilterDrawer;
