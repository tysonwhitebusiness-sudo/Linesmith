/**
 * The player page starts from the PLAYER, not the market — R6.1a.
 *
 * WHY THIS EXISTS. Until R6 every player route rendered only "No tracked
 * markets for this player on today's slate" when the snapshot held no
 * candidate for the subject. On 2026-09-15 that blanked 8 of the 10 G2
 * reference players at both widths (Skubal, Chase, Allen, Manning, SGA,
 * MacKinnon, Cunha, Alcaraz): a research page that exists only on days a book
 * posts a line is a betting slip, and the operator's decision is that the
 * player is the page (research-pages plan, R6 Step 0).
 *
 * So everything here is built without a candidate:
 *   - `PlayerBio` from the league's own athlete endpoint (`/api/player-bio`);
 *   - `PlayerHistory` from `player_game_history`, every season held
 *     (`/api/player-history`), with results joined from `game_result`;
 *   - `PlayerResearchData`, which each sport's `playerDetailAdapter.ts` builds
 *     from those two through `toPlayerResearchData`.
 *
 * Types and pure helpers, client-safe: the server halves are `playerBioServer.ts` and
 * `playerHistoryServer.ts`, which touch the network and the database.
 */

/** `player_game_history.sport` — the league, not the app's sport route. */
export type HistorySport = 'mlb' | 'nfl' | 'cfb' | 'nba' | 'nhl' | 'soccer_epl' | 'soccer_mls' | 'tennis_atp' | 'tennis_wta';

export const HISTORY_SPORTS: readonly HistorySport[] = ['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer_epl', 'soccer_mls', 'tennis_atp', 'tennis_wta'];

export function isHistorySport(v: string): v is HistorySport {
  return (HISTORY_SPORTS as readonly string[]).includes(v);
}

/** The route sport plus its league or tour, as `player_game_history` spells it. `null` for golf, which has no per-game history table. */
export function historySportFor(sport: string, sub?: string | null): HistorySport | null {
  if (sport === 'soccer') return sub === 'mls' ? 'soccer_mls' : 'soccer_epl';
  if (sport === 'tennis') return sub === 'wta' ? 'tennis_wta' : 'tennis_atp';
  return isHistorySport(sport) ? sport : null;
}

/**
 * The bare athlete id behind a subject id. Snapshot subject ids are namespaced
 * (`espn:basketball:4278073`, `nhl:8477492`, `espn:tennis:3782`); MLB's is the
 * bare MLBAM id. Every history and bio source keys on the bare id.
 */
export function athleteIdOf(subjectId: string): string {
  const parts = String(subjectId).split(':');
  return parts[parts.length - 1];
}

export interface PlayerBio {
  athleteId: string;
  name: string;
  jersey: string | null;
  position: string | null;
  positionAbbr: string | null;
  team: { id: string | null; name: string | null; abbr: string | null; logoUrl: string | null } | null;
  headshotUrl: string | null;
  age: number | null;
  /** Sport-specific facts in display order ("Bats / throws", "Draft"). Entries without a value are left out. */
  facts: Array<{ label: string; value: string }>;
  /** `null` means the source reports no injury, not that we did not look. */
  injury: { status: string; detail: string | null; date: string | null; returnDate: string | null } | null;
  /**
   * The league's OWN season totals, where the league publishes them and the
   * bio's fetch already carries them. Only NHL does: `parsePlayerLanding`
   * reads `seasonTotals` off the same api-web landing the bio comes from, so
   * R6.5's "Official NHL season totals" card costs no extra call. A named,
   * presence-checked field rather than a `sport === 'nhl'` branch (CLAUDE.md
   * §4); every other sport leaves it undefined.
   */
  nhlSeasons?: import('@/lib/sports/nhl/apiWebParsers').NhlSeasonLine[];
  /** Human name of the source, for the page's Sources section. */
  source: string;
  fetchedAt: string;
}

/** A stat value as `player_game_history.stats` holds it: most are numbers; NBA minutes can be "34:12"; tennis flags are booleans. */
export type RawStat = number | string | boolean | null;

export interface PlayerGame {
  eventId: string;
  /** ISO date. */
  date: string;
  season: number;
  teamId: string | null;
  opponentId: string | null;
  isHome: boolean | null;
  stats: Record<string, RawStat>;
  /** From the player's side. `null` when no result row joins (tennis reads `match_won` instead). */
  result: 'W' | 'L' | 'D' | null;
  teamScore: number | null;
  opponentScore: number | null;
  opponent: { name: string | null; abbr: string | null; logoUrl: string | null };
}

