/**
 * The tennis match page read — R8.3b, ATP and WTA singles. One
 * `GameResearchPayload` for any match by ESPN competition id.
 *
 * - the match (players, status, round, set scores with tiebreak points): ESPN's
 *   scoreboard. MEASURED 2026-09-17: ESPN has NO tennis summary (every
 *   `summary?event=` form returns 400), and the old page searched the scoreboard
 *   only from 21 days back, so an older match never resolved. The match date
 *   now comes from `player_game_history` (keyed by the same id), and the
 *   scoreboard is read for that day (single days: see `findCompetition`).
 * - serve and return stats: the TennisMyLife archive, matched by player names
 *   and date. It lags (both tours end 2026-08-30 as measured), so a recent
 *   match says it is not in the archive yet.
 * - form and head to head: `player_game_history` (sets and games per match),
 *   opponent names from ESPN's athlete endpoint.
 * - lines: `game_odds_history` moneylines (tennis has no pickcenter); props
 *   (aces, games won, to win a set) at the main line or yes price at the start.
 *
 * R8.3b-F1: the history writers stored joint-event matches under both tours,
 * and doubles pairs as athletes, until 2026-09-17 (now filtered to the tour's
 * singles draw). Every read here keys on athlete ids and the page's own tour,
 * so the copies never changed this page.
 *
 * Server-only: reads Postgres.
 */

