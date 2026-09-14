/**
 * One season convention, for every sport — R2.
 *
 * WHY THIS EXISTS. There were **eight** season helpers in TypeScript
 * (`currentCfbdSeason`, `currentNbaSeason`, `currentNbaSeasonYear`,
 * `currentNhlSeason`, `currentUnderstatSeason`, `currentAsaSeason`,
 * `currentTennisSeason`, MLB's `currentSeason`) and seven more in Python, each
 * re-deriving the same rule next to the fetcher that needed it. They agree
 * today; nothing makes them agree tomorrow. Two of them — NBA's pair — are
 * already literal duplicates of each other, which is the drift risk having
 * already happened and simply not yet diverged.
 *
 * NFL had no TypeScript helper at all, which is why nothing on this side could
 * answer "which season is this" for the sport whose pages are busiest.
 *
 * THE CONVENTIONS ARE NOT A CHOICE. Each matches its own upstream's, so the
 * stored `season` integer lines up with what a live fetch would use. Copied
 * from `backfill_player_game_history.py`, which is the authority:
 *
 *   NBA  -> the year the season ENDS   (2026 == the 2025-26 season)
 *   NHL  -> the year the season STARTS (2025 == the 2025-26 season)
 *   NFL  -> STARTS
 *   CFB  -> STARTS
 *   EPL  -> STARTS
 *   MLS  -> calendar year
 *   MLB  -> calendar year
 *   tennis -> calendar year
 *
 * DATE RANGES follow that file's `_sweep_bounds` exactly: the end offset is
 * counted from the season's START year, not from its label. Getting that
 * backwards puts NBA's 2025-26 season's end in May 2027.
 *
 * MLB and tennis have no range in the Python config (it marks their sweep
 * fields unused — both are queried by season, not by date window), so the two
 * ranges here are this module's own and are deliberately generous at the
 * edges: they are used to decide whether a date falls in a season, never to
 * drive a fetch.
 *
 * Kept in step with `python-odds-service/src/season.py` by
 * `tests/season-convention.test.ts`, which parses both files.
 */

/** How a sport labels the season, relative to the calendar year it starts in. */
export type SeasonLabelRule = 'start' | 'end' | 'calendar';

export interface SeasonConvention {
  /** `end` means the label is the year the season finishes in, so it starts the year before. */
  label: SeasonLabelRule;
  /** [month, day] in the season's START year. */
  start: [number, number];
  /** [yearsAfterStart, month, day]. */
  end: [number, number, number];
}

// SEASON_CONVENTIONS_START — parsed by tests/season-convention.test.ts
export const SEASON_CONVENTIONS: Record<string, SeasonConvention> = {
  mlb: { label: 'calendar', start: [3, 1], end: [0, 11, 30] },
  nfl: { label: 'start', start: [9, 1], end: [1, 2, 20] },
  cfb: { label: 'start', start: [8, 15], end: [1, 1, 20] },
  nba: { label: 'end', start: [10, 1], end: [1, 5, 15] },
  nhl: { label: 'start', start: [9, 1], end: [1, 6, 15] },
  soccer_epl: { label: 'start', start: [8, 1], end: [1, 6, 5] },
  soccer_mls: { label: 'calendar', start: [2, 15], end: [0, 12, 15] },
  tennis_atp: { label: 'calendar', start: [1, 1], end: [0, 12, 31] },
  tennis_wta: { label: 'calendar', start: [1, 1], end: [0, 12, 31] },
};
// SEASON_CONVENTIONS_END

export type SeasonSport = keyof typeof SEASON_CONVENTIONS;

export function isSeasonSport(sport: string): sport is SeasonSport {
  return sport in SEASON_CONVENTIONS;
}

function conventionFor(sport: string): SeasonConvention {
  const c = SEASON_CONVENTIONS[sport];
  if (!c) throw new Error(`No season convention for sport "${sport}"`);
  return c;
}

/** The calendar year a season begins in — the label itself, except where the label is the end year. */
export function seasonStartYear(sport: string, season: number): number {
  return conventionFor(sport).label === 'end' ? season - 1 : season;
}

/**
 * What to print. "2025-26" for a season that spans two calendar years,
 * "2025" for one that doesn't — so a page never labels a split season with a
 * single year, which is the whole "mislabeled seasons" complaint.
 */
