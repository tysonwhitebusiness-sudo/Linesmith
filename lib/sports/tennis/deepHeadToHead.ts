/**
 * Tennis head to head before 2024 — R12e. Server-only (reads Postgres).
 *
 * The match page's own head to head reads `player_game_history`, by ESPN id,
 * which starts in January 2024. `game_result`'s `tennis_data` rows go back to
 * 2015 but carry NAMES ONLY, in tennis-data.co.uk's form: "Zverev A.",
 * "Auger-Aliassime F.", "Lee C.Y.", and — where two players would collide —
 * a longer form the source already chose ("Pliskova Kr." / "Pliskova Ka.",
 * "Wang Xiyu" / "Wang Xin."). Measured 2026-09-19: 818 of 867 ATP and 826 of
 * 906 WTA names are "Surname I.".
 *
 * A NAME IS NOT TRUSTED UNTIL THE DATES AGREE. A raw name is matched to a
 * player's full name (every surname/given split, either order), then VERIFIED:
 * of that name's rows since 2024, at least 80% must fall within three days of
 * one of the player's own matches in `player_game_history`. Another player
 * sharing the name would add rows on days this one did not play and fail the
 * check — the same "name and game date" test the tennis crosswalk uses. An
 * unverified player gets no deep history and the page says why; a wrong
 * meeting is worse than a missing one.
 *
 * NO MEETING IS COUNTED TWICE: only rows before 2024-01-01 are read, and the
 * page's own list starts in 2024.
 */

import { pgAll } from '@/lib/db/pgClient';
import type { TennisTourSport } from './gameResearch';

export const DEEP_H2H_BEFORE = '2024-01-01';
const VERIFY_FROM = '2024-01-01';
const MIN_SHARE = 0.8;
const MIN_ROWS = 3;

export interface TennisDeepMeeting {
  date: string;
  tournament: string;
  round: string | null;
  surface: string | null;
  /** Did the page's AWAY player win. */
  awayWon: boolean;
  /** Sets, winner first as the source lists them ("2–0"). */
  sets: string;
}

export interface TennisDeepHeadToHead {
  /** 'ok' when both players' names verified; otherwise why not. */
  status: 'ok' | 'unverified';
  reason: string | null;
  meetings: TennisDeepMeeting[];
}

/** Lowercase, accents off, hyphens and dots to spaces. */
export function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-.'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Auger-Aliassime F." -> { surname: 'auger aliassime', initials: 'f' }; "Wang Xiyu" -> initials 'xiyu'. */
export function parseRaw(raw: string): { surname: string; initials: string } | null {
  const tokens = raw.trim().split(/\s+/);
  if (tokens.length < 2) return null;
  const last = tokens[tokens.length - 1];
  const letters = last.replace(/[^A-Za-z]/g, '').toLowerCase();
  if (!letters) return null;
  return { surname: normName(tokens.slice(0, -1).join(' ')), initials: letters };
}

function initialsMatch(given: string[], initials: string): boolean {
  const first = given[0] ?? '';
  const parts = given.join(' ').split(' ').filter(Boolean);
  const ofParts = parts.map((p) => p[0]).join('');
  return first.startsWith(initials) || ofParts === initials || (initials.length === 1 && ofParts.startsWith(initials));
}

/** Does this raw name fit this full name, in either name order? */
export function nameFits(fullName: string, raw: string): boolean {
  const p = parseRaw(raw);
  if (!p) return false;
  const tokens = normName(fullName).split(' ').filter(Boolean);
  for (let i = 1; i < tokens.length; i++) {
    const western = { given: tokens.slice(0, i), surname: tokens.slice(i).join(' ') };
    const eastern = { given: tokens.slice(i), surname: tokens.slice(0, i).join(' ') };
    for (const c of [western, eastern]) if (c.surname === p.surname && initialsMatch(c.given, p.initials)) return true;
  }
  return false;
}

const rawCache = new Map<string, { at: number; raws: string[] }>();

