'use client';

import { useMemo } from 'react';
import { Avatar, Card, DataTable, EmptyState, SelectBox, Skeleton, type Column } from './ui';
import { SplitDumbbell } from './charts';
import { formatResearchValue } from '@/lib/sports/shared/playerResearchShapes';
import type { TeamGame, TeamResearchPayload, TeamSeasonData, TeamStatValue } from '@/lib/sports/shared/teamResearchShapes';

/**
 * Team against team — R10.3, the first section on a team page.
 *
 * IT COSTS NO NEW SERVER WORK. The page's own payload already carries this
 * team's per-game stats WITH every team's value behind them (`TeamStatValue.
 * league`), its schedule and its roster; the other team's arrives from the same
 * `/api/team-research` the page itself uses. So the compare is two payloads and
 * arithmetic, not a third endpoint — the opposite of what the old matchup card
 * did.
 *
 * THE PICKER IS THE LEAGUE'S OWN STANDINGS, which the payload already lists, so
 * a team the app cannot render is never offered.
 *
 * WHAT IT SHOWS: the two teams' stats as a line each (a dumbbell, so the gap is
 * the point), the games between them from this team's own schedule, and each
 * side's top producers. Stats are matched by KEY, so a sport whose two teams
 * somehow carry different cards shows only what both have rather than inventing
 * a blank row.
 */

export interface TeamCompareSectionProps {
  payload: TeamResearchPayload;
  /** Every team in the sport's rollup; falls back to the standings when empty. */
  allTeams: Array<{ id: string; name: string; logoUrl: string | null }>;
  /** The season the page's own switch is on, so both sides read the same one. */
  season: number;
  /** The other team's payload; `null` until it lands, or when none is chosen. */
  other: TeamResearchPayload | null;
  otherLoading: boolean;
  vsTeamId: string | null;
  onTeam: (teamId: string | null) => void;
}

/** The chosen season's data, or the newest the payload holds. */
function seasonOf(payload: TeamResearchPayload | null, season: number): TeamSeasonData | null {
  if (!payload) return null;
  return payload.seasons.find((s) => s.season === season) ?? payload.seasons[0] ?? null;
}

