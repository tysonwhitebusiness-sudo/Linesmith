/**
 * The game page's research data — R8. One payload shape every sport's reader
 * returns, and one page-data shape the shared `GameResearchPage` renders
 * without knowing the sport. The team-page counterpart is
 * `teamResearchShapes.ts`; sections are the same `ResearchSection`s.
 *
 * THREE STATES, FROM THE GAME'S REAL STATUS (plan R8). A game before its start
 * shows research as of kickoff; a live game opens on "Right now"; a final game
 * opens on the recap with the kickoff research kept below. `?state=` only
 * overrides for review, and only to a state the data can support.
 *
 * Database-free, so client code may import it.
 */

import type { ResearchSection } from './playerResearchShapes';

export type GameState = 'pre' | 'live' | 'final' | 'postponed';

export interface GameSide {
  id: string;
  name: string;
  abbr: string;
  logoUrl: string | null;
  href: string | null;
  /** Runs, goals or points; `null` before the start. */
  score: number | null;
  /** "66-85", as entering this game where the source says so. */
  record: string | null;
}

export interface GameHeaderPeriodTable {
  /** Column labels: innings, quarters, periods… */
  periods: string[];
  /** Totals columns after the periods ("R", "H", "E"). */
  totals: string[];
  away: Array<number | string | null>;
  home: Array<number | string | null>;
}

export interface GameResearchPayload {
  sport: string;
  gameId: string;
  state: GameState;
  /** The source's own words: "Final", "Top 7th", "Postponed". */
  statusText: string;
  /** ISO start time. */
  start: string;
  venue: string | null;
  /** "72°F Clear, wind 5 mph L to R". */
  conditions: string | null;
  away: GameSide;
  home: GameSide;
  /** The line score, where the sport has one and the game has begun. */
  lineScore: GameHeaderPeriodTable | null;
  /** Short facts under the score: "W Lugo · L Gray · SV Cruz", "Probable: Lugo vs Gray". */
  notes: string[];
  sources: Array<{ label: string; detail: string; asOf: string | null }>;
  fetchedAt: string;
}

export interface GameResearchData {
  state: GameState;
  /** The states this game can show, for the review switch. */
  states: GameState[];
  hero: {
    away: GameSide;
    home: GameSide;
    statusText: string;
    /** "Tue, Sep 16, 7:10 PM ET". */
    when: string;
    place: string | null;
    lineScore: GameHeaderPeriodTable | null;
    notes: string[];
    /** Closing-line and result chips: "KC +1.5 covered", "Total 8.5 over". */
    chips: Array<{ label: string; tone?: 'good' | 'bad' | null }>;
  };
  /** A sentence under the state bar saying what the sections below are drawn from. */
  stateNote: string;
  sections: ResearchSection[];
  sources: GameResearchPayload['sources'];
}
