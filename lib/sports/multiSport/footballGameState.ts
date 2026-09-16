/**
 * C4 for football — NFL and CFB fill the shared `GameStateSlot` from the same
 * ESPN summary (`footballLiveGame.ts`), so one builder serves both (R6.2).
 *
 * Football's own situation — possession, down and distance, the red zone — is
 * `footballLiveGame.ts`'s `situation`, parsed from the same summary for both
 * leagues (R6.3). ESPN sends it only while a game has live plays.
 *
 * THE BOX SCORE NAMES PLAYERS, IT DOES NOT ID THEM. ESPN's football summary
 * carries `athlete.displayName` only, so the subject's row is matched by name —
 * the same match `useLiveLineValues` already makes for these two sports. A miss
 * reads as "not in the box score yet", which is also the true state for a
 * player who has not touched the ball.
 */

import { liveLineHit } from '@/lib/sports/shared/liveLine';
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

function ordinalDown(down: number): string {
  return ['1st', '2nd', '3rd', '4th'][down - 1] ?? `${down}th`;
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
  /** The best price on the side shown, at that line. */
  priceFor: (c: PickCandidate, line: number) => { americanOdds: number; bookmaker: string } | null;
  /** The game page for this event. */
  gameHref: string | null;
  /** The page's own team identity, for the score panel's logos. */
  teams: { abbr?: string; logoUrl?: string; opponentAbbr?: string; opponentLogoUrl?: string };
  /** True once the scheduled start has passed; before it there is nothing to poll. */
  started: boolean;
}

export function toFootballGameState(input: FootballGameStateInput): GameStateSlot | null {
  const live = input.live.data;
  if (!live || live.state !== 'in') {
    return input.started && input.live.loading
      ? { status: 'loading', away: { abbr: 'Away', score: null }, home: { abbr: 'Home', score: null }, periodLabel: null, subjectLine: null, lines: [], events: [], gameHref: input.gameHref }
      : null;
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
          if (value == null || dir === null || at == null) return [];
          return [
            {
              key: `${c.dimension}:${c.category}`,
              label: marketText(input.sport, c.dimension, 'full'),
              direction: dir,
              line: at,
              value,
              cleared: liveLineHit(dir, value, at),
              price: input.priceFor(c, at),
            },
          ];
        })
      : [],
    // Newest first; ESPN lists scoring plays oldest first.
    events: [...(live.scoringPlays ?? [])]
      .slice(-4)
      .reverse()
      .map((s) => ({ clock: `Q${s.period} ${s.clockDisplay}`, text: s.description || s.typeText })),
    gameHref: input.gameHref,
    football: live.situation
      ? {
          possession: live.situation.possessionTeamId === live.homeTeamId ? live.homeAbbr : live.situation.possessionTeamId === live.awayTeamId ? live.awayAbbr : null,
          downAndDistance: live.situation.down != null && live.situation.distance != null ? `${ordinalDown(live.situation.down)} & ${live.situation.distance}` : null,
          ballOn: live.situation.yardLine != null ? String(live.situation.yardLine) : null,
          redZone: live.situation.isRedZone,
        }
      : null,
  };
}
