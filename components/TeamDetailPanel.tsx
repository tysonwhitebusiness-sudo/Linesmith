'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Input, PickList, SearchIcon } from './ui';
import type { Sport, SoccerLeague } from '@/lib/core/types';
import { TeamLogo } from './SubjectAvatar';
import { TeamResearchPage } from './TeamResearchPage';
import { BrandedLoader } from './BrandedLoader';
import { useAllTeams, type TeamStandingRow } from './useAllTeams';
import { useAllNflTeams } from './useAllNflTeams';
import { useAllSoccerTeams } from './useAllSoccerTeams';
import { useAllCfbTeams } from './useAllCfbTeams';
import { useAllNbaTeams } from './useAllNbaTeams';
import { useAllNhlTeams } from './useAllNhlTeams';

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
  /** Soccer only. */
  league?: SoccerLeague;
  /** Omit to auto-load the first team (alphabetically) once the list loads — the Teams tab's landing behaviour. */
  initialTeamId?: number;
}

function TeamListShell({
  sortedTeams,
  loading,
  error,
  search,
  onSearchChange,
  activeTeamId,
  onSelect,
  onRetry,
  listOnPhone,
  children,
}: {
  sortedTeams: TeamStandingRow[];
  loading: boolean;
  error: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  activeTeamId: number;
  onSelect: (teamId: number) => void;
  /** Re-runs the teams fetch. Absent where the sport's hook exposes no refresh. */
  onRetry?: () => void;
  /**
   * Whether the team list shows below the desktop breakpoint. Off on a team's
   * own URL (operator, 2026-09-16): on a phone the list stacked above the page
   * and a reader scrolled past every club to reach the team they opened. The
   * Teams tab's landing, which has no team in its URL, keeps it.
   */
  listOnPhone: boolean;
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
      <div className={`lb-card overflow-hidden lg:sticky lg:top-4 ${listOnPhone ? '' : 'hidden lg:block'}`}>
        <div className="border-b border-line p-2.5">
          <Input
            type="search"
            size="sm"
            leading={SearchIcon}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search teams…"
            aria-label="Search teams"
          />
        </div>
        {/* D5/R1e. This printed the raw API error text straight onto the page,
            including the rate limiter's own "Limit is 60 per 60s" — and then,
            because the list was empty, told the user "No teams match", which
            is false: the teams didn't load. A failed load and an empty search
            are different things and now say so. R3's `ErrorState` replaces
            this with the shared primitive. */}
        {error ? (
          <p className="p-3 text-[11px] text-bad">
            Couldn’t load teams.{' '}
            {onRetry ? (
              <Button variant="link" size="sm" onPress={onRetry}>
                Retry
              </Button>
            ) : (
              <Button variant="link" size="sm" onPress={() => window.location.reload()}>
                Retry
              </Button>
            )}
          </p>
        ) : null}
        {loading && sortedTeams.length === 0 ? (
          <p className="p-4 text-center text-body-sm text-ink-muted">Loading…</p>
        ) : error && sortedTeams.length === 0 ? (
          <p className="p-4 text-center text-body-sm text-ink-muted">Teams unavailable right now.</p>
        ) : (
          // U3: the kit PickList (React Aria ListBox) — arrow keys, typeahead
          // and a real selected option, where this was buttons claiming to be.
          <PickList
            label="Teams"
            className="max-h-[70vh] overflow-y-auto p-1.5"
            value={String(activeTeamId)}
            onChange={(k) => onSelect(Number(k))}
            empty={search.trim() ? `No teams match “${search.trim()}”.` : 'No teams to show.'}
            items={filtered.map((t) => ({
              key: String(t.teamId),
              label: t.name,
              sub: t.divisionShortName,
              image: <TeamLogo logoUrl={t.logoUrl} abbreviation={t.abbreviation} size={26} />,
              badge: `${t.wins}-${t.losses}`,
            }))}
          />
        )}
      </div>

      <div className="min-w-0">{children}</div>
    </div>
  );
}

function MlbTeamDetailPanel({ initialTeamId }: Omit<TeamDetailPanelProps, 'sport'>) {
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
      listOnPhone={initialTeamId == null}
      loading={loading}
      error={error}
      search={search}
      onSearchChange={setSearch}
      activeTeamId={activeTeamId}
      onSelect={setSelectedTeamId}
    >
      {!detailReady && <BrandedLoader size="page" />}
      <div style={{ display: detailReady ? 'block' : 'none' }}>
        {/* R7.1: MLB's team page is the rebuilt research page. The other sports
            move to it in R7.2-R7.4 and keep `TeamDetail` until then. */}
        <TeamResearchPage sport="mlb" teamId={activeTeamId} onReadyChange={setDetailReady} />
      </div>
    </TeamListShell>
  );
}

function NflTeamDetailPanelBody({ initialTeamId }: Omit<TeamDetailPanelProps, 'sport'>) {
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
      listOnPhone={initialTeamId == null}
      loading={loading}
      error={error}
      search={search}
      onSearchChange={setSearch}
      activeTeamId={activeTeamId}
      onSelect={setSelectedTeamId}
    >
      {!detailReady && <BrandedLoader size="page" />}
      <div style={{ display: detailReady ? 'block' : 'none' }}>
        {/* R7.2: football team pages are the rebuilt research page. */}
        <TeamResearchPage sport="nfl" teamId={activeTeamId} onReadyChange={setDetailReady} />
      </div>
    </TeamListShell>
  );
}

