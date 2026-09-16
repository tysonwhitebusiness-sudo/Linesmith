/**
 * C4 for NBA and NHL (R6.5) — the two sports the plan asks to show "your lines
 * so far" from the live box score, alongside the score and the period.
 *
 * ONE BUILDER, TWO SPORTS, for the reason `footballGameState.ts` is one for NFL
 * and CFB: the feeds differ (ESPN's basketball box against NHL api-web's
 * gamecenter, one keyed by name and one by id), but the slot they fill is the
 * same and the rules about it — what counts as cleared, what a missing row
 * means — must not drift apart.
 *
 * THE BOX SCORE NAMES PLAYERS, IT DOES NOT ID THEM, the same trap football hit:
 * ESPN's NBA box carries `athlete.displayName`, so the subject's row is matched
 * by name. A miss reads as "not in the box score yet", which is also the true
 * state for a player who has not yet come off the bench.
 *
 * HOCKEY IS THE ONE THAT DOES IT PROPERLY. The api-web gamecenter box carries
 * `playerId` on every skater and goalie (`NhlSkaterGameStat`), so the NHL card
 * matches on the ID the page already has rather than on a display name — no
 * "A. Matthews" / "Auston Matthews" class of miss, which is a real risk for
 * the two sports that only publish a name.
 */

import { liveLineHit } from '@/lib/sports/shared/liveLine';
import type { NbaLiveGameDetail } from '@/lib/sports/nba/liveGame';
import type { NhlLiveGameDetail } from '@/lib/sports/nhl/liveGame';
import { isNhlGameLive } from '@/lib/sports/nhl/gameStates';
import type { NhlGoalieGameStat, NhlSkaterGameStat } from '@/lib/sports/nhl/nhle';
import type { GameStateSlot } from '@/lib/sports/mlb/adapters/playerDetailAdapter';
import type { PickCandidate } from '@/lib/core/types';
import { directionMark, marketText } from '@/components/MarketLabel';

interface Common {
  subjectName: string;
  candidates: PickCandidate[];
  /** The line each candidate is shown at — the main line, not the snapshot's. */
  lineFor: (c: PickCandidate) => number | null;
  /** The best price on the side shown, at that line. */
  priceFor: (c: PickCandidate, line: number) => { americanOdds: number; bookmaker: string } | null;
  gameHref: string | null;
  teams: { abbr?: string; logoUrl?: string; opponentAbbr?: string; opponentLogoUrl?: string };
  /** True once the scheduled start has passed; before it there is nothing to poll. */
  started: boolean;
}

const loadingSlot = (gameHref: string | null): GameStateSlot => ({
  status: 'loading',
  away: { abbr: 'Away', score: null },
  home: { abbr: 'Home', score: null },
  periodLabel: null,
  subjectLine: null,
  lines: [],
  events: [],
  gameHref,
});

// ---------------------------------------------------------------------------
// NBA
// ---------------------------------------------------------------------------

/** A candidate dimension to the box-score number that settles it. */
export function nbaLiveValue(row: { pts: number; reb: number; ast: number; stl: number; blk: number; to: number }, dimension: string): number | null {
  const map: Record<string, number> = {
    points: row.pts,
    rebounds: row.reb,
    assists: row.ast,
    steals: row.stl,
    blocks: row.blk,
    turnovers: row.to,
    'points-rebounds-assists': row.pts + row.reb + row.ast,
    'points-rebounds': row.pts + row.reb,
    'points-assists': row.pts + row.ast,
    'rebounds-assists': row.reb + row.ast,
    'steals-blocks': row.stl + row.blk,
  };
  return map[dimension] ?? null;
}

