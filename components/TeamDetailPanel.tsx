'use client';

import { useMemo, useState } from 'react';
import type { PickCandidate, SportSnapshot } from '@/lib/core/types';
import type { UnifiedLinesResult } from '@/lib/odds/types';
import { TeamLogo } from './SubjectAvatar';
import { TeamDetail } from './TeamDetail';
import { useAllTeams } from './useAllTeams';

/**
 * The Teams page's shell — a searchable list of all 30 teams beside the same
 * kind of detail pane `PlayerDetailPanel` gives players, so switching teams
 * is instant client-side state rather than a fresh page load. The URL still
 * picks which team opens first (deep links from Game Detail, the roster,
 * etc. keep working); after that, selection lives here.
 */
export interface TeamDetailPanelProps {
  /** Omit to auto-load the first team (alphabetically) once the list loads — the Teams tab's landing behaviour. */
  initialTeamId?: number;
  snapshot: SportSnapshot | null;
  odds: UnifiedLinesResult | null;
  onAdd?: (candidate: PickCandidate, oddsInfo?: { americanOdds: string; source: string }) => void;
  addedKeys?: Set<string>;
}

export function TeamDetailPanel({ initialTeamId, snapshot, odds, onAdd, addedKeys }: TeamDetailPanelProps) {
  const [search, setSearch] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const { teams, loading, error } = useAllTeams();

  const sorted = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? sorted.filter((t) => t.name.toLowerCase().includes(query) || t.abbreviation.toLowerCase().includes(query))
      : sorted;
  }, [sorted, search]);

  const activeTeamId = selectedTeamId ?? initialTeamId ?? sorted[0]?.teamId ?? 0;

  return (
    <div className="grid gap-3 lg:grid-cols-[260px_1fr] lg:items-start">
      <div className="lb-card overflow-hidden lg:sticky lg:top-4">
        <div className="border-b border-line p-2.5">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search teams…"
            aria-label="Search teams"
            className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] shadow-card focus:border-masters focus:outline-none"
          />
        </div>
        {error ? <p className="p-3 text-[11px] text-bad">{error}</p> : null}
        <ul className="max-h-[70vh] overflow-y-auto p-1.5" role="listbox" aria-label="Teams">
          {loading && teams.length === 0 ? (
            <li className="p-4 text-center text-[12px] text-ink-muted">Loading…</li>
          ) : filtered.length === 0 ? (
            <li className="p-4 text-center text-[12px] text-ink-muted">No teams match.</li>
          ) : (
            filtered.map((t) => {
              const selected = t.teamId === activeTeamId;
              return (
                <li key={t.teamId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => setSelectedTeamId(t.teamId)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                      selected ? 'bg-accent-soft' : 'hover:bg-ink/[0.03]'
                    }`}
                  >
                    <TeamLogo logoUrl={t.logoUrl} abbreviation={t.abbreviation} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] ${selected ? 'font-semibold text-masters' : ''}`}>{t.name}</span>
                      <span className="block truncate text-[10px] text-ink-faint">{t.divisionShortName}</span>
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
                      {t.wins}-{t.losses}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>

      <div className="min-w-0">
        <TeamDetail
          teamId={activeTeamId}
          snapshot={snapshot}
          odds={odds}
          onAdd={onAdd}
          addedKeys={addedKeys}
          standingsTeams={teams}
          standingsLoading={loading}
        />
      </div>
    </div>
  );
}

export default TeamDetailPanel;