function SoccerTeamDetailPanelBody({ league, initialTeamId }: { league: SoccerLeague } & Omit<TeamDetailPanelProps, 'sport' | 'league'>) {
  const [search, setSearch] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const { teams, loading, error } = useAllSoccerTeams(league);

  const sortedTeams = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);
  const activeTeamId = selectedTeamId ?? initialTeamId ?? sortedTeams[0]?.teamId ?? 0;

  // Switching leagues means switching team pools entirely — same reset as switching teams.
  useEffect(() => {
    setSelectedTeamId(null);
  }, [league]);

  // See MlbTeamDetailPanel's identical block for why this exists.
  const [detailReady, setDetailReady] = useState(false);
  useEffect(() => {
    setDetailReady(false);
  }, [activeTeamId]);

  return (
    <TeamListShell
      sortedTeams={sortedTeams}
      listOnPhone={initialTeamId == null}
      loading={loading}
      error={error}
      search={search}
      onSearchChange={setSearch}
      activeTeamId={activeTeamId}
      onSelect={setSelectedTeamId}
    >
      {!detailReady && <BrandedLoader size="page" />}
      <div style={{ display: detailReady ? 'block' : 'none' }}>
        {/* R7.4: soccer team pages are the rebuilt research page. */}
        <TeamResearchPage sport={`soccer_${league}`} teamId={activeTeamId} onReadyChange={setDetailReady} />
      </div>
    </TeamListShell>
  );
}

function CfbTeamDetailPanelBody({ initialTeamId }: Omit<TeamDetailPanelProps, 'sport'>) {
  const [search, setSearch] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const { teams, loading, error } = useAllCfbTeams();

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
      listOnPhone={initialTeamId == null}
      loading={loading}
      error={error}
      search={search}
      onSearchChange={setSearch}
      activeTeamId={activeTeamId}
      onSelect={setSelectedTeamId}
    >
      {!detailReady && <BrandedLoader size="page" />}
      <div style={{ display: detailReady ? 'block' : 'none' }}>
        {/* R7.2: football team pages are the rebuilt research page. */}
        <TeamResearchPage sport="cfb" teamId={activeTeamId} onReadyChange={setDetailReady} />
      </div>
    </TeamListShell>
  );
}

function NbaTeamDetailPanelBody({ initialTeamId }: Omit<TeamDetailPanelProps, 'sport'>) {
  const [search, setSearch] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const { teams, loading, error } = useAllNbaTeams();

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
      listOnPhone={initialTeamId == null}
      loading={loading}
      error={error}
      search={search}
      onSearchChange={setSearch}
      activeTeamId={activeTeamId}
      onSelect={setSelectedTeamId}
    >
      {!detailReady && <BrandedLoader size="page" />}
      <div style={{ display: detailReady ? 'block' : 'none' }}>
        {/* R7.3: basketball and hockey team pages are the rebuilt research page. */}
        <TeamResearchPage sport="nba" teamId={activeTeamId} onReadyChange={setDetailReady} />
      </div>
    </TeamListShell>
  );
}

function NhlTeamDetailPanelBody({ initialTeamId }: Omit<TeamDetailPanelProps, 'sport'>) {
  const [search, setSearch] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const { teams, loading, error } = useAllNhlTeams();

  const sortedTeams = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);
  const activeTeamId = selectedTeamId ?? initialTeamId ?? sortedTeams[0]?.teamId ?? 0;

  const [detailReady, setDetailReady] = useState(false);
  useEffect(() => {
    setDetailReady(false);
  }, [activeTeamId]);

  return (
    <TeamListShell
      sortedTeams={sortedTeams}
      listOnPhone={initialTeamId == null}
      loading={loading}
      error={error}
      search={search}
      onSearchChange={setSearch}
      activeTeamId={activeTeamId}
      onSelect={setSelectedTeamId}
    >
      {!detailReady && <BrandedLoader size="page" />}
      <div style={{ display: detailReady ? 'block' : 'none' }}>
        {/* R7.3: basketball and hockey team pages are the rebuilt research page. */}
        <TeamResearchPage sport="nhl" teamId={activeTeamId} onReadyChange={setDetailReady} />
      </div>
    </TeamListShell>
  );
}

export function TeamDetailPanel({ sport, league, initialTeamId }: TeamDetailPanelProps) {
  return sport === 'nfl' ? (
    <NflTeamDetailPanelBody initialTeamId={initialTeamId} />
  ) : sport === 'cfb' ? (
    <CfbTeamDetailPanelBody initialTeamId={initialTeamId} />
  ) : sport === 'nba' ? (
    <NbaTeamDetailPanelBody initialTeamId={initialTeamId} />
  ) : sport === 'nhl' ? (
    <NhlTeamDetailPanelBody initialTeamId={initialTeamId} />
  ) : sport === 'soccer' && league ? (
    <SoccerTeamDetailPanelBody league={league} initialTeamId={initialTeamId} />
  ) : (
    <MlbTeamDetailPanel initialTeamId={initialTeamId} />
  );
}

export default TeamDetailPanel;
