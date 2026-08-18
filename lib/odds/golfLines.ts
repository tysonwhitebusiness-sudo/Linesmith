/**
 * Golf tournament-winner lines from SharpAPI.
 *
 * Of the app's five configured odds providers, SharpAPI is the only one with
 * a genuine live outright board for golf — verified live: `sport=golf&
 * league=pga` returns the actual current PGA Tour event with a full-field
 * `outright` market across DraftKings + FanDuel. The other four either have
 * no golf coverage at all or model golf as head-to-head matchups, not an
 * outright board. Reuses the same `sharpApiConfig()` this app already has
 * wired up for MLB props — no new env var, no new provider account.
 *
 * Top 5 / Top 10 aren't included: SharpAPI's golf catalog is outright-only
 * (probed `market_type=top_5`/`top10`/`make_cut` live — all return zero
 * rows), and none of the other four providers carry golf place markets
 * either. This ships Match Winner priced; Top 5/Top 10 stay leaderboard-
 * position context only (see TournamentLinesView), not a priced market.
 *
 * Same shape as `oddsApi.ts`'s MLB game lines, not a `PickCandidate`: an
 * outright is a single field-wide price per golfer, not a repeating pattern
 * to scan, so this sits outside lib/core's history/streak engine entirely —
 * the same reason MLB's moneyline/total live outside it too.
 */

import { sharpApiConfig } from './props/config';
import { americanToDecimal, impliedFromDecimal } from './display';
import { readOddsCache, writeOddsCache } from '../db/client';
import { buildGolfRosterIndex, resolveGolfer } from '../sports/golf/golfPlayerMatching';
import type { SubjectSummary } from '../core/types';

const BASE = 'https://api.sharpapi.io/api/v1';
const CACHE_KEY = 'golf:sharpapi:outrights';
// SharpAPI's free tier is already 60s-delayed and unmetered (12 req/min, no
// monthly cap) — this TTL just avoids re-fetching faster than the golf
// snapshot itself refreshes (api/golf/route.ts's own 5-minute cache).
const TTL_MS = 5 * 60 * 1000;

interface SharpApiGolfRow {
  event_id: string;
  home_team: string;
  selection: string;
  selection_type: string;
  odds_american: number;
  sportsbook: string;
  market_type: string;
  event_start_time: string;
}

interface SharpApiGolfResponse {
  data: SharpApiGolfRow[];
}

export interface GolfOutrightPrice {
  bookmaker: string;
  americanOdds: number;
}

export interface GolfOutrightLine {
  /** ESPN athlete id — the canonical golfer id everywhere else in the app. Null when SharpAPI's name couldn't be matched to today's field. */
  espnId: string | null;
  golferName: string;
  prices: GolfOutrightPrice[];
  bestPrice: GolfOutrightPrice | null;
  /** Raw implied probability (vig included) from the best price — sort key only, not a fair-value estimate. */
  impliedProb: number | null;
}

export interface GolfLinesResult {
  enabled: boolean;
  lines: GolfOutrightLine[];
  eventName: string | null;
  fetchedAt: string | null;
  fromCache: boolean;
  warnings: string[];
}

function disabled(warning: string): GolfLinesResult {
  return { enabled: false, lines: [], eventName: null, fetchedAt: null, fromCache: false, warnings: [warning] };
}

