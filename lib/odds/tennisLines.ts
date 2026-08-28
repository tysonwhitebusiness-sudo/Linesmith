/**
 * Tennis odds from SharpAPI — Tournament Winner futures and per-match
 * Moneyline, tennis's counterpart to `golfLines.ts`.
 *
 * Confirmed live before building (not assumed from golf's shape): SharpAPI
 * genuinely carries both markets for tennis, with one real gotcha — **ATP
 * calls the futures market `outright`, WTA calls the identical market
 * `tournament_winner`**. Same vendor, same shape of data, different key per
 * league; both confirmed live with real FanDuel prices for the (then-current)
 * US Open. `market_type=moneyline` is real too, per real scheduled/live
 * match, with a `home`/`away` object carrying SharpAPI's own player id/logo —
 * not currently ingested by the Python props pipeline (`_tennis_specs` in
 * jobs.py only pulls `is_player_prop=true` rows), so this is genuinely new
 * surface area for the app, not a re-read of something already flowing in.
 *
 * Unlike golf, this module already knows exactly which real tournament (and,
 * for moneyline, exactly which two real players) it's pricing — the caller
 * gets that from ESPN's own schedule/draw data, not a guess. So instead of
 * golf's roster-overlap heuristic for picking "the" PGA event out of
 * SharpAPI's cross-tour clutter, this matches on the tournament/player name
 * SharpAPI already labels its own rows with. SharpAPI's tennis catalog for
 * a single league still bundles lower-level (Challenger/ITF-shaded) events
 * alongside the real tour event, confirmed live (e.g. "James Girdler" vs
 * "Jera Staley" rows sitting in the same `league=atp` pull as the real US
 * Open) — so a confident name match is still required, not just "first
 * result returned".
 */

import { sharpApiConfig } from './props/config';
import { americanToDecimal, impliedFromDecimal } from './display';
import { readOddsCache, writeOddsCache } from '../db/client';
import { scoreNameMatch } from './screenshotImport';
import type { SubjectSummary, TennisTour } from '../core/types';

const BASE = 'https://api.sharpapi.io/api/v1';
const OUTRIGHT_MARKET: Record<TennisTour, string> = { atp: 'outright', wta: 'tournament_winner' };
const TTL_MS = 5 * 60 * 1000;

interface SharpApiTennisRow {
  event_id: string;
  home_team: string;
  away_team: string;
  selection: string;
  selection_type: string;
  market_type: string;
  odds_american: number;
  sportsbook: string;
  event_start_time: string;
}
interface SharpApiTennisResponse {
  data: SharpApiTennisRow[];
}

