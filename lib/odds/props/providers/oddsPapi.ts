/**
 * OddsPapi — Tier 2, sharp reference (Pinnacle) + free historical, GAME-LEVEL ONLY.
 *
 * Verified live in docs/odds-provider-verification.md § 4: scanning every
 * outcome across 137 bookmakers and 124 DraftKings markets for a real,
 * upcoming, odds-available MLB fixture found **zero** rows with a
 * `playerName`, and the market catalog actually returned was exclusively
 * game/inning-level (moneyline, handicap/spread, totals, inning results).
 * The spec framed OddsPapi as a per-prop sharp-price and history source;
 * that isn't what the live data supports, so `fetchGameProps` (the
 * `ProviderAdapter` shape every other provider fills with prop rows) is
 * intentionally a no-op here — it registers cleanly but contributes nothing
 * to the props feed, rather than silently guessing at a mapping that isn't
 * there. The real features — `fetchSharpPrice` and `fetchLineHistory` — are
 * separate exports working against game lines, used directly by the
 * Game Detail "Check sharp price" / "Line history" actions.
 *
 * Two more Phase-0 findings shape this file:
 *  - Reference endpoints (`/tournaments`, `/markets`, `/fixtures`) spend from
 *    the same 250/month budget as odds calls, so the MLB tournament ID (109)
 *    and the market-ID→name map are captured as constants here rather than
 *    re-fetched at runtime.
 *  - `/v4/historical-odds` did **not** increment the visible `request_count`
 *    in Phase 0 testing, contradicting the spec's assumption that it draws
 *    from the same pool. Treated as a bonus, not relied upon — a cooldown is
 *    still applied as a courtesy, and the odds call this feature also makes
 *    (to get current prices alongside history) is still budgeted normally.
 */

import type {
  FetchResult,
  GameLinePrice,
  GameLookupContext,
  LineHistoryPoint,
  LineHistoryResult,
  ProviderAdapter,
  SharpPriceResult,
} from '../types';
import { oddsPapiConfig } from '../config';
import { monthlyStatus, recordMonthlySpend } from '../budget';
import { normalizeBookmaker } from '../entityResolution';

const BASE = 'https://api.oddspapi.io';
const MLB_TOURNAMENT_ID = 109; // captured once in Phase 0 — see docs/odds-provider-verification.md § 4

// Market IDs captured from the Phase 0 fixture response (draftkings/pinnacle
// both use the same numeric catalog) — a static map avoids spending budget on
// `/v4/markets` at runtime for names that don't change.
const MARKET_NAME: Record<string, 'moneyline' | 'spread' | 'total'> = {
  '131': 'moneyline',
};
function isSpreadMarket(name: string): boolean {
  return name === 'Handicap (incl. extra innings)';
}
function isTotalMarket(name: string): boolean {
  return name === 'Over Under (incl. extra innings)';
}

interface OpMarketCatalogEntry {
  marketId: number;
  marketName: string;
}

interface OpFixture {
  fixtureId: string;
  participant1Name: string;
  participant2Name: string;
  hasOdds: boolean;
  startTime: string;
}

let fixturesCache: { fetchedAt: number; fixtures: OpFixture[] } | null = null;
let marketsCache: OpMarketCatalogEntry[] | null = null;
const FIXTURES_TTL_MS = 10 * 60_000;

function apiKey(): string | null {
  return oddsPapiConfig().key;
}

async function getMarketsCatalog(): Promise<OpMarketCatalogEntry[]> {
  if (marketsCache) return marketsCache;
  const key = apiKey();
  if (!key) return [];
  const res = await fetch(`${BASE}/v4/markets?apiKey=${key}`, { cache: 'no-store' });
  if (!res.ok) return [];
  const json = (await res.json()) as OpMarketCatalogEntry[] | { data: OpMarketCatalogEntry[] };
  const arr = Array.isArray(json) ? json : json.data;
  recordMonthlySpend('oddspapi', 1, 0);
  marketsCache = arr;
  return arr;
}

async function getFixtures(): Promise<OpFixture[]> {
  if (fixturesCache && Date.now() - fixturesCache.fetchedAt < FIXTURES_TTL_MS) return fixturesCache.fixtures;
  const key = apiKey();
  if (!key) return [];
  const res = await fetch(`${BASE}/v4/fixtures?tournamentId=${MLB_TOURNAMENT_ID}&apiKey=${key}`, { cache: 'no-store' });
  if (!res.ok) return fixturesCache?.fixtures ?? [];
  const json = (await res.json()) as OpFixture[] | { data: OpFixture[] };
  const fixtures = Array.isArray(json) ? json : json.data;
  recordMonthlySpend('oddspapi', 1, 0);
  fixturesCache = { fetchedAt: Date.now(), fixtures };
  return fixtures;
}