import { pgAll } from '@/lib/db/pgClient';
import { readPreGamePropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import { readInGameLines, readPreGameOpenClose, type GameLineOpenClose, type InGameLines } from '@/lib/odds/gameLineHistory';
import { gameMainLines } from '@/lib/odds/props/gameProps';
import { normalizeName } from '@/lib/odds/screenshotImport';
import { loadTennisSeasonContext, matchTennisIndex, type TennisMatch } from './tennismylife';
import { readPropHistory } from '@/lib/sports/shared/gamePregameServer';
import type { GameResearchPayload, GameSide, GameState } from '@/lib/sports/shared/gameResearchShapes';
import { seasonForDate } from '@/lib/sports/shared/season';

export type TennisTourSport = 'tennis_atp' | 'tennis_wta';
type Tour = 'atp' | 'wta';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
const SINGLES_SLUG: Record<Tour, string> = { atp: 'mens-singles', wta: 'womens-singles' };
const tourOf = (sport: TennisTourSport): Tour => (sport === 'tennis_wta' ? 'wta' : 'atp');

export interface TennisSet {
  away: number | null;
  home: number | null;
  /** Tiebreak points, where the set went to one. */
  awayTiebreak: number | null;
  homeTiebreak: number | null;
  /**
   * Who won the set, from ESPN's own `winner` flag; `null` while it is being played.
   * MEASURED 2026-09-17 on Samsonova v Day (183799), live in the second set at
   * 0-1: comparing games counted that set for Day and showed 1-1 in sets.
   */
  winner: 'away' | 'home' | null;
}

export interface TennisFormRow {
  eventId: string;
  date: string;
  opponentId: string;
  opponentName: string | null;
  won: boolean;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
}

export interface TennisArchiveMatch {
  surface: string | null;
  level: string | null;
  bestOf: number | null;
  minutes: number | null;
  /** The two players' rows, away then home, as the archive holds them. */
  away: Pick<TennisMatch, 'rank' | 'seed' | 'serve' | 'opponentServe'>;
  home: Pick<TennisMatch, 'rank' | 'seed' | 'serve' | 'opponentServe'>;
}

export interface TennisSurfaceRecord {
  surface: string;
  won: number;
  lost: number;
  /** Per-match averages on this surface, this season and last, before this match. */
  aces: number | null;
  firstInPct: number | null;
  firstWonPct: number | null;
  returnWonPct: number | null;
}

export interface TennisPropResult {
  athleteId: string;
  name: string;
  market: string;
  line: number | null;
  over: { price: number; book: string };
  under: { price: number; book: string } | null;
  books: number;
  side: 'away' | 'home' | null;
  result: number | null;
}

export interface TennisGameResearchPayload extends GameResearchPayload {
  tennis: {
    tour: Tour;
    tournament: string;
    round: string | null;
    sets: TennisSet[];
    resultNote: string | null;
    archive: TennisArchiveMatch | null;
    /** The archive's newest match date, for "not in the archive yet". */
    archiveThrough: string | null;
    surface: Record<string, TennisSurfaceRecord | null>;
    form: Record<string, TennisFormRow[]>;
    h2h: TennisFormRow[];
    storedLines: GameLineOpenClose[];
    props: TennisPropResult[];
    propsAltOnly: number;
    propHistory: Record<string, Array<[string, number, string]>>;
    live: { inGame: InGameLines } | null;
  };
}

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Competition {
  tournament: string;
  comp: J;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const compCache = new Map<string, { at: number; value: Competition | null }>();

/**
 * One singles match off ESPN's scoreboard. MEASURED 2026-09-17: the scoreboard
 * returns NOTHING for a short past range (`dates=20260817-20260821`: 0 events)
 * but 131 singles matches for either single day inside it, so this reads single
 * days: the match's date from the game logs and the days around it, else today
 * and the week around it for a match the logs do not hold yet. Cached 15 seconds.
 */
async function findCompetition(tour: Tour, matchId: string): Promise<Competition | null> {
  const key = `${tour}:${matchId}`;
  const hit = compCache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.value;
  const known = await pgAll<{ d: string }>(`SELECT game_date::text AS d FROM player_game_history WHERE sport LIKE 'tennis%' AND event_id = ? LIMIT 1`, [matchId]).catch(() => []);
  const day = (base: number, offset: number) => ymd(new Date(base + offset * 86_400_000));
  const days = known[0] ? [0, 1, -1].map((o) => day(Date.parse(known[0].d), o)) : [0, -1, 1, -2, 2, 3, 4, 5, 6, 7].map((o) => day(Date.now(), o));
  let value: Competition | null = null;
  let answered = 0;
  for (const d of days) {
    const res = await fetch(`${BASE}/${tour}/scoreboard?dates=${d}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!res?.ok) continue;
    answered++;
    const json = (await res.json()) as J;
    for (const ev of json.events ?? []) {
      for (const g of ev.groupings ?? []) {
        if (g.grouping?.slug !== SINGLES_SLUG[tour]) continue;
        const comp = (g.competitions ?? []).find((c: J) => String(c.id) === matchId);
        if (comp) value = { tournament: String(ev.name ?? ''), comp };
      }
    }
    if (value) break;
  }
  // R12d: not one scoreboard answered, so the match is not "not found" — ESPN
  // did not answer. Throw (the route says "couldn't load") and cache nothing,
  // so the next request tries again.
  if (!value && answered === 0) throw new Error(`ESPN ${tour} scoreboard unavailable for match ${matchId}`);
  compCache.set(key, { at: Date.now(), value });
  return value;
}

export function tennisGameState(comp: J): GameState | null {
  const type = comp?.status?.type;
  if (!type) return null;
  if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED/.test(String(type.name ?? ''))) return 'postponed';
  if (type.state === 'post' || type.completed === true) return 'final';
  if (type.state === 'in') return 'live';
  return 'pre';
}

export async function tennisStateOf(sport: TennisTourSport, matchId: string): Promise<GameState | null> {
  // The route's TTL lookup: an unanswered scoreboard means "state unknown", not an error.
  const found = await findCompetition(tourOf(sport), matchId).catch(() => null);
  return found ? tennisGameState(found.comp) : null;
}

/** Set scores with tiebreak points, from both competitors' `linescores`. */
export function tennisSets(comp: J): TennisSet[] {
  const away = (comp?.competitors ?? []).find((c: J) => c.homeAway === 'away');
  const home = (comp?.competitors ?? []).find((c: J) => c.homeAway === 'home');
  const n = Math.max(away?.linescores?.length ?? 0, home?.linescores?.length ?? 0);
  const v = (x: unknown) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));
  return Array.from({ length: n }, (_, i) => ({
    away: v(away?.linescores?.[i]?.value),
    home: v(home?.linescores?.[i]?.value),
    awayTiebreak: v(away?.linescores?.[i]?.tiebreak),
    homeTiebreak: v(home?.linescores?.[i]?.tiebreak),
    winner: away?.linescores?.[i]?.winner === true ? 'away' : home?.linescores?.[i]?.winner === true ? 'home' : null,
  }));
}

/** A prop market's number from the set scores (games won, to win a set) or the archive row (aces). */
export function tennisMarketValue(market: string, sets: TennisSet[], side: 'away' | 'home', archiveServeAces: number | null): number | null {
  const mine = sets.map((s) => (side === 'away' ? s.away : s.home));
  switch (market) {
    case 'games-won': return mine.reduce<number>((a, g) => a + (g ?? 0), 0);
    // A set counts once ESPN has flagged its winner, never on a lead in the set being played.
    case 'to-win-a-set': return sets.some((s) => s.winner === side) ? 1 : 0;
    case 'aces': return archiveServeAces;
    default: return null;
  }
}

/** A game-log row's number for prop history. The logs hold scores, not serve stats, so aces have no history here. */
export function tennisLogValue(market: string, s: Record<string, unknown>): number | null {
  const z = (k: string) => (s[k] == null || !Number.isFinite(Number(s[k])) ? 0 : Number(s[k]));
  if (market === 'games-won') return z('games_won');
  if (market === 'to-win-a-set') return z('sets_won') > 0 ? 1 : 0;
  return null;
}

const nameCache = new Map<string, string>();
async function athleteNames(tour: Tour, ids: string[]): Promise<Map<string, string>> {
  const missing = [...new Set(ids)].filter((id) => !nameCache.has(`${tour}:${id}`));
  for (let i = 0; i < missing.length; i += 8) {
    await Promise.all(
      missing.slice(i, i + 8).map(async (id) => {
        try {
          const res = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/tennis/${tour}/athletes/${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
          const name = res.ok ? ((await res.json()) as J)?.athlete?.displayName : null;
          if (name) nameCache.set(`${tour}:${id}`, String(name));
        } catch {
          // Unnamed: the row shows the result without the opponent.
        }
      }),
    );
  }
  return new Map(ids.map((id) => [id, nameCache.get(`${tour}:${id}`) ?? '']));
}

async function readForm(sport: TennisTourSport, athleteIds: string[], before: string): Promise<{ form: Record<string, TennisFormRow[]>; h2h: TennisFormRow[] }> {
  const rows = await pgAll<{ athlete_id: string; event_id: string; game_date: string; opponent_id: string | null; stats: unknown }>(
    `SELECT athlete_id, event_id, game_date::text AS game_date, opponent_id, stats FROM player_game_history
      WHERE sport = ? AND athlete_id = ANY(?) AND game_date < ? ORDER BY game_date`,
    [sport, athleteIds, before],
  );
  const toRow = (r: (typeof rows)[number]): TennisFormRow => {
    const s = (typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats) as Record<string, number>;
    return { eventId: String(r.event_id), date: r.game_date, opponentId: String(r.opponent_id ?? ''), opponentName: null, won: s.match_won === 1, setsWon: s.sets_won ?? 0, setsLost: s.sets_lost ?? 0, gamesWon: s.games_won ?? 0, gamesLost: s.games_lost ?? 0 };
  };
  const [a, h] = athleteIds;
  const form = Object.fromEntries(athleteIds.map((id) => [id, rows.filter((r) => String(r.athlete_id) === id).map(toRow).slice(-10)]));
  const h2h = rows.filter((r) => String(r.athlete_id) === a && String(r.opponent_id) === h).map(toRow);
  const names = await athleteNames(sport === 'tennis_wta' ? 'wta' : 'atp', [...Object.values(form).flat(), ...h2h].map((r) => r.opponentId));
  for (const r of [...Object.values(form).flat(), ...h2h]) r.opponentName = names.get(r.opponentId) || null;
  return { form, h2h };
}

const pct = (x: number | null | undefined, y: number | null | undefined) => (x == null || !y ? null : (100 * x) / y);
const mean = (xs: Array<number | null>) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** The archive's row for this match, and each player's record and serve averages on its surface before it. */
async function readArchive(tour: Tour, season: number, start: string, away: { name: string }, home: { name: string }) {
  const ctx = await loadTennisSeasonContext(tour, season).catch(() => null);
  if (!ctx) return { archive: null, through: null, surface: {} as Record<string, TennisSurfaceRecord | null>, awayMatches: [], homeMatches: [] };
  const through = [...ctx.byName.values()].flatMap((e) => e.matches.map((m) => m.date.slice(0, 10))).sort().at(-1) ?? null;
  const awayMatches = matchTennisIndex(ctx, away.name) ?? [];
  const homeMatches = matchTennisIndex(ctx, home.name) ?? [];
  const day = start.slice(0, 10);
  // The archive's date is not ESPN's start: Paul v Zverev started 2026-08-19 18:00 UTC on ESPN and is dated
  // 2026-08-20 in the archive (G2's fixture). So the nearest meeting within a fortnight either side.
  const gap = (m: TennisMatch) => Math.abs(Date.parse(day) - Date.parse(m.date.slice(0, 10)));
  const meeting = (matches: TennisMatch[], opponent: string) =>
    matches.filter((m) => gap(m) <= 14 * 86_400_000 && normalizeName(m.opponent) === normalizeName(opponent)).sort((x, y) => gap(x) - gap(y))[0] ?? null;
  const a = meeting(awayMatches, home.name);
  const h = meeting(homeMatches, away.name);
  const archive: TennisArchiveMatch | null =
    a && h ? { surface: a.surface || null, level: a.level, bestOf: a.bestOf, minutes: a.minutes, away: { rank: a.rank, seed: a.seed, serve: a.serve, opponentServe: a.opponentServe }, home: { rank: h.rank, seed: h.seed, serve: h.serve, opponentServe: h.opponentServe } } : null;
  const surfaceName = archive?.surface ?? (a ?? h)?.surface ?? null;
  const record = (matches: TennisMatch[]): TennisSurfaceRecord | null => {
    if (!surfaceName) return null;
    const prior = matches.filter((m) => m.surface === surfaceName && m.date.slice(0, 10) < day && m !== a && m !== h);
    if (!prior.length) return null;
    return {
      surface: surfaceName,
      won: prior.filter((m) => m.isWinner).length,
      lost: prior.filter((m) => !m.isWinner).length,
      aces: mean(prior.map((m) => m.serve?.aces ?? null)),
      firstInPct: mean(prior.map((m) => pct(m.serve?.firstIn, m.serve?.servePoints))),
      firstWonPct: mean(prior.map((m) => pct(m.serve?.firstWon, m.serve?.firstIn))),
      returnWonPct: mean(prior.map((m) => (m.opponentServe?.servePoints ? pct(m.opponentServe.servePoints - (m.opponentServe.firstWon ?? 0) - (m.opponentServe.secondWon ?? 0), m.opponentServe.servePoints) : null))),
    };
  };
  return { archive, through, surface: { away: record(awayMatches), home: record(homeMatches) }, awayMatches, homeMatches };
}

export async function readTennisGameResearch(sport: TennisTourSport, matchId: string, now: Date = new Date()): Promise<TennisGameResearchPayload | null> {
  const tour = tourOf(sport);
  const found = await findCompetition(tour, matchId);
  if (!found) return null;
  const { comp, tournament } = found;
  const state = tennisGameState(comp);
  if (!state) return null;
  const c = (homeAway: 'away' | 'home') => (comp.competitors ?? []).find((x: J) => x.homeAway === homeAway);
  const sets = tennisSets(comp);
  const setsWon = (side: 'away' | 'home') => sets.filter((s) => s.winner === side).length;
  const player = (homeAway: 'away' | 'home'): GameSide => {
    const x = c(homeAway);
    const name = String(x?.athlete?.fullName ?? x?.athlete?.displayName ?? '');
    return {
      id: String(x?.id ?? ''),
      name,
      abbr: name.split(' ').slice(-1)[0] || name,
      logoUrl: x?.athlete?.flag?.href ?? null,
      href: x?.id ? `/tennis/${tour}/player/${encodeURIComponent(`espn:tennis:${x.id}`)}` : null,
      score: state === 'pre' ? null : setsWon(homeAway),
      record: null,
    };
  };
  const away = player('away');
  const home = player('home');
  const start: string = comp.date ?? '';
  const started = state === 'live' || state === 'final';
  const season = seasonForDate(sport, new Date(start || now));
  const fetchedAt = now.toISOString();

  const [storedLines, propRows, inGame, forms, arch] = await Promise.all([
    readPreGameOpenClose(matchId, start).catch((): GameLineOpenClose[] => []),
    readPreGamePropOddsForGame(matchId, start).catch((): PropOddsRow[] => []),
    state === 'live' ? readInGameLines(matchId, start, now).catch((): InGameLines => ({ now: [], moneyline: [] })) : Promise.resolve(null),
    readForm(sport, [away.id, home.id], start.slice(0, 10)).catch(() => ({ form: {}, h2h: [] })),
    readArchive(tour, season, start, away, home),
  ]);

  const { lines, yesNo, altOnly } = gameMainLines(propRows, start, now.getTime());
  const sideOf = (athleteId: string): 'away' | 'home' | null => (athleteId === away.id ? 'away' : athleteId === home.id ? 'home' : null);
  const props: TennisPropResult[] = [
    ...lines.map((l) => ({ athleteId: l.playerId.split(':').pop() ?? l.playerId, name: l.name, market: l.market, line: l.line as number | null, over: l.over, under: l.under, books: l.books })),
    ...yesNo.map((y) => ({ athleteId: y.playerId.split(':').pop() ?? y.playerId, name: y.name, market: y.market, line: null, over: y.yes, under: null, books: y.books })),
  ].map((p) => {
    const side = sideOf(p.athleteId);
    const aces = side && arch.archive ? (arch.archive[side].serve?.aces ?? null) : null;
    return { ...p, side, result: started && side ? tennisMarketValue(p.market, sets, side, aces) : null };
  });
  const propHistory = await readPropHistory(
    sport,
    props.filter((p) => p.books >= 2).map((p) => ({ key: `${p.athleteId}|${p.market}`, athleteId: p.athleteId, market: p.market })),
    [season - 1, season],
    start.slice(0, 10),
    [away.id, home.id],
    tennisLogValue,
  ).catch(() => ({}));

  // No home side in tennis: under each name, the ranking and seed the archive holds, or nothing.
  for (const [side, g] of [['away', away], ['home', home]] as const) {
    const r = arch.archive?.[side];
    g.sideLabel = r ? [r.rank ? `No. ${r.rank}` : null, r.seed ? `seed ${r.seed}` : null].filter(Boolean).join(' · ') || null : null;
  }

  const lineScore = started && sets.length
    ? {
        periods: sets.map((_, i) => `S${i + 1}`),
        totals: ['Sets'],
        away: [...sets.map((s) => (s.awayTiebreak != null && s.away != null && s.home != null && s.away < s.home ? `${s.away}(${s.awayTiebreak})` : s.away)), away.score],
        home: [...sets.map((s) => (s.homeTiebreak != null && s.away != null && s.home != null && s.home < s.away ? `${s.home}(${s.homeTiebreak})` : s.home)), home.score],
      }
    : null;
  const note = (comp.notes ?? []).find((n: J) => n.type === 'event')?.text ?? null;

  return {
    sport,
    gameId: matchId,
    state,
    statusText: String((state === 'pre' ? comp.status?.type?.description : comp.status?.type?.detail) ?? comp.status?.type?.description ?? ''),
    start,
    venue: [tournament, comp.round?.displayName].filter(Boolean).join(' · ') || null,
    conditions: arch.archive?.surface ? `${arch.archive.surface} court` : null,
    away,
    home,
    lineScore,
    notes: [note, arch.archive?.minutes ? `${Math.floor(arch.archive.minutes / 60)}h ${arch.archive.minutes % 60}m` : null].filter((x): x is string => Boolean(x)),
    tennis: {
      tour,
      tournament,
      round: comp.round?.displayName ?? null,
      sets,
      resultNote: note,
      archive: arch.archive,
      archiveThrough: arch.through,
      surface: arch.surface,
      form: forms.form,
      h2h: forms.h2h,
      storedLines,
      props,
      propsAltOnly: altOnly,
      propHistory,
      live: state === 'live' && inGame ? { inGame } : null,
    },
    sources: [
      { label: 'Match and set scores', detail: `ESPN ${tour.toUpperCase()} scoreboard, competition ${matchId} (ESPN publishes no tennis match summary)`, asOf: fetchedAt },
      { label: 'Serve and return stats, surface records', detail: `TennisMyLife archive (Jeff Sackmann's match data), matched by name and date; it runs through ${arch.through ?? 'an unknown date'}`, asOf: fetchedAt },
      { label: 'Form and head-to-head', detail: 'player_game_history, every match before this one; opponent names from ESPN', asOf: fetchedAt },
      { label: 'Lines and props', detail: 'game_odds_history moneylines (median across books) and prop_odds as they stood at the start', asOf: fetchedAt },
      ...(state === 'live' ? [{ label: 'In-game odds', detail: 'game_odds_history after the first serve, vig removed per book', asOf: inGame?.now[0]?.asOf ?? null }] : []),
    ],
    fetchedAt,
  };
}
