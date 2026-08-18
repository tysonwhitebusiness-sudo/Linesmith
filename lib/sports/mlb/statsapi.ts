/**
 * MLB Stats API client (statsapi.mlb.com — official, free, no key).
 *
 * The expensive calls are cached in-process because the UI re-fetches every few
 * minutes and most of this data (finished games, season game logs) does not
 * change between refreshes.
 */

const BASE = 'https://statsapi.mlb.com/api';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<any>>();
// Keys with a background refresh already in flight — collapses concurrent
// callers hitting the same stale key into a single upstream fetch instead of
// each firing its own.
const refreshing = new Set<string>();

/**
 * Why the most recent fetches failed.
 *
 * `getJson` returns null on every kind of failure, which is the right shape for
 * callers but makes a fault indistinguishable from an empty result — a whole
 * slate of batters can vanish and the API still answers 200. This keeps the
 * last handful of reasons so `/api/diagnostics` can show what actually broke.
 */
const FETCH_ERROR_LIMIT = 20;
const fetchErrors: Array<{ url: string; reason: string; at: string }> = [];

export function recentFetchErrors(): ReadonlyArray<{ url: string; reason: string; at: string }> {
  return fetchErrors;
}

function noteFailure(url: string, reason: string) {
  fetchErrors.unshift({ url: url.slice(0, 160), reason, at: new Date().toISOString() });
  if (fetchErrors.length > FETCH_ERROR_LIMIT) fetchErrors.length = FETCH_ERROR_LIMIT;
}