export interface PlayerHistory {
  sport: HistorySport;
  athleteId: string;
  /** Oldest first. */
  games: PlayerGame[];
  /** The newest `fetched_at` among the rows: when the history was last written. */
  asOf: string | null;
  /** Where the results and scores came from, for the Sources section. */
  resultsSource: string;
}

// ---------------------------------------------------------------------------
// What an adapter builds for the page
// ---------------------------------------------------------------------------

export interface ResearchColumn {
  key: string;
  label: string;
  decimals: number;
  /** Explains a derived stat ("True shooting: …"). */
  info?: string;
  /**
   * `rate3` renders ".312" (baseball drops the leading zero). `percent` appends
   * "%". `ip` means the value is OUTS and renders as innings in whole.thirds
   * ("187.1"), never as a decimal (R2).
   */
  format?: 'rate3' | 'percent' | 'ip';
  /** A text column (a play's description, a market name): left-aligned and allowed to wrap, never sorted as a number (R8.1). */
  text?: boolean;
}

export interface ResearchTile {
  label: string;
  value: string;
  info?: string;
}

/** One number the way every research card prints it. Pure, shared by the adapters and the component. */
export function formatResearchValue(v: number | string | null | undefined, col: Pick<ResearchColumn, 'decimals' | 'format'>): string {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '—';
  if (typeof v === 'string') return v;
  if (col.format === 'ip') {
    const whole = Math.floor(v / 3);
    return `${whole}.${Math.round(v) - whole * 3}`;
  }
  if (col.format === 'rate3') {
    const s = v.toFixed(3);
    return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? `-${s.slice(2)}` : s;
  }
  const text = v.toLocaleString('en-US', { minimumFractionDigits: col.decimals, maximumFractionDigits: col.decimals });
  return col.format === 'percent' ? `${text}%` : text;
}

export interface ResearchSeasonRow {
  season: number;
  label: string;
  games: number;
  values: Record<string, number | null>;
}

export interface ResearchTrendStat {
  key: string;
  label: string;
  decimals: number;
  /** One per game, oldest first. `value` is null where the stat was not recorded. */
  points: Array<{ eventId: string; date: string; season: number; value: number | null; label: string }>;
}

export interface ResearchSplitRow {
  key: string;
  /** Rows are grouped under this heading: "Venue", "Result", "Month", "Opponent". */
  group: string;
  label: string;
  games: number;
  values: Record<string, number | null>;
}

export interface ResearchLogRow {
  eventId: string;
  date: string;
  season: number;
  opponentLabel: string;
  opponentLogoUrl: string | null;
  isHome: boolean | null;
  result: 'W' | 'L' | 'D' | null;
  /** "8-3" from the player's side, or the match score. */
  score: string | null;
  values: Record<string, number | string | null>;
  href: string | null;
}

export interface PlayerResearchData {
  /** "hitter", "pitcher", "quarterback"… Drives nothing in the component; shown in Sources. */
  kind: string;
  hero: {
    /** "2026 season" or "2025 season (2026: 3 games)". */
    scopeLabel: string;
    /** Why the page opened on last season, when it did. */
    scopeReason: string | null;
    /** "72-51 in games played". `null` where results do not join. */
    record: string | null;
    /** Games in the scope season — the hero's headline number. */
    games: number;
    /**
     * What `games` counts, where a sport does not play games: golf counts
     * rounds (R6.6). Omitted means games.
     */
    unit?: { one: string; many: string };
    /**
     * The last five games played, oldest first, for the hero's form strip.
     * `result` is null where a sport's results do not join (tennis reads
     * `match_won`), and the strip then shows the dates alone rather than
     * inventing a W.
     */
    lastFive: Array<{
      /** Null where the source dates nothing: golf's events carry no start date (R6.6). */
      date: string | null;
      opponent: string;
      result: 'W' | 'L' | 'D' | null;
      /** Printed instead of the result where a sport has none — golf's round to par ("-4"). */
      mark?: string;
      tone?: 'good' | 'bad' | null;
    }>;
    tiles: ResearchTile[];
  };
  seasons: { columns: ResearchColumn[]; rows: ResearchSeasonRow[]; caption: string | null };
  trends: { stats: ResearchTrendStat[]; rollingWindow: number };
  splits: {
    columns: ResearchColumn[];
    /** Seasons the scope control offers, newest first. */
    seasons: number[];
    defaultSeason: number;
    rowsBySeason: Record<number, ResearchSplitRow[]>;
  };
  gameLog: { columns: ResearchColumn[]; rows: ResearchLogRow[] };
  /** Seasons in the history, labelled per the sport's convention, newest first. */
  seasonLabels: Array<{ season: number; label: string }>;
  /** The sport's own sections, in page order (MLB's "Contact quality & approach"…). Empty for a sport not yet rebuilt. */
  sections: ResearchSection[];
}

