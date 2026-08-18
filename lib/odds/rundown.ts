/**
 * TheRundown — game-lines/schedule/live-score enrichment only, across every
 * sport. Free tier explicitly excludes player props ("No player props or
 * alt markets" — their own pricing page); Starter ($49/mo) required for
 * that. This module never touches the props pipeline (registry.ts) — it
 * plays the same "extra bookmaker depth on game lines" role `oddsHarvester.ts`
 * already does for MLB, generalized across sports.
 *
 * Rate-limited to 1 req/sec on the free tier — every call routes through
 * `throttledFetch` so a burst (e.g. refreshing several sports back to back)
 * can't trip a 429.
 */

import { rundownConfig } from './props/config';
import type { GameLine } from './oddsApi';

const BASE = 'https://therundown.io/api/v2';

export const RUNDOWN_SPORT_IDS: Record<string, number> = {
  mlb: 3,
  nfl: 2,
  cfb: 1,
  soccer_epl: 11,
  tennis_atp: 38,
  tennis_wta: 39,
  nhl: 6,
  nba: 4,
};

// Core game-line/spread/total market ids, shared across every team sport on
// TheRundown's catalog (see docs/... this session's live `/v2/markets` pull).
const CORE_MARKET_IDS = '1,2,3';

let lastCallAt = 0;
const MIN_INTERVAL_MS = 1100; // just over 1 req/sec, with margin

// A hung/slow TCP connection to therundown.io (a real ECONNRESET was
// observed live this session) had no timeout at all — since every NFL page
// calls this through useGameLines, that meant one bad connection could stall
// every NFL page's odds request for however long the OS took to give up.
const FETCH_TIMEOUT_MS = 8_000;