async function getJson<T = any>(url: string, timeoutMs = 30000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      noteFailure(url, `HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (error) {
    noteFailure(url, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAndCache<T = any>(key: string, url: string, ttlMs: number, retries: number): Promise<T | null> {
  let value = await getJson<T>(url);

  // One retry. A single transient abort in a batched fetch silently drops
  // every player in that batch — 40 at a time — and the scan just comes up
  // short with no indication which players are missing or why.
  for (let attempt = 0; value === null && attempt < retries; attempt += 1) {
    value = await getJson<T>(url);
  }

  // Only cache successes; a failed fetch should be retried on the next refresh.
  if (value !== null) cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/**
 * Stale-while-revalidate: a key that has been fetched before is always
 * answered from cache immediately, even past its TTL, while a background
 * fetch quietly brings it current for next time. Only a key that has never
 * been fetched blocks its caller on the network.
 *
 * Without this, every request that happened to land right after a TTL lapsed
 * paid the full upstream round trip inline — invisible on pages that fire one
 * or two cached calls, but Teams fires half a dozen at once (standings,
 * roster, form, statcast, batter ranks), so it was the page most likely to
 * catch one mid-expiry and stall for it.
 */
async function cachedJson<T = any>(key: string, url: string, ttlMs: number, retries = 1): Promise<T | null> {
  const hit = cache.get(key);

  if (hit) {
    if (hit.expiresAt <= Date.now() && !refreshing.has(key)) {
      refreshing.add(key);
      void fetchAndCache<T>(key, url, ttlMs, retries).finally(() => refreshing.delete(key));
    }
    return hit.value as T;
  }

  return fetchAndCache<T>(key, url, ttlMs, retries);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** MLB's "today" is the US Eastern date, not the server's local date. */
export function easternDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export interface MlbTeamRef {
  id: number;
  name: string;
  abbreviation?: string;
}

export interface MlbGame {
  gamePk: number;
  gameDate: string;
  detailedState: string;
  abstractState: string;
  dayNight?: string;
  venue?: { id: number; name: string; location?: { defaultCoordinates?: { latitude: number; longitude: number } } };
  teams: {
    away: { team: MlbTeamRef; probablePitcher?: { id: number; fullName: string }; score?: number };
    home: { team: MlbTeamRef; probablePitcher?: { id: number; fullName: string }; score?: number };
  };
  lineups?: { homePlayers?: Array<{ id: number; fullName: string }>; awayPlayers?: Array<{ id: number; fullName: string }> };
  linescore?: {
    currentInning?: number;
    inningState?: string;
    isTopInning?: boolean;
    innings?: Array<{ num: number; home?: { runs?: number }; away?: { runs?: number } }>;
  };
}

function flattenGames(schedule: any): MlbGame[] {
  const out: MlbGame[] = [];
  for (const date of schedule?.dates ?? []) {
    for (const game of date?.games ?? []) {
      out.push({
        gamePk: game.gamePk,
        gameDate: game.gameDate,
        detailedState: game?.status?.detailedState ?? 'Unknown',
        abstractState: game?.status?.abstractGameState ?? 'Unknown',
        dayNight: game.dayNight,
        venue: game.venue,
        teams: game.teams,
        lineups: game.lineups,
        linescore: game.linescore,
      });
    }
  }
  return out;
}

/** Today's slate, with probables, posted lineups and venue coordinates. */
export async function getSlate(date: string): Promise<MlbGame[]> {
  const url =
    `${BASE}/v1/schedule?sportId=1&date=${date}` +
    `&hydrate=probablePitcher,linescore,team,lineups,venue(location)`;
  const json = await cachedJson(`slate:${date}`, url, 60_000);
  return json ? flattenGames(json) : [];
}

/**
 * A window of past games carrying per-inning linescores and probable pitchers.
 * One request replaces hundreds of per-game fetches, so the first-inning and
 * handedness dimensions stay cheap.
 */
export async function getScheduleRange(startDate: string, endDate: string): Promise<MlbGame[]> {
  // Same field-trimming rationale as the game logs: 45 days of fully hydrated
  // linescores is a large payload, and only the first inning, the listed
  // starters and (for Game Detail's recent-results/H2H) the final score are
  // ever read from it. `score` has to be named explicitly here — the Stats
  // API's `fields=` allow-list drops anything not listed, and its absence
  // silently made every team's final score `undefined`, which made
  // `extractTeamResults` skip every completed game rather than erroring.
  const url =
    `${BASE}/v1/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}` +
    `&gameType=R&hydrate=linescore,probablePitcher,team,venue` +
    `&fields=dates,games,gamePk,gameDate,status,detailedState,abstractGameState,teams,away,home,team,id,name,abbreviation,score,probablePitcher,fullName,linescore,innings,num,runs,venue`;
  const json = await cachedJson(`range:${startDate}:${endDate}`, url, 30 * 60_000);
  return json ? flattenGames(json) : [];
}

/** Recent posted lineups, used to project a lineup before today's is announced. */
export async function getRecentLineups(endDate: string, days = 4): Promise<MlbGame[]> {
  const start = shiftDate(endDate, -days);
  const url = `${BASE}/v1/schedule?sportId=1&startDate=${start}&endDate=${endDate}&hydrate=lineups,team`;
  const json = await cachedJson(`lineups:${start}:${endDate}`, url, 15 * 60_000);
  return json ? flattenGames(json) : [];
}

// ---------------------------------------------------------------------------
// Live feed
// ---------------------------------------------------------------------------

export interface MlbLiveFeed {
  gamePk: number;
  linescore: any;
  boxscore: any;
  gameData: any;
  plays: any;
}

export async function getLiveFeed(gamePk: number): Promise<MlbLiveFeed | null> {
  // Deliberately uncached: this is the only genuinely live data in the app.
  const json = await getJson(`${BASE}/v1.1/game/${gamePk}/feed/live`);
  if (!json) return null;
  return {
    gamePk,
    linescore: json.liveData?.linescore ?? {},
    boxscore: json.liveData?.boxscore ?? {},
    gameData: json.gameData ?? {},
    plays: json.liveData?.plays ?? {},
  };
}

// ---------------------------------------------------------------------------
// People / stats
// ---------------------------------------------------------------------------

export interface GameLogSplit {
  date: string;
  isHome: boolean;
  gamePk?: number;
  opponentId?: number;
  opponentName?: string;
  teamId?: number;
  stat: Record<string, any>;
}

export interface PersonStats {
  id: number;
  fullName: string;
  batSide?: string;
  pitchHand?: string;
  primaryPosition?: string;
  gameLog: GameLogSplit[];
}

function parsePeople(json: any): PersonStats[] {
  return (json?.people ?? []).map((person: any) => {
    const logs = (person.stats ?? []).find((s: any) => s?.type?.displayName === 'gameLog');
    return {
      id: person.id,
      fullName: person.fullName,
      batSide: person?.batSide?.code,
      pitchHand: person?.pitchHand?.code,
      primaryPosition: person?.primaryPosition?.abbreviation,
      gameLog: (logs?.splits ?? []).map((split: any) => ({
        date: split.date,
        isHome: Boolean(split.isHome),
        gamePk: split?.game?.gamePk,
        opponentId: split?.opponent?.id,
        opponentName: split?.opponent?.name,
        teamId: split?.team?.id,
        stat: split.stat ?? {},
      })),
    };
  });
}

/**
 * Ask only for the fields we read.
 *
 * A full-season game log for 40 players is ~1.2 MB unfiltered, and a 15-game
 * slate needs seven of those batches — roughly 33 MB pulled through Next's
 * instrumented `fetch`, which was slow enough to trip the request timeout and
 * silently drop **every batter** from the scan. The same request restricted to
 * these fields is ~0.19 MB and six times faster, with an identical split count.
 *
 * MLB's `fields` parameter is a flat allow-list of key names matched at any
 * depth, so nested keys (`game.gamePk`) are listed by their leaf name. Anything
 * a consumer needs must appear here — a missing key silently becomes undefined
 * rather than an error, so add to this list when reading a new stat.
 */
const GAME_LOG_FIELDS =
  'fields=' +
  [
    // Person
    'people,id,fullName,batSide,code,pitchHand,primaryPosition,abbreviation',
    // Log structure
    'stats,type,displayName,splits,date,isHome,game,gamePk,opponent,name,team',
    // Stat line — batting, pitching, and everything the gamelog table shows
    'stat,hits,atBats,plateAppearances,gamesStarted,runs,doubles,triples,homeRuns',
    'rbi,baseOnBalls,strikeOuts,totalBases,stolenBases,hitByPitch,earnedRuns,inningsPitched',
  ].join(',');

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Map with bounded concurrency.
 *
 * Firing every batch at once is measurably worse here than running a few at a
 * time. The same seven game-log requests complete in ~1.3s from a plain Node
 * script but took over a minute issued in parallel through the framework's
 * instrumented `fetch`, with several aborting outright and taking 40 players
 * each down with them. Throughput was never the constraint; simultaneity was.
 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Batched player fetch with season game logs. `personIds` accepts many ids per
 * request, which is what keeps a full slate to a handful of calls.
 */
export async function getPeopleWithGameLogs(
  ids: number[],
  group: 'hitting' | 'pitching',
  season: number,
  batchSize = 40,
): Promise<Map<number, PersonStats>> {
  const unique = [...new Set(ids)].filter((id) => Number.isFinite(id));
  const out = new Map<number, PersonStats>();
  if (unique.length === 0) return out;

  const batches = chunk(unique, batchSize);
  const results = await mapLimit(batches, 3, (batch) => {
    const key = `people:${group}:${season}:${batch.join(',')}`;
    const url =
      `${BASE}/v1/people?personIds=${batch.join(',')}` +
      `&hydrate=stats(group=${group},type=gameLog,season=${season})` +
      `&${GAME_LOG_FIELDS}`;
    return cachedJson(key, url, 10 * 60_000);
  });

  for (const json of results) {
    for (const person of parsePeople(json)) out.set(person.id, person);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Team season stats and league ranks
// ---------------------------------------------------------------------------

/**
 * The stat set both reference products compare teams on, in their order.
 * `key` is what the API calls it; `label` is what a scoreboard calls it.
 */
export const TEAM_STAT_KEYS = [
  { key: 'runs', label: 'R', decimals: 0 },
  { key: 'hits', label: 'H', decimals: 0 },
  { key: 'singles', label: '1B', decimals: 0 },
  { key: 'doubles', label: '2B', decimals: 0 },
  { key: 'triples', label: '3B', decimals: 0 },
  { key: 'totalBases', label: 'TB', decimals: 0 },
  { key: 'earnedRuns', label: 'ER', decimals: 0 },
  { key: 'homeRuns', label: 'HR', decimals: 0 },
  { key: 'rbi', label: 'RBI', decimals: 0 },
  { key: 'baseOnBalls', label: 'BB', decimals: 0 },
  { key: 'strikeOuts', label: 'SO', decimals: 0 },
  { key: 'stolenBases', label: 'SB', decimals: 0 },
  { key: 'avg', label: 'AVG', decimals: 3 },
  { key: 'obp', label: 'OBP', decimals: 3 },
  { key: 'slg', label: 'SLG', decimals: 3 },
  { key: 'ops', label: 'OPS', decimals: 3 },
] as const;

export type TeamStatKey = (typeof TEAM_STAT_KEYS)[number]['key'];

export interface TeamStatLine {
  teamId: number;
  teamName: string;
  gamesPlayed: number;
  values: Partial<Record<TeamStatKey, number>>;
}

/**
 * Singles aren't reported directly — they're hits minus the extra-base hits.
 * Deriving it here keeps the comparison table's stat list complete without
 * inventing a number, since every term is a real reported figure.
 */
function readStatLine(split: any): TeamStatLine {
  const raw = split?.stat ?? {};
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const hits = num(raw.hits);
  const doubles = num(raw.doubles);
  const triples = num(raw.triples);
  const homeRuns = num(raw.homeRuns);
  const singles =
    hits != null && doubles != null && triples != null && homeRuns != null
      ? hits - doubles - triples - homeRuns
      : undefined;

  return {
    teamId: split?.team?.id,
    teamName: split?.team?.name ?? '',
    gamesPlayed: num(raw.gamesPlayed) ?? 0,
    values: {
      runs: num(raw.runs),
      hits,
      singles,
      doubles,
      triples,
      totalBases: num(raw.totalBases),
      earnedRuns: num(raw.earnedRuns),
      homeRuns,
      rbi: num(raw.rbi),
      baseOnBalls: num(raw.baseOnBalls),
      strikeOuts: num(raw.strikeOuts),
      stolenBases: num(raw.stolenBases),
      avg: num(raw.avg),
      obp: num(raw.obp),
      slg: num(raw.slg),
      ops: num(raw.ops),
    },
  };
}

/**
 * Season totals for all 30 teams in one call, per group.
 *
 * `hitting` is what a team does; `pitching` is what it allows — which is what
 * makes an opponent's pitching rank a genuine defensive-matchup signal rather
 * than a guess.
 */
export async function getTeamSeasonStats(
  season: number,
  group: 'hitting' | 'pitching',
): Promise<TeamStatLine[]> {
  const url = `${BASE}/v1/teams/stats?season=${season}&stats=season&group=${group}&sportIds=1`;
  const json = await cachedJson(`teamstats:${group}:${season}`, url, 60 * 60_000);
  const splits = json?.stats?.[0]?.splits ?? [];
  return splits.map(readStatLine).filter((line: TeamStatLine) => Number.isFinite(line.teamId));
}

export type TeamRanks = Map<number, Partial<Record<TeamStatKey, number>>>;

/**
 * Pitching's one exception to "fewer allowed is better": strikeouts are
 * something the pitching staff *records*, not something it *allows* — a
 * staff that strikes out more batters is pitching better, the opposite
 * direction from hits/walks/runs/HR allowed. Ranking it with the same
 * `higherIsBetter: false` as the rest of the pitching group (as this file
 * did until this fix) put rank 1 on the staff that strikes out the *fewest*
 * batters — read as "strongest," when the roster comment's own convention
 * says rank 1 should mean strongest. Caught while building opponent-matchup
 * context for player props, where getting this backwards would have told a
 * batter-strikeouts prop the exact wrong thing about the pitching staff
 * they're facing.
 */
export const PITCHING_RANK_INVERTED_KEYS = new Set<TeamStatKey>(['strikeOuts']);

/**
 * League rank per team per stat, 1 = best.
 *
 * "Best" depends on which side of the ball you're on: for a team's own hitting,
 * more runs is better; for what it allows, fewer is better. `higherIsBetter`
 * flips the sort so a rank of 1 always reads as "strongest" and 30 as "most
 * exploitable", which is the only way FOR and AGAINST columns can sit side by
 * side without meaning opposite things. `invertKeys` flips that default back
 * for the specific stats (see `PITCHING_RANK_INVERTED_KEYS`) where the group's
 * general rule doesn't hold.
 */
export function rankTeams(
  lines: TeamStatLine[],
  higherIsBetter: boolean,
  invertKeys: ReadonlySet<TeamStatKey> = new Set(),
): TeamRanks {
  const ranks: TeamRanks = new Map(lines.map((l) => [l.teamId, {}]));

  for (const { key } of TEAM_STAT_KEYS) {
    const wantHigher = invertKeys.has(key) ? !higherIsBetter : higherIsBetter;
    const withValue = lines
      .filter((l) => l.values[key] != null)
      .sort((a, b) => {
        const av = a.values[key] as number;
        const bv = b.values[key] as number;
        return wantHigher ? bv - av : av - bv;
      });

    withValue.forEach((line, index) => {
      const bucket = ranks.get(line.teamId);
      if (bucket) bucket[key] = index + 1;
    });
  }

  return ranks;
}

// ---------------------------------------------------------------------------
// League-wide starting-pitcher ranks (sharper matchup signal than team rank)
// ---------------------------------------------------------------------------

/**
 * Team-level opponent rank (`rankTeams` above) is whole-staff, bullpen
 * included — real, but blunt: a batter facing a team's ace tonight is facing
 * a different pitcher than the one who dragged that team's bullpen ERA down.
 * This ranks the *individual starter* against every other MLB starter, for
 * exactly the stats a batter-prop matchup bullet cares about.
 */
export const PITCHER_RANK_KEYS = [
  { key: 'era', decimals: 2 },
  { key: 'strikeOuts', decimals: 0 },
  { key: 'baseOnBalls', decimals: 0 },
  { key: 'hits', decimals: 0 },
  { key: 'homeRuns', decimals: 0 },
  { key: 'whip', decimals: 2 },
  { key: 'fip', decimals: 2 },
  { key: 'kbbPct', decimals: 1 },
  // Statcast quality metrics — only populated for pitchers run through
  // `getRoleAwarePitcherRankings` (savant.ts), which merges these into a
  // PitcherStatLine's `values` before ranking. `getLeagueStartingPitcherStats`
  // (the live per-scan hot path) never sets these, so they silently drop out
  // of that pool's cards rather than showing as zero/undefined.
  { key: 'whiffPct', decimals: 1 },
  { key: 'barrelPct', decimals: 1 },
  { key: 'exitVelo', decimals: 1 },
  { key: 'hardHitPct', decimals: 1 },
] as const;

export type PitcherRankKey = (typeof PITCHER_RANK_KEYS)[number]['key'];

/** Lower reads as better pitching for these; strikeouts/K-BB%/whiff% are the ones that invert (more is better), same reasoning as `PITCHING_RANK_INVERTED_KEYS` above. */
export const PITCHER_RANK_LOWER_IS_BETTER = new Set<PitcherRankKey>([
  'era',
  'baseOnBalls',
  'hits',
  'homeRuns',
  'whip',
  'fip',
  'barrelPct',
  'exitVelo',
  'hardHitPct',
]);

export interface PitcherStatLine {
  personId: number;
  fullName: string;
  gamesStarted: number;
  values: Partial<Record<PitcherRankKey, number>>;
}

/**
 * FIP — same run-value scale as ERA, but built only from what a pitcher
 * directly controls (HR/BB/HBP/K), not what fielders do with balls in play.
 * Standard constant of 3.10 (close enough league-wide; a per-season constant
 * that makes league FIP == league ERA isn't worth the extra fetch it'd need).
 */
function computeFip(hr: number, bb: number, hbp: number, k: number, ip: number): number | undefined {
  if (!(ip > 0)) return undefined;
  return (13 * hr + 3 * (bb + hbp) - 2 * k) / ip + 3.10;
}

function computeKbbPct(k: number, bb: number, battersFaced: number): number | undefined {
  if (!(battersFaced > 0)) return undefined;
  return ((k - bb) / battersFaced) * 100;
}

/** IP is reported as e.g. "6.1" meaning 6 and 1/3 innings, not 6.1 innings — the fractional part is thirds, not tenths. */
function parseInningsPitched(raw: unknown): number | undefined {
  const s = typeof raw === 'string' ? raw : String(raw ?? '');
  const m = s.match(/^(-?\d+)(?:\.(\d))?$/);
  if (!m) return undefined;
  const whole = Number(m[1]);
  const thirds = m[2] ? Number(m[2]) : 0;
  if (!Number.isFinite(whole) || thirds > 2) return undefined;
  return whole + thirds / 3;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * A pitcher's role this season, from usage pattern alone (no external
 * source). `undefined` means "not enough appearances of any kind to
 * classify" — deliberately excluded from every pool rather than guessed at.
 *
 * Closer is checked before reliever: a real 9th-inning arm still qualifies
 * even in a season with relatively few appearances so far, as long as a good
 * share of them were save chances.
 */
export type PitcherRole = 'starter' | 'closer' | 'reliever';

const MIN_APPEARANCES_FOR_RELIEF_RANK = 10;
/** Save-opportunity share above which a reliever reads as "the closer," not just someone who picked up a save. */
const CLOSER_SAVE_OPPORTUNITY_SHARE = 0.4;

export function classifyPitcherRole(line: RawPitcherSeasonLine): PitcherRole | undefined {
  if (line.gamesStarted >= 3) return 'starter';
  const relief = line.gamesPitched - line.gamesStarted;
  if (relief < MIN_APPEARANCES_FOR_RELIEF_RANK) return undefined;
  const saveShare = relief > 0 ? line.saveOpportunities / relief : 0;
  if (line.saveOpportunities >= 5 && saveShare >= CLOSER_SAVE_OPPORTUNITY_SHARE) return 'closer';
  return 'reliever';
}

/** Everything `classifyPitcherRole` needs, straight off the season-stats response — kept separate from `PitcherStatLine.values` since these are role signals, not ranked stats. */
export interface RawPitcherSeasonLine {
  personId: number;
  fullName: string;
  teamId?: number;
  gamesStarted: number;
  gamesPitched: number;
  gamesFinished: number;
  /** Season innings pitched — the longevity/durability signal used to break ties in the overall composite ranking (see pitcherRankings.ts). */
  inningsPitched: number;
  saves: number;
  saveOpportunities: number;
  holds: number;
  blownSaves: number;
}

interface LeaguePitcherSeasonRow {
  raw: RawPitcherSeasonLine;
  stat: PitcherStatLine;
}

/**
 * Every pitcher who's appeared this season, league-wide, in one cached call
 * — starters and relievers alike. `playerPool=all` is needed because the
 * default pool applies MLB's own "qualified" innings threshold, which
 * mid-season excludes recent call-ups, injury-return starters, and most
 * relievers entirely.
 *
 * No `fields=` allow-list on this endpoint (unlike `GAME_LOG_FIELDS`), so the
 * raw response already carries innings pitched, HBP, saves, holds, etc. —
 * this just reads more of what's already there rather than requesting
 * anything new.
 */
async function getLeaguePitcherSeasonRows(season: number): Promise<LeaguePitcherSeasonRow[]> {
  const url = `${BASE}/v1/stats?stats=season&group=pitching&season=${season}&sportId=1&limit=1000&gameType=R&playerPool=all`;
  const json = await cachedJson(`pitcher-league-stats:${season}`, url, 60 * 60_000);
  const splits = json?.stats?.[0]?.splits ?? [];

  const out: LeaguePitcherSeasonRow[] = [];
  for (const s of splits) {
    const personId = s?.player?.id;
    if (!Number.isFinite(personId)) continue;
    const stat = s?.stat ?? {};
    const ip = parseInningsPitched(stat.inningsPitched);
    const hr = num(stat.homeRuns) ?? 0;
    const bb = num(stat.baseOnBalls) ?? 0;
    const hbp = num(stat.hitBatsmen) ?? 0;
    const k = num(stat.strikeOuts) ?? 0;
    const battersFaced = num(stat.battersFaced);

    out.push({
      raw: {
        personId,
        fullName: s.player?.fullName ?? '',
        teamId: num(s?.team?.id),
        gamesStarted: num(stat.gamesStarted) ?? 0,
        gamesPitched: num(stat.gamesPitched) ?? 0,
        gamesFinished: num(stat.gamesFinished) ?? 0,
        inningsPitched: ip ?? 0,
        saves: num(stat.saves) ?? 0,
        saveOpportunities: num(stat.saveOpportunities) ?? 0,
        holds: num(stat.holds) ?? 0,
        blownSaves: num(stat.blownSaves) ?? 0,
      },
      stat: {
        personId,
        fullName: s.player?.fullName ?? '',
        gamesStarted: num(stat.gamesStarted) ?? 0,
        values: {
          era: num(stat.era),
          strikeOuts: k,
          baseOnBalls: bb,
          hits: num(stat.hits),
          homeRuns: hr,
          whip: num(stat.whip),
          fip: ip != null ? computeFip(hr, bb, hbp, k, ip) : undefined,
          kbbPct: battersFaced != null ? computeKbbPct(k, bb, battersFaced) : undefined,
        },
      },
    });
  }
  return out;
}

/**
 * Every pitcher with at least one start this season, league-wide — the
 * original starters-only view, now sourced from the shared all-roles fetch
 * above so starters and relievers read off one underlying request/cache
 * instead of two.
 */
export async function getLeagueStartingPitcherStats(season: number): Promise<PitcherStatLine[]> {
  const rows = await getLeaguePitcherSeasonRows(season);
  return rows.filter((r) => r.raw.gamesStarted > 0).map((r) => r.stat);
}

/**
 * The full league pool split into role-classified groups — starters (same
 * pool `getLeagueStartingPitcherStats` returns), plus closers and relievers,
 * which the original starters-only endpoint excluded entirely. `raw` carries
 * the role-classification fields (saves, holds, appearances) alongside each
 * pitcher's ranked stat line.
 */
export interface LeaguePitcherPools {
  starters: Array<{ raw: RawPitcherSeasonLine; stat: PitcherStatLine }>;
  closers: Array<{ raw: RawPitcherSeasonLine; stat: PitcherStatLine }>;
  relievers: Array<{ raw: RawPitcherSeasonLine; stat: PitcherStatLine }>;
}

export async function getLeaguePitcherRolePools(season: number): Promise<LeaguePitcherPools> {
  const rows = await getLeaguePitcherSeasonRows(season);
  const pools: LeaguePitcherPools = { starters: [], closers: [], relievers: [] };
  for (const row of rows) {
    const role = classifyPitcherRole(row.raw);
    if (role === 'starter') pools.starters.push(row);
    else if (role === 'closer') pools.closers.push(row);
    else if (role === 'reliever') pools.relievers.push(row);
  }
  return pools;
}

/** Every batter with a season row this season — id, team, and primary position, which this same StatsAPI response already carries in `split.position.abbreviation` (confirmed live) at no extra fetch cost. Pitchers' own occasional at-bats (`position.abbreviation === 'P'`) are excluded — this pool is "batters", not "everyone who's ever swung a bat". */
export interface RawBatterSeasonLine {
  personId: number;
  fullName: string;
  teamId?: number;
  /** Raw StatsAPI abbreviation — 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', etc. Not yet grouped into a ranking pool (see `POSITION_GROUP`, batterRankings.ts). */
  position: string;
  /** Traditional season rates/counts — same fields `getPeopleSeasonStats` already reads per-player, pulled here in bulk instead since this endpoint is fetched anyway for personId/team/position. */
  avg?: number;
  obp?: number;
  slg?: number;
  ops?: number;
  homeRuns?: number;
  rbi?: number;
}

/**
 * Batters have no traditional-stat-merged ranking pipeline the way pitchers
 * do (see `getLeaguePitcherSeasonRows`) — this exists to answer "which team
 * and position is this batter" for `batterRankings.ts` (position/overall
 * Statcast ranking) and `teamStatcast.ts` (team-level rollup), id + team +
 * position only, skipping the fuller per-player stat parsing pitchers get.
 */
export async function getLeagueBatterSeasonRows(season: number): Promise<RawBatterSeasonLine[]> {
  const url = `${BASE}/v1/stats?stats=season&group=hitting&season=${season}&sportId=1&limit=1500&gameType=R&playerPool=all`;
  const json = await cachedJson(`batter-league-teamids:${season}`, url, 60 * 60_000);
  const splits = json?.stats?.[0]?.splits ?? [];

  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const out: RawBatterSeasonLine[] = [];
  for (const s of splits) {
    const personId = s?.player?.id;
    const position = s?.position?.abbreviation;
    if (!Number.isFinite(personId) || !position || position === 'P') continue;
    const stat = s?.stat ?? {};
    out.push({
      personId,
      fullName: s?.player?.fullName ?? '',
      teamId: Number.isFinite(s?.team?.id) ? s.team.id : undefined,
      position,
      avg: num(stat.avg),
      obp: num(stat.obp),
      slg: num(stat.slg),
      ops: num(stat.ops),
      homeRuns: num(stat.homeRuns),
      rbi: num(stat.rbi),
    });
  }
  return out;
}

export type PitcherRanks = Map<number, Partial<Record<PitcherRankKey, number>>>;

/** Rank among starters only (not the full 700+ league pool, which would dilute a rookie starter's rank with relief-only arms). 1 = best. */
export function rankPitchers(lines: PitcherStatLine[]): PitcherRanks {
  const ranks: PitcherRanks = new Map(lines.map((l) => [l.personId, {}]));

  for (const { key } of PITCHER_RANK_KEYS) {
    const lowerIsBetter = PITCHER_RANK_LOWER_IS_BETTER.has(key);
    const withValue = lines
      .filter((l) => l.values[key] != null)
      .sort((a, b) => {
        const av = a.values[key] as number;
        const bv = b.values[key] as number;
        return lowerIsBetter ? av - bv : bv - av;
      });

    withValue.forEach((line, index) => {
      const bucket = ranks.get(line.personId);
      if (bucket) bucket[key] = index + 1;
    });
  }

  return ranks;
}

/** `1` → `1st`, `22` → `22nd`. Ranks are always read as ordinals. */
export function ordinalRank(rank: number | undefined): string | null {
  if (rank == null || !Number.isFinite(rank)) return null;
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th');
  return `${rank}${suffix}`;
}

// ---------------------------------------------------------------------------
// Bullpen quality (relief pitching only, via sitCodes=rp)
// ---------------------------------------------------------------------------

/**
 * A team's season-aggregate RELIEF-only ERA — `stats=statSplits&sitCodes=rp`
 * is the verified query shape that actually isolates bullpen work from the
 * team's whole pitching staff (confirmed against the live API: gamesStarted
 * comes back 0 and innings pitched is roughly a third of the team's full
 * total, unlike the plain `stats=season` endpoint which silently ignores
 * sitCodes and returns whole-staff numbers).
 *
 * For a season still in progress this is genuinely walk-forward-safe (it
 * only reflects games already played). For a PAST, fully-completed season
 * used in training, this is the season's full-year number applied to every
 * game within it — the same mild simplification parkFactors.ts already
 * makes for a completed season, not a new corner cut.
 */
export async function getTeamBullpenEra(teamId: number, season: number, ttlMs = 60 * 60_000): Promise<number | null> {
  const url = `${BASE}/v1/teams/${teamId}/stats?stats=statSplits&group=pitching&season=${season}&sportId=1&gameType=R&sitCodes=rp`;
  const json = await cachedJson<any>(`bullpen-era:${teamId}:${season}`, url, ttlMs);
  const era = json?.stats?.[0]?.splits?.[0]?.stat?.era;
  const n = Number(era);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export interface TeamRecord {
  teamId: number;
  wins: number;
  losses: number;
  divisionRank: string;
  homeRecord?: { wins: number; losses: number };
  awayRecord?: { wins: number; losses: number };
  lastTen?: { wins: number; losses: number };
  /** e.g. "American League East" / "AL East" — absent from the response unless division/league are hydrated explicitly. */
  divisionName?: string;
  divisionShortName?: string;
  leagueName?: string;
  /** "-" for the division leader, otherwise a games-back string like "3.5". */
  gamesBack?: string;
}

/** Records, division placement and league/division names for every team, in one call. */
export async function getStandings(season: number): Promise<Map<number, TeamRecord>> {
  const url = `${BASE}/v1/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason&hydrate=team,division,league`;
  const json = await cachedJson(`standings:${season}`, url, 30 * 60_000);
  const out = new Map<number, TeamRecord>();

  for (const record of json?.records ?? []) {
    const divisionName: string | undefined = record?.division?.name;
    const divisionShortName: string | undefined = record?.division?.nameShort;
    const leagueName: string | undefined = record?.league?.name;

    for (const entry of record?.teamRecords ?? []) {
      const teamId = entry?.team?.id;
      if (!teamId) continue;

      // Home/away live under overallRecords; lastTen only under splitRecords.
      const splits = [...(entry?.records?.overallRecords ?? []), ...(entry?.records?.splitRecords ?? [])];
      const find = (type: string) => {
        const hit = splits.find((s: any) => s?.type === type);
        return hit ? { wins: Number(hit.wins ?? 0), losses: Number(hit.losses ?? 0) } : undefined;
      };

      out.set(teamId, {
        teamId,
        wins: Number(entry?.wins ?? 0),
        losses: Number(entry?.losses ?? 0),
        divisionRank: String(entry?.divisionRank ?? ''),
        homeRecord: find('home'),
        awayRecord: find('away'),
        lastTen: find('lastTen'),
        divisionName,
        divisionShortName,
        leagueName,
        gamesBack: entry?.gamesBack != null ? String(entry.gamesBack) : undefined,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Roster status / injuries
// ---------------------------------------------------------------------------

export interface InjuryEntry {
  teamId: number;
  playerId: number;
  playerName: string;
  position: string;
  /**
   * Body part or reason.
   *
   * Null far more often than not: the Stats API roster reports *that* a player
   * is on the IL and for how long, but not what for — neither
   * `hydrate=person(injuries)` nor `person(transactions)` returns a
   * `currentInjury`, verified against live rosters. The UI states that plainly
   * rather than filling the column with a guessed body part.
   */
  injury: string | null;
  /** e.g. 'Injured 60-Day', 'Day-To-Day'. */
  status: string;
}

/**
 * Players on a team currently unavailable through injury.
 *
 * Read from the league's own roster rather than a third-party injury feed. The
 * status filter matters: a full-season roster also carries players traded away,
 * reassigned to the minors or released, and listing those as injuries would be
 * simply wrong. Only the `D*` (disabled/injured) codes and day-to-day count.
 */
export async function getInjuries(teamId: number, season: number): Promise<InjuryEntry[]> {
  const url = `${BASE}/v1/teams/${teamId}/roster?rosterType=fullSeason&season=${season}&hydrate=person(injuries)`;
  const json = await cachedJson(`roster:${teamId}:${season}`, url, 60 * 60_000);

  const out: InjuryEntry[] = [];
  for (const entry of json?.roster ?? []) {
    const code: string = entry?.status?.code ?? '';
    const description: string = entry?.status?.description ?? '';
    const injured = code.startsWith('D') || /injur|day.to.day/i.test(description);
    if (!injured) continue;

    out.push({
      teamId,
      playerId: entry?.person?.id ?? 0,
      playerName: entry?.person?.fullName ?? 'Unknown',
      position: entry?.position?.abbreviation ?? '',
      injury: entry?.person?.currentInjury?.description ?? null,
      status: description || 'Unavailable',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Team identity / roster (Teams page)
// ---------------------------------------------------------------------------

export interface TeamInfo {
  id: number;
  name: string;
  abbreviation: string;
  locationName: string;
}

export interface TeamListing {
  id: number;
  name: string;
  abbreviation: string;
  divisionName: string;
  divisionShortName: string;
  leagueName: string;
  leagueAbbreviation: string;
}

/** All 30 teams with their division/league, in one call — the Teams index page groups by this rather than issuing 30 individual lookups. */
export async function getAllTeams(): Promise<TeamListing[]> {
  const url = `${BASE}/v1/teams?sportId=1&hydrate=division,league`;
  const json = await cachedJson('teams:all', url, 12 * 60 * 60_000);
  return (json?.teams ?? [])
    .filter((t: any) => t?.id)
    .map((t: any) => ({
      id: t.id,
      name: t.name ?? '',
      abbreviation: t.abbreviation ?? '',
      divisionName: t.division?.name ?? '',
      divisionShortName: t.division?.nameShort ?? '',
      leagueName: t.league?.name ?? '',
      leagueAbbreviation: t.league?.abbreviation ?? '',
    }));
}

/** Team name/abbreviation — identity rarely changes mid-season, so this is cached far longer than anything schedule-shaped. */
export async function getTeamInfo(teamId: number): Promise<TeamInfo | null> {
  const url = `${BASE}/v1/teams/${teamId}?sportId=1`;
  const json = await cachedJson(`team-info:${teamId}`, url, 12 * 60 * 60_000);
  const team = json?.teams?.[0];
  if (!team?.id) return null;
  return {
    id: team.id,
    name: team.name ?? '',
    abbreviation: team.abbreviation ?? '',
    locationName: team.locationName ?? '',
  };
}

export interface RosterEntry {
  id: number;
  fullName: string;
  position: string;
}

/**
 * The active 26-man roster, not the full-season one `getInjuries` reads —
 * a Teams page listing every player who's been on the roster at any point
 * this year (call-ups, released, traded away) would misrepresent who's
 * actually on the team today.
 */
export async function getActiveRoster(teamId: number, season: number): Promise<RosterEntry[]> {
  const url = `${BASE}/v1/teams/${teamId}/roster?rosterType=active&season=${season}`;
  const json = await cachedJson(`roster-active:${teamId}:${season}`, url, 60 * 60_000);
  return (json?.roster ?? [])
    .filter((entry: any) => entry?.person?.id)
    .map((entry: any) => ({
      id: entry.person.id,
      fullName: entry.person.fullName ?? 'Unknown',
      position: entry.position?.abbreviation ?? '',
    }));
}

/**
 * Season-aggregate stat lines (not per-game logs — `getPeopleWithGameLogs`
 * already covers that for props). A Teams page roster wants "what has this
 * player done this year" as one number per stat, which the API already
 * totals server-side rather than requiring every gamelog summed client-side.
 */
export async function getPeopleSeasonStats(
  ids: number[],
  group: 'hitting' | 'pitching',
  season: number,
  batchSize = 40,
): Promise<Map<number, Record<string, number | undefined>>> {
  const unique = [...new Set(ids)].filter((id) => Number.isFinite(id));
  const out = new Map<number, Record<string, number | undefined>>();
  if (unique.length === 0) return out;

  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const batches = chunk(unique, batchSize);
  const results = await mapLimit(batches, 3, (batch) => {
    const key = `people-season:${group}:${season}:${batch.join(',')}`;
    const url = `${BASE}/v1/people?personIds=${batch.join(',')}&hydrate=stats(group=${group},type=season,season=${season})`;
    return cachedJson(key, url, 60 * 60_000);
  });

  for (const json of results) {
    for (const person of json?.people ?? []) {
      const split = (person.stats ?? []).find((s: any) => s?.type?.displayName === 'season')?.splits?.[0];
      const raw = split?.stat;
      if (!raw) continue;
      out.set(person.id, {
        gamesPlayed: num(raw.gamesPlayed),
        avg: num(raw.avg),
        obp: num(raw.obp),
        slg: num(raw.slg),
        ops: num(raw.ops),
        homeRuns: num(raw.homeRuns),
        rbi: num(raw.rbi),
        stolenBases: num(raw.stolenBases),
        era: num(raw.era),
        wins: num(raw.wins),
        losses: num(raw.losses),
        saves: num(raw.saves),
        strikeOuts: num(raw.strikeOuts),
        whip: num(raw.whip),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recent results / head-to-head
// ---------------------------------------------------------------------------

export interface RecentGameResult {
  gamePk: number;
  date: string;
  opponentId: number;
  opponentAbbr: string;
  isHome: boolean;
  runsFor: number;
  runsAgainst: number;
  win: boolean;
}

/**
 * A team's completed games out of a schedule window, most recent first.
 *
 * Reads straight off `getScheduleRange`'s league-wide window rather than a
 * per-team endpoint — Game Detail needs both sides' recent form plus their
 * head-to-head this season, and one shared window covers all three without
 * three separate fetches. Games missing a final score (postponed, in
 * progress) are skipped rather than counted as a result.
 */
export function extractTeamResults(games: MlbGame[], teamId: number): RecentGameResult[] {
  const out: RecentGameResult[] = [];
  for (const game of games) {
    if (game.abstractState !== 'Final') continue;
    const isHome = game.teams.home.team.id === teamId;
    const isAway = game.teams.away.team.id === teamId;
    if (!isHome && !isAway) continue;

    const mine = isHome ? game.teams.home : game.teams.away;
    const theirs = isHome ? game.teams.away : game.teams.home;
    if (mine.score == null || theirs.score == null) continue;

    out.push({
      gamePk: game.gamePk,
      date: game.gameDate,
      opponentId: theirs.team.id,
      opponentAbbr: theirs.team.abbreviation ?? theirs.team.name.slice(0, 3).toUpperCase(),
      isHome,
      runsFor: mine.score,
      runsAgainst: theirs.score,
      win: mine.score > theirs.score,
    });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  return out;
}

/** Handedness lookup only — much smaller than pulling stats. */
export async function getHandedness(ids: number[]): Promise<Map<number, { pitchHand?: string; batSide?: string; fullName: string }>> {
  const unique = [...new Set(ids)].filter((id) => Number.isFinite(id));
  const out = new Map<number, { pitchHand?: string; batSide?: string; fullName: string }>();
  if (unique.length === 0) return out;

  const results = await Promise.all(
    chunk(unique, 100).map((batch) =>
      cachedJson(`hand:${batch.join(',')}`, `${BASE}/v1/people?personIds=${batch.join(',')}`, 6 * 60 * 60_000),
    ),
  );

  for (const json of results) {
    for (const person of json?.people ?? []) {
      out.set(person.id, {
        pitchHand: person?.pitchHand?.code,
        batSide: person?.batSide?.code,
        fullName: person.fullName,
      });
    }
  }
  return out;
}
