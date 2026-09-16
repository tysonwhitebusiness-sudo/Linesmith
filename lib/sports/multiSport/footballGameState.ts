/**
 * C4 for football — NFL and CFB fill the shared `GameStateSlot` from the same
 * ESPN summary (`footballLiveGame.ts`), so one builder serves both (R6.2).
 *
 * MLB's `baseball` block has no football equivalent worth inventing: down and
 * distance live in `nfl/liveGameState.ts` for the hero strip and are not in
 * this response's parsed shape, so football fills score, period and the
 * player's own line, and leaves the situation field absent.
 *
 * THE BOX SCORE NAMES PLAYERS, IT DOES NOT ID THEM. ESPN's football summary
 * carries `athlete.displayName` only, so the subject's row is matched by name —
 * the same match `useLiveLineValues` already makes for these two sports. A miss
 * reads as "not in the box score yet", which is also the true state for a
 * player who has not touched the ball.
 */

import type { FootballLiveGameDetail, FootballPlayerLine } from './footballLiveGame';
import type { GameStateSlot } from '@/lib/sports/mlb/adapters/playerDetailAdapter';
import type { PickCandidate } from '@/lib/core/types';
import { directionMark, marketText } from '@/components/MarketLabel';

/** A candidate dimension to the box-score number that settles it. */
export function footballLiveValue(line: FootballPlayerLine, dimension: string): number | null {
  const map: Record<string, number | null> = {
    'passing-yards': line.passingYards,
    'passing-tds': line.passingTds,
    'interceptions-thrown': line.passingInts,
    'rushing-yards': line.rushingYards,
    'rushing-tds': line.rushingTds,
    'receiving-yards': line.receivingYards,
    'receiving-tds': line.receivingTds,
    receptions: line.receptions,
  };
  return map[dimension] ?? null;
}

/** "3-of-7, 41 yards" for a passer, "2 catches" for a receiver, "6 carries" for a back — whichever the row actually carries. */
function subjectLine(row: FootballPlayerLine): GameStateSlot['subjectLine'] {
  const facts: string[] = [];
  let headline: string | null = null;
  if (row.passingCompAtt != null || row.passingYards != null) {
    headline = `${row.passingCompAtt ?? '—'}, ${row.passingYards ?? 0} yds`;
    facts.push(`${row.passingTds ?? 0} TD`, `${row.passingInts ?? 0} INT`);
  }
  if (row.receptions != null || row.receivingYards != null) {
    const rec = `${row.receptions ?? 0} rec, ${row.receivingYards ?? 0} yds`;
    if (headline) facts.push(rec, `${row.receivingTds ?? 0} rec TD`);
    else {
      headline = rec;
      facts.push(`${row.receivingTds ?? 0} TD`);
    }
  }
  if (row.rushingYards != null || row.rushingCarries != null) {
    const rush = `${row.rushingCarries ?? 0} car, ${row.rushingYards ?? 0} yds`;
    if (headline) facts.push(rush, `${row.rushingTds ?? 0} rush TD`);
    else {
      headline = rush;
      facts.push(`${row.rushingTds ?? 0} TD`);
    }
  }
  return headline ? { headline, facts, now: null, plays: [] } : null;
}

export interface FootballGameStateInput {
  sport: 'nfl' | 'cfb';
  live: { data: FootballLiveGameDetail | null; loading: boolean };
  subjectName: string;
  candidates: PickCandidate[];
  /** The line each candidate is shown at — the main line, not the snapshot's. */
  lineFor: (c: PickCandidate) => number | null;
  /** The page's own team identity, for the score panel's logos. */
  teams: { abbr?: string; logoUrl?: string; opponentAbbr?: string; opponentLogoUrl?: string };
  /** True once the scheduled start has passed; before it there is nothing to poll. */
  started: boolean;
}

export function toFootballGameState(input: FootballGameStateInput): GameStateSlot | null {
  const live = input.live.data;
  if (!live || live.state !== 'in') {
    return input.started && input.live.loading ? { status: 'loading', away: { abbr: 'Away', score: null }, home: { abbr: 'Home', score: null }, periodLabel: null, subjectLine: null, lines: [] } : null;
  }
  const logoFor = (abbr: string) =>
    abbr === input.teams.abbr ? input.teams.logoUrl : abbr === input.teams.opponentAbbr ? input.teams.opponentLogoUrl : undefined;
  const row = Object.values(live.playersByTeam ?? {})
    .flat()
    .find((p) => p.name.toLowerCase() === input.subjectName.toLowerCase());

  return {
    status: 'live',
    away: { abbr: live.awayAbbr, logoUrl: logoFor(live.awayAbbr), score: live.awayScore },
    home: { abbr: live.homeAbbr, logoUrl: logoFor(live.homeAbbr), score: live.homeScore },
    periodLabel: live.period != null ? `Q${live.period}${live.displayClock ? ` ${live.displayClock}` : ''}` : live.statusDetail,
    subjectLine: row ? subjectLine(row) : null,
    lines: row
      ? input.candidates.flatMap((c) => {
          const value = footballLiveValue(row, c.dimension);
          const dir = directionMark(c.category);
          const at = input.lineFor(c);
          return value != null && dir !== null && at != null
            ? [{ key: `${c.dimension}:${c.category}`, label: marketText(input.sport, c.dimension, 'full'), direction: dir, line: at, value }]
            : [];
        })
      : [],
  };
}
