'use client';

import type { OddsInfo } from '@/lib/core/types';
import { formatAmerican, americanToDecimal } from '@/lib/odds/display';
import { devigTwoWay } from '@/lib/odds/devig';
import { compareInk } from '@/lib/ui/heat';
import { Chip } from './Chip';
import { Skeleton } from './Skeleton';

/**
 * A price, with where it came from.
 *
 * One implementation for the table, the cards, both detail pages and the slip,
 * so a number never changes shape depending on which screen it's on. Source
 * attribution is not optional decoration here: Linesmith mixes a live game-line
 * feed with prices the user typed in or imported from a screenshot, and a
 * hand-entered price from an hour ago should not look identical to a fetched one.
 */

export type OddsProvenance =
  | 'manual'
  | 'screenshot'
  | 'odds-api'
  | 'oddsharvester'
  | 'both'
  | 'sharpapi'
  | 'oddsapiio'
  | 'sportsgameodds'
  | 'oddspapi'
  | 'theoddsapi'
  | 'unknown';

const PROVENANCE_LABEL: Record<OddsProvenance, string> = {
  manual: 'Entered by hand',
  screenshot: 'Imported from a screenshot',
  'odds-api': 'the-odds-api',
  oddsharvester: 'OddsPortal',
  both: 'the-odds-api + OddsPortal',
  sharpapi: 'SharpAPI',
  oddsapiio: 'Odds-API.io',
  sportsgameodds: 'SportsGameOdds',
  oddspapi: 'OddsPapi',
  theoddsapi: 'The Odds API',
  unknown: 'Source not recorded',
};

/** One-character provenance mark. Quiet by design — it annotates, not announces. */
const PROVENANCE_MARK: Record<OddsProvenance, string> = {
  manual: '✎',
  screenshot: '⧉',
  'odds-api': '',
  oddsharvester: '',
  both: '',
  sharpapi: '',
  oddsapiio: '',
  sportsgameodds: '',
  oddspapi: '',
  theoddsapi: '',
  unknown: '?',
};

function normalise(source: string | undefined): OddsProvenance {
  switch (source) {
    case 'manual':
    case 'screenshot':
    case 'odds-api':
    case 'oddsharvester':
    case 'both':
    case 'sharpapi':
    case 'oddsapiio':
    case 'sportsgameodds':
    case 'oddspapi':
    case 'theoddsapi':
      return source;
    default:
      return 'unknown';
  }
}