async function fetchGolfBoard(apiKey: string): Promise<SharpApiGolfResponse | null> {
  const res = await fetch(`${BASE}/odds?sport=golf&league=pga&limit=500`, {
    headers: { 'X-API-Key': apiKey },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return (await res.json()) as SharpApiGolfResponse;
}

/**
 * Which of SharpAPI's several concurrent golf events is today's actual PGA
 * Tour field.
 *
 * Timestamp proximity to "now" turned out unreliable in practice — SharpAPI
 * carries several tours' events at once (DP World Tour, LPGA, PGA) with
 * overlapping windows, and a smaller/earlier-starting event can sit closer
 * to "now" than the real PGA Tour event without being it at all. The
 * reliable signal is name overlap: whichever event's `outright` selections
 * actually resolve against today's live ESPN field is unambiguously the
 * right one — a wrong tour's field matches essentially zero names. Falls
 * back to timestamp proximity only when the roster is empty (snapshot not
 * cached yet) and there's nothing to match against.
 */
function pickCurrentEvent(
  rows: SharpApiGolfRow[],
  subjects: SubjectSummary[],
  now: number,
): { eventId: string; eventName: string } | null {
  const rosterIndex = buildGolfRosterIndex(subjects);
  const byEvent = new Map<string, { eventName: string; matched: number; startDist: number }>();

  for (const r of rows) {
    const start = Date.parse(r.event_start_time);
    const startDist = Number.isFinite(start) ? Math.abs(start - now) : Number.POSITIVE_INFINITY;
    let entry = byEvent.get(r.event_id);
    if (!entry) {
      entry = { eventName: r.home_team, matched: 0, startDist };
      byEvent.set(r.event_id, entry);
    }
    if (r.market_type === 'outright' && resolveGolfer(r.selection, rosterIndex)) entry.matched += 1;
  }

  if (byEvent.size === 0) return null;

  const ranked = [...byEvent.entries()];
  const anyMatches = ranked.some(([, e]) => e.matched > 0);
  ranked.sort(([, a], [, b]) => (anyMatches ? b.matched - a.matched : a.startDist - b.startDist));

  const [eventId, best] = ranked[0];
  return { eventId, eventName: best.eventName };
}

function buildLines(rows: SharpApiGolfRow[], subjects: SubjectSummary[], warnings: string[]): GolfOutrightLine[] {
  const rosterIndex = buildGolfRosterIndex(subjects);
  const byKey = new Map<string, GolfOutrightLine>();

  for (const row of rows) {
    if (row.market_type !== 'outright') continue;
    const matched = resolveGolfer(row.selection, rosterIndex);
    const key = matched?.espnId ?? `unmatched:${row.selection}`;

    let line = byKey.get(key);
    if (!line) {
      line = { espnId: matched?.espnId ?? null, golferName: matched?.name ?? row.selection, prices: [], bestPrice: null, impliedProb: null };
      byKey.set(key, line);
    }

    line.prices.push({ bookmaker: row.sportsbook, americanOdds: row.odds_american });
    // Best for the bettor is the largest American number (least-negative favorite price, or biggest underdog payout).
    if (!line.bestPrice || row.odds_american > line.bestPrice.americanOdds) {
      line.bestPrice = { bookmaker: row.sportsbook, americanOdds: row.odds_american };
    }
  }

  const unmatched = [...byKey.values()].filter((l) => l.espnId === null).length;
  if (unmatched > 0) {
    warnings.push(`${unmatched} SharpAPI golfer${unmatched === 1 ? '' : 's'} could not be matched to today's ESPN field.`);
  }

  const lines = [...byKey.values()];
  for (const line of lines) {
    if (line.bestPrice) {
      line.impliedProb = impliedFromDecimal(americanToDecimal(line.bestPrice.americanOdds)) ?? null;
    }
  }
  // Favorites first — highest implied probability (raw, vig included; this
  // is an N-way outright board, not a two-way market, so devigTwoWay doesn't
  // apply here) at the top, unmatched/unpriced rows sink to the bottom.
  lines.sort((a, b) => (b.impliedProb ?? -1) - (a.impliedProb ?? -1));
  return lines;
}

/**
 * Resolve the cached or freshly-fetched board into a result: pick today's
 * event fresh against `subjects` every call (cheap — a few hundred rows),
 * never trust a previously-cached event pick, since the roster that decides
 * it can change between calls (an early call with an empty snapshot cache
 * falls back to timestamp proximity; a later call with the real field
 * corrects itself automatically).
 */
function resolveFromBoard(rows: SharpApiGolfRow[], subjects: SubjectSummary[], fetchedAt: string, fromCache: boolean, extraWarnings: string[]): GolfLinesResult {
  const current = pickCurrentEvent(rows, subjects, Date.now());
  if (!current) {
    return { enabled: true, lines: [], eventName: null, fetchedAt, fromCache, warnings: [...extraWarnings, 'SharpAPI returned no golf events.'] };
  }
  const eventRows = rows.filter((r) => r.event_id === current.eventId);
  const warnings = [...extraWarnings];
  return {
    enabled: true,
    lines: buildLines(eventRows, subjects, warnings),
    eventName: current.eventName,
    fetchedAt,
    fromCache,
    warnings,
  };
}

/**
 * Fetch (or serve cached) Match Winner odds for the current PGA Tour event,
 * matched against today's ESPN field so the caller can attach a price to a
 * subject by the same id it already uses everywhere else.
 */
export async function getGolfTournamentLines(subjects: SubjectSummary[], force = false): Promise<GolfLinesResult> {
  const config = sharpApiConfig();
  if (!config.enabled) {
    return disabled('SharpAPI is disabled or SHARPAPI_KEY is not set — Match Winner odds are turned off.');
  }

  const cached = readOddsCache(CACHE_KEY);
  const ageMs = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;
  if (cached && ageMs < TTL_MS && !force) {
    const rows = JSON.parse(cached.payload) as SharpApiGolfRow[];
    return resolveFromBoard(rows, subjects, cached.fetchedAt, true, []);
  }

  const board = await fetchGolfBoard(config.key ?? '');
  if (!board) {
    if (cached) {
      const rows = JSON.parse(cached.payload) as SharpApiGolfRow[];
      return resolveFromBoard(rows, subjects, cached.fetchedAt, true, ['SharpAPI request failed — showing the last successful fetch.']);
    }
    return { ...disabled('SharpAPI request failed and there is no cached copy yet.'), enabled: true };
  }

  writeOddsCache(CACHE_KEY, JSON.stringify(board.data), null, null);
  return resolveFromBoard(board.data, subjects, new Date().toISOString(), false, []);
}