async function rawNames(sport: TennisTourSport): Promise<string[]> {
  const hit = rawCache.get(sport);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.raws;
  const rows = await pgAll<{ n: string }>(
    `SELECT DISTINCT n FROM (SELECT home_team_raw AS n FROM game_result WHERE sport = ? AND source = 'tennis_data'
                             UNION SELECT away_team_raw FROM game_result WHERE sport = ? AND source = 'tennis_data') x`,
    [sport, sport],
  );
  const raws = rows.map((r) => r.n);
  rawCache.set(sport, { at: Date.now(), raws });
  return raws;
}

const days = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/** The raw names that are this player, verified by dates; null when none verifies (or two do and disagree). */
async function verifiedRaws(sport: TennisTourSport, athleteId: string, fullName: string): Promise<string[] | null> {
  const candidates = (await rawNames(sport)).filter((r) => nameFits(fullName, r));
  if (!candidates.length) return null;
  const [history, rows] = await Promise.all([
    pgAll<{ d: string }>(`SELECT game_date::text AS d FROM player_game_history WHERE sport = ? AND athlete_id = ? AND game_date >= ?`, [sport, athleteId.replace(/^espn:tennis:/, ''), VERIFY_FROM]),
    pgAll<{ d: string; h: string; a: string }>(
      `SELECT game_date::text AS d, home_team_raw AS h, away_team_raw AS a FROM game_result
        WHERE sport = ? AND source = 'tennis_data' AND game_date >= ? AND (home_team_raw = ANY(?) OR away_team_raw = ANY(?))`,
      [sport, VERIFY_FROM, candidates, candidates],
    ),
  ]);
  const played = history.map((h) => h.d);
  // Each candidate's own share of rows on this player's dates.
  const keys = new Set(candidates.map((c) => JSON.stringify(parseRaw(c))));
  const verifiedKeys = [...keys].filter((key) => {
    const mine = rows.filter((r) => [r.h, r.a].some((n) => candidates.includes(n) && JSON.stringify(parseRaw(n)) === key));
    if (mine.length < MIN_ROWS) return false;
    const onHisDays = mine.filter((r) => played.some((d) => days(d, r.d) <= 3)).length;
    return onHisDays / mine.length >= MIN_SHARE;
  });
  // Two different verified name forms would mean the match itself is unsure.
  if (verifiedKeys.length !== 1) return null;
  return candidates.filter((c) => JSON.stringify(parseRaw(c)) === verifiedKeys[0]);
}

export async function readTennisDeepHeadToHead(
  sport: TennisTourSport,
  away: { id: string; name: string },
  home: { id: string; name: string },
): Promise<TennisDeepHeadToHead> {
  const [a, h] = await Promise.all([verifiedRaws(sport, away.id, away.name), verifiedRaws(sport, home.id, home.name)]);
  const missing = [!a ? away.name : null, !h ? home.name : null].filter(Boolean);
  if (!a || !h) {
    return { status: 'unverified', reason: `Meetings before 2024 are matched by name, and ${missing.join(' and ')} could not be confirmed against ${missing.length > 1 ? 'their' : 'the player’s'} own match dates.`, meetings: [] };
  }
  const rows = await pgAll<{ d: string; h: string; a: string; hs: number; as: number; ref: string | null; surface: string | null; venue: string | null }>(
    `SELECT game_date::text AS d, home_team_raw AS h, away_team_raw AS a, home_score AS hs, away_score AS "as", event_ref AS ref, surface, venue
       FROM game_result
      WHERE sport = ? AND source = 'tennis_data' AND game_date < ?
        AND ((home_team_raw = ANY(?) AND away_team_raw = ANY(?)) OR (home_team_raw = ANY(?) AND away_team_raw = ANY(?)))
      ORDER BY game_date DESC`,
    [sport, DEEP_H2H_BEFORE, a, h, h, a],
  );
  const meetings = rows.map((r) => {
    // event_ref: "tennis_atp|date|tournament|round|p1|p2".
    const parts = (r.ref ?? '').split('|');
    const homeWon = r.hs >= r.as;
    const awayIsHome = a.includes(r.h);
    return {
      date: r.d,
      tournament: parts[2] || r.venue || '',
      round: parts[3] || null,
      surface: r.surface,
      awayWon: awayIsHome ? homeWon : !homeWon,
      sets: `${Math.max(r.hs, r.as)}–${Math.min(r.hs, r.as)}`,
    };
  });
  return { status: 'ok', reason: null, meetings };
}
