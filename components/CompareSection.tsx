'use client';

import { useMemo } from 'react';
import { Avatar, Card, DataTable, EmptyState, LeagueStripRow, SelectBox, Skeleton, type Column } from './ui';
import { SplitDumbbell } from './charts';
import { formatResearchValue, type PlayerResearchData, type ResearchLogRow } from '@/lib/sports/shared/playerResearchShapes';
import type { ComparePeer, PlayerComparePayload } from '@/lib/sports/shared/compareShapes';

/**
 * Compare — R10. The page answers "how has he done"; this answers "against THIS
 * opponent", and sits directly under the prop block where G2 put it.
 *
 * TWO CARDS, FROM TWO PLACES. His games against the chosen team come from the
 * history the page already holds — no second fetch, because filtering a list by
 * `opponentId` is not worth a round trip (R10 Step 0). What that team gives up
 * to players of his kind comes from `/api/player-compare`, which is the one
 * thing the page cannot work out for itself.
 *
 * THE DUMBBELL IS THE POINT OF THE FIRST CARD. "4.1 against them" means little
 * beside nothing; "4.1 against them, 3.2 in all games" is the comparison the
 * reader came for, so each stat is a line between the two rather than two
 * columns to subtract (R9d built the primitive).
 *
 * A SMALL SAMPLE IS SAID, NOT HIDDEN. Three games against one team is three
 * games; the card prints the count beside the averages and never suppresses the
 * rows to make the number look sturdier than it is.
 */

export interface CompareSectionProps {
  research: PlayerResearchData | null;
  compare: PlayerComparePayload | null;
  loading: boolean;
  error: string | null;
  teamId: string | null;
  onTeam: (teamId: string | null) => void;
  /** R10.2 — the peer half. */
  subjectId: string | null;
  subjectName: string;
  peers: ComparePeer[];
  peerId: string | null;
  onPeer: (athleteId: string | null) => void;
  peerResearch: PlayerResearchData | null;
  peerLoading: boolean;
}

/** The stats compare lines up: the game log's own numeric columns, at most six. */
const MAX_STATS = 6;

