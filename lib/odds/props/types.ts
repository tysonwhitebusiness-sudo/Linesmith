/**
 * Shared vocabulary for the five-provider player-prop odds architecture.
 *
 * Separate from `lib/odds/types.ts` on purpose: that file is game lines
 * (moneyline/spread/total) from the-odds-api + OddsHarvester, already wired
 * into Scan/Game Detail and working. This is the player-prop feed Phase 4 of
 * update-07 flagged as missing entirely ("the odds layer carries game lines
 * only"). The two systems share a bookmaker vocabulary and odds-format
 * helpers (`lib/odds/display.ts`) but nothing else — no existing registry to
 * plug into, so this is new infrastructure, not an extension of one.
 */

export type ProviderId =
  | 'sharpapi'
  | 'oddsapiio'
  | 'sportsgameodds'
  | 'sportsgameodds_multisport'
  | 'oddspapi'
  | 'theoddsapi'
  | 'parlayapi'
  | 'parlayapi_mlb'
  | 'parlayapi_nfl'
  | 'parlayapi_cfb'
  | 'parlayapi_soccer'
  | 'propline'
  | 'propline_2';

/**
 * Which sport a `GameLookupContext` belongs to — was implicit (always MLB)
 * until the multi-sport expansion. Every adapter that serves more than one
 * sport (ParlayAPI, Propline, SportsGameOdds's new leagues) reads this to
 * pick the right per-provider sport key; MLB-only adapters can ignore it.
 */
export type SportKey = 'mlb' | 'nfl' | 'cfb' | 'nba' | 'nhl' | 'soccer_epl' | 'soccer_mls' | 'tennis_atp' | 'tennis_wta';

/**
 * Canonical market keys a prop can resolve to. Deliberately the same
 * vocabulary `components/MarketLabel.tsx` already speaks (`hits`,
 * `total-bases`, ...) plus the two game-level keys `moneyline`/`total` used
 * for OddsPapi's sharp-price/history features (§ scope correction in
 * docs/odds-provider-verification.md — OddsPapi carries no player props).
 */
export type MarketKey = string;

export type Side = 'over' | 'under' | string;

/**
 * One bookmaker's price for one player/market/line, after entity resolution.
 *
 * `subjectId` is Linesmith's own MLB person id (a string, matching
 * `PickCandidate.subjectId`) — never a provider's own player id. A row that
 * couldn't be resolved to one never becomes a `NormalizedPropRow`; it becomes
 * an `UnresolvedRow` instead and is dropped from display, per § 6 of
 * update-09 ("dropped and logged, never guessed").
 */
export interface NormalizedPropRow {
  providerId: ProviderId;
  gameId: string;
  subjectId: string;
  subjectName: string;
  marketKey: MarketKey;
  line: number | null;
  side: Side;
  /** Normalized bookmaker id (see `normalizeBookmaker` in entityResolution.ts) — never a provider-specific slug. */
  bookmaker: string;
  americanOdds: number;
  decimalOdds: number | null;
  fetchedAt: string;
  isDelayed: boolean;
  /** Null when the provider doesn't disclose a delay (honest-unknown, not zero). */
  delaySeconds: number | null;
}

export interface UnresolvedRow {
  kind: 'player' | 'market' | 'bookmaker';
  rawValue: string;
  /** Free-text context, e.g. the raw label the row arrived with. */
  context?: string;
}

export interface FetchResult {
  rows: NormalizedPropRow[];
  unresolved: UnresolvedRow[];
  /** What this fetch cost, in whatever unit the provider bills — for budget bookkeeping. */
  cost: { requests?: number; objects?: number };
  warnings: string[];
}

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  /**
   * True if this identity is meant to run automatically (via a per-sport
   * refresh, whichever app currently owns scheduling — see
   * docs/api-capability-audit-2026-08-20.md §4), false if it's click-only
   * (a manual "more books"/"sharp price" action). Replaces the old flat
   * `tier: 'tier1' | 'tier2'` field (2026-08-20) — that field conflated
   * "should this run automatically" with "which budget/loop does it draw
   * from," which is exactly the shape that let two providers silently run
   * with zero rate-limit checking (see
   * docs/phase2-hardening-gameplan-2026-08-20.md items 3-4). Which
   * providers actually run for which sport now lives in
   * `registry.ts`'s `providersForSport()`, not in this flag.
   */
  scheduled: boolean;
  /** Read fresh from config on every access — missing key or `_ENABLED=false` means false. */
  enabled: boolean;
  /** Null when the provider doesn't self-disclose a delay (Odds-API.io) — must not be assumed real-time. */
  delaySeconds: number | null;
  /** Bookmaker ids (normalized) this provider is known to be able to return. Informational, not enforced. */
  books: string[];
}

/** Enough to let an adapter find "this game" on its own service without depending on Linesmith's internal types. */
export interface GameLookupContext {
  /** Which sport this game belongs to — see SportKey. */
  sport: SportKey;
  /** Linesmith's own gamePk, stringified — the join key every row is stamped with. */
  gameId: string;
  awayTeamName: string;
  homeTeamName: string;
  awayAbbr: string;
  homeAbbr: string;
  /** ISO date, used by providers that need a date-scoped event search. */
  gameDate: string;
  /** Canonical roster to resolve provider player names against — see entityResolution.ts. */
  roster: RosterEntry[];
  /**
   * Where the game is played, when the source reports it — carried so a
   * snapshot builder can resolve weather without re-fetching the scoreboard.
   *
   * ESPN team sports only. **`indoor === undefined` means UNKNOWN, not open
   * air**: NFL and CFB carry the flag on every event, soccer omits it entirely,
   * and MLS really does have enclosed venues. See `venueWeather.ts`.
   */
  venue?: import('@/lib/sports/multiSport/teamSportEspn').EspnVenue;
}

export interface RosterEntry {
  subjectId: string;
  subjectName: string;
  teamAbbr?: string;
  /** Position abbreviation (e.g. "QB", "WR") — team-sport adapters use this to decide which markets are even sensible for a player. Optional: MLB/golf don't set it and don't need to. */
  position?: string;
  /** Real headshot URL, when the sport's roster source has one (teamSportEspn.ts does) — lets an adapter attach a real photo to subjectMeta instead of leaving it to fall back to initials. */
  headshotUrl?: string;
}

export interface ProviderAdapter {
  meta: ProviderMeta;
  fetchGameProps(game: GameLookupContext): Promise<FetchResult>;
}

// ---------------------------------------------------------------------------
// OddsPapi's game-level-only features (see docs/odds-provider-verification.md
// § "Scope change" — OddsPapi has no MLB player-prop data, so "Check sharp
// price" and "Line history" both work against game lines, not props).
// ---------------------------------------------------------------------------

export interface GameLinePrice {
  bookmaker: string;
  moneyline?: { home?: number; away?: number };
  spread?: { homePoint?: number; homePrice?: number; awayPoint?: number; awayPrice?: number };
  total?: { point?: number; overPrice?: number; underPrice?: number };
}

export interface SharpPriceResult {
  available: boolean;
  pinnacle: GameLinePrice | null;
  otherBooks: GameLinePrice[];
  fetchedAt: string;
  monthlyRemaining: number;
  warnings: string[];
}

export interface LineHistoryPoint {
  bookmaker: string;
  market: 'moneyline' | 'spread' | 'total';
  side: string;
  price: number;
  point: number | null;
  observedAt: string;
}

export interface LineHistoryResult {
  available: boolean;
  points: LineHistoryPoint[];
  monthlyRemaining: number;
  warnings: string[];
}
