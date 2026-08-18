'use client';

import type { ReactNode } from 'react';
import type { BookmakerOdds, UnifiedGameLine, UnifiedLinesResult } from '@/lib/odds/types';
import {
  EXHAUSTED_CREDIT_THRESHOLD,
  LOW_CREDIT_THRESHOLD,
  decimalToAmerican,
  formatAmerican,
  formatClock,
  formatPoint,
  formatStamp,
  homeShare,
  isInPlay,
  rankOf,
  shortTeam,
  sourceLabel,
  type ProjectedLine,
} from '@/lib/odds/display';
import { compareInk, rankToHeat } from '@/lib/ui/heat';

// ---------------------------------------------------------------------------
// Numbers as the anchor
// ---------------------------------------------------------------------------

/**
 * One headline figure. The value carries the visual weight; the label sits
 * under it, small and quiet, because nobody scans a card looking for the word
 * "moneyline".
 */
function StatCell({
  label,
  children,
  title,
}: {
  label: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className="min-w-0" title={title}>
      <div className="flex items-baseline gap-1.5">{children}</div>
      <div className="lb-stat-label truncate">{label}</div>
    </div>
  );
}

function OddsValue({ price, className = '' }: { price?: number; className?: string }) {
  return (
    <span className={`text-[19px] font-semibold leading-none tabular-nums ${className}`}>
      {formatAmerican(price)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Live score
// ---------------------------------------------------------------------------

export function LiveScoreBar({
  liveScore,
  livePeriod,
  awayLabel,
  homeLabel,
}: {
  liveScore: { home: string; away: string };
  livePeriod?: string;
  awayLabel: string;
  homeLabel: string;
}) {
  // OddsPortal keeps finished games in the live feed; a pulsing dot on a final
  // score claims a freshness that isn't there.
  const inPlay = isInPlay(livePeriod);

  return (
    <div className="mb-2.5 flex items-center gap-3 rounded-lg bg-accent-soft/60 px-3 py-2 shadow-live">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${inPlay ? 'bg-bad animate-lb-pulse' : 'bg-ink-faint'}`}
        aria-hidden
      />
      <div className="min-w-0">
        {/* Scores are strings — OddsPortal sends "—" and "NP" — never parsed. */}
        <div className="text-2xl font-semibold leading-none tabular-nums text-masters">
          {liveScore.away} <span className="text-ink-faint">–</span> {liveScore.home}
        </div>
        <div className="lb-stat-label truncate">
          {awayLabel} at {homeLabel}
        </div>
      </div>
      {livePeriod ? (
        <span className="ml-auto shrink-0 text-[11px] font-semibold uppercase tracking-wide text-masters">
          {/* Rendered verbatim: "Top 3rd", "Half-time", "1st Set" are all valid. */}
          {livePeriod}
        </span>
      ) : null}
      <span className="sr-only">{inPlay ? 'Live' : 'Not in play'}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-bookmaker comparison
// ---------------------------------------------------------------------------

/**
 * How one book splits the matchup, as a 60px segmented bar.
 *
 * Green is the home side's normalised implied probability, so a wider green
 * segment means that book leans harder toward the home team than its peers.
 */
function ProbabilitySplit({ share }: { share: number | null }) {
  if (share === null) {
    return <span className="block h-1.5 w-[60px] rounded-full bg-line" aria-hidden />;
  }
  const pct = Math.round(share * 100);
  return (
    <span
      className="flex h-1.5 w-[60px] overflow-hidden rounded-full bg-line"
      title={`${pct}% home / ${100 - pct}% away (vig removed)`}
      aria-hidden
    >
      <span className="h-full bg-masters" style={{ width: `${pct}%` }} />
      <span className="h-full flex-1 bg-accent/40" />
    </span>
  );
}

export function BookmakerBreakdown({
  bookmakers,
  selectedBook,
  awayLabel,
  homeLabel,
}: {
  bookmakers: BookmakerOdds[];
  selectedBook?: string | null;
  awayLabel: string;
  homeLabel: string;
}) {
  if (bookmakers.length === 0) return null;

  // "Best" is only meaningful against the other prices on screen, so each side
  // is ranked within its own observed range.
  const awayPrices = bookmakers.map((b) => b.awayOdds).filter((v): v is number => v != null && Number.isFinite(v));
  const homePrices = bookmakers.map((b) => b.homeOdds).filter((v): v is number => v != null && Number.isFinite(v));
  const awayRange = rankOf(awayPrices);
  const homeRange = rankOf(homePrices);

  const priceStyle = (decimal: number | undefined, range: { min: number; max: number } | null) =>
    decimal == null || range == null ? undefined : { color: compareInk(rankToHeat(decimal, range.min, range.max)) };

  return (
    <details className="group mt-2.5 rounded-lg border border-line bg-paper/60 open:shadow-pop">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[11px] font-medium text-ink-muted">
        <span className="text-ink-faint transition-transform group-open:rotate-90" aria-hidden>
          ›
        </span>
        {bookmakers.length} bookmaker{bookmakers.length === 1 ? '' : 's'}
        <span className="ml-auto text-[10px] text-ink-faint">
          {awayLabel} / {homeLabel}
        </span>
      </summary>

      <ul className="border-t border-line px-2.5 py-1.5">
        {bookmakers.map((book) => {
          const selected = selectedBook === book.bookmaker;
          return (
            <li
              key={book.bookmaker}
              className={`flex items-center gap-2 rounded px-1 py-1 ${
                selected ? 'bg-accent-soft' : ''
              }`}
            >
              <span
                className={`min-w-0 flex-1 truncate text-[11px] ${
                  selected ? 'font-semibold text-masters' : 'text-ink-muted'
                }`}
              >
                {book.bookmaker}
              </span>
              <ProbabilitySplit share={homeShare(book.homeOdds, book.awayOdds)} />
              <span
                className="w-11 shrink-0 text-right text-[12px] font-semibold tabular-nums"
                style={priceStyle(book.awayOdds, awayRange)}
              >
                {formatAmerican(decimalToAmerican(book.awayOdds))}
              </span>
              <span
                className="w-11 shrink-0 text-right text-[12px] font-semibold tabular-nums"
                style={priceStyle(book.homeOdds, homeRange)}
              >
                {formatAmerican(decimalToAmerican(book.homeOdds))}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="px-2.5 pb-2 text-[10px] text-ink-faint">
        Colour compares each price against the others listed — green is the best of these books.
      </p>
    </details>
  );
}

// ---------------------------------------------------------------------------
// A game's lines
// ---------------------------------------------------------------------------

export interface GameLineProps {
  line: ProjectedLine;
  awayTeam: string;
  homeTeam: string;
  /** Preferred short labels, e.g. the "BOS @ NYY" abbreviations. */
  awayLabel?: string;
  homeLabel?: string;
  selectedBook?: string | null;
  /** League-feed score, which outranks whatever the scraper captured. */
  liveScore?: { home: string; away: string };
  livePeriod?: string;
}

export function GameLineBlock({
  line,
  awayTeam,
  homeTeam,
  awayLabel,
  homeLabel,
  selectedBook,
  liveScore,
  livePeriod,
}: GameLineProps) {
  const away = awayLabel ?? shortTeam(awayTeam);
  const home = homeLabel ?? shortTeam(homeTeam);
  const score = liveScore ?? line.liveScore;
  const period = liveScore ? livePeriod : line.livePeriod;

  if (!line.available) {
    return (
      <div className="mt-2.5 border-t border-line pt-2.5">
        {score ? (
          <LiveScoreBar liveScore={score} livePeriod={period} awayLabel={away} homeLabel={home} />
        ) : null}
        <p className="text-[11px] text-ink-faint">No lines from this source for this game.</p>
      </div>
    );
  }

  const hasAnything = line.moneyline || line.total?.point != null || line.spread?.homePoint != null;

  return (
    <div className="mt-2.5 border-t border-line pt-2.5">
      {score ? (
        <LiveScoreBar liveScore={score} livePeriod={period} awayLabel={away} homeLabel={home} />
      ) : null}

      {hasAnything ? (
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2.5">
          {line.moneyline ? (
            <StatCell label={`Moneyline · ${away} / ${home}`}>
              <OddsValue price={line.moneyline.away} />
              <span className="text-sm text-ink-faint">/</span>
              <OddsValue price={line.moneyline.home} />
            </StatCell>
          ) : null}

          {line.total?.point != null ? (
            <StatCell
              label={`Total · o${formatAmerican(line.total.overPrice)} u${formatAmerican(line.total.underPrice)}`}
            >
              <span className="text-[19px] font-semibold leading-none tabular-nums">{line.total.point}</span>
            </StatCell>
          ) : null}

          {line.spread?.homePoint != null ? (
            <StatCell label={`${home} spread${line.spread.homePrice != null ? ` · ${formatAmerican(line.spread.homePrice)}` : ''}`}>
              <span className="text-[19px] font-semibold leading-none tabular-nums">
                {formatPoint(line.spread.homePoint)}
              </span>
            </StatCell>
          ) : null}

          {/* bookCount spans both feeds; the dropdown below counts only the
              scraper's books, so the two figures can legitimately differ. */}
          <StatCell label={line.headlineBook ? 'showing' : `book${line.bookCount === 1 ? '' : 's'} surveyed`}>
            <span className="text-[19px] font-semibold leading-none tabular-nums text-masters">
              {line.headlineBook ?? line.bookCount}
            </span>
          </StatCell>
        </div>
      ) : (
        <p className="text-[11px] text-ink-faint">No priced markets for this game yet.</p>
      )}

      <BookmakerBreakdown
        bookmakers={line.bookmakers}
        selectedBook={selectedBook}
        awayLabel={away}
        homeLabel={home}
      />

      <p className="mt-2 text-[10px] text-ink-faint">
        {sourceLabel(line.source)}
        {line.headlineBook
          ? ` · showing ${line.headlineBook}`
          : line.moneyline?.book
            ? ` · best price at ${line.moneyline.book}`
            : ''}{' '}
        &middot; reference only, check your book
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feed status — freshness, sources, credits, degraded states
// ---------------------------------------------------------------------------

export function OddsStatusPanel({ result }: { result: UnifiedLinesResult }) {
  const credits = result.sources?.oddsApi?.requestsRemaining ?? null;
  const exhausted = credits != null && credits <= EXHAUSTED_CREDIT_THRESHOLD;
  const low = credits != null && credits <= LOW_CREDIT_THRESHOLD;

  if (!result.enabled) {
    return (
      <section className="lb-card p-3">
        <p className="text-sm text-ink-muted">Game lines are disabled.</p>
        {result.warnings.map((w) => (
          <p key={w} className="mt-1 text-[11px] text-warn">
            {w}
          </p>
        ))}
      </section>
    );
  }

  const apiOn = result.sources?.oddsApi?.enabled;
  const scraperOn = result.sources?.oddsHarvester?.enabled;
  const liveMatches = result.sources?.oddsHarvester?.matches ?? 0;
  const feeds = [apiOn ? 'the-odds-api' : null, scraperOn ? 'OddsPortal' : null].filter(Boolean).join(' + ');

  return (
    <section className="lb-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs text-ink-muted">
          Game lines{' '}
          {formatStamp(result.fetchedAt) ? `as of ${formatStamp(result.fetchedAt)}` : 'unavailable'}
          {result.fromCache ? <span className="text-ink-faint"> (cached)</span> : null}
        </p>
        {credits != null ? (
          <p className={`text-[11px] font-medium tabular-nums ${low ? 'text-warn' : 'text-ink-faint'}`}>
            {credits} credits left this month
          </p>
        ) : null}
      </div>

      <p className="mt-0.5 text-[10px] text-ink-faint">
        {feeds || 'no active feed'}
        {scraperOn ? ` · ${liveMatches} live match${liveMatches === 1 ? '' : 'es'} from OddsPortal` : ''}
      </p>

      {exhausted ? (
        <p className="mt-1.5 text-[11px] text-warn">
          Only {credits} credits remain — lines are no longer auto-refreshing. Showing the last fetch.
        </p>
      ) : result.nextRefreshAt ? (
        <p className="mt-0.5 text-[10px] text-ink-faint">
          Next refresh after {formatClock(result.nextRefreshAt)}. Lines move — treat these as a reference
          point, not a live price.
        </p>
      ) : null}

      {result.warnings.map((w) => (
        <p key={w} className="mt-1 text-[11px] text-warn">
          {w}
        </p>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Compact form, for the player side panel
// ---------------------------------------------------------------------------

export function TodaysLine({
  line,
  projected,
  liveScore,
  livePeriod,
}: {
  line: UnifiedGameLine;
  projected: ProjectedLine;
  liveScore?: { home: string; away: string };
  livePeriod?: string;
}) {
  const away = shortTeam(line.awayTeam);
  const home = shortTeam(line.homeTeam);
  const score = liveScore ?? projected.liveScore;
  const period = liveScore ? livePeriod : projected.livePeriod;

  return (
    <div>
      {score ? (
        <LiveScoreBar liveScore={score} livePeriod={period} awayLabel={away} homeLabel={home} />
      ) : null}

      <p className="text-[11px] font-medium text-ink-muted">
        {away} at {home}
      </p>

      <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
        {projected.moneyline ? (
          <StatCell label={`ML · ${away} / ${home}`}>
            <OddsValue price={projected.moneyline.away} />
            <span className="text-sm text-ink-faint">/</span>
            <OddsValue price={projected.moneyline.home} />
          </StatCell>
        ) : null}
        {projected.total?.point != null ? (
          <StatCell label="Total">
            <span className="text-[19px] font-semibold leading-none tabular-nums">
              {projected.total.point}
            </span>
          </StatCell>
        ) : null}
      </div>

      <p className="mt-2 text-[10px] text-ink-faint">
        {sourceLabel(projected.source)} · best of {projected.bookCount} book
        {projected.bookCount === 1 ? '' : 's'}
        {projected.moneyline?.book ? ` · ${projected.moneyline.book}` : ''}
      </p>
    </div>
  );
}

export default GameLineBlock;