async function findFixtureId(game: GameLookupContext): Promise<string | null> {
  const fixtures = await getFixtures();
  const gameDay = game.gameDate.slice(0, 10);
  const match = fixtures.find(
    (f) =>
      f.hasOdds &&
      f.startTime.startsWith(gameDay) &&
      ((f.participant1Name === game.homeTeamName && f.participant2Name === game.awayTeamName) ||
        (f.participant1Name === game.awayTeamName && f.participant2Name === game.homeTeamName)),
  );
  return match?.fixtureId ?? null;
}

interface OpOddsResponse {
  bookmakerOdds: Record<string, { suspended?: boolean; markets: Record<string, { outcomes: Record<string, { players: Record<string, { price?: number; priceAmerican?: string; changedAt?: string; createdAt?: string }> }> }> }>;
}

function extractGameLine(marketsCatalog: OpMarketCatalogEntry[], bookmakerData: OpOddsResponse['bookmakerOdds'][string]): GameLinePrice {
  const nameById = new Map(marketsCatalog.map((m) => [String(m.marketId), m.marketName]));
  const line: GameLinePrice = { bookmaker: '' };

  for (const [marketId, market] of Object.entries(bookmakerData.markets ?? {})) {
    const kind = MARKET_NAME[marketId] ?? (isSpreadMarket(nameById.get(marketId) ?? '') ? 'spread' : isTotalMarket(nameById.get(marketId) ?? '') ? 'total' : null);
    if (!kind) continue;

    const outcomeEntries = Object.entries(market.outcomes ?? {});
    if (kind === 'moneyline' && outcomeEntries.length >= 2) {
      const [homeOutcome, awayOutcome] = outcomeEntries;
      const homePrice = Object.values(homeOutcome[1].players ?? {})[0]?.priceAmerican;
      const awayPrice = Object.values(awayOutcome[1].players ?? {})[0]?.priceAmerican;
      line.moneyline = {
        home: homePrice != null ? Number(homePrice) : undefined,
        away: awayPrice != null ? Number(awayPrice) : undefined,
      };
    }
  }
  return line;
}

export const oddsPapiAdapter: ProviderAdapter = {
  meta: {
    id: 'oddspapi',
    label: 'OddsPapi',
    tier: 'tier2',
    get enabled() {
      return oddsPapiConfig().enabled;
    },
    delaySeconds: null,
    books: ['pinnacle', 'draftkings', 'fanduel', 'betmgm', 'caesars'],
  },

  async fetchGameProps(): Promise<FetchResult> {
    return {
      rows: [],
      unresolved: [],
      cost: {},
      warnings: [
        'OddsPapi carries no MLB player-prop data (confirmed in Phase 0 verification) — it contributes game-level sharp-price and line-history features only, not props.',
      ],
    };
  },
};

/** Game Detail's "Check sharp price" action. */
export async function fetchSharpPrice(game: GameLookupContext): Promise<SharpPriceResult> {
  const config = oddsPapiConfig();
  const budget = monthlyStatus('oddspapi', config.monthlyLimit, config.softCap, 'requests');
  if (!config.enabled || !config.key) {
    return { available: false, pinnacle: null, otherBooks: [], fetchedAt: new Date().toISOString(), monthlyRemaining: budget.remaining, warnings: ['OddsPapi is disabled.'] };
  }
  if (budget.exhausted) {
    return { available: false, pinnacle: null, otherBooks: [], fetchedAt: new Date().toISOString(), monthlyRemaining: 0, warnings: ['OddsPapi monthly budget is exhausted.'] };
  }

  const fixtureId = await findFixtureId(game);
  if (!fixtureId) {
    return { available: false, pinnacle: null, otherBooks: [], fetchedAt: new Date().toISOString(), monthlyRemaining: budget.remaining, warnings: [`No OddsPapi fixture found for ${game.awayAbbr} @ ${game.homeAbbr}.`] };
  }

  const res = await fetch(`${BASE}/v4/odds?fixtureId=${fixtureId}&apiKey=${config.key}`, { cache: 'no-store' });
  if (!res.ok) {
    return { available: false, pinnacle: null, otherBooks: [], fetchedAt: new Date().toISOString(), monthlyRemaining: budget.remaining, warnings: [`OddsPapi odds request failed (${res.status}).`] };
  }
  recordMonthlySpend('oddspapi', 1, 0);
  const json = (await res.json()) as OpOddsResponse;
  const catalog = await getMarketsCatalog();

  const pinnacleData = json.bookmakerOdds?.['pinnacle'];
  const pinnacle = pinnacleData ? { ...extractGameLine(catalog, pinnacleData), bookmaker: 'pinnacle' } : null;

  const otherBooks: GameLinePrice[] = [];
  for (const bookRaw of ['draftkings', 'fanduel', 'betmgm', 'caesars']) {
    const data = json.bookmakerOdds?.[bookRaw];
    if (!data) continue;
    const normalized = normalizeBookmaker(bookRaw);
    if (!normalized) continue;
    otherBooks.push({ ...extractGameLine(catalog, data), bookmaker: normalized });
  }

  const remaining = monthlyStatus('oddspapi', config.monthlyLimit, config.softCap, 'requests').remaining;
  return {
    available: !!pinnacle,
    pinnacle,
    otherBooks,
    fetchedAt: new Date().toISOString(),
    monthlyRemaining: remaining,
    warnings: pinnacle ? [] : ['Pinnacle has no posted line for this fixture right now.'],
  };
}