/** A page URL may carry the namespaced subject id or the bare athlete id; both name the same player. */
export function sameSubject(subjectId: string, urlId: string): boolean {
  return subjectId === urlId || athleteIdOf(subjectId) === athleteIdOf(urlId);
}

// ---------------------------------------------------------------------------
// A sport's own sections (R6.1b onwards)
// ---------------------------------------------------------------------------

/**
 * One card of a sport's own section, as DATA. The page draws each kind the same
 * way for every sport — a percentile list, a histogram, a line over games, a
 * table, a place on the sport's surface, or a status for data that is not held
 * — so MLB's "Contact quality" and NFL's "Usage & depth" are two lists of these
 * built by two adapters, and the component never learns either sport.
 *
 * Formatters and surface roles may carry functions (as `SpatialGridRole`
 * already does); nothing here carries JSX.
 */
export type ResearchCard =
  | {
      kind: 'percentiles';
      key: string;
      title: string;
      scope?: string;
      info?: string;
      caption?: string;
      /** A row without a percentile (a hitter below the qualifier) prints its value only. */
      rows: Array<{
        key: string;
        label: string;
        valueText: string;
        percentile: number | null;
        direction: 'higher' | 'lower' | 'neutral';
        info?: string;
        /** "4th of 30", where the row is a league rank rather than a qualified-pool percentile (R7). */
        rank?: { rank: number; of: number };
        /** Every team's value with this one's, drawn as a dot strip instead of the bar (R7). */
        strip?: { league: number[]; value: number };
      }>;
    }
  | {
      kind: 'histogram';
      key: string;
      title: string;
      scope?: string;
      caption?: string;
      bars: Array<{ key: string; axisLabel: string; value: number; highlight: boolean; tip: string; tone?: 'good' | 'bad' }>;
      /** Legend for toned bars ("won", "lost") — R7's margin by game. */
      toneLegend?: { good: string; bad: string };
      /** Legend text for the highlighted bars ("hard-hit, 95+ mph"). */
      highlightLabel?: string;
    }
  | {
      kind: 'series';
      key: string;
      title: string;
      scope?: string;
      caption?: string;
      /** The dark line. */
      values: number[];
      /** The grey line behind it. */
      context?: number[];
      xLabels: string[];
      reference?: { value: number; label: string };
      zeroBased: boolean;
      min?: number;
      max?: number;
      decimals: number;
      unit: string;
      /**
       * For a series whose stored values are not what the axis should read —
       * tennis's ranking is held negated so "up is better" holds, but the axis
       * has to say No. 1, not -1.
       */
      axisFormat?: { negate?: boolean; prefix?: string };
      tips: string[][];
      legend?: Array<{ label: string; dark: boolean }>;
    }
  | {
      kind: 'table';
      key: string;
      title: string;
      scope?: string;
      info?: string;
      caption?: string;
      labelHeader: string;
      columns: ResearchColumn[];
      rows: ResearchTableRow[];
      emptyText?: string;
      /** Opens sorted on this column, descending. Unset keeps the rows' own order. */
      sortKey?: string;
      /** Other tables on the same card, behind a switch (a roster's hitters and pitchers). The top-level table is the first view. */
      views?: Array<{ key: string; label: string; labelHeader: string; columns: ResearchColumn[]; rows: ResearchTableRow[]; sortKey?: string }>;
      /** Rows are not sortable where their order is the content (a schedule, a standings table). */
      fixedOrder?: boolean;
    }
  | {
      kind: 'surface';
      key: string;
      title: string;
      scope?: string;
      caption?: string;
      /** One or more views of the same place; the card switches between them. */
      views: Array<{ key: string; label: string; role: import('./playerRoles').SpatialGridRole }>;
    }
  | {
      kind: 'scatter';
      key: string;
      title: string;
      scope?: string;
      caption?: string;
      /**
       * Where the points are drawn. `zone` is the strike zone, catcher's view,
       * in feet (x across, y up). `field` is a football field from behind the
       * quarterback: x is the lateral position in [-1, 1], y is air yards.
       * `pitch` is soccer's attacking half seen from behind the goal being
       * attacked: x is across the pitch and y is Understat's own 0.5-1 depth.
       * `court` is an NBA half court with the RIM as the origin: x is 0-50
       * across and y is feet out from the rim. `rink` is NHL's offensive zone,
       * rotated so every shot attacks the same end: x is feet from the goal
       * line and y is feet across the ice.
       */
      surface: 'zone' | 'field' | 'pitch' | 'court' | 'rink' | 'spray';
      points: Array<[string | null, number, number]>;
      /** Per point, same order: how big to draw it (a shot's xG). */
      weights?: number[];
      /** Per point, same order: the one outcome worth picking out (a goal). */
      emphasis?: boolean[];
      /** Per point, same order: the lines of its tooltip. */
      tips?: string[][];
      /** Per point, same order: a short mark drawn in the dot (a pitch's number in an at-bat). `zone` only. */
      labels?: Array<string | null>;
      /** Shown under the chart when `emphasis` carries the meaning colour usually would. */
      legend?: Array<{ label: string; dark: boolean }>;
      /** Most common first; colour follows this order. The reader toggles groups on and off. */
      groups: Array<{ key: string; label: string; count: number }>;
      defaultVisible: string[];
    }
  | { kind: 'status'; key: string; title: string; headline: string; reason: string }
  | {
      /**
       * A list beside the detail of the item picked from it — R8.1's at-bat
       * explorer: plate appearances grouped by inning, and each one's pitch
       * plot and pitch table. The detail is ordinary cards.
       */
      kind: 'drilldown';
      key: string;
      title: string;
      scope?: string;
      items: Array<{ key: string; group: string; label: string; sub?: string; badge?: string | null; imageUrl?: string | null; cards: ResearchCard[] }>;
      /** Opens on this item; the first when unset. */
      defaultKey?: string;
    };

