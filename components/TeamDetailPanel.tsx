'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PickCandidate, Sport, SportSnapshot } from '@/lib/core/types';
import type { UnifiedLinesResult } from '@/lib/odds/types';
import { TeamLogo } from './SubjectAvatar';
import { TeamDetail } from './TeamDetail';
import { BrandedLoader } from './BrandedLoader';
import { useAllTeams, type TeamStandingRow } from './useAllTeams';
import { useAllNflTeams } from './useAllNflTeams';

/**
 * The Teams page's shell — a searchable list of all teams beside the same
 * kind of detail pane `PlayerDetailPanel` gives players, so switching teams
 * is instant client-side state rather than a fresh page load. The URL still
 * picks which team opens first (deep links from Game Detail, the roster,
 * etc. keep working); after that, selection lives here.
 *
 * One component for both sports, following `PlayerDetailPanel`'s dispatcher
 * pattern (branch on `sport` for which detail component renders) — collapses
 * the former `TeamDetailPanel`/`NflTeamDetailPanel` near-duplicate pair per
 * `docs/sport-adapter-design.md` §4a. Unlike `PlayerDetailPanel`, the team
 * list itself comes from two different sport-specific hooks rather than one
 * shared `snapshot.subjects`, and React's rules of hooks don't allow picking
 * between two different hooks inside one function body — so the sport branch
 * happens one level up, at the component-selection boundary, each branch
 * mounting a genuinely separate component that calls only its own sport's
 * hook. This keeps exactly one real fetch per page load, same as before.
 */
export interface TeamDetailPanelProps {
  sport: Sport;
  /** Omit to auto-load the first team (alphabetically) once the list loads — the Teams tab's landing behaviour. */
  initialTeamId?: number;
  snapshot: SportSnapshot | null;
  /** MLB-only today (drives `TeamDetail`'s line stepper/edge badge) — NFL's branch doesn't read this. */
  odds?: UnifiedLinesResult | null;
  onAdd?: (candidate: PickCandidate, oddsInfo?: { americanOdds: string; source: string }) => void;
  addedKeys?: Set<string>;
}

function TeamListShell({
  sortedTeams,
  loading,
  error,
  search,
  onSearchChange,
  activeTeamId,
  onSelect,
  children,
}: {
  sortedTeams: TeamStandingRow[];
  loading: boolean;
  error: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  activeTeamId: number;
  onSelect: (teamId: number) => void;
  children: ReactNode;
}) {
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? sortedTeams.filter((t) => t.name.toLowerCase().includes(query) || t.abbreviation.toLowerCase().includes(query))
      : sortedTeams;
  }, [sortedTeams, search]);

  return (
    <div className="grid gap-3 lg:grid-cols-[260px_1fr] lg:items-start">
      <div className="lb-card overflow-hidden lg:sticky lg:top-4">
        <div className="border-b border-line p-2.5">
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search teams…"
            aria-label="Search teams"
            className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] shadow-card focus:border-masters focus:outline-none"
          />
        </div>
        {error ? <p className="p-3 text-[11px] text-bad">{error}</p> : null}
        <ul className="max-h-[70vh] overflow-y-auto p-1.5" role="listbox" aria-label="Teams">
          {loading && sortedTeams.length === 0 ? (
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
                    onClick={() => onSelect(t.teamId)}
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

      <div className="min-w-0">{children}</div>
    </div>
  );
}

function MlbTeamDetailPanel({ initialTeamId, snapshot, odds, onAdd, addedKeys }: Omit<TeamDetailPanelProps, 'sport'>) {
  const [search, setSearch] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const { teams, loading, error } = useAllTeams();

  const sortedTeams = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);
  const activeTeamId = selectedTeamId ?? initialTeamId ?? sortedTeams[0]?.teamId ?? 0;

  // Holds a loader over just the detail pane (not the team list — switching
  // teams should stay browsable while the newly-selected one loads) until
  // TeamDetail's own data-fetching hooks settle. See PlayerDetail's
  // identically-named prop for why this exists.
  const [detailReady, setDetailReady] = useState(false);
  useEffect(() => {
    setDetailReady(false);
  }, [activeTeamId]);

  return (
    <TeamListShell
      sortedTeams={sortedTeams}
      loading={loading}
      error={error}
      search={search}
      onSearchChange={setSearch}
      activeTeamId={activeTeamId}
      onSelect={setSelectedTeamId}
    >
      {!detailReady && <BrandedLoader size="page" />}
      <div style={{ display: detailReady ? 'block' : 'none' }}>
        <TeamDetail
          sport="mlb"
          teamId={activeTeamId}
          snapshot={snapshot}
          odds={odds ?? null}
          onAdd={onAdd}
          addedKeys={addedKeys}
          standingsTeams={teams}
          standingsLoading={loading}
          onReadyChange={setDetailReady}
        />
      </div>
    </TeamListShell>
  );
}

function NflTeamDetailPanelBody({ initialTeamId, onAdd, addedKeys }: Omit<TeamDetailPanelProps, 'sport' | 'snapshot' | 'odds'>) {
  const [search, setSearch] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const { teams, loading, error } = useAllNflTeams();

  const sortedTeams = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);
  const activeTeamId = selectedTeamId ?? initialTeamId ?? sortedTeams[0]?.teamId ?? 0;

  // See MlbTeamDetailPanel's identical block for why this exists.
  const [detailReady, setDetailReady] = useState(false);
  useEffect(() => {
    setDetailReady(false);
  }, [activeTeamId]);

  return (
    <TeamListShell
      sortedTeams={sortedTeams}
      loading={loading}
      error={error}
      search={search}
      onSearchChange={setSearch}
      activeTeamId={activeTeamId}
      onSelect={setSelectedTeamId}
    >
      {!detailReady && <BrandedLoader size="page" />}
      <div style={{ display: detailReady ? 'block' : 'none' }}>
        <TeamDetail
          sport="nfl"
          teamId={activeTeamId}
          standingsTeams={teams}
          standingsLoading={loading}
          onAdd={onAdd}
          addedKeys={addedKeys}
          onReadyChange={setDetailReady}
        />
      </div>
    </TeamListShell>
  );
}

export function TeamDetailPanel({ sport, initialTeamId, snapshot, odds, onAdd, addedKeys }: TeamDetailPanelProps) {
  return sport === 'nfl' ? (
    <NflTeamDetailPanelBody initialTeamId={initialTeamId} onAdd={onAdd} addedKeys={addedKeys} />
  ) : (
    <MlbTeamDetailPanel initialTeamId={initialTeamId} snapshot={snapshot} odds={odds} onAdd={onAdd} addedKeys={addedKeys} />
  );
}

export default TeamDetailPanel;
