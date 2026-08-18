'use client';

import { useState } from 'react';
import { TeamLogo, mlbHeadshotUrl, mlbTeamLogoUrl } from './SubjectAvatar';
import { ordinal, type OpposingStarterStat } from './PlayerDetail';
import { percentileOf, PercentileRing, ValuePercentile, RailMarker } from './PercentileRing';
import type { TeamBullpen, RankedPitcherSummary } from './useBullpen';
import { SegmentedToggle } from './SegmentedToggle';

/**
 * Pitching matchup card — two starters compared across three interchangeable
 * reads of the same percentile data (a dense scouting-sheet grid, head-to-head
 * bars, or shared percentile rails), with a full Pitchers roster underneath
 * (starter + bullpen, one list per side) whose names swap into the comparison
 * above when clicked — including the starter's own row, which is how you get
 * back to it after picking a reliever. Replaces GameDetail's old separate
 * `ProbablePitchers`/`BullpenCard` sections.
 *
 * Two fixed identity colours (not the app's red/green heat ramp) carry "which
 * side" across every view and the roster below — a stat's own goodness is
 * conveyed by percentile/length, not colour, so a colour only ever means "away"
 * or "home" here. Sourced from the same tokens GameDetail's own away/home
 * pairing uses (StatComparisonRow) rather than bespoke hex, so "home" reads
 * the same color on every card on the page.
 */
const AWAY_COLOR = '#97989b'; // ink-faint token — neutral, not a second brand color
const HOME_COLOR = '#0f7a4f'; // good token — the app's data-quality green, not the masters brand green

interface StatDef {
  key: string;
  label: string;
  decimals: number;
}

interface StatGroup {
  title: string;
  stats: StatDef[];
}

const STAT_GROUPS: StatGroup[] = [
  {
    title: 'Run prevention',
    stats: [
      { key: 'era', label: 'ERA', decimals: 2 },
      { key: 'fip', label: 'FIP', decimals: 2 },
      { key: 'whip', label: 'WHIP', decimals: 2 },
      { key: 'hits', label: 'Hits allowed', decimals: 0 },
    ],
  },
  {
    title: 'Swing & miss',
    stats: [
      { key: 'strikeOuts', label: 'Strikeouts', decimals: 0 },
      { key: 'kbbPct', label: 'K-BB%', decimals: 1 },
      { key: 'whiffPct', label: 'Whiffs%', decimals: 1 },
      { key: 'baseOnBalls', label: 'Walks allowed', decimals: 0 },
    ],
  },
  {
    title: 'Contact quality',
    stats: [
      { key: 'homeRuns', label: 'HR allowed', decimals: 0 },
      { key: 'barrelPct', label: 'Barrels%', decimals: 1 },
      { key: 'exitVelo', label: 'Avg exit velo', decimals: 1 },
      { key: 'hardHitPct', label: 'Hard-hit%', decimals: 1 },
    ],
  },
];

function byKey(stats: OpposingStarterStat[]): Map<string, OpposingStarterStat> {
  return new Map(stats.map((s) => [s.key, s]));
}

/** A bullpen arm's `values`/`ranks` (already on the wire from /api/mlb/bullpen — see useBullpen.ts) reshaped into the same OpposingStarterStat[] the starters use, so one set of view components renders either. */
function statsFromRanked(p: RankedPitcherSummary): OpposingStarterStat[] {
  const out: OpposingStarterStat[] = [];
  for (const group of STAT_GROUPS) {
    for (const def of group.stats) {
      const value = p.values?.[def.key];
      const rank = p.ranks?.[def.key];
      if (value == null || rank == null) continue;
      out.push({ key: def.key, label: def.label, value, decimals: def.decimals, rank, poolSize: p.poolSize });
    }
  }
  return out;
}

/** How many of the 12 compared stats each side's percentile edges the other on — ties (including both-missing) count for neither. */
function computeEdge(away: Map<string, OpposingStarterStat>, home: Map<string, OpposingStarterStat>) {
  let awayWins = 0;
  let homeWins = 0;
  for (const group of STAT_GROUPS) {
    for (const def of group.stats) {
      const ap = percentileOf(away.get(def.key));
      const hp = percentileOf(home.get(def.key));
      if (ap == null || hp == null) continue;
      if (ap > hp) awayWins++;
      else if (hp > ap) homeWins++;
    }
  }
  return { away: awayWins, home: homeWins };
}

