/**
 * Name/market/book normalization for the five-provider odds feed.
 *
 * With five providers, format variance is the single most likely source of
 * silent bugs (update-09 § 6). Every adapter routes its raw rows through
 * these three functions before a row is allowed to become a
 * `NormalizedPropRow` — nothing downstream re-implements matching.
 */

import type { MarketKey, RosterEntry, UnresolvedRow } from './types';

// ---------------------------------------------------------------------------
// Player names
// ---------------------------------------------------------------------------

/** Strips accents, punctuation, suffixes and casing so name variants compare equal. */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, '')
    .replace(/[^a-zA-Z\s]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function lastNameOf(normalized: string): string {
  const parts = normalized.split(' ').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

export interface RosterIndex {
  byFullName: Map<string, RosterEntry>;
  byLastNameAndTeam: Map<string, RosterEntry[]>;
}

export function buildRosterIndex(roster: RosterEntry[]): RosterIndex {
  const byFullName = new Map<string, RosterEntry>();
  const byLastNameAndTeam = new Map<string, RosterEntry[]>();

  for (const entry of roster) {
    const normalized = normalizeName(entry.subjectName);
    byFullName.set(normalized, entry);

    const last = lastNameOf(normalized);
    const key = `${last}::${(entry.teamAbbr ?? '').toUpperCase()}`;
    const bucket = byLastNameAndTeam.get(key);
    if (bucket) bucket.push(entry);
    else byLastNameAndTeam.set(key, [entry]);
  }

  return { byFullName, byLastNameAndTeam };
}

/**
 * Resolve a provider's raw player name to Linesmith's canonical roster.
 *
 * Exact normalized match first. Falls back to last-name-plus-team when a
 * provider abbreviates a first name or uses a nickname — scoped to team so
 * "Smith" on the away side never matches "Smith" on the home side. Returns
 * `null` (never a guess) when neither resolves, or when the team-scoped
 * fallback is ambiguous (two roster players sharing a last name on one team).
 */
export function resolvePlayer(
  rawName: string,
  teamAbbr: string | undefined,
  index: RosterIndex,
): RosterEntry | null {
  const normalized = normalizeName(rawName);
  if (!normalized) return null;

  const exact = index.byFullName.get(normalized);
  if (exact) return exact;

  if (teamAbbr) {
    const last = lastNameOf(normalized);
    const candidates = index.byLastNameAndTeam.get(`${last}::${teamAbbr.toUpperCase()}`);
    if (candidates && candidates.length === 1) return candidates[0];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Market keys
// ---------------------------------------------------------------------------

/**
 * Maps every stat-category spelling observed across the five providers
 * (Phase 0 verification, docs/odds-provider-verification.md) to Linesmith's
 * canonical `MarketKey` — the same vocabulary `MLB_MARKETS` in
 * `components/MarketLabel.tsx` already speaks, so a resolved row renders
 * through the existing `MarketLabel` component with no further mapping.
 */
const MARKET_KEY_ALIASES: Record<string, MarketKey> = {
  // SharpAPI `stat_category`
  hits: 'hits',
  doubles: 'doubles',
  triples: 'triples',
  home_runs: 'home-runs',
  rbis: 'rbis',
  runs: 'runs',
  earned_runs: 'earned-runs',
  hits_allowed: 'pitcher-hits-allowed',
  hits_runs_rbis: 'hits-runs-rbis',
  stolen_bases: 'stolen-bases',
  walks: 'walks',
  strikeouts: 'batter-strikeouts',
  pitcher_strikeouts: 'pitcher-strikeouts',
  outs: 'pitcher-outs',
  // Odds-API.io Player Props labels (parsed out of "Player (Stat Type)")
  'total bases': 'total-bases',
  'hits+runs+rbis': 'hits-runs-rbis',
  'runs batted in': 'rbis',
  'runs scored': 'runs',
  'home runs': 'home-runs',
  // SportsGameOdds `statID`
  batting_hits: 'hits',
  batting_totalbases: 'total-bases',
  batting_homeruns: 'home-runs',
  batting_rbi: 'rbis',
  batting_basesonballs: 'walks',
  batting_strikeouts: 'batter-strikeouts',
  'batting_hits+runs+rbi': 'hits-runs-rbis',
  batting_doubles: 'doubles',
  batting_triples: 'triples',
  batting_singles: 'singles',
  batting_stolenbases: 'stolen-bases',
  'batting_runs+rbi': 'runs-rbis',
  batting_firsthomerun: 'first-home-run',
  pitching_basesonballs: 'pitcher-walks-allowed',
  pitching_earnedruns: 'earned-runs',
  pitching_hits: 'pitcher-hits-allowed',
  pitching_strikeouts: 'pitcher-strikeouts',
  pitching_outs: 'pitcher-outs',
  pitching_win: 'pitcher-win',

  // --- NFL / CFB (ParlayAPI market names, TheRundown market catalog) ---
  'pass yards': 'passing-yards',
  'passing yards': 'passing-yards',
  passing_yards: 'passing-yards',
  'pass tds': 'passing-tds',
  'passing touchdowns': 'passing-tds',
  passing_touchdowns: 'passing-tds',
  'rush yards': 'rushing-yards',
  'rushing yards': 'rushing-yards',
  rushing_yards: 'rushing-yards',
  'rush tds': 'rushing-tds',
  'receiving yards': 'receiving-yards',
  player_receiving_yards: 'receiving-yards',
  receptions: 'receptions',
  player_receptions: 'receptions',
  'rec tds': 'receiving-tds',
  'ints thrown': 'interceptions-thrown',
  int: 'interceptions-thrown',
  player_interceptions: 'interceptions-thrown',
  'longest rush': 'longest-rush',
  'longest reception': 'longest-reception',
  player_longest_reception: 'longest-reception',
  'longest completion': 'longest-completion',
  'fg made': 'field-goals-made',
  player_field_goals: 'field-goals-made',
  'kicking points': 'kicking-points',
  'rush + rec tds': 'rush-rec-tds',
  'rush+rec tds': 'rush-rec-tds',
  player_rushing_receiving_yards: 'rush-rec-yards',
  sacks: 'sacks',
  'anytime touchdowns': 'anytime-td',
  touchdowns: 'anytime-td',
  'first td scorer': 'first-td-scorer',
  first_touchdown: 'first-td-scorer',
  player_passing_completions: 'passing-completions',
  player_pass_attempts: 'pass-attempts',
  player_rushing_attempts: 'rushing-attempts',

  // --- Tennis (SharpAPI stat_category, live-verified) ---
  aces: 'aces',
  games_won: 'games-won',
  tennis_to_win_set: 'to-win-a-set',
  tennis_player_aces: 'aces',
  tennis_player_total_aces: 'aces',

  // --- Soccer (Propline market keys, SportsGameOdds statIDs — both live-verified) ---
  anytime_goal_scorer: 'anytime-goalscorer',
  first_goal_scorer: 'first-goalscorer',
  '2plus_goals': 'two-plus-goals',
  last_goal_scorer: 'last-goalscorer',
  assists: 'assists',
  shots: 'shots',
  shots_ongoal: 'shots-on-target',
  'goals+assists': 'goals-assists',
  tackles: 'tackles',
  passes_attempted: 'passes-attempted',
  dribbles_attempted: 'dribbles-attempted',
  crosses_attempted: 'crosses-attempted',
  yellowcards: 'yellow-cards',
  goalie_saves: 'saves',

  // --- NBA (2026-08-22) — dimension names equal their own canonical
  // MarketKey directly, same "just confirming it's real" convention NFL's
  // section documents above. Not yet live-verified against a real
  // provider payload (no PARLAYAPI_NBA_KEY yet, SportsGameOdds's real
  // NBA statID strings unconfirmed — see lib/sports/nba/adapter.ts's
  // header and the Python backend commit). Common the-odds-api/SGO-style
  // raw variants included defensively; correct/extend once real rows
  // are observed in production.
  points: 'points',
  player_points: 'points',
  rebounds: 'rebounds',
  player_rebounds: 'rebounds',
  // `assists` itself already aliased above (shared with soccer's identical key).
  player_assists: 'assists',
  'three-pointers-made': 'three-pointers-made',
  'threes made': 'three-pointers-made',
  three_pointers_made: 'three-pointers-made',
  player_threes: 'three-pointers-made',
  steals: 'steals',
  player_steals: 'steals',
  blocks: 'blocks',
  player_blocks: 'blocks',
  turnovers: 'turnovers',
  player_turnovers: 'turnovers',
  'points-rebounds-assists': 'points-rebounds-assists',
  'pts+reb+ast': 'points-rebounds-assists',
  'points-rebounds': 'points-rebounds',
  'pts+reb': 'points-rebounds',
  'points-assists': 'points-assists',
  'pts+ast': 'points-assists',
  'rebounds-assists': 'rebounds-assists',
  'reb+ast': 'rebounds-assists',

  // --- NHL (2026-08-22) — same "not yet live-verified" caveat as NBA's
  // section above (no PARLAYAPI_NHL_KEY, no confirmed real SportsGameOdds
  // NHL statID). `assists`/`points`/`hits` already aliased above (shared
  // canonical keys with soccer/MLB/NBA — no real collision since sport +
  // gameId always scope which one a candidate actually means).
  goals: 'goals',
  player_goals: 'goals',
  'shots-on-goal': 'shots-on-goal',
  'shots on goal': 'shots-on-goal',
  player_shots_on_goal: 'shots-on-goal',
  'blocked-shots': 'blocked-shots',
  blocked_shots: 'blocked-shots',
  player_blocked_shots: 'blocked-shots',
  'goals-against': 'goals-against',
  goals_against: 'goals-against',
};

/**
 * Resolve a raw stat label to a canonical `MarketKey`, or `null` if unmapped.
 * Case/whitespace-insensitive so `Total Bases`, `total_bases` and
 * `totalBases` all land the same place.
 */
export function resolveMarketKey(rawLabel: string): MarketKey | null {
  const normalized = rawLabel.trim().toLowerCase();
  return (
    MARKET_KEY_ALIASES[normalized] ??
    MARKET_KEY_ALIASES[normalized.replace(/[\s_]+/g, '_')] ??
    MARKET_KEY_ALIASES[normalized.replace(/[\s_]+/g, '')] ??
    null
  );
}

// ---------------------------------------------------------------------------
// Bookmaker names
// ---------------------------------------------------------------------------

/**
 * Every bookmaker spelling observed across the five providers, mapped to one
 * normalized id. Without this, DraftKings arriving from SharpAPI
 * (`draftkings`) and SportsGameOdds (`draftkings`, same spelling as it
 * happens) would still be fine — but Fanatics from Odds-API.io (`Fanatics`)
 * and BetMGM from three different providers (`BetMGM` / `betmgm`) would not
 * collapse without this, inflating every "N books surveyed" figure.
 */
const BOOKMAKER_ALIASES: Record<string, string> = {
  draftkings: 'draftkings',
  fanduel: 'fanduel',
  fanatics: 'fanatics',
  betmgm: 'betmgm',
  caesars: 'caesars',
  pinnacle: 'pinnacle',
  espnbet: 'espnbet',
  bovada: 'bovada',
  pointsbet: 'pointsbet',
  unibet: 'unibet',
  // Added for the multi-sport expansion (ParlayAPI/Propline/OddsBlaze) — see
  // this session's provider audits for where each was actually observed live.
  bet365: 'bet365',
  betrivers: 'betrivers',
  underdogfantasy: 'underdog',
  underdog: 'underdog',
  prizepicks: 'prizepicks',
  novig: 'novig',
  'pick6(draftkings)': 'pick6',
  pick6: 'pick6',
  sleeper: 'sleeper',
  betr: 'betr',
  betrpicks: 'betr',
  hardrockbet: 'hardrockbet',
  hardrock: 'hardrockbet',
  fliff: 'fliff',
  parxcasino: 'parx',
  parx: 'parx',
  betparx: 'betparx',
  ballybet: 'ballybet',
  kalshi: 'kalshi',
  polymarket: 'polymarket',
  prophetx: 'prophetx',
  '10bet': '10bet',
  wynnbet: 'wynnbet',
  betonline: 'betonline',
  bodog: 'bodog',
  circa: 'circa',
  thescore: 'thescore',
};

export function normalizeBookmaker(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/[\s._-]+/g, '');
  return BOOKMAKER_ALIASES[key] ?? null;
}

// ---------------------------------------------------------------------------
// Convenience for adapters
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PickCandidate dimension -> prop marketKey
// ---------------------------------------------------------------------------

/**
 * The MLB adapter's candidate dimensions (`hit-in-game`, `vs-RHP`, ...) and
 * the five-provider feed's market keys (`hits`, `total-bases`, ...) are two
 * independently-evolved vocabularies that happen to overlap on exactly one
 * point today: "hit in game" is the same proposition as the `hits` prop at a
 * 0.5 line. `vs-LHP`/`vs-RHP` and `first-inning` have no equivalent in the
 * five providers (none split by handedness or offer 1st-inning player
 * props) — mapping them to the plain `hits`/`runs` market would attach the
 * wrong price to a candidate that's asking a narrower question, so they
 * resolve to `null` and the UI shows "no price fetched" honestly instead.
 */
const CANONICAL_MARKET_KEYS = new Set(Object.values(MARKET_KEY_ALIASES));

export function candidateDimensionToMarketKey(dimension: string): MarketKey | null {
  if (dimension === 'hit-in-game') return 'hits';
  // Every generic counting-stat dimension in lib/sports/mlb/adapter.ts
  // (total-bases, home-runs, pitcher-outs, ...) was deliberately named to
  // equal its canonical MarketKey one-for-one, so most of the time this is
  // just confirming the dimension is a real, resolvable market rather than
  // doing any actual translation.
  if (CANONICAL_MARKET_KEYS.has(dimension)) return dimension;
  return null;
}

/** Which side of the prop line a candidate's category corresponds to. */
export function candidateCategoryToSide(category: string): 'over' | 'under' | null {
  if (category === 'hit' || category === 'run' || category === 'over') return 'over';
  if (category === 'no-hit' || category === 'no-run' || category === 'under') return 'under';
  return null;
}

export function unresolvedPlayer(rawValue: string, context?: string): UnresolvedRow {
  return { kind: 'player', rawValue, context };
}
export function unresolvedMarket(rawValue: string, context?: string): UnresolvedRow {
  return { kind: 'market', rawValue, context };
}
export function unresolvedBookmaker(rawValue: string, context?: string): UnresolvedRow {
  return { kind: 'bookmaker', rawValue, context };
}
