'use client';
import { STALE_AFTER_MS, relativeAge } from '@/lib/odds/priceFreshness';
import { formatAmerican } from '@/lib/odds/display';
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

import type { ProviderId } from '@/lib/odds/props/types';

/**
 * Derived from ProviderId rather than hand-listed (Phase 1.9, audit finding
 * P3 M11).
 *
 * The hand-written union covered 8 of ProviderId's 13 members. `propline` was
 * not among them — and propline is **87,472 of the 98,257 prop_odds rows
 * written in the last two days, 89%**. Every one of those prices fell through
 * `normalise`'s default and rendered as "Source not recorded", on a chip whose
 * whole purpose is provenance. Also missing: propline_2, parlayapi and its four
 * per-sport identities, and sportsgameodds_multisport.
 *
 * Deriving it means `Record<OddsProvenance, string>` below now fails to compile
 * if someone adds a provider to ProviderId without giving it a label. The
 * previous shape let that drift silently, which is exactly how 89% of prices
 * ended up anonymous.
 *
 * The four non-provider members are real states a price can be in that no
 * provider owns: entered by hand, imported from a screenshot, corroborated by
 * two sources, or genuinely unattributed.
 */
export type OddsProvenance =
  | ProviderId
  | 'manual'
  | 'screenshot'
  | 'odds-api'
  | 'oddsharvester'
  | 'both'
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
  // The five that were missing. Propline alone accounts for ~89% of recent
  // rows; its absence is the whole of P3 M11.
  propline: 'Propline',
  propline_2: 'Propline',
  parlayapi: 'ParlayAPI',
  parlayapi_mlb: 'ParlayAPI',
  parlayapi_nfl: 'ParlayAPI',
  parlayapi_cfb: 'ParlayAPI',
  parlayapi_soccer: 'ParlayAPI',
  sportsgameodds_multisport: 'SportsGameOdds',
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
  propline: '',
  propline_2: '',
  parlayapi: '',
  parlayapi_mlb: '',
  parlayapi_nfl: '',
  parlayapi_cfb: '',
  parlayapi_soccer: '',
  sportsgameodds_multisport: '',
  unknown: '?',
};

/**
 * A hand-maintained switch was the second half of the same drift: even once a
 * provider is in the type, it still renders as unknown until someone adds a
 * `case` for it. Checking membership of PROVENANCE_LABEL instead means the
 * label map is the single source of truth, and the compiler already forces
 * that map to be exhaustive over ProviderId.
 */
function normalise(source: string | undefined): OddsProvenance {
  if (source && source in PROVENANCE_LABEL) return source as OddsProvenance;
  return 'unknown';
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
/**
 * Threshold and wording both come from `lib/odds/priceFreshness.ts` (6.17), not
 * from a second copy here. A chip showing a stale marker while the coverage
 * line above it reports everything fresh would be two numbers on one screen
 * disagreeing about the same fact.
 */
function priceAge(capturedAt: string | undefined): { label: string; stale: boolean } | null {
  if (!capturedAt) return null;
  const label = relativeAge(capturedAt);
  if (label == null) return null;
  return { label, stale: Date.now() - Date.parse(capturedAt) > STALE_AFTER_MS };
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
    return <span className={`text-[11px] text-ink-muted ${className}`}>—</span>;
  }

  return (
    <span
      className={`inline-flex items-baseline gap-1 rounded-md border tabular-nums ${
        best ? 'border-masters/40 bg-accent-soft text-masters' : 'border-line text-ink'
      } ${size === 'md' ? 'px-2 py-1 text-[13px]' : 'px-1.5 py-0.5 text-[11px]'} ${className}`}
      title={title}
    >
      {side ? <span className="text-ink-muted">{side}</span> : null}
      <span className="font-semibold">{formatAmerican(numeric)}</span>
      {mark ? (
        <span className="text-[9px] text-ink-muted" aria-hidden>
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
  if (!onAdd) return <span className="text-ink-muted">—</span>;
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
      className="rounded-md border border-dashed border-line px-1.5 py-0.5 text-[10px] text-ink-muted transition-colors hover:border-masters/40 hover:text-masters disabled:hover:border-line disabled:hover:text-ink-muted"
    >
      {label}
    </button>
  );
}

/** G6 — same de-vigged-edge visual language as Scan's Edge column, reused for the game-level model on Game Detail and Player Detail's Game Odds card. */
/**
 * Renders nothing since Phase 1.3 (standing decisions Q1 and Q6, audit
 * findings P3 C2/C5 and P5 T2).
 *
 * This showed `+4.2%` — an edge, Tier E — on PlayerDetail, GameDetail,
 * GameHeroCard and GameLinesView, with a tooltip disclosing the model and
 * market probabilities behind it. The app's own graded history does not
 * support any of those numbers. P3 C5 bucketed 3,615 graded picks by the edge
 * they were shown with, against what the market implied:
 *
 *     edge >= 3% (the Good Bets bar)  n=1,070   realized -0.18 pts vs market
 *     edge 0-3%                       n=  564   realized -0.56 pts
 *     edge < 0                        n=1,981   realized -4.52 pts
 *
 * Picks clearing the 3% bar realize *exactly* the market's own probability —
 * the claimed edge converts to zero measured excess. (The negative bucket
 * missing by 4.52 points is the interesting part: it suggests the model
 * correctly identifies bets to avoid, a possible fade signal, which task 4.6
 * investigates rather than builds on.)
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