/** Game Detail's "Line history" action — game-level markets only. */
export async function fetchLineHistory(game: GameLookupContext): Promise<LineHistoryResult> {
  const config = oddsPapiConfig();
  const budget = monthlyStatus('oddspapi', config.monthlyLimit, config.softCap, 'requests');
  if (!config.enabled || !config.key) {
    return { available: false, points: [], monthlyRemaining: budget.remaining, warnings: ['OddsPapi is disabled.'] };
  }
  if (budget.exhausted) {
    return { available: false, points: [], monthlyRemaining: 0, warnings: ['OddsPapi monthly budget is exhausted.'] };
  }

  const fixtureId = await findFixtureId(game);
  if (!fixtureId) {
    return { available: false, points: [], monthlyRemaining: budget.remaining, warnings: [`No OddsPapi fixture found for ${game.awayAbbr} @ ${game.homeAbbr}.`] };
  }

  const res = await fetch(
    `${BASE}/v4/historical-odds?fixtureId=${fixtureId}&bookmakers=pinnacle,draftkings,fanduel&apiKey=${config.key}`,
    { cache: 'no-store' },
  );
  if (!res.ok) {
    return { available: false, points: [], monthlyRemaining: budget.remaining, warnings: [`OddsPapi historical request failed (${res.status}).`] };
  }
  // Phase 0 observed this endpoint not incrementing request_count on this account — still recorded here
  // as a request-shaped spend so the local counter never claims a call that happened was free for certain.
  recordMonthlySpend('oddspapi', 1, 0);
  const json = (await res.json()) as {
    bookmakers: Record<string, { markets: Record<string, { outcomes: Record<string, { players: Record<string, Array<{ createdAt: string; price: number }>> }> }> }>;
  };
  const catalog = await getMarketsCatalog();
  const nameById = new Map(catalog.map((m) => [String(m.marketId), m.marketName]));
  const points: LineHistoryPoint[] = [];

  for (const [bookRaw, bookData] of Object.entries(json.bookmakers ?? {})) {
    const bookmaker = normalizeBookmaker(bookRaw);
    if (!bookmaker) continue;

    for (const [marketId, market] of Object.entries(bookData.markets ?? {})) {
      const marketName = nameById.get(marketId) ?? '';
      const kind = MARKET_NAME[marketId] ?? (isSpreadMarket(marketName) ? 'spread' : isTotalMarket(marketName) ? 'total' : null);
      if (kind !== 'moneyline') continue; // spread/total sides need point context historical-odds doesn't label cleanly here — moneyline only for now

      for (const [outcomeId, outcome] of Object.entries(market.outcomes ?? {})) {
        for (const series of Object.values(outcome.players ?? {})) {
          for (const snapshot of series) {
            points.push({
              bookmaker,
              market: 'moneyline',
              side: outcomeId,
              price: snapshot.price,
              point: null,
              observedAt: snapshot.createdAt,
            });
          }
        }
      }
    }
  }

  const remaining = monthlyStatus('oddspapi', config.monthlyLimit, config.softCap, 'requests').remaining;
  return { available: points.length > 0, points, monthlyRemaining: remaining, warnings: [] };
}