export function CompareSection({
  research,
  compare,
  loading,
  error,
  teamId,
  onTeam,
  subjectId,
  subjectName,
  peers,
  peerId,
  onPeer,
  peerResearch,
  peerLoading,
}: CompareSectionProps) {
  const teams = compare?.teams ?? [];
  const team = teams.find((t) => t.id === teamId) ?? null;
  const rows = research?.gameLog.rows ?? [];

  const vsRows = useMemo(() => (teamId ? rows.filter((r) => r.opponentId === teamId) : []), [rows, teamId]);

  const columns = useMemo(() => (research?.gameLog.columns ?? []).filter((c) => !c.text).slice(0, MAX_STATS), [research]);

  const dumbbell = useMemo(() => {
    if (!vsRows.length) return [];
    const mean = (list: ResearchLogRow[], key: string) => {
      const nums = list.map((r) => r.values[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    };
    return columns.map((c) => ({
      key: c.key,
      label: c.label,
      a: mean(vsRows, c.key),
      b: mean(rows, c.key),
      aSample: vsRows.length,
      bSample: rows.length,
      format: (v: number) => formatResearchValue(v, c),
    }));
  }, [columns, rows, vsRows]);

  const logColumns: Column<ResearchLogRow>[] = useMemo(
    () => [
      {
        key: 'date',
        label: 'Date',
        sortValue: (r) => r.date,
        render: (r) => new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
      },
      {
        key: 'result',
        label: 'Result',
        sortable: false,
        render: (r) =>
          r.result ? (
            <span className={r.result === 'W' ? 'font-semibold text-good' : r.result === 'L' ? 'font-semibold text-bad' : 'font-semibold text-ink-secondary'}>
              {r.result}
              {r.score ? ` ${r.score}` : ''}
            </span>
          ) : (
            '—'
          ),
      },
      ...columns.map((c) => ({
        key: c.key,
        label: c.label,
        numeric: true,
        title: c.info,
        render: (r: ResearchLogRow) => formatResearchValue(r.values[c.key], c),
        sortValue: (r: ResearchLogRow) => (typeof r.values[c.key] === 'number' ? (r.values[c.key] as number) : null),
      })),
    ],
    [columns],
  );

  if (error) {
    return <Card title="Compare" state={{ kind: 'error', message: error, onRetry: () => onTeam(teamId) }} />;
  }

  const picker = (
    <div className="flex flex-wrap items-center gap-2">
      <SelectBox
        label="Opponent"
        value={teamId ?? ''}
        onChange={(v) => onTeam(v || null)}
        options={[{ value: '', label: loading && !teams.length ? 'Loading teams…' : 'Pick an opponent' }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
      />
      {team ? (
        <span className="flex items-center gap-1.5 text-body-sm text-ink-secondary">
          {team.logoUrl ? <Avatar kind="logo" label={team.name} src={team.logoUrl} size={20} decorative /> : null}
          {vsRows.length ? `${vsRows.length} ${vsRows.length === 1 ? 'game' : 'games'} held against them` : 'no games held against them'}
        </span>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-3">
      {picker}
      {!teamId ? (
        <Card title="Compare" >
          <EmptyState title="Pick an opponent" reason="Choose a team to see this player's games against them and what that team gives up to players in his position." />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card
            title={`Against ${team?.abbr ?? 'them'}`}
            scope={vsRows.length ? `${vsRows.length} of ${rows.length} games held` : undefined}
            caption={vsRows.length ? 'Each line runs from the average against this team to the average across every game held.' : undefined}
            state={vsRows.length ? { kind: 'ready' } : { kind: 'empty', title: 'No games held against them', reason: 'The history this app holds has no game between these two.' }}
          >
            {dumbbell.length ? <SplitDumbbell rows={dumbbell} aLabel={`vs ${team?.abbr ?? 'them'}`} bLabel="All games" label="Against this team" /> : null}
            {vsRows.length ? (
              <DataTable
                className="mt-3"
                caption={`Games against ${team?.name ?? 'this team'}`}
                columns={logColumns}
                rows={[...vsRows].reverse()}
                rowKey={(r) => r.eventId}
                dense
                maxHeight={320}
              />
            ) : null}
          </Card>
          <AllowCardView compare={compare} loading={loading} teamAbbr={team?.abbr ?? null} />
        </div>
      )}
      <PeerCompare
        research={research}
        subjectId={subjectId}
        subjectName={subjectName}
        peers={peers}
        peerId={peerId}
        onPeer={onPeer}
        peerResearch={peerResearch}
        peerLoading={peerLoading}
      />
    </div>
  );
}

/**
 * The player against one of his own kind — R10.2. Seasons side by side, then
 * both careers on one axis.
 *
 * THE PEER LIST IS THE LEAGUE'S PRODUCERS IN HIS POSITION GROUP, named by the
 * server because the history table holds no names. A peer the app cannot name
 * is not offered at all, which is why the list can be shorter than the rollup.
 */
function PeerCompare({
  research,
  subjectId,
  subjectName,
  peers,
  peerId,
  onPeer,
  peerResearch,
  peerLoading,
}: {
  research: PlayerResearchData | null;
  subjectId: string | null;
  subjectName: string;
  peers: ComparePeer[];
  peerId: string | null;
  onPeer: (id: string | null) => void;
  peerResearch: PlayerResearchData | null;
  peerLoading: boolean;
}) {
  // The list is cached per position group, so it is shared by every guard in
  // the league — including this one, who is filtered out here rather than in
  // the cached answer.
  const others = useMemo(() => peers.filter((p) => p.athleteId !== subjectId), [peers, subjectId]);
  const peer = others.find((p) => p.athleteId === peerId) ?? null;
  const mineSeasons = research?.seasons.rows ?? [];
  const theirs = peerResearch?.seasons.rows ?? [];
  const columns = (research?.seasons.columns ?? []).filter((c) => !c.text).slice(0, MAX_STATS);

  // The newest season both players have, which is the only one worth lining up.
  const shared = useMemo(() => {
    const theirSeasons = new Set(theirs.map((r) => r.season));
    return mineSeasons.filter((r) => theirSeasons.has(r.season)).sort((a, b) => b.season - a.season)[0] ?? null;
  }, [mineSeasons, theirs]);
  const theirRow = shared ? theirs.find((r) => r.season === shared.season) ?? null : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SelectBox
          label="Compare with"
          value={peerId ?? ''}
          onChange={(v) => onPeer(v || null)}
          options={[
            { value: '', label: others.length ? 'Pick a player' : 'No comparable players held' },
            ...others.map((p) => ({ value: p.athleteId, label: `${p.name}${p.position ? ` · ${p.position}` : ''}` })),
          ]}
        />
        {peer ? <span className="text-body-sm text-ink-secondary">{peer.games} games held this season</span> : null}
      </div>
      {peerId ? (
        <Card
          title={`${subjectName} vs ${peer?.name ?? 'peer'}`}
          scope={shared ? `${shared.label} · per game` : undefined}
          caption={shared ? 'Each line runs from this player’s number to the compared player’s.' : undefined}
          state={
            peerLoading && !peerResearch
              ? { kind: 'loading', lines: 4 }
              : theirRow && shared
                ? { kind: 'ready' }
                : {
                    kind: 'empty',
                    title: 'No season both players have',
                    reason: 'The app holds no season where both of these players played, so there is nothing to line up.',
                  }
          }
        >
          {theirRow && shared ? (
            <SplitDumbbell
              rows={columns.map((c) => ({
                key: c.key,
                label: c.label,
                a: typeof shared.values[c.key] === 'number' ? (shared.values[c.key] as number) : null,
                b: typeof theirRow.values[c.key] === 'number' ? (theirRow.values[c.key] as number) : null,
                aSample: shared.games,
                bSample: theirRow.games,
                format: (v: number) => formatResearchValue(v, c),
              }))}
              aLabel={subjectName}
              bLabel={peer?.name ?? 'Peer'}
              label="Season side by side"
            />
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function AllowCardView({ compare, loading, teamAbbr }: { compare: PlayerComparePayload | null; loading: boolean; teamAbbr: string | null }) {
  if (loading && !compare?.allow) {
    return (
      <Card title="What they give up">
        <Skeleton w="100%" h={120} />
      </Card>
    );
  }
  const allow = compare?.allow ?? null;
  if (!allow) {
    return (
      <Card
        title="What they give up"
        state={{
          kind: 'empty',
          title: 'No rollup for this player’s position',
          // Said plainly rather than blamed on "no data": MLB and CFB hold no
          // position groups at all (R10 Step 0), and an early season can hold
          // too few games for a team to rank.
          reason: compare?.group
            ? 'The rollup holds no season with enough games for this team, in this player’s position group.'
            : 'This app holds no position for this player, so it cannot say what a defence gives up to his kind.',
        }}
      />
    );
  }
  return (
    <Card
      title={`What ${teamAbbr ?? 'they'} give up ${allow.title}`}
      scope={`per game, league rank · ${allow.season} · ${allow.games} games`}
      info="From this app’s own game logs, rolled up by opponent and by the scoring player’s position where the league has one."
      caption={allow.note ?? undefined}
    >
      <div className="space-y-0.5">
        {allow.rows.map((r) =>
          r.value == null ? null : (
            <LeagueStripRow
              key={r.key}
              label={`${r.label} / game`}
              valueText={formatResearchValue(r.value, { decimals: r.value < 10 ? 2 : 1 })}
              league={r.league}
              value={r.value}
              rank={{ rank: r.rank, of: r.of }}
              direction="neutral"
            />
          ),
        )}
      </div>
    </Card>
  );
}
