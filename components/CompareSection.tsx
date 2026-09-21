'use client';

import { useMemo, useState } from 'react';
import { Avatar, Card, ComboBox, DataTable, EmptyState, LeagueStripRow, SelectBox, Skeleton, Tag, type Column } from './ui';
import { formatResearchValue, type PlayerResearchData, type ResearchCard, type ResearchLogRow } from '@/lib/sports/shared/playerResearchShapes';
import { ResearchCardView } from './PlayerResearchSections';
import { CompareView, type CompareViewRow } from './CompareView';
import { searchPeers, type ComparePeer, type PlayerComparePayload } from '@/lib/sports/shared/compareShapes';

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
 * THE COMPARISON IS THE POINT OF THE FIRST CARD. "4.1 against them" means
 * little beside nothing; "4.1 against them, 3.2 in all games" is what the reader
 * came for. It opens as a table with the gap, and can switch to paired bars or
 * the dumbbell (R10.6's `CompareView`) — the dumbbell alone was hard to read.
 * The stats are the spec's SPLIT columns (rates and per-game numbers), not the
 * first raw counts of the game log, which mostly measured playing time.
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
  /** The list is last season's: early in a season nobody has reached the floor. */
  peersLastSeason?: boolean;
  peerId: string | null;
  onPeer: (athleteId: string | null) => void;
  peerResearch: PlayerResearchData | null;
  peerLoading: boolean;
  /**
   * The sport's own compare cards, built by the page from the hooks it already
   * runs (R10.4). A named slot rather than a `sport === 'nba'` branch in here.
   */
  extras?: ResearchCard[];
  /**
   * False for a sport with no teams and no rollups (tennis): the team half is
   * hidden, the picker lists named opponents, and the sport's own cards carry
   * the comparison (R10.4d).
   */
  teamCompare?: boolean;
  /** What the peer picker is choosing ("Compare with", "Opponent faced"). */
  peerLabel?: string;
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
  peersLastSeason = false,
  peerId,
  onPeer,
  peerResearch,
  peerLoading,
  extras = [],
  teamCompare = true,
  peerLabel = 'Compare with',
}: CompareSectionProps) {
  const teams = compare?.teams ?? [];
  const team = teams.find((t) => t.id === teamId) ?? null;
  const rows = research?.gameLog.rows ?? [];

  const vsRows = useMemo(() => (teamId ? rows.filter((r) => r.opponentId === teamId) : []), [rows, teamId]);

  // The game log's columns for the meetings table below the comparison.
  const columns = useMemo(() => (research?.gameLog.columns ?? []).filter((c) => !c.text).slice(0, MAX_STATS), [research]);

  /**
   * R10.6 — the comparison reads the SPLITS, not the game log. The splits carry
   * the stats a sport's spec chose for comparing (rates and per-game numbers:
   * AVG, OBP, SLG, HR/G for a hitter), where the first six game-log columns were
   * raw counts that mostly measured playing time. The "all seasons" set (key 0)
   * is used where the history spans more than one, so "against them" is every
   * meeting held, not one season's.
   */
  const againstRows = useMemo<CompareViewRow[]>(() => {
    if (!research || !teamId) return [];
    const bySeason = research.splits.rowsBySeason;
    const set = bySeason[0] ?? bySeason[research.splits.defaultSeason ?? -1] ?? Object.values(bySeason)[0] ?? [];
    const vs = set.find((r) => r.key === `Opponent:${teamId}`);
    const all = set.find((r) => r.group === 'Overall');
    if (!vs || !all) return [];
    return research.splits.columns.map((c) => ({
      key: c.key,
      label: c.label,
      a: vs.values[c.key] ?? null,
      b: all.values[c.key] ?? null,
      aSample: vs.games,
      bSample: all.games,
      format: (v: number) => formatResearchValue(v, c),
    }));
  }, [research, teamId]);

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
      {teamCompare ? picker : null}
      {!teamCompare ? null : !teamId ? (
        <Card title="Compare" >
          <EmptyState title="Pick an opponent" reason="Choose a team to see this player's games against them and what that team gives up to players in his position." />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card
            title={`Against ${team?.abbr ?? 'them'}`}
            scope={vsRows.length ? `${vsRows.length} of ${rows.length} games held` : undefined}
            caption={vsRows.length ? 'Per game, against this team and across every game held.' : undefined}
            state={vsRows.length ? { kind: 'ready' } : { kind: 'empty', title: 'No games held against them', reason: 'The history this app holds has no game between these two.' }}
          >
            {againstRows.length ? <CompareView rows={againstRows} aLabel={`vs ${team?.abbr ?? 'them'}`} bLabel="All games" label="Against this team" /> : null}
            {vsRows.length ? (
              <DataTable
                className="mt-3"
                caption={`Games against ${team?.name ?? 'this team'}`}
                columns={logColumns}
                rows={[...vsRows].reverse()}
                rowKey={(r) => r.eventId}
                maxHeight={320}
              />
            ) : null}
          </Card>
          <AllowCardView compare={compare} loading={loading} teamAbbr={team?.abbr ?? null} />
        </div>
      )}
      {(teamId || !teamCompare) && extras.length ? (
        <div className="grid gap-3">
          {extras.map((card) => (
            <ResearchCardView key={card.key} card={card} />
          ))}
        </div>
      ) : null}
      <PeerCompare
        research={research}
        subjectId={subjectId}
        subjectName={subjectName}
        peers={peers}
        lastSeason={peersLastSeason}
        peerId={peerId}
        onPeer={onPeer}
        peerResearch={peerResearch}
        peerLoading={peerLoading}
        seasonsCard={teamCompare}
        label={peerLabel}
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
  lastSeason,
  peerId,
  onPeer,
  peerResearch,
  peerLoading,
  seasonsCard,
  label,
}: {
  research: PlayerResearchData | null;
  subjectId: string | null;
  subjectName: string;
  peers: ComparePeer[];
  lastSeason: boolean;
  peerId: string | null;
  onPeer: (id: string | null) => void;
  peerResearch: PlayerResearchData | null;
  peerLoading: boolean;
  /** Tennis compares from its own archive cards, not the shared season rows. */
  seasonsCard: boolean;
  label: string;
}) {
  // The list is cached per position group, so it is shared by every guard in
  // the league — including this one, who is filtered out here rather than in
  // the cached answer.
  const others = useMemo(() => peers.filter((p) => p.athleteId !== subjectId), [peers, subjectId]);
  const peer = others.find((p) => p.athleteId === peerId) ?? null;
  const [query, setQuery] = useState('');
  const shown = useMemo(() => searchPeers(others, query, peerId), [others, query, peerId]);
  // Matches other than the one already picked: what the search actually found.
  const found = shown.filter((p) => p.athleteId !== peerId);
  const mineSeasons = research?.seasons.rows ?? [];
  const theirs = peerResearch?.seasons.rows ?? [];
  const columns = (research?.seasons.columns ?? []).filter((c) => !c.text).slice(0, MAX_STATS);

  // The page's own scope season where both players have it — early in a season
  // that is last season, as every other section opens (without it an NFL page
  // in week 2 lined up one game against one) — else the newest season both have.
  const scopeSeason = research?.splits.defaultSeason ?? null;
  const shared = useMemo(() => {
    const theirSeasons = new Set(theirs.map((r) => r.season));
    const both = mineSeasons.filter((r) => theirSeasons.has(r.season)).sort((a, b) => b.season - a.season);
    return both.find((r) => r.season === scopeSeason) ?? both[0] ?? null;
  }, [mineSeasons, theirs, scopeSeason]);
  const theirRow = shared ? theirs.find((r) => r.season === shared.season) ?? null : null;

  // R10.6 — each player's Overall split for that season: the spec's rate and
  // per-game columns, so two players are compared per opportunity, not on how
  // much each happened to play.
  const peerRows = useMemo<CompareViewRow[]>(() => {
    if (!shared || !research || !peerResearch) return [];
    const mine = research.splits.rowsBySeason[shared.season]?.find((r) => r.group === 'Overall');
    const their = peerResearch.splits.rowsBySeason[shared.season]?.find((r) => r.group === 'Overall');
    if (!mine || !their) return [];
    return research.splits.columns.map((c) => ({
      key: c.key,
      label: c.label,
      a: mine.values[c.key] ?? null,
      b: their.values[c.key] ?? null,
      aSample: mine.games,
      bSample: their.games,
      format: (v: number) => formatResearchValue(v, c),
    }));
  }, [shared, research, peerResearch]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* U3: one ComboBox where a search box sat beside a select of its
            results. It filters as you type (the same `searchPeers` ranking),
            Enter or a click picks, and the pick shows as a removable Tag. */}
        {others.length ? (
          <ComboBox
            label={`Search ${label.toLowerCase()} players`}
            placeholder={`Search ${others.length} players…`}
            className="w-60 max-w-full"
            size="sm"
            inputValue={query}
            onInputChange={setQuery}
            onPick={(id) => {
              onPeer(id);
              setQuery('');
            }}
            options={found.map((p) => ({ value: p.athleteId, label: p.name, sub: p.position || undefined }))}
          />
        ) : (
          <span className="text-body-sm text-ink-muted">No comparable players held</span>
        )}
        {peer ? <Tag label={peer.name} onRemove={() => onPeer(null)} /> : null}
        {peer ? <span className="text-body-sm text-ink-secondary">{peer.games} games held {lastSeason ? 'last season' : 'this season'}</span> : null}
      </div>
      {peerId && seasonsCard ? (
        <Card
          title={`${subjectName} vs ${peer?.name ?? 'peer'}`}
          scope={shared ? `${shared.label} · per game` : undefined}
          caption={shared ? `${shared.games} and ${theirRow?.games ?? '—'} games · per game and rate stats, so playing time does not decide it.` : undefined}
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
          {peerRows.length ? <CompareView rows={peerRows} aLabel={subjectName} bLabel={peer?.name ?? 'Peer'} label="Season side by side" /> : null}
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