function quickLine(stats: Map<string, OpposingStarterStat>): string | null {
  const era = stats.get('era');
  const k = stats.get('strikeOuts');
  const whip = stats.get('whip');
  const parts: string[] = [];
  if (era) parts.push(`${era.value.toFixed(2)} ERA`);
  if (k) parts.push(`${k.value.toFixed(0)} K`);
  if (whip) parts.push(`${whip.value.toFixed(2)} WHIP`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ---------------------------------------------------------------------------
// The pitcher currently occupying a side of the comparison — either side's
// probable starter by default, or whichever bullpen arm was last clicked.
// ---------------------------------------------------------------------------

interface ActivePitcher {
  /** Stable identity for highlighting the matching roster row and for a React key — `'starter'` or `rp-<personId>`. */
  selectionKey: string;
  personId?: number;
  name: string;
  stats: Map<string, OpposingStarterStat>;
  overallPercentile: number | null;
  overallRankLabel: string | null;
}

function starterPitcher(
  name: string | undefined,
  personId: number | null | undefined,
  stats: OpposingStarterStat[] | undefined,
  overallRank: { rank: number | null; poolSize: number } | undefined,
): ActivePitcher {
  return {
    selectionKey: 'starter',
    personId: personId ?? undefined,
    name: name || 'TBD',
    stats: byKey(stats ?? []),
    overallPercentile: overallRank?.rank != null ? percentileOf({ rank: overallRank.rank, poolSize: overallRank.poolSize }) : null,
    overallRankLabel: overallRank?.rank != null ? `${ordinal(overallRank.rank)} of ${overallRank.poolSize} starters` : null,
  };
}

function relieverPitcher(p: RankedPitcherSummary, poolLabel: string): ActivePitcher {
  return {
    selectionKey: `rp-${p.personId}`,
    personId: p.personId,
    name: p.fullName,
    stats: byKey(statsFromRanked(p)),
    overallPercentile: p.overallRank != null ? percentileOf({ rank: p.overallRank, poolSize: p.poolSize }) : null,
    overallRankLabel: p.overallRank != null ? `${ordinal(p.overallRank)} of ${p.poolSize} ${poolLabel}` : null,
  };
}

// ---------------------------------------------------------------------------
// Header — identity + edge badge, shared by every view. Reflects whichever
// pitcher is currently active on each side, starter or clicked-in reliever.
// ---------------------------------------------------------------------------

function PitcherHeader({
  pitcher,
  teamAbbr,
  teamLogoUrl,
  color,
  align,
}: {
  pitcher: ActivePitcher;
  teamAbbr: string;
  teamLogoUrl?: string;
  color: string;
  align: 'left' | 'right';
}) {
  const reversed = align === 'right';
  const line = quickLine(pitcher.stats);
  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${reversed ? 'flex-row-reverse text-right' : 'text-left'}`}>
      <PercentileRing percentile={pitcher.overallPercentile} color={color} headshotUrl={mlbHeadshotUrl(pitcher.personId)} teamLogoUrl={teamLogoUrl} name={pitcher.name} />
      <div className="min-w-0">
        <div className={`flex items-center gap-1 text-label font-semibold uppercase tracking-wide text-ink-faint ${reversed ? 'flex-row-reverse' : ''}`}>
          {teamAbbr}
        </div>
        <div className="truncate text-emphasis font-bold leading-tight" style={{ color }}>
          {pitcher.name}
        </div>
        {pitcher.overallRankLabel ? <div className="text-label text-ink-faint">{pitcher.overallRankLabel}</div> : null}
        {line ? <div className="mt-0.5 truncate text-meta text-ink-muted tabular-nums">{line}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// View 1 — scouting sheet: dense value+percentile grid, three stat groups
// side by side. Light-themed by design — same card surface as the rest of
// the app, not the dark panel the original mockup used.
// ---------------------------------------------------------------------------

function ScoutingRow({ def, away, home }: { def: StatDef; away?: OpposingStarterStat; home?: OpposingStarterStat }) {
  const ap = percentileOf(away);
  const hp = percentileOf(home);
  const awayWins = ap != null && hp != null && ap > hp;
  const homeWins = ap != null && hp != null && hp > ap;
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1.5">
      <span className="flex justify-end">
        <ValuePercentile value={away ? away.value.toFixed(def.decimals) : '—'} percentile={ap} color={AWAY_COLOR} winning={awayWins} reverse />
      </span>
      <span className="whitespace-nowrap text-center text-micro uppercase tracking-wide text-ink-faint">{def.label}</span>
      <ValuePercentile value={home ? home.value.toFixed(def.decimals) : '—'} percentile={hp} color={HOME_COLOR} winning={homeWins} />
    </div>
  );
}

function ScoutingBody({ away, home }: { away: Map<string, OpposingStarterStat>; home: Map<string, OpposingStarterStat> }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {STAT_GROUPS.map((group) => (
        <div key={group.title}>
          <div className="mb-1 text-label font-semibold uppercase tracking-wide text-ink-faint">{group.title}</div>
          <div className="divide-y divide-line rounded-md border border-line bg-card px-2.5">
            {group.stats.map((def) => (
              <ScoutingRow key={def.key} def={def} away={away.get(def.key)} home={home.get(def.key)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View 2 — head-to-head bars: every stat becomes a duel, bar length = percentile.
// ---------------------------------------------------------------------------

function HeadToHeadRow({ def, away, home }: { def: StatDef; away?: OpposingStarterStat; home?: OpposingStarterStat }) {
  const ap = percentileOf(away) ?? 0;
  const hp = percentileOf(home) ?? 0;
  return (
    <div className="py-1">
      <div className="grid grid-cols-[48px_1fr_1fr_48px] items-center gap-1.5">
        <span className="text-right text-meta font-semibold tabular-nums">{away ? away.value.toFixed(def.decimals) : '—'}</span>
        <div className="h-2 overflow-hidden rounded-full bg-line/60">
          <div className="ml-auto h-full rounded-full" style={{ width: `${ap}%`, backgroundColor: AWAY_COLOR }} />
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-line/60">
          <div className="h-full rounded-full" style={{ width: `${hp}%`, backgroundColor: HOME_COLOR }} />
        </div>
        <span className="text-meta font-semibold tabular-nums">{home ? home.value.toFixed(def.decimals) : '—'}</span>
      </div>
      <div className="text-center text-micro uppercase tracking-wide text-ink-faint">{def.label}</div>
    </div>
  );
}

function HeadToHeadBody({ away, home }: { away: Map<string, OpposingStarterStat>; home: Map<string, OpposingStarterStat> }) {
  return (
    <div className="space-y-3">
      {STAT_GROUPS.map((group) => (
        <div key={group.title}>
          <div className="mb-0.5 text-label font-semibold uppercase tracking-wide text-ink-faint">{group.title}</div>
          <div className="divide-y divide-line/50">
            {group.stats.map((def) => (
              <HeadToHeadRow key={def.key} def={def} away={away.get(def.key)} home={home.get(def.key)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View 3 — shared percentile rails: one league-wide scale per stat, both
// starters plotted on it as team-logo markers.
// ---------------------------------------------------------------------------

function RailsRow({
  def,
  away,
  home,
  awayLogoUrl,
  homeLogoUrl,
}: {
  def: StatDef;
  away?: OpposingStarterStat;
  home?: OpposingStarterStat;
  awayLogoUrl?: string;
  homeLogoUrl?: string;
}) {
  const ap = percentileOf(away);
  const hp = percentileOf(home);
  return (
    <div className="py-2">
      <div className="grid grid-cols-[44px_1fr_44px] items-center gap-2">
        <span className="text-right text-meta font-semibold tabular-nums">{away ? away.value.toFixed(def.decimals) : '—'}</span>
        {/* Fixed-height track so the markers' `top-1/2` centres on the rail itself, not on the row's overall content (which used to include the label and pushed the midpoint down onto it). */}
        <div className="relative h-[18px]">
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
          {ap != null ? <RailMarker pct={ap} color={AWAY_COLOR} logoUrl={awayLogoUrl} title={`${ap}th percentile`} /> : null}
          {hp != null ? <RailMarker pct={hp} color={HOME_COLOR} logoUrl={homeLogoUrl} title={`${hp}th percentile`} /> : null}
        </div>
        <span className="text-meta font-semibold tabular-nums">{home ? home.value.toFixed(def.decimals) : '—'}</span>
      </div>
      <div className="mt-1 text-center text-micro uppercase tracking-wide text-ink-faint">{def.label}</div>
    </div>
  );
}

function RailsBody({
  away,
  home,
  awayLogoUrl,
  homeLogoUrl,
}: {
  away: Map<string, OpposingStarterStat>;
  home: Map<string, OpposingStarterStat>;
  awayLogoUrl?: string;
  homeLogoUrl?: string;
}) {
  return (
    <div>
      <div className="mb-1 grid grid-cols-[44px_1fr_44px] gap-2 text-center text-micro uppercase tracking-wide text-ink-faint">
        <span />
        <span>Worse ← league percentile → better</span>
        <span />
      </div>
      {STAT_GROUPS.map((group) => (
        <div key={group.title} className="mb-2">
          <div className="mb-0.5 text-label font-semibold uppercase tracking-wide text-ink-faint">{group.title}</div>
          <div className="divide-y divide-line/50">
            {group.stats.map((def) => (
              <RailsRow key={def.key} def={def} away={away.get(def.key)} home={home.get(def.key)} awayLogoUrl={awayLogoUrl} homeLogoUrl={homeLogoUrl} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pitchers roster — the whole staff in one clickable list per side: starter
// first, then the bullpen depth chart. Clicking any name swaps that arm into
// the comparison above; clicking the starter's own row is how you get back
// to it, so there's no separate "reset" control to hunt for. The bullpen's
// setup array is already sorted by composite (bullpen route.ts), so position
// doubles as a Setup/Middle/Long depth label — display convention, not an
// official role the data actually carries.
// ---------------------------------------------------------------------------

const RELIEF_LABELS = ['Setup', 'Middle', 'Long'];

interface PitcherListEntry {
  pitcher: ActivePitcher;
  roleLabel: string;
  rankBadge: number | string;
}

function bullpenListEntries(bullpen: TeamBullpen | undefined): PitcherListEntry[] {
  if (!bullpen) return [];
  const entries: PitcherListEntry[] = [];
  if (bullpen.closer) {
    entries.push({ pitcher: relieverPitcher(bullpen.closer, 'qualified closers'), roleLabel: 'Closer', rankBadge: bullpen.closer.overallRank ?? '–' });
  }
  bullpen.setup.forEach((p, i) => {
    entries.push({ pitcher: relieverPitcher(p, 'qualified relievers'), roleLabel: RELIEF_LABELS[i] ?? 'Relief', rankBadge: p.overallRank ?? '–' });
  });
  return entries;
}

function PitcherRow({
  entry,
  color,
  align,
  active,
  onSelect,
}: {
  entry: PitcherListEntry;
  color: string;
  align: 'left' | 'right';
  active: boolean;
  onSelect: (pitcher: ActivePitcher) => void;
}) {
  const reversed = align === 'right';
  return (
    <button
      type="button"
      onClick={() => onSelect(entry.pitcher)}
      aria-pressed={active}
      title={active ? undefined : 'Compare this pitcher above'}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${reversed ? 'flex-row-reverse text-right' : ''} ${
        active ? 'bg-accent-soft' : 'hover:bg-ink/[0.04]'
      }`}
      style={active ? { boxShadow: `inset 0 0 0 1.5px ${color}` } : undefined}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-meta font-bold text-white"
        style={{ backgroundColor: color }}
        title={entry.pitcher.overallRankLabel ?? undefined}
      >
        {entry.rankBadge}
      </span>
      <span className="min-w-0 flex-1">
        <div className="truncate text-dense font-semibold">{entry.pitcher.name}</div>
        <div className="text-micro uppercase tracking-wide text-ink-faint">{entry.roleLabel}</div>
      </span>
    </button>
  );
}

