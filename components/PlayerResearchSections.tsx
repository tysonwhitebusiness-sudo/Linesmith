'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { bandColors, bandGradient, type TeamColor } from '@/lib/sports/shared/teamColors';
import type { TileRank } from '@/lib/sports/shared/playerPool';
import { heatFill, heatInk } from '@/lib/ui/heat';
import { TeamLogo } from './SubjectAvatar';
import { Avatar, Card, Chip, Collapse, cx, DisclosureBar, DataTable, ResultMark, EmptyState, ErrorState, LeagueStripRow, PickList, RankRow, SegmentedToggle, SelectBox, Skeleton, VizLegend, type CardState, type Column, Tooltip } from './ui';
import { CATEGORICAL, CourtScatter, FieldLanes, FieldScatter, FullPitchScatter, Histogram, MatchTimeline, PitchScatter, RinkScatter, SeriesChart, SIDE_COLOR, SplitDumbbell, SprayScatter, StreakStrip, ZoneScatter } from './charts';
import { SpatialSurface } from './charts/SpatialSurface';
import { GameOddsSection } from './odds/GameOddsSection';
import { GameFinalOddsSection } from './odds/GameFinalOddsSection';
import { TeamOddsSection } from './odds/TeamOddsSection';
import {
  formatResearchValue,
  type PlayerBio,
  type PlayerResearchData,
  type ResearchTile,
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

/** C2.1: the hero's "NEXT" block, as data. `PlayerDetail` builds it from today's game. */
export interface HeroNext {
  homeAway: '@' | 'vs';
  opponent: { name: string | null; abbr: string | null; logoUrl: string | null };
  /** ISO start time, printed "Sun 3:05 PM". */
  startsAt: string | null;
  /** The venue or the game's status, printed after the time. */
  detail: string | null;
  /** While the game is on: "BAL 3 – NYY 2 · Top 5", shown instead of the time. */
  live: string | null;
}

export interface PlayerHeroProps {
  bio: PlayerBio | null;
  bioState: LoadState;
  research: PlayerResearchData | null;
  researchState: LoadState;
  /** What to call the player before the bio lands, or when the league does not know the id. */
  fallbackName: string | null;
  teamHref: string | null;
  /** Today's game, when there is one. */
  next: HeroNext | null;
  /** The player's team colours (`teamColor()`), or null: golf, tennis, or not loaded yet. The band is charcoal then. */
  colors: TeamColor | null;
}

const HERO_PEEK_KEY = 'lb.heroPeekSeen';

export function heroWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(',', '');
}

