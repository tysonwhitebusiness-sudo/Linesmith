/**
 * A franchise's record season by season, and two franchises' meetings — R12a.
 * Pure (no database), so the route builds it server-side and the pages import
 * only the types: a franchise's whole MLB history is ~2,600 games, which is a
 * summary's job, not a payload's.
 *
 * The rows come from `readGameResults` (R2's merge plus R12a's deep-history
 * rules), so each is one real game with its season and phase already placed.
 */

import { seasonForDate } from '@/lib/sports/shared/season';
import type { GameResultRow } from './gameResults';

export interface WinLoss {
  w: number;
  l: number;
  /** Draws (soccer) and MLB/NFL ties. */
  d: number;
}

export interface SeasonRecord {
  season: number;
  /** Regular season only; playoffs are counted apart, as leagues count them. */
  regular: WinLoss;
  home: WinLoss;
  away: WinLoss;
  /** null when the team did not play a postseason game that season. */
  post: WinLoss | null;
  /** Regular-season points (runs, goals) for and against. */
  pointsFor: number;
  pointsAgainst: number;
}

export interface TeamHistory {
  sport: string;
  teamId: string;
  /** Newest first. */
  seasons: SeasonRecord[];
  allTime: { regular: WinLoss; post: WinLoss; seasons: number };
}

export interface Meeting {
  date: string;
  season: number;
  playoff: boolean;
  /** Which side was at home: 'a' is the team asked about, 'b' the opponent. */
  home: 'a' | 'b';
  aScore: number;
  bScore: number;
}

export interface HeadToHead {
  sport: string;
  a: string;
  b: string;
  /** Newest first. */
  meetings: Meeting[];
  /** From team a's side: all meetings, and split by where they were played. */
  record: WinLoss;
  atHome: WinLoss;
  away: WinLoss;
  playoffs: WinLoss;
  firstSeason: number | null;
}

const empty = (): WinLoss => ({ w: 0, l: 0, d: 0 });
const add = (r: WinLoss, us: number, them: number) => (us > them ? r.w++ : us < them ? r.l++ : r.d++);

/** The row's season: the window's label where one placed it, else the sport's own convention (soccer). */
function seasonOf(row: GameResultRow): number {
  return row.season ?? seasonForDate(row.sport, new Date(`${row.gameDate}T12:00:00Z`));
}

export function buildTeamHistory(sport: string, teamId: string, rows: GameResultRow[]): TeamHistory {
  const bySeason = new Map<number, SeasonRecord>();
  for (const r of rows) {
    const home = r.homeTeamId === teamId;
    if (!home && r.awayTeamId !== teamId) continue;
    const season = seasonOf(r);
    const rec = bySeason.get(season) ?? { season, regular: empty(), home: empty(), away: empty(), post: null, pointsFor: 0, pointsAgainst: 0 };
    const us = home ? r.homeScore : r.awayScore;
    const them = home ? r.awayScore : r.homeScore;
    if (r.phase === 'post') {
      rec.post ??= empty();
      add(rec.post, us, them);
    } else {
      add(rec.regular, us, them);
      add(home ? rec.home : rec.away, us, them);
      rec.pointsFor += us;
      rec.pointsAgainst += them;
    }
    bySeason.set(season, rec);
  }
  const seasons = [...bySeason.values()].sort((a, b) => b.season - a.season);
  const allTime = { regular: empty(), post: empty(), seasons: seasons.length };
  for (const s of seasons) {
    for (const k of ['w', 'l', 'd'] as const) {
      allTime.regular[k] += s.regular[k];
      if (s.post) allTime.post[k] += s.post[k];
    }
  }
  return { sport, teamId, seasons, allTime };
}

export function buildHeadToHead(sport: string, a: string, b: string, rows: GameResultRow[]): HeadToHead {
  const meetings: Meeting[] = [];
  const record = empty();
  const atHome = empty();
  const away = empty();
  const playoffs = empty();
  for (const r of rows) {
    const aHome = r.homeTeamId === a && r.awayTeamId === b;
    if (!aHome && !(r.homeTeamId === b && r.awayTeamId === a)) continue;
    const aScore = aHome ? r.homeScore : r.awayScore;
    const bScore = aHome ? r.awayScore : r.homeScore;
    const playoff = r.phase === 'post';
    meetings.push({ date: r.gameDate, season: seasonOf(r), playoff, home: aHome ? 'a' : 'b', aScore, bScore });
    add(record, aScore, bScore);
    add(aHome ? atHome : away, aScore, bScore);
    if (playoff) add(playoffs, aScore, bScore);
  }
  meetings.sort((x, y) => y.date.localeCompare(x.date));
  return { sport, a, b, meetings, record, atHome, away, playoffs, firstSeason: meetings.length ? meetings[meetings.length - 1].season : null };
}