function PitchersColumn({
  abbr,
  teamLogoUrl,
  starterEntry,
  bullpenEntries,
  bullpenLoading,
  color,
  align,
  activeKey,
  onSelect,
}: {
  abbr: string;
  teamLogoUrl?: string;
  starterEntry: PitcherListEntry;
  bullpenEntries: PitcherListEntry[];
  bullpenLoading: boolean;
  color: string;
  align: 'left' | 'right';
  activeKey: string;
  onSelect: (pitcher: ActivePitcher) => void;
}) {
  const reversed = align === 'right';
  return (
    <div className={reversed ? 'text-right' : 'text-left'}>
      <div className={`mb-1.5 flex items-center gap-1.5 text-dense font-semibold ${reversed ? 'flex-row-reverse' : ''}`}>
        <TeamLogo logoUrl={teamLogoUrl} abbreviation={abbr} size={15} />
      </div>
      <div className="space-y-1">
        <PitcherRow entry={starterEntry} color={color} align={align} active={activeKey === starterEntry.pitcher.selectionKey} onSelect={onSelect} />
        {bullpenLoading ? (
          <div className="h-16 animate-pulse rounded-md bg-ink/[0.03]" />
        ) : (
          bullpenEntries.map((entry) => (
            <PitcherRow key={entry.pitcher.selectionKey} entry={entry} color={color} align={align} active={activeKey === entry.pitcher.selectionKey} onSelect={onSelect} />
          ))
        )}
      </div>
    </div>
  );
}

