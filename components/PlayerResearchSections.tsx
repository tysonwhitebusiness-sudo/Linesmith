'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { Avatar, Card, Chip, cx, DataTable, EmptyState, ErrorState, LeagueStripRow, RankRow, SegmentedToggle, SelectBox, Skeleton, VizLegend, type CardState, type Column } from './ui';
import { CATEGORICAL, CourtScatter, FieldLanes, FieldScatter, FullPitchScatter, Histogram, MatchTimeline, PitchScatter, RinkScatter, SeriesChart, SIDE_COLOR, SplitDumbbell, SprayScatter, StreakStrip, ZoneScatter } from './charts';
import { SpatialSurface } from './charts/SpatialSurface';
import {
  formatResearchValue,
  type PlayerBio,
  type PlayerResearchData,
  type ResearchCard,
  type ResearchColumn,
  type ResearchLogRow,
  type ResearchSection,
  type ResearchSeasonRow,
  type ResearchSplitRow,
} from '@/lib/sports/shared/playerResearchShapes';

/**
 * The player page's shared research sections — R6.1a. Every sport renders
 * these same components from its adapter's `PlayerResearchData`; none of them
 * knows which sport it is showing. Each takes its own load state, so a slow or
 * failed history never blanks the hero, and a missing bio never blanks the
 * history (plan §1 row 2).
 */