export interface OddsChipProps {
  /** American odds. Accepts the string form the slip stores. */
  price: number | string | null | undefined;
  source?: string;
  /** Marks this as the best price on the row. */
  best?: boolean;
  /** Prefix, e.g. "O" / "U" / "ML". */
  side?: string;
  capturedAt?: string;
  /**
   * Provider-reported staleness, in seconds — `null`/`undefined` means the
   * provider doesn't disclose one (Odds-API.io), which is not the same as
   * zero and must not be shown as though the price were live. A price
   * fetched at 4:12 that was already 60s stale when fetched is not a 4:12
   * snapshot — the marker and tooltip say so rather than only showing fetch
   * time.
   */
  delaySeconds?: number | null;
  isDelayed?: boolean | null;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * How old a captured price is, in words, plus whether that age is a problem.
 *
 * Phase 1.2 (audit finding P3 C4). The chip used to render
 * `captured 2:49 AM` — time only, no date, inside the `title` attribute. A
 * price captured at 02:49 this morning and one captured at 02:49 six days ago
 * were indistinguishable, and only visible on hover. The visible warning
 * marker keyed off `delaySeconds`, the provider's advertised feed delay, which
 * never exceeds 60 in the real data and so never fired for staleness.
 *
 * STALE_AFTER_MS matches _MAX_ROW_AGE_SECONDS in
 * python-odds-service/src/predict/live_edge.py, so what the UI calls stale and
 * what the edge computation refuses to use are the same thing.
 */
const STALE_AFTER_MS = 30 * 60_000;

function priceAge(capturedAt: string | undefined): { label: string; stale: boolean } | null {
  if (!capturedAt) return null;
  const ms = Date.parse(capturedAt);
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  if (minutes < 0) return null;
  const stale = Date.now() - ms > STALE_AFTER_MS;
  if (minutes < 1) return { label: 'just now', stale };
  if (minutes < 60) return { label: `${minutes}m ago`, stale };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { label: `${hours}h ago`, stale };
  return { label: `${Math.floor(hours / 24)}d ago`, stale };
}

export function OddsChip({
  price,
  source,
  best = false,
  side,
  capturedAt,
  delaySeconds,
  isDelayed,
  size = 'sm',
  className = '',
}: OddsChipProps) {
  const numeric = typeof price === 'string' ? Number(price.replace('+', '')) : price;
  const provenance = normalise(source);
  const mark = PROVENANCE_MARK[provenance];
  const delayed = isDelayed ?? (delaySeconds != null && delaySeconds > 0);

  const age = priceAge(capturedAt);

  const title = [
    PROVENANCE_LABEL[provenance],
    // Full date AND time, not time-of-day alone — "captured 2:49 AM" read
    // identically for a price from this morning and one from six days ago.
    capturedAt ? `captured ${new Date(capturedAt).toLocaleString()}${age ? ` (${age.label})` : ''}` : null,
    delayed ? (delaySeconds != null ? `~${delaySeconds}s delayed at source` : 'delayed at source (provider does not disclose by how much)') : null,
    best ? 'best available' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (numeric == null || !Number.isFinite(numeric)) {
    return <span className={`text-[11px] text-ink-faint ${className}`}>—</span>;
  }

  return (
    <span
      className={`inline-flex items-baseline gap-1 rounded-md border tabular-nums ${
        best ? 'border-masters/40 bg-accent-soft text-masters' : 'border-line text-ink'
      } ${size === 'md' ? 'px-2 py-1 text-[13px]' : 'px-1.5 py-0.5 text-[11px]'} ${className}`}
      title={title}
    >
      {side ? <span className="text-ink-faint">{side}</span> : null}
      <span className="font-semibold">{formatAmerican(numeric)}</span>
      {mark ? (
        <span className="text-[9px] text-ink-faint" aria-hidden>
          {mark}
        </span>
      ) : null}
      {delayed ? (
        <span className="text-[9px] text-warn" aria-hidden>
          ⏱
        </span>
      ) : null}
      {/* Age on the face of the chip, not buried in a tooltip — a stale price
          is the one thing a bettor must not have to hover to discover. Only
          rendered once it is actually stale, so a fresh board stays quiet. */}
      {age?.stale ? (
        <span className="text-[9px] font-medium text-warn" title={`price is ${age.label}`}>
          {age.label}
        </span>
      ) : null}
      <span className="sr-only">{title}</span>
    </span>
  );
}

/**
 * Over and under stacked, the way every book quotes a two-sided prop.
 *
 * A side that isn't priced is left out rather than padded with a dash — half a
 * market is a real state, and a placeholder makes it look like a failure.
 */
export function OddsPair({
  over,
  under,
  source,
  label,
  className = '',
}: {
  over?: number | string | null;
  under?: number | string | null;
  source?: string;
  /** Book or source name printed above the pair. */
  label?: string;
  className?: string;
}) {
  const hasOver = over != null && Number.isFinite(Number(over));
  const hasUnder = under != null && Number.isFinite(Number(under));
  if (!hasOver && !hasUnder) return null;

  return (
    <span className={`inline-flex flex-col items-stretch gap-0.5 ${className}`}>
      {label ? <span className="text-[9px] uppercase tracking-wide text-ink-faint">{label}</span> : null}
      {hasOver ? <OddsChip price={over} source={source} side="O" /> : null}
      {hasUnder ? <OddsChip price={under} source={source} side="U" /> : null}
    </span>
  );
}

/**
 * Rendered instead of a real price when nothing's arrived for this row yet.
 * Two real, different situations — not one generic "no odds":
 *
 *  - `pending`: NOTHING in the table has a price yet this cycle — the odds
 *    refresh is still in flight (Tier 1 runs every ~2.5min; other sports
 *    every 20min-90min, see gameday.py for the sport-dependent cadence),
 *    not a real gap. Shown as a shimmer, matching this app's actual loading
 *    convention (`Skeleton`/`.lb-skel`) instead of a warning — there's
 *    nothing for the user to do but wait for the next cycle.
 *  - otherwise: OTHER rows in the same table ARE priced, so this cycle's
 *    fetch already ran — this specific market/bookmaker genuinely isn't
 *    covered. A real, standing state, styled off the semantic `warn` tone
 *    (`Chip`) instead of the bespoke hex (`#fdf1d8`/`#93630a`) this used to
 *    hardcode — same amber `warn` used for weather/live-state chips
 *    elsewhere, not a one-off color.
 *
 * The caller decides `pending` — cheapest real signal is "does ANY row in
 * the current table have a price," computed once at the table level.
 */
export function NoOddsCell({ pending, onAdd }: { pending: boolean; onAdd?: () => void }) {
  if (pending) {
    return <Skeleton w={74} h={18} rounded="rounded-full" className="inline-block" />;
  }
  if (!onAdd) return <span className="text-ink-faint">—</span>;
  return (
    <button type="button" onClick={onAdd} className="transition-opacity hover:opacity-80">
      <Chip
        tone="warn"
        className="whitespace-nowrap"
        title="No price posted for this market yet — this row can still qualify for Good Bets on performance or matchup alone, but check your sportsbook directly before betting it."
      >
        No Odds — Check Book
      </Chip>
    </button>
  );
}

/** Overflow marker for rows carrying more books than fit. */
export function MoreBooksChip({ count, onClick }: { count: number; onClick?: () => void }) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="rounded-md border border-line px-1.5 py-0.5 text-[11px] font-medium text-ink-muted disabled:cursor-default"
      aria-label={`${count} more source${count === 1 ? '' : 's'}`}
    >
      +{count}
    </button>
  );
}

