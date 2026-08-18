/**
 * Bulk historical backfill from OddsPapi's `/v4/historical-odds` — the same
 * endpoint `lib/odds/props/providers/oddsPapi.ts`'s `fetchLineHistory`
 * already uses for the Game Detail "Line history" action (moneyline only,
 * one game at a time), extended here to also parse totals and to run across
 * a whole date range at once, for filling the gap a season-archive file
 * doesn't cover (2026 — see historicalOddsIngest.ts's own header for why
 * that file can't just include this season yet).
 *
 * OddsPapi models totals as one SEPARATE market per handicap value (e.g.
 * "Over/Under 8.5" and "Over/Under 9" are different market IDs, not one
 * market with a line field) — real catalog confirmed 22 such markets for
 * MLB, handicap 3.5 through 14 in 0.5 steps. A book's line can move between
 * these across the pregame window, so the actual closing/opening total for
 * a game is determined here by which handicap's market has the
 * latest/earliest real price snapshot for that book, not a fixed market ID.
 *
 * Budget-aware: shares the exact same `provider_usage` counter and
 * 250/month cap as every other OddsPapi call in the app (fetchSharpPrice,
 * fetchLineHistory) — a bulk run here spends from the identical pool, not a
 * separate budget, and stops (reporting how far it got) once exhausted
 * rather than erroring. Idempotent: skips any (season, date, home, away)
 * already present in historical_odds, so re-running after hitting the cap
 * picks up where it left off without re-spending on games already ingested.
 */

import { getScheduleRange, easternDate, shiftDate } from './statsapi';
import { devigTwoWay } from '../../odds/devig';
import { writeHistoricalOdds, getHistoricalOdds, type HistoricalOddsInput } from '../../db/client';
import { oddsPapiConfig } from '../../odds/props/config';
import { monthlyStatus, recordMonthlySpend } from '../../odds/props/budget';

const BASE = 'https://api.oddspapi.io';
const MLB_TOURNAMENT_ID = 109;
const MONEYLINE_MARKET_ID = 131;

interface OpFixture {
  fixtureId: string;
  participant1Name: string;
  participant2Name: string;
  startTime: string;
}

interface OpMarketCatalogEntry {
  marketId: number;
  sportId: number;
  marketType: string;
  period: string;
  handicap: number;
}

interface OpPriceSnapshot {
  createdAt: string;
  price: number;
}

interface OpHistoricalResponse {
  bookmakers: Record<string, { markets: Record<string, { outcomes: Record<string, { players: Record<string, OpPriceSnapshot[]> }> }> }>;
}

