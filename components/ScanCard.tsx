'use client';

import { useMemo, useState } from 'react';
import type { PickCandidate, HistoryEntry, SplitEvidence } from '@/lib/core/types';
import type { WindowedStat } from '@/lib/core/windowedStat';
import { formatDistance, formatEta } from '@/lib/core/timing';
import { openWindow } from '@/lib/core/windowedStat';
import { gradientCardStyle, toneFill, deltaToHeat, compareInk } from '@/lib/ui/heat';
import { toSeries, seriesScale } from '@/lib/ui/series';
import type { FormReading } from '@/lib/core/pickEngine';
import { SubjectAvatar, TeamLogo, mlbTeamLogoUrl, nflTeamLogoUrl } from './SubjectAvatar';
import { MarketLine } from './MarketLabel';
import { formatRate, InsufficientMark } from './StatCells';
import { InsightList } from './InsightRow';
import { resolveCandidateEdge, type PropOddsRow } from './usePropOdds';
import { computePropScore } from '@/lib/odds/props/propScore';
import type { MarketTrust } from '@/lib/odds/props/marketTrust';

/** The distance chip. Exact counts are loud; estimates are quiet and marked. */
function TimingChip({ candidate }: { candidate: PickCandidate }) {
  const { status, distanceToSubject, distanceUnit } = candidate.liveState;
  const eta = formatEta(candidate.liveState);

  if (status === 'done') {
    return <span className="lb-chip bg-ink/5 text-ink-muted">Complete</span>;
  }
  if (status === 'pre') {
    return <span className="lb-chip bg-accent-soft text-masters">Not started</span>;
  }
  if (status === 'unknown' || distanceToSubject === null) {
    return (
      <span className="lb-chip bg-warn/10 text-warn" title={candidate.liveState.note}>
        Position unknown
      </span>
    );
  }

  const imminent = distanceToSubject <= 2;
  return (
    <span
      className={`lb-chip ${imminent ? 'bg-masters text-white' : 'bg-accent-soft text-masters'}`}
      title={candidate.liveState.note}
    >
      {formatDistance(distanceToSubject, distanceUnit)}
      {eta ? <span className="font-normal opacity-75"> · {eta}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Window choices — one per clickable stat row, each carrying the exact games
// that back it so the strip above can redraw when the row changes.
// ---------------------------------------------------------------------------

interface WindowChoice {
  key: string;
  label: string;
  stat: WindowedStat;
  games: HistoryEntry[];
}

function entryMeta(entry: HistoryEntry): { opponentId?: number; opponentAbbr?: string; isHome?: boolean } {
  const raw = entry.raw as { opponentId?: number; opponentAbbr?: string; isHome?: boolean } | null;
  return { opponentId: raw?.opponentId, opponentAbbr: raw?.opponentAbbr, isHome: raw?.isHome };
}

/**
 * The exact games behind a split, reconstructed client-side.
 *
 * `SplitEvidence` only carries the computed `WindowedStat`, not the entries
 * that fed it — the adapter's predicate never leaves the server. Head-to-head
 * and venue splits are cheap to reproduce exactly (same `opponentId`/`isHome`
 * fields every entry already carries); a "Last N" split is a slice. Anything
 * else falls back to "however many games the stat says it measured", which is
 * inexact but never wrong about the count.
 */
function gamesForSplit(split: SplitEvidence, candidate: PickCandidate): HistoryEntry[] {
  const meta = (candidate.subjectMeta ?? {}) as Record<string, unknown>;

  if (split.kind === 'head-to-head' && typeof meta.opponentId === 'number') {
    return candidate.history.filter((e) => entryMeta(e).opponentId === meta.opponentId);
  }
  if (split.kind === 'venue-split' && typeof meta.isHome === 'boolean') {
    return candidate.history.filter((e) => entryMeta(e).isHome === meta.isHome);
  }
  const lastN = /last (\d+)/i.exec(split.label);
  if (lastN) return candidate.history.slice(-Number(lastN[1]));
  if (split.stat.status === 'ok') return candidate.history.slice(-split.stat.total);
  return [];
}

// ---------------------------------------------------------------------------
// The headline gradient box — the one number the card is asserting, styled
// with the same glow/meter treatment as the window boxes on the detail page.
// ---------------------------------------------------------------------------

function HeadlineGradientBox({ stat }: { stat: WindowedStat }) {
  if (stat.status === 'insufficient') {
    return (
      <div className="w-full rounded-xl border border-line bg-card px-3 py-3 text-center">
        <InsufficientMark available={stat.available} required={stat.required} className="text-[13px]" />
        <div className="mt-1 text-[10px] text-ink-faint">needs {stat.required}</div>
      </div>
    );
  }

  const gradient = gradientCardStyle(stat.rate);
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border border-black/[0.06] bg-card px-3 py-3 text-center"
      style={{ boxShadow: gradient.boxShadow }}
    >
      <div className="pointer-events-none absolute -inset-3" style={{ background: gradient.labelGlow }} />
      <div className="relative text-[26px] font-bold leading-none tabular-nums" style={{ color: gradient.valueColor }}>
        {formatRate(stat.rate)}
      </div>
      <div className="relative mt-1 text-[10px] tabular-nums text-ink-faint">
        {stat.hits}/{stat.total}
      </div>
      <div className="relative mt-2 h-1.5 rounded-full bg-black/[0.06]">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.round(stat.rate * 100)}%`, background: gradient.fillBackground }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The game strip — bars (not dots), each with the opponent's logo underneath.
// ---------------------------------------------------------------------------

function GameStrip({ games, sport }: { games: HistoryEntry[]; sport: PickCandidate['sport'] }) {
  if (games.length === 0) {
    return <p className="py-2 text-[11px] text-ink-faint">No games in this window.</p>;
  }

  const points = toSeries(games);
  const { min, max } = seriesScale(points);
  const span = Math.max(max - min, 1);
  const height = 30;

  // Capped so a long window (L15, a full season) still reads as bars rather
  // No cap on count — a full L15/season window scrolls rather than losing
  // its oldest games to an arbitrary limit.
  return (
    <div className="lb-scroll-x flex items-end gap-1 pb-0.5">
      {games.map((entry, i) => {
        const point = points[i];
        const magnitude = Math.abs(point.value) / span;
        const barHeight = point.unknown ? 2 : Math.max(2, magnitude * height);
        const entryOpponent = entryMeta(entry);
        const logoUrl =
          sport === 'mlb' && entryOpponent.opponentId != null
            ? mlbTeamLogoUrl(entryOpponent.opponentId)
            : sport === 'nfl' && entryOpponent.opponentAbbr
              ? nflTeamLogoUrl(entryOpponent.opponentAbbr)
              : undefined;

        return (
          <div
            key={`${entry.period}-${i}`}
            className="flex w-6 shrink-0 flex-col items-center gap-1"
            title={`${entry.periodLabel ? `${entry.periodLabel}: ` : ''}${point.label}`}
          >
            <div className="flex h-[30px] w-full items-end justify-center">
              <span
                className="w-full max-w-[16px] rounded-[2px]"
                style={{ height: `${barHeight}px`, backgroundColor: toneFill(point.tone, point.unknown ? 0.25 : 0.85) }}
              />
            </div>
            {logoUrl ? (
              <img src={logoUrl} alt="" aria-hidden loading="lazy" decoding="async" className="h-3.5 w-3.5 object-contain" />
            ) : (
              <span aria-hidden className="h-3.5 w-3.5 rounded-full bg-line" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A clickable stat row — selecting one repaints the strip and headline box.
// ---------------------------------------------------------------------------

function WindowRow({
  choice,
  active,
  onSelect,
}: {
  choice: WindowChoice;
  active: boolean;
  onSelect: () => void;
}) {
  const { stat } = choice;
  const insufficient = stat.status === 'insufficient';
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={insufficient}
        aria-pressed={active}
        className={`flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors ${
          active ? 'bg-accent-soft' : insufficient ? 'cursor-default' : 'hover:bg-ink/5'
        }`}
      >
        <span className={`min-w-0 flex-1 truncate ${active ? 'font-semibold text-ink' : 'text-ink-muted'}`}>{choice.label}</span>
        {stat.status === 'insufficient' ? (
          <InsufficientMark available={stat.available} required={stat.required} />
        ) : (
          <span className="shrink-0 font-semibold tabular-nums" style={{ color: gradientCardStyle(stat.rate).valueColor }}>
            {formatRate(stat.rate)}
          </span>
        )}
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export interface ScanCardProps {
  candidate: PickCandidate;
  form?: FormReading;
  added: boolean;
  watched: boolean;
  onAdd: (candidate: PickCandidate, odds?: { americanOdds: string; source: string; bookmaker?: string }) => void;
  onToggleWatch: (subjectId: string, subjectName: string) => void;
  /** Real book prices from the five-provider feed, across the whole slate — same shape ScanTable already threads through, needed to compute Prop Score v1's live-edge component. */
  propRows?: PropOddsRow[];
  userSportsbook?: string;
  /** Prop Score v1's Market Trust badge per dimension. */
  trustTiers?: ReadonlyMap<string, MarketTrust>;
}

export function ScanCard({ candidate, form, added, watched, onAdd, onToggleWatch, propRows = [], userSportsbook = 'fanatics', trustTiers }: ScanCardProps) {
  const meta = candidate.subjectMeta ?? {};
  const team = typeof meta.team === 'string' ? meta.team : undefined;
  const position = typeof meta.position === 'string' ? meta.position : undefined;
  const projected = meta.lineupProjected === true;
  const opponent = typeof meta.opponent === 'string' ? meta.opponent : undefined;
  const isHome = meta.isHome === true;
  const weather = candidate.context?.weather;
  const headshotUrl = typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined;
  const flagUrl = typeof meta.flagUrl === 'string' ? meta.flagUrl : undefined;
  const teamLogoUrl = typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined;

  // Prop Score v1 — same resolution ScanTable's row-building already does,
  // computed per-render (not locked) so it stays live as prices move. Also
  // reused below for "Add to slip", so a card with a real live price
  // auto-fills it rather than leaving the slip to ask for one by hand.
  const trustTier = trustTiers?.get(candidate.dimension) ?? null;
  const edgeInfo = resolveCandidateEdge(candidate, propRows, userSportsbook);
  const propScore = trustTier === 'excluded' ? null : computePropScore(candidate, edgeInfo);
  const addOdds =
    edgeInfo.price != null
      ? { americanOdds: String(edgeInfo.price), source: edgeInfo.priceSource ?? 'odds-api', bookmaker: edgeInfo.bookmaker }
      : undefined;

  // Rate-bearing splits (Last 5/10/15, H2H, venue, …) drive the clickable
  // rows; a split carrying its own `figure` — a rank, a wind speed — has no
  // rate to put in a gradient box, so it's shown separately and never
  // interactive. Weather gets its own note below, same as before.
  const rateSplits = (candidate.supportingSplits ?? []).filter((s) => s.figure == null);
  const contextSplits = (candidate.supportingSplits ?? []).filter((s) => s.figure != null);

  // The headline is what the card is actually asserting when the adapter
  // supplied no splits at all — a consistent pattern claims its whole
  // history; anything else claims its trailing window.
  const headline = candidate.consistent
    ? openWindow(candidate.history, candidate.category, { minimum: 1 })
    : (form?.recent ?? openWindow(candidate.history, candidate.category, { minimum: 1 }));

  const choices: WindowChoice[] = useMemo(() => {
    if (rateSplits.length > 0) {
      return rateSplits.map((s, i) => ({
        key: `${s.kind}-${i}`,
        label: s.label,
        stat: s.stat,
        games: gamesForSplit(s, candidate),
      }));
    }
    return [
      {
        key: 'headline',
        label: candidate.consistent ? `Every one of ${candidate.sampleSize}` : 'Recent form',
        stat: headline,
        games: candidate.consistent ? candidate.history : candidate.history.slice(-(form?.windowSize ?? 5)),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate]);

  const [selectedKey, setSelectedKey] = useState<string>(
    () => choices.find((c) => c.stat.status === 'ok')?.key ?? choices[0].key,
  );
  const selected = choices.find((c) => c.key === selectedKey) ?? choices[0];

  return (
    <article className="lb-card lb-card-interactive p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {teamLogoUrl || team ? <TeamLogo logoUrl={teamLogoUrl} abbreviation={team} size={14} /> : null}
          {position ? <span className="lb-chip bg-ink/5 text-ink-muted">{position}</span> : null}
        </div>
        <TimingChip candidate={candidate} />
      </div>

      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[132px_1fr]">
        {/* LEFT — identity and CTA */}
        <div className="flex flex-col items-center gap-2 text-center sm:items-start sm:text-left">
          <SubjectAvatar name={candidate.subjectName} headshotUrl={headshotUrl} fallbackUrl={flagUrl ?? teamLogoUrl} size={40} />
          <div className="min-w-0">
            <h3 className="truncate text-[14px] font-semibold leading-tight">{candidate.subjectName}</h3>
            <p className="truncate text-[11px] text-ink-muted">
              {[team, position].filter(Boolean).join(' ')}
              {opponent ? ` ${isHome ? 'vs' : '@'} ${opponent}` : ''}
            </p>
          </div>
          <MarketLine
            sport={candidate.sport}
            dimension={candidate.dimension}
            category={candidate.category}
            line={candidate.line}
            className="!text-[12px] font-semibold !text-masters"
          />


          <HeadlineGradientBox stat={selected.stat} />

          <button
            type="button"
            onClick={() => onAdd(candidate, addOdds)}
            disabled={added}
            className={`w-full rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors ${
              added ? 'bg-accent-soft text-masters' : 'bg-masters text-white active:bg-masters-dark'
            }`}
          >
            {added ? 'On slip ✓' : 'Add to slip'}
          </button>
          <button
            type="button"
            onClick={() => onToggleWatch(candidate.subjectId, candidate.subjectName)}
            aria-pressed={watched}
            aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
            className={`w-full rounded-lg border px-3 py-2 text-[13px] font-semibold ${
              watched ? 'border-masters bg-accent-soft text-masters' : 'border-line text-ink-muted'
            }`}
          >
            {watched ? '★ Watching' : '☆ Watch'}
          </button>
        </div>

        {/* RIGHT — the breakdown: games behind whichever row is selected,
            then the full list of rows themselves. */}
        <div className="min-w-0">
          <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{selected.label}</div>
          <GameStrip games={selected.games} sport={candidate.sport} />

          <ul className="mt-1 divide-y divide-line/60">
            {choices.map((choice) => (
              <WindowRow key={choice.key} choice={choice} active={choice.key === selected.key} onSelect={() => setSelectedKey(choice.key)} />
            ))}
          </ul>

          {contextSplits.length > 0 ? <InsightList splits={contextSplits} className="mt-2 border-t border-line/60 pt-2" /> : null}
        </div>
      </div>

      {weather ? (
        <p className="mt-2 text-[11px] text-ink-faint">
          {weather.tempF != null ? `${weather.tempF}°F · ` : ''}Wind {weather.windMph} mph {weather.windDir}
          {weather.rainPct > 20 ? ` · ${weather.rainPct}% rain` : ''}
        </p>
      ) : null}

      {projected ? (
        <p className="mt-2 text-[11px] text-warn">Lineup not posted — batting order projected from last game.</p>
      ) : null}

      {form && Math.abs(form.streak) > 1 ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span className="font-semibold tabular-nums" style={{ color: compareInk(form.streak > 0 ? 0.95 : 0.06) }}>
            {form.streak > 0 ? `+${form.streak}` : form.streak}
          </span>
          {form.streak > 0 ? 'in a row' : 'straight misses'}
          {form.delta !== null && Math.abs(form.delta) > 0.05 ? (
            <span style={{ color: compareInk(deltaToHeat(form.delta)) }}>
              · {form.delta > 0 ? 'trending up' : 'cooling'} ({form.delta > 0 ? '+' : ''}
              {Math.round(form.delta * 100)} pts vs season)
            </span>
          ) : null}
        </p>
      ) : null}
    </article>
  );
}

export default ScanCard;