/** Teams the payload can name, from the standings tables it already holds. */
function leagueTeams(data: TeamSeasonData | null): Array<{ id: string; name: string; logoUrl: string | null }> {
  const seen = new Map<string, { id: string; name: string; logoUrl: string | null }>();
  for (const table of data?.standings ?? []) {
    for (const row of table.rows) {
      const id = String(row.team.id);
      if (!seen.has(id)) seen.set(id, { id, name: row.team.name, logoUrl: row.team.logoUrl ?? null });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function TeamCompareSection({ payload, allTeams, season, other, otherLoading, vsTeamId, onTeam }: TeamCompareSectionProps) {
  const mineSeason = useMemo(() => seasonOf(payload, season), [payload, season]);
  const theirSeason = useMemo(() => seasonOf(other, season), [other, season]);
  // The rollup's list covers the whole sport; the standings only cover this
  // team's own league, so they are the fallback rather than the source.
  const teams = useMemo(
    () => (allTeams.length ? allTeams : leagueTeams(mineSeason)).filter((t) => t.id !== String(payload.team.id)),
    [allTeams, mineSeason, payload.team.id],
  );
  const picked = teams.find((t) => t.id === vsTeamId) ?? null;

  const mine = mineSeason?.stats ?? [];
  const theirs = theirSeason?.stats ?? [];

  const rows = useMemo(() => {
    if (!theirs.length) return [];
    const byKey = new Map<string, TeamStatValue>(theirs.map((s) => [s.key, s]));
    return mine
      .filter((s) => byKey.has(s.key))
      .map((s) => {
        const t = byKey.get(s.key)!;
        return {
          key: s.key,
          label: s.label,
          a: s.value,
          b: t.value,
          lowerIsBetter: s.direction === 'lower',
          format: (v: number) => formatResearchValue(v, { decimals: s.decimals, format: s.format }),
        };
      });
  }, [mine, theirs]);

  const meetings = useMemo(
    () => (vsTeamId ? (mineSeason?.games ?? []).filter((g) => String(g.opponent.id) === vsTeamId && g.us != null && g.them != null) : []),
    [mineSeason, vsTeamId],
  );

  const meetingColumns: Column<TeamGame>[] = [
    {
      key: 'date',
      label: 'Date',
      sortValue: (g) => g.date,
      render: (g) => new Date(`${g.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    },
    { key: 'at', label: 'At', sortable: false, render: (g) => (g.neutral ? 'Neutral' : g.home ? 'Home' : 'Away') },
    {
      key: 'score',
      label: 'Score',
      sortable: false,
      render: (g) => {
        const won = (g.us ?? 0) > (g.them ?? 0);
        return <span className={won ? 'font-semibold text-good' : 'font-semibold text-bad'}>{`${g.us}–${g.them}`}</span>;
      },
    },
  ];

  const topFive = (d: TeamSeasonData | null) => (d?.roster ?? []).slice(0, 5);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SelectBox
          label="Compare with"
          value={vsTeamId ?? ''}
          onChange={(v) => onTeam(v || null)}
          options={[{ value: '', label: 'Pick a team' }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
        />
        {picked?.logoUrl ? <Avatar kind="logo" label={picked.name} src={picked.logoUrl} size={22} decorative /> : null}
        {picked && meetings.length ? (
          <span className="text-body-sm text-ink-secondary">
            {meetings.filter((g) => (g.us ?? 0) > (g.them ?? 0)).length}-{meetings.filter((g) => (g.us ?? 0) < (g.them ?? 0)).length} against them this season
          </span>
        ) : null}
      </div>
      {!vsTeamId ? (
        <Card title="Team vs team">
          <EmptyState title="Pick a team" reason="Choose an opponent to line up both sides' per-game stats, the games between them and each side's top producers." />
        </Card>
      ) : otherLoading && !other ? (
        <Card title="Team vs team">
          <Skeleton w="100%" h={160} />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card
            title={`${payload.team.abbr} vs ${other?.team.abbr ?? picked?.name ?? ''}`}
            scope="per game, this season"
            caption="Each line runs from this team's number to the other's. A stat where lower is better is coloured that way."
            state={rows.length ? { kind: 'ready' } : { kind: 'empty', title: 'No stats both teams carry', reason: 'The two pages hold no stat in common for this season.' }}
          >
            {rows.length ? <SplitDumbbell rows={rows} aLabel={payload.team.abbr} bLabel={other?.team.abbr ?? 'Them'} label="Team stats side by side" /> : null}
          </Card>
          <div className="space-y-3">
            <Card
              title="Head to head"
              scope="this season's meetings"
              state={meetings.length ? { kind: 'ready' } : { kind: 'empty', title: 'No meetings this season', reason: 'The league schedule holds no completed game between these two in this season.' }}
            >
              {meetings.length ? (
                <DataTable caption="Meetings" columns={meetingColumns} rows={meetings} rowKey={(g) => g.id} dense maxHeight={220} />
              ) : null}
            </Card>
            <Card title="Top producers" scope="by the season production score" state={topFive(theirSeason).length ? { kind: 'ready' } : { kind: 'loading', lines: 3 }}>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { side: mineSeason, label: payload.team.abbr },
                  { side: theirSeason, label: other?.team.abbr ?? picked?.name ?? '' },
                ].map(({ side, label }) => (
                  <div key={label}>
                    <div className="text-overline uppercase text-ink-muted">{label}</div>
                    <ul className="mt-1 space-y-1">
                      {topFive(side).map((p) => (
                        <li key={p.id} className="flex items-center gap-2 text-body-sm text-ink">
                          {p.headshotUrl ? <Avatar kind="player" label={p.name} src={p.headshotUrl} size={20} decorative /> : null}
                          <span className="truncate">{p.name}</span>
                          <span className="ml-auto shrink-0 text-label text-ink-muted">{p.games} g</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