function PitchersSection({
  awayAbbr,
  homeAbbr,
  awayLogoUrl,
  homeLogoUrl,
  awayStarterEntry,
  homeStarterEntry,
  awayBullpenEntries,
  homeBullpenEntries,
  bullpenLoading,
  activeAwayKey,
  activeHomeKey,
  onSelectAway,
  onSelectHome,
}: {
  awayAbbr: string;
  homeAbbr: string;
  awayLogoUrl?: string;
  homeLogoUrl?: string;
  awayStarterEntry: PitcherListEntry;
  homeStarterEntry: PitcherListEntry;
  awayBullpenEntries: PitcherListEntry[];
  homeBullpenEntries: PitcherListEntry[];
  bullpenLoading: boolean;
  activeAwayKey: string;
  activeHomeKey: string;
  onSelectAway: (pitcher: ActivePitcher) => void;
  onSelectHome: (pitcher: ActivePitcher) => void;
}) {
  return (
    <div className="mt-3 border-t border-line pt-3">
      <h3 className="mb-2 text-meta font-semibold uppercase tracking-wide text-ink-muted">Pitchers</h3>
      <div className="grid grid-cols-2 gap-3">
        <PitchersColumn
          abbr={awayAbbr}
          teamLogoUrl={awayLogoUrl}
          starterEntry={awayStarterEntry}
          bullpenEntries={awayBullpenEntries}
          bullpenLoading={bullpenLoading}
          color={AWAY_COLOR}
          align="left"
          activeKey={activeAwayKey}
          onSelect={onSelectAway}
        />
        <PitchersColumn
          abbr={homeAbbr}
          teamLogoUrl={homeLogoUrl}
          starterEntry={homeStarterEntry}
          bullpenEntries={homeBullpenEntries}
          bullpenLoading={bullpenLoading}
          color={HOME_COLOR}
          align="right"
          activeKey={activeHomeKey}
          onSelect={onSelectHome}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

type ViewKey = 'scouting' | 'h2h' | 'rails';
const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: 'scouting', label: 'Scouting' },
  { key: 'h2h', label: 'Head-to-head' },
  { key: 'rails', label: 'Rails' },
];

