/**
 * Game-level MLB lines from the-odds-api.com (free tier: 500 credits/month).
 *
 * Quota discipline is the whole design here. A credit is charged per market per
 * region per call, so the default `h2h,spreads,totals` over the `us` region
 * costs 3 credits every time we refresh. Refreshing hourly would burn ~2,160
 * credits a month — over four times the free allowance — so this module:
 *
 *  - refreshes on a long TTL (6h by default), never per request;
 *  - persists the cache in SQLite, so restarting the app doesn't respend;
 *  - stops refreshing once the API's own remaining-credit header nears zero;
 *  - serves stale data with an honest timestamp rather than going quiet.
 *
 * This covers game lines only. Nothing free covers golf hole props or MLB
 * player props, which is why screenshot import stays the primary odds path.
 */

import { readOddsCache, writeOddsCache } from '../db/client';

const BASE = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = 'baseball_mlb';

const DEFAULT_TTL_MINUTES = 360;
const DEFAULT_MARKETS = 'h2h,spreads,totals';
/** Stop auto-refreshing when this few credits remain, so the month can't run dry. */
const DEFAULT_RESERVE = 25;

function config() {
  const ttl = Number(process.env.ODDS_API_TTL_MINUTES);
  const reserve = Number(process.env.ODDS_API_RESERVE);
  return {
    apiKey: process.env.ODDS_API_KEY?.trim() || null,
    ttlMinutes: Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL_MINUTES,
    markets: process.env.ODDS_API_MARKETS?.trim() || DEFAULT_MARKETS,
    reserve: Number.isFinite(reserve) && reserve >= 0 ? reserve : DEFAULT_RESERVE,
  };
}

export interface GameLine {
  eventId: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  moneyline?: { home?: number; away?: number; book?: string };
  spread?: { homePoint?: number; homePrice?: number; awayPoint?: number; awayPrice?: number; book?: string };
  total?: { point?: number; overPrice?: number; underPrice?: number; book?: string };
  bookCount: number;
}

export interface GameLinesResult {
  enabled: boolean;
  lines: GameLine[];
  fetchedAt: string | null;
  /** True when we served cache rather than calling the API this time. */
  fromCache: boolean;
  requestsRemaining: number | null;
  requestsUsed: number | null;
  nextRefreshAt: string | null;
  warnings: string[];
}

function disabled(warning: string): GameLinesResult {
  return {
    enabled: false,
    lines: [],
    fetchedAt: null,
    fromCache: false,
    requestsRemaining: null,
    requestsUsed: null,
    nextRefreshAt: null,
    warnings: [warning],
  };
}

/**
 * Collapse every bookmaker's quote into one line per game, taking the best
 * available price for each side so the number shown is one a user could
 * actually have got somewhere.
 */
export function summariseOddsEvent(event: any): GameLine {
  const line: GameLine = {
    eventId: String(event.id),
    commenceTime: event.commence_time,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    bookCount: Array.isArray(event.bookmakers) ? event.bookmakers.length : 0,
  };

  for (const book of event.bookmakers ?? []) {
    for (const market of book.markets ?? []) {
      const outcomes: any[] = market.outcomes ?? [];

      if (market.key === 'h2h') {
        const home = outcomes.find((o) => o.name === event.home_team);
        const away = outcomes.find((o) => o.name === event.away_team);
        const current = line.moneyline ?? {};
        // "Best" for American odds is simply the largest number.
        if (home?.price != null && (current.home == null || home.price > current.home)) {
          line.moneyline = { ...current, home: home.price, book: book.title };
        }
        if (away?.price != null && (line.moneyline?.away == null || away.price > line.moneyline.away)) {
          line.moneyline = { ...(line.moneyline ?? {}), away: away.price, book: book.title };
        }
      }

      if (market.key === 'spreads' && !line.spread) {
        const home = outcomes.find((o) => o.name === event.home_team);
        const away = outcomes.find((o) => o.name === event.away_team);
        line.spread = {
          homePoint: home?.point,
          homePrice: home?.price,
          awayPoint: away?.point,
          awayPrice: away?.price,
          book: book.title,
        };
      }

      if (market.key === 'totals' && !line.total) {
        const over = outcomes.find((o) => o.name === 'Over');
        const under = outcomes.find((o) => o.name === 'Under');
        line.total = {
          point: over?.point ?? under?.point,
          overPrice: over?.price,
          underPrice: under?.price,
          book: book.title,
        };
      }
    }
  }

  return line;
}

