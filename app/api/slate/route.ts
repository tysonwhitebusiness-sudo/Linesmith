/**
 * GET /api/slate?sport=mlb[&league=epl|mls][&tour=atp|wta][&date=YYYY-MM-DD]
 *
 * The Slate's Games section, for every sport, built server-side.
 *
 * WHY IT IS SERVER-SIDE AT ALL. Scan's body reads `/api/{sport}` (26 MB for
 * MLB) and `/api/props/lines` (23.7 MB) in the browser, twice, and takes 60-90
 * seconds to settle on a cold dev load (SL-11). The Games section needs almost
 * none of that: fifteen cards, each a dozen strings. Shaping it here means the
 * top of the page is drawn from a payload measured in kilobytes while the props
 * table — which genuinely needs every candidate — loads underneath.
 *
 * CACHING — pattern 1 (`cachedRoute`), per CLAUDE.md. Every input is written by
 * something other than this request: the snapshot by the sport's own rebuild,
 * the book lines by the Python odds worker, the picks by the capture job. So a
 * request never needs a fresh read, and the TTL is the slowest thing a reader
 * would notice going stale — a live score, which is 60 seconds.
 *
 * CACHE KEY — `slate:route:{sport}:{date}`, grepped before it was chosen, per
 * CLAUDE.md's warning about the flat `snapshot_cache` namespace: nothing in
 * `lib/` or `app/` used a `slate:` prefix at all, and the `:route:` segment is
 * there for the reason `golf:schedule:route:` carries one — so it can never
 * collide with a constituent function caching its own differently-shaped answer
 * under the bare name. Sport and date are both bounded before they reach the
 * key, so an unbounded value cannot mint permanent cache rows.
 *
 * IT READS; IT NEVER WRITES. No GET handler in this app writes (CLAUDE.md).
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { readSnapshotCache, readGameOddsBookLinesForSport, listGamePickHistory } from '@/lib/db/client';
import type { SlateGame } from '@/lib/odds/matching';
import { easternDate } from '@/lib/sports/mlb/statsapi';
import type { UnifiedGameLine } from '@/lib/odds/types';
import type { EloPick } from '@/lib/sports/shared/buildSlate';
import type { SlateData } from '@/lib/sports/shared/slateShapes';
import { toSlateData as toMlbSlateData } from '@/lib/sports/mlb/adapters/slateAdapter';
import { toSlateData as toFootballSlateData } from '@/lib/sports/nfl/adapters/slateAdapter';
import { toSlateData as toNbaSlateData } from '@/lib/sports/nba/adapters/slateAdapter';
import { toSlateData as toNhlSlateData } from '@/lib/sports/nhl/adapters/slateAdapter';
import { toSlateData as toSoccerSlateData, type SoccerLeague } from '@/lib/sports/soccer/adapters/slateAdapter';
import { toSlateData as toTennisSlateData, type TennisTour } from '@/lib/sports/tennis/adapters/slateAdapter';
import { toSlateData as toGolfSlateData } from '@/lib/sports/golf/adapters/slateAdapter';

export const dynamic = 'force-dynamic';

/** A live score is the fastest-moving thing on the page. */
const TTL_MS = 60 * 1000;

const SPORTS = new Set(['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer', 'tennis', 'golf']);
const LEAGUES = new Set(['epl', 'mls']);
const TOURS = new Set(['atp', 'wta']);

/** How many picks back the Elo ring looks. A slate is one day; 200 is generous. */
const PICK_WINDOW = 200;

function parseDate(raw: string | null): string | undefined {
  // EASTERN, not UTC. A slate is a US sports day: at 03:00 UTC it is still
  // 23:00 the previous evening in New York and the same slate is still being
  // played. Defaulting to `toISOString()` emptied every Games section the
  // moment the clock passed midnight UTC — found by rendering at 23:06 ET.
  if (raw == null) return easternDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const year = Number(raw.slice(0, 4));
  if (year < 2000 || year > 2100) return undefined;
  return raw;
}

/** The snapshot's games, or `[]` — a missing cache is "no games", not an error. */
async function readGames(key: string): Promise<SlateGame[]> {
  const cached = await readSnapshotCache(key);
  if (!cached) return [];
  try {
    const snapshot = JSON.parse(cached.payload);
    return (snapshot?.context?.other?.games ?? []) as SlateGame[];
  } catch {
    return [];
  }
}

/**
 * How many props the slate holds per game.
 *
 * Read off the same snapshot the Props board reads, so the "N props →" on a
 * card and the rows the board shows come from one number rather than two
 * counts that can disagree.
 */
