'use client';

import { useMemo, useState } from 'react';
import type { PickCandidate, Sport, SportSnapshot } from '@/lib/core/types';
import type { UnifiedLinesResult } from '@/lib/odds/types';
import { SubjectAvatar, TeamLogo } from './SubjectAvatar';
import { PlayerDetail, FilterChip } from './PlayerDetail';
import { PlayerSkeleton } from './Skeleton';
import { Chip, Input, PickList, SearchIcon, SegmentedToggle, useUrlState } from './ui';
import { useTeamColors } from './useTeamColors';
import { teamColor } from '@/lib/sports/shared/teamColors';
import { useGolfPlayerStats } from './useGolfPlayerStats';
import { useSyntheticPlayerCandidates } from './useSyntheticPlayerCandidates';
import { usePlayerIndex } from './usePlayerIndex';
import { espnHeadshot, mlbHeadshot } from '@/lib/sports/shared/identity';
import { athleteIdOf } from '@/lib/sports/shared/playerResearchShapes';

/** Sports with a real GET /api/{sport}/player/[id]/candidates route wired — see useSyntheticPlayerCandidates.ts. */
const SYNTHETIC_CANDIDATES_SPORTS = new Set<Sport>(['nhl', 'nba', 'tennis', 'cfb', 'soccer']);

/**
 * The Players tab — a picker beside the same `PlayerDetail` component the
 * Scan-row click already routes to, so there is exactly one player-detail
 * experience in the app rather than two. Replaces the old `PlayerPanel` /
 * `PlayerSidePanel` in `Panels.tsx`, which had its own hand-rolled L3/L5
 * cells and a plain `<select>` — deleted once nothing referenced them.
 *
 * Sport-generic where `PlayerDetail` itself is (reads `snapshot`/`candidates`
 * the same way), but golf gets one addition this panel didn't have before:
 * `GolfPlayerStatsCard` (season strokes-gained), which used to only render
 * on the dedicated `/golf/player/[id]` route — this embedded picker is the
 * page most people actually land on, so it was silently missing the season
 * stats entirely.
 */
export interface PlayerDetailPanelProps {
  sport: Sport;
  snapshot: SportSnapshot | null;
  candidates: PickCandidate[];
  odds: UnifiedLinesResult | null;
  onAdd: (candidate: PickCandidate, odds?: { americanOdds: string; source: string; bookmaker?: string }) => void;
  addedKeys: Set<string>;
  loading?: boolean;
  /** Soccer's league or tennis's tour, so the player's history is read from the right competition. */
  league?: string;
}

/**
 * A face for a player the index lists (R10.5), so the slate-independent rows
 * are not a column of grey silhouettes. Soccer has none on ESPN's path (R9a-F1)
 * and golf is not on the index.
 */
function faceFor(sport: string, league: string | null, athleteId: string): string | null {
  if (sport === 'mlb') return mlbHeadshot(athleteId);
  if (sport === 'nfl') return espnHeadshot('nfl', athleteId);
  if (sport === 'cfb') return espnHeadshot('college-football', athleteId);
  if (sport === 'nba') return espnHeadshot('nba', athleteId);
  if (sport === 'tennis') return espnHeadshot('tennis', athleteId);
  // The NHL's mugshots need a season and a team the index row does not carry.
  void league;
  return null;
}