async function fetchTennisBoard(tour: TennisTour, apiKey: string): Promise<SharpApiTennisResponse | null> {
  const res = await fetch(`${BASE}/odds?sport=tennis&league=${tour}&limit=500`, {
    headers: { 'X-API-Key': apiKey },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return (await res.json()) as SharpApiTennisResponse;
}

/** "Men's US Open 2026" / "US Open" both reduce to "us open" — strips the gender prefix and a trailing year, the two ways SharpAPI's tournament label differs from ESPN's. */
function normalizeTournamentLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/^(men's|women's)\s+/i, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Almost every tournament name ends in a generic word like "Open" or
 * "Championships" — the opposite of a person name, where the last word
 * (the surname) is the MOST distinctive token. Confirmed live this was a
 * real bug, not theoretical: reusing `scoreNameMatch` (built around
 * surname-weighting) for tournament labels let a long-finished "Credit One
 * Charleston Open" silently match SharpAPI's live "US Open" board, purely
 * because both labels' last word is "open" — same failure mode `scoreNameMatch`
 * is specifically built to avoid for actual person names. This scorer
 * instead compares only the words that aren't generic tournament noise.
 */
const GENERIC_TOURNAMENT_WORDS = new Set(['open', 'championships', 'championship', 'masters', 'classic', 'cup', 'international', 'tournament', 'tennis', 'grand', 'prix', 'the']);

function distinctiveWords(label: string): Set<string> {
  return new Set(label.split(' ').filter((w) => w.length > 0 && !GENERIC_TOURNAMENT_WORDS.has(w)));
}

/** Jaccard overlap of each label's non-generic words — 0 when either side has no distinctive word left (never a match), 1 for an exact distinctive-word set match. */
function scoreTournamentMatch(a: string, b: string): number {
  const wa = distinctiveWords(a);
  const wb = distinctiveWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap += 1;
  return overlap / (wa.size + wb.size - overlap);
}

// ---------------------------------------------------------------------------
// Tournament Winner (futures)
// ---------------------------------------------------------------------------

export interface TennisOutrightPrice {
  bookmaker: string;
  americanOdds: number;
}
export interface TennisOutrightLine {
  espnId: string | null;
  playerName: string;
  prices: TennisOutrightPrice[];
  bestPrice: TennisOutrightPrice | null;
  impliedProb: number | null;
}
export interface TennisLinesResult {
  enabled: boolean;
  lines: TennisOutrightLine[];
  eventName: string | null;
  fetchedAt: string | null;
  fromCache: boolean;
  warnings: string[];
}

function disabled(warning: string): TennisLinesResult {
  return { enabled: false, lines: [], eventName: null, fetchedAt: null, fromCache: false, warnings: [warning] };
}

function resolveSubject(rawName: string, subjects: SubjectSummary[]): SubjectSummary | null {
  let best: SubjectSummary | null = null;
  let bestScore = 0;
  for (const s of subjects) {
    const score = scoreNameMatch(rawName, s.subjectName);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return bestScore >= 0.85 ? best : null;
}

function pickEvent(rows: SharpApiTennisRow[], marketType: string, tournamentName: string): string | null {
  const targetNorm = normalizeTournamentLabel(tournamentName);
  const byEvent = new Map<string, string>(); // event_id -> home_team label
  for (const r of rows) {
    if (r.market_type !== marketType) continue;
    if (!byEvent.has(r.event_id)) byEvent.set(r.event_id, r.home_team);
  }

  let best: string | null = null;
  let bestScore = 0;
  for (const [eventId, label] of byEvent) {
    const score = scoreTournamentMatch(normalizeTournamentLabel(label), targetNorm);
    if (score > bestScore) {
      bestScore = score;
      best = eventId;
    }
  }
  // Requires every distinctive word on both sides to line up — SharpAPI only
  // ever carries live/near-term boards, so a finished-months-ago tournament
  // correctly finds nothing here rather than a low-confidence guess.
  return bestScore >= 0.75 ? best : null;
}

function buildOutrightLines(rows: SharpApiTennisRow[], marketType: string, eventId: string, subjects: SubjectSummary[], warnings: string[]): TennisOutrightLine[] {
  const byKey = new Map<string, TennisOutrightLine>();
  for (const row of rows) {
    if (row.event_id !== eventId || row.market_type !== marketType) continue;
    const matched = resolveSubject(row.selection, subjects);
    const key = matched?.subjectId ?? `unmatched:${row.selection}`;
    let line = byKey.get(key);
    if (!line) {
      line = { espnId: matched?.subjectId ?? null, playerName: matched?.subjectName ?? row.selection, prices: [], bestPrice: null, impliedProb: null };
      byKey.set(key, line);
    }
    line.prices.push({ bookmaker: row.sportsbook, americanOdds: row.odds_american });
    if (!line.bestPrice || row.odds_american > line.bestPrice.americanOdds) {
      line.bestPrice = { bookmaker: row.sportsbook, americanOdds: row.odds_american };
    }
  }

  const unmatched = [...byKey.values()].filter((l) => l.espnId === null).length;
  if (unmatched > 0) {
    warnings.push(`${unmatched} SharpAPI player${unmatched === 1 ? '' : 's'} could not be matched to this tournament's field.`);
  }

  const lines = [...byKey.values()];
  for (const line of lines) {
    if (line.bestPrice) line.impliedProb = impliedFromDecimal(americanToDecimal(line.bestPrice.americanOdds)) ?? null;
  }
  lines.sort((a, b) => (b.impliedProb ?? -1) - (a.impliedProb ?? -1));
  return lines;
}

function resolveOutrightsFromBoard(
  rows: SharpApiTennisRow[],
  tour: TennisTour,
  tournamentName: string,
  subjects: SubjectSummary[],
  fetchedAt: string,
  fromCache: boolean,
  extraWarnings: string[],
): TennisLinesResult {
  const marketType = OUTRIGHT_MARKET[tour];
  const eventId = pickEvent(rows, marketType, tournamentName);
  if (!eventId) {
    return { enabled: true, lines: [], eventName: null, fetchedAt, fromCache, warnings: [...extraWarnings, `SharpAPI has no ${marketType} board matching "${tournamentName}" right now.`] };
  }
  const warnings = [...extraWarnings];
  return { enabled: true, lines: buildOutrightLines(rows, marketType, eventId, subjects, warnings), eventName: tournamentName, fetchedAt, fromCache, warnings };
}

/** Tournament Winner futures for one real ATP/WTA event, matched against that tournament's field. */
export async function getTennisTournamentLines(tour: TennisTour, tournamentName: string, subjects: SubjectSummary[], force = false): Promise<TennisLinesResult> {
  const config = sharpApiConfig();
  if (!config.enabled) {
    return disabled('SharpAPI is disabled or SHARPAPI_KEY is not set — Tournament Winner odds are turned off.');
  }

  const cacheKey = `tennis:sharpapi:outrights:${tour}`;
  const cached = await readOddsCache(cacheKey);
  const ageMs = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;
  if (cached && ageMs < TTL_MS && !force) {
    return resolveOutrightsFromBoard(JSON.parse(cached.payload), tour, tournamentName, subjects, cached.fetchedAt, true, []);
  }

  const board = await fetchTennisBoard(tour, config.key ?? '');
  if (!board) {
    if (cached) {
      return resolveOutrightsFromBoard(JSON.parse(cached.payload), tour, tournamentName, subjects, cached.fetchedAt, true, ['SharpAPI request failed — showing the last successful fetch.']);
    }
    return { ...disabled('SharpAPI request failed and there is no cached copy yet.'), enabled: true };
  }

  await writeOddsCache(cacheKey, JSON.stringify(board.data), null, null);
  return resolveOutrightsFromBoard(board.data, tour, tournamentName, subjects, new Date().toISOString(), false, []);
}

// ---------------------------------------------------------------------------
// Per-match Moneyline
// ---------------------------------------------------------------------------

export interface TennisMoneyline {
  matchId: string;
  home: { athleteId: string; bestPrice: TennisOutrightPrice | null };
  away: { athleteId: string; bestPrice: TennisOutrightPrice | null };
}

/**
 * Real per-match win odds for a set of already-known matches (from the draw
 * we already fetched — no "which event" ambiguity here, just "which two
 * SharpAPI rows are this exact pairing"). Matches by both players' names
 * scoring against SharpAPI's `home_team`/`away_team`, order-insensitive since
 * SharpAPI's home/away assignment has no reason to line up with ESPN's.
 */
export async function getTennisMatchMoneylines(
  tour: TennisTour,
  matches: Array<{ matchId: string; homeAthleteId: string; homeName: string; awayAthleteId: string; awayName: string }>,
  force = false,
): Promise<{ enabled: boolean; lines: TennisMoneyline[]; warnings: string[] }> {
  const config = sharpApiConfig();
  if (!config.enabled) return { enabled: false, lines: [], warnings: ['SharpAPI is disabled or SHARPAPI_KEY is not set.'] };
  if (matches.length === 0) return { enabled: true, lines: [], warnings: [] };

  const cacheKey = `tennis:sharpapi:moneyline:${tour}`;
  const cached = await readOddsCache(cacheKey);
  const ageMs = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;
  let rows: SharpApiTennisRow[] | null = null;

  if (cached && ageMs < TTL_MS && !force) {
    rows = JSON.parse(cached.payload);
  } else {
    const board = await fetchTennisBoard(tour, config.key ?? '');
    if (board) {
      rows = board.data;
      await writeOddsCache(cacheKey, JSON.stringify(rows), null, null);
    } else if (cached) {
      rows = JSON.parse(cached.payload);
    }
  }
  if (!rows) return { enabled: true, lines: [], warnings: ['SharpAPI request failed and there is no cached copy yet.'] };

  const moneylineRows = rows.filter((r) => r.market_type === 'moneyline');
  const byEvent = new Map<string, SharpApiTennisRow[]>();
  for (const r of moneylineRows) {
    const bucket = byEvent.get(r.event_id);
    if (bucket) bucket.push(r);
    else byEvent.set(r.event_id, [r]);
  }

  const lines: TennisMoneyline[] = [];
  const warnings: string[] = [];
  for (const m of matches) {
    let bestEventId: string | null = null;
    let bestScore = 0;
    for (const [eventId, eventRows] of byEvent) {
      const [r0] = eventRows;
      if (!r0) continue;
      const direct = Math.min(scoreNameMatch(m.homeName, r0.home_team), scoreNameMatch(m.awayName, r0.away_team));
      const swapped = Math.min(scoreNameMatch(m.homeName, r0.away_team), scoreNameMatch(m.awayName, r0.home_team));
      const score = Math.max(direct, swapped);
      if (score > bestScore) {
        bestScore = score;
        bestEventId = eventId;
      }
    }
    if (bestScore < 0.85 || !bestEventId) continue;

    const eventRows = byEvent.get(bestEventId)!;
    const bestFor = (name: string): TennisOutrightPrice | null => {
      const candidates = eventRows.filter((r) => scoreNameMatch(name, r.selection) >= 0.85);
      if (candidates.length === 0) return null;
      const best = candidates.reduce((best, r) => (r.odds_american > best.odds_american ? r : best), candidates[0]);
      return { bookmaker: best.sportsbook, americanOdds: best.odds_american };
    };
    lines.push({
      matchId: m.matchId,
      home: { athleteId: m.homeAthleteId, bestPrice: bestFor(m.homeName) },
      away: { athleteId: m.awayAthleteId, bestPrice: bestFor(m.awayName) },
    });
  }

  return { enabled: true, lines, warnings };
}