/** Minimal shape this card needs — deliberately not importing `GameDetailGame` (which lives in the file that renders this card) to avoid a circular import; structural typing makes any superset, including `GameDetailGame`, assignable here. */
export interface PitchingMatchupGame {
  matchup?: string;
  awayTeamId?: number;
  homeTeamId?: number;
  awayStarter?: string;
  homeStarter?: string;
  awayStarterId?: number | null;
  homeStarterId?: number | null;
  awayStarterStats?: OpposingStarterStat[];
  homeStarterStats?: OpposingStarterStat[];
  awayStarterOverallRank?: { rank: number | null; poolSize: number };
  homeStarterOverallRank?: { rank: number | null; poolSize: number };
}

export function PitchingMatchupCard({
  game,
  bullpen,
  bullpenLoading,
}: {
  game: PitchingMatchupGame;
  bullpen: Record<number, TeamBullpen>;
  bullpenLoading: boolean;
}) {
  const [view, setView] = useState<ViewKey>('scouting');
  const [awaySelection, setAwaySelection] = useState<ActivePitcher | null>(null);
  const [homeSelection, setHomeSelection] = useState<ActivePitcher | null>(null);

  if (!game.awayStarter && !game.homeStarter) return null;
  const [awayAbbr, homeAbbr] = (game.matchup ?? '').split('@').map((s) => s.trim());
  const awayLogoUrl = mlbTeamLogoUrl(game.awayTeamId);
  const homeLogoUrl = mlbTeamLogoUrl(game.homeTeamId);

  const awayStarter = starterPitcher(game.awayStarter, game.awayStarterId, game.awayStarterStats, game.awayStarterOverallRank);
  const homeStarter = starterPitcher(game.homeStarter, game.homeStarterId, game.homeStarterStats, game.homeStarterOverallRank);
  const activeAway = awaySelection ?? awayStarter;
  const activeHome = homeSelection ?? homeStarter;

  const awayStarterEntry: PitcherListEntry = { pitcher: awayStarter, roleLabel: 'SP', rankBadge: game.awayStarterOverallRank?.rank ?? '–' };
  const homeStarterEntry: PitcherListEntry = { pitcher: homeStarter, roleLabel: 'SP', rankBadge: game.homeStarterOverallRank?.rank ?? '–' };
  const awayBullpenEntries = bullpenListEntries(game.awayTeamId != null ? bullpen[game.awayTeamId] : undefined);
  const homeBullpenEntries = bullpenListEntries(game.homeTeamId != null ? bullpen[game.homeTeamId] : undefined);

  const selectPitcher = (setSelection: (p: ActivePitcher | null) => void) => (pitcher: ActivePitcher) =>
    setSelection(pitcher.selectionKey === 'starter' ? null : pitcher);

  const edge = computeEdge(activeAway.stats, activeHome.stats);
  const hasStats = activeAway.stats.size > 0 || activeHome.stats.size > 0;

  return (
    <section className="lb-card p-3">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-meta font-semibold uppercase tracking-wide text-ink-muted">Pitching matchup</h2>
        {hasStats ? (
          <SegmentedToggle
            value={view}
            onChange={setView}
            className="rounded-lg border border-line p-0.5 text-meta"
            buttonClassName="rounded-md px-2 py-0.5"
            gliderClassName="rounded-md"
            options={VIEWS}
          />
        ) : null}
      </div>

      <div className="flex items-start justify-between gap-2">
        <PitcherHeader pitcher={activeAway} teamAbbr={awayAbbr} teamLogoUrl={awayLogoUrl} color={AWAY_COLOR} align="left" />
        {hasStats && (edge.away > 0 || edge.home > 0) ? (
          <div className="flex shrink-0 flex-col items-center pt-1.5">
            <span className="text-micro font-semibold uppercase tracking-wide text-ink-faint">Stat edge</span>
            <span className="text-emphasis font-bold tabular-nums">
              <span style={{ color: AWAY_COLOR }}>{edge.away}</span>
              <span className="text-ink-faint"> – </span>
              <span style={{ color: HOME_COLOR }}>{edge.home}</span>
            </span>
          </div>
        ) : null}
        <PitcherHeader pitcher={activeHome} teamAbbr={homeAbbr} teamLogoUrl={homeLogoUrl} color={HOME_COLOR} align="right" />
      </div>

      {hasStats ? (
        <div className="mt-3 border-t border-line pt-3">
          {view === 'scouting' ? <ScoutingBody away={activeAway.stats} home={activeHome.stats} /> : null}
          {view === 'h2h' ? <HeadToHeadBody away={activeAway.stats} home={activeHome.stats} /> : null}
          {view === 'rails' ? <RailsBody away={activeAway.stats} home={activeHome.stats} awayLogoUrl={awayLogoUrl} homeLogoUrl={homeLogoUrl} /> : null}
        </div>
      ) : null}

      <PitchersSection
        awayAbbr={awayAbbr}
        homeAbbr={homeAbbr}
        awayLogoUrl={awayLogoUrl}
        homeLogoUrl={homeLogoUrl}
        awayStarterEntry={awayStarterEntry}
        homeStarterEntry={homeStarterEntry}
        awayBullpenEntries={awayBullpenEntries}
        homeBullpenEntries={homeBullpenEntries}
        bullpenLoading={bullpenLoading}
        activeAwayKey={activeAway.selectionKey}
        activeHomeKey={activeHome.selectionKey}
        onSelectAway={selectPitcher(setAwaySelection)}
        onSelectHome={selectPitcher(setHomeSelection)}
      />
    </section>
  );
}

export default PitchingMatchupCard;