async function readPropCounts(key: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const cached = await readSnapshotCache(key);
  if (!cached) return out;
  try {
    const snapshot = JSON.parse(cached.payload);
    for (const c of (snapshot?.candidates ?? []) as Array<{ subjectMeta?: Record<string, unknown> }>) {
      const id = c.subjectMeta?.gamePk ?? c.subjectMeta?.gameId;
      if (id == null) continue;
      const k = String(id);
      out.set(k, (out.get(k) ?? 0) + 1);
    }
  } catch {
    return out;
  }
  return out;
}

/**
 * The generic-Elo pick per game.
 *
 * `mlFinalSide` is the locked pick and `mlInitialSide` the pre-lock read; the
 * card uses whichever exists, in that order, which is the same fallback the
 * game page's own pick card uses so the two surfaces cannot disagree.
 */
async function readEloPicks(sport: string): Promise<Map<string, EloPick>> {
  const out = new Map<string, EloPick>();
  try {
    for (const row of await listGamePickHistory(sport, PICK_WINDOW)) {
      const side = row.mlFinalSide ?? row.mlInitialSide;
      if (!side) continue;
      out.set(String(row.gameId), { gameId: String(row.gameId), side, prob: row.mlFinalProb ?? row.mlInitialProb });
    }
  } catch {
    // A picks read failing must not empty the Games section: the ring is an
    // extra, the cards are the page.
    return out;
  }
  return out;
}

async function buildSlate(sport: string, league: string | null, tour: string | null, date: string): Promise<SlateData> {
  if (sport === 'golf') return toGolfSlateData({ date });

  if (sport === 'soccer') {
    const l = (league ?? 'epl') as SoccerLeague;
    const key = `soccer:snapshot:${l}`;
    const [games, lines, picks, propCounts] = await Promise.all([
      readGames(key),
      // `game_odds_book_lines.sport` is the GENERIC key — `soccer`, never
      // `soccer_epl` (see `db.py`'s own `_GENERIC_SPORT_KEY` note: querying
      // with the granular key "would silently return zero rows for exactly the
      // sports that need this most"). It did: every EPL card drew an empty
      // lines block until this was corrected. `game_picks` IS granular, hence
      // the two different keys on these two lines.
      readGameOddsBookLinesForSport('soccer'),
      readEloPicks(`soccer_${l}`),
      readPropCounts(key),
    ]);
    return toSoccerSlateData({ league: l, date, games, lines, picks, propCounts });
  }

  if (sport === 'tennis') {
    const t = (tour ?? 'atp') as TennisTour;
    const key = `tennis:snapshot:${t}`;
    const [games, lines, propCounts] = await Promise.all([
      readGames(key),
      // Generic key, same as soccer above.
      readGameOddsBookLinesForSport('tennis'),
      readPropCounts(key),
    ]);
    return toTennisSlateData({ tour: t, date, games, lines, propCounts });
  }

  const key = `${sport}:snapshot`;
  const [games, lines, propCounts] = await Promise.all([readGames(key), readGameOddsBookLinesForSport(sport), readPropCounts(key)]);

  if (sport === 'mlb') return toMlbSlateData({ date, games, lines, propCounts });
  const picks = await readEloPicks(sport);
  if (sport === 'nba') return toNbaSlateData({ date, games, lines, picks, propCounts });
  if (sport === 'nhl') return toNhlSlateData({ date, games, lines, picks, propCounts });
  return toFootballSlateData({ sport: sport as 'nfl' | 'cfb', date, games, lines, picks, propCounts });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  if (!SPORTS.has(sport)) {
    return NextResponse.json({ error: `Unknown sport. Expected one of: ${[...SPORTS].join(', ')}` }, { status: 400 });
  }

  const league = url.searchParams.get('league');
  if (sport === 'soccer' && league != null && !LEAGUES.has(league)) {
    return NextResponse.json({ error: `Unknown league. Expected one of: ${[...LEAGUES].join(', ')}` }, { status: 400 });
  }
  const tour = url.searchParams.get('tour');
  if (sport === 'tennis' && tour != null && !TOURS.has(tour)) {
    return NextResponse.json({ error: `Unknown tour. Expected one of: ${[...TOURS].join(', ')}` }, { status: 400 });
  }

  const date = parseDate(url.searchParams.get('date'));
  if (date === undefined) return NextResponse.json({ error: 'date must be an ISO date (YYYY-MM-DD)' }, { status: 400 });

  const scope = sport === 'soccer' ? `soccer_${league ?? 'epl'}` : sport === 'tennis' ? `tennis_${tour ?? 'atp'}` : sport;

  return cachedRoute({
    cacheKey: `slate:route:${scope}:${date}`,
    ttlMs: TTL_MS,
    routeName: 'slate',
    errorMessage: 'Slate read failed',
    request,
    build: () => buildSlate(sport, league, tour, date),
  });
}