export interface LoadState {
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function cardState(state: LoadState, hasData: boolean, empty: { title: string; reason: string }, lines = 4): CardState {
  if (state.loading && !hasData) return { kind: 'loading', lines };
  if (state.error) return { kind: 'error', message: state.error, onRetry: state.reload, keepBody: hasData };
  if (!hasData) return { kind: 'empty', ...empty };
  return { kind: 'ready' };
}

const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function valueColumns<Row extends { values: Record<string, number | string | null> }>(cols: ResearchColumn[]): Column<Row>[] {
  return cols.map((c) => ({
    key: c.key,
    label: c.label,
    numeric: true,
    title: c.info,
    render: (r: Row) => formatResearchValue(r.values[c.key], c),
    sortValue: (r: Row) => {
      const v = r.values[c.key];
      return typeof v === 'number' ? v : null;
    },
  }));
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

export interface PlayerHeroProps {
  bio: PlayerBio | null;
  bioState: LoadState;
  research: PlayerResearchData | null;
  researchState: LoadState;
  /** What to call the player before the bio lands, or when the league does not know the id. */
  fallbackName: string | null;
  teamHref: string | null;
  /** "@ MIN · 6:40 PM · Scheduled", from today's candidate when there is one. */
  nextGame: ReactNode;
}

/**
 * The hero — R6.3 rework (mockup `docs/design/hero-live/index.html`, variant C5).
 *
 * WHAT WAS WRONG, MEASURED at 1440 on 2026-09-15: the card was 1416 x 332 with a
 * 448px fact list at one edge, a 220px season block at the other and ~700px of
 * nothing between them, because the facts were a label-left / value-right list
 * inside a narrow column. The tile strip then ran 11 wide and wrapped to 10 + 1
 * at the width the operator actually uses.
 *
 * So: the headshot sits with the name and team, the facts run the FULL width of
 * the left block beneath them as label-above-value cells, and the season panel
 * is a real right-hand column with the record and the last five games. The tiles
 * sit on a fixed grid (6 / 4 / 3) so a row is never left with one orphan.
 */
export function PlayerHero({ bio, bioState, research, researchState, fallbackName, teamHref, nextGame }: PlayerHeroProps) {
  const name = bio?.name ?? fallbackName;
  const facts: Array<[string, string]> = [
    ...(bio?.age != null ? [['Age', String(bio.age)] as [string, string]] : []),
    ...(bio?.facts ?? []).map((f) => [f.label, f.value] as [string, string]),
  ];
  const hero = research?.hero;
  return (
    <section aria-label={name ?? 'Player'} className="rounded-card-hero border border-line-soft bg-card p-5 shadow-card">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <div className="flex items-start gap-4">
            {bioState.loading && !bio ? (
              <Skeleton w={76} h={76} round="rounded-xl" />
            ) : (
              <Avatar label={name ?? 'Player'} src={bio?.headshotUrl ?? undefined} fallbackSrc={bio?.team?.logoUrl ?? undefined} size={76} rounded />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-heading text-ink">{name ?? (bioState.loading ? <Skeleton w={180} h={22} /> : 'Unknown player')}</h1>
                {bio?.jersey ? <Chip>#{bio.jersey}</Chip> : null}
                {bio?.positionAbbr || bio?.position ? <Chip>{bio.positionAbbr ?? bio.position}</Chip> : null}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-ink-secondary">
                {bio?.team ? (
                  <>
                    {bio.team.logoUrl ? <Avatar kind="logo" label={bio.team.name ?? 'Team'} src={bio.team.logoUrl} size={22} decorative /> : null}
                    {teamHref ? (
                      <Link href={teamHref} className="font-medium text-ink underline-offset-2 hover:underline">
                        {bio.team.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">{bio.team.name}</span>
                    )}
                  </>
                ) : null}
                {nextGame}
              </div>
              {bio?.injury ? (
                <div role="status" className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-ctl border border-bad/25 bg-bad/5 px-2.5 py-1 text-body-sm text-ink">
                  <span className="font-semibold text-bad">{bio.injury.status}</span>
                  {bio.injury.detail ? <span>{bio.injury.detail}</span> : null}
                  {bio.injury.returnDate ? <span className="text-ink-muted">· expected back {shortDate(bio.injury.returnDate)}</span> : null}
                  {bio.injury.date ? <span className="text-ink-muted">· reported {shortDate(bio.injury.date)}</span> : null}
                </div>
              ) : null}
            </div>
          </div>
          {facts.length ? (
            <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
              {facts.map(([label, value]) => (
                // A long value (a birthplace) takes two cells rather than
                // wrapping its own row and dragging the grid taller.
                <div key={label} className={value.length > 34 ? 'col-span-2' : undefined}>
                  <dt className="text-overline uppercase text-ink-muted">{label}</dt>
                  <dd className="mt-0.5 text-body-sm tabular-nums text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {bioState.error && !bio ? <ErrorState className="mt-3" message={bioState.error} onRetry={bioState.reload} /> : null}
        </div>

        <div className="lg:border-l lg:border-line-soft lg:pl-5">
          {hero ? (
            <>
              <div className="text-overline uppercase text-ink-muted">{hero.scopeLabel}</div>
              <div className="mt-0.5 text-title text-ink">
                {hero.games} {hero.games === 1 ? (hero.unit?.one ?? 'game') : (hero.unit?.many ?? 'games')}
              </div>
              {hero.record ? <div className="text-label text-ink-secondary">{hero.record} in games played</div> : null}
              {hero.scopeReason ? <div className="mt-0.5 text-label text-ink-muted">{hero.scopeReason}</div> : null}
              {hero.lastFive.length ? (
                <>
                  <div className="mt-3 text-overline uppercase text-ink-muted">Last {hero.lastFive.length}</div>
                  <div className="mt-1 flex gap-1">
                    {hero.lastFive.map((g) => (
                      <span
                        key={(g.date ?? '') + g.opponent}
                        title={`${g.date ? `${shortDate(g.date)} ` : ''}${g.opponent}${g.result ? ` · ${g.result}` : g.mark ? ` · ${g.mark}` : ''}`}
                        className={cx(
                          // A mark ("-4") can be two characters, so the chip grows rather than clips.
                          'grid h-6 min-w-6 place-items-center rounded-ctl px-1 text-label font-semibold tabular-nums',
                          g.result === 'W' || g.tone === 'good'
                            ? 'bg-good/12 text-good'
                            : g.result === 'L' || g.tone === 'bad'
                              ? 'bg-bad/10 text-bad'
                              : 'bg-card-sunk text-ink-secondary',
                        )}
                      >
                        {g.result ?? g.mark ?? '·'}
                      </span>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          ) : researchState.loading ? (
            <Skeleton w={160} h={14} />
          ) : null}
        </div>
      </div>

      {hero && hero.tiles.length ? (
        <dl className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3 border-t border-line-soft pt-4 sm:grid-cols-4 lg:grid-cols-6">
          {hero.tiles.map((t) => (
            <div key={t.label} title={t.info}>
              <dt className="text-overline uppercase text-ink-muted">{t.label}</dt>
              <dd className="mt-0.5 text-title tabular-nums text-ink">{t.value}</dd>
            </div>
          ))}
        </dl>
      ) : researchState.loading ? (
        <div className="mt-4 border-t border-line-soft pt-4">
          <Skeleton h={40} />
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

export function SeasonsCard({ research, state }: { research: PlayerResearchData | null; state: LoadState }) {
  const rows = research?.seasons.rows ?? [];
  const held = rows.find((r) => r.season === 0)?.games ?? rows.reduce((s, r) => s + r.games, 0);
  const columns: Column<ResearchSeasonRow>[] = [
    { key: 'label', label: 'Season', sortable: false },
    { key: 'games', label: 'GP', numeric: true, sortable: false },
    ...valueColumns<ResearchSeasonRow>(research?.seasons.columns ?? []).map((c) => ({ ...c, sortable: false })),
  ];
  return (
    <Card
      title="Season stats"
      scope={research ? `${held} games held` : undefined}
      dense
      state={cardState(state, rows.length > 0, { title: 'No games held for this player', reason: 'The history table has no box scores under this id — a player new to the league, or one the history jobs do not cover.' })}
      caption="Totals and per-game rates from every game held. The last row is every season together."
    >
      <DataTable caption="Season by season" columns={columns} rows={rows} rowKey={(r) => String(r.season)} dense />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

function rolling(values: Array<number | null>, w: number): number[] {
  return values.map((_, i) => {
    if (i + 1 < Math.min(w, 3)) return NaN;
    const win = values.slice(Math.max(0, i - w + 1), i + 1).filter((v): v is number => v != null);
    return win.length ? win.reduce((a, b) => a + b, 0) / win.length : NaN;
  });
}

export function TrendsCard({ research, state }: { research: PlayerResearchData | null; state: LoadState }) {
  const stats = research?.trends.stats ?? [];
  const [key, setKey] = useState<string | null>(null);
  const [win, setWin] = useState<3 | 5 | 10>(5);
  const [scope, setScope] = useState<'season' | 'last2' | 'all'>('last2');
  const stat = stats.find((s) => s.key === key) ?? stats[0];

  const points = useMemo(() => {
    if (!stat) return [];
    const newest = Math.max(...stat.points.map((p) => p.season));
    return stat.points.filter((p) => (scope === 'all' ? true : scope === 'season' ? p.season === newest : p.season >= newest - 1));
  }, [stat, scope]);
  const raw = points.map((p) => p.value);
  const avg = rolling(raw, win);
  const fmt = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : formatResearchValue(v, { decimals: stat?.decimals ?? 0 }));

  const controls = stat ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <SelectBox label="Stat" value={stat.key} onChange={setKey} options={stats.map((s) => ({ value: s.key, label: s.label }))} />
      <SegmentedToggle label="Rolling average" size="sm" value={win} onChange={setWin} options={[{ value: 3, label: '3' }, { value: 5, label: '5' }, { value: 10, label: '10' }]} />
      <SegmentedToggle
        label="Games in scope"
        size="sm"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'season', label: 'This season' },
          { value: 'last2', label: 'Last 2' },
          { value: 'all', label: 'All held' },
        ]}
      />
    </div>
  ) : undefined;

  return (
    <Card
      title="Trends"
      scope={controls}
      info="Pick a stat. The grey line is each game; the dark line is the rolling average over the chosen number of games. Hover for the game."
      state={cardState(state, stats.length > 0 && raw.length > 0, { title: 'No games to chart', reason: 'Trends need at least two games held for this player.' }, 6)}
      caption={stat ? `${points.length} games · ${win}-game rolling average` : undefined}
    >
      {stat ? (
        <SeriesChart
          label={`${stat.label} by game with a ${win}-game rolling average`}
          values={avg}
          context={[raw.map((v) => (v == null ? NaN : v))]}
          xLabels={points.map((p, i) => (i === 0 || p.date.slice(0, 7) !== points[i - 1].date.slice(0, 7) ? `${new Date(`${p.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} '${p.date.slice(2, 4)}` : ''))}
          zeroBased
          height={240}
          tickCount={4}
          format={(v) => fmt(v)}
          tooltipRows={(i) => [
            { value: fmt(raw[i]), label: stat.label },
            { value: fmt(avg[i]), label: `${win}-game average` },
            { value: points[i].label, label: longDate(points[i].date) },
          ]}
        />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Splits
// ---------------------------------------------------------------------------

export function SplitsCard({ research, state }: { research: PlayerResearchData | null; state: LoadState }) {
  const [season, setSeason] = useState<number | null>(null);
  const active = season ?? research?.splits.defaultSeason ?? null;
  const rows = active != null ? research?.splits.rowsBySeason[active] ?? [] : [];
  const labelOf = (s: number) => (s === 0 ? 'All held' : research?.seasonLabels.find((x) => x.season === s)?.label ?? String(s));
  const columns: Column<ResearchSplitRow>[] = [
    {
      key: 'label',
      label: 'Split',
      sortable: false,
      render: (r) => (
        <span className="flex items-center gap-2">
          {r.imageUrl ? <Avatar kind="logo" label={r.label} src={r.imageUrl} size={18} decorative /> : null}
          <span>{r.label}</span>
          {rows.find((x) => x.group === r.group) === r && r.group !== 'Overall' ? <span className="text-label text-ink-muted">{r.group}</span> : null}
        </span>
      ),
    },
    { key: 'games', label: 'GP', numeric: true, sortable: false },
    ...valueColumns<ResearchSplitRow>(research?.splits.columns ?? []).map((c) => ({ ...c, sortable: false })),
  ];
  return (
    <Card
      title="Situational splits"
      scope={
        research && research.splits.seasons.length > 1 ? (
          <SelectBox label="Season" value={String(active)} onChange={(v) => setSeason(Number(v))} options={research.splits.seasons.map((s) => ({ value: String(s), label: labelOf(s) }))} />
        ) : active != null ? (
          labelOf(active)
        ) : undefined
      }
      dense
      state={cardState(state, rows.length > 0, { title: 'No games in this season', reason: 'Splits are built from the games held for the season chosen.' })}
      caption="Per-game averages. Home and away, results, rest, months and opponents from the game logs."
    >
      <DataTable caption="Situational splits" columns={columns} rows={rows} rowKey={(r) => r.key} dense maxHeight={520} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Game log
// ---------------------------------------------------------------------------

export function GameLogCard({ research, state }: { research: PlayerResearchData | null; state: LoadState }) {
  const seasons = research?.seasonLabels ?? [];
  const [season, setSeason] = useState<number | null>(null);
  const active = season ?? seasons[0]?.season ?? null;
  const rows = (research?.gameLog.rows ?? []).filter((r) => r.season === active);
  const columns: Column<ResearchLogRow>[] = [
    {
      key: 'date',
      label: 'Date',
      sortValue: (r) => r.date,
      render: (r) =>
        r.href ? (
          <Link href={r.href} className="font-medium text-ink underline-offset-2 hover:underline">
            {shortDate(r.date)}
          </Link>
        ) : (
          shortDate(r.date)
        ),
    },
    {
      key: 'opp',
      label: 'Opp',
      sortable: false,
      render: (r) => (
        <span className="flex items-center gap-1.5">
          <span className="text-label text-ink-muted">{r.isHome === false ? '@' : 'vs'}</span>
          {r.opponentLogoUrl ? <Avatar kind="logo" label={r.opponentLabel} src={r.opponentLogoUrl} size={20} decorative /> : null}
          <span>{r.opponentLabel}</span>
        </span>
      ),
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
    ...valueColumns<ResearchLogRow>(research?.gameLog.columns ?? []),
  ];
  const seasonControl =
    seasons.length > 4 ? (
      <SelectBox label="Season" value={String(active)} onChange={(v) => setSeason(Number(v))} options={seasons.map((s) => ({ value: String(s.season), label: s.label }))} />
    ) : seasons.length > 1 ? (
      <SegmentedToggle label="Season" size="sm" value={active ?? seasons[0].season} onChange={setSeason} options={seasons.map((s) => ({ value: s.season, label: s.label }))} />
    ) : seasons.length === 1 ? (
      seasons[0].label
    ) : undefined;
  return (
    <Card
      title="Game log"
      scope={seasonControl}
      dense
      state={cardState(state, rows.length > 0, { title: 'No games held for this player', reason: 'The history table has no box scores under this id.' }, 8)}
      caption={rows.length ? `${rows.length} games${rows.some((r) => r.href) ? ' · the date opens the game' : ''}` : undefined}
    >
      <DataTable caption="Game log" columns={columns} rows={rows} rowKey={(r) => r.eventId} dense maxHeight={620} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export function SourcesCard({ items }: { items: Array<{ label: string; detail: ReactNode }> }) {
  return (
    <Card title="Sources for this page" dense>
      <ul className="space-y-1 text-body-sm text-ink-secondary">
        {items.map((it) => (
          <li key={it.label}>
            <span className="font-medium text-ink">{it.label}</span> · {it.detail}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function asOfText(iso: string | null | undefined): string {
  if (!iso) return 'time unknown';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'time unknown';
  const hours = (Date.now() - t) / 3_600_000;
  const when = new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return hours < 1 ? `as of ${when} (under an hour ago)` : hours < 48 ? `as of ${when} (${Math.round(hours)}h ago)` : `as of ${when} (${Math.round(hours / 24)} days ago)`;
}

// ---------------------------------------------------------------------------
// A sport's own sections (R6.1b)
// ---------------------------------------------------------------------------

type TableRow = Extract<ResearchCard, { kind: 'table' }>['rows'][number];

function SurfaceCard({ card }: { card: Extract<ResearchCard, { kind: 'surface' }> }) {
  const [view, setView] = useState(card.views[0]?.key);
  const active = card.views.find((v) => v.key === view) ?? card.views[0];
  return (
    <Card title={card.title} scope={card.scope}>
      {card.views.length > 1 ? (
        <SegmentedToggle label={`${card.title} view`} size="sm" value={active.key} onChange={setView} options={card.views.map((v) => ({ value: v.key, label: v.label }))} className="mb-3" />
      ) : null}
      {active ? <SpatialSurface role={active.role} /> : null}
    </Card>
  );
}

function ScatterCard({ card }: { card: Extract<ResearchCard, { kind: 'scatter' }> }) {
  const [visible, setVisible] = useState<Set<string>>(() => new Set(card.defaultVisible));
  const toggle = (key: string) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <Card title={card.title} scope={card.scope} caption={card.caption}>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label={`${card.title}: groups shown`}>
        {card.groups.map((g, i) => (
          <Chip key={g.key} size="md" selected={visible.has(g.key)} onClick={() => toggle(g.key)}>
            {/* With `emphasis` the outcome carries the colour (a goal), so a
                group dot here would claim a meaning the chart does not use. */}
            {g.key === 'away' || g.key === 'home' ? (
              <span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: SIDE_COLOR[g.key] }} />
            ) : card.emphasis ? null : (
              <span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: CATEGORICAL[i % CATEGORICAL.length] }} />
            )}
            {g.label} · {g.count}
          </Chip>
        ))}
      </div>
      {card.surface === 'fullpitch' ? (
        <FullPitchScatter points={card.points} emphasis={card.emphasis} filled={card.filled} tips={card.tips} groups={card.groups} visible={visible} ends={card.ends} label={card.title} />
      ) : card.surface === 'pitch' ? (
        <PitchScatter points={card.points} weights={card.weights} emphasis={card.emphasis} tips={card.tips} groups={card.groups} visible={visible} label={card.title} />
      ) : card.surface === 'court' ? (
        <CourtScatter points={card.points} emphasis={card.emphasis} tips={card.tips} groups={card.groups} visible={visible} label={card.title} />
      ) : card.surface === 'rink' ? (
        <RinkScatter points={card.points} emphasis={card.emphasis} tips={card.tips} groups={card.groups} visible={visible} label={card.title} />
      ) : card.surface === 'field' ? (
        <FieldScatter points={card.points} groups={card.groups} visible={visible} label={card.title} />
      ) : card.surface === 'spray' ? (
        <SprayScatter points={card.points} weights={card.weights} emphasis={card.emphasis} tips={card.tips} groups={card.groups} visible={visible} label={card.title} />
      ) : (
        <ZoneScatter points={card.points} labels={card.labels} tips={card.tips} groups={card.groups} visible={visible} label={card.title} />
      )}
      {card.legend ? (
        <VizLegend items={card.legend.map((l) => ({ label: l.label, color: l.dark ? 'oklch(var(--ink-muted))' : 'rgb(var(--good))' }))} />
      ) : null}
    </Card>
  );
}

/**
 * R9c — the bar and leader marks for one column, from the rows actually shown.
 *
 * Only numbers count toward a scale: a cell holding "22/34" or "—" has no
 * magnitude, and a column of them draws nothing rather than guessing. In `row`
 * mode a side is measured against the row's own total, so two teams' bars read
 * against each other and never against the biggest number in the table.
 */
function emphasis(
  c: ResearchColumn,
  rows: TableRow[],
  compare: 'column' | 'row',
): { bar?: (r: TableRow) => number | null; strong?: (r: TableRow) => boolean } {
  // A cell is a magnitude only when the WHOLE cell is one number. ESPN's team
  // stats arrive as strings ("21", "45.5%"), which count; "22/34", "0-0" and
  // "—" do not, and a column of those simply draws no bars.
  const num = (r: TableRow, key = c.key) => {
    const v = r.values[key];
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    const t = v.trim().replace(/%$/, '');
    return /^[+-]?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
  };
  const out: { bar?: (r: TableRow) => number | null; strong?: (r: TableRow) => boolean } = {};
  if (c.bar) {
    if (compare === 'row') {
      const barKeys = rows.length ? Object.keys(rows[0].values) : [];
      out.bar = (r) => {
        const v = num(r);
        if (v == null) return null;
        const total = barKeys.reduce((a, k) => a + Math.abs(num(r, k) ?? 0), 0);
        return total > 0 ? Math.abs(v) / total : null;
      };
    } else {
      const max = Math.max(0, ...rows.map((r) => Math.abs(num(r) ?? 0)));
      out.bar = (r) => {
        const v = num(r);
        return v == null || max <= 0 ? null : Math.abs(v) / max;
      };
    }
  }
  if (c.leader) {
    const values = rows.map((r) => num(r)).filter((v): v is number => v != null);
    if (values.length > 1) {
      const best = c.leader === 'low' ? Math.min(...values) : Math.max(...values);
      out.strong = (r) => num(r) === best;
    }
  }
  return out;
}

function TableCard({ card }: { card: Extract<ResearchCard, { kind: 'table' }> }) {
  const views = card.views ?? [{ key: 'main', label: card.title, labelHeader: card.labelHeader, columns: card.columns, rows: card.rows, sortKey: card.sortKey }];
  const [viewKey, setViewKey] = useState(views[0]?.key);
  const view = views.find((v) => v.key === viewKey) ?? views[0];
  const sortable = !card.fixedOrder;
  const columns: Column<TableRow>[] = [
    {
      key: 'label',
      label: view.labelHeader,
      sortable: false,
      render: (r: TableRow) => (
        <span className="flex min-w-0 items-center gap-2">
          {r.imageUrl ? <Avatar kind={r.imageKind ?? 'logo'} label={r.label} src={r.imageUrl} size={r.imageKind === 'player' ? 26 : 20} decorative /> : null}
          {r.href ? (
            <Link href={r.href} className={cx('truncate underline-offset-2 hover:underline', r.highlight ? 'font-semibold text-ink' : 'text-ink')}>
              {r.label}
            </Link>
          ) : (
            <span className={cx('truncate', r.highlight && 'font-semibold')}>{r.label}</span>
          )}
          {r.labelNote ? <span className="shrink-0 text-label text-ink-muted">{r.labelNote}</span> : null}
        </span>
      ),
    },
    ...view.columns.map((c) => ({
      key: c.key,
      ...emphasis(c, view.rows, card.compare ?? 'column'),
      label: c.imageUrl ? (
        <span className={cx('flex items-center gap-1.5', !c.text && 'justify-end')}>
          <Avatar kind="logo" label={c.label} src={c.imageUrl} size={16} decorative />
          {c.label}
        </span>
      ) : (
        c.label
      ),
      title: c.info ?? (c.imageUrl ? c.label : undefined),
      numeric: !c.text,
      sortable,
      render: (r: TableRow) => {
        const run = c.streak ? r.streaks?.[c.key] : undefined;
        if (run) {
          return run.outcomes.length ? (
            <StreakStrip outcomes={run.outcomes} titles={run.titles} label={`${r.label}: ${typeof c.label === 'string' ? c.label : c.key}`} className="inline-flex justify-end" />
          ) : (
            '—'
          );
        }
        const tone = r.tones?.[c.key];
        const text = formatResearchValue(r.values[c.key], c);
        if (tone) return <span className={cx('font-semibold', tone === 'good' ? 'text-good' : 'text-bad')}>{text}</span>;
        return c.text ? <span className="block min-w-[8rem] whitespace-normal">{text}</span> : text;
      },
      sortValue: (r: TableRow) => {
        if (c.streak) return (r.streaks?.[c.key]?.outcomes ?? []).filter((o) => o === true).length;
        const v = r.values[c.key];
        return typeof v === 'number' ? v : typeof v === 'string' ? v : null;
      },
    })),
  ];
  return (
    <Card
      title={card.title}
      scope={card.scope}
      info={card.info}
      caption={card.caption}
      dense
      state={view.rows.length ? { kind: 'ready' } : { kind: 'empty', title: card.emptyText ?? 'Nothing to list', reason: 'The source has no rows for this season.' }}
    >
      {views.length > 1 ? (
        <SegmentedToggle label={`${card.title} view`} size="sm" value={view.key} onChange={setViewKey} options={views.map((v) => ({ value: v.key, label: v.label }))} className="mb-2" />
      ) : null}
      <DataTable
        key={view.key}
        caption={`${card.title}${views.length > 1 ? `: ${view.label}` : ''}`}
        columns={columns}
        rows={view.rows}
        rowKey={(r) => r.key}
        dense
        maxHeight={card.views ? 560 : 420}
        initialSort={view.sortKey ? { key: view.sortKey, desc: true } : undefined}
        rowClassName={(r) => (r.highlight ? 'bg-card-sunk' : undefined)}
      />
    </Card>
  );
}

/** One card of a sport section, by kind. Knows nothing about which sport built it. */
export function ResearchCardView({ card }: { card: ResearchCard }) {
  switch (card.kind) {
    case 'percentiles':
      return (
        <Card title={card.title} scope={card.scope} info={card.info} caption={card.caption}>
          <div className="space-y-0.5">
            {card.rows.map((r) =>
              r.strip && r.rank ? (
                <LeagueStripRow key={r.key} label={r.label} valueText={r.valueText} league={r.strip.league} value={r.strip.value} rank={r.rank} direction={r.direction} info={r.info} />
              ) : r.percentile != null ? (
                <RankRow key={r.key} label={r.label} valueText={r.valueText} percentile={r.percentile} direction={r.direction} info={r.info} />
              ) : (
                <div key={r.key} className="grid grid-cols-[minmax(64px,140px)_1fr_auto] items-center gap-x-3 px-1 py-1.5">
                  <span className="truncate text-body-sm text-ink-secondary">{r.label}</span>
                  <span />
                  <span className="text-body-sm font-semibold tabular-nums text-ink">{r.valueText}</span>
                </div>
              ),
            )}
          </div>
        </Card>
      );
    case 'histogram':
      return (
        <Card title={card.title} scope={card.scope} caption={card.caption}>
          <Histogram bins={card.bars} label={card.title} minBand={card.minBand} height={card.height} />
          {card.highlightLabel ? <VizLegend items={[{ label: card.highlightLabel, color: 'oklch(18% 0.005 260)' }]} /> : null}
          {card.toneLegend ? (
            <VizLegend
              items={[
                { label: card.toneLegend.good, color: 'rgb(var(--good))' },
                { label: card.toneLegend.bad, color: 'rgb(var(--bad))' },
              ]}
            />
          ) : null}
        </Card>
      );
    case 'series':
      return (
        <Card title={card.title} scope={card.scope} caption={card.caption}>
          <SeriesChart
            label={card.title}
            values={card.values}
            context={card.context ? [card.context] : undefined}
            xLabels={card.xLabels}
            reference={card.reference}
            zeroBased={card.zeroBased}
            min={card.min}
            max={card.max}
            height={220}
            tickCount={4}
            format={(v) =>
              `${card.axisFormat?.prefix ?? ''}${formatResearchValue(card.axisFormat?.negate ? -v : v, { decimals: card.decimals })}`
            }
            tooltipRows={(i) => (card.tips[i] ?? []).map((t) => ({ value: t }))}
          />
          {card.legend ? <VizLegend items={card.legend.map((l) => ({ label: l.label, color: l.dark ? 'oklch(18% 0.005 260)' : 'oklch(80% 0.004 260)' }))} /> : null}
        </Card>
      );
    case 'dumbbell':
      return (
        <Card title={card.title} scope={card.scope} caption={card.caption}>
          <SplitDumbbell
            rows={card.rows.map((r) => ({ ...r, format: (v: number) => formatResearchValue(v, { decimals: r.decimals ?? 1 }) }))}
            aLabel={card.aLabel}
            bLabel={card.bLabel}
            label={card.title}
          />
        </Card>
      );
    case 'table':
      return <TableCard card={card} />;
    case 'surface':
      return <SurfaceCard card={card} />;
    case 'scatter':
      return <ScatterCard card={card} />;
    case 'status':
      return (
        <Card title={card.title}>
          <EmptyState title={card.headline} reason={card.reason} />
        </Card>
      );
    case 'drilldown':
      return <DrilldownCard card={card} />;
    case 'timeline':
      return (
        <Card title={card.title} scope={card.scope} caption={card.caption}>
          <MatchTimeline events={card.events} teams={card.teams} label={card.title} />
        </Card>
      );
    case 'field':
      return (
        <Card title={card.title} scope={card.scope} caption={card.caption}>
          <FieldLanes rows={card.rows} ends={card.ends} label={card.title} />
          {card.legend ? (
            <VizLegend
              items={card.legend.map((l) => ({
                label: l.label,
                color: l.mark === 'turnover' ? 'rgb(var(--bad))' : l.mark === 'penalty' ? 'oklch(72% 0.004 260)' : SIDE_COLOR[l.side ?? 'away'],
              }))}
            />
          ) : null}
        </Card>
      );
  }
}

function DrilldownCard({ card }: { card: Extract<ResearchCard, { kind: 'drilldown' }> }) {
  const [picked, setPicked] = useState(card.defaultKey ?? card.items[0]?.key);
  const item = card.items.find((i) => i.key === picked) ?? card.items[0];
  const groups = [...new Set(card.items.map((i) => i.group))];
  if (!item) return <Card title={card.title} state={{ kind: 'empty', title: 'Nothing to list', reason: 'The source has no items for this game.' }} />;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Card title={card.title} scope={card.scope} dense>
        <div className="max-h-[560px] overflow-y-auto pr-1" role="listbox" aria-label={card.title}>
          {groups.map((g) => (
            <div key={g}>
              <div className="sticky top-0 bg-card px-1 pb-1 pt-2 text-overline uppercase text-ink-muted">{g}</div>
              {card.items
                .filter((i) => i.group === g)
                .map((i) => (
                  <button
                    key={i.key}
                    type="button"
                    role="option"
                    aria-selected={i.key === item.key}
                    onClick={() => setPicked(i.key)}
                    className={cx(
                      'flex w-full items-center gap-2 rounded-ctl px-2 py-1.5 text-left transition-colors duration-instant',
                      i.key === item.key ? 'bg-accent-soft' : 'hover:bg-card-sunk',
                    )}
                  >
                    {i.imageUrl ? <Avatar kind="player" label={i.label} src={i.imageUrl} size={26} decorative /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-semibold text-ink">{i.label}</span>
                      {i.sub ? <span className="block truncate text-label text-ink-muted">{i.sub}</span> : null}
                    </span>
                    {i.badge ? <span className="shrink-0 text-label tabular-nums text-ink-secondary">{i.badge}</span> : null}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </Card>
      <div className="min-w-0 space-y-3">
        {item.cards.map((c) => (
          <ResearchCardView key={`${item.key}-${c.key}`} card={c} />
        ))}
      </div>
    </div>
  );
}

/** A sport section's body: its season control, its state, and its cards in rows of one or two. */
export function ResearchSectionBody({ section, onSeason }: { section: ResearchSection; onSeason: (season: number) => void }) {
  const control =
    section.season && section.season.options.length > 1 ? (
      <SegmentedToggle label={`${section.title} season`} size="sm" value={section.season.value} onChange={onSeason} options={section.season.options} />
    ) : null;
  let body: ReactNode;
  if (section.state.kind === 'loading') {
    body = (
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Loading" state={{ kind: 'loading', lines: 6 }} />
        <Card title="Loading" state={{ kind: 'loading', lines: 6 }} />
      </div>
    );
  } else if (section.state.kind === 'error') {
    body = <ErrorState message={section.state.message} />;
  } else if (section.state.kind === 'empty') {
    body = (
      <div className="rounded-card border border-line-soft bg-card shadow-card">
        <EmptyState title={section.state.title} reason={section.state.reason} />
      </div>
    );
  } else {
    body = section.rows.map((row, i) => (
      <div key={i} className={row.length > 1 ? 'grid gap-3 lg:grid-cols-2' : ''}>
        {row.map((card) => (
          <ResearchCardView key={card.key} card={card} />
        ))}
      </div>
    ));
  }
  return (
    <>
      {control || section.note ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {control}
          {section.note && section.state.kind === 'ready' ? <p className="max-w-3xl text-label text-ink-secondary">{section.note}</p> : null}
        </div>
      ) : null}
      {body}
    </>
  );
}