export function seasonLabel(sport: string, season: number): string {
  const c = conventionFor(sport);
  const startYear = seasonStartYear(sport, season);
  const endYear = startYear + c.end[0];
  if (endYear === startYear) return String(startYear);
  return `${startYear}-${String(endYear).slice(-2)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Inclusive ISO date bounds for a season. */
export function seasonDateRange(sport: string, season: number): { from: string; to: string } {
  const c = conventionFor(sport);
  const startYear = seasonStartYear(sport, season);
  const [sm, sd] = c.start;
  const [yoff, em, ed] = c.end;
  return {
    from: `${startYear}-${pad(sm)}-${pad(sd)}`,
    to: `${startYear + yoff}-${pad(em)}-${pad(ed)}`,
  };
}

/** Whether an ISO date falls inside a season's range. */
export function dateInSeason(sport: string, season: number, isoDate: string): boolean {
  const { from, to } = seasonDateRange(sport, season);
  const d = isoDate.slice(0, 10);
  return d >= from && d <= to;
}

/**
 * The season a date belongs to.
 *
 * DATES ARE INTERPRETED IN US EASTERN, not UTC. Every one of the eight
 * helpers this replaces used `getUTCMonth()`, so a season boundary could flip
 * up to five hours early — the same class of bug R1d fixed for ESPN's date
 * ranges, where a UTC rollover at 8pm Eastern made an in-progress game
 * disappear. The window here is a month wide, so the blast radius is smaller,
 * but there is no reason for two date rules in one codebase.
 */
export function seasonForDate(sport: string, date: Date = new Date()): number {
  const c = conventionFor(sport);
  const eastern = easternParts(date);
  const { year, month, day } = eastern;
  if (c.label === 'calendar') return year;
  // Before this season's start date, the current season is still the previous
  // one — between seasons, the most recent real data is last season's.
  const [sm, sd] = c.start;
  const started = month > sm || (month === sm && day >= sd);
  const startYear = started ? year : year - 1;
  return c.label === 'end' ? startYear + 1 : startYear;
}

/** Month is 1-indexed, matching the convention table. */
function easternParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * Games a team must have played in a season for it to count as a real
 * team-season.
 *
 * MEASURED, not chosen. `player_game_history` carries **9 NBA "teams" that do
 * not exist**: ids 31 and 32 on 2024-02-19, 130579/130580/130581/130754 on
 * 2025-02-17, and 111386/132374/132375 on 2026-02-15/16 — 130 rows in total,
 * every one of them on All-Star weekend. They are why the table reports 39 NBA
 * teams instead of 30, and they would otherwise sit in a league rank pool
 * beside real ones.
 *
 * A fraction of the *observed* maximum, rather than a hardcoded roster, so it
 * needs no maintenance in February and works the same for CFB's 245 programs
 * as for the NBA's 30. The gap it has to separate is enormous — a real NBA
 * team-season shows ~244 game days against All-Star's 1 — so the threshold is
 * not delicate.
 *
 * 30% is the plan's own figure for the rank pool. The same predicate serves
 * both rules: a team too thin to rank is the same team too thin to be real.
 */
export const REAL_TEAM_MIN_GAMES_FRACTION = 0.3;

/**
 * Filters a sport's team-seasons down to the ones that really played.
 *
 * Takes plain `{ teamId, games }` pairs so it can be used on a rank rollup, a
 * roster list, or raw history rows without any of them sharing a type.
 */
export function realTeams<T extends { teamId: string; games: number }>(rows: T[]): T[] {
  if (rows.length === 0) return [];
  const max = Math.max(...rows.map((r) => r.games));
  if (max <= 0) return [];
  const floor = max * REAL_TEAM_MIN_GAMES_FRACTION;
  return rows.filter((r) => r.games >= floor);
}

/**
 * How many games a season needs before a page opens on it — R2.
 *
 * Distinct from the rank pool's per-sport `minGames`, which asks how many
 * games one TEAM needs to be ranked. This asks whether the SEASON has enough
 * of itself to be worth showing: in week 1 every card reads "1 game" and
 * every split is empty, which is worse than last season's real numbers
 * clearly labelled as last season's.
 *
 * The numbers are the plan's, and they scale with how long a season is:
 * four games is a quarter of a football season, fifteen is a fifth of a
 * basketball or hockey one, twenty is an eighth of a baseball one, six is a
 * sixth of a league campaign.
 */
export const SEASON_MIN_GAMES: Record<string, number> = {
  nfl: 4,
  cfb: 4,
  nba: 15,
  nhl: 15,
  mlb: 20,
  soccer_epl: 6,
  soccer_mls: 6,
  // Tennis has no team season to be thin: a player's calendar year either has
  // matches in it or does not, and a page opens on whatever there is.
  tennis_atp: 0,
  tennis_wta: 0,
};

export interface SeasonScope {
  /** The season to open on. */
  season: number;
  /** True when that is not the current one. */
  isFallback: boolean;
  /** A sentence to render. `null` when opening on the current season. */
  reason: string | null;
}

/**
 * Which season a page should open on, given how many games the current one
 * has so far.
 *
 * ALWAYS STATES THE REASON when it falls back. The failure this exists to
 * prevent is not showing the wrong season — it is showing the wrong season
 * silently, which is exactly what `/api/season-ranks` was doing for cfb,
 * soccer_epl and soccer_mls on 2026-09-14.
 */
export function seasonScope(sport: string, gamesInCurrentSeason: number, now: Date = new Date()): SeasonScope {
  const current = seasonForDate(sport, now);
  const min = SEASON_MIN_GAMES[sport] ?? 0;
  if (gamesInCurrentSeason >= min) return { season: current, isFallback: false, reason: null };
  const previous = current - 1;
  const played = gamesInCurrentSeason === 1 ? '1 game' : `${gamesInCurrentSeason} games`;
  return {
    season: previous,
    isFallback: true,
    reason: `${seasonLabel(sport, current)} is ${played} old, so this shows ${seasonLabel(sport, previous)}.`,
  };
}
