/**
 * The Slate's Model section (S5): today's locked game picks, and nothing the
 * display rule does not allow.
 *
 * MLB's game model has not cleared its own gate (queue Q0: its picks sit below
 * the closing price on 305 matched picks). Under M1's rule that means the
 * Slate may show the PICK and the price it was taken at, and may NOT show a
 * probability, a confidence grade, a stake or a record. This shape is where
 * that is enforced: the fields do not exist, so no component can render them,
 * and `/api/slate/model` never puts a probability on the wire.
 *
 * PYTHON WRITES, TYPESCRIPT RENDERS. `game_picks` is written by the capture
 * job; this reads it.
 */

import type { GamePickRow } from '../db/client';
import { easternDate } from '../sports/mlb/statsapi';

export interface ModelPickRow {
  gameId: string;
  matchup: string;
  startsAt: string | null;
  /** The team the moneyline pick is on. */
  moneyline: { team: string; price: number | null } | null;
  /** "Under 8" — side and line. */
  total: { side: 'over' | 'under'; line: number; price: number | null } | null;
  /** Locked at first pitch; until then the pick can still move. */
  locked: boolean;
  /** C4: the two team marks, for the game cell. */
  awayLogoUrl: string | null;
  homeLogoUrl: string | null;
}

export interface ModelPicksData {
  sport: string;
  date: string;
  rows: ModelPickRow[];
  fetchedAt: string;
}

function teamName(row: GamePickRow, side: 'home' | 'away' | null): string | null {
  if (side === 'home') return row.homeTeamName;
  if (side === 'away') return row.awayTeamName;
  return null;
}

/** MLB's team mark, from the numeric team id `game_picks` already holds. */
function mlbTeamLogo(teamId: number | null | undefined): string | null {
  return teamId != null ? `https://www.mlbstatic.com/team-logos/${teamId}.svg` : null;
}

/** Pure: the day's rows from `game_picks`, reduced to what may be shown. */
export function toModelPicks(rows: GamePickRow[], date: string): ModelPickRow[] {
  return rows
    .filter((r) => r.commenceTime != null && easternDate(new Date(r.commenceTime)) === date)
    .map((r) => {
      const mlSide = r.mlFinalSide ?? r.mlInitialSide;
      const mlTeam = teamName(r, mlSide);
      const totalSide = r.totalFinalSide ?? r.totalInitialSide;
      const totalLine = r.totalFinalLine ?? r.totalInitialLine;
      return {
        gameId: String(r.gameId),
        matchup: r.matchup ?? [r.awayTeamName, r.homeTeamName].filter(Boolean).join(' @ '),
        // The driver hands back a `Date` whatever the row type says; the
        // first render sorted on it and threw. Normalised to ISO here.
        startsAt: new Date(r.commenceTime as unknown as string | Date).toISOString(),
        moneyline: mlTeam ? { team: mlTeam, price: r.mlFinalPrice ?? r.mlInitialPrice } : null,
        total: totalSide && totalLine != null ? { side: totalSide, line: totalLine, price: r.totalFinalPrice ?? r.totalInitialPrice } : null,
        locked: r.mlFinalCapturedAt != null || r.totalFinalCapturedAt != null,
        awayLogoUrl: mlbTeamLogo(r.awayTeamId),
        homeLogoUrl: mlbTeamLogo(r.homeTeamId),
      };
    })
    .filter((r) => r.moneyline != null || r.total != null)
    .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''));
}
