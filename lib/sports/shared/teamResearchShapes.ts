/**
 * The team page's research data — R7. The team-page counterpart of
 * `playerResearchShapes.ts`: one payload shape every sport's reader returns,
 * one spec per sport saying how to read it, and one page-data shape the shared
 * `TeamResearchPage` renders without knowing the sport.
 *
 * Database-free, so client code may import it.
 *
 * WHERE THE RESULTS COME FROM (R7-C1, measured 2026-09-16). Not `game_result`:
 * it has no season type and no overtime flag, mixes preseason and postseason
 * into the season (Maple Leafs 2025-26: 84 games 32-52 against the league's 82
 * games 32-36-14; Lakers 92 games against 82 plus ten playoff games) and misses
 * MLB games (Royals 2026: 148 against 151, R6-F5). Each sport's reader reads
 * its league's own schedule, regular season and postseason kept apart.
 */

import type { ResearchColumn, ResearchSection, ResearchTile } from './playerResearchShapes';

export interface TeamRef {
  id: string;
  name: string;
  abbr: string;
  logoUrl: string | null;
}

/** One game on a team's schedule, from the team's side. */
export interface TeamGame {
  id: string;
  /** ISO start time. */
  start: string;
  /** The league's own date for the game (a night game is not dated by UTC). */
  date: string;
  home: boolean;
  opponent: TeamRef;
  us: number | null;
  them: number | null;
  state: 'final' | 'live' | 'scheduled' | 'postponed';
  /**
   * Decided past regulation: NHL's OT or SO (a loss there is an OTL, not an L),
   * extra innings in MLB ("F/10"). `null` in regulation or where the sport has
   * no such thing.
   */
  extra: string | null;
  postseason: boolean;
  /** "Wild Card Game 2", "Week 3" — shown beside the date. */
  label: string | null;
  venue: string | null;
  /** The opponent's poll rank at kickoff (college). */
  opponentRank: number | null;
  /** A page for this game, where one exists. Past MLB and NFL games have none until R8. */
  href: string | null;
}

export interface TeamStandingsTable {
  /** "American League Central". */
  title: string;
  columns: ResearchColumn[];
  rows: Array<{ team: TeamRef; href: string | null; values: Record<string, number | string | null> }>;
}

/**
 * One team stat with every team's value, so the rank is computed here across
 * the league's real teams with a declared direction (R2), never taken from a
 * source's own rank.
 */
export interface TeamStatValue {
  key: string;
  /** The card it sits on ("Hitting", "Pitching"). */
  group: string;
  label: string;
  value: number;
  /** Every team's value, this team included. */
  league: number[];
  direction: 'higher' | 'lower';
  decimals: number;
  format?: ResearchColumn['format'];
  info?: string;
}

export interface TeamRosterEntry {
  id: string;
  name: string;
  position: string | null;
  headshotUrl: string | null;
  href: string | null;
  games: number;
  /** Production score for the season (R5b), what the roster is ordered by. */
  score: number;
  stats: Record<string, number>;
}

export interface TeamSeasonData {
  season: number;
  /** Regular season and postseason, in date order. */
  games: TeamGame[];
  /** Grouped as the league publishes them; the team's own group first. */
  standings: TeamStandingsTable[];
  stats: TeamStatValue[];
  roster: TeamRosterEntry[];
}

export interface TeamResearchSource {
  label: string;
  detail: string;
  asOf: string | null;
}

/** What `/api/team-research` returns, for every sport. */
export interface TeamResearchPayload {
  sport: string;
  team: TeamRef & { venue: string | null; color: string | null };
  /** The season `seasonForDate` names today, whether or not it has games. */
  currentSeason: number;
  /** Newest first. */
  seasons: TeamSeasonData[];
  sources: TeamResearchSource[];
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// A sport's spec
// ---------------------------------------------------------------------------

export interface TeamRosterGroupSpec {
  key: string;
  label: string;
  include: (e: TeamRosterEntry) => boolean;
  /** The column the table opens sorted by. */
  sortKey: string;
  columns: Array<ResearchColumn & { value: (e: TeamRosterEntry) => number | null }>;
}

export interface TeamResearchSpec {
  /** The `season.ts` sport key. */
  seasonSport: string;
  /** W-L, W-D-L (soccer) or W-L-OTL (hockey). */
  record: 'WL' | 'WDL' | 'WLOTL';
  unit: { plural: string; short: string };
  diffLabel: string;
  /** A game decided by this much or less is "close". */
  closeMargin: number;
  roster: { groups: TeamRosterGroupSpec[]; caption?: string };
  /** Stat card captions keyed by group, stating what a source does not hold. */
  statCaptions?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export interface TeamResearchData {
  team: TeamResearchPayload['team'];
  scope: {
    season: number;
    label: string;
    /** Why the page opened on last season, when it did. */
    reason: string | null;
    options: Array<{ value: number; label: string }>;
  };
  hero: {
    record: string;
    recordShape: string;
    /** "5th in AL Central" — current season only; a past season shows its final record instead. */
    standing: string | null;
    lastTen: Array<{ result: 'W' | 'L' | 'D' | 'OTL'; tip: string }>;
    next: { label: string; when: string; opponent: TeamRef; href: string | null } | null;
    tiles: ResearchTile[];
  };
  sections: ResearchSection[];
  sources: TeamResearchSource[];
}