/** "34th of 142 RB". */
export function rankLine(r: TileRank): string {
  const n = r.rank;
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix} of ${r.of} ${r.pool}`;
}

/**
 * The heroes' tiles (C2, C2b): value, the rank line in the heat ink, and a
 * 3px bar along the bottom as long as the percentile. A tile with no rank is
 * the number alone. Shared by the player and team heroes.
 */
export function HeroTileGrid({ tiles }: { tiles: ResearchTile[] }) {
  return (
    <dl className="grid grid-cols-2 gap-2.5 px-6 py-4 min-[900px]:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="relative overflow-hidden rounded-[10px] border border-line-soft bg-card-sunk px-3 py-2.5">
          <dt className="text-overline uppercase text-ink-muted">
            {t.info ? (
              <Tooltip content={t.info}>
                <span className="underline decoration-dotted underline-offset-2">{t.label}</span>
              </Tooltip>
            ) : (
              t.label
            )}
          </dt>
          <dd className="mt-0.5 text-heading font-bold tabular-nums text-ink">{t.value}</dd>
          {t.rank ? (
            <>
              <dd className="mt-1 text-label font-semibold" style={{ color: heatInk(t.rank.percentile / 100) }}>
                {rankLine(t.rank)}
              </dd>
              <span aria-hidden className="absolute bottom-0 left-0 h-[3px]" style={{ width: `${Math.max(4, t.rank.percentile)}%`, background: heatFill(t.rank.percentile / 100) }} />
            </>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

/**
 * The hero — C2 (mockup `docs/design/card-redesign-2026-09-21.html` §2).
 *
 * A team-colour band (charcoal where a sport has no team, or a team's colours
 * cannot carry white text), the headshot hanging below it, the bio as one
 * line, and a summary bar that opens the season tiles and the last five
 * games. The body starts closed and peeks open once per viewer. Every part is
 * data: no sport is named here, and a sport that lacks a piece leaves it out.
 */
export function PlayerHero({ bio, bioState, research, researchState, fallbackName, teamHref, next, colors }: PlayerHeroProps) {
  const name = bio?.name ?? fallbackName;
  const hero = research?.hero;
  const band = bandColors(colors);
  const [open, setOpen] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const bodyId = 'player-hero-body';
  const facts: Array<{ label: string; value: string }> = [
    ...(bio?.age != null ? [{ label: 'Age', value: String(bio.age) }] : []),
    ...(bio?.facts ?? []),
  ];
  const position = bio?.positionAbbr ?? bio?.position ?? null;
  const tiles = hero?.tiles ?? [];
  // The bar's two numbers: the first ranked tiles, else the first tiles after
  // the games count (which is never ranked, so it never leads).
  const ranked = tiles.filter((t) => t.rank);
  const summary = (ranked.length >= 2 ? ranked : [...ranked, ...tiles.slice(1).filter((t) => !t.rank)]).slice(0, 2);
  const hasBody = Boolean(hero && tiles.length);

  return (
    <section aria-label={name ?? 'Player'} className="overflow-hidden rounded-card-hero border border-line-soft bg-card shadow-card">
      <div className="relative flex min-h-[150px] flex-wrap items-end gap-5 overflow-hidden px-6 pb-[18px] pt-5 text-white min-[900px]:flex-nowrap" style={{ background: bandGradient(band) }}>
        {bio?.team?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bio.team.logoUrl} alt="" aria-hidden className="pointer-events-none absolute -right-[30px] -top-10 size-[260px] object-contain opacity-[.14]" />
        ) : null}
        <div className="relative z-[1] min-[900px]:-mb-11">
          {bioState.loading && !bio ? (
            <Skeleton w={132} h={132} round="rounded-full" />
          ) : (
            <>
              <span className="hidden min-[900px]:block">
                <Avatar label={name ?? 'Player'} src={bio?.headshotUrl ?? undefined} fallbackSrc={bio?.team?.logoUrl ?? undefined} size={132} ring />
              </span>
              <span className="min-[900px]:hidden">
                <Avatar label={name ?? 'Player'} src={bio?.headshotUrl ?? undefined} fallbackSrc={bio?.team?.logoUrl ?? undefined} size={96} ring decorative />
              </span>
            </>
          )}
        </div>
        <div className="relative z-[1] min-w-0 flex-1">
          <h1 className="text-display text-white">{name ?? (bioState.loading ? <Skeleton w={220} h={30} /> : 'Unknown player')}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {position ? (
              band.accent ? (
                <span className="rounded-full px-[9px] py-[3px] text-label font-semibold" style={{ background: band.accent.bg, color: band.accent.ink }}>
                  {position}
                </span>
              ) : (
                <Chip tone="onColor">{position}</Chip>
              )
            ) : null}
            {bio?.jersey ? <Chip tone="onColor">#{bio.jersey}</Chip> : null}
            {bio?.team?.name ? (
              teamHref ? (
                <Link href={teamHref} className="rounded-full underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-white">
                  <Chip tone="onColor">{bio.team.name}</Chip>
                </Link>
              ) : (
                <Chip tone="onColor">{bio.team.name}</Chip>
              )
            ) : null}
            {bio ? (
              bio.injury ? (
                <Chip tone="bad">{bio.injury.status}</Chip>
              ) : (
                <Chip tone="onColor">Healthy</Chip>
              )
            ) : null}
          </div>
        </div>
        {next ? (
          <div className="relative z-[1] w-full text-body-sm min-[900px]:w-auto min-[900px]:text-right">
            <div className="text-overline uppercase text-white/70">Next</div>
            <div className="flex items-center gap-2 text-body font-semibold min-[900px]:justify-end">
              <span>{next.homeAway}</span>
              {next.opponent.logoUrl ? <TeamLogo logoUrl={next.opponent.logoUrl} size={26} /> : null}
              <span>{next.opponent.name ?? next.opponent.abbr}</span>
            </div>
            <div className="text-white/80">{next.live ?? [heroWhen(next.startsAt), next.detail].filter(Boolean).join(' · ')}</div>
          </div>
        ) : null}
      </div>

      {bio?.injury && (bio.injury.detail || bio.injury.returnDate) ? (
        <div role="status" className="border-b border-line-soft bg-bad/5 px-6 py-2 text-body-sm text-ink min-[900px]:pl-[176px]">
          <span className="font-semibold text-bad-ink">{bio.injury.status}</span>
          {bio.injury.detail ? <span> · {bio.injury.detail}</span> : null}
          {bio.injury.returnDate ? <span className="text-ink-muted"> · expected back {shortDate(bio.injury.returnDate)}</span> : null}
        </div>
      ) : null}

      {facts.length ? (
        <dl className="flex flex-wrap gap-x-[18px] gap-y-1.5 px-6 py-3 text-body-sm text-ink-secondary min-[900px]:pl-[176px]">
          {facts.map((f) => (
            <div key={f.label} className="flex gap-1">
              <dt>{f.label}</dt>
              <dd className="font-semibold text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="h-3 min-[900px]:h-12" />
      )}
      {bioState.error && !bio ? <ErrorState className="mx-6 mb-3" message={bioState.error} onRetry={bioState.reload} /> : null}

      {hasBody && hero ? (
        <>
          <DisclosureBar
            label={<>{hero.scopeLabel} &amp; form</>}
            open={open}
            onToggle={() => setOpen((o) => !o)}
            controls={bodyId}
            nudge={peeking}
            summary={
              <>
                {summary.map((t, i) => (
                  <span key={t.label}>
                    <b className="text-body tabular-nums text-ink">{t.value}</b> {t.label}
                    {i === 0 && t.rank ? <span className="ml-1 text-label font-semibold text-good-ink">{rankLine(t.rank)}</span> : null}
                  </span>
                ))}
                {hero.lastFive.length ? (
                  <span aria-hidden className="flex gap-[3px]">
                    {hero.lastFive.map((g, i) => (
                      <i key={i} className={cx('size-2 rounded-[2px]', g.result === 'L' || g.tone === 'bad' ? 'bg-bad' : g.result === 'W' || g.tone === 'good' ? 'bg-good' : 'bg-line')} />
                    ))}
                  </span>
                ) : null}
              </>
            }
          />
          <Collapse open={open} id={bodyId} peek={HERO_PEEK_KEY} onPeek={setPeeking} className={cx('border-t', open ? 'border-line-soft' : 'border-transparent')}>
            <div className="grid grid-cols-1 min-[900px]:grid-cols-[minmax(0,1fr)_300px]">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-3.5">
                  <span className="text-overline uppercase text-ink-muted">{hero.scopeLabel}</span>
                  {hero.scopeChip ? <Chip>{hero.scopeChip}</Chip> : null}
                </div>
                <HeroTileGrid tiles={tiles} />
              </div>
              <div className="border-t border-line-soft px-5 py-4 min-[900px]:border-l min-[900px]:border-t-0">
                <div className="text-overline uppercase text-ink-muted">Last {hero.lastFive.length}</div>
                {hero.record ? <div className="mb-3 mt-1 text-body-sm text-ink-secondary">{hero.record} in games played</div> : <div className="mb-3" />}
                <ul className="flex flex-col gap-1.5">
                  {hero.lastFive.map((g) => (
                    <li key={(g.date ?? '') + g.opponent} className="grid grid-cols-[22px_26px_minmax(0,1fr)_auto] items-center gap-2 text-body-sm">
                      <ResultMark
                        result={g.result ?? (g.tone === 'good' ? 'W' : g.tone === 'bad' ? 'L' : null)}
                        mark={g.result ? undefined : (g.mark ?? undefined)}
                        label={`${g.opponent}${g.result ? ` ${g.result}` : g.mark ? ` ${g.mark}` : ''}`}
                      />
                      {g.opponentLogo ? <Avatar kind="logo" label={g.opponentAbbr ?? g.opponent} src={g.opponentLogo} size={22} decorative /> : <span />}
                      <span className="truncate text-ink">{g.opponent}</span>
                      <span className="tabular-nums text-ink-secondary">{g.line ?? (g.date ? shortDate(g.date) : '')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Collapse>
        </>
      ) : researchState.loading ? (
        <div className="border-t border-line-soft px-6 py-3">
          <Skeleton h={18} />
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

export function SeasonsCard({ research, state }: { research: PlayerResearchData | null; state: LoadState }) {
  const all = research?.seasons.rows ?? [];
  // U2: season 0 is the "All held" row. It is a TOTAL, not a season — it moves
  // out of the body into `totals`, where it is ruled off and excluded from
  // sorting, bars and leaders instead of sitting in the list pretending to be
  // another season.
  const rows = all.filter((r) => r.season !== 0);
  const totals = all.filter((r) => r.season === 0);
  const held = all.find((r) => r.season === 0)?.games ?? all.reduce((s, r) => s + r.games, 0);
  const columns: Column<ResearchSeasonRow>[] = [
    { key: 'label', label: 'Season', sortable: false },
    { key: 'games', label: 'GP', numeric: true, sortable: false },
    ...valueColumns<ResearchSeasonRow>(research?.seasons.columns ?? []).map((c) => ({ ...c, sortable: false })),
  ];
  return (
    <Card
      title="Season stats"
      count={rows.length || undefined}
      scope={research ? `${held} games held` : undefined}
      flush
      state={cardState(state, all.length > 0, { title: 'No games held for this player', reason: 'The history table has no box scores under this id — a player new to the league, or one the history jobs do not cover.' })}
      caption="Totals and per-game rates from every game held. The last row is every season together."
    >
      <DataTable caption="Season by season" columns={columns} rows={rows} totals={totals} rowKey={(r) => String(r.season)} />
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
      // U2: the group is a ROW now (`groupBy` below), not a muted word tacked
      // onto the first label of each block.
      render: (r) => (
        <span className="flex items-center gap-2">
          {r.imageUrl ? <Avatar kind="logo" label={r.label} src={r.imageUrl} size={18} decorative /> : null}
          <span>{r.label}</span>
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
      flush
      state={cardState(state, rows.length > 0, { title: 'No games in this season', reason: 'Splits are built from the games held for the season chosen.' })}
      caption="Per-game averages. Home and away, results, rest, months and opponents from the game logs."
    >
      <DataTable caption="Situational splits" columns={columns} rows={rows} rowKey={(r) => r.key} groupBy={(r) => r.group} maxHeight={520} />
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
      // U2: the W/L is a tone chip and the score follows it in `ink-secondary`,
      // rather than the whole string carrying the colour — so the outcome is
      // readable without it.
      tone: (r) => (r.result === 'W' ? 'good' : r.result === 'L' ? 'bad' : null),
      render: (r) => (r.result ? (r.score ?? (r.result === 'W' || r.result === 'L' ? '' : r.result)) : '—'),
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
      count={rows.length || undefined}
      scope={seasonControl}
      flush
      state={cardState(state, rows.length > 0, { title: 'No games held for this player', reason: 'The history table has no box scores under this id.' }, 8)}
      caption={rows.length ? `${rows.length} games${rows.some((r) => r.href) ? ' · the date opens the game' : ''}` : undefined}
    >
      <DataTable
        caption="Game log"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.eventId}
        paging={{ mode: 'minimal', pageSize: 10, pageSizes: [10, 25, 50], noun: 'games' }}
      />
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
      // U2: `info` is a real Tooltip in the header, not a native `title` that
      // never opened on touch. `title` stays only as the accessible name for a
      // header whose label is an image.
      info: c.info,
      title: c.imageUrl && typeof c.label === 'string' ? c.label : undefined,
      numeric: !c.text,
      wrap: c.text,
      sortable,
      streak: c.streak ? (r: TableRow) => r.streaks?.[c.key] ?? null : undefined,
      render: (r: TableRow) => {
        const tone = r.tones?.[c.key];
        const text = formatResearchValue(r.values[c.key], c);
        if (tone) return <span className={cx('font-semibold', tone === 'good' ? 'text-good-ink' : 'text-bad-ink')}>{text}</span>;
        return text;
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
      count={view.rows.length || undefined}
      scope={
        views.length > 1 ? (
          <SegmentedToggle label={`${card.title} view`} size="sm" value={view.key} onChange={setViewKey} options={views.map((v) => ({ value: v.key, label: v.label }))} />
        ) : (
          card.scope
        )
      }
      info={card.info}
      caption={card.caption}
      // U2: a flush body, so the header band runs edge to edge and the sticky
      // first column pins against the card's own border rather than against a
      // 12px gutter.
      flush
      state={view.rows.length ? { kind: 'ready' } : { kind: 'empty', title: card.emptyText ?? 'Nothing to list', reason: 'The source has no rows for this season.' }}
    >
      <DataTable
        key={view.key}
        caption={`${card.title}${views.length > 1 ? `: ${view.label}` : ''}`}
        columns={columns}
        rows={view.rows}
        rowKey={(r) => r.key}
        maxHeight={card.views ? 560 : 420}
        initialSort={view.sortKey ? { key: view.sortKey, desc: true } : undefined}
        highlight={(r) => r.highlight === true}
      />
    </Card>
  );
}

/** One card of a sport section, by kind. Knows nothing about which sport built it. */
export function ResearchCardView({ card }: { card: ResearchCard }) {
  switch (card.kind) {
    case 'odds':
      return card.scope === 'team'
        ? <TeamOddsSection sport={card.sport} gameId={card.gameId} teams={card.teams} side={card.side ?? 'home'} past={card.past ?? []} />
        : card.scope === 'game-final' && card.score && card.start
          ? <GameFinalOddsSection sport={card.sport} gameId={card.gameId} teams={card.teams} start={card.start} score={card.score} />
          : <GameOddsSection sport={card.sport} gameId={card.gameId} teams={card.teams} final={card.scope === 'game-final'} />;
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
  if (!item) return <Card title={card.title} state={{ kind: 'empty', title: 'Nothing to list', reason: 'The source has no items for this game.' }} />;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Card title={card.title} scope={card.scope} dense>
        {/* U3: the kit PickList (React Aria ListBox), grouped. */}
        <PickList
          label={card.title}
          className="max-h-[560px] overflow-y-auto pr-1"
          value={item.key}
          onChange={setPicked}
          items={card.items.map((i) => ({
            key: i.key,
            label: i.label,
            sub: i.sub ?? undefined,
            group: i.group,
            image: i.imageUrl ? <Avatar kind="player" label={i.label} src={i.imageUrl} size={26} decorative /> : undefined,
            badge: i.badge ?? undefined,
          }))}
        />
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
