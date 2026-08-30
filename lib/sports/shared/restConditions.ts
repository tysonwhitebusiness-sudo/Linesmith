/**
 * `conditions` (role 5) from a schedule — the rest-and-load reading NBA and NHL
 * fill it with, where MLB and NFL fill it with weather.
 *
 * WHY THESE TWO SPORTS GET SOMETHING DIFFERENT, and why that is the role
 * working rather than a fudge: basketball and hockey are played indoors, so
 * temperature and wind are not conditions in any sense a bettor acts on. What
 * moves those markets is REST — a team on the second night of a back-to-back is
 * a genuinely different team. `playerRoles.ts`'s own table says exactly this
 * ("Rest, travel" for NBA, "Rest, opp starts" for NHL); this is that line
 * implemented.
 *
 * =================== EVERY FACT HERE IS COUNTED, NOT MODELLED ==============
 *
 * `impact` is deliberately never set, the same as `conditionsRole.ts`. That
 * field is for a real measured multiplier, and "a back-to-back costs N points"
 * is exactly the kind of number that would have to be fitted before it could be
 * shown. Counting games and days is arithmetic; claiming an effect size is not.
 *
 * DAYS ARE COUNTED IN UTC CALENDAR DAYS, not 24-hour spans. A game finishing
 * late on the 1st and another on the 2nd is a back-to-back to everyone who
 * follows the sport, even though barely twenty hours separate them. Using
 * elapsed hours would call that a rest day.
 * ==========================================================================
 */

import type { ConditionFact, ConditionsRole } from '@/lib/sports/shared/playerRoles';

export interface RestConditionsInput {
  /** Game dates from the subject's own history, any order, ISO-ish strings. */
  gameDates: ReadonlyArray<string | undefined>;
  /** "now", injectable so this is testable without freezing the clock. */
  asOf?: Date;
  title?: string;
  /** Sport-specific facts rendered before the rest ones. */
  extraFacts?: ConditionFact[];
}

function utcDay(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
}

/**
 * `null` when there is no usable schedule — fewer than two dated games means
 * there is nothing to say about rest, and an empty card under a "Conditions"
 * heading says less than no card.
 */
export function toRestConditions(input: RestConditionsInput): ConditionsRole | null {
  const { gameDates, asOf = new Date(), title = 'Rest & schedule', extraFacts = [] } = input;

  const days = gameDates
    .map((d) => (d ? new Date(d) : null))
    .filter((d): d is Date => d != null && !Number.isNaN(d.getTime()))
    .map(utcDay)
    .sort((a, b) => a - b);

  if (days.length < 2) return null;

  const today = utcDay(asOf);
  const last = days[days.length - 1];
  const previous = days[days.length - 2];

  const facts: ConditionFact[] = [...extraFacts];

  // Days since the most recent game. Clamped at zero: a fixture list that runs
  // slightly ahead of the clock should not print "-1 days rest".
  const sinceLast = Math.max(0, today - last);
  facts.push({
    key: 'rest',
    label: 'Days since last game',
    value: sinceLast === 0 ? 'Played today' : `${sinceLast}`,
  });

  // Whether the two most recent games were on consecutive calendar days.
  if (last - previous === 1) {
    facts.push({ key: 'b2b', label: 'Back-to-back', value: 'Yes — second night' });
  }

  // Schedule load. Counted over the trailing seven days INCLUSIVE of today,
  // which is the window the phrase "games in the last week" means.
  const lastSeven = days.filter((d) => today - d < 7).length;
  if (lastSeven > 0) {
    facts.push({
      key: 'load',
      label: 'Games in 7 days',
      value: `${lastSeven}`,
    });
  }

  if (facts.length === 0) return null;
  return { title, facts };
}
