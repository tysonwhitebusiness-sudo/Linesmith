'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { Avatar, Card, Chip, DataTable, EmptyState, ErrorState, FactList, RankRow, SegmentedToggle, SelectBox, Skeleton, StatGrid, StatValue, StatusPill, VizLegend, type CardState, type Column } from './ui';
import { CATEGORICAL, FieldScatter, Histogram, SeriesChart, ZoneScatter } from './charts';
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

export function PlayerHero({ bio, bioState, research, researchState, fallbackName, teamHref, nextGame }: PlayerHeroProps) {
  const name = bio?.name ?? fallbackName;
  const facts: Array<[ReactNode, ReactNode]> = [
    ...(bio?.age != null ? [['Age', String(bio.age)] as [ReactNode, ReactNode]] : []),
    ...(bio?.facts ?? []).map((f) => [f.label, f.value] as [ReactNode, ReactNode]),
  ];
  return (
    <section aria-label={name ?? 'Player'} className="rounded-card-hero border border-line-soft bg-card p-6 shadow-card">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-1 basis-[320px] items-start gap-4">
          {bioState.loading && !bio ? (
            <Skeleton w={72} h={72} round="rounded-xl" />
          ) : (
            <Avatar label={name ?? 'Player'} src={bio?.headshotUrl ?? undefined} fallbackSrc={bio?.team?.logoUrl ?? undefined} size={72} rounded />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-heading text-ink">{name ?? (bioState.loading ? <Skeleton w={180} h={22} /> : 'Unknown player')}</h1>
              {bio?.jersey ? <StatusPill>#{bio.jersey}</StatusPill> : null}
              {bio?.positionAbbr || bio?.position ? <StatusPill>{bio.position ?? bio.positionAbbr}</StatusPill> : null}
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
              {nextGame ? <span className="text-ink-muted">{nextGame}</span> : null}
            </div>
            {bio?.injury ? (
              <div role="status" className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-ctl border border-bad/25 bg-bad/5 px-2.5 py-1 text-body-sm text-ink">
                <span className="font-semibold text-bad">{bio.injury.status}</span>
                {bio.injury.detail ? <span>{bio.injury.detail}</span> : null}
                {bio.injury.returnDate ? <span className="text-ink-muted">· expected back {shortDate(bio.injury.returnDate)}</span> : null}
                {bio.injury.date ? <span className="text-ink-muted">· reported {shortDate(bio.injury.date)}</span> : null}
              </div>
            ) : null}
            {facts.length ? <FactList className="mt-3 max-w-md" items={facts} /> : null}
            {bioState.error && !bio ? <ErrorState className="mt-3" message={bioState.error} onRetry={bioState.reload} /> : null}
          </div>
        </div>
        <div className="min-w-[220px] space-y-1">
          {research ? (
            <>
              <div className="text-overline uppercase text-ink-muted">{research.hero.scopeLabel}</div>
              {research.hero.record ? <div className="text-label text-ink-secondary">{research.hero.record} in games played</div> : null}
              {research.hero.scopeReason ? <div className="max-w-[260px] text-label text-ink-muted">{research.hero.scopeReason}</div> : null}
            </>
          ) : researchState.loading ? (
            <Skeleton w={160} h={14} />
          ) : null}
        </div>
      </div>
      {research && research.hero.tiles.length ? (
        <div className="mt-4 border-t border-line-soft pt-4">
          <StatGrid min={96}>
            {research.hero.tiles.map((t) => (
              <StatValue key={t.label} label={t.label} value={t.value} size="compact" info={t.info} />
            ))}
          </StatGrid>
        </div>
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
        <span className="flex items-baseline gap-2">
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
            <span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: CATEGORICAL[i % CATEGORICAL.length] }} />
            {g.label} · {g.count}
          </Chip>
        ))}
      </div>
      {card.surface === 'field' ? (
        <FieldScatter points={card.points} groups={card.groups} visible={visible} label={card.title} />
      ) : (
        <ZoneScatter points={card.points} groups={card.groups} visible={visible} label={card.title} />
      )}
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
              r.percentile != null ? (
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
          <Histogram bins={card.bars} label={card.title} />
          {card.highlightLabel ? <VizLegend items={[{ label: card.highlightLabel, color: 'oklch(18% 0.005 260)' }]} /> : null}
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
            format={(v) => formatResearchValue(v, { decimals: card.decimals })}
            tooltipRows={(i) => (card.tips[i] ?? []).map((t) => ({ value: t }))}
          />
          {card.legend ? <VizLegend items={card.legend.map((l) => ({ label: l.label, color: l.dark ? 'oklch(18% 0.005 260)' : 'oklch(80% 0.004 260)' }))} /> : null}
        </Card>
      );
    case 'table': {
      const columns: Column<TableRow>[] = [
        { key: 'label', label: card.labelHeader, sortable: false },
        ...card.columns.map((c) => ({
          key: c.key,
          label: c.label,
          numeric: true,
          title: c.info,
          render: (r: TableRow) => formatResearchValue(r.values[c.key], c),
          sortValue: (r: TableRow) => {
            const v = r.values[c.key];
            return typeof v === 'number' ? v : typeof v === 'string' ? v : null;
          },
        })),
      ];
      return (
        <Card title={card.title} scope={card.scope} info={card.info} caption={card.caption} dense state={card.rows.length ? { kind: 'ready' } : { kind: 'empty', title: card.emptyText ?? 'Nothing to list', reason: 'The source has no rows for this season.' }}>
          <DataTable caption={card.title} columns={columns} rows={card.rows} rowKey={(r) => r.key} dense maxHeight={420} />
        </Card>
      );
    }
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
  }
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