async function throttledFetch(url: string): Promise<Response> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCallAt = Date.now();
  const key = rundownConfig().key;
  return fetch(url, { headers: key ? { 'X-TheRundown-Key': key } : {}, cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

/** One sportsbook's price on one line. `is_main_line` marks the book's current headline number among that participant's alternate-line ladder. */
interface RundownPrice {
  id: string;
  price: number;
  is_main_line: boolean;
  updated_at: string;
}

/** One point value's prices across books, e.g. spread "+1.5" or total "9.5". */
interface RundownLine {
  id: string;
  /** Present on spread/total lines (the point); absent on moneyline. */
  value?: string;
  prices: Record<string, RundownPrice>;
}

/** A team (moneyline/handicap) or a result like "Over"/"Under" (totals). `id` matches `team_id` on the event's `teams[]` for team-scoped markets. */
interface RundownParticipant {
  id: number;
  type: string;
  name: string;
  lines: RundownLine[];
}

export interface RundownMarket {
  id: number;
  market_id: number;
  name: string;
  participants: RundownParticipant[];
}

export interface RundownGameLine {
  eventId: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  status: string;
  markets: RundownMarket[];
}

/** Game lines for one sport, one date (YYYY-MM-DD). Free-tier legal — game lines only, no props. */
export async function getRundownGameLines(sportKey: string, date: string): Promise<{ lines: RundownGameLine[]; warnings: string[] }> {
  const config = rundownConfig();
  if (!config.enabled || !config.key) {
    return { lines: [], warnings: ['TheRundown is disabled.'] };
  }
  const sportId = RUNDOWN_SPORT_IDS[sportKey];
  if (!sportId) {
    return { lines: [], warnings: [`TheRundown has no sport id mapped for ${sportKey}.`] };
  }

  let res: Response;
  try {
    res = await throttledFetch(`${BASE}/sports/${sportId}/events/${date}?market_ids=${CORE_MARKET_IDS}`);
  } catch (error) {
    // Timeout (AbortSignal) or a real network failure (ECONNRESET observed
    // live this session) — same honest-empty pattern every other provider
    // in this stack uses, not a thrown error that takes the whole
    // useGameLines caller down with it.
    return { lines: [], warnings: [`TheRundown request failed (${error instanceof Error ? error.message : 'network error'}).`] };
  }
  if (!res.ok) {
    return { lines: [], warnings: [`TheRundown request failed (${res.status}).`] };
  }
  const json = (await res.json()) as {
    events?: Array<{
      event_id: string;
      event_date: string;
      score?: { event_status_detail?: string };
      teams?: Array<{ team_id: number; name: string; mascot?: string; is_home: boolean; is_away: boolean }>;
      markets?: RundownMarket[];
    }>;
  };

  const lines: RundownGameLine[] = (json.events ?? []).map((ev) => {
    const home = ev.teams?.find((t) => t.is_home);
    const away = ev.teams?.find((t) => t.is_away);
    return {
      eventId: ev.event_id,
      date: ev.event_date,
      homeTeam: home ? `${home.name} ${home.mascot ?? ''}`.trim() : 'Unknown',
      awayTeam: away ? `${away.name} ${away.mascot ?? ''}`.trim() : 'Unknown',
      homeTeamId: home?.team_id ?? null,
      awayTeamId: away?.team_id ?? null,
      status: ev.score?.event_status_detail ?? 'Scheduled',
      markets: ev.markets ?? [],
    };
  });

  return { lines, warnings: [] };
}

// ---------------------------------------------------------------------------
// Market parser — real shape confirmed live this session (MLB, in-season):
// `market.name` is 'moneyline' | 'handicap' (spread) | 'totals'. Moneyline/
// handicap participants are the two teams (`participant.id` matches a
// `team_id` from the event's own `teams[]`); totals participants are
// "Over"/"Under" result buckets, not teams. Each participant carries a ladder
// of alternate-line `lines[]`; the line to use is whichever one has a price
// flagged `is_main_line: true` for at least one book — alternates omit that
// flag entirely rather than setting it false, so this can't be mistaken for
// "no line available yet".
// ---------------------------------------------------------------------------

function bestMainLinePrice(participant: RundownParticipant | undefined): { price: number; point: number | null } | null {
  if (!participant) return null;
  for (const line of participant.lines) {
    let best: number | null = null;
    for (const p of Object.values(line.prices)) {
      if (!p.is_main_line) continue;
      if (best == null || p.price > best) best = p.price;
    }
    if (best != null) {
      return { price: best, point: line.value != null ? Number(line.value) : null };
    }
  }
  return null;
}

/** Convert one event's parsed markets into the shared `GameLine` shape used by SharpAPI/SportsGameOdds/the-odds-api. */
export function toGameLine(rundownLine: RundownGameLine): GameLine {
  const moneylineMarket = rundownLine.markets.find((m) => m.name === 'moneyline');
  const spreadMarket = rundownLine.markets.find((m) => m.name === 'handicap');
  const totalMarket = rundownLine.markets.find((m) => m.name === 'totals');

  const homeParticipant = (m: RundownMarket | undefined) => m?.participants.find((p) => p.id === rundownLine.homeTeamId);
  const awayParticipant = (m: RundownMarket | undefined) => m?.participants.find((p) => p.id === rundownLine.awayTeamId);
  const overParticipant = totalMarket?.participants.find((p) => p.name === 'Over');
  const underParticipant = totalMarket?.participants.find((p) => p.name === 'Under');

  const mlHome = bestMainLinePrice(homeParticipant(moneylineMarket));
  const mlAway = bestMainLinePrice(awayParticipant(moneylineMarket));
  const spHome = bestMainLinePrice(homeParticipant(spreadMarket));
  const spAway = bestMainLinePrice(awayParticipant(spreadMarket));
  const over = bestMainLinePrice(overParticipant);
  const under = bestMainLinePrice(underParticipant);

  return {
    eventId: rundownLine.eventId,
    commenceTime: rundownLine.date,
    homeTeam: rundownLine.homeTeam,
    awayTeam: rundownLine.awayTeam,
    moneyline: mlHome || mlAway ? { home: mlHome?.price, away: mlAway?.price, book: 'TheRundown' } : undefined,
    spread:
      spHome || spAway
        ? { homePoint: spHome?.point ?? undefined, homePrice: spHome?.price, awayPoint: spAway?.point ?? undefined, awayPrice: spAway?.price, book: 'TheRundown' }
        : undefined,
    total:
      over || under
        ? { point: over?.point ?? under?.point ?? undefined, overPrice: over?.price, underPrice: under?.price, book: 'TheRundown' }
        : undefined,
    bookCount: 1,
  };
}