/**
 * The season a sport's own section opens on: the reader's pick, else the
 * page's scope season (the hero's, which falls back to last season while the
 * current one is under `SEASON_MIN_GAMES`), else the newest the source holds.
 *
 * R6 AUDIT, 2026-09-16: only NFL's section followed the early-season rule, by
 * its own row count; NBA, NHL, soccer and tennis opened on the newest season
 * whatever it held, so a young EPL season showed three matches under a hero
 * that said it was showing last season. The scope is only used when the source
 * holds it — a shot table that holds only the current season opens on that.
 * Every section's season numbering was checked against the history's first
 * (NBA end year, NHL/NFL/EPL start year, tennis calendar).
 *
 * Typed like the `seasons[seasons.length - 1]` it replaced: every caller
 * guards on a non-empty list first.
 */
export function sectionOpeningSeason(seasons: number[], picked: number | null | undefined, scope: number | null | undefined): number {
  if (picked != null) return picked;
  if (scope != null && seasons.includes(scope)) return scope;
  return seasons[seasons.length - 1];
}

export interface ResearchTableRow {
  key: string;
  label: string;
  values: Record<string, number | string | null>;
  /** The label links here (a team, a player). */
  href?: string | null;
  /** A logo or headshot beside the label. */
  imageUrl?: string | null;
  /** Headshots draw larger and round; logos small and square. Default logo. */
  imageKind?: 'logo' | 'player';
  /** Small text after the label ("SS", "No. 4"). */
  labelNote?: string | null;
  /** This page's own row in a league table. Marked in text too, never colour alone. */
  highlight?: boolean;
  /** Colour for a cell whose text already says the outcome ("W 5-3"). */
  tones?: Record<string, 'good' | 'bad'>;
}

export interface ResearchSection {
  id: string;
  navLabel: string;
  title: string;
  sub?: string;
  /** Rows of one or two cards; two share a row at desktop width and stack on a phone. */
  rows: ResearchCard[][];
  state: { kind: 'ready' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'empty'; title: string; reason: string };
  /** The section's season control, when its source is per season. */
  season?: { value: number; options: Array<{ value: number; label: string }> };
  /** A sentence about how complete the source is, shown above the cards ("Statcast holds 261 of 283 plate appearances"). */
  note?: string;
  /** For the Sources section. */
  source?: { label: string; detail: string; asOf: string | null };
}