/**
 * What a row shows when nothing has been priced yet.
 *
 * An empty cell reads as "no odds exist"; this reads as "none fetched", which is
 * the true state and is also the affordance for changing it.
 */
export function GetOddsButton({ onClick, label = 'Get odds' }: { onClick?: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="rounded-md border border-dashed border-line px-1.5 py-0.5 text-[10px] text-ink-faint transition-colors hover:border-masters/40 hover:text-masters disabled:hover:border-line disabled:hover:text-ink-faint"
    >
      {label}
    </button>
  );
}

/** Implied probability from a two-sided price, vig removed. Null if one-sided. */
export function impliedPair(
  over: number | null | undefined,
  under: number | null | undefined,
): { over: number; under: number } | null {
  const devigged = devigTwoWay(americanToDecimal(over), americanToDecimal(under));
  return devigged ? { over: devigged.a, under: devigged.b } : null;
}

/**
 * The IP column: over and under implied probability, stacked.
 *
 * Renders nothing at all when the market is one-sided — normalising a single
 * price would mean inventing its opposite, and the audit confirmed the
 * reference leaves this cell genuinely blank rather than dashed.
 */
export function ImpliedProbabilityCell({
  over,
  under,
}: {
  over?: number | null;
  under?: number | null;
}) {
  const implied = impliedPair(over, under);
  if (!implied) return null;

  return (
    <span className="flex flex-col items-end leading-tight tabular-nums">
      <span className="text-[11px] text-ink">O{(implied.over * 100).toFixed(1)}%</span>
      <span className="text-[11px] text-ink-muted">U{(implied.under * 100).toFixed(1)}%</span>
    </span>
  );
}

/** The slip's stored `OddsInfo` as a chip. */
export function StoredOddsChip({ odds, size = 'sm' }: { odds: OddsInfo | undefined; size?: 'sm' | 'md' }) {
  if (!odds) return null;
  return <OddsChip price={odds.americanOdds} source={odds.source} capturedAt={odds.capturedAt} size={size} />;
}

/** G6 — same de-vigged-edge visual language as Scan's Edge column, reused for the game-level model on Game Detail and Player Detail's Game Odds card. */
/**
 * Renders nothing since Phase 1.3 (standing decisions Q1 and Q6, audit
 * findings P3 C2/C5 and P5 T2).
 *
 * This showed `+4.2%` — an edge, Tier E — on PlayerDetail, GameDetail,
 * GameHeroCard and GameLinesView, with a tooltip disclosing the model and
 * market probabilities behind it. The app's own graded history does not
 * support any of those numbers: the model loses to the market, and P3 C5
 * measured the negative-edge bucket *outperforming* the positive one.
 *
 * Neutralised here rather than at the four call sites on purpose. One place
 * decides, one reason is written down once, and when task 4.2's activation
 * gate finally shows the model beating `market_prob`'s Brier score on
 * held-out live rows, restoring it is deleting this early return — not
 * hunting down four components and hoping they were all found.
 *
 * The props are still accepted so callers need no change and TypeScript still
 * checks that they have a real edge to pass. The `void` is what keeps the
 * unused-parameter lint quiet without dropping the signature.
 */
export function EdgeBadge({ edge, modelProb, marketProb, label }: { edge: number; modelProb: number; marketProb: number; label: string }) {
  void edge;
  void modelProb;
  void marketProb;
  void label;
  return null;
}

export default OddsChip;