/**
 * Fetch MLB game lines, honouring the cache TTL and the remaining-credit
 * reserve. `force` bypasses the TTL but never the reserve.
 */
export async function getMlbGameLines(force = false): Promise<GameLinesResult> {
  const { apiKey, ttlMinutes, markets, reserve } = config();

  if (!apiKey) {
    return disabled('ODDS_API_KEY is not set — game lines are turned off. Add it to .env.local to enable them.');
  }

  const cacheKey = `${SPORT_KEY}:${markets}:us`;
  const cached = readOddsCache(cacheKey);
  const warnings: string[] = [];

  const ageMinutes = cached ? (Date.now() - Date.parse(cached.fetchedAt)) / 60000 : Infinity;
  const fresh = ageMinutes < ttlMinutes;

  const serveCache = (extraWarnings: string[] = []): GameLinesResult => ({
    enabled: true,
    lines: cached ? (JSON.parse(cached.payload) as GameLine[]) : [],
    fetchedAt: cached?.fetchedAt ?? null,
    fromCache: true,
    requestsRemaining: cached?.requestsRemaining ?? null,
    requestsUsed: cached?.requestsUsed ?? null,
    nextRefreshAt: cached
      ? new Date(Date.parse(cached.fetchedAt) + ttlMinutes * 60000).toISOString()
      : null,
    warnings: [...warnings, ...extraWarnings],
  });

  if (cached && fresh && !force) return serveCache();

  // Never spend the last of the month's budget on an automatic refresh.
  if (cached?.requestsRemaining != null && cached.requestsRemaining <= reserve) {
    return serveCache([
      `Only ${cached.requestsRemaining} Odds API credits remain this month, so lines are no longer auto-refreshing. Showing the last fetch.`,
    ]);
  }

  const url = new URL(`${BASE}/sports/${SPORT_KEY}/odds/`);
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('regions', 'us');
  url.searchParams.set('markets', markets);
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('dateFormat', 'iso');

  try {
    const res = await fetch(url.toString(), { cache: 'no-store' });

    const remaining = Number(res.headers.get('x-requests-remaining'));
    const used = Number(res.headers.get('x-requests-used'));
    const requestsRemaining = Number.isFinite(remaining) ? remaining : null;
    const requestsUsed = Number.isFinite(used) ? used : null;

    if (!res.ok) {
      const body = await res.text();
      const detail = res.status === 401 ? 'The Odds API rejected the key.' : `Odds API error ${res.status}.`;
      if (cached) return serveCache([`${detail} Showing the last successful fetch.`]);
      return {
        ...disabled(`${detail} ${body.slice(0, 160)}`),
        enabled: true,
        requestsRemaining,
        requestsUsed,
      };
    }

    const events = (await res.json()) as any[];
    const lines = events.map(summariseOddsEvent);

    writeOddsCache(cacheKey, JSON.stringify(lines), requestsRemaining, requestsUsed);

    if (requestsRemaining != null && requestsRemaining <= reserve * 2) {
      warnings.push(`${requestsRemaining} Odds API credits left this month.`);
    }

    return {
      enabled: true,
      lines,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      requestsRemaining,
      requestsUsed,
      nextRefreshAt: new Date(Date.now() + ttlMinutes * 60000).toISOString(),
      warnings,
    };
  } catch (error) {
    if (cached) {
      return serveCache([
        `Could not reach the Odds API (${error instanceof Error ? error.message : 'network error'}). Showing the last fetch.`,
      ]);
    }
    return {
      ...disabled('Could not reach the Odds API and there is no cached copy yet.'),
      enabled: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Matching lines to the MLB slate
// ---------------------------------------------------------------------------

function normalizeTeam(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Key a line set by "AWAY@HOME" using MLB's own team names, so the UI can look
 * a game up without a fuzzy search per render.
 */
export function indexLinesByMatchup(lines: GameLine[]): Map<string, GameLine> {
  const out = new Map<string, GameLine>();
  for (const line of lines) {
    out.set(`${normalizeTeam(line.awayTeam)}@${normalizeTeam(line.homeTeam)}`, line);
  }
  return out;
}

export function lookupLine(
  index: Map<string, GameLine>,
  awayTeamName: string,
  homeTeamName: string,
): GameLine | null {
  return index.get(`${normalizeTeam(awayTeamName)}@${normalizeTeam(homeTeamName)}`) ?? null;
}

export function formatAmerican(price: number | undefined): string {
  if (price == null || !Number.isFinite(price)) return '—';
  return price > 0 ? `+${price}` : String(price);
}