export function PlayerDetailPanel({ sport, snapshot, candidates, odds, onAdd, addedKeys, loading = false, league }: PlayerDetailPanelProps) {
  const [search, setSearch] = useState('');
  const [positionFilter, setPositionFilter] = useState<string | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [market, setMarket] = useState<string | undefined>(undefined);
  // C3: the rail's controls live in the URL, like every other R-track control.
  const teamColors = useTeamColors(sport, league ?? null);
  const [sort, setSort] = useUrlState('sort', 'headline', ['headline', 'name', 'markets']);
  const [propsOnly, setPropsOnly] = useUrlState('props', '0', ['0', '1']);

  /**
   * R10.5 — the sport's own players, so this tab works on a day with no games.
   * The slate still leads the list (those are the players with a game and a
   * price today, which is what the tab is for), and everyone else follows, so
   * "no games" costs a badge rather than the whole page.
   */
  const index = usePlayerIndex(sport === 'golf' ? null : sport, league ?? null);

  const candidateCountBySubject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of candidates) counts.set(c.subjectId, (counts.get(c.subjectId) ?? 0) + 1);
    return counts;
  }, [candidates]);

  // Generic over any sport that populates subjects[].meta.position (NFL
  // does; a sport that doesn't just never shows this row) — same
  // All/QB/RB/... chip pattern the Team Detail roster already uses.
  /**
   * The slate's subjects, then the index's players that are not already on it.
   * An index row carries the same shape a subject does, so everything below —
   * search, the position chips, the detail pane — reads one list and cannot
   * tell where a player came from.
   */
  const allSubjects = useMemo(() => {
    const slate = (snapshot?.subjects ?? []).map((s) => ({ subjectId: s.subjectId, subjectName: s.subjectName, statusLine: s.statusLine ?? null, headline: s.headline ?? null, matchup: s.matchup ?? null, meta: (s.meta ?? {}) as Record<string, unknown>, onSlate: true }));
    // The slate keys players by the sport's NAMESPACED id ("espn:basketball:
    // 4278073") and the index by the bare one, so they are matched on the bare
    // id — matching the raw strings listed 461 NBA players twice.
    const seen = new Set(slate.map((s) => athleteIdOf(s.subjectId)));
    const rest = (index.data?.players ?? [])
      .filter((p) => !seen.has(p.athleteId))
      .map((p) => ({
        subjectId: p.athleteId,
        subjectName: p.name,
        statusLine: null,
        headline: null,
        matchup: null,
        meta: { position: p.position ?? undefined, headshotUrl: faceFor(sport, league ?? null, p.athleteId) ?? undefined } as Record<string, unknown>,
        onSlate: false,
      }));
    return [...slate, ...rest];
  }, [snapshot, index.data, sport, league]);

  const availablePositions = useMemo(() => {
    const present = new Set<string>();
    for (const s of allSubjects) {
      const p = s.meta?.position;
      if (typeof p === 'string' && p) present.add(p);
    }
    return [...present].sort();
  }, [allSubjects]);

  const subjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = allSubjects.filter((s) => {
      if (query && !s.subjectName.toLowerCase().includes(query)) return false;
      if (positionFilter && s.meta?.position !== positionFilter) return false;
      if (propsOnly === '1' && (candidateCountBySubject.get(s.subjectId) ?? 0) === 0) return false;
      return true;
    });
    // C3: headline (default, desc), name, or markets. Players with a price
    // first on the default, so the tab leads with what it is for.
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.subjectName.localeCompare(b.subjectName);
      const ac = candidateCountBySubject.get(a.subjectId) ?? 0;
      const bc = candidateCountBySubject.get(b.subjectId) ?? 0;
      if (sort === 'markets') {
        if (ac !== bc) return bc - ac;
      } else {
        const av = a.headline ? Number.parseFloat(a.headline.value) : Number.NaN;
        const bv = b.headline ? Number.parseFloat(b.headline.value) : Number.NaN;
        const aHas = Number.isFinite(av);
        const bHas = Number.isFinite(bv);
        if (aHas !== bHas) return aHas ? -1 : 1;
        if (aHas && bHas && av !== bv) return bv - av;
      }
      if (a.onSlate !== b.onSlate) return a.onSlate ? -1 : 1;
      return a.subjectName.localeCompare(b.subjectName);
    });
  }, [allSubjects, search, positionFilter, propsOnly, sort, candidateCountBySubject]);

  const activeSubjectId = selectedSubjectId ?? subjects[0]?.subjectId ?? null;

  // NFL's scoreboard looks 14 days ahead (multiSportGameContext.ts), unlike
  // every other sport here which is "today only" — a player can genuinely
  // have real candidates for two different upcoming games at once. Scope to
  // whichever game kicks off soonest, same fix already applied to the
  // standalone /nfl/player/[playerId] route — without it, market tabs here
  // render duplicate dimension keys (two games' worth of the same markets).
  const mine = useMemo(() => {
    const all = candidates.filter((c) => c.subjectId === activeSubjectId);
    if (sport !== 'nfl' || all.length === 0) return all;
    const games = ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{ gamePk: string; firstPitch?: string }>;
    const kickoffByGamePk = new Map(games.map((g) => [String(g.gamePk), g.firstPitch]));
    const soonestGamePk = [...new Set(all.map((c) => String((c.subjectMeta as Record<string, unknown> | undefined)?.gamePk)))]
      .sort((a, b) => {
        const da = kickoffByGamePk.get(a);
        const db = kickoffByGamePk.get(b);
        if (!da || !db) return 0;
        return Date.parse(da) - Date.parse(db);
      })[0];
    return all.filter((c) => String((c.subjectMeta as Record<string, unknown> | undefined)?.gamePk) === soonestGamePk);
  }, [candidates, activeSubjectId, sport, snapshot]);
  const golfPlayerStats = useGolfPlayerStats(sport === 'golf' ? activeSubjectId : null);

  const activeSubject = allSubjects.find((s) => s.subjectId === activeSubjectId) ?? null;
  const activeMeta = (activeSubject?.meta ?? {}) as Record<string, unknown>;
  const synthetic = useSyntheticPlayerCandidates({
    sport,
    subjectId: activeSubjectId,
    team: typeof activeMeta.team === 'string' ? activeMeta.team : undefined,
    position: typeof activeMeta.position === 'string' ? activeMeta.position : undefined,
    name: activeSubject?.subjectName,
    headshotUrl: typeof activeMeta.headshotUrl === 'string' ? activeMeta.headshotUrl : undefined,
    teamLogoUrl: typeof activeMeta.teamLogoUrl === 'string' ? activeMeta.teamLogoUrl : undefined,
    tour: typeof activeMeta.tour === 'string' ? activeMeta.tour : undefined,
    league: typeof activeMeta.league === 'string' ? activeMeta.league : undefined,
    enabled: mine.length === 0 && !!activeSubjectId && SYNTHETIC_CANDIDATES_SPORTS.has(sport),
  });
  const effectiveCandidates = mine.length > 0 ? mine : synthetic.candidates;
  const waitingOnSynthetic = mine.length === 0 && synthetic.loading && SYNTHETIC_CANDIDATES_SPORTS.has(sport);

  if (loading && index.loading && allSubjects.length === 0) return <PlayerSkeleton />;

  return (
    <div className="grid gap-3 lg:grid-cols-[260px_1fr] lg:items-start">
      <div className="lb-card overflow-hidden lg:sticky lg:top-4">
        <div className="border-b border-line p-2.5">
          <Input
            type="search"
            size="sm"
            leading={SearchIcon}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players…"
            aria-label="Search players"
          />
        </div>
        {availablePositions.length > 1 ? (
          <div className="lb-scroll-x flex gap-1.5 border-b border-line p-2">
            <FilterChip active={positionFilter === null} onClick={() => setPositionFilter(null)}>All</FilterChip>
            {availablePositions.map((p) => (
              <FilterChip key={p} active={positionFilter === p} onClick={() => setPositionFilter(positionFilter === p ? null : p)}>
                {p}
              </FilterChip>
            ))}
          </div>
        ) : null}
        {/* C3: sort + a has-props toggle, both URL-backed. */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-2">
          <SegmentedToggle
            label="Sort"
            size="sm"
            value={sort}
            onChange={(v) => setSort(v as 'headline' | 'name' | 'markets')}
            options={[
              { value: 'headline', label: 'Headline' },
              { value: 'name', label: 'Name' },
              { value: 'markets', label: 'Markets' },
            ]}
          />
          <SegmentedToggle
            label="Props"
            size="sm"
            value={propsOnly}
            onChange={(v) => setPropsOnly(v as '0' | '1')}
            options={[
              { value: '0', label: 'All' },
              { value: '1', label: 'Has props' },
            ]}
          />
        </div>
        {/* U3: the kit PickList (React Aria ListBox). */}
        <PickList
          label="Players"
          className="max-h-[70vh] overflow-y-auto p-1.5"
          value={activeSubjectId ?? null}
          onChange={(id) => {
            setSelectedSubjectId(id);
            setMarket(undefined);
          }}
          empty="No players match."
          items={subjects.map((s) => {
            const count = candidateCountBySubject.get(s.subjectId) ?? 0;
            const meta = (s.meta ?? {}) as Record<string, unknown>;
            const teamLogoUrl = typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined;
            const teamAbbr = typeof meta.team === 'string' ? meta.team : null;
            const teamId = typeof meta.teamId === 'string' || typeof meta.teamId === 'number' ? meta.teamId : null;
            const color = teamColor(teamColors, { id: teamId, abbr: teamAbbr });
            return {
              key: s.subjectId,
              label: s.subjectName,
              sub: s.matchup ?? undefined,
              tag: typeof meta.position === 'string' ? <Chip tone="neutral" size="sm">{meta.position}</Chip> : undefined,
              image: (
                <span className="relative block shrink-0">
                  <SubjectAvatar
                    name={s.subjectName}
                    headshotUrl={typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined}
                    fallbackUrl={typeof (meta.flagUrl ?? meta.teamLogoUrl) === 'string' ? ((meta.flagUrl ?? meta.teamLogoUrl) as string) : undefined}
                    size={40}
                  />
                  {teamLogoUrl ? (
                    <span className="absolute -bottom-0.5 -right-0.5 grid size-[18px] place-items-center rounded-full bg-card ring-1 ring-line">
                      <TeamLogo logoUrl={teamLogoUrl} size={12} />
                    </span>
                  ) : null}
                </span>
              ),
              trailing: (
                <>
                  {s.headline ? (
                    <span className="flex items-baseline gap-1">
                      <span className="text-body-sm font-semibold tabular-nums text-ink">{s.headline.value}</span>
                      <span className="text-label font-normal text-ink-muted">{s.headline.unit}</span>
                    </span>
                  ) : null}
                  {count > 0 ? <Chip tone="good" size="sm">{count} mkts</Chip> : null}
                </>
              ),
              accent: color?.primary,
            };
          })}
        />
      </div>

      <div className="min-w-0 space-y-3 lg:[--lb-gutter:0px]">
        {!activeSubjectId ? (
          <div className="lb-card p-8 text-center text-sm text-ink-muted">
            {index.loading ? 'Loading players…' : 'No players held for this sport yet.'}
          </div>
        ) : (
          <PlayerDetail
            candidates={effectiveCandidates}
            snapshot={snapshot}
            odds={odds}
            market={market}
            onMarketChange={setMarket}
            onAdd={onAdd}
            addedKeys={addedKeys}
            subject={{ sport, id: activeSubjectId, league: league ?? null, name: activeSubject?.subjectName ?? null }}
            marketsLoading={waitingOnSynthetic}
            golfStats={
              sport === 'golf'
                ? {
                    strokesGained: golfPlayerStats.result?.strokesGained ?? null,
                    seasonLog: golfPlayerStats.result?.seasonLog ?? null,
                    advancedStats: golfPlayerStats.result?.advancedStats ?? [],
                    loading: golfPlayerStats.loading,
                  }
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

export default PlayerDetailPanel;