export function toNbaGameState(input: Common & { live: { data: NbaLiveGameDetail | null; loading: boolean } }): GameStateSlot | null {
  const live = input.live.data;
  if (!live || live.state !== 'in') return input.started && input.live.loading ? loadingSlot(input.gameHref) : null;

  const logoFor = (abbr: string) =>
    abbr === input.teams.abbr ? input.teams.logoUrl : abbr === input.teams.opponentAbbr ? input.teams.opponentLogoUrl : undefined;
  const row = Object.values(live.boxByTeam ?? {})
    .flat()
    .find((p) => p.name.toLowerCase() === input.subjectName.toLowerCase());

  return {
    status: 'live',
    away: { abbr: live.awayAbbr, logoUrl: logoFor(live.awayAbbr), score: live.awayScore },
    home: { abbr: live.homeAbbr, logoUrl: logoFor(live.homeAbbr), score: live.homeScore },
    periodLabel: live.period != null ? `Q${live.period}${live.displayClock ? ` ${live.displayClock}` : ''}` : live.statusDetail,
    subjectLine: row
      ? {
          headline: `${row.pts} pts, ${row.reb} reb, ${row.ast} ast`,
          facts: [`${row.min} min`, `${row.stl} stl`, `${row.blk} blk`, `${row.to} TO`],
          now: null,
          plays: [],
        }
      : null,
    lines: row
      ? input.candidates.flatMap((c) => {
          const value = nbaLiveValue(row, c.dimension);
          const dir = directionMark(c.category);
          const at = input.lineFor(c);
          if (value == null || dir === null || at == null) return [];
          return [
            {
              key: `${c.dimension}:${c.category}`,
              label: marketText('nba', c.dimension, 'full'),
              direction: dir,
              line: at,
              value,
              cleared: liveLineHit(dir, value, at),
              price: input.priceFor(c, at),
            },
          ];
        })
      : [],
    events: [live.awayTopScorer, live.homeTopScorer]
      .filter((s): s is NonNullable<typeof s> => s != null)
      .map((s) => ({ clock: 'Top scorer', text: `${s.name} · ${s.points} pts` })),
    gameHref: input.gameHref,
  };
}

// ---------------------------------------------------------------------------
// NHL
// ---------------------------------------------------------------------------

/** A candidate dimension to the box-score number that settles it. */
export function nhlLiveValue(
  skater: NhlSkaterGameStat | undefined,
  goalie: NhlGoalieGameStat | undefined,
  dimension: string,
): number | null {
  const map: Record<string, number | undefined> = {
    goals: skater?.goals,
    assists: skater?.assists,
    points: skater?.points,
    'shots-on-goal': skater?.shots,
    hits: skater?.hits,
    'blocked-shots': skater?.blockedShots,
    saves: goalie?.saves,
    'goals-against': goalie?.goalsAgainst,
  };
  return map[dimension] ?? null;
}

export function toNhlGameState(
  input: Common & { live: { data: NhlLiveGameDetail | null; loading: boolean }; playerId?: string },
): GameStateSlot | null {
  const live = input.live.data;
  if (!live || !isNhlGameLive(live.gameState)) return input.started && input.live.loading ? loadingSlot(input.gameHref) : null;

  const logoFor = (abbr: string) =>
    abbr === input.teams.abbr ? input.teams.logoUrl : abbr === input.teams.opponentAbbr ? input.teams.opponentLogoUrl : undefined;

  // Matched on the id, not the name: the NHL box publishes one.
  const id = Number(input.playerId);
  const skater = Object.values(live.skatersByTeam ?? {})
    .flat()
    .find((p) => p.playerId === id);
  const goalie = Object.values(live.goaliesByTeam ?? {})
    .flat()
    .find((p) => p.playerId === id);

  const clock = live.clock?.inIntermission ? 'intermission' : live.clock?.timeRemaining;
  return {
    status: 'live',
    away: { abbr: live.awayAbbr, logoUrl: logoFor(live.awayAbbr), score: live.awayScore },
    home: { abbr: live.homeAbbr, logoUrl: logoFor(live.homeAbbr), score: live.homeScore },
    periodLabel: live.period ? `P${live.period.number}${clock ? ` ${clock}` : ''}` : live.gameState,
    subjectLine: goalie
      ? { headline: `${goalie.saves} saves, ${goalie.goalsAgainst} against`, facts: [], now: null, plays: [] }
      : skater
        ? {
            headline: `${skater.goals}G ${skater.assists}A · ${skater.shots} SOG`,
            facts: [`${skater.hits} hits`, `${skater.blockedShots} blocks`],
            now: null,
            plays: [],
          }
        : null,
    lines:
      skater || goalie
        ? input.candidates.flatMap((c) => {
            const value = nhlLiveValue(skater, goalie, c.dimension);
            const dir = directionMark(c.category);
            const at = input.lineFor(c);
            if (value == null || dir === null || at == null) return [];
            return [
              {
                key: `${c.dimension}:${c.category}`,
                label: marketText('nhl', c.dimension, 'full'),
                direction: dir,
                line: at,
                value,
                cleared: liveLineHit(dir, value, at),
                price: input.priceFor(c, at),
              },
            ];
          })
        : [],
    events: [...(live.goals ?? [])]
      .slice(-4)
      .reverse()
      .map((g) => ({ clock: `P${g.period}`, text: `${g.scorerName} (${g.teamAbbr})${g.strength && g.strength !== 'ev' ? ` · ${g.strength.toUpperCase()}` : ''}` })),
    gameHref: input.gameHref,
  };
}