function normalizeTeamName(name: string): string {
  return name.toLowerCase().replace(/\./g, '').replace(/'/g, '').replace(/-/g, ' ').replace(/&/g, 'and').trim().replace(/\s+/g, ' ');
}

async function fetchFixtures(apiKey: string): Promise<OpFixture[]> {
  const res = await fetch(`${BASE}/v4/fixtures?tournamentId=${MLB_TOURNAMENT_ID}&apiKey=${apiKey}`, { cache: 'no-store' });
  if (!res.ok) return [];
  const json = (await res.json()) as OpFixture[] | { data: OpFixture[] };
  return Array.isArray(json) ? json : json.data;
}

async function fetchMarketCatalog(apiKey: string): Promise<OpMarketCatalogEntry[]> {
  const res = await fetch(`${BASE}/v4/markets?apiKey=${apiKey}`, { cache: 'no-store' });
  if (!res.ok) return [];
  const json = (await res.json()) as OpMarketCatalogEntry[] | { data: OpMarketCatalogEntry[] };
  return Array.isArray(json) ? json : json.data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 300ms of flat pacing between calls still hit 429 on 11 of 14 requests in
 * testing — the real limit is per-second, tighter than that gap alone
 * covers. Retries a 429 with growing backoff (1.5s, 3s, 6s) rather than
 * just recording a failure, since it's a transient "too fast" response, not
 * a real error — the fixture and its data are still there a few seconds
 * later.
 */
async function fetchHistoricalOddsForFixture(apiKey: string, fixtureId: string): Promise<{ data: OpHistoricalResponse | null; status: number }> {
  const delays = [0, 1500, 3000, 6000];
  let lastStatus = 0;
  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    const res = await fetch(`${BASE}/v4/historical-odds?fixtureId=${fixtureId}&bookmakers=pinnacle,draftkings,fanduel&apiKey=${apiKey}`, {
      cache: 'no-store',
    });
    lastStatus = res.status;
    if (res.ok) return { data: (await res.json()) as OpHistoricalResponse, status: res.status };
    if (res.status !== 429) return { data: null, status: res.status };
  }
  return { data: null, status: lastStatus };
}

function sortedSnapshots(snapshots: OpPriceSnapshot[] | undefined): OpPriceSnapshot[] {
  if (!snapshots || snapshots.length === 0) return [];
  return [...snapshots].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * "Closing" must mean the last PRE-GAME price, not literally the last
 * snapshot in the series — this endpoint's history keeps moving after first
 * pitch (in-play trading), and a moneyline swings to extreme values once a
 * team builds a lead. Without this cutoff, "closing" silently became "final
 * in-game price," producing impossible-looking pre-game favorites (95%+)
 * that were actually mid-/post-game prices. `startTimeIso` is the fixture's
 * own real first-pitch time, so this drops anything at or after it.
 */
function lastPreGameSnapshot(snapshots: OpPriceSnapshot[] | undefined, startTimeIso: string): OpPriceSnapshot | null {
  const s = sortedSnapshots(snapshots).filter((snap) => snap.createdAt < startTimeIso);
  return s.length > 0 ? s[s.length - 1] : null;
}
function firstSnapshot(snapshots: OpPriceSnapshot[] | undefined): OpPriceSnapshot | null {
  const s = sortedSnapshots(snapshots);
  return s.length > 0 ? s[0] : null;
}

function playerSeries(outcomes: OpHistoricalResponse['bookmakers'][string]['markets'][string]['outcomes'] | undefined, outcomeId: number): OpPriceSnapshot[] | undefined {
  const outcome = outcomes?.[String(outcomeId)];
  if (!outcome) return undefined;
  return Object.values(outcome.players ?? {})[0];
}

/** Devigs each book's [a,b] decimal-price pair independently (OddsPapi already gives decimal odds, no conversion needed), then averages the resulting probabilities across books — same shape as historicalOddsIngest.ts's own devigAverage. */
function devigAverage(pairs: Array<[number, number]>): { a: number; b: number } | null {
  const aProbs: number[] = [];
  const bProbs: number[] = [];
  for (const [a, b] of pairs) {
    const devigged = devigTwoWay(a, b);
    if (devigged) {
      aProbs.push(devigged.a);
      bProbs.push(devigged.b);
    }
  }
  if (aProbs.length === 0) return null;
  return { a: aProbs.reduce((s, v) => s + v, 0) / aProbs.length, b: bProbs.reduce((s, v) => s + v, 0) / bProbs.length };
}
function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;
}

export interface OddsPapiBackfillSummary {
  dateRange: [string, string];
  fixturesInRange: number;
  matched: number;
  unmatchedTeams: string[];
  alreadySkipped: number;
  ingested: number;
  fetchFailures: Record<number, number>;
  stoppedOnBudget: boolean;
  requestsUsedThisRun: number;
  budgetRemainingAfter: number;
}

export async function backfillFromOddsPapi(startDate: string, endDate: string): Promise<OddsPapiBackfillSummary> {
  const config = oddsPapiConfig();
  if (!config.enabled || !config.key) {
    throw new Error('OddsPapi is not enabled/configured (ODDSPAPI_KEY missing).');
  }
  const apiKey = config.key;
  let requestsUsedThisRun = 0;

  const [fixtures, marketCatalog] = await Promise.all([fetchFixtures(apiKey), fetchMarketCatalog(apiKey)]);
  recordMonthlySpend('oddspapi', 2, 0);
  requestsUsedThisRun += 2;

  const handicapByTotalsMarketId = new Map<number, number>();
  for (const m of marketCatalog) {
    if (m.sportId === 13 && m.marketType === 'totals' && m.period === 'result') handicapByTotalsMarketId.set(m.marketId, m.handicap);
  }

  // Real schedule for the same range, for team-ID resolution — fixture
  // participant names aren't guaranteed to match MLB's official wording
  // character-for-character, and their field order isn't guaranteed to be
  // home/away (see the match loop below, which tries both pairings).
  // Padded ±1 day: a fixture's UTC startTime can fall on one calendar day
  // while its real Eastern-date business day (what game_picks/historical_odds
  // key on everywhere else) is the day before — a late West Coast game
  // starting ~03:00-04:00 UTC is still "last night" in US time.
  const scheduleGames = await getScheduleRange(shiftDate(startDate, -1), shiftDate(endDate, 1));
  const scheduleByKey = new Map<string, { homeId: number; awayId: number }>();
  for (const g of scheduleGames) {
    const gameDate = easternDate(new Date(g.gameDate));
    const key = `${gameDate}|${normalizeTeamName(g.teams.away.team.name)}|${normalizeTeamName(g.teams.home.team.name)}`;
    scheduleByKey.set(key, { homeId: g.teams.home.team.id, awayId: g.teams.away.team.id });
  }

  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T23:59:59Z`);
  const inRange = fixtures.filter((f) => {
    const t = Date.parse(f.startTime);
    return Number.isFinite(t) && t >= startMs && t <= endMs;
  });

  const unmatchedTeams = new Set<string>();
  let matched = 0;
  let alreadySkipped = 0;
  let ingested = 0;
  let stoppedOnBudget = false;
  const fetchFailures: Record<number, number> = {};

  for (const fixture of inRange) {
    const gameDate = easternDate(new Date(fixture.startTime));
    const p1 = normalizeTeamName(fixture.participant1Name);
    const p2 = normalizeTeamName(fixture.participant2Name);

    const p1IsHomeMatch = scheduleByKey.get(`${gameDate}|${p2}|${p1}`); // p1=home, p2=away
    const p2IsHomeMatch = scheduleByKey.get(`${gameDate}|${p1}|${p2}`); // p2=home, p1=away
    const resolved = p1IsHomeMatch
      ? { homeId: p1IsHomeMatch.homeId, awayId: p1IsHomeMatch.awayId, side1IsHome: true }
      : p2IsHomeMatch
        ? { homeId: p2IsHomeMatch.homeId, awayId: p2IsHomeMatch.awayId, side1IsHome: false }
        : null;
    if (!resolved) {
      unmatchedTeams.add(`${fixture.participant1Name} vs ${fixture.participant2Name} (${gameDate})`);
      continue;
    }
    matched += 1;

    const season = Number(gameDate.slice(0, 4));
    if (getHistoricalOdds(season, gameDate, resolved.homeId, resolved.awayId)) {
      alreadySkipped += 1;
      continue;
    }

    const budget = monthlyStatus('oddspapi', config.monthlyLimit, config.softCap, 'requests');
    if (budget.exhausted) {
      stoppedOnBudget = true;
      break;
    }

    const { data: hist, status } = await fetchHistoricalOddsForFixture(apiKey, fixture.fixtureId);
    // Only count spend on an actual successful response — a 429 is the
    // provider saying "you asked too fast," not "here's your data, that's a
    // credit," and Phase 0 already found this endpoint isn't reliably
    // metered the same way the odds/fixtures/markets calls are anyway.
    if (hist) {
      recordMonthlySpend('oddspapi', 1, 0);
      requestsUsedThisRun += 1;
    } else {
      fetchFailures[status] = (fetchFailures[status] ?? 0) + 1;
    }
    // Pacing gap between DIFFERENT fixtures, on top of the retry backoff
    // fetchHistoricalOddsForFixture already does internally for a single
    // fixture's own 429s.
    await sleep(1000);
    if (!hist) continue;

    // Moneyline (market 131): outcome 131 = side "1" (participant1), outcome
    // 132 = side "2" (participant2) — mapped to home/away via side1IsHome
    // resolved above from the real schedule, not trusted from field order.
    const mlClosingPairsHomeAway: Array<[number, number]> = [];
    const mlOpeningPairsHomeAway: Array<[number, number]> = [];
    for (const book of Object.values(hist.bookmakers ?? {})) {
      const market = book.markets?.[String(MONEYLINE_MARKET_ID)];
      if (!market) continue;
      const side1Series = playerSeries(market.outcomes, MONEYLINE_MARKET_ID);
      const side2Series = playerSeries(market.outcomes, MONEYLINE_MARKET_ID + 1);
      const closeSide1 = lastPreGameSnapshot(side1Series, fixture.startTime);
      const closeSide2 = lastPreGameSnapshot(side2Series, fixture.startTime);
      if (closeSide1 && closeSide2) {
        const homePrice = resolved.side1IsHome ? closeSide1.price : closeSide2.price;
        const awayPrice = resolved.side1IsHome ? closeSide2.price : closeSide1.price;
        mlClosingPairsHomeAway.push([awayPrice, homePrice]); // [away, home] to match devigAverage(a=away,b=home) convention used elsewhere
      }
      const openSide1 = firstSnapshot(side1Series);
      const openSide2 = firstSnapshot(side2Series);
      if (openSide1 && openSide2) {
        const homePrice = resolved.side1IsHome ? openSide1.price : openSide2.price;
        const awayPrice = resolved.side1IsHome ? openSide2.price : openSide1.price;
        mlOpeningPairsHomeAway.push([awayPrice, homePrice]);
      }
    }
    const closeMl = devigAverage(mlClosingPairsHomeAway);
    const openMl = devigAverage(mlOpeningPairsHomeAway);
    const bookCount = mlClosingPairsHomeAway.length;

    // Totals: per book, find whichever handicap's market has the latest
    // (closing) / earliest (opening) real snapshot — see this file's own
    // header for why totals aren't one fixed market ID here.
    const closingTotalsPerBook: Array<{ handicap: number; overPrice: number; underPrice: number }> = [];
    const openingTotalsPerBook: Array<{ handicap: number; overPrice: number; underPrice: number }> = [];
    for (const book of Object.values(hist.bookmakers ?? {})) {
      let bestClose: { handicap: number; overPrice: number; underPrice: number; at: string } | null = null;
      let bestOpen: { handicap: number; overPrice: number; underPrice: number; at: string } | null = null;
      for (const [marketId, handicap] of handicapByTotalsMarketId) {
        const market = book.markets?.[String(marketId)];
        if (!market) continue;
        const overSeries = playerSeries(market.outcomes, marketId);
        const underSeries = playerSeries(market.outcomes, marketId + 1);
        const closeOver = lastPreGameSnapshot(overSeries, fixture.startTime);
        const closeUnder = lastPreGameSnapshot(underSeries, fixture.startTime);
        if (closeOver && closeUnder) {
          const at = closeOver.createdAt > closeUnder.createdAt ? closeOver.createdAt : closeUnder.createdAt;
          if (!bestClose || at > bestClose.at) bestClose = { handicap, overPrice: closeOver.price, underPrice: closeUnder.price, at };
        }
        const openOver = firstSnapshot(overSeries);
        const openUnder = firstSnapshot(underSeries);
        if (openOver && openUnder) {
          const at = openOver.createdAt < openUnder.createdAt ? openOver.createdAt : openUnder.createdAt;
          if (!bestOpen || at < bestOpen.at) bestOpen = { handicap, overPrice: openOver.price, underPrice: openUnder.price, at };
        }
      }
      if (bestClose) closingTotalsPerBook.push(bestClose);
      if (bestOpen) openingTotalsPerBook.push(bestOpen);
    }
    const closeTotal = devigAverage(closingTotalsPerBook.map((t): [number, number] => [t.overPrice, t.underPrice]));
    const openTotal = devigAverage(openingTotalsPerBook.map((t): [number, number] => [t.overPrice, t.underPrice]));
    const totalLine = average(closingTotalsPerBook.map((t) => t.handicap));
    const totalOpenLine = average(openingTotalsPerBook.map((t) => t.handicap));

    const entry: HistoricalOddsInput = {
      season,
      gameDate,
      homeTeamId: resolved.homeId,
      awayTeamId: resolved.awayId,
      homeScore: null,
      awayScore: null,
      mlHomeConsensusProb: closeMl?.b ?? null,
      mlAwayConsensusProb: closeMl?.a ?? null,
      totalLine,
      totalOverConsensusProb: closeTotal?.a ?? null,
      totalUnderConsensusProb: closeTotal?.b ?? null,
      mlHomeOpenProb: openMl?.b ?? null,
      mlAwayOpenProb: openMl?.a ?? null,
      totalOpenLine,
      totalOpenOverProb: openTotal?.a ?? null,
      totalOpenUnderProb: openTotal?.b ?? null,
      source: 'oddspapi-historical',
      bookCount,
    };
    writeHistoricalOdds([entry]);
    ingested += 1;
  }

  const finalBudget = monthlyStatus('oddspapi', config.monthlyLimit, config.softCap, 'requests');
  return {
    dateRange: [startDate, endDate],
    fixturesInRange: inRange.length,
    matched,
    unmatchedTeams: [...unmatchedTeams],
    alreadySkipped,
    ingested,
    fetchFailures,
    stoppedOnBudget,
    requestsUsedThisRun,
    budgetRemainingAfter: finalBudget.remaining,
  };
}
